import { h, icon, $ } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { card, pageStatus } from '../ui.js';
import { debounce } from '../utils.js';
import { playItem } from '../actions.js';
import { navigate } from '../router.js';
import { seerrState } from '../connection.js';
import { requestCard, setCardStatus } from './request-card.js';

const Search = window.JCSearchStatus; // Hinweis ohne Treffer, Abgleich mit Seerr (src/shared/search-status.js)

/** Das Suchfeld der offenen Suche bekommt den Fokus (Tastatur auf dem Handy); false, wenn die Suche nicht offen ist. Der Suchtext bleibt. */
export function focusSearchField() {
  const input = $('#view .search .search-input');
  if (!input) return false;
  input.focus({ preventScroll: true });
  return true;
}

let lastQuery = '';
/** Der Text der zuletzt offenen Suche: der Reiter "Suche" fuehrt von einer Seite aus ihr (Detailseite, Person) dorthin zurueck, mit dem Text (app.js). */
export const lastSearchQuery = () => lastQuery;

let focusOnOpen = false;
/** Zur Suche, mit dem Fokus im Suchfeld (Tastenkuerzel): ist sie schon offen, nur der Fokus, der Suchtext bleibt. */
export function openSearch() {
  if (focusSearchField()) return;
  focusOnOpen = true;
  navigate('/search');
}

/**
 * Suche (wie SearchView der Apple-App): die Treffer der Mediathek zuerst (nach Art), darunter unabhaengig die Treffer von Seerr, die nicht (ganz) in der Mediathek
 * sind ("Nicht in der Bibliothek", Abgleich ueber TMDB-Nummer und Art, nie ueber den Titel; teilweise vorhandene Serien bleiben anfragbar). Gesucht wird, wenn die
 * Eingabe 350 ms ruht (Enter sofort); eine veraltete Antwort wird verworfen. "Keine Ergebnisse" und ein Fehler gelten nur fuer den beantworteten Text
 * (search-status.js); Treffer bleiben stehen, bis die neue Suche antwortet. Ein Ausfall von Seerr ersetzt Treffer der Mediathek nie durch eine Fehlerseite.
 * Beim Oeffnen bekommt das Suchfeld am Desktop den Fokus; auf dem Handy (kompakt) erst mit einem zweiten Tipp auf den Reiter (app.js), sonst stuende sofort
 * die Tastatur da.
 */
export function searchView({ query }) {
  const el = h('div', { class: 'page search', 'data-glow': 'search' });
  const input = h('input', { class: 'search-input', type: 'search', placeholder: t('search.placeholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('nav.search') });
  input.value = query?.get('q') ?? '';
  const results = h('div', { class: 'search-results' });
  el.append(h('div', { class: 'search-bar' }, icon('search', 22), input), results);

  let gen = 0;
  let destroyed = false;
  let answered = null; // Text der letzten abgeschlossenen Suche (search-status.js)
  let libraryPending = false;
  let seerrPending = false;
  let error = null; // Fehler der Mediathek zum beantworteten Text
  let items = []; // Treffer der Mediathek
  let seerrList = []; // Treffer von Seerr vor dem Abgleich
  let seerrNote = null; // Seerr antwortet nicht: { text, settings }
  const onPlay = (item) => playItem({ itemId: item.Id, resume: true });
  const term = () => input.value.trim();

  // ---------- Zeichnen ----------
  let libraryShown = null; // die Treffer, deren Gruppen dastehen
  let libraryNodes = [];
  let seerrSig = null;
  let seerrNode = null;
  let seerrCards = new Map(); // "art-nummer" -> Objekt der stehenden Karte
  let statusSig = '';
  let statusNode = null;

  function libraryGroups() {
    if (libraryShown === items) return libraryNodes;
    libraryShown = items;
    const groups = [
      ['Movie', t('search.movies')],
      ['Series', t('search.series')],
      ['BoxSet', t('search.collections')],
      ['Episode', t('search.episodes')]
    ];
    libraryNodes = groups
      .map(([type, label]) => {
        const list = items.filter((i) => i.Type === type);
        if (!list.length) return null;
        const grid = h('div', { class: 'grid' });
        list.forEach((it, i) => grid.append(card(it, { index: i, onPlay })));
        return h('section', { class: 'search-group' }, h('div', { class: 'row-head' }, h('h2', null, label), h('span', { class: 'sub' }, String(list.length))), grid);
      })
      .filter(Boolean);
    return libraryNodes;
  }

  /** Die Gruppe "Nicht in der Bibliothek": dieselben Titel wie zuletzt -> nur die Staende der Karten (nach einer Anfrage), sonst neu. */
  function seerrGroup(list) {
    const sig = list.map((r) => `${r.mediaType}-${r.id}`).join(',');
    if (sig === seerrSig && seerrNode) {
      for (const r of list) {
        const shown = seerrCards.get(`${r.mediaType}-${r.id}`);
        if (shown && shown.status !== r.status) setCardStatus(shown, r.status);
      }
      return seerrNode;
    }
    seerrSig = sig;
    seerrCards = new Map();
    const grid = h('div', { class: 'grid' });
    list.forEach((r, i) => {
      seerrCards.set(`${r.mediaType}-${r.id}`, r);
      grid.append(requestCard(r, i));
    });
    seerrNode = h(
      'section',
      { class: 'search-group seerr-group' },
      h('div', { class: 'row-head' }, h('h2', null, t('seerr.group')), h('span', { class: 'sub' }, String(list.length))),
      h('p', { class: 'search-group-note' }, t('seerr.groupHint')),
      grid
    );
    return seerrNode;
  }

  /** Hinweise ueber den Treffern; dieselben Elemente, solange sich ihr Text nicht aendert (sonst rueckten die Gruppen bei jedem Zeichnen neu ein). */
  let notesSig = '';
  let notes = [];
  function noteNodes() {
    const libraryError = error && answered === term() ? error : '';
    const sig = `${libraryError}|${seerrNote?.text ?? ''}`;
    if (sig === notesSig) return notes;
    notesSig = sig;
    notes = [];
    // Fehler der Mediathek, waehrend Treffer von Seerr dastehen: klein darueber, mit "Erneut versuchen"
    if (libraryError) notes.push(h('p', { class: 'seerr-note' }, t('search.libraryFailed', { msg: libraryError }), ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => run() }, t('action.retry'))));
    if (seerrNote) notes.push(h('p', { class: 'seerr-note' }, seerrNote.text, seerrNote.settings ? h('a', { class: 'link-btn', href: '#/settings/seerr' }, ` ${t('toast.openSettings')}`) : null));
    return notes;
  }

  function statusFor(st) {
    const sig = `${st.kind}|${st.term ?? ''}|${st.message ?? ''}`;
    if (sig === statusSig && statusNode) return statusNode;
    statusSig = sig;
    if (st.kind === 'prompt') statusNode = pageStatus({ symbol: 'search', title: t('search.hintTitle'), text: t('search.hintText') });
    else if (st.kind === 'loading') statusNode = pageStatus({ kind: 'loading', title: t('search.searching') });
    else if (st.kind === 'failed') statusNode = pageStatus({ kind: 'failed', text: st.message, retry: () => run() });
    else statusNode = pageStatus({ symbol: 'search', title: t('search.noneTitle', { q: st.term }), text: t('search.noneText') });
    return statusNode;
  }

  /** Setzt die Kinder in die gewuenschte Folge, ohne stehende Elemente herauszunehmen (Karten blieben sonst nicht ruhig stehen). */
  function arrange(nodes) {
    let cur = results.firstChild;
    for (const n of nodes) {
      if (n === cur) {
        cur = cur.nextSibling;
        continue;
      }
      results.insertBefore(n, cur);
    }
    while (cur) {
      const next = cur.nextSibling;
      cur.remove();
      cur = next;
    }
  }

  function paint() {
    if (destroyed) return;
    const q = term();
    const reqs = q ? Search.requestable(seerrList, items) : [];
    const hits = !!q && (items.length > 0 || reqs.length > 0);
    // Abgeblendet nur, solange die Mediathek fuer einen neuen Text sucht und noch alte Treffer dastehen; Seerr kommt danach ohne Abblenden dazu
    results.classList.toggle('busy', hits && libraryPending);
    if (!hits) {
      const st = Search.resolve({ term: q, answered, searching: libraryPending || seerrPending, error });
      arrange([...(q && st.kind !== 'loading' ? noteNodes() : []), statusFor(st)]);
      return;
    }
    arrange([...(q ? noteNodes() : []), ...libraryGroups(), ...(reqs.length ? [seerrGroup(reqs)] : [])]);
  }

  // ---------- Suchen ----------
  const seerrSearch = (q) => (state.seerr ? window.jc.seerrSearch(q).then((list) => ({ list }), (e) => ({ e })) : Promise.resolve({ list: [] }));
  function takeSeerr(res) {
    if (res.e?.code === 'SEERR_STALE') return; // die Antwort gehoert zu einem vorigen Profil
    if (res.e) {
      seerrList = [];
      seerrNote = { text: res.e.code === 'SEERR_AUTH' ? t('seerr.authExpired') : t('seerr.error', { msg: res.e.message }), settings: res.e.code === 'SEERR_AUTH' };
    } else {
      seerrList = res.list ?? [];
      seerrNote = null;
    }
  }

  async function run() {
    const q = term();
    const my = ++gen;
    lastQuery = q;
    history.replaceState(null, '', q ? `#/search?q=${encodeURIComponent(q)}` : '#/search');
    if (!q) {
      // Eine noch laufende Suche ist damit veraltet und zeichnet nichts mehr
      libraryPending = seerrPending = false;
      items = [];
      seerrList = [];
      error = seerrNote = null;
      answered = '';
      return paint();
    }
    libraryPending = seerrPending = true;
    paint();
    const seerr = seerrSearch(q); // unabhaengig von der Mediathek, haelt sie nicht auf
    try {
      const found = await api.search(q, 60);
      if (my !== gen || destroyed) return;
      items = found;
      error = null;
    } catch (e) {
      if (my !== gen || destroyed) return;
      items = [];
      error = e.message;
    }
    libraryPending = false;
    paint(); // die Treffer der Mediathek sofort, Seerr folgt darunter
    const res = await seerr;
    if (my !== gen || destroyed) return;
    takeSeerr(res);
    seerrPending = false;
    answered = q; // erst jetzt gelten "Keine Ergebnisse" und ein Fehler fuer diesen Text
    paint();
  }

  /** Nur die Treffer von Seerr neu (nach einer Anfrage, Seerr wieder verbunden); die Mediathek bleibt. Nur fuer den beantworteten Text. */
  async function refreshSeerr() {
    const q = term();
    if (destroyed || !q || q !== answered || !state.seerr) return;
    const my = gen;
    const res = await seerrSearch(q);
    if (my !== gen || destroyed || term() !== q) return;
    takeSeerr(res);
    paint();
  }

  const debounced = debounce(() => run(), Search.QUIET_MS);
  input.addEventListener('input', () => {
    paint(); // ohne Treffer gleich "Laden" statt eines Hinweises zum vorigen Text
    debounced();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      debounced.cancel();
      run();
    }
  });
  const onSeerrChanged = () => refreshSeerr();
  let seerrWas = seerrState();
  const onConnection = () => {
    const now = seerrState();
    if (now === 'connected' && seerrWas !== 'connected') refreshSeerr(); // Seerr erst jetzt bestaetigt: seine Treffer fehlten sonst bis zur naechsten Eingabe
    seerrWas = now;
  };
  document.addEventListener('seerr-changed', onSeerrChanged);
  document.addEventListener('connection-state', onConnection);

  run();
  // Am Desktop gleich tippen; auf dem Handy erst mit dem zweiten Tipp auf den Reiter (oder einem Tastenkuerzel)
  if (focusOnOpen || document.documentElement.dataset.compact !== 'on') requestAnimationFrame(() => !destroyed && input.focus({ preventScroll: true }));
  focusOnOpen = false;

  return {
    el,
    destroy() {
      destroyed = true;
      debounced.cancel();
      document.removeEventListener('seerr-changed', onSeerrChanged);
      document.removeEventListener('connection-state', onConnection);
    }
  };
}
