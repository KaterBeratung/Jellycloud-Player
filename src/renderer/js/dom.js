import { iconSvg } from './icons.js';

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Erzeugt DOM-Elemente. Texte werden nie als HTML interpretiert (Schutz vor Server-Metadaten mit Markup). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Icon als <span class="ico"> (SVG stammt ausschliesslich aus icons.js). */
export function icon(name, size = 20, cls = '') {
  const s = document.createElement('span');
  s.className = `ico ${cls}`.trim();
  s.innerHTML = iconSvg(name, size);
  return s;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function whenIdle(fn) {
  return (window.requestIdleCallback ?? ((f) => setTimeout(f, 1)))(fn);
}
