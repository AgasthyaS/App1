import type { Reading } from './devices';
import { OBSERVATION_LABEL } from './observations';
import { humidityStatus, idealsFor, lightStatus, soilStatus, tempStatus, type Tone } from './plantStatus';
import { plantLabel } from './format';
import type { ObservationKind, Plant, PlantObservation } from './types';
import { vpdKpa, vpdVerdict } from './vpd';
import { waterProfileFor } from './plants';

/**
 * CHECK-UP — what the sensors show, what the owner sees, and where the two meet.
 *
 * This replaces a "photo diagnosis" that waited four seconds and then displayed
 * invented probabilities. Nothing here looks at a photo and nothing here is a
 * probability. It does three honest things:
 *
 *   1. States each MEASURED condition against what the species wants.
 *   2. Takes what the owner REPORTS seeing.
 *   3. Where a reported symptom coincides with a measured condition that is a
 *      well-known cause of it, says so — as something to check, with the
 *      measurement that prompted it.
 *
 * The pairings in (3) are the standard ones from horticultural extension
 * guidance (wilting in dry soil, yellowing in wet soil, stretching in low light,
 * brown tips in dry air). Each is common, none is certain, and most symptoms
 * have causes no sensor here can see — pests, root damage, nutrition, water
 * quality. When nothing measured fits, the check-up says exactly that instead of
 * reaching for the nearest explanation.
 */

export type MeasuredKey = 'soil' | 'light' | 'temperature' | 'humidity' | 'air';

export interface MeasuredFinding {
  key: MeasuredKey;
  label: string;
  tone: Tone;
  /** the reading, formatted */
  value: string;
  /** one sentence against the species' range */
  detail: string;
  /** which way it is off, when it is */
  off?: 'low' | 'high';
}

export interface Lead {
  /** what the owner reported */
  symptom: ObservationKind;
  /** the measured condition it coincides with */
  with: MeasuredKey;
  title: string;
  /** the measurement that prompted this */
  basis: string;
  /** what to do or look at */
  check: string;
}

export interface Checkup {
  measured: MeasuredFinding[];
  /** observations from the last 14 days that were considered */
  recent: PlantObservation[];
  leads: Lead[];
  /** symptoms reported that no measured condition accounts for */
  unexplained: ObservationKind[];
  /** true when there is no reading to check against */
  noSensor: boolean;
}

const RECENT_DAYS = 14;

/** symptom → the measured conditions known to produce it, with what to do. */
const PAIRINGS: {
  symptom: ObservationKind;
  key: MeasuredKey;
  off: 'low' | 'high';
  title: string;
  check: string;
}[] = [
  { symptom: 'wilting', key: 'soil', off: 'low', title: 'Wilting with dry soil', check: 'Water thoroughly. Leaves usually lift within a day if this was the cause.' },
  { symptom: 'wilting', key: 'soil', off: 'high', title: 'Wilting although the soil is wet', check: 'This is how waterlogged roots show. Stop watering, check the pot drains, and look at the roots if it does not recover: healthy roots are firm and pale, rotten ones brown and soft.' },
  { symptom: 'wilting', key: 'temperature', off: 'high', title: 'Wilting in heat', check: 'Move it out of direct sun or away from the heat source during the hottest hours.' },
  { symptom: 'yellowing', key: 'soil', off: 'high', title: 'Yellowing with soil wetter than it likes', check: 'Let it dry back into range before watering again. Lower, older leaves yellowing first fits this.' },
  { symptom: 'yellowing', key: 'light', off: 'low', title: 'Yellowing in low light', check: 'Move it nearer a window. A plant sheds leaves it cannot afford to keep.' },
  { symptom: 'yellowing', key: 'temperature', off: 'low', title: 'Yellowing in the cold', check: 'Move it away from cold glass and draughts.' },
  { symptom: 'browning', key: 'humidity', off: 'low', title: 'Brown tips in dry air', check: 'Group plants, use a pebble tray or a humidifier, and keep it away from radiators and vents.' },
  { symptom: 'browning', key: 'air', off: 'high', title: 'Brown tips in thirsty air', check: 'Warm, dry air pulls water from leaf edges faster than roots supply it. Raise humidity or lower the temperature.' },
  { symptom: 'browning', key: 'soil', off: 'low', title: 'Brown edges with dry soil', check: 'Water more consistently; repeated drying out crisps leaf margins.' },
  { symptom: 'browning', key: 'light', off: 'high', title: 'Browning in strong light', check: 'Scorch shows as pale or brown patches on the side facing the window. Filter the light or move it back.' },
  { symptom: 'leaf-drop', key: 'temperature', off: 'low', title: 'Leaf drop in the cold', check: 'Cold draughts are a common trigger. Move it somewhere steadier.' },
  { symptom: 'leaf-drop', key: 'soil', off: 'high', title: 'Leaf drop with wet soil', check: 'Let it dry out and check drainage.' },
  { symptom: 'leaf-drop', key: 'soil', off: 'low', title: 'Leaf drop with dry soil', check: 'Water thoroughly and keep it from drying right out again.' },
  { symptom: 'leaf-drop', key: 'light', off: 'low', title: 'Leaf drop in low light', check: 'Move it to a brighter spot.' },
  { symptom: 'leggy', key: 'light', off: 'low', title: 'Stretching toward light', check: 'Long gaps between leaves mean it wants more light. Move it closer to a window or add a grow light.' },
  { symptom: 'mould', key: 'soil', off: 'high', title: 'Mould with soil staying wet', check: 'Let the surface dry between waterings and improve airflow. Surface mould itself is usually harmless.' },
  { symptom: 'mould', key: 'air', off: 'low', title: 'Mould in still, damp air', check: 'Improve airflow and stop misting.' },
];

const fmt = (v: number, unit: string) => `${Math.round(v)}${unit}`;

export function checkup(opts: {
  plant: Plant;
  /** calibration-corrected latest reading, or null */
  reading: Reading | null;
  /** multi-day daytime light average on the 0–100 index, when there is one */
  lightAvg?: number | null;
  unitsF?: boolean;
  now?: number;
}): Checkup {
  const { plant, reading, lightAvg = null, unitsF = false, now = Date.now() } = opts;
  const name = plantLabel(plant.species);
  const ideal = idealsFor(plant.species, plant.comfortBand);
  const measured: MeasuredFinding[] = [];

  const soil = reading?.soil_pct;
  if (soil != null && Number.isFinite(soil)) {
    const st = soilStatus(soil, ideal.band);
    const [lo, hi] = ideal.band;
    // A soak-and-dry plant below its band is doing what it should between waterings.
    const dryIsFine = soil < lo && waterProfileFor(plant.species).style === 'soak-and-dry' && soil >= lo - 8;
    measured.push({
      key: 'soil', label: 'Soil moisture', tone: dryIsFine ? 'good' : st.tone, value: `index ${Math.round(soil)}`,
      detail: soil < lo
        ? `Below ${name}’s range of ${lo}–${hi}.`
        : soil > hi ? `Above ${name}’s range of ${lo}–${hi}.` : `Inside ${name}’s range of ${lo}–${hi}.`,
      off: dryIsFine ? undefined : soil < lo ? 'low' : soil > hi ? 'high' : undefined,
    });
  }

  const light = lightAvg ?? reading?.light_lux ?? null;
  if (light != null && Number.isFinite(light)) {
    const st = lightStatus(light, ideal.dli);
    const wantsHigh = ideal.dli[1] >= 10;
    const wantsLow = ideal.dli[1] <= 4;
    const off = st.tone === 'good' ? undefined : light < (wantsHigh ? 55 : wantsLow ? 8 : 28) ? 'low' : 'high';
    measured.push({
      key: 'light', label: lightAvg != null ? 'Light (daytime average)' : 'Light (right now)', tone: st.tone,
      value: `${st.label.toLowerCase()} · ${Math.round(light)}/100`,
      detail: off === 'low' ? `Dimmer than ${name} wants.` : off === 'high' ? `Brighter than ${name} wants.` : `Suits ${name}.`,
      off,
    });
  }

  const tc = reading?.temp_c;
  if (tc != null && Number.isFinite(tc)) {
    const st = tempStatus(tc, ideal.temp);
    const f = (tc * 9) / 5 + 32;
    const [lo, hi] = ideal.temp;
    const range = unitsF ? `${lo}–${hi} °F` : `${Math.round(((lo - 32) * 5) / 9)}–${Math.round(((hi - 32) * 5) / 9)} °C`;
    measured.push({
      key: 'temperature', label: 'Temperature', tone: st.tone, value: unitsF ? fmt(f, ' °F') : fmt(tc, ' °C'),
      detail: f < lo ? `Colder than ${name}’s ${range}.` : f > hi ? `Warmer than ${name}’s ${range}.` : `Inside ${name}’s ${range}.`,
      off: f < lo ? 'low' : f > hi ? 'high' : undefined,
    });
  }

  const rh = reading?.humidity_pct;
  if (rh != null && Number.isFinite(rh)) {
    const st = humidityStatus(rh, ideal.rhFloor);
    measured.push({
      key: 'humidity', label: 'Humidity', tone: st.tone, value: fmt(rh, '%'),
      detail: rh < ideal.rhFloor ? `Below the ${ideal.rhFloor}% ${name} wants.` : `At or above the ${ideal.rhFloor}% ${name} wants.`,
      off: rh < ideal.rhFloor ? 'low' : undefined,
    });
  }

  const vpd = vpdKpa(tc, rh);
  if (vpd != null) {
    const arid = waterProfileFor(plant.species).style === 'soak-and-dry';
    const v = vpdVerdict(vpd, arid);
    measured.push({
      key: 'air', label: 'Drying power of the air', tone: v.tone, value: `${vpd.toFixed(2)} kPa`,
      detail: v.label + '.',
      off: v.band === 'stressful' || v.band === 'high' ? 'high' : v.band === 'stagnant' ? 'low' : undefined,
    });
  }

  const recent = (plant.observations ?? []).filter((o) => {
    const t = new Date(o.at).getTime();
    return Number.isFinite(t) && now - t <= RECENT_DAYS * 86400000 && now - t >= 0;
  });
  // One entry per kind: the most recent report of each.
  const kinds = [...new Set(recent.map((o) => o.kind))];
  const concerns = kinds.filter((k) => !(k === 'looks-well' || k === 'new-growth' || k === 'flowering'));

  const leads: Lead[] = [];
  for (const symptom of concerns) {
    for (const p of PAIRINGS) {
      if (p.symptom !== symptom) continue;
      const m = measured.find((x) => x.key === p.key && x.off === p.off);
      if (!m) continue;
      leads.push({ symptom, with: p.key, title: p.title, basis: `${m.label}: ${m.value}. ${m.detail}`, check: p.check });
    }
  }
  const explained = new Set(leads.map((l) => l.symptom));
  return {
    measured,
    recent,
    leads,
    unexplained: concerns.filter((k) => !explained.has(k)),
    noSensor: measured.length === 0,
  };
}

/** What to say about symptoms the measurements do not account for. */
export function unexplainedText(kinds: ObservationKind[]): string {
  if (!kinds.length) return '';
  const list = kinds.map((k) => OBSERVATION_LABEL[k].toLowerCase()).join(', ');
  const pests = kinds.includes('pests');
  return `Nothing the sensors measure accounts for: ${list}. ${
    pests ? 'For pests, check the undersides of leaves and the stems, and keep it apart from other plants while you treat it. ' : ''
  }Causes Greenr cannot see include pests, root damage, feeding, water quality and age — worth checking by hand.`;
}
