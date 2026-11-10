import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api, isFolder } from '../api.js';
import { state } from '../state.js';
import { card, openMenu, segmented, toast } from '../ui.js';
import { store } from '../utils.js';
import { playItem, resolveSeriesTarget } from '../actions.js';

const PAGE = 60;

const SORTS = [
  { id: 'SortName', order: 'Ascending', key: 'sort.name' },
  { id: 'DateCreated', order: 'Descending', key: 'sort.added' },
  { id: 'PremiereDate', order: 'Descending', key: 'sort.release' },
  { id: 'CommunityRating', order: 'Descending', key: 'sort.rating' },
  { id: 'Runtime', order: 'Ascending', key: 'sort.runtime' },
  { id: 'Random', order: 'Ascending', key: 'sort.random' }
];

function queryFor(parent) {
  switch (parent.CollectionType) {
    case 'movies':
      return { includeItemTypes: 'Movie', recursive: true };
    case 'tvshows':
      return { includeItemTypes: 'Series', recursive: true };
    case 'boxsets':
      return { includeItemTypes: 'BoxSet', recursive: true };
    default:
      // Gemischte Ordner / Sammlungen: Ebene fuer Ebene durchsuchen
      return { recursive: false };
  }
}

export function libraryView({ id }) {
  const el = h('div', { class: 'page library' });
  const titleEl = h('h1', null, ' ');
  const countEl = h('span', { class: 'count' });
  const controls = h('div', { class: 'lib-controls' });
  const grid = h('div', { class: 'grid chunked' });
  const sentinel = h('div', { class: 'sentinel' });
  el.append(h('header', { class: 'lib-head' }, h('div', { class: 'lib-title' }, titleEl, countEl), controls), grid, sentinel);

  const prefs = store.get(`lib:${id}`, { sort: 0, filter: 'all', genre: '' });
  let parent = null;
  let base = {};
  let start = 0;
  let total = Infinity;
  let loading = false;
  let destroyed = false;
  let generation = 0;
  let observer = null;
  let genres = null;
  const showBadges = state.settings.appearance.showBadges;

  const onPlay = async (item) => {
    if (item.Type === 'Series') {
      const { episode, resume } = await resolveSeriesTarget(item.Id);
      if (episode) playItem({ itemId: episode.Id, resume });
      else toast(t('toast.noEpisodes'), { type: 'error' });
    } else {
      playItem({ itemId: item.Id, resume: true });
    }
  };

  function skeletons(n = 18) {
    const chunk = h('div', { class: 'grid-chunk' });
    for (let i = 0; i < n; i++) chunk.append(h('div', { class: 'card poster sk-card' }, h('div', { class: 'thumb sk' }), h('div', { class: 'meta' }, h('div', { class: 'sk sk-line' }))));
    grid.append(chunk);
  }

  /** Beobachter neu anlegen lassen: er meldet sich sofort, wenn das Ende der Liste im Blick ist. Noetig, weil er sich nur bei einer Aenderung meldet (siehe loadMore). */
  function rearm() {
    if (!observer || destroyed) return;
    observer.unobserve(sentinel);
    observer.observe(sentinel);
  }

  async function loadMore(reset = false) {
    if (destroyed || !parent) return;
    // Eine neue Auswahl (Filter, Sortierung, Genre) gilt sofort, auch wenn die vorige Liste noch laedt: deren Antwort verwirft die Generation unten.
    // Nur das Weiterblaettern (kein reset) wartet auf eine laufende Anfrage.
    if (loading && !reset) return;
    if (reset) {
      generation++;
      start = 0;
      total = Infinity;
      grid.replaceChildren();
    }
    if (start >= total) return;
    loading = true;
    const gen = generation;
    if (start === 0) skeletons();
    const sort = SORTS[prefs.sort] ?? SORTS[0];
    try {
      const r = await api.getItems({
        parentId: id,
        ...base,
        sortBy: sort.id === 'SortName' ? 'SortName' : `${sort.id},SortName`,
        sortOrder: sort.order,
        startIndex: start,
        limit: PAGE,
        filters: prefs.filter === 'unwatched' ? 'IsUnplayed' : prefs.filter === 'favorites' ? 'IsFavorite' : undefined,
        genres: prefs.genre || undefined
      });
      if (gen !== generation || destroyed) return;
      if (start === 0) grid.replaceChildren();
      const items = r.Items ?? [];
      total = r.TotalRecordCount ?? start + items.length;
      if (!items.length) total = start; // eine leere Seite beendet die Liste, auch wenn der Server mehr verspricht (sonst fragte das Nachladen endlos weiter)
      // Jede Seite ein eigener Block (siehe .grid-chunk im CSS)
      if (items.length) {
        const chunk = h('div', { class: 'grid-chunk' });
        items.forEach((it, i) => chunk.append(card(it, { index: i, showBadges, onPlay: isFolder(it) ? undefined : onPlay })));
        grid.append(chunk);
      }
      start += items.length;
      countEl.textContent = t('lib.count', { n: total });
      if (!items.length && start === 0) {
        grid.append(h('div', { class: 'empty' }, icon('film', 40), h('h3', null, t('lib.emptyTitle')), h('p', null, t('lib.emptyText'))));
      }
      // Alles geladen: kein Beobachter mehr noetig. Sonst weiter, solange das Ende der Liste noch im Blick ist: der Beobachter meldet sich nur bei einer Aenderung, auf einem grossen
      // Bildschirm fuellt die erste Seite den Ansichtsbereich aber nicht, dann kaeme ohne diesen Anstoss nichts mehr nach. Er wird nach jeder Seite neu angelegt (Anstoss ueber die erste Meldung).
      if (start >= total) observer?.disconnect();
      else rearm();
    } catch (e) {
      if (gen !== generation || destroyed) return;
      grid.replaceChildren(h('div', { class: 'empty error' }, icon('info', 40), h('h3', null, t('error.loadFailed')), h('p', null, e.message)));
      if (e.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
    } finally {
      if (gen === generation) loading = false; // eine veraltete Anfrage darf die laufende der neuen Auswahl nicht freigeben
    }
  }

  function buildControls() {
    controls.replaceChildren();
    const sortBtn = h('button', { class: 'btn glass sm', type: 'button' }, icon('list', 16), h('span', null, `${t('lib.sort')}: ${t(SORTS[prefs.sort].key)}`), icon('chevron-down', 14));
    sortBtn.addEventListener('click', () =>
      openMenu(
        sortBtn,
        SORTS.map((s, i) => ({ id: i, label: t(s.key), selected: i === prefs.sort })),
        {
          onPick: (e) => {
            prefs.sort = e.id;
            persist();
          }
        }
      )
    );
    const genreBtn = h('button', { class: 'btn glass sm', type: 'button' }, icon('layers', 16), h('span', null, prefs.genre || t('lib.allGenres')), icon('chevron-down', 14));
    genreBtn.addEventListener('click', async () => {
      if (!genres) genres = await api.getGenres(id, base.includeItemTypes).catch(() => []);
      openMenu(genreBtn, [{ id: '', label: t('lib.allGenres'), selected: !prefs.genre }, ...genres.map((g) => ({ id: g, label: g, selected: g === prefs.genre }))], {
        maxHeight: 420,
        onPick: (e) => {
          prefs.genre = e.id;
          persist();
        }
      });
    });
    const seg = segmented(
      [
        { value: 'all', label: t('lib.filterAll') },
        { value: 'unwatched', label: t('lib.filterUnwatched') },
        { value: 'favorites', label: t('lib.filterFav') }
      ],
      prefs.filter,
      (v) => {
        prefs.filter = v;
        persist(false);
      }
    );
    controls.append(seg, genreBtn, sortBtn);
  }

  function persist(rebuild = true) {
    store.set(`lib:${id}`, prefs);
    if (rebuild) buildControls();
    window.scrollTo?.(0, 0);
    el.parentElement?.scrollTo?.({ top: 0 });
    loadMore(true);
  }

  (async () => {
    try {
      parent = await api.getItem(id);
    } catch (e) {
      grid.replaceChildren(h('div', { class: 'empty error' }, icon('info', 40), h('h3', null, t('error.loadFailed')), h('p', null, e.message)));
      return;
    }
    if (destroyed) return;
    titleEl.textContent = parent.Name;
    base = queryFor(parent);
    buildControls();
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) loadMore();
      },
      { rootMargin: '900px 0px' }
    );
    observer.observe(sentinel);
    loadMore(true);
  })();

  return {
    el,
    destroy() {
      destroyed = true;
      observer?.disconnect();
    }
  };
}
