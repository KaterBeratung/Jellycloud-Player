import { h, icon } from '../dom.js';
import { t } from '../i18n.js';

/*
 * Gemeinsame Teile der Anmeldung (login.js) und der Maske "Quick Connect" fuer andere Geraete (quick-connect.js), wie in der Apple-App
 * (Features/Connect/ConnectParts.swift): Marke, Kopf der Karte und Ziffernkacheln stehen hier einmal und werden von beiden benutzt.
 */

const QC = window.JCQuickConnect; // Regeln des Codes (src/shared/quick-connect.js)

/** Steigt beim Erscheinen gestaffelt ein (Stufe i, je 80 ms; die Richtlinie erlaubt keine style-Attribute, daher ueber das CSSOM). */
export function rise(el, i) {
  el.classList.add('rise');
  el.style.setProperty('--i', String(i));
  return el;
}

/** Marke: Logo (atmet langsam, ruhig bei "Bewegung reduzieren"), Schriftzug wie in der Startanimation, ein Satz darunter. Steigt gestaffelt ein. */
export function connectBrand(subtitle) {
  return h(
    'div',
    { class: 'connect-brand' },
    rise(h('div', { class: 'connect-logo brand-mark' }, icon('cloud-logo', 132)), 0),
    rise(h('div', { class: 'connect-word', 'aria-hidden': 'true' }, 'JELLYCLOUD'), 1),
    rise(h('p', { class: 'connect-sub' }, subtitle), 2)
  );
}

/** Kopf der Quick-Connect-Karte: Symbol und Name. */
export function qcHeader(id = '') {
  return h('h2', { class: 'qc-head', ...(id ? { id } : {}) }, icon('qc', 22), h('span', null, t('qc.title')));
}

/**
 * Der Quick-Connect-Code in grossen Ziffernkacheln (42 x 54, Ziffern 30 fett). Bei der Anmeldung zeigt er den Code dieses Geraets; in der Maske
 * (entry) den, den man gerade eintippt: dann stehen immer sechs Kacheln da, die naechste freie ist bei Fokus umrandet, alle bei einem abgelehnten
 * Code in der Farbe der Fehler. Gibt { el, set({ code, focused, invalid }) } zurueck.
 */
export function qcDigits({ code = '', entry = false } = {}) {
  const count = entry ? QC.LENGTH : code.length;
  const tiles = Array.from({ length: count }, () => h('span', { class: 'qc-tile' }));
  const el = h('div', { class: `qc-digits${entry ? ' entry' : ''}`, ...(entry ? { 'aria-hidden': 'true' } : { role: 'img' }) }, tiles);
  const set = ({ code: c = '', focused = false, invalid = false } = {}) => {
    const digits = String(c).split('');
    tiles.forEach((tile, i) => {
      tile.textContent = digits[i] ?? '';
      tile.classList.toggle('next', entry && focused && !invalid && i === Math.min(digits.length, count - 1));
    });
    el.classList.toggle('invalid', invalid);
    if (!entry) el.setAttribute('aria-label', `Code ${digits.join(' ')}`);
  };
  set({ code });
  return { el, set };
}
