/**
 * Live weather (§10) via Open-Meteo — a free, key-less, CORS-friendly forecast
 * API (https://open-meteo.com). No account or token required, so it works in
 * the web build and on device unchanged. Everything here is real measured/
 * forecast data; nothing is fabricated. When a fetch fails we return null and
 * the UI shows an honest "weather unavailable" state rather than stale numbers.
 */

export interface CurrentWeather {
  tempC: number;
  humidityPct: number;
  uvIndex: number;
  windKph: number;
  precipMm: number;
  code: number;
  description: string;
  emoji: string;
  isDay: boolean;
}

export interface DailyWeather {
  /** ISO date (yyyy-mm-dd, local) */
  date: string;
  tempMaxC: number;
  tempMinC: number;
  /** max chance of precipitation that day, % */
  rainProbPct: number;
  precipMm: number;
  uvMax: number;
  code: number;
  emoji: string;
  sunrise: string; // ISO datetime
  sunset: string;
}

export interface WeatherData {
  current: CurrentWeather;
  /** today first, 7 days */
  daily: DailyWeather[];
  sunrise: string; // today
  sunset: string;
  fetchedAt: number;
  latitude: number;
  longitude: number;
}

/** WMO weather-interpretation codes → short text + emoji. */
export function describeCode(code: number, isDay = true): { text: string; emoji: string } {
  const map: Record<number, [string, string]> = {
    0: ['Clear sky', isDay ? '☀️' : '🌙'],
    1: ['Mainly clear', isDay ? '🌤️' : '🌙'],
    2: ['Partly cloudy', '⛅'],
    3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'],
    48: ['Rime fog', '🌫️'],
    51: ['Light drizzle', '🌦️'],
    53: ['Drizzle', '🌦️'],
    55: ['Heavy drizzle', '🌧️'],
    56: ['Freezing drizzle', '🌧️'],
    57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌦️'],
    63: ['Rain', '🌧️'],
    65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'],
    67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'],
    73: ['Snow', '🌨️'],
    75: ['Heavy snow', '❄️'],
    77: ['Snow grains', '🌨️'],
    80: ['Light showers', '🌦️'],
    81: ['Showers', '🌧️'],
    82: ['Heavy showers', '⛈️'],
    85: ['Snow showers', '🌨️'],
    86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'],
    96: ['Thunderstorm, hail', '⛈️'],
    99: ['Thunderstorm, hail', '⛈️'],
  };
  return { text: map[code]?.[0] ?? 'Unknown', emoji: map[code]?.[1] ?? '🌡️' };
}

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** Fetch current conditions + a 7-day forecast for a coordinate. Null on failure. */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,uv_index,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
    temperature_unit: 'celsius',
  });
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`);
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j?.current || !j?.daily) return null;

    const c = j.current;
    const isDay = c.is_day === 1;
    const cd = describeCode(c.weather_code, isDay);
    const current: CurrentWeather = {
      tempC: c.temperature_2m,
      humidityPct: c.relative_humidity_2m,
      uvIndex: c.uv_index ?? 0,
      windKph: c.wind_speed_10m ?? 0,
      precipMm: c.precipitation ?? 0,
      code: c.weather_code,
      description: cd.text,
      emoji: cd.emoji,
      isDay,
    };

    const d = j.daily;
    const daily: DailyWeather[] = (d.time as string[]).map((date, i) => {
      const dd = describeCode(d.weather_code[i], true);
      return {
        date,
        tempMaxC: d.temperature_2m_max[i],
        tempMinC: d.temperature_2m_min[i],
        rainProbPct: d.precipitation_probability_max?.[i] ?? 0,
        precipMm: d.precipitation_sum?.[i] ?? 0,
        uvMax: d.uv_index_max?.[i] ?? 0,
        code: d.weather_code[i],
        emoji: dd.emoji,
        sunrise: d.sunrise[i],
        sunset: d.sunset[i],
      };
    });

    return {
      current,
      daily,
      sunrise: daily[0]?.sunrise ?? '',
      sunset: daily[0]?.sunset ?? '',
      fetchedAt: Date.now(),
      latitude: lat,
      longitude: lon,
    };
  } catch {
    return null;
  }
}

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const kphToMph = (k: number): number => k * 0.621371;

/** UV index → risk word (WHO standard bands). */
export function uvWord(uv: number): string {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

export interface WeatherWateringImpact {
  /** true when weather should change the watering call for an OUTDOOR plant */
  applies: boolean;
  /** 'delay' = rain will water it; 'accelerate' = heat/UV dries it faster */
  effect: 'delay' | 'accelerate' | 'none';
  note: string;
}

/**
 * How the forecast should nudge an outdoor plant's watering. Rain in the next
 * ~36h means you can hold off; a hot, dry, high-UV stretch means soil dries
 * faster than the sensor trend alone predicts. Indoor plants are unaffected.
 */
export function weatherWateringImpact(weather: WeatherData | null, outdoor: boolean): WeatherWateringImpact {
  const none: WeatherWateringImpact = { applies: false, effect: 'none', note: '' };
  if (!weather || !outdoor) return none;

  const today = weather.daily[0];
  const tomorrow = weather.daily[1];
  const soonRainProb = Math.max(today?.rainProbPct ?? 0, tomorrow?.rainProbPct ?? 0);
  const soonRainMm = (today?.precipMm ?? 0) + (tomorrow?.precipMm ?? 0);

  if (soonRainProb >= 60 && soonRainMm >= 2) {
    const when = (today?.rainProbPct ?? 0) >= 60 ? 'today' : 'tomorrow';
    return {
      applies: true,
      effect: 'delay',
      note: `Rain is likely ${when} (${soonRainProb}% chance, ~${soonRainMm.toFixed(0)} mm) — you can hold off watering and let nature do it.`,
    };
  }

  const hot = (today?.tempMaxC ?? 0) >= 30;
  const dry = weather.current.humidityPct < 40;
  const highUv = (today?.uvMax ?? 0) >= 8;
  if (hot && (dry || highUv)) {
    return {
      applies: true,
      effect: 'accelerate',
      note: `Hot and dry today (${Math.round(cToF(today.tempMaxC))}°F, UV ${uvWord(today?.uvMax ?? 0).toLowerCase()}) — soil will dry faster than usual, so check it sooner.`,
    };
  }

  return none;
}
