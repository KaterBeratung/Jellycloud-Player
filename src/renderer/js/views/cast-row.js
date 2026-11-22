import { h } from '../dom.js';
import { t } from '../i18n.js';
import { mapImage, personImage } from '../api.js';
import { lazyImage, initialsOf } from '../ui.js';

const Person = window.JCPerson; // Ziele, Rollen und Besetzung (src/shared/person.js)

const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;
const tmdb = (size, file) => (typeof file === 'string' && TMDB_PATH.test(file) ? { url: mapImage(`jellycloud://tmdb/${size}${file}`), hash: null } : null);

/** Rollen in der Sprache der Oberflaeche: Figur oder Aufgabe ({ key } -> seerr.crew.<key>), mit Komma. */
export const roleText = (roles) => (roles ?? []).map((r) => (r.key ? t(`seerr.crew.${r.key}`) : r.text)).filter(Boolean).join(', ');

/** Was die Besetzung schon ueber eine Person weiss (Name, Bild), fuer ihre Seite, die gleich aufgeht (sie liest es einmal). */
const knownPeople = new Map();
export function takeKnownPerson(key) {
  const v = knownPeople.get(key) ?? null;
  knownPeople.delete(key);
  return v;
}

/**
 * Die Besetzungsreihe einer Detailseite (wie CastRow der Apple-App): eine Reihe fuer Titel der Mediathek und fuer Seerr-Titel. Jede Person mit Kennung ist ein
 * Verweis auf ihre Seite (#/person/...), mit Druck wie die Karten; ohne Kennung wird sie nur angezeigt.
 * @param {{name:string, roles:object[], route:object|null, person?:object, profilePath?:string|null}[]} entries Person.libraryCast bzw. Person.seerrCast
 * @returns {HTMLElement|null} ohne Personen null
 */
export function castRow(entries) {
  if (!entries?.length) return null;
  const list = h('div', { class: 'scroller people' });
  entries.forEach((e, i) => {
    const img = e.person ? personImage(e.person) : tmdb('w185', e.profilePath);
    const av = lazyImage(img, { cls: 'avatar' });
    // Initialen immer anlegen; sichtbar sind sie nur, wenn kein Bild da ist oder es nicht geladen werden kann (siehe .avatar .initial)
    av.append(h('span', { class: 'initial', 'aria-hidden': 'true' }, initialsOf(e.name)));
    const role = roleText(e.roles);
    const href = Person.href(e.route);
    const el = h(href ? 'a' : 'div', { class: 'person', ...(href ? { href, draggable: 'false', 'aria-label': role ? `${e.name}, ${role}` : e.name } : {}) }, av, h('div', { class: 'l1' }, e.name), role ? h('div', { class: 'l2' }, role) : null);
    if (href) el.addEventListener('click', () => knownPeople.set(Person.routeKey(e.route), { name: e.name, image: img }));
    el.style.setProperty('--i', Math.min(i, 14));
    list.append(el);
  });
  return h('section', { class: 'row cast-row' }, h('div', { class: 'row-head' }, h('h2', null, t('detail.cast'))), list);
}
