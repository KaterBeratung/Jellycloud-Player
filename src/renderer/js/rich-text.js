// Beschreibungen mit HTML (wie DescriptionText der Apple-App, Build 93): Jellyfin liefert Handlungen manchmal als HTML (Absaetze, Aufzaehlungen, fett,
// kursiv, Links, Entitaeten). Sie erscheinen formatiert statt mit sichtbaren Tags. Sicher: der Text wird in ein inertes Dokument gelesen (DOMParser,
// nichts laeuft, nichts laedt), uebernommen werden nur erlaubte Elemente und Text; Links nur mit http(s), sie oeffnen im Browser des Systems.
// Ohne HTML bleibt der Text, wie er ist. compact: Vorschauen (Folgenliste, Karten) ohne Leerzeilen und ohne Links, als ein Absatz.
import { h } from './dom.js';

const HTML_HINT = /<\/?(?:p|br|b|strong|i|em|u|ul|ol|li|a|div|span|h[1-6])\b[^>]*>|&(?:[a-z]+|#\d+|#x[\da-f]+);/i;
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const INLINE = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u' };

/** Sieht der Text nach HTML aus? */
export const looksLikeHtml = (text) => typeof text === 'string' && HTML_HINT.test(text);

function safeHref(href) {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Uebertraegt die Kinder von src nach out: erlaubte Elemente bleiben, alles andere wird zu seinem Text. */
function copy(src, out, compact) {
  for (const n of src.childNodes) {
    if (n.nodeType === 3) {
      out.append(n.nodeValue);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
    if (tag === 'BR') {
      out.append(compact ? ' ' : h('br'));
    } else if (INLINE[tag]) {
      const el = h(INLINE[tag]);
      copy(n, el, compact);
      out.append(el);
    } else if (tag === 'A') {
      const href = compact ? null : safeHref(n.getAttribute('href') ?? '');
      if (!href) {
        copy(n, out, compact);
        continue;
      }
      const a = h('a', { href, class: 'rich-link', rel: 'noopener noreferrer' });
      copy(n, a, compact);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.jc?.openExternal?.(href).catch?.(() => {});
      });
      out.append(a);
    } else if (tag === 'UL' || tag === 'OL') {
      if (compact) {
        for (const li of n.children) {
          out.append(' • ');
          copy(li, out, compact);
        }
        out.append(' ');
        continue;
      }
      const list = h(tag.toLowerCase());
      for (const li of n.children) {
        if (li.tagName !== 'LI') continue;
        const item = h('li');
        copy(li, item, compact);
        list.append(item);
      }
      out.append(list);
    } else if (BLOCKS.has(tag)) {
      if (compact) {
        copy(n, out, compact);
        out.append(' ');
        continue;
      }
      const p = h('p');
      copy(n, p, compact);
      if (p.textContent.trim() || p.querySelector('br')) out.append(p);
    } else {
      copy(n, out, compact); // unbekannte Elemente: nur ihr Inhalt
    }
  }
}

/**
 * Inhalt fuer einen Beschreibungsblock: Text ohne HTML unveraendert (ein Textknoten), sonst die erlaubten Elemente. Lose Textteile zwischen Bloecken
 * kommen in eigene Absaetze. @returns {DocumentFragment}
 */
export function richText(text, { compact = false } = {}) {
  const frag = document.createDocumentFragment();
  const s = String(text ?? '');
  if (!looksLikeHtml(s)) {
    frag.append(s);
    return frag;
  }
  const doc = new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html');
  if (compact) {
    const tmp = h('span');
    copy(doc.body, tmp, true);
    frag.append(tmp.textContent.replace(/\s+/g, ' ').trim());
    return frag;
  }
  const tmp = h('div');
  copy(doc.body, tmp, false);
  // Lose Zeilen (Text, fett, Links) zwischen den Absaetzen in eigene Absaetze fassen
  let loose = null;
  for (const n of [...tmp.childNodes]) {
    const block = n.nodeType === 1 && ['P', 'UL', 'OL'].includes(n.tagName);
    if (block) {
      loose = null;
      frag.append(n);
    } else {
      if (n.nodeType === 3 && !n.nodeValue.trim() && !loose) continue;
      if (!loose) frag.append((loose = h('p')));
      loose.append(n);
    }
  }
  return frag;
}
