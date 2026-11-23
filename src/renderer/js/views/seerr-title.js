import { h, icon, $ } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { state, updateSettings } from '../state.js';
import { api, mapImage } from '../api.js';
import { infoBlock, lazyImage, pageStatus, showPageStatus, row } from '../ui.js';
import { seerrTitleTag } from '../tags.js';
import { invalidate } from '../router.js';
import { playItem, resolveSeriesTarget } from '../actions.js';
import { createTrailer } from '../trailer.js';
import { seerrState, runSeerrCheck } from '../connection.js';
import { takeKnownTitle } from '../seerr-open.js';
import { requestCard } from './request-card.js';
import { chooseSeasons } from './season-chooser.js';
import { castRow } from './cast-row.js';

const SeerrState = window.JCSeerrState; // Staende und Rechte (src/shared/seerr-state.js)
const Requests = window.JCSeerrRequests; // was sich noch anfragen laesst, Kontingent (src/shared/seerr-requests.js)
const Facts = window.JCSeerrFacts; // Freigabe, Angabenzeile, Informationsblock (src/shared/seerr-facts.js)
const Format = window.JCFormat;

const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;
const tmdb = (size, file) => (typeof file === 'string' && TMDB_PATH.test(file) ? { url: mapImage(`jellycloud://tmdb/${size}${file}`), hash: null } : null);
/** Land des Geraets fuer die Freigabe ("de-DE" -> "DE"; nur die Sprache: das Land dazu). */
const regionOf = () => {
  const loc = String(state.locale || navigator.language || 'de-DE');
  const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})/.exec(loc);
  return (m ? m[1] : loc.slice(0, 2)).toUpperCase();
};

/**
 * Seite eines Seerr-Titels (wie SeerrDetailSheet der Apple-App): im Verlauf wie die Detailseite der Mediathek und in ihrer Reihenfolge: Bildkopf, Titel,
 * Angabenzeile (Jahr, Freigabe, Laufzeit, Staffeln, Bewertung), Stand als Tag, Knoepfe, Handlung und Genres, Staffeln, Besetzung, weitere Titel (Filmreihe,
 * Empfohlen, Aehnliche Titel), Informationen. Kein Dialogfenster mehr.
 * - Hauptknopf: "Abspielen", wenn der Titel in der Mediathek liegt (bei Serien die naechste Folge), sonst die Anfrage; eine Anfrage neben "Abspielen" (weitere
 *   Staffeln) ist ergaenzend. Nur allgemeine Anfragen, nie 4K. Ohne Recht keine Anfrage, sondern der Grund; das Kontingent steht vorher da, erschoepft ist
 *   der Knopf gesperrt.
 * - Serien: Staffelauswahl (vorhandene und angefragte nicht waehlbar). Ein zweiter Klick waehrend einer Anfrage zaehlt nicht; bleibt die Antwort aus, wird
 *   zuerst der Stand bei Seerr gelesen statt erneut zu senden. Danach Startseite, Suche und Anfragen neu.
 */
export function seerrTitleView({ type, id }) {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id);
  const movie = mediaType === 'movie';
  const el = h('div', { class: 'page detail seerr-page' });
  const bd = h('div', { class: 'detail-bd' });
  const body = h('div', { class: 'detail-body' });
  el.append(bd, body);

  let known = takeKnownTitle(mediaType, tmdbId); // was die Karte schon wusste: sofort zeigen
  let details = null;
  let detailsError = null;
  let status = Number(known?.status) || 0;
  let quota = null;
  let libraryItem = null;
  let playTarget = null; // { episode, resume } bzw. der Film
  let busy = false;
  let error = '';
  let destroyed = false;
  let trailerCtl = null;

  const scroller = () => $('#view');
  const onScroll = () => {
    const y = scroller()?.scrollTop ?? 0;
    if (y < 1400) bd.style.setProperty('--sy', y);
  };
  scroller()?.addEventListener('scroll', onScroll, { passive: true });

  const shown = () => details ?? known;
  const titleText = () => shown()?.title ?? '';
  const user = () => (seerrState() === 'connected' ? state.connection?.seerr?.user ?? null : null);
  const perms = () => user()?.permissions ?? 0;
  const seasonList = () => (movie ? [] : details?.seasonList ?? null);
  const canRequestMore = () => !!user() && Requests.canRequestMore({ mediaType, status, seasonList: seasonList(), permissions: perms() });
  const quotaOfKind = () => (movie ? quota?.movie : quota?.tv) ?? null;
  const quotaGone = () => Requests.quotaExhausted(quotaOfKind());
  const seasonsPending = () => !movie && !details;
  const playable = () => SeerrState.isPresent(status) && !!playTarget;

  // ---------- Kopf ----------
  const poster = h('div', { class: 'detail-poster-host' });
  const title = h('h1', { class: 'detail-title' });
  const tagline = h('p', { class: 'tagline', hidden: true });
  const meta = h('div', { class: 'detail-meta' });
  const tagHost = h('div', { class: 'detail-tags' });
  const actions = h('div', { class: 'detail-actions' });
  const note = h('p', { class: 'seerr-page-note', role: 'status', hidden: true });
  const overview = h('p', { class: 'overview clamp' });
  const more = h('button', { class: 'link-btn', type: 'button', hidden: true }, t('action.more'));
  more.addEventListener('click', () => {
    const open = overview.classList.toggle('clamp');
    more.textContent = open ? t('action.more') : t('action.less');
  });
  const genres = h('p', { class: 'seerr-genres', hidden: true });
  const info = h('div', { class: 'detail-info' }, title, tagline, meta, tagHost, actions, note, overview, more, genres);
  const head = h('section', { class: 'detail-head' }, poster, info);
  const sections = h('div', { class: 'seerr-sections' });

  function paintHead() {
    const s = shown();
    if (!s) return;
    title.textContent = s.title;
    poster.replaceChildren(lazyImage(tmdb('w500', s.posterPath), { cls: 'detail-poster', eager: true, fallback: s.title }));
    const back = tmdb('w1280', s.backdropPath);
    if (back && !bd.querySelector('.detail-bd-img')) bd.prepend(lazyImage(back, { cls: 'detail-bd-img', eager: true }));
    if (!bd.querySelector('.detail-bd-shade')) bd.append(h('div', { class: 'detail-bd-shade' }));
    tagline.textContent = details?.tagline ?? '';
    tagline.hidden = !details?.tagline;
    meta.replaceChildren(...Facts.metaParts({ ...s, facts: details?.facts, runtime: details?.runtime, seasons: details?.seasons }, { lang: getLocale(), region: regionOf() }).map((p) => h('span', null, p)));
    if (Format.score(s.rating)) meta.append(h('span', { class: 'score' }, icon('star', 14), Format.score(s.rating)));
    const text = details?.overview || s.overview || '';
    overview.textContent = text;
    overview.hidden = !text;
    requestAnimationFrame(() => (more.hidden = !(overview.scrollHeight > overview.clientHeight + 2)));
    genres.textContent = (details?.genres ?? []).join(', ');
    genres.hidden = !details?.genres?.length;
    paintActions();
  }

  /** "Abspielen" wie auf der Detailseite der Mediathek (Format.playLabel, PlayAction der Apple-App): eine angefangene Serie "S1 E3 Fortsetzen ab 12:40". */
  function playButton() {
    const target = libraryItem?.Type === 'Series' ? playTarget?.episode ?? null : libraryItem;
    return h('button', { class: 'btn primary xl', type: 'button', 'data-action': 'play', disabled: !target, onclick: () => target && playItem({ itemId: target.Id, resume: true }) }, icon('play', 22), h('span', null, Format.playLabel(target, libraryItem, getLocale())));
  }

  function requestButton(primary) {
    const kind = Requests.requestKind({ mediaType, status, seasonList: seasonList() });
    const b = h('button', { class: `btn ${primary ? 'primary xl' : 'glass lg'} seerr-request${busy ? ' loading' : ''}`, type: 'button' }, icon('plus', 20), h('span', null, t(`seerr.page.request.${kind}`)));
    b.disabled = busy || quotaGone() || seasonsPending();
    b.addEventListener('click', () => startRequest());
    return b;
  }

  /** Knoepfe, Stand und Hinweis nach dem tatsaechlichen Stand. */
  function paintActions() {
    const tag = seerrTitleTag(status, { request: details?.latestRequest ?? null, size: 'regular', surface: 'page' });
    tagHost.replaceChildren(...(tag && !(status === SeerrState.SEERR_MEDIA.AVAILABLE && playable()) ? [h('div', { class: 'tags regular on-page' }, tag)] : []));
    const list = [];
    if (playable()) list.push(playButton());
    if (canRequestMore()) list.push(requestButton(!playable()));
    // Seerr eingerichtet, Benutzer aber (noch) nicht bestaetigt: den Stand sagen statt still keine Anfrage anzubieten
    const s = seerrState();
    if (state.seerr && s !== 'connected') {
      const check = s === 'checking';
      list.push(h('div', { class: 'seerr-page-check' }, check ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, h('span', null, check ? t('seerr.page.checking') : `Seerr: ${t(`conn.${s === 'none' ? 'checking' : s}`)}`), check ? null : h('button', { class: 'btn glass sm', type: 'button', onclick: () => runSeerrCheck() }, t('seerr.recheck'))));
    }
    actions.replaceChildren(...list);
    actions.hidden = !list.length;
    const n = requestNote();
    note.textContent = n;
    note.hidden = !n;
  }

  /** Hinweis unter den Knoepfen: Fehler, gesperrt, fehlendes Recht, Kontingent. */
  function requestNote() {
    if (error) return error;
    if (SeerrState.isBlocklisted(status)) return t('seerr.page.blocked');
    // Ohne Recht: der Grund, sobald es noch etwas anzufragen gaebe (auch offene Staffeln einer teilweise vorhandenen Serie; sonst stand dort nichts)
    const somethingOpen = SeerrState.isRequestable(status) || Requests.openSeasons(seasonList() ?? []).length > 0;
    if (user() && somethingOpen && !SeerrState.isBlocklisted(status) && !SeerrState.canRequest(perms(), movie)) return t(movie ? 'seerr.page.noRightMovie' : 'seerr.page.noRightTv');
    const q = quotaOfKind();
    if (q?.limit && q.remaining !== null && canRequestMore()) {
      const days = q.days ? t('seerr.page.quotaDays', { n: q.days }) : '';
      return q.remaining <= 0 ? t('seerr.page.quotaGone', { limit: q.limit, days }) : t('seerr.page.quotaLeft', { left: q.remaining, limit: q.limit, days });
    }
    return '';
  }

  // ---------- Abschnitte unter dem Kopf ----------
  function paintSections() {
    if (!details) return;
    const parts = [];
    if (!movie && details.seasonList.length) {
      const rows = details.seasonList.map((s) => {
        const tag = seerrTitleTag(s.status, { surface: 'page' });
        const sub = [s.episodes ? t(s.episodes === 1 ? 'seerr.season.oneEpisode' : 'seerr.season.episodes', { n: s.episodes }) : '', s.airDate ? s.airDate.slice(0, 4) : ''].filter(Boolean).join(' · ');
        return h('div', { class: 'seerr-season' }, h('span', { class: 'seerr-season-name' }, s.name), h('span', { class: 'seerr-season-sub' }, sub), h('span', { class: 'grow' }), tag);
      });
      parts.push(h('section', { class: 'seerr-seasons' }, h('h2', null, t('seerr.page.seasons')), h('div', { class: 'seerr-season-list' }, rows)));
    }
    // Besetzung wie auf der Detailseite (dieselbe Reihe): vorn Regie bzw. die Schoepfer und Drehbuch, dann die Darsteller mit Rolle, hinten Produktion und Musik;
    // jede Person mit Nummer fuehrt auf ihre Seite
    const cast = castRow(window.JCPerson.seerrCast(details));
    if (cast) parts.push(cast);
    parts.push(relatedHost);
    const groups = Facts.informationGroups(details, { imdb: extras.imdb, lang: getLocale(), region: regionOf() });
    if (groups.length) parts.push(infoBlock(t('detail.information'), groups));
    sections.replaceChildren(...parts);
  }

  // Weitere Titel: Filmreihe, Empfohlen, Aehnliche Titel (je mit Stand; eine Karte oeffnet die Mediathek oder die Seite bei Seerr)
  const relatedHost = h('div', { class: 'seerr-related' });
  const extras = { recommended: [], similar: [], collection: [], imdb: null };
  function paintRelated() {
    const rowOf = (titleText, list) => (list.length ? row(titleText, list, { render: (r, i) => requestCard(r, i) }) : null);
    relatedHost.replaceChildren(...[rowOf(details?.collection?.name ?? t('seerr.page.collection'), extras.collection), rowOf(t('seerr.page.recommended'), extras.recommended), rowOf(t('detail.similar'), extras.similar)].filter(Boolean));
  }

  // ---------- Laden ----------
  async function loadDetails() {
    try {
      const d = await window.jc.seerrDetails({ mediaType, mediaId: tmdbId });
      if (destroyed) return;
      details = d;
      detailsError = null;
      status = d.status;
    } catch (e) {
      if (destroyed || e.code === 'SEERR_STALE') return;
      detailsError = e;
    }
  }

  /** Was unter der Besetzung steht, nebeneinander und zusammen gesetzt (die Seite ordnet sich darunter einmal). Scheitert eine Abfrage, bleibt die Reihe weg. */
  async function loadExtras() {
    if (!details) return;
    const [r, s, c, i] = await Promise.all([
      window.jc.seerrRelated({ mediaType, tmdbId, kind: 'recommendations' }).catch(() => null),
      window.jc.seerrRelated({ mediaType, tmdbId, kind: 'similar' }).catch(() => null),
      details.collection ? window.jc.seerrCollection(details.collection.id).catch(() => null) : [],
      movie ? window.jc.seerrImdb(tmdbId).catch(() => null) : null
    ]);
    if (destroyed) return;
    if (r) extras.recommended = r;
    if (s) extras.similar = s;
    if (c) extras.collection = c.filter((x) => x.id !== tmdbId);
    extras.imdb = i ?? null;
    paintRelated();
    paintSections();
  }

  async function loadQuota() {
    if (!user()) return;
    try {
      quota = await window.jc.seerrQuota();
    } catch {
      quota = null;
    }
    if (!destroyed) paintActions();
  }

  /** Der Titel in der Mediathek (Abgleich ueber die TMDB-Nummer) und was "Abspielen" startet (Serie: die naechste Folge). */
  async function findLibraryItem() {
    const res = await api.getItems({ anyProviderIdEquals: `tmdb.${tmdbId}`, includeItemTypes: movie ? 'Movie' : 'Series', recursive: true, limit: 1 }).catch(() => null);
    const item = res?.Items?.[0];
    if (!item || destroyed) return;
    libraryItem = item;
    playTarget = item.Type === 'Series' ? await resolveSeriesTarget(item.Id).catch(() => null) : { episode: item, resume: true };
    if (playTarget && item.Type === 'Series' && !playTarget.episode) playTarget = null;
    if (!destroyed) paintActions();
  }

  function startTrailer() {
    const key = details?.trailerKey;
    const tr = state.settings.trailer ?? {};
    if (trailerCtl || !key || !tr.autoplay) return;
    trailerCtl = createTrailer({ host: bd, videoId: key, muted: tr.muted !== false, delaySec: tr.delaySec, quality: tr.quality, focusSec: tr.focusSec, focusStyle: tr.focusStyle, volume: tr.volume, onVolume: (v) => updateSettings({ trailer: { volume: v } }).catch(() => {}) });
  }

  // ---------- Anfragen ----------
  async function startRequest() {
    if (busy || seasonsPending() || quotaGone() || !canRequestMore()) return; // ein zweiter Klick waehrend der Anfrage fragt nicht doppelt an
    if (movie || !details.seasonList.length) return request(null); // nennt Seerr keine Staffeln: die ganze Serie
    const chosen = await chooseSeasons({ title: titleText(), seasons: details.seasonList });
    if (chosen && !destroyed) request(chosen);
  }

  /** Stellt die Anfrage. Bleibt die Antwort aus (Frist, Netz), wird zuerst der Stand bei Seerr gelesen statt erneut zu senden. */
  async function request(seasons) {
    if (busy) return;
    busy = true;
    error = '';
    paintActions();
    const before = status;
    try {
      const r = await window.jc.seerrRequest({ mediaType, mediaId: tmdbId, ...(seasons ? { seasons } : {}) });
      status = r?.mediaStatus ?? SeerrState.SEERR_MEDIA.PENDING;
      await refreshAfterRequest();
    } catch (e) {
      if (e.code === 'SEERR_AUTH') {
        error = t('seerr.authExpired');
        runSeerrCheck();
      } else if (e.status === 403) {
        error = quotaGone() ? t('seerr.page.quotaGoneShort') : t('seerr.page.denied');
        await refreshAfterRequest();
      } else if (e.status === 409) {
        error = t('seerr.page.already');
        await refreshAfterRequest();
      } else {
        await refreshAfterRequest();
        error = Requests.arrived({ seasons, seasonList: details?.seasonList, before, status }) ? '' : t('seerr.page.unsure', { msg: e.message });
      }
    } finally {
      busy = false;
      if (!destroyed) {
        paintHead();
        paintSections();
      }
    }
  }

  /** Nach einer Anfrage: Stand, Staffeln und Kontingent neu; Startseite, Suche und Anfragen verwerfen ihren gemerkten Stand. */
  async function refreshAfterRequest() {
    await loadDetails();
    await loadQuota();
    invalidate();
    document.dispatchEvent(new CustomEvent('seerr-changed'));
  }

  const onConnection = () => {
    if (destroyed) return;
    paintActions();
    if (user() && !quota) loadQuota();
  };
  document.addEventListener('connection-state', onConnection);

  async function load() {
    if (!state.seerr) {
      showPageStatus(el, pageStatus({ kind: 'action', symbol: 'tray', title: t('req.noSeerrTitle'), text: t('req.noSeerrText'), action: { label: t('req.connect'), href: '#/settings/seerr' } }));
      return;
    }
    if (known) {
      paintHead();
      body.replaceChildren(h('div', { class: 'detail-stage' }, head), sections);
    } else {
      body.replaceChildren(h('div', { class: 'detail-loading' }, h('div', { class: 'sk sk-poster' }), h('div', { class: 'sk-stack' }, h('div', { class: 'sk sk-title-lg' }), h('div', { class: 'sk sk-line' }), h('div', { class: 'sk sk-line short' }))));
    }
    findLibraryItem();
    loadQuota();
    await loadDetails();
    if (destroyed) return;
    if (!details) {
      if (!known) {
        body.replaceChildren();
        showPageStatus(el, pageStatus({ kind: 'failed', text: detailsError?.message ?? '', retry: () => (showPageStatus(el, null), load()) }));
        if (detailsError?.code === 'SEERR_AUTH') runSeerrCheck();
        return;
      }
      error = detailsError?.code === 'SEERR_AUTH' ? t('seerr.authExpired') : t('seerr.detail.error', { msg: detailsError?.message ?? '' });
      paintActions();
      return;
    }
    known = known ?? details;
    paintHead();
    body.replaceChildren(h('div', { class: 'detail-stage' }, head), sections);
    paintSections();
    startTrailer();
    loadExtras();
  }
  load();

  return {
    el,
    destroy() {
      destroyed = true;
      trailerCtl?.destroy();
      trailerCtl = null;
      scroller()?.removeEventListener('scroll', onScroll);
      document.removeEventListener('connection-state', onConnection);
    }
  };
}
