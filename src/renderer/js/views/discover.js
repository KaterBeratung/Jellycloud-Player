// Seite hinter "Beliebte Filme" und "Beliebte Serien" der Startseite (wie SeerrBrowseRoute der Apple-App, Build 94): dieselbe Liste von Seerr als Raster,
// seitenweise nachgeladen, wahlweise auf ein Genre beschraenkt (GET /discover/movies|tv?page=&genre=). Aufbau wie das Raster der Mediathek (library.js):
// Titel, Wahl des Genres oben rechts, Karten zum Anfragen (request-card.js). Jeder Titel einmal (TMDB wiederholt Titel ueber Seitengrenzen).
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { openMenu, pageStatus } from '../ui.js';
import { requestCard } from './request-card.js';

const HomeRows = window.JCHomeRows;

export function discoverView({ type }) {
  const movies = type === 'movie';
  const rowId = movies ? 'seerrPopularMovies' : 'seerrPopularSeries';
  const path = HomeRows.DISCOVER[rowId].path;
  const el = h('div', { class: 'page library discover', 'data-glow': 'requests' });
  const titleEl = h('h1', null, t(`home.${rowId}`));
  const controls = h('div', { class: 'lib-controls' });
  const grid = h('div', { class: 'grid chunked' });
  const sentinel = h('div', { class: 'sentinel' });
  el.append(h('header', { class: 'lib-head' }, h('div', { class: 'lib-title' }, titleEl), controls), grid, sentinel);

  let genre = null; // { id, name } oder null (alle)
  let genres = null;
  let page = 0;
  let hasMore = true;
  let loading = false;
  let loadError = null;
  let destroyed = false;
  let generation = 0;
  const seen = new Set();

  function skeletons(n = 18) {
    const chunk = h('div', { class: 'grid-chunk' });
    for (let i = 0; i < n; i++) chunk.append(h('div', { class: 'card poster sk-card' }, h('div', { class: 'thumb sk' }), h('div', { class: 'meta' }, h('div', { class: 'sk sk-line' }))));
    grid.append(chunk);
  }

  const observer = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && loadMore(), { rootMargin: '900px 0px' });
  const rearm = () => {
    if (destroyed) return;
    observer.unobserve(sentinel);
    observer.observe(sentinel);
  };

  async function loadMore(reset = false) {
    if (destroyed) return;
    if ((loading || loadError) && !reset) return;
    if (reset) {
      generation++;
      page = 0;
      hasMore = true;
      loadError = null;
      seen.clear();
      grid.replaceChildren();
    }
    if (!hasMore) return;
    loading = true;
    const gen = generation;
    if (page === 0) skeletons();
    try {
      const r = await window.jc.seerrDiscover({ path, page: page + 1, genre: genre?.id ?? null });
      if (gen !== generation || destroyed) return;
      if (page === 0) grid.replaceChildren();
      page = r.page;
      const fresh = r.titles.filter((x) => !seen.has(x.id));
      fresh.forEach((x) => seen.add(x.id));
      // Eine Seite ohne neue Titel beendet die Liste, auch wenn Seerr mehr verspricht (sonst fragte das Nachladen endlos weiter)
      hasMore = r.hasMore && fresh.length > 0;
      if (fresh.length) {
        const chunk = h('div', { class: 'grid-chunk' });
        fresh.forEach((x, i) => chunk.append(requestCard(x, i)));
        grid.append(chunk);
      }
      if (!seen.size) grid.append(pageStatus({ symbol: 'film', title: t('discover.emptyTitle'), text: t('discover.emptyText') }));
      if (hasMore) rearm();
      else observer.disconnect();
    } catch (e) {
      if (gen !== generation || destroyed || e.code === 'SEERR_STALE') return;
      if (page === 0) {
        loadError = pageStatus({ kind: 'failed', text: e.message, retry: () => loadMore(true) });
        grid.replaceChildren(loadError);
      } else {
        loadError = pageStatus({ kind: 'failed', text: e.message, inline: true, retry: () => {
          loadError?.remove();
          loadError = null;
          return loadMore();
        } });
        grid.append(loadError);
      }
    } finally {
      if (gen === generation) loading = false;
    }
  }

  function buildControls() {
    const btn = h('button', { class: 'btn glass sm', type: 'button', 'data-action': 'genre' }, icon('layers', 16), h('span', null, genre?.name ?? t('lib.allGenres')), icon('chevron-down', 14));
    btn.addEventListener('click', async () => {
      if (!genres) genres = await window.jc.seerrGenres(movies ? 'movie' : 'tv').catch(() => []);
      if (destroyed) return;
      openMenu(btn, [{ id: 0, label: t('lib.allGenres'), selected: !genre }, ...genres.map((g) => ({ id: g.id, label: g.name, selected: g.id === genre?.id }))], {
        maxHeight: 420,
        onPick: (e) => {
          genre = e.id ? genres.find((g) => g.id === e.id) ?? null : null;
          buildControls();
          el.parentElement?.scrollTo?.({ top: 0 });
          loadMore(true);
        }
      });
    });
    controls.replaceChildren(btn);
  }

  buildControls();
  observer.observe(sentinel);
  loadMore(true);
  return {
    el,
    destroy() {
      destroyed = true;
      observer.disconnect();
    }
  };
}
