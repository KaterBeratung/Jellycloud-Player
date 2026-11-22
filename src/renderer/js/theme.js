/** Nur dunkle Designs wie in der Apple-App (Theme.swift); Midnight Blue ersetzt das helle Daylight (ein gespeichertes wird beim Laden umgestellt, config-core.js). */
export const THEMES = {
  midnight: { name: 'Midnight', bg: '#08080a', surface: '#202024', symbol: '#f5f5f7' },
  graphite: { name: 'Graphite', bg: '#131314', surface: '#232326', symbol: '#ececec' },
  amoled: { name: 'AMOLED', bg: '#000000', surface: '#111113', symbol: '#f2f2f2' },
  midnightBlue: { name: 'Midnight Blue', bg: '#0c1426', surface: '#1d2a40', symbol: '#f2f5fb' }
};

// Alle Regeln zur Akzentfarbe stehen im gemeinsamen Modul src/shared/accent.js (wird auch vom Player genutzt)
const Accent = window.JCAccent;

export const DEFAULT_ACCENT = Accent.DEFAULT_ACCENT;
/** Die acht Farbfelder der Apple-App ({ id, hex }); Namen in i18n unter accent.<id> */
export const SWATCHES = Accent.SWATCHES;
export const isHexColor = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s));

/** Wendet Erscheinungsbild-Einstellungen sofort auf das ganze Fenster an. Eckenradius (18 px, app.css) und Bewegung (motion.js) sind nicht einstellbar. */
export function applyAppearance(a) {
  const root = document.documentElement;
  const theme = THEMES[a.theme] ? a.theme : 'midnight';
  const c = Accent.resolveAccent(a.accent, { bg: THEMES[theme].bg });
  root.dataset.theme = theme;
  root.dataset.blur = a.blur ? 'on' : 'off';
  root.dataset.titles = a.cardTitles ? 'on' : 'off';
  root.style.setProperty('--accent', `rgb(${c.accent.join(' ')})`);
  root.style.setProperty('--accent-rgb', c.tint.join(' ')); // fuer durchscheinende Tonungen und Leuchten (bei hellen Akzenten abgedunkelt)
  root.style.setProperty('--accent-fg', `rgb(${c.fg.join(' ')})`);
  root.style.setProperty('--accent-ink', c.ink);
  root.style.setProperty('--poster-w', `${a.posterSize}px`);
  try {
    window.jc.setTitleBar({ color: '#00000000', symbolColor: THEMES[theme].symbol }).catch(() => {});
  } catch {
    /* Vorschau ohne Electron */
  }
}
