import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchWeather, type WeatherData } from './weather';

/**
 * Live-weather hook (§10). Resolves the device location once (coordinates are
 * cached so it never re-prompts), fetches Open-Meteo, and caches the result in
 * AsyncStorage with a 30-minute TTL. Auto-refreshes while the app is open so the
 * UI reflects current conditions (§3 — nothing stale/hardcoded). Location is
 * only requested when the user taps "enable"; until then status is 'idle'.
 */

const CACHE_KEY = 'greenr.weather.v1';
const TTL_MS = 30 * 60 * 1000;
const REFRESH_MS = 30 * 60 * 1000;

type Status = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

interface Cached {
  data: WeatherData;
  place: string | null;
}

export interface UseWeather {
  weather: WeatherData | null;
  place: string | null;
  status: Status;
  /** true while a fetch is in flight */
  loading: boolean;
  /** request location permission (first run) and fetch */
  enable: () => Promise<void>;
  /** re-fetch using the known coordinates */
  refresh: () => Promise<void>;
}

export function useWeather(): UseWeather {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [loading, setLoading] = useState(false);
  const coords = useRef<{ lat: number; lon: number } | null>(null);
  const alive = useRef(true);

  const save = useCallback(async (data: WeatherData, pl: string | null) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data, place: pl } as Cached));
    } catch {
      // best-effort cache
    }
  }, []);

  const fetchFor = useCallback(
    async (lat: number, lon: number, pl: string | null) => {
      setLoading(true);
      const data = await fetchWeather(lat, lon);
      if (!alive.current) return;
      setLoading(false);
      if (data) {
        coords.current = { lat, lon };
        setWeather(data);
        if (pl != null) setPlace(pl);
        setStatus('ready');
        save(data, pl ?? place);
      } else {
        setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
      }
    },
    [place, save],
  );

  // On mount: hydrate from cache, then background-refresh if stale.
  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw && alive.current) {
          const c = JSON.parse(raw) as Cached;
          coords.current = { lat: c.data.latitude, lon: c.data.longitude };
          setWeather(c.data);
          setPlace(c.place);
          setStatus('ready');
          if (Date.now() - c.data.fetchedAt > TTL_MS) {
            fetchFor(c.data.latitude, c.data.longitude, c.place);
          }
        }
      } catch {
        // no cache yet
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [fetchFor]);

  // Periodic refresh while mounted, once we have coordinates.
  useEffect(() => {
    const iv = setInterval(() => {
      if (coords.current) fetchFor(coords.current.lat, coords.current.lon, place);
    }, REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchFor, place]);

  const enable = useCallback(async () => {
    setStatus('loading');
    setLoading(true);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        setLoading(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const { latitude, longitude } = pos.coords;
      let pl: string | null = null;
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        const g = geo[0];
        if (g) pl = [g.city, g.region].filter(Boolean).join(', ') || g.country || null;
      } catch {
        // reverse geocode is best-effort
      }
      await fetchFor(latitude, longitude, pl);
    } catch {
      setStatus('error');
      setLoading(false);
    }
  }, [fetchFor]);

  const refresh = useCallback(async () => {
    if (coords.current) await fetchFor(coords.current.lat, coords.current.lon, place);
    else await enable();
  }, [enable, fetchFor, place]);

  return { weather, place, status, loading, enable, refresh };
}
