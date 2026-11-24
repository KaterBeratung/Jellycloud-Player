import { h, icon } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { state } from '../state.js';
import { mapImage } from '../api.js';
import { pageStatus, showPageStatus, lazyImage, openMenu, segmented, toast, confirmDialog, attachTilt } from '../ui.js';
import { mediaTag } from '../tags.js';
import { invalidate } from '../router.js';
import { seerrState, runSeerrCheck } from '../connection.js';
import { openSeerrTitle } from '../seerr-open.js';
import { chooseSeasons } from './season-chooser.js';
import { editRequestTarget } from './request-editor.js';

const SeerrState = window.JCSeerrState; // Staende und Rechte (src/shared/seerr-state.js)
const Requests = window.JCSeerrRequests; // Blaettern, Aktionen, Angabe unter dem Plakat (src/shared/seerr-requests.js)
const Tags = window.JCMediaTags; // Tag eines Stands (src/shared/media-tags.js)

const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;
const ACTION_ICONS = { approve: 'check-circle', decline: 'x', retry: 'refresh', seasons: 'layers', edit: 'edit', available: 'check', withdraw: 'back', remove: 'trash' };

/**
 * Gemerkt ueber den Aufbau der Seite hinaus (Neu laden baut sie neu, ein Reiterwechsel auch): Ansicht, Anzeige und wie viel geladen war, damit
 * Neuladen so viel holt, wie da war (nichts springt); dazu Titel und Bilder der Anfragen. Alles gehoert zu einem Profil und seiner Seerr-Sitzung.
 */
let memo = { key: null, scope: 'mine', filter: 'open', received: 0 };
let titleCache = { key: null, map: new Map() };
const sessionKey = () => `${state.activeServerId}|${state.seerr?.url}|${state.seerr?.userName}`;
for (const ev of ['relogin', 'seerr-changed']) document.addEventListener(ev, () => (titleCache = { key: null, map: new Map() }));
const titles = () => {
  if (titleCache.key !== sessionKey()) titleCache = { key: sessionKey(), map: new Map() };
  return titleCache.map;
};

/**
 * Reiter "Anfragen" (wie die Apple-App, Features/Requests/RequestsView.swift). Er steht immer da, auch ohne Seerr: die Leiste aendert ihre Breite
 * nicht beim Einrichten oder Ausfall von Seerr. Ohne Verbindung die vier Zustaende aus der Verbindungspruefung (nicht eingerichtet, nicht
 * erreichbar, Anmeldung abgelaufen, fehlgeschlagen; connection.js). Verbunden:
 * - "Meine Anfragen" und, mit dem Recht alle zu sehen, "Verwalten" (entzogenes Recht schliesst es); Anzeige offen oder abgeschlossen.
 * - Plakatraster wie Filme und Serien mit dem Stand als Tag; seitenweise zu je 50 (naechste Seite, wenn das Ende in Sicht kommt oder die Anzeige den
 *   Bildschirm nicht fuellt); Neuladen holt so viel, wie geladen war.
 * - Antippen oeffnet den Titel (in der Mediathek die Detailseite, sonst das Seerr-Fenster); die Aktionen (nur die erlaubten, allein nach den
 *   Rechten aus /auth/me) ueber den Knopf auf dem Plakat oder das Kontextmenue; destruktive mit Rueckfrage, eine Aktion je Anfrage zur Zeit.
 */
export function requestsView() {
  const el = h('div', { class: 'page requests', 'data-glow': 'requests' });
  const switchHost = h('span', { class: 'lib-switch' });
  const controls = h('div', { class: 'lib-controls' });
  const note = h('p', { class: 'seerr-note', hidden: true });
  const grid = h('div', { class: 'grid rq-grid' });
  const sentinel = h('div', { class: 'sentinel' });
  el.append(h('header', { class: 'lib-head' }, h('div', { class: 'lib-title' }, h('h1', null, t('nav.requests')), switchHost), controls), note, grid, sentinel);

  const fresh = memo.key !== sessionKey();
  let scope = fresh ? 'mine' : memo.scope;
  let filter = fresh ? 'open' : memo.filter;
  let reloadAtLeast = fresh ? 0 : memo.received;
  let paging = Requests.createPaging();
  let loaded = false;
  let firstLoading = false;
  let listError = null; // Neuladen gescheitert (bleibt die Liste, steht der Grund darueber)
  let moreError = null; // Weiterblaettern gescheitert
  let moreRun = null;
  let generation = 0;
  let destroyed = false;
  let shownState = null;
  let shownPerms = null;
  let userKey = null;
  const busy = new Set();
  const cards = new Map(); // Anfrage-Nummer -> { el, r, paint }

  const user = () => (seerrState() === 'connected' ? state.connection?.seerr?.user ?? null : null);
  const perms = () => user()?.permissions ?? 0;
  const canManageView = () => SeerrState.canViewAllRequests(perms());
  const keyOf = (r) => `${r.mediaType}-${r.tmdbId}`;
  const shown = () => paging.requests.filter((r) => Requests.matches(r, filter));
  const titleOf = (r) => titles().get(keyOf(r))?.title || t(r.mediaType === 'movie' ? 'seerr.movie' : 'seerr.tv');
  const remember = () => {
    memo = { key: sessionKey(), scope, filter, received: Math.max(paging.received, reloadAtLeast) };
  };

  // ---------- Kopfzeile: Ansicht (nur mit Recht) und Anzeige ----------
  function buildHead() {
    switchHost.replaceChildren();
    controls.replaceChildren();
    if (seerrState() !== 'connected') return;
    if (canManageView()) {
      const label = t(scope === 'manage' ? 'req.manage' : 'req.mine');
      const b = h('button', { class: 'btn glass sm lib-switch-btn', type: 'button', 'aria-label': `${t('req.scope')}: ${label}`, title: t('req.scope') }, icon(scope === 'manage' ? 'users' : 'user', 16), h('span', null, label), icon('chevron-down', 14));
      b.addEventListener('click', () =>
        openMenu(
          b,
          [
            { id: 'mine', label: t('req.mine'), selected: scope === 'mine' },
            { id: 'manage', label: t('req.manage'), selected: scope === 'manage' }
          ],
          { onPick: (e) => setScope(e.id) }
        )
      );
      switchHost.append(b);
    }
    controls.append(
      segmented(
        [
          { value: 'open', label: t('req.open') },
          { value: 'closed', label: t('req.closed') }
        ],
        filter,
        (v) => setFilter(v)
      )
    );
    // Gemeldete Probleme (Apple-App Build 94: im Menue der Ansicht; hier ein Knopf neben der Anzeige): nur mit einem der Rechte dafuer
    if (Requests.issues.shows(perms())) {
      controls.append(h('a', { class: 'btn glass sm', href: '#/issues', 'data-action': 'issues' }, icon('warning', 16), h('span', null, t('issues.title'))));
    }
  }

  function setScope(next) {
    if (next === scope) return;
    scope = next;
    // Andere Ansicht: die Liste der anderen nicht stehen lassen (sonst saehen fremde Anfragen kurz wie eigene aus)
    paging = Requests.createPaging();
    reloadAtLeast = 0;
    loaded = false;
    listError = null;
    moreError = null;
    buildHead();
    render();
    load();
  }

  function setFilter(next) {
    if (next === filter) return;
    filter = next;
    moreError = null;
    remember();
    el.parentElement?.scrollTo?.({ top: 0 });
    render();
    loadTitles(shown(), generation);
    fillScreen();
  }

  // ---------- Plakat ----------
  function cardFor(r) {
    let c = cards.get(r.id);
    if (c) {
      c.r = r;
      c.paint();
      return c.el;
    }
    const thumb = h('div', { class: 'thumb' });
    const chip = h('span', { class: 'req-status' });
    const l1 = h('div', { class: 'l1' });
    const l2 = h('div', { class: 'l2' });
    const more = h('button', { class: 'rq-more', type: 'button', 'aria-label': t('req.actions'), title: t('req.actions'), 'aria-haspopup': 'menu' }, icon('more', 18));
    const spin = h('span', { class: 'spinner rq-busy', 'aria-hidden': 'true' });
    const card = h('div', { class: 'card poster rq-item', role: 'button', tabindex: '0' }, thumb, h('div', { class: 'meta' }, l1, l2));
    c = { el: card, r, look: null };
    const paint = () => {
      const req = c.r;
      const media = titles().get(keyOf(req));
      const title = titleOf(req);
      // Bild nur neu, wenn sich das Plakat geaendert hat (Titel nachgeladen): sonst bliebe das geladene Bild stehen. Ohne Bild steht der Titel darauf.
      const posterPath = media?.posterPath && TMDB_PATH.test(media.posterPath) ? media.posterPath : null;
      const look = `${posterPath}|${titles().has(keyOf(req)) ? title : ''}`;
      if (c.look !== look) {
        c.look = look;
        thumb.replaceChildren(lazyImage(posterPath ? { url: mapImage(`jellycloud://tmdb/w342${posterPath}`), hash: null } : null, { alt: '', fallback: titles().has(keyOf(req)) ? title : '' }), chip, spin, more);
      }
      chip.replaceChildren(mediaTag(Tags.seerrRequest(req, getLocale()), { short: true }));
      // Titel noch nicht da: eine Platzhalterzeile; liess er sich nicht laden, "Film" bzw. "Serie"
      const waiting = !titles().has(keyOf(req));
      l1.textContent = waiting ? '' : title;
      l1.classList.toggle('sk', waiting);
      l1.classList.toggle('sk-line', waiting);
      l2.textContent = Requests.detailLine(req, { year: media?.year ?? null, manage: scope === 'manage', lang: getLocale(), kinds: { movie: t('seerr.movie'), tv: t('seerr.tv') }, by: (name) => t('req.by', { name }) });
      const acts = Requests.actionsFor(req, { permissions: perms(), userId: user()?.id ?? null });
      more.hidden = !acts.length;
      const working = busy.has(req.id);
      card.classList.toggle('busy', working);
      card.setAttribute('aria-busy', String(working));
      more.disabled = working;
      card.setAttribute('aria-label', `${title}, ${SeerrState.label(SeerrState.requestOf(req) ?? 'unknown', getLocale())}`);
      card.title = title;
    };
    c.paint = paint;
    cards.set(r.id, c);
    paint();
    const resetTilt = attachTilt(card, thumb);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.rq-more')) return;
      resetTilt();
      openTitle(c.r);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTitle(c.r);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        showActions(c.r, more);
      }
    });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      showActions(c.r, more);
    });
    card.addEventListener('contextmenu', (e) => {
      if (!Requests.actionsFor(c.r, { permissions: perms(), userId: user()?.id ?? null }).length) return;
      e.preventDefault();
      showActions(c.r, more);
    });
    return card;
  }

  function showActions(r, anchor) {
    if (busy.has(r.id)) return;
    const acts = Requests.actionsFor(r, { permissions: perms(), userId: user()?.id ?? null });
    if (!acts.length) return;
    // Kopf: wer wann angefragt und wer entschieden hat (Apple-App Build 94). Entfernen steht abgesetzt am Ende (es gilt fuer jede Anfrage, die anderen nur fuer ihren Stand)
    const head = Requests.detailLines(r, { userId: user()?.id ?? null, lang: getLocale(), t }).map((line) => ({ header: true, note: true, label: line }));
    const entries = [...head, ...(head.length ? [{ separator: true }] : []), ...acts.flatMap((a, i) => [...(a === 'remove' && i > 0 ? [{ separator: true }] : []), { id: a, label: t(`req.act.${a}`), icon: ACTION_ICONS[a], danger: Requests.DESTRUCTIVE.includes(a) }])];
    openMenu(anchor, entries, { align: 'right', columns: false, onPick: (e) => act(r, e.id) });
  }

  /**
   * Was eine Aktion schickt; null heisst abgebrochen. Staffeln aendern: erst die Auswahl (die Staffeln der Anfrage vorgewaehlt); Anfrage aendern: das Blatt mit
   * Zielserver, Profil, Ordner und "Anfragen als" (request-editor.js); Als verfuegbar markieren: nach einer Rueckfrage.
   */
  async function prepare(r, action) {
    if (action === 'seasons') {
      const d = await window.jc.seerrDetails({ mediaType: 'tv', mediaId: r.tmdbId });
      const seasons = d.seasonList.length ? await chooseSeasons({ title: titleOf(r), seasons: d.seasonList, own: r.seasons }) : null;
      return seasons ? () => window.jc.seerrRequestUpdate({ id: r.id, body: { mediaType: 'tv', seasons } }) : null;
    }
    if (action === 'edit') {
      const body = await editRequestTarget(r, { permissions: perms(), title: titleOf(r) });
      return body ? () => window.jc.seerrRequestUpdate({ id: r.id, body }) : null;
    }
    if (action === 'available') {
      const ok = await confirmDialog({ title: t('req.confirm.available'), text: t('req.confirm.availableText', { title: titleOf(r) }), confirmLabel: t('req.confirmBtn.available') });
      return ok ? () => window.jc.seerrMarkAvailable({ id: r.id, seerrMediaId: r.seerrMediaId, is4k: r.is4k }) : null;
    }
    if (Requests.DESTRUCTIVE.includes(action)) {
      const ok = await confirmDialog({
        title: t(`req.confirm.${action}`),
        text: action === 'remove' ? t('req.confirm.removeText') : `„${titleOf(r)}“`,
        confirmLabel: t(`req.confirmBtn.${action}`),
        danger: true
      });
      if (!ok) return null;
    }
    return () => window.jc.seerrRequestAction({ id: r.id, action });
  }

  const failure = (e) => {
    if (e.code === 'SEERR_AUTH') return runSeerrCheck();
    toast(e.code === 'SEERR_DENIED' ? t('req.denied') : e.code === 'SEERR_GONE' ? t('req.gone') : e.code === 'SEERR_CHANGED' ? t('req.changed') : t('seerr.error', { msg: e.message }), { type: 'error' });
    if (e.code === 'SEERR_DENIED') runSeerrCheck({ quiet: true }); // still nachsehen, ob die Sitzung noch gilt (gilt sie nicht: "Erneut anmelden")
  };

  /** Eine Aktion einmal ausfuehren (ein zweiter Klick zaehlt nicht), nach Auswahl bzw. Rueckfrage; danach den Stand vom Server laden. */
  async function act(r, action) {
    if (busy.has(r.id) || destroyed) return;
    let run = null;
    busy.add(r.id); // schon waehrend der Auswahl: ein zweites Menue derselben Anfrage oeffnet sich nicht
    try {
      run = await prepare(r, action);
    } catch (e) {
      if (!destroyed) failure(e);
    }
    if (!run || destroyed) {
      busy.delete(r.id);
      return;
    }
    cards.get(r.id)?.paint();
    try {
      await run();
      if (action === 'available' || action === 'seasons' || action === 'edit') toast(t(`req.done.${action}`));
    } catch (e) {
      failure(e);
    } finally {
      busy.delete(r.id);
    }
    // Stand auch in Suche und "Filme im Trend": die gemerkten Seiten verwerfen
    invalidate();
    document.dispatchEvent(new CustomEvent('seerr-changed'));
    if (!destroyed) await load();
  }

  /** Antippen: ist der Titel in der Mediathek, seine Detailseite (dort abspielen); sonst seine Seite bei Seerr (seerr-open.js, ein Oeffnen zur Zeit). */
  function openTitle(r) {
    if (busy.has(r.id)) return;
    const known = titles().get(keyOf(r));
    openSeerrTitle({ mediaType: r.mediaType, tmdbId: r.tmdbId, known: known ? { ...known, status: r.mediaStatus } : null, checkLibrary: SeerrState.isPresent(r.mediaStatus) });
  }

  // ---------- Laden ----------
  function skeletons(n = 12) {
    return Array.from({ length: n }, () => h('div', { class: 'card poster sk-card' }, h('div', { class: 'thumb sk' }), h('div', { class: 'meta' }, h('div', { class: 'sk sk-line' }))));
  }

  /** Titel und Bilder der Plakate, hoechstens sechs Abrufe zugleich; schon bekannte nicht noch einmal. */
  async function loadTitles(list, gen) {
    const map = titles();
    const missing = [...new Map(list.filter((r) => !map.has(keyOf(r))).map((r) => [keyOf(r), r])).values()];
    let next = 0;
    const worker = async () => {
      while (next < missing.length && gen === generation && !destroyed) {
        const r = missing[next++];
        let media = null;
        try {
          media = await window.jc.seerrMedia({ mediaType: r.mediaType, tmdbId: r.tmdbId });
        } catch (e) {
          if (e.code === 'SEERR_STALE') return;
        }
        if (gen !== generation || destroyed) return;
        map.set(keyOf(r), media);
        for (const c of cards.values()) if (keyOf(c.r) === keyOf(r)) c.paint();
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, missing.length) }, worker));
  }

  /** Die erste Seite in einem Abruf, so lang wie die Liste schon war (nach einer Aktion oder dem Neuladen springt nichts), mindestens eine Seite. */
  async function load() {
    if (destroyed || seerrState() !== 'connected') return;
    const gen = ++generation;
    firstLoading = true;
    moreRun = null;
    render();
    try {
      const page = await window.jc.seerrRequests({ scope, skip: 0, take: Math.max(paging.reloadSize, reloadAtLeast) });
      if (gen !== generation || destroyed) return;
      paging.start(page);
      reloadAtLeast = 0;
      loaded = true;
      listError = null;
      moreError = null;
      remember();
      firstLoading = false;
      render();
      loadTitles(page.requests, gen);
      fillScreen();
    } catch (e) {
      if (gen !== generation || destroyed || e.code === 'SEERR_STALE') return;
      firstLoading = false;
      loaded = true;
      listError = e;
      handleSeerrError(e);
      render();
    } finally {
      if (gen === generation) firstLoading = false;
    }
  }

  /** Die naechste Seite hinter dem Abgeholten. Laeuft schon ein Nachladen, kommt dessen Ergebnis; laedt die erste Seite gerade neu, nichts. */
  function loadMore() {
    if (moreRun) return moreRun;
    if (!loaded || firstLoading || !paging.hasMore || moreError || destroyed || seerrState() !== 'connected') return Promise.resolve();
    const gen = generation;
    moreRun = (async () => {
      try {
        const page = await window.jc.seerrRequests({ scope, skip: paging.received, take: Requests.PAGE_SIZE });
        if (gen !== generation || destroyed) return;
        paging.append(page);
        remember();
        render();
        loadTitles(page.requests.filter((r) => Requests.matches(r, filter)), gen);
      } catch (e) {
        if (gen !== generation || destroyed || e.code === 'SEERR_STALE') return;
        moreError = e;
        handleSeerrError(e);
        render();
      }
    })().finally(() => {
      if (gen === generation) moreRun = null;
    });
    return moreRun;
  }

  /** Blaettert weiter, bis die gewaehlte Anzeige den Bildschirm fuellt oder alles geladen ist; nie im Kreis (ein Schritt ohne Neues beendet es). */
  async function fillScreen() {
    while (!destroyed && loaded && shown().length < Requests.FILL && paging.hasMore && !moreError) {
      const before = paging.received;
      await loadMore();
      if (paging.received === before) return;
    }
  }

  /** Abgelaufene Anmeldung: der Reiter zeigt "Erneut anmelden"; sonst still nachsehen, ob Seerr noch erreichbar ist. */
  function handleSeerrError(e) {
    if (e.code === 'SEERR_AUTH') runSeerrCheck();
    else runSeerrCheck({ quiet: true });
  }

  // ---------- Zeichnen ----------
  function render() {
    if (destroyed) return;
    const s = seerrState();
    grid.hidden = s !== 'connected';
    note.hidden = true;
    if (s !== 'connected') {
      grid.replaceChildren();
      showPageStatus(el, statusFor(s));
      return;
    }
    const list = shown();
    if (!loaded || (firstLoading && !paging.requests.length)) {
      showPageStatus(el, null);
      grid.replaceChildren(...skeletons());
      return;
    }
    if (listError && !paging.requests.length) {
      grid.replaceChildren();
      showPageStatus(el, pageStatus({ kind: 'failed', title: t('req.loadFailed'), text: listError.message, retry: () => load() }));
      return;
    }
    if (listError) {
      note.textContent = t('req.reloadFailed', { msg: listError.message });
      note.hidden = false;
    }
    if (!list.length) {
      grid.replaceChildren();
      if (paging.hasMore && moreError) {
        showPageStatus(el, pageStatus({ kind: 'failed', title: t('req.loadFailed'), text: moreError.message, retry: () => ((moreError = null), fillScreen()) }));
      } else if (paging.hasMore) {
        // Unter den geladenen ist keine fuer diese Anzeige, bei Seerr liegen aber aeltere: "keine Anfragen" waere ungeprueft, es laedt weiter
        showPageStatus(el, null);
        grid.replaceChildren(...skeletons(6));
      } else {
        showPageStatus(el, pageStatus({ symbol: 'tray', title: t(filter === 'open' ? 'req.emptyOpen' : 'req.emptyClosed'), text: t(scope === 'manage' ? 'req.emptyManage' : 'req.emptyMine') }));
      }
      return;
    }
    showPageStatus(el, null);
    // Ohne Neuaufbau der schon gezeigten Plakate: dieselben Elemente in neuer Reihenfolge (Bilder und Fokus bleiben)
    const els = list.map((r, i) => {
      const card = cardFor(r);
      card.style.setProperty('--i', Math.min(i, 18));
      return card;
    });
    const same = els.length === grid.children.length && els.every((x, i) => grid.children[i] === x);
    if (!same) grid.replaceChildren(...els);
    if (moreError) grid.append(pageStatus({ kind: 'failed', title: t('req.loadFailed'), text: moreError.message, inline: true, retry: () => ((moreError = null), loadMore()) }));
    rearm();
  }

  const retry = () => runSeerrCheck();
  function statusFor(s) {
    switch (s) {
      case 'none':
        return pageStatus({ kind: 'action', symbol: 'tray', title: t('req.noSeerrTitle'), text: t('req.noSeerrText'), action: { label: t('req.connect'), href: '#/settings/seerr' } });
      case 'unreachable':
        return pageStatus({ kind: 'failed', symbol: 'warning', title: t('req.unreachableTitle'), text: t('req.unreachableText'), retry });
      case 'unauthorized':
        return pageStatus({ kind: 'action', symbol: 'key-off', title: t('req.expiredTitle'), text: t('req.expiredText'), action: { label: t('req.signInAgain'), href: '#/settings/seerr' } });
      case 'failed':
        return pageStatus({ kind: 'failed', title: t('req.failedTitle'), text: t('req.failedText'), retry });
      default:
        return pageStatus({ kind: 'loading', title: t('req.checking') });
    }
  }

  // Das Ende der Liste kommt in Sicht: die naechste Seite (wie das Raster unter Filme und Serien). Der Beobachter meldet sich nur bei einer
  // Aenderung; nach jedem Zeichnen wird er neu angelegt, damit er sich meldet, wenn das Ende schon im Blick ist.
  const observer = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && loadMore(), { rootMargin: '900px 0px' });
  function rearm() {
    observer.unobserve(sentinel);
    if (paging.hasMore && !moreError) observer.observe(sentinel);
  }

  /** Stand von Seerr geaendert (Pruefung): verbunden laden, sonst den Zustand zeigen; ein anderer Benutzer oder entzogene Rechte laden neu. */
  function onConnection() {
    const s = seerrState();
    const u = user();
    const nextUser = u ? `${u.id}` : null;
    if (scope === 'manage' && s === 'connected' && !canManageView()) {
      shownState = s;
      shownPerms = perms();
      if (nextUser) userKey = nextUser;
      setScope('mine'); // Recht entzogen: "Verwalten" schliesst
      return;
    }
    if (s === shownState && nextUser === userKey) {
      // Gleicher Stand: nur, wenn sich die Rechte geaendert haben, Kopfzeile und Aktionen neu (sonst bleibt alles stehen, auch der Fokus)
      if (s === 'connected' && perms() !== shownPerms) {
        shownPerms = perms();
        buildHead();
        for (const c of cards.values()) c.paint();
      }
      return;
    }
    shownPerms = perms();
    const userChanged = userKey !== null && nextUser !== null && nextUser !== userKey;
    const back = s === 'connected' && shownState !== null && shownState !== 'connected'; // wieder verbunden (erreichbar, neu angemeldet): neu laden
    shownState = s;
    if (nextUser) userKey = nextUser;
    buildHead();
    if (s === 'connected' && (!loaded || userChanged || back)) {
      if (userChanged) {
        paging = Requests.createPaging();
        cards.clear();
        loaded = false;
      }
      load();
    } else render();
  }

  document.addEventListener('connection-state', onConnection);
  onConnection();
  // Nicht verbunden (nicht erreichbar, abgelaufen, wird geprueft): beim Oeffnen nachsehen; verbunden laedt die Liste selbst und meldet Fehler
  if (state.seerr && seerrState() !== 'connected') runSeerrCheck();

  return {
    el,
    destroy() {
      destroyed = true;
      remember();
      observer.disconnect();
      document.removeEventListener('connection-state', onConnection);
    }
  };
}
