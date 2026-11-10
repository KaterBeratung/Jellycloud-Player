import { h } from './dom.js';

/**
 * Startanimation (wie bei Netflix): Beim Start der App zeichnet sich das Wolken-Logo, ein Lichtblitz folgt, der Schriftzug erscheint Buchstabe fuer Buchstabe,
 * dann faehrt die Kamera durch das Logo hindurch in die Oberflaeche. Gebaut aus Elementen und CSS-Animationen (css/app.css, Abschnitt "Startanimation"), ohne Bild- und Tondatei.
 *
 * Ablauf (bei Animationen "voll"; bei "reduziert" laeuft alles in 45 % der Zeit, ohne Zoom und Lichtblitz; bei "aus" gibt es nichts):
 *   0 bis 1,0 s   Umriss zeichnet sich    1,0 s   Dreieck springt auf, Blitz, Ring    1,0 bis 1,7 s   Schriftzug
 *   1,95 s        Zoom durch das Logo; die Oberflaeche blendet dahinter ein, der dunkle Grund verschwindet    2,7 s   fertig
 * Ein Klick oder eine Taste ueberspringt sie. Waehrend sie laeuft, ist die Oberflaeche unsichtbar (Klasse is-splash am Wurzelelement), Hinweise warten (afterSplash).
 * Die Zeiten hier muessen zu den Verzoegerungen im CSS passen.
 */

const TOTAL_MS = 2700; // so lange laeuft sie insgesamt
const REVEAL_MS = 1950; // ab hier blendet die Oberflaeche ein
const PREVIEW_IN_MS = 260; // Vorschau: der dunkle Grund blendet erst ein, dann verschwindet die Oberflaeche dahinter
const SKIP_MS = 260; // Ueberspringen: so lange dauert das Ausblenden
const WORD = 'Jellycloud';
const CLOUD = 'M126 351H400A64 64 0 0 0 400 223A64 64 0 0 0 312 152A103 103 0 0 0 127 198A77 77 0 0 0 126 351Z';
const PLAY = 'M231 193L231 271L299 232Z';

let active = null;
const waiting = [];

/** Laeuft gerade eine Startanimation (oder wartet sie darauf, dass das Fenster sichtbar wird)? */
export const splashActive = () => !!active;

/** Fuehrt fn aus, sobald keine Startanimation mehr laeuft (sofort, wenn keine laeuft). */
export function afterSplash(fn) {
  if (active) waiting.push(fn);
  else fn();
}

/** Soll beim Start eine Animation laufen? Schalter in den Einstellungen und Animationsstufe "aus" gelten. */
export const splashEnabled = (appearance) => appearance?.startAnimation !== false && appearance?.animations !== 'off';

/** Das Logo als SVG: derselbe Umriss und dasselbe Dreieck wie das Symbol "cloud-logo" (icons.js). Der Text stammt aus diesem Modul, nicht vom Server. */
function logoSvg(cls) {
  const wrap = document.createElement('span');
  wrap.innerHTML =
    `<svg class="${cls}" viewBox="17 81 480 300" aria-hidden="true" focusable="false">` +
    `<g fill="none" stroke="currentColor" stroke-width="34" stroke-linejoin="round" stroke-linecap="round">` +
    `<path class="sp-base" d="${CLOUD}"/><path class="sp-draw" pathLength="1" d="${CLOUD}"/></g>` +
    `<path class="sp-play" d="${PLAY}" fill="currentColor" stroke="currentColor" stroke-width="18" stroke-linejoin="round"/></svg>`;
  return wrap.firstElementChild;
}

/**
 * Spielt die Startanimation.
 * @param {{animations?:string}} appearance die Erscheinungs-Einstellungen (Animationsstufe)
 * @param {{preview?:boolean}} o preview: ueber der laufenden Oberflaeche (Vorschau in den Einstellungen), nicht beim Start
 * @returns {boolean} false, wenn schon eine laeuft oder die Animationen aus sind
 */
export function playSplash(appearance, { preview = false } = {}) {
  if (active || appearance?.animations === 'off') return false;
  const calm = appearance?.animations === 'reduced';
  const k = calm ? 0.45 : 1; // wie --dur im CSS
  const html = document.documentElement;
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  let el = null;
  let finished = false;
  const me = { skip: () => {} };
  active = me;

  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', me.skip, true);
    document.removeEventListener('visibilitychange', onVisible);
    el?.remove();
    html.classList.remove('is-splash', 'splash-reveal', 'splash-skip', 'splash-calm');
    active = null;
    for (const fn of waiting.splice(0)) {
      try {
        fn();
      } catch {
        /* ein Hinweis darf die Oberflaeche nicht stoeren */
      }
    }
  }

  function begin() {
    if (finished || el) return;
    el = h(
      'div',
      { id: 'splash', class: `${calm ? 'calm ' : ''}${preview ? 'preview' : ''}`.trim(), 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'sp-stage' },
        // Nur das Logo selbst (sp-zoom) zoomt am Ende; Glanz, Blitz und Ring (sp-fx) blenden vorher aus, denn hochskaliert waeren sie riesige, teure Flaechen
        h('div', { class: 'sp-logo' }, h('div', { class: 'sp-fx' }, h('div', { class: 'sp-bloom' }), h('div', { class: 'sp-ring' }), logoSvg('sp-glow'), h('div', { class: 'sp-streak' })), h('div', { class: 'sp-zoom' }, logoSvg('sp-mark'))),
        h(
          'div',
          { class: 'sp-word' },
          [...WORD].map((ch, i) => {
            const s = h('span', null, ch);
            s.style.setProperty('--i', i);
            return s;
          })
        )
      )
    );
    document.body.append(el);
    html.classList.toggle('splash-calm', calm);
    if (preview) later(PREVIEW_IN_MS * k, () => html.classList.add('is-splash'));
    else html.classList.add('is-splash');
    later(REVEAL_MS * k, () => html.classList.add('splash-reveal'));
    later(TOTAL_MS * k, finish);
    // Ueberspringen: Klick oder Taste. Der Grund blendet von seinem jetzigen Stand aus, die Oberflaeche kommt sofort.
    me.skip = () => {
      if (finished || el.classList.contains('skip')) return;
      el.style.setProperty('--sp-op', getComputedStyle(el).opacity);
      el.classList.add('skip');
      html.classList.add('is-splash', 'splash-reveal', 'splash-skip');
      timers.forEach(clearTimeout);
      later(SKIP_MS + 40, finish);
    };
    el.addEventListener('pointerdown', () => me.skip());
    document.addEventListener('keydown', me.skip, true);
  }

  // Ist das Fenster noch nicht zu sehen (minimierter Autostart), wartet die Animation, bis man es oeffnet; bis dahin bleibt die Oberflaeche unsichtbar, damit sie nicht vorher aufblitzt
  function onVisible() {
    if (document.visibilityState === 'visible') {
      document.removeEventListener('visibilitychange', onVisible);
      begin();
    }
  }
  if (!preview && document.visibilityState !== 'visible') {
    html.classList.add('is-splash');
    document.addEventListener('visibilitychange', onVisible);
  } else {
    begin();
  }
  return true;
}
