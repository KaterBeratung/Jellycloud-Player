import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { initialsOf, lazyImage } from '../ui.js';
import { navigate } from '../router.js';
import { mapImage } from '../api.js';

const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;
/** Bild von TMDB ueber das App-Protokoll (nur bekannte Groessen und harmlose Dateinamen, so wie der Hauptprozess sie annimmt). */
const tmdb = (size, file) => (typeof file === 'string' && TMDB_PATH.test(file) ? { url: mapImage(`jellycloud://tmdb/${size}${file}`), hash: null } : null);

let current = null;

/** Schliesst das offene Detailfenster, falls eines offen ist. */
export function closeRequestDetail() {
  current?.close();
}

/**
 * Detailfenster zu einem Titel aus der Seerr-Suche (Poster, Hintergrund, Beschreibung, Besetzung ...) mit der Schaltflaeche zum Anfragen.
 * Gezeigt wird sofort, was die Suche schon kennt; der Rest kommt per seerrDetails nach. Schliessen: Kreuz, Esc, Klick daneben, Seitenwechsel.
 *
 * @param {{ item: {mediaType:string, id:number, title:string, year:number|null, overview:string, posterPath:string|null, status:number},
 *           request: () => Promise<void>, onStatus?: () => void, returnTo?: HTMLElement|null }} o
 *   item: das Suchergebnis (wird von request() und beim Laden aktualisiert), request: stellt die Anfrage und meldet Erfolg oder Fehler selbst (Hinweise),
 *   onStatus: der Stand des Titels hat sich beim Laden geaendert (die Karte soll neu zeichnen), returnTo: Element, das beim Schliessen den Fokus bekommt
 */
export function openRequestDetail({ item, request, onStatus = null, returnTo = null }) {
  closeRequestDetail();
  const prevFocus = returnTo ?? document.activeElement;
  let alive = true;

  // Bis (oder falls) es ein Hintergrundbild gibt: das Poster stark verwischt als Stimmung im Kopf des Fensters
  const posterImage = tmdb('w342', item.posterPath);
  const hero = h('div', { class: 'rq-hero' }, posterImage ? lazyImage(posterImage, { alt: '', cls: 'rq-hero-img rq-hero-blur', eager: true }) : null);
  const closeBtn = h('button', { class: 'btn icon glass rq-close', type: 'button', title: t('seerr.detail.close'), 'aria-label': t('seerr.detail.close'), onclick: () => close() }, icon('x', 20));
  const poster = lazyImage(posterImage, { alt: '', cls: 'rq-poster', eager: true, fallback: item.title });
  const title = h('h2', { class: 'rq-title', id: 'rq-title' }, item.title);
  const original = h('p', { class: 'rq-original', hidden: true });
  const meta = h('div', { class: 'rq-meta' });
  const chips = h('div', { class: 'rq-chips' });
  const tagline = h('p', { class: 'rq-tagline', hidden: true });
  const overview = h('p', { class: 'rq-overview' }, item.overview || '');
  const facts = h('div', { class: 'rq-facts' });
  const actions = h('div', { class: 'rq-actions' });
  const note = h('p', { class: 'rq-note', hidden: true });
  const castBox = h('section', { class: 'rq-cast', hidden: true });
  const loading = h('div', { class: 'rq-loading', 'aria-hidden': 'true' }, h('span', { class: 'sk sk-line' }), h('span', { class: 'sk sk-line short' }));

  const main = h('div', { class: 'rq-main' }, title, original, meta, chips, tagline, overview, loading, facts, actions, note);
  const body = h('div', { class: 'rq-body' }, poster, main);
  // Das Kreuz liegt ausserhalb des scrollenden Teils, damit es beim Scrollen der Besetzung stehen bleibt
  const box = h('div', { class: 'rq', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rq-title' }, closeBtn, h('div', { class: 'rq-scroll' }, hero, body, castBox));
  const scrim = h('div', { class: 'rq-scrim' }, box);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });

  let details = null;
  const typeLabel = () => t(`seerr.${item.mediaType}`);

  function paintMeta() {
    const parts = [details?.year ?? item.year, typeLabel()].filter(Boolean).map(String);
    if (details?.runtime) parts.push(t('seerr.detail.min', { n: details.runtime }));
    if (details?.seasons) parts.push(details.seasons === 1 ? t('seerr.detail.season1') : t('seerr.detail.seasons', { n: details.seasons }));
    if (details?.episodes) parts.push(t('seerr.detail.episodes', { n: details.episodes }));
    meta.replaceChildren(...parts.map((p, i) => h('span', null, i ? ` · ${p}` : p)));
    if (details?.rating) meta.append(h('span', { class: 'rq-rating', title: t('seerr.detail.rating') }, `★ ${details.rating.toFixed(1)}`));
  }

  function paintActions() {
    const open = item.status <= 1 || item.status === 6;
    if (!open) {
      actions.replaceChildren(h('span', { class: `rq-status s${item.status}` }, t(`seerr.status.${item.status}`)));
      return;
    }
    const btn = h('button', { class: 'btn primary lg', type: 'button' }, icon('plus', 18), h('span', null, t('seerr.request')));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('loading');
      try {
        await request();
      } finally {
        if (alive) paintActions();
      }
    });
    actions.replaceChildren(btn);
  }

  function paintDetails() {
    const d = details;
    paintMeta();
    if (d.originalTitle) {
      original.textContent = `${t('seerr.detail.original')}: ${d.originalTitle}`;
      original.hidden = false;
    }
    chips.replaceChildren(...d.genres.map((g) => h('span', { class: 'rq-chip' }, g)));
    if (d.tagline) {
      tagline.textContent = d.tagline;
      tagline.hidden = false;
    }
    if (d.overview) overview.textContent = d.overview;
    const rows = [];
    if (d.directors.length) rows.push([item.mediaType === 'tv' ? t('seerr.detail.createdBy') : t('detail.director'), d.directors.join(', ')]);
    if (d.seriesStatus) rows.push([t('seerr.detail.state'), d.seriesStatus]);
    if (d.releaseDate) rows.push([t('seerr.detail.date'), new Date(`${d.releaseDate}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })]);
    facts.replaceChildren(...rows.map(([k, v]) => h('div', { class: 'rq-fact' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v))));
    const bd = tmdb('w780', d.backdropPath);
    // Das Hintergrundbild blendet sich ueber das verwischte Poster ein; laedt es nicht, bleibt das Poster als Stimmung stehen
    if (bd) hero.append(lazyImage(bd, { alt: '', cls: 'rq-hero-img rq-hero-bd', eager: true }));
    if (d.cast.length) {
      castBox.replaceChildren(
        h('h3', null, t('detail.cast')),
        h('div', { class: 'rq-cast-row' }, ...d.cast.map((c) => h('div', { class: 'rq-person', title: [c.name, c.character].filter(Boolean).join(' – ') }, lazyImage(tmdb('w185', c.profilePath), { alt: '', cls: 'rq-avatar', fallback: initialsOf(c.name) }), h('div', { class: 'n' }, c.name), c.character ? h('div', { class: 'c' }, c.character) : null)))
      );
      castBox.hidden = false;
    }
  }

  function focusables() {
    return [...box.querySelectorAll('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  function close() {
    if (!alive) return;
    alive = false;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), 160);
    if (current?.scrim === scrim) current = null;
    try {
      prevFocus?.focus?.({ preventScroll: true });
    } catch {
      /* Element schon weg */
    }
  }

  paintMeta();
  paintActions();
  document.body.append(scrim);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  current = { close, scrim };
  requestAnimationFrame(() => closeBtn.focus({ preventScroll: true }));

  window.jc
    .seerrDetails({ mediaType: item.mediaType, mediaId: item.id })
    .then((d) => {
      if (!alive) return;
      details = d;
      loading.remove();
      if (d.status && d.status !== item.status) {
        item.status = d.status;
        onStatus?.();
        paintActions();
      }
      paintDetails();
    })
    .catch((e) => {
      if (!alive) return;
      loading.remove();
      note.hidden = false;
      if (e?.code === 'SEERR_AUTH') {
        note.replaceChildren(t('seerr.authExpired'), ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => (close(), navigate('/settings/seerr')) }, t('toast.openSettings')));
      } else {
        note.textContent = t('seerr.detail.error', { msg: e?.message ?? '' });
      }
    });

  return { close };
}
