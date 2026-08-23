/**
 * Chart colour tokens.
 *
 * Both modes were validated against this app's actual chart surfaces
 * (#ffffff light, #141715 dark) with the data-viz validator:
 *
 *   light — lightness band PASS · chroma PASS · CVD adjacent worst ΔE 9.1 PASS ·
 *           normal-vision worst ΔE 19.6 PASS · contrast WARN on slots 3/4/5
 *   dark  — all six checks PASS
 *
 * The light-mode contrast WARN is why every chart in this app ships a legend
 * plus a table view (see ChartFrame) — that is the required relief, not a
 * nice-to-have. Do not reorder these slots: the ordering *is* the CVD-safety
 * mechanism. Re-run the validator before changing any hex.
 */

export const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/** Single-hue lime ramp for the practice heatmap. Ordinal checks PASS in both
 *  modes (light end 2.14:1 light / 2.52:1 dark, monotone L, ΔL ≥ 0.06). */
export const HEAT = {
  light: { empty: '#eef1ea', steps: ['#93c035', '#74a020', '#578015', '#3b5c0e'] },
  dark: { empty: '#21241f', steps: ['#3f6113', '#5c8318', '#86b52b', '#b6e352'] },
};

/** Brand accent for single-series charts, where identity is carried by the title. */
export const BRAND = { light: '#4d7c0f', dark: '#a3e635' };

export const CHROME = {
  light: { grid: '#e1e0d9', axis: '#c3c2b7', muted: '#898781', surface: '#ffffff' },
  dark: { grid: '#2c2c2a', axis: '#383835', muted: '#898781', surface: '#141715' },
};

export function chartTokens(isDark) {
  const mode = isDark ? 'dark' : 'light';
  return {
    mode,
    series: CATEGORICAL[mode],
    brand: BRAND[mode],
    heat: HEAT[mode],
    ...CHROME[mode],
  };
}
