import { getSpecies } from './plants';
import { Plant, Spot } from './types';
import { soilLiters } from './watering';

/**
 * The advice engine. Every recommendation is specific: exact water volume
 * (from pot size + material), and per-factor guidance — light, humidity,
 * heat — not just "water it."
 */

export interface Advice {
  icon: string; // Ionicons name
  severity: 'good' | 'caution' | 'critical';
  text: string;
}

/** Species light/humidity references — from the plant database. */
function envFor(species: string): { dli: [number, number]; rhFloor: number } {
  const s = getSpecies(species);
  if (s) return { dli: s.dli, rhFloor: s.rhFloor };
  return { dli: [1.5, 6], rhFloor: 35 };
}

/**
 * Recommended thorough-watering volume: ~11.5% of the pot's soil volume, from
 * the measured pot diameter when the user gave one (same species, bigger pot =
 * more water), else the S/M/L bucket. Terracotta breathes, so it gets extra.
 */
export function waterAmount(plant: Plant): { ml: number; label: string } {
  const base = soilLiters(plant.potSize, plant.potCm) * 115;
  const factor = plant.potMaterial === 'Terracotta' ? 1.2 : plant.potMaterial === 'Ceramic' ? 1 : 0.9;
  const ml = Math.max(50, Math.round((base * factor) / 25) * 25);
  // kitchen units first — cups under 2, pints above
  const cups = ml / 240;
  let unit: string;
  if (cups >= 2) {
    const pints = Math.round((ml / 473) * 4) / 4;
    unit = `${pints} pint${pints > 1 ? 's' : ''}`;
  } else {
    const rounded = cups >= 1 ? Math.round(cups * 2) / 2 : Math.round(cups * 4) / 4;
    unit = `${rounded} cup${rounded > 1 ? 's' : ''}`;
  }
  return { ml, label: `${unit} (${ml} ml)` };
}

/** The single action line for list rows and cards. */
export function primaryAction(plant: Plant): string {
  const a = plant.forecast.action;
  if (/^water/i.test(a)) {
    const { label } = waterAmount(plant);
    // "Water Wed evening" → "Water 350 ml (~1.5 cups) Wed evening"
    return a.replace(/^water\s*/i, `Water ${label} `);
  }
  return a;
}

/** Full per-factor advice for Plant Detail and briefings. */
export function adviceFor(plant: Plant, spot?: Spot): Advice[] {
  const out: Advice[] = [];
  const env = envFor(plant.species);
  const { label } = waterAmount(plant);

  // hydration — too wet beats everything else
  const currentMoisture = plant.moistureHistory[0]?.moisture;
  if (currentMoisture != null && currentMoisture > plant.comfortBand[1]) {
    out.push({
      icon: 'water',
      severity: 'critical',
      text: `Too wet — soil at ${currentMoisture}%, above its ${plant.comfortBand[1]}% ceiling. Do not water; let it dry back into the band. Wet roots rot.`,
    });
  } else if (plant.forecast.criticalInDays != null) {
    out.push({
      icon: 'water',
      severity: plant.forecast.criticalInDays <= 2 ? 'critical' : 'caution',
      text: `${primaryAction(plant)} — pour slowly until the top drains, then stop.`,
    });
  } else if (/^check/i.test(plant.forecast.action)) {
    out.push({
      icon: 'water-outline',
      severity: 'caution',
      text: `${plant.forecast.action} — if the top inch is dry, give it ${label}.`,
    });
  } else {
    out.push({ icon: 'water-outline', severity: 'good', text: 'Hydration on track — nothing needed.' });
  }

  if (spot) {
    // light — both directions
    if (spot.dli > env.dli[1]) {
      out.push({
        icon: 'sunny',
        severity: 'caution',
        text: `Too bright here for a ${plant.species.toLowerCase()} — ${spot.dli.toFixed(1)} DLI vs a ${env.dli[1]} ceiling. Strong light scorches its leaves; a dimmer spot would help.`,
      });
    } else if (spot.dli < env.dli[0]) {
      out.push({
        icon: 'sunny-outline',
        severity: 'caution',
        text: `Light debt — ${spot.dli.toFixed(1)} DLI vs the ${env.dli[0]} DLI it needs. Growth slows and leaves fade below that.`,
      });
    } else {
      out.push({ icon: 'sunny-outline', severity: 'good', text: `Light fits — ${spot.dli.toFixed(1)} DLI sits inside its ${env.dli[0]}–${env.dli[1]} band.` });
    }

    // humidity
    if (spot.rh < env.rhFloor) {
      out.push({
        icon: 'rainy',
        severity: 'caution',
        text: `Air too dry — ${spot.rh}% RH vs its ${env.rhFloor}% floor. Expect crisp leaf edges; a humidifier or pebble tray fixes it.`,
      });
    }

    // heat
    if (spot.tempRange[1] >= 90) {
      out.push({
        icon: 'thermometer',
        severity: 'caution',
        text: `Heat spikes to ${spot.tempRange[1]}° here — soil dries roughly twice as fast on those days.`,
      });
    }
  }

  return out;
}
