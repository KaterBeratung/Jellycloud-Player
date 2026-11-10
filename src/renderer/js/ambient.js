// Hintergrundton wie bei Apple TV: Die Seite nimmt dezent die Farbe des gezeigten Banners oder Titels auf.
// Die Farbe kommt aus dem Blurhash des Bildes (kein Netzwerkzugriff). Ansichten melden ihre Farbe an ihr eigenes Element;
// bei jedem Routenwechsel gilt die Farbe der gerade sichtbaren Ansicht (Ansichten ohne Farbe blenden den Ton aus).
// CSS: --tint (Farbe) und --tint-amt (Anteil) sind registrierte Eigenschaften und werden weich uebergeblendet, --page mischt beides in --bg.
import { blurhashColor } from './blurhash.js';
import { vivid } from './color.js';
import { state } from './state.js';

// Anteil der Farbe am Seitenhintergrund je Theme in Prozent: AMOLED bleibt fast schwarz, Daylight nur ein Hauch
const AMOUNT = { midnight: 13, graphite: 12, amoled: 7, daylight: 9 };

function paint(rgb) {
  const root = document.documentElement;
  const on = rgb && state.settings?.appearance?.ambient !== false;
  if (on) root.style.setProperty('--tint', `rgb(${vivid(rgb).join(' ')})`);
  root.style.setProperty('--tint-amt', on ? `${AMOUNT[root.dataset.theme] ?? 15}%` : '0%');
}

/** Merkt die Farbe fuer die Ansicht `el` und zeigt sie sofort, wenn die Ansicht gerade sichtbar ist. */
export function setAmbient(el, hash) {
  el._tint = blurhashColor(hash);
  if (el.isConnected) paint(el._tint);
}

/** Nach einem Routenwechsel: Farbe der sichtbaren Ansicht anwenden (ohne Farbe: ausblenden). */
export function syncAmbient(el) {
  paint(el?._tint ?? null);
}
