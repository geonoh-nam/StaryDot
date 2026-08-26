// The app's palette, in one place. A screen that invents its own blue is a screen that will
// drift out of step with the rest — reach for these first.
export const BG = '#08113D';
export const TEXT_ON_DARK = '#171d31';
export const TEXT_MUTED_ON_DARK = '#5b6b8c';
export const COLORS = {
  ink: '#171d31',
  muted: '#748198',
  blue: '#609EF5',
  blueDark: '#609EF5',
  blueSoft: '#edf4ff',
  sky: '#609EF5',
  pink: '#ffe4ef',
  pinkHot: '#f45aa2',
  yellow: '#fff0b8',
  purple: '#efe7ff',
  mint: '#dffaf2',
  line: '#dfe8f7',
  card: '#ffffff',
  stage: '#ffffff',
  dark: '#101828',
};

// Hex is what the palette speaks; maths needs channels.
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
