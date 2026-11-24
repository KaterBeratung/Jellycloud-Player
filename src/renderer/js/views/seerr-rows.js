// Reihen der Startseite aus Seerr (wie die Apple-App, Build 94): "Meine Anfragen" (die juengsten eigenen Anfragen mit ihrem Stand als Tag),
// "Merkliste" (die juengsten gemerkten Titel) und "Entdecken" (beliebte und kommende Filme und Serien; der Titel der beliebten fuehrt zur ganzen
// Liste mit Genre-Wahl, seerr-browse.js). Alle nur mit verbundenem Seerr und nur mit Titeln: bei einem Ausfall, einer abgelaufenen Anmeldung oder
// einer leeren Liste gibt es keine Reihe (wie "Filme im Trend"). Die Startseite wartet nicht darauf.
import { h } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { lazyImage, row } from '../ui.js';
import { mapImage } from '../api.js';
import { mediaTag } from '../tags.js';
import { openSeerrTitle } from '../seerr-open.js';
import { requestCard } from './request-card.js';
import { state } from '../state.js';

const HomeRows = window.JCHomeRows;
const Tags = window.JCMediaTags;
const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;

/**
 * Was die Reihen geladen haben, je Profil und Seerr-Sitzung und hoechstens TTL_MS alt (die Startseite baut sich oft neu auf, etwa nach jedem Film).
 * Nach einer Anfrage, einem Merken oder einem Wechsel von Seerr ist alles weg ('seerr-changed').
 */
const TTL_MS = 5 * 60 * 1000;
const memo = new Map(); // Kennung -> { key, at, list: Promise }
const memoKey = () => `${state.activeServerId}|${state.seerr?.url ?? ''}|${state.seerr?.userName ?? ''}`;
document.addEventListener('seerr-changed', () => memo.clear());
function remembered(id, load) {
  const key = memoKey();
  const m = memo.get(id);
  if (m && m.key === key && Date.now() - m.at < TTL_MS) return m.list;
  const entry = { key, at: Date.now(), list: load() };
  memo.set(id, entry);
  entry.list.catch(() => memo.get(id) === entry && memo.delete(id));
  return entry.list;
}

/** Die juengsten eigenen Anfragen mit Titel und Plakat (je Anfrage eine Abfrage, nebeneinander; ein Titel, der sich nicht laden laesst, bleibt ohne Bild). */
async function loadMyRequests() {
  const page = await window.jc.seerrRequests({ scope: 'mine', skip: 0, take: HomeRows.MY_REQUESTS_LIMIT });
  const list = (page?.requests ?? []).slice(0, HomeRows.MY_REQUESTS_LIMIT);
  const media = await Promise.all(list.map((r) => window.jc.seerrMedia({ mediaType: r.mediaType, tmdbId: r.tmdbId }).catch(() => null)));
  return list.map((req, i) => ({ req, media: media[i] }));
}

/** Plakat einer eigenen Anfrage: der Stand als Tag (wie im Reiter Anfragen), Titel und Jahr; ein Klick oeffnet den Titel (Mediathek oder seine Seite bei Seerr). */
function requestPoster({ req, media }, index) {
  const title = media?.title || t(`seerr.${req.mediaType}`);
  const posterPath = media?.posterPath && TMDB_PATH.test(media.posterPath) ? media.posterPath : null;
  const thumb = h(
    'div',
    { class: 'thumb', tabindex: '0', role: 'button', 'aria-label': t('seerr.detail.open', { title }) },
    lazyImage(posterPath ? { url: mapImage(`jellycloud://tmdb/w342${posterPath}`), hash: null } : null, { alt: '', fallback: title }),
    h('span', { class: 'req-status' }, mediaTag(Tags.seerrRequest(req, getLocale()), { short: true }))
  );
  const meta = h('div', { class: 'meta' }, h('div', { class: 'l1' }, title), h('div', { class: 'l2' }, [media?.year, t(`seerr.${req.mediaType}`)].filter(Boolean).join(' · ')));
  const el = h('div', { class: 'card poster req-card my-request', title }, thumb, meta);
  el.style.setProperty('--i', Math.min(index, 18));
  const open = () => openSeerrTitle({ mediaType: req.mediaType, tmdbId: req.tmdbId, known: media ?? undefined });
  thumb.addEventListener('click', open);
  meta.addEventListener('click', open);
  thumb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return el;
}

/** Titel und Laden je Reihe. */
const ROWS = {
  [HomeRows.MY_REQUESTS]: { title: () => t('home.myRequests'), load: loadMyRequests, render: requestPoster, href: () => '#/requests' },
  [HomeRows.WATCHLIST]: { title: () => t('home.seerrWatchlist'), load: () => window.jc.seerrWatchlist(), render: (r, i) => requestCard(r, i) },
  ...Object.fromEntries(
    HomeRows.DISCOVER_ROWS.map((id) => [
      id,
      {
        title: () => t(`home.${id}`),
        load: () => window.jc.seerrDiscover({ path: HomeRows.DISCOVER[id].path, page: 1 }).then((p) => p.titles.slice(0, 20)),
        render: (r, i) => requestCard(r, i),
        href: HomeRows.DISCOVER[id].browse ? () => `#/discover/${HomeRows.DISCOVER[id].mediaType}` : null
      }
    ])
  )
};

export const SEERR_HOME_ROWS = Object.keys(ROWS);

/** Ein unsichtbarer Platz fuer die Reihe, der sich fuellt, sobald Seerr antwortet (place: Reihe einsetzen oder Platz entfernen). */
export function seerrRowSlot(id) {
  return h('div', { class: 'seerr-row-slot', hidden: true, 'data-seerr-row': id });
}

/** Fuellt den Platz: Reihe mit Titeln, sonst verschwindet er. place(slot, section) setzt die Reihe an seine Stelle. */
export function fillSeerrRow(slot, id, { place, alive }) {
  const spec = ROWS[id];
  if (!spec) return slot.remove();
  remembered(id, spec.load)
    .then((list) => {
      if (!alive()) return;
      if (!Array.isArray(list) || !list.length) return slot.remove();
      const sec = row(spec.title(), list, { render: spec.render, href: spec.href ? spec.href() : null });
      sec.classList.add('seerr-row');
      place(slot, sec);
    })
    .catch(() => alive() && slot.remove());
}
