/* Gemeinsames Modul: aus der Akzentfarbe alle abgeleiteten Farben berechnen.
   Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCAccent) in Oberflaeche und Player, damit beide dieselben Regeln nutzen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCAccent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Standard: neutrales Silberweiss wie bei Apple TV (frueher Koenigsblau)
  const DEFAULT_ACCENT = '#f5f5f7';

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(rgb) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }

  const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  /**
   * @param {string} hex gewaehlte Akzentfarbe (#rrggbb); ungueltig = Standard
   * @param {{bg?: string|number[]}} opts Hintergrund, auf dem Text und Icons in Akzentfarbe stehen
   * @returns {{accent:number[], tint:number[], fg:number[], ink:string}}
   *   accent: die Farbe fuer Flaechen (Buttons, Navigation, Fortschritt)
   *   tint:   Farbe fuer durchscheinende Tonungen und Leuchten; bei hellen Akzenten abgedunkelt, damit weisse Schrift darauf lesbar bleibt
   *   fg:     Farbe fuer Text und Icons in Akzentfarbe (Kontrast zum Hintergrund mindestens 4,5:1)
   *   ink:    Schriftfarbe auf einer Akzentflaeche
   */
  function resolveAccent(hex, { bg = '#08080a' } = {}) {
    const bgRgb = Array.isArray(bg) ? bg : hexToRgb(bg) ?? [8, 8, 10];
    const lb = luminance(bgRgb);
    const light = lb > 0.5;
    let accent = hexToRgb(hex) ?? hexToRgb(DEFAULT_ACCENT);

    // Neutrale Akzente (Weiss, Grau, Schwarz) passen sich dem Theme an, sonst waeren Buttons auf gleichfarbigem Grund unsichtbar:
    // hell auf dunklen Themes, dunkel auf hellen.
    if (Math.max(...accent) - Math.min(...accent) < 16) {
      const l = luminance(accent);
      if (light && l > 0.4) accent = [29, 29, 31];
      else if (!light && l < 0.1) accent = [245, 245, 247];
    }

    const lum = luminance(accent);
    const tint = lum > 0.5 ? accent.map((v) => Math.round(v * 0.6)) : accent;

    const toward = light ? 0 : 255;
    let fg = null;
    for (let i = 0; i <= 20 && !fg; i++) {
      const c = accent.map((v) => Math.round(v + (toward - v) * (i / 20)));
      if (contrast(luminance(c), lb) >= 4.5) fg = c;
    }
    return { accent, tint, fg: fg ?? [toward, toward, toward], ink: lum > 0.42 ? '#12131a' : '#ffffff' };
  }

  return { DEFAULT_ACCENT, hexToRgb, luminance, contrast, resolveAccent };
});
