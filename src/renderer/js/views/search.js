import { h, icon, $ } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { card, pageStatus } from '../ui.js';
import { debounce } from '../utils.js';
import { playItem } from '../actions.js';
import { closeRequestDetail } from './request-detail.js';
import { requestCard } from './request-card.js';

const SEERR_AVAILABLE = 5;

export function searchView({ query }) {
  const el = h('div', { class: 'page search', 'data-glow': 'search' });
  const input = h('input', { class: 'search-input', type: 'search', placeholder: t('search.placeholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('nav.search') });
  input.value = query?.get('q') ?? '';
  const results = h('div', { class: 'search-results' });
  el.append(h('div', { class: 'search-bar' }, icon('search', 22), input), results);

  let gen = 0;
  let destroyed = false;
  const onPlay = (item) => playItem({ itemId: item.Id, resume: true });

  /** Titel, die es noch nicht gibt: bei Seerr suchen (laeuft nach den Treffern aus der Bibliothek, haelt sie nicht auf). */
  async function addRequests(q, my, noneLocal) {
    if (!state.seerr) return;
    let list;
    try {
      list = (await window.jc.seerrSearch(q)).filter((r) => r.status !== SEERR_AVAILABLE); // "verfuegbar" steht schon in den Treffern der Bibliothek
    } catch (e) {
      if (my !== gen || destroyed) return;
      const msg = e.code === 'SEERR_AUTH' ? t('seerr.authExpired') : t('seerr.error', { msg: e.message });
      results.append(h('p', { class: 'seerr-note' }, msg, e.code === 'SEERR_AUTH' ? h('a', { class: 'link-btn', href: '#/settings/seerr' }, ` ${t('toast.openSettings')}`) : null));
      return;
    }
    if (my !== gen || destroyed || !list.length) return;
    const grid = h('div', { class: 'grid' });
    list.forEach((r, i) => grid.append(requestCard(r, i)));
    results.append(
      h('section', { class: 'search-group seerr-group' }, h('div', { class: 'row-head' }, h('h2', null, t('seerr.group')), h('span', { class: 'sub' }, String(list.length))), noneLocal ? h('p', { class: 'seerr-note' }, t('seerr.hintNone')) : null, grid)
    );
  }

  async function run(q) {
    q = q.trim();
    const my = ++gen;
    history.replaceState(null, '', q ? `#/search?q=${encodeURIComponent(q)}` : '#/search');
    if (!q) {
      results.classList.remove('busy'); // eine noch laufende Suche ist damit veraltet und raeumt es nicht mehr selbst ab
      results.replaceChildren(pageStatus({ symbol: 'search', title: t('search.hintTitle'), text: t('search.hintText') }));
      return;
    }
    results.classList.add('busy');
    try {
      const items = await api.search(q, 60);
      if (my !== gen || destroyed) return;
      results.classList.remove('busy');
      results.replaceChildren();
      if (!items.length) {
        // Ohne Seerr der Leerzustand der ganzen Seite, mit Seerr ein Hinweis im Inhalt und darunter gleich der Weg zur Anfrage
        if (!state.seerr) results.append(pageStatus({ symbol: 'search', title: t('search.noneTitle', { q }), text: t('search.noneText') }));
        else results.append(pageStatus({ symbol: 'search', title: t('search.noneLocal', { q }), inline: true }));
        addRequests(q, my, true);
        return;
      }
      const groups = [
        ['Movie', t('search.movies')],
        ['Series', t('search.series')],
        ['BoxSet', t('search.collections')],
        ['Episode', t('search.episodes')]
      ];
      for (const [type, label] of groups) {
        const list = items.filter((i) => i.Type === type);
        if (!list.length) continue;
        const grid = h('div', { class: 'grid' });
        list.forEach((it, i) => grid.append(card(it, { index: i, onPlay })));
        results.append(h('section', { class: 'search-group' }, h('div', { class: 'row-head' }, h('h2', null, label), h('span', { class: 'sub' }, String(list.length))), grid));
      }
      addRequests(q, my, false);
    } catch (e) {
      if (my !== gen || destroyed) return;
      results.classList.remove('busy');
      results.replaceChildren(pageStatus({ kind: 'failed', text: e.message, retry: () => run(input.value) }));
    }
  }

  const debounced = debounce(() => run(input.value), 260);
  input.addEventListener('input', debounced);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      debounced.cancel();
      run(input.value);
    }
  });
  run(input.value);
  requestAnimationFrame(() => input.focus({ preventScroll: true }));

  return {
    el,
    destroy() {
      destroyed = true;
      debounced.cancel();
      closeRequestDetail();
    },
    focus: () => $('.search-input', el)?.focus()
  };
}
