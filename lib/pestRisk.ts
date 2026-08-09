import { metricSummary } from './dailyStats';
import type { Reading } from './devices';
import { vpdKpa } from './vpd';

/**
 * CONDITION-DRIVEN PEST AND DISEASE RISK.
 *
 * The catalog already carries per-species notes on what tends to attack a plant.
 * That is reference material: it tells you what to look for, but not when. This
 * turns the sensor stream into a forecast, because the common houseplant pests
 * and diseases are not random visitations — each needs a specific microclimate,
 * and Greenr is already measuring all of them.
 *
 *   FUNGUS GNATS      lay in the top few centimetres of permanently damp mix.
 *                     Their whole life cycle needs that surface to stay wet, so
 *                     soil that never dries back is the entire cause.
 *   SPIDER MITES      thrive in hot dry air and reproduce dramatically faster as
 *                     VPD climbs — a generation in a week at 30 °C, versus a
 *                     month in cool humid air.
 *   BOTRYTIS / MOULD  need free moisture sitting on tissue, which happens when
 *                     the air is nearly saturated and nothing is moving it.
 *   ROOT ROT          is anaerobic decay: soil above field capacity for longer
 *                     than roots can survive without oxygen.
 *
 * Deliberately conservative. Every risk requires the condition to have PERSISTED
 * over several days, judged from daily averages rather than a single reading —
 * one muggy evening is not an outbreak, and an app that cries pest weekly is one
 * people stop reading.
 */

export type PestKey = 'fungus-gnats' | 'spider-mites' | 'botrytis' | 'root-rot';

export interface PestRisk {
  key: PestKey;
  name: string;
  level: 'watch' | 'likely';
  /** what in the measurements triggered it */
  because: string;
  /** what to do now */
  action: string;
  /** how many days of data support it */
  days: number;
}

/** Days of agreeing conditions before anything is said at all. */
const MIN_DAYS = 3;
/** Days after which a persistent condition stops being a watch and becomes likely. */
const LIKELY_DAYS = 6;

/** A reading is only usable if the value we need is a real number. */
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function pestRisks(history: Reading[], band: [number, number]): PestRisk[] {
  const out: PestRisk[] = [];
  if (!history.length) return out;

  // Sensor payloads arrive over the network and are not guaranteed sane. A
  // non-finite value used to survive the daily average and surface as literal
  // text — "Soil has averaged Infinity%" — so malformed readings are dropped
  // before any statistic is computed from them.
  const clean = history.filter(
    (r) => Number.isFinite(new Date(r.created_at).getTime()) &&
      (finite(r.soil_pct) || finite(r.temp_c) || finite(r.humidity_pct) || finite(r.light_lux)),
  ).map((r) => ({
    ...r,
    soil_pct: finite(r.soil_pct) ? r.soil_pct : null,
    temp_c: finite(r.temp_c) ? r.temp_c : null,
    humidity_pct: finite(r.humidity_pct) ? r.humidity_pct : null,
    light_lux: finite(r.light_lux) ? r.light_lux : null,
  }));
  if (!clean.length) return out;

  const soil = metricSummary(clean, 'soil');
  const rh = metricSummary(clean, 'humidity');
  const temp = metricSummary(clean, 'temp');
  const light = metricSummary(clean, 'light');
  // Belt and braces: a summary whose numbers are not finite is unusable.
  const usable = (m: { avg: number; low: number; high: number } | null) =>
    m && finite(m.avg) && finite(m.low) && finite(m.high) ? m : null;
  const [lo, hi] = band;

  const level = (days: number): 'watch' | 'likely' => (days >= LIKELY_DAYS ? 'likely' : 'watch');

  // ── Fungus gnats: the top of the mix never dries back ──
  if (usable(soil) && soil!.days >= MIN_DAYS && soil!.avg > (lo + hi) / 2 && soil!.low > lo) {
    out.push({
      key: 'fungus-gnats',
      name: 'Fungus gnats',
      level: level(soil!.days),
      because: `Soil has averaged ${soil!.avg.toFixed(0)}% over ${soil!.days} days and never dropped below ${soil!.low.toFixed(0)}%, so the surface has stayed damp throughout.`,
      action:
        'Let the top 2–3 cm dry between waterings — that alone breaks the life cycle. Bottom-watering and a layer of grit on the surface both help.',
      days: soil!.days,
    });
  }

  // ── Spider mites: hot, dry air ──
  if (usable(temp) && usable(rh) && temp!.days >= MIN_DAYS && rh!.days >= MIN_DAYS) {
    const kpa = vpdKpa(temp!.avg, rh!.avg);
    if (kpa != null && kpa > 1.8 && temp!.avg >= 21) {
      const days = Math.min(temp!.days, rh!.days);
      out.push({
        key: 'spider-mites',
        name: 'Spider mites',
        level: level(days),
        because: `Air has been hot and dry for ${days} days — ${temp!.avg.toFixed(0)} °C at ${rh!.avg.toFixed(0)}% humidity, a vapour pressure deficit of ${kpa.toFixed(2)} kPa. Mites breed several times faster in these conditions.`,
        action:
          'Check leaf undersides for fine webbing and pale stippling. Raise humidity, and rinse the foliage — mites hate being wet.',
        days,
      });
    }
  }

  // ── Botrytis / surface mould: saturated still air, little light ──
  if (usable(rh) && usable(temp) && rh!.days >= MIN_DAYS) {
    const kpa = vpdKpa(temp!.avg, rh!.avg);
    const dim = usable(light) ? light!.avg < 25 : false;
    if (kpa != null && kpa < 0.35 && dim) {
      out.push({
        key: 'botrytis',
        name: 'Mould and leaf spotting',
        level: level(rh!.days),
        because: `Humidity has averaged ${rh!.avg.toFixed(0)}% in dim light for ${rh!.days} days, leaving a vapour pressure deficit of only ${kpa.toFixed(2)} kPa. Moisture is sitting on the leaves instead of evaporating.`,
        action:
          'Get some air moving — a fan on its lowest setting is enough — and stop misting. Remove any leaves that have already spotted.',
        days: rh!.days,
      });
    }
  }

  // ── Root rot: waterlogged for longer than roots tolerate ──
  if (usable(soil) && soil!.days >= MIN_DAYS && soil!.low > hi) {
    out.push({
      key: 'root-rot',
      name: 'Root rot',
      level: level(soil!.days),
      because: `Soil has not dropped below ${soil!.low.toFixed(0)}% in ${soil!.days} days, staying above the ${hi}% ceiling throughout. Roots in saturated soil run out of oxygen.`,
      action:
        'Stop watering and check the drainage holes and saucer. If the mix smells sour, repot into fresh medium and trim any blackened roots.',
      days: soil!.days,
    });
  }

  // Most-supported first.
  return out.sort((a, b) => (b.level === 'likely' ? 1 : 0) - (a.level === 'likely' ? 1 : 0) || b.days - a.days);
}
