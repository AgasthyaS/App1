/** Minimal stand-in so pure-logic modules that touch `react-native` load under Node. */
export const Platform = { OS: 'web', select: <T,>(o: { web?: T; default?: T }) => o.web ?? o.default };
export const AppState = { addEventListener: () => ({ remove() {} }), currentState: 'active' };
export const Appearance = { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) };
export default { Platform, AppState, Appearance };
