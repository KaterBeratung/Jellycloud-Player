import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { lazyImage, toast } from '../ui.js';
import { navigate, invalidate } from '../router.js';
import { mapImage } from '../api.js';
import { seerrTitleTag } from '../tags.js';
import { openSeerrTitle } from '../seerr-open.js';
import { chooseSeasons } from './season-chooser.js';

const SeerrState = window.JCSeerrState; // Staende bei Seerr (src/shared/seerr-state.js): 6 gesperrt, 7 geloescht

/** Zeichnet die Karte zu einem Titel neu (Stand geaendert, etwa durch eine Anfrage). */
const repaint = new WeakMap();

/**
 * Stellt die Anfrage zu einem Titel (Karten der Suche, der Reihe "Filme im Trend" und das Banner), meldet Erfolg und Fehler per Hinweis und aktualisiert die
 * Karte. Bei Serien erst die Staffelauswahl (vorhandene und angefragte Staffeln nicht waehlbar); abgebrochen fragt nichts an. Nie 4K.
 */
export async function requestOne(r) {
  let seasons = null;
  if (r.mediaType === 'tv') {
    try {
      const d = await window.jc.seerrDetails({ mediaType: 'tv', mediaId: r.id });
      r.status = d.status;
      repaint.get(r)?.();
      if (!SeerrState.isRequestable(r.status) && !window.JCSeerrRequests.openSeasons(d.seasonList).length) return toast(t('seerr.alreadyRequested'));
      // Nennt Seerr keine Staffeln, die ganze Serie (sonst ginge die Auswahl leer auf)
      if (d.seasonList.length) {
        seasons = await chooseSeasons({ title: r.title, seasons: d.seasonList });
        if (!seasons) return; // abgebrochen
      }
    } catch (e) {
      if (e.code === 'SEERR_AUTH') return toast(t('seerr.authExpired'), { type: 'error', duration: 8000, action: { label: t('toast.openSettings'), run: () => navigate('/settings/seerr') } });
      return toast(t('seerr.error', { msg: e.message }), { type: 'error' });
    }
  }
  try {
    const res = await window.jc.seerrRequest({ mediaType: r.mediaType, mediaId: r.id, ...(seasons ? { seasons } : {}) });
    r.status = res.mediaStatus ?? 2;
    repaint.get(r)?.();
    toast(t('seerr.requested', { title: r.title }));
    // Startseite und Anfragen verwerfen ihren gemerkten Stand (die Karte selbst zeigt ihn schon)
    invalidate();
    document.dispatchEvent(new CustomEvent('seerr-changed'));
  } catch (e) {
    if (e.status === 409) {
      r.status = 2;
      repaint.get(r)?.();
      toast(t('seerr.alreadyRequested'));
    } else if (e.code === 'SEERR_AUTH') {
      toast(t('seerr.authExpired'), { type: 'error', duration: 8000, action: { label: t('toast.openSettings'), run: () => navigate('/settings/seerr') } });
    } else {
      toast(t('seerr.error', { msg: e.message }), { type: 'error' });
    }
  }
}

/**
 * Karte fuer einen Titel, der bei Seerr angefragt werden kann (Poster kommen ueber das App-Protokoll von TMDB). Ein Klick darauf oeffnet die Details.
 * Gebraucht in der Suche (Gruppe "Bei Seerr anfragen") und in der Reihe "Filme im Trend" auf der Startseite.
 */
export function requestCard(r, index) {
  const poster = r.posterPath && /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/.test(r.posterPath) ? { url: mapImage(`jellycloud://tmdb/w342${r.posterPath}`), hash: null } : null;
  const image = lazyImage(poster, { alt: '', fallback: r.title });
  const chip = h('span', { class: 'req-status', hidden: true });
  const thumb = h('div', { class: 'thumb' }, image, chip);
  const btn = h('button', { class: 'btn primary sm', type: 'button' }, icon('plus', 16), h('span', null, t('seerr.request')));
  const actions = h('div', { class: 'req-actions' }, btn);
  const meta = h('div', { class: 'meta' }, h('div', { class: 'l1' }, r.title), h('div', { class: 'l2' }, [r.year, t(`seerr.${r.mediaType}`)].filter(Boolean).join(' · ')));
  const el = h('div', { class: 'card poster req-card', title: r.title }, thumb, meta, actions);
  el.style.setProperty('--i', Math.min(index, 18));

  // Anfragbar (ohne Stand oder geloescht): anfragen. Angefragt bis verfuegbar: der Stand als Tag (Bezeichnung und Farbe aus seerr-state.js). Gesperrt: weder noch.
  const paint = () => {
    actions.hidden = !SeerrState.isRequestable(r.status);
    const tag = seerrTitleTag(r.status, { short: true });
    chip.replaceChildren(...(tag ? [tag] : []));
    chip.hidden = !tag;
  };
  paint();
  repaint.set(r, paint);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await requestOne(r);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  // Karte anklicken (Poster, Beschriftung, Stand) oeffnet den Titel (Mediathek oder seine Seite bei Seerr, seerr-open.js); per Tastatur ueber das Poster
  const openDetails = () => openSeerrTitle({ mediaType: r.mediaType, tmdbId: r.id, known: r });
  thumb.tabIndex = 0;
  thumb.setAttribute('role', 'button');
  thumb.setAttribute('aria-label', t('seerr.detail.open', { title: r.title }));
  thumb.addEventListener('click', openDetails);
  thumb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetails();
    }
  });
  meta.addEventListener('click', openDetails);
  return el;
}
