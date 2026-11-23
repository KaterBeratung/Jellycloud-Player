import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { posterOf, itemHref } from '../api.js';
import { lazyImage, row, titleOf } from '../ui.js';
import { cardTags } from '../tags.js';
import { state } from '../state.js';
import { markSharedElement } from '../router.js';
import { attachItemMenu } from '../actions.js';

const Rankings = window.JCRankings; // Masse und Texte der Top 10 (src/shared/rankings.js)
const Glow = window.JCGlow; // Farben von Rand und Schein (src/shared/glow.js: numeralAura)
const SVG = 'http://www.w3.org/2000/svg';
let uid = 0;

/** Die gezeichneten Reihen (schwach gehalten): sie nehmen eine geaenderte Glow-Farbe an, auch wenn die Startseite gerade im Speicher liegt. */
const liveRows = new Set();
document.addEventListener('glow-settings', () => {
  for (const ref of liveRows) {
    const el = ref.deref();
    if (!el) liveRows.delete(ref);
    else el._paintAura?.();
  }
});

function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  el.append(...kids.flat().filter(Boolean));
  return el;
}
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
/** Plakatbreite der uebrigen Reihen (Einstellung "Postergroesse", auf dem Handy kleiner): daraus alle Masse der Top-10-Karte. */
const baseWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--poster-w')) || 176;

/** Rand und Schein der Reihe: Glow-Einstellung ihres Bereichs ("Top 10 Filme" die der Filme, "Top 10 Serien" die der Serien), aus: der farblose Rand. */
const auraFor = (scope) => Glow.numeralAura(Glow.resolve(state.settings?.glow, scope)) ?? Glow.NUMERAL_PLAIN;

/**
 * Die Rangziffer (wie TopTenNumeral und TopTenNumeralAura der Apple-App): hoch, schmal, halbfett, deckend dunkel gefuellt; darunter ein Schein in zwei Lagen,
 * der der Kontur folgt (weit 6 %, eng 2,2 % der Schriftgroesse), und der Rand im Farbverlauf von oben links nach unten rechts (1 % der Schriftgroesse; die
 * Fuellung liegt darueber, vom Rand bleibt die aeussere Haelfte). Einmal gezeichnet (SVG), keine laufende Bewegung. Die Grundlinie liegt auf der Unterkante
 * des Plakats; die Flaeche reicht so weit ueber die Ziffer hinaus, dass der weite Schein ganz auslaeuft.
 */
/** Schrift der Ziffer (dieselbe in SVG und Canvas, siehe .t10-numeral text in app.css). */
const NUMERAL_FONT = '"Bahnschrift", "Roboto Condensed", "sans-serif-condensed", "Arial Narrow", sans-serif';

/**
 * Der Schein an der Kontur als Bild: die Form der Ziffer im Verlauf, weichgezeichnet in zwei Lagen, EINMAL in ein Canvas gezeichnet (wie die Apple-App,
 * Canvas abseits der Hauptschleife). Als SVG-Filter hielt der Browser je Ziffer zwei Zwischenflaechen in doppelter Groesse vor: gemessen rund 60 bis 85 MB
 * mehr Arbeitsspeicher fuer zwei Reihen; so ist es ein Bild je Karte.
 */
function glowCanvas(rank, m, aura, w, hgt) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.className = 't10-glow';
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(hgt * dpr);
  c.style.setProperty('width', `${w}px`);
  c.style.setProperty('height', `${hgt}px`);
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(dpr, dpr);
  g.font = `600 ${m.size}px ${NUMERAL_FONT}`;
  if ('fontStretch' in g) g.fontStretch = 'condensed';
  if ('letterSpacing' in g) g.letterSpacing = `${m.tracking(rank)}px`;
  const x = m.bleed;
  const y = m.bleed + m.posterH;
  const text = String(rank);
  const box = g.measureText(text);
  const grad = g.createLinearGradient(x - box.actualBoundingBoxLeft, y - box.actualBoundingBoxAscent, x + box.actualBoundingBoxRight, y + box.actualBoundingBoxDescent);
  grad.addColorStop(0, rgb(aura.tone));
  grad.addColorStop(1, rgb(aura.toneEnd));
  g.fillStyle = grad;
  g.strokeStyle = grad;
  g.lineJoin = 'round';
  for (const [radius, strength] of [[m.bloomRadius, 0.85], [m.glowRadius, 1]]) {
    g.save();
    g.globalAlpha = Math.min(1, aura.glow * strength);
    g.filter = `blur(${radius.toFixed(2)}px)`;
    g.lineWidth = radius;
    g.fillText(text, x, y);
    g.strokeText(text, x, y);
    g.restore();
  }
  c.style.setProperty('left', `${-m.bleed}px`);
  c.style.setProperty('top', `${-m.bleed}px`);
  return c;
}

function numeral(rank, m, aura) {
  const id = `t10n${++uid}`;
  const w = m.numeralWidth(rank) + m.overlap + 2 * m.bleed;
  const hgt = m.posterH + 2 * m.bleed;
  const text = (attrs) => svg('text', { x: m.bleed, y: m.bleed + m.posterH, 'font-size': m.size, 'letter-spacing': m.tracking(rank) || null, ...attrs }, String(rank));
  const grad = svg('linearGradient', { id: `${id}g`, x1: 0, y1: 0, x2: 1, y2: 1 }, svg('stop', { offset: 0, 'stop-color': rgb(aura.tone) }), svg('stop', { offset: 1, 'stop-color': rgb(aura.toneEnd) }));
  const el = svg(
    'svg',
    { class: 't10-numeral', width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', {}, grad),
    svg('g', { class: 't10-aura' }, text({ fill: 'none', stroke: `url(#${id}g)`, 'stroke-width': (2 * m.rim).toFixed(2), 'stroke-linejoin': 'round', opacity: aura.rim })),
    text({ class: 't10-fill', fill: '#060608' })
  );
  el.style.setProperty('left', `${-m.bleed}px`);
  el.style.setProperty('top', `${-m.bleed}px`);
  // Schein (Canvas) unter Rand und Fuellung (SVG); beide gehoeren zur Ziffer und werden zusammen ersetzt
  const box = h('div', { class: 't10-numeral-box', 'aria-hidden': 'true' });
  if (aura.glow > 0) box.append(glowCanvas(rank, m, aura, w, hgt));
  box.append(el);
  return box;
}

/** Der grosse Lichtschein hinter Ziffer und Plakat (TopTenNumeralHalo): Glockenabfall wie der Ambient Glow, die Farbe wandert ueber den Verlauf. */
function paintHalo(el, rank, m, aura) {
  if (!(aura.halo > 0)) {
    el.hidden = true;
    return;
  }
  const size = m.haloSize(rank);
  const stops = Glow.haloStops(aura).map((s) => `rgb(${s.rgb.join(' ')} / ${Math.round(s.alpha * 10000) / 10000}) ${Math.round(s.at * 10000) / 100}%`);
  el.hidden = false;
  el.style.setProperty('width', `${size.width}px`);
  el.style.setProperty('height', `${size.height}px`);
  el.style.setProperty('left', `${(m.numeralWidth(rank) - size.width) / 2}px`);
  el.style.setProperty('background', `radial-gradient(50% 50% at 50% 50%, ${stops.join(', ')})`);
}

/**
 * Eine Karte der Top 10 (TopTenCard): Ziffer, darueber das Plakat (es ueberdeckt die Ziffer seitlich und wirft seinen Schatten nach links), darunter Titel
 * und eine Zeile mit Jahr und Genre. Frueheren Karten liegen ueber spaeteren (der Schein einer Karte liegt unter dem Plakat der Karte davor). item null:
 * Platzhalter beim ersten Laden (gedaempfte Ziffer, leeres Plakat).
 */
function card(item, rank, { m, aura, index, onPlay }) {
  const placeholder = !item;
  const detail = item ? Rankings.detailLine(item) : '';
  const el = h(placeholder ? 'div' : 'a', placeholder ? { class: 'card t10-card ph', 'aria-hidden': 'true' } : { class: 'card t10-card', href: itemHref(item), draggable: 'false', title: titleOf(item), 'aria-label': t('top10.cardLabel', { rank, title: titleOf(item) }) + (detail ? `, ${detail}` : '') });
  el.style.setProperty('--i', Math.min(index, 10));
  el.style.setProperty('width', `${m.cardWidth(rank)}px`);
  el.style.setProperty('z-index', String(20 - index));
  const halo = h('div', { class: 't10-halo', 'aria-hidden': 'true' });
  const figure = h('div', { class: 't10-figure' });
  figure.style.setProperty('height', `${m.posterH}px`);
  const thumb = h('div', { class: placeholder ? 'thumb sk' : 'thumb' });
  thumb.style.setProperty('left', `${m.numeralWidth(rank) - m.overlap}px`);
  thumb.style.setProperty('width', `${m.posterW}px`);
  if (item) {
    thumb.append(lazyImage(posterOf(item, 420), { alt: '', fallback: titleOf(item) }));
    const tags = cardTags(item, { max: 2 });
    if (tags) thumb.append(tags);
    if (item.UserData?.Played && item.Type !== 'Series') thumb.append(h('span', { class: 'corner played' }, icon('check', 14)));
    if (item.Type !== 'Series') {
      thumb.append(
        h('button', { class: 'play-fab', type: 'button', 'aria-label': t('action.play'), onclick: (e) => (e.preventDefault(), e.stopPropagation(), onPlay?.(item)) }, icon('play', 22))
      );
    }
    el.addEventListener('click', () => markSharedElement(thumb));
    // Kontextmenue am Plakat, nicht an der ganzen Karte mit Ziffer (wie die Apple-App: das Plakat hebt sich); die Tastatur erreicht es an der Karte
    attachItemMenu(thumb, () => item);
    el.addEventListener('keydown', (e) => {
      if (e.target === el && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
        e.preventDefault();
        thumb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      }
    });
  }
  let numeralEl = numeral(rank, m, aura);
  figure.append(numeralEl, thumb);
  paintHalo(halo, rank, m, aura);
  const meta = h('div', { class: 'meta' }, h('div', { class: 'l1' }, item ? titleOf(item) : ' '), h('div', { class: 'l2' }, detail || ' '));
  meta.style.setProperty('margin-left', `${m.numeralWidth(rank) - m.overlap}px`);
  meta.style.setProperty('width', `${m.posterW}px`);
  el.append(halo, figure, meta);
  el._repaint = (next) => {
    const fresh = numeral(rank, m, next);
    numeralEl.replaceWith(fresh);
    numeralEl = fresh;
    paintHalo(halo, rank, m, next);
  };
  return el;
}

/**
 * Die Reihe "Top 10 Filme" bzw. "Top 10 Serien" (kind 'movies' | 'series'): unter dem Titel, woher die Rangfolge stammt. loading: Platzhalter mit zehn
 * Plaetzen (nur beim ersten Laden; die Reihe haelt so ihren Platz, nichts springt).
 */
export function topTenRow(kind, { items = [], caption = '', loading = false, onPlay } = {}) {
  const scope = kind === 'series' ? 'series' : 'movies';
  const m = Rankings.metrics(baseWidth());
  let aura = auraFor(scope);
  const list = loading ? Array.from({ length: Rankings.LIMIT }, () => null) : items.slice(0, Rankings.LIMIT);
  const cards = [];
  const sec = row(t(kind === 'series' ? 'top10.series' : 'top10.movies'), list, {
    sub: caption,
    render: (it, i) => {
      const c = card(it, i + 1, { m, aura, index: i, onPlay });
      cards.push(c);
      return c;
    }
  });
  sec.classList.add('top10-row');
  if (loading) sec.classList.add('loading');
  sec.dataset.kind = kind;
  sec._paintAura = () => {
    const next = auraFor(scope);
    if (JSON.stringify(next) === JSON.stringify(aura)) return;
    aura = next;
    for (const c of cards) c._repaint(aura);
  };
  liveRows.add(new WeakRef(sec));
  return sec;
}
