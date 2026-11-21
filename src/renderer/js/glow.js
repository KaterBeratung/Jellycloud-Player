// Ambient Glow zeichnen: eine feste Ebene hinter dem Inhalt (scrollt nicht mit) mit je einem Lichtschein vom oberen und unteren Rand.
// Regeln, Farben und die eine Lesestelle stehen in src/shared/glow.js (window.JCGlow); hier nur, welcher Bereich gerade gilt und wie hoch
// die Scheine sind. Jede Seite nennt ihren Bereich am eigenen Element (data-glow="home" | "movies" | ...); Seiten ohne Bereich (Detailseite,
// Player) zeigen keinen. Gezeichnet wird mit CSS-Verlaeufen ohne Unschaerfe und ohne laufende Bewegung; ein Wechsel blendet in 0,3 s.
//
// Startseite: von unten nur bis unter die Unterkante des Banners in Ruhelage (mindestens 160 px), von oben erst, wenn kein Banner da ist
// oder es ganz hinausgescrollt ist; der Banner selbst bleibt, wie er ist (beide liegen nie uebereinander).
import { state } from './state.js';

const Glow = window.JCGlow;
let layer = null;
let top = null;
let bottom = null;
let current = null; // Element der Seite, deren Bereich gilt
let heroObserver = null;
let resizeBound = false;

function ensureLayer() {
  if (layer?.isConnected) return;
  layer = document.createElement('div');
  layer.id = 'glow';
  layer.setAttribute('aria-hidden', 'true');
  top = document.createElement('i');
  top.className = 'glow-top';
  bottom = document.createElement('i');
  bottom.className = 'glow-bottom';
  layer.append(top, bottom);
  document.body.prepend(layer); // vor #app: liegt hinter dem Inhalt, ueber dem Seitengrund
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', () => layout());
  }
}

const compact = () => document.documentElement.dataset.compact === 'on';
const pageReach = () => (compact() ? 600 : 760); // Telefon 600, sonst 760 (Apple: iPhone 600, iPad und Mac 760)

/** Malt einen Schein (oder blendet ihn aus). */
function paint(el, style, edge) {
  const c = Glow.css(style, edge);
  if (!c) {
    el.classList.remove('on');
    return;
  }
  el.style.background = c.background;
  el.style.webkitMaskImage = c.mask;
  el.style.maskImage = c.mask;
  el.classList.add('on');
}

/** Hoehen der Scheine: 58 % der Fensterhoehe, hoechstens die Reichweite; auf der Startseite unten nur bis unter das Banner. */
function layout() {
  if (!layer) return;
  const h = window.innerHeight;
  const reach = Glow.edgeReach(h, pageReach());
  top.style.height = `${reach}px`;
  let low = reach;
  const hero = current?.dataset.glow === 'home' ? current.querySelector('.hero:not(.hero-empty)') : null;
  if (hero) {
    const scroller = current.closest('#view');
    const restBottom = hero.getBoundingClientRect().bottom + (scroller?.scrollTop ?? 0);
    low = Math.min(reach, Glow.homeReach(h, restBottom, pageReach()));
  }
  bottom.style.height = `${low}px`;
}

/** Startseite: der obere Schein zeigt sich erst ohne Banner oder wenn es ganz hinausgescrollt ist. */
function watchHero() {
  heroObserver?.disconnect();
  heroObserver = null;
  layer?.classList.remove('hero-visible');
  if (current?.dataset.glow !== 'home') return;
  const hero = current.querySelector('.hero:not(.hero-empty)');
  if (!hero) return;
  layer.classList.add('hero-visible');
  heroObserver = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    layer.classList.toggle('hero-visible', e.isIntersecting);
  });
  heroObserver.observe(hero);
}

/** Wendet den Bereich der sichtbaren Seite an (nach jedem Seitenwechsel, nach der Anmeldung, nach einer Aenderung der Einstellung). */
export function syncGlow(el) {
  ensureLayer();
  const before = current;
  current = el && el.dataset?.glow ? el : null;
  const scope = current?.dataset.glow ?? null;
  // Der Schein gehoert zur Seite: wechselt die Seite, wechselt er mit ihr, ohne nachzuglimmen (kein Ueberblenden unter der neuen Seite).
  // Weich (0,3 s) nur, wenn sich auf derselben Seite die Einstellung aendert. Ohne Uebergang: Klasse instant setzen, aendern, den Stil
  // sofort berechnen lassen (offsetHeight), Klasse wieder weg; so haengt es an keinem Animationsbild.
  const pageChange = before !== current;
  if (pageChange) layer.classList.add('instant');
  const style = scope ? Glow.resolve(state.settings?.glow, scope) : null;
  paint(top, style, 'top');
  paint(bottom, style, 'bottom');
  layer.dataset.scope = scope ?? '';
  layout();
  watchHero();
  if (pageChange) {
    void layer.offsetHeight;
    layer.classList.remove('instant');
  }
}

/** Nach einer Aenderung der Einstellung oder wenn sich auf der Seite etwas verschiebt (Banner geladen): neu anwenden. */
export function refreshGlow() {
  if (current && !current.isConnected) current = null;
  syncGlow(current);
}

/** Eine Vorschau (Einstellungen): zwei Scheine in einem kleinen Feld, mit einem Stil statt der gespeicherten Einstellung. */
export function paintPreview(box, style) {
  let t = box.querySelector('.glow-top');
  let b = box.querySelector('.glow-bottom');
  if (!t) {
    t = document.createElement('i');
    t.className = 'glow-top';
    b = document.createElement('i');
    b.className = 'glow-bottom';
    box.append(t, b);
  }
  paint(t, style, 'top');
  paint(b, style, 'bottom');
}
