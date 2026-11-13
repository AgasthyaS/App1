import { describe, expect, it } from 'vitest';

import { checkup, unexplainedText } from '@/lib/checkup';
import type { ObservationKind } from '@/lib/types';

import { DAY, NOW, makePlant, reading } from './helpers';

const saw = (kind: ObservationKind, daysAgo = 1) => ({ id: `ob-${kind}-${daysAgo}`, at: new Date(NOW - daysAgo * DAY).toISOString(), kind });
const run = (species: string, soil: number, over: any = {}, obs: ReturnType<typeof saw>[] = []) =>
  checkup({ plant: makePlant(species, { observations: obs }), reading: reading(NOW, soil, over), now: NOW });

describe('check-up', () => {
  it('reports each measured condition against the species, with no probabilities anywhere', () => {
    const c = run('Monstera', 44);
    expect(c.measured.map((m) => m.key)).toEqual(['soil', 'light', 'temperature', 'humidity', 'air']);
    expect(JSON.stringify(c)).not.toMatch(/\d+\s?% (likely|probab|chance)|prob/i);
    expect(c.leads).toEqual([]);
  });

  it('a symptom with a matching measured cause produces a lead that quotes the measurement', () => {
    const c = run('Boston fern', 12, {}, [saw('wilting')]);
    expect(c.leads).toHaveLength(1);
    expect(c.leads[0].title).toMatch(/dry soil/);
    expect(c.leads[0].basis).toMatch(/index 12/);
    expect(c.unexplained).toEqual([]);
  });

  it('the same symptom points the other way when the soil is wet', () => {
    const c = run('Monstera', 85, {}, [saw('wilting')]);
    expect(c.leads[0].title).toMatch(/although the soil is wet/);
    expect(c.leads[0].check).toMatch(/roots/);
  });

  it('a symptom nothing measured explains is said to be unexplained, not forced onto a cause', () => {
    const c = run('Monstera', 44, {}, [saw('yellowing'), saw('pests')]);
    expect(c.leads).toEqual([]);
    expect(c.unexplained.sort()).toEqual(['pests', 'yellowing']);
    expect(unexplainedText(c.unexplained)).toMatch(/undersides of leaves/);
  });

  it('good news and old observations create no leads', () => {
    expect(run('Boston fern', 12, {}, [saw('new-growth'), saw('looks-well')]).leads).toEqual([]);
    expect(run('Boston fern', 12, {}, [saw('wilting', 40)]).leads).toEqual([]);
  });

  it('a drying succulent is not treated as a problem', () => {
    const c = run('Echeveria', 12, {}, [saw('wilting')]);
    const soil = c.measured.find((m) => m.key === 'soil')!;
    if (soil.off === undefined) expect(c.leads.find((l) => l.with === 'soil')).toBeUndefined();
  });

  it('dry air and brown tips are linked through humidity and through VPD', () => {
    const c = run('Boston fern', 60, { humidity_pct: 22, temp_c: 27 }, [saw('browning')]);
    expect(c.leads.map((l) => l.with).sort()).toEqual(['air', 'humidity']);
  });

  it('no sensor: says so, and still accepts observations', () => {
    const c = checkup({ plant: makePlant('Monstera', { observations: [saw('leggy')] }), reading: null, now: NOW });
    expect(c.noSensor).toBe(true);
    expect(c.measured).toEqual([]);
    expect(c.unexplained).toEqual(['leggy']);
  });

  it('non-finite readings are skipped, not reported as NaN', () => {
    const c = checkup({ plant: makePlant('Monstera'), reading: reading(NOW, 40, { temp_c: NaN, humidity_pct: null, light_lux: Infinity }), now: NOW });
    expect(c.measured.map((m) => m.key)).toEqual(['soil']);
    expect(JSON.stringify(c)).not.toMatch(/NaN|Infinity/);
  });
});
