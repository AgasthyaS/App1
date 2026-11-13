import type { ObservationKind } from './types';

/**
 * The things an owner can report seeing. Kept deliberately short and in plain
 * words: each is something a person can recognise without training, and none of
 * them is a diagnosis. "Yellowing" has a dozen causes; the app records the
 * yellowing and lets the sensor history beside it do the narrowing.
 */
export const OBSERVATION_LABEL: Record<ObservationKind, string> = {
  'new-growth': 'New growth',
  flowering: 'Flowering',
  'looks-well': 'Looks well',
  wilting: 'Wilting or drooping',
  yellowing: 'Leaves yellowing',
  browning: 'Brown tips or edges',
  'leaf-drop': 'Dropping leaves',
  leggy: 'Stretching, leggy',
  pests: 'Pests seen',
  mould: 'Mould or fungus',
  other: 'Something else',
};

export const OBSERVATION_ICON: Record<ObservationKind, string> = {
  'new-growth': 'leaf',
  flowering: 'flower',
  'looks-well': 'happy',
  wilting: 'trending-down',
  yellowing: 'color-fill',
  browning: 'flame',
  'leaf-drop': 'arrow-down-circle',
  leggy: 'resize',
  pests: 'bug',
  mould: 'cloudy',
  other: 'ellipsis-horizontal-circle',
};

/** Good news first, then concerns, in the order shown. */
export const OBSERVATION_ORDER: ObservationKind[] = [
  'looks-well', 'new-growth', 'flowering',
  'wilting', 'yellowing', 'browning', 'leaf-drop', 'leggy', 'pests', 'mould', 'other',
];

export const isConcern = (k: ObservationKind): boolean =>
  !(k === 'looks-well' || k === 'new-growth' || k === 'flowering');
