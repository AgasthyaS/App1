import { waterAmount } from './advice';
import { applyCalibration, calibrationFor, type SensorCalibration } from './calibration';
import type { Reading } from './devices';
import { estimateWaterSchedule } from './estimate';
import { dayLight, lightVerdict, recentLightAvg, type DayLight } from './insights';
import { idealsFor } from './plantStatus';
import { activePlants } from './store';
import type { Plant, Spot } from './types';
import { mlNeeded } from './watering';
import { weatherWateringImpact, type WeatherData } from './weather';

/**
 * Today's care tasks, derived live from the same data every other surface uses
 * — sensor readings, calibration, weather, and the sensorless watering cycle.
 * Nothing is seeded or invented: if a plant's soil reads 7%, Care Mode says
 * "Water — add ~250 ml"; if a spot benchmarked too dim, it says to move the
 * plant. No data → no task.
 */
export interface DerivedTask {
  id: string;
  plantId: string;
  plantName: string;
  kind: 'water' | 'water-check' | 'hold' | 'light' | 'humidity';
  title: string;
  why: string;
  /** exact amount for water tasks on sensored plants */
  ml: number | null;
  /** a paired sensor will confirm this task's effect on its next reading */
  sensorVerifies: boolean;
  minutes: number;
}

const KIND_ORDER: Record<DerivedTask['kind'], number> = {
  water: 0,
  'water-check': 1,
  light: 2,
  humidity: 3,
  hold: 4,
};

export function deriveCareTasks(opts: {
  plants: Plant[];
  spots: Spot[];
  readings: Map<string, Reading | null>;
  histories?: Map<string, Reading[]>;
  calibrations: Record<string, SensorCalibration>;
  /** persisted per-plant daily light — powers the multi-day light verdict */
  lightDaily?: Record<string, DayLight[]>;
  weather?: WeatherData | null;
}): DerivedTask[] {
  const { plants, spots, readings, histories, calibrations, lightDaily, weather = null } = opts;
  const out: DerivedTask[] = [];

  for (const p of activePlants(plants)) {
    const cal = calibrationFor(calibrations, (readings.get(p.id) ?? null)?.device_id, p.sensorId);
    const raw = readings.get(p.id) ?? null;
    const sensored = readings.has(p.id);
    const ideal = idealsFor(p.species, p.comfortBand);
    const [lo, hi] = ideal.band;
    const outdoor = !!spots.find((s) => s.id === p.spotId)?.outdoor;

    if (sensored && raw) {
      const r = applyCalibration(raw, cal);

      // Watering — the sensor's soil reading decides, weather adjusts.
      if (r.soil_pct != null && r.soil_pct < lo) {
        const impact = weatherWateringImpact(weather, outdoor);
        const target = Math.round((lo + hi) / 2);
        const ml = mlNeeded(p.potSize, p.potMaterial, r.soil_pct, target, p.potCm);
        if (impact.effect === 'delay') {
          out.push({
            id: `ct-${p.id}-rain`,
            plantId: p.id,
            plantName: p.name,
            kind: 'hold',
            title: `${p.name}: water lightly, or let the rain do it`,
            why: `Soil is ${Math.round(r.soil_pct)}% — below its ${lo}% minimum — but ${impact.note.charAt(0).toLowerCase()}${impact.note.slice(1)}`,
            ml: Math.round(ml / 2 / 25) * 25,
            sensorVerifies: true,
            minutes: 2,
          });
        } else {
          out.push({
            id: `ct-${p.id}-water`,
            plantId: p.id,
            plantName: p.name,
            kind: 'water',
            title: `Water ${p.name} — add ~${ml} ml`,
            why: `Soil is ${Math.round(r.soil_pct)}%, below ${p.species}'s ${lo}% minimum. ~${ml} ml takes this ${p.potMaterial.toLowerCase()} pot back to ~${target}%.`,
            ml,
            sensorVerifies: true,
            minutes: 2,
          });
        }
      } else if (r.soil_pct != null && r.soil_pct > hi + Math.max(8, hi - lo) * 0.4) {
        out.push({
          id: `ct-${p.id}-hold`,
          plantId: p.id,
          plantName: p.name,
          kind: 'hold',
          title: `Don't water ${p.name}`,
          why: `Soil is ${Math.round(r.soil_pct)}% — above its ${hi}% ceiling. Let it dry back into range; wet roots rot.`,
          ml: null,
          sensorVerifies: true,
          minutes: 0,
        });
      }

      // Light — judged on the MULTI-DAY daytime average, and only raised once at
      // least two days agree the spot is wrong. One cloudy day shouldn't tell
      // someone to relocate a plant; the verdict earns confidence over time.
      const hist = histories?.get(p.id);
      const calHist = hist && hist.length ? (cal ? hist.map((h) => applyCalibration(h, cal)) : hist) : null;
      const today = calHist ? dayLight(calHist) : null;
      const la = recentLightAvg(lightDaily?.[p.id] ?? [], today);
      if (la && la.days >= 2) {
        const verdict = lightVerdict(la.avg, p.species, ideal.dli, { days: la.days, hours: la.hours });
        if (verdict.tone === 'bad') {
          out.push({
            id: `ct-${p.id}-light`,
            plantId: p.id,
            plantName: p.name,
            kind: 'light',
            title: `Move ${p.name} to a brighter spot`,
            why: verdict.detail,
            ml: null,
            sensorVerifies: true,
            minutes: 5,
          });
        }
      }

      // Humidity — well below the species floor.
      if (r.humidity_pct != null && r.humidity_pct < ideal.rhFloor - 15) {
        out.push({
          id: `ct-${p.id}-rh`,
          plantId: p.id,
          plantName: p.name,
          kind: 'humidity',
          title: `Raise humidity near ${p.name}`,
          why: `Air is ${Math.round(r.humidity_pct)}% vs the ${ideal.rhFloor}% it wants — group plants, add a pebble tray, or run a humidifier.`,
          ml: null,
          sensorVerifies: true,
          minutes: 3,
        });
      }
    } else if (!sensored) {
      // Sensorless: the estimate cycle decides when a check is due.
      const est = estimateWaterSchedule(p);
      if (est.status === 'due') {
        const rec = waterAmount(p);
        out.push({
          id: `ct-${p.id}-check`,
          plantId: p.id,
          plantName: p.name,
          kind: 'water-check',
          title: `Check ${p.name}'s soil — likely due`,
          why: `${est.detail} If the top inch is dry, give it ${rec.label}.`,
          ml: rec.ml,
          sensorVerifies: false,
          minutes: 2,
        });
      }
    }
  }

  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
