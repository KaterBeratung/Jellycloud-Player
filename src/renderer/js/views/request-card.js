import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { lazyImage, toast } from '../ui.js';
import { navigate } from '../router.js';
import { openRequestDetail } from './request-detail.js';
import { mapImage } from '../api.js';

/** Zeichnet die Karte zu einem Titel neu (Stand geaendert, etwa durch eine Anfrage im Detailfenster). */
const repaint = new WeakMap();

/** Stellt die Anfrage zu einem Titel (Karte und Detailfenster nutzen dieselbe), meldet Erfolg und Fehler per Hinweis und aktualisiert die Karte. */
export async function requestOne(r) {
  try {
    const res = await window.jc.seerrRequest({ mediaType: r.mediaType, mediaId: r.id });
    r.status = res.mediaStatus ?? 2;
    repaint.get(r)?.();
    toast(t('seerr.requested', { title: r.title }));
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

  // Offen (unbekannt/geloescht): anfragen. Sonst nur der Stand als Beschriftung.
  const paint = () => {
    const open = r.status <= 1 || r.status === 6;
    actions.hidden = !open;
    chip.hidden = open;
    chip.className = `req-status s${r.status}`;
    chip.textContent = t(`seerr.status.${r.status}`);
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

  // Karte anklicken (Poster, Beschriftung, Stand) oeffnet die Details; per Tastatur ueber das Poster (Enter oder Leertaste)
  const openDetails = () => openRequestDetail({ item: r, request: () => requestOne(r), onStatus: paint, returnTo: thumb });
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
