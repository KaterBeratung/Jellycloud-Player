// Linien-Icons im 24x24-Raster (Stil: Feather/Lucide-aehnlich). Alles Konstanten, daher als innerHTML sicher.
const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';

const paths = {
  play: `<path ${F} d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12-7.4a1 1 0 0 0 0-1.72l-12-7.4A1 1 0 0 0 7 4.6z"/>`,
  pause: `<g ${F}><rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/></g>`,
  back: `<path ${S} d="M15 5l-7 7 7 7"/>`,
  'chevron-left': `<path ${S} d="m15 18-6-6 6-6"/>`,
  'chevron-right': `<path ${S} d="m9 18 6-6-6-6"/>`,
  'chevron-down': `<path ${S} d="m6 9 6 6 6-6"/>`,
  'chevron-up': `<path ${S} d="m6 15 6-6 6 6"/>`,
  search: `<g ${S}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></g>`,
  settings: `<g ${S}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></g>`,
  home: `<g ${S}><path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.5 9.8V20h4.2v-5.6h4.6V20h4.2V9.8"/></g>`,
  film: `<g ${S}><rect x="3.5" y="4" width="17" height="16" rx="2.4"/><path d="M8 4v16M16 4v16M3.5 9h4.5M3.5 15h4.5M16 9h4.5M16 15h4.5"/></g>`,
  tv: `<g ${S}><rect x="3" y="5" width="18" height="12.5" rx="2.4"/><path d="M8 21h8M12 17.5V21"/></g>`,
  folder: `<path ${S} d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>`,
  music: `<g ${S}><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></g>`,
  heart: `<path ${S} d="M12 20.2s-7.5-4.6-7.5-10.3A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3z"/>`,
  'heart-fill': `<path ${F} d="M12 20.2s-7.5-4.6-7.5-10.3A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3z"/>`,
  check: `<path ${S} d="m5 12.5 4.6 4.6L19.5 7"/>`,
  'check-circle': `<g ${S}><circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.8 2.8L16.2 9.6"/></g>`,
  star: `<path ${F} d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/>`,
  plus: `<path ${S} d="M12 5v14M5 12h14"/>`,
  x: `<path ${S} d="M6 6l12 12M18 6 6 18"/>`,
  'win-min': `<path ${S} d="M6 12h12"/>`,
  'win-max': `<rect ${S} x="6.5" y="6.5" width="11" height="11" rx="1.5"/>`,
  more: `<g ${F}><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></g>`,
  volume: `<g ${S}><path d="M4 9.5v5h3.6L13 19V5L7.6 9.5z"/><path d="M16.2 8.8a4.6 4.6 0 0 1 0 6.4M18.8 6.2a8.2 8.2 0 0 1 0 11.6"/></g>`,
  'volume-low': `<g ${S}><path d="M4 9.5v5h3.6L13 19V5L7.6 9.5z"/><path d="M16.2 8.8a4.6 4.6 0 0 1 0 6.4"/></g>`,
  'volume-mute': `<g ${S}><path d="M4 9.5v5h3.6L13 19V5L7.6 9.5z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></g>`,
  subtitles: `<g ${S}><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11.5h3.2M13 11.5h4M7 15h5.4M15 15h2"/></g>`,
  audio: `<path ${S} d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10.5v3"/>`,
  fullscreen: `<path ${S} d="M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5"/>`,
  'fullscreen-exit': `<path ${S} d="M9.5 4v5.5H4M14.5 4v5.5H20M9.5 20v-5.5H4M14.5 20v-5.5H20"/>`,
  info: `<g ${S}><circle cx="12" cy="12" r="9"/><path d="M12 11v5.2M12 7.8h.01"/></g>`,
  // Warnschild (Dreieck mit Ausrufezeichen): "Problem melden"
  warning: `<g ${S}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9.5v4M12 17.2h.01"/></g>`,
  'skip-next': `<g><path ${F} d="M5.5 5.2v13.6a.9.9 0 0 0 1.4.75l9.6-6.8a.9.9 0 0 0 0-1.5L6.9 4.45a.9.9 0 0 0-1.4.75z"/><path ${S} d="M19 5v14"/></g>`,
  back10: `<g ${S}><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/></g><text x="12" y="15.2" font-size="6.8" font-weight="700" text-anchor="middle" ${F} font-family="Segoe UI,sans-serif">10</text>`,
  fwd10: `<g ${S}><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4.5v4h-4"/></g><text x="12" y="15.2" font-size="6.8" font-weight="700" text-anchor="middle" ${F} font-family="Segoe UI,sans-serif">10</text>`,
  speed: `<g ${S}><path d="M4.5 17a8 8 0 1 1 15 0"/><path d="m12 16 3.6-5.2"/></g>`,
  aspect: `<g ${S}><rect x="3" y="6" width="18" height="12" rx="2.4"/><path d="M7.5 10v4M16.5 10v4"/></g>`,
  list: `<path ${S} d="M8.5 6h12M8.5 12h12M8.5 18h12M4 6h.01M4 12h.01M4 18h.01"/>`,
  server: `<g ${S}><rect x="3" y="4" width="18" height="6.5" rx="2.2"/><rect x="3" y="13.5" width="18" height="6.5" rx="2.2"/><path d="M7 7.25h.01M7 16.75h.01"/></g>`,
  user: `<g ${S}><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.9-3.6 3.9-5.4 7.5-5.4s6.6 1.8 7.5 5.4"/></g>`,
  palette: `<g ${S}><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.9 1.5-2-.4-1.2.3-2.2 1.6-2.2H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7 16.8 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7.6" r="1" fill="currentColor"/><circle cx="15" cy="8" r="1" fill="currentColor"/></g>`,
  monitor: `<g ${S}><rect x="3" y="4" width="18" height="12.5" rx="2.4"/><path d="M8.5 20.5h7M12 16.5v4"/></g>`,
  refresh: `<g ${S}><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/></g>`,
  download: `<g ${S}><path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/></g>`,
  external: `<g ${S}><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></g>`,
  layers: `<g ${S}><path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/></g>`,
  trash: `<g ${S}><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/></g>`,
  logout: `<g ${S}><path d="M14 4.5h4.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/></g>`,
  link: `<g ${S}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></g>`,
  shield: `<g ${S}><path d="M12 3.2 5 6v5.6c0 4.4 3 8 7 9.4 4-1.4 7-5 7-9.4V6z"/><path d="m9 12 2.2 2.2L15.4 10"/></g>`,
  edit: `<g ${S}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 7 3 3"/></g>`,
  power: `<g ${S}><path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></g>`,
  stop: `<rect ${F} x="6.5" y="6.5" width="11" height="11" rx="2.2"/>`,
  // Logo: Wolke als Umriss mit Play-Symbol (gleiche Form wie das App-Icon, build/icon.png). Die Farbe kommt aus der Textfarbe (.brand-mark).
  'cloud-logo': `<g transform="translate(0 1.73) scale(0.046875)" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path d="M126 351H400A64 64 0 0 0 400 223A64 64 0 0 0 312 152A103 103 0 0 0 127 198A77 77 0 0 0 126 351Z" fill="none" stroke-width="34"/><path d="M231 193L231 271L299 232Z" fill="currentColor" stroke-width="18"/></g>`,
  sparkle:`<path ${F} d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9zM18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>`
};

export function iconSvg(name, size = 20) {
  const body = paths[name] ?? paths.info;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(paths);
