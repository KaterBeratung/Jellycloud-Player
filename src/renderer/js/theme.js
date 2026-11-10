export const THEMES = {
  midnight: { name: 'Midnight', bg: '#08080a', surface: '#202024', symbol: '#f5f5f7' },
  graphite: { name: 'Graphite', bg: '#131314', surface: '#232326', symbol: '#ececec' },
  amoled: { name: 'AMOLED', bg: '#000000', surface: '#111113', symbol: '#f2f2f2' },
  daylight: { name: 'Daylight', bg: '#f2f3f7', surface: '#ffffff', symbol: '#1b1d27' }
};

// Alle Regeln zur Akzentfarbe stehen im gemeinsamen Modul src/shared/accent.js (wird auch vom Player genutzt)
const Accent = window.JCAccent;

export const DEFAULT_ACCENT = Accent.DEFAULT_ACCENT;
export const ACCENTS = [DEFAULT_ACCENT, '#0b2dbf', '#3b6bff', '#7a5cff', '#19c3c3', '#35d07f', '#f5c518', '#ff8a1f', '#ff4d6d'];
export const isHexColor = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s));

/** Wendet Erscheinungsbild-Einstellungen sofort auf das ganze Fenster an. */
export function applyAppearance(a) {
  const root = document.documentElement;
  const theme = THEMES[a.theme] ? a.theme : 'midnight';
  const c = Accent.resolveAccent(a.accent, { bg: THEMES[theme].bg });
  root.dataset.theme = theme;
  root.dataset.anim = a.animations;
  root.dataset.blur = a.blur ? 'on' : 'off';
  root.dataset.titles = a.cardTitles ? 'on' : 'off';
  root.style.setProperty('--accent', `rgb(${c.accent.join(' ')})`);
  root.style.setProperty('--accent-rgb', c.tint.join(' ')); // fuer durchscheinende Tonungen und Leuchten (bei hellen Akzenten abgedunkelt)
  root.style.setProperty('--accent-fg', `rgb(${c.fg.join(' ')})`);
  root.style.setProperty('--accent-ink', c.ink);
  root.style.setProperty('--poster-w', `${a.posterSize}px`);
  root.style.setProperty('--radius', `${a.radius}px`);
  try {
    window.jc.setTitleBar({ color: '#00000000', symbolColor: THEMES[theme].symbol }).catch(() => {});
  } catch {
    /* Vorschau ohne Electron */
  }
}
