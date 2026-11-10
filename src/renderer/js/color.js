// Farbhelfer ohne Abhaengigkeiten (auch im Node-Test ladbar).

/** @param {[number, number, number]} rgb 0-255 @returns {[number, number, number]} h, s, l je 0-1 */
export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

/** @param {[number, number, number]} hsl je 0-1 @returns {[number, number, number]} rgb 0-255 */
export function hslToRgb([h, s, l]) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/**
 * Die Durchschnittsfarbe dunkler Bilder ist fast schwarz und taugt nicht als Hintergrundton.
 * Farbton behalten, Helligkeit auf die Mitte und die Saettigung auf einen tragfaehigen Wert heben. Fast graue Bilder bleiben neutral.
 */
export function vivid(rgb) {
  const [h, s] = rgbToHsl(rgb);
  const sat = s < 0.1 ? s : Math.min(0.7, Math.max(0.4, s * 1.2));
  return hslToRgb([h, sat, 0.5]);
}
