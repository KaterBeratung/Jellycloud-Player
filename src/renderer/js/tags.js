// Tags zeichnen (Formate, Wiedergabe). Welche Tags ein Titel bekommt und ihre Farben stehen in src/shared/media-tags.js (window.JCMediaTags);
// hier nur die Darstellung, eine fuer alle Stellen: Karten, Banner, Detailseite (und spaeter der Player). Vorlage: MediaTagChip und
// MediaTagGlow der Apple-App (Design/MediaTagView.swift).
//
// Aufbau eines hervorgehobenen Tags (CSS .tag.hl in app.css): Flaeche aus den zwei Farben, auf feste Helligkeit gebracht (96 %), Tiefe
// (oben Weiss 6 %, unten Schwarz 12 %), Kontur 1 px aus den zwei Farben, Schrift in der aufgehellten Mitte. Der Schein ist ein fertiges Bild
// je Farbe, Groesse und Staerke, einmal mit einem Canvas gerechnet (zwei weiche Schatten der Kapsel, innen ausgespart, die zwei Farben quer
// darueber) und als border-image auf jede Breite gedehnt: keine Unschaerfe zur Laufzeit, keine Bewegung, gehoert nicht zum Layout.

const Tags = window.JCMediaTags;
const glowCache = new Map();

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${Math.round(a * 1000) / 1000})`;
};

/** Der Schein als Wert fuer border-image (mit Raendern, die beim Dehnen fest bleiben); einmal je Art, Groesse, Staerke und Pixeldichte. */
function glowImage(kind, sizeName, strength) {
  const dpr = Math.max(1, Math.min(3, Math.round((window.devicePixelRatio || 1) * 4) / 4));
  const key = `${kind}|${sizeName}|${strength}|${dpr}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const p = Tags.paint(kind);
  const { height, reach } = Tags.SIZES[sizeName];
  const stretch = 12; // dehnbares Mittelstueck
  const w = height + 2 * reach + stretch;
  const hgt = height + 2 * reach;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const capsule = (x, y, cw, ch) => {
    g.beginPath();
    g.roundRect(x, y, cw, ch, ch / 2);
  };
  // 1. Form des Scheins: zwei weiche Schatten der Kapsel, ein enger heller und ein weiter schwacher (Schattenunschaerfe in Bildpunkten)
  for (const [blur, alpha] of [[reach * 0.45, 1], [reach * 0.9, 0.75]]) {
    g.save();
    g.shadowColor = `rgb(255 255 255 / ${alpha})`;
    g.shadowBlur = blur * dpr;
    g.fillStyle = '#fff';
    capsule(reach, reach, w - 2 * reach, height);
    g.fill();
    g.restore();
  }
  // 2. Unter dem Tag selbst liegt nichts (nur ein halber Punkt unter seiner Kontur)
  g.globalCompositeOperation = 'destination-out';
  capsule(reach + 0.5, reach + 0.5, w - 2 * reach - 1, height - 1);
  g.fill();
  // 3. Die zwei Farben quer darueber, nur dort, wo Schein ist
  g.globalCompositeOperation = 'source-in';
  const grad = g.createLinearGradient(reach, 0, w - reach, 0);
  grad.addColorStop(0, rgba(p.glowStart, strength));
  grad.addColorStop(1, rgba(p.glowEnd, strength));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, hgt);
  const capV = hgt / 2 - 0.5;
  const capH = reach + height / 2;
  const value = {
    image: `url(${canvas.toDataURL('image/png')}) ${Math.round(capV * dpr)} ${Math.round(capH * dpr)} fill / ${capV}px ${capH}px stretch`,
    capV,
    capH,
    reach
  };
  glowCache.set(key, value);
  return value;
}

/**
 * Ein Tag. size: 'compact' (Karten, Banner, Player) | 'regular' (Detailseite); surface: 'image' (ueber Bildern) | 'dark' (Player) | 'page'
 * (auf der Seite, Wiedergabe-Tags dort ruhiger); short: Kurzform ("Atmos", "TrueHD").
 */
export function mediaTag(tag, { size = 'compact', surface = 'image', short = false } = {}) {
  const el = document.createElement('span');
  el.className = `tag ${size} on-${surface}${tag.highlighted ? ' hl' : ''}`;
  el.dataset.kind = tag.kind;
  el.textContent = short ? tag.short : tag.text;
  const p = tag.highlighted ? Tags.paint(tag.kind) : null;
  if (p) {
    const e = Tags.emphasis(tag.kind, surface);
    const glow = glowImage(tag.kind, size, Math.round(e.glow * 1000) / 1000);
    const s = el.style;
    s.setProperty('--fa', rgba(p.fillStart, Tags.STRENGTH.fillOpacity));
    s.setProperty('--fb', rgba(p.fillEnd, Tags.STRENGTH.fillOpacity));
    s.setProperty('--oa', rgba(p.outlineStart, e.outline));
    s.setProperty('--ob', rgba(p.outlineEnd, e.outline));
    s.setProperty('--ink', p.ink);
    s.setProperty('--glow', glow.image);
    s.setProperty('--capv', `${glow.capV}px`);
    s.setProperty('--caph', `${glow.capH}px`);
    s.setProperty('--reach', `${glow.reach}px`);
  }
  return el;
}

/**
 * Eine Reihe Tags in einer Zeile, gleicher Abstand. max: hoechstens so viele (Karten 2, Banner 3). fit: reicht die Zeile nicht, fallen die
 * hinteren weg (statt umzubrechen oder abgeschnitten zu werden); die Reihe prueft das bei jeder Groessenaenderung.
 * Gibt null zurueck, wenn es nichts zu zeigen gibt.
 */
export function mediaTagRow(tags, { size = 'compact', surface = 'image', short = false, max = Infinity, fit = false, cls = '' } = {}) {
  const list = (tags ?? []).slice(0, max);
  if (!list.length) return null;
  const row = document.createElement('div');
  row.className = `tags ${size} on-${surface}${cls ? ` ${cls}` : ''}`;
  for (const t of list) row.append(mediaTag(t, { size, surface, short }));
  if (fit) fitRow(row);
  return row;
}

/** Laesst hintere Tags weg, solange die Reihe breiter ist als ihr Platz. */
function fitRow(row) {
  const apply = () => {
    const kids = [...row.children];
    for (const k of kids) k.hidden = false;
    for (let i = kids.length - 1; i > 0 && row.scrollWidth > row.clientWidth + 0.5; i--) kids[i].hidden = true;
  };
  new ResizeObserver(apply).observe(row);
}

/** Karten-Tags eines Eintrags (4K, HDR, Premium-Ton, HD; hoechstens max). */
export function cardTags(item, { max = 2, surface = 'image' } = {}) {
  return mediaTagRow(Tags.card(Tags.streamsOfItem(item)), { size: 'compact', surface, short: true, max });
}
