import { $ } from './dom.js';

/**
 * Minimaler Hash-Router.
 * Eine View ist ein Objekt { el: HTMLElement, destroy?: () => void }. Views duerfen ihren Inhalt asynchron
 * nachladen. Mit cache:true bleibt die View beim Verlassen erhalten (schnelles Zurueck, Scrollposition bleibt); dann ruft der Router
 * beim Verlassen deactivate() und beim Zurueckkommen activate() der View auf (optional), damit Zeitgeber und Wiedergabe nicht im Hintergrund weiterlaufen.
 */
const routes = [];
const cache = new Map();
const CACHE_LIMIT = 6;
let current = null;
let sharedEl = null;

export function route(pattern, factory, { cache: cacheable = false, nav = null } = {}) {
  routes.push({ re: pattern, factory, cacheable, nav });
}

export const navigate = (path) => {
  location.hash = `#${path}`;
};

/** Markiert ein Element fuer den Shared-Element-Uebergang (Poster -> Detailseite). */
export function markSharedElement(el) {
  if (!document.startViewTransition || document.documentElement.dataset.anim === 'off') return;
  sharedEl?.style.removeProperty('view-transition-name');
  sharedEl = el;
  el.style.viewTransitionName = 'poster';
}

export function invalidate() {
  for (const c of cache.values()) c.view.destroy?.();
  cache.clear();
}

export function refresh() {
  invalidate();
  if (current) {
    current.view.destroy?.();
    current = null;
  }
  return render();
}

export function currentRoute() {
  return current?.info ?? null;
}

function parse(hash) {
  const [path, query = ''] = hash.split('?');
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) return { r, params: { ...(m.groups ?? {}), query: new URLSearchParams(query) }, path };
  }
  return null;
}

function replay(el) {
  el.classList.remove('page-enter');
  void el.offsetWidth;
  el.classList.add('page-enter');
}

// Nummer der juengsten Navigation. Beim Uebergang mit Poster (startViewTransition) wird der Seitenwechsel erst einen Augenblick spaeter ausgefuehrt; kommt in der Zeit schon die naechste
// Navigation (etwa "Zurueck" gleich nach dem Klick), muss der veraltete Wechsel entfallen. Sonst steht die Seite des Klicks da, obwohl die Adresse schon wieder die alte ist.
let seq = 0;

async function render() {
  const mine = ++seq;
  const hash = location.hash.slice(1) || '/home';
  const hit = parse(hash) ?? parse('/home');
  if (!hit) return;
  const host = $('#view');
  if (!host) return;
  if (current?.hash === hash) return;

  const swap = () => {
    if (mine !== seq) return; // von einer neueren Navigation ueberholt
    if (current) {
      if (current.cacheable) {
        current.view.deactivate?.(); // bleibt nur im Speicher: Zeitgeber und Wiedergabe (Trailer) pausieren
        cache.set(current.hash, { view: current.view, scroll: host.scrollTop, info: current.info });
        while (cache.size > CACHE_LIMIT) {
          const [k, v] = cache.entries().next().value;
          v.view.destroy?.();
          cache.delete(k);
        }
      } else {
        current.view.destroy?.();
      }
    }
    const cached = cache.get(hash);
    let view;
    let scroll = 0;
    if (cached) {
      view = cached.view;
      scroll = cached.scroll;
      cache.delete(hash);
    } else {
      view = hit.r.factory(hit.params);
    }
    host.replaceChildren(view.el);
    host.scrollTop = scroll;
    replay(view.el);
    if (cached) view.activate?.(); // wieder im Dokument: pausierte Zeitgeber und Wiedergabe fortsetzen
    current = { hash, view, cacheable: hit.r.cacheable, info: { path: hit.path, nav: hit.r.nav, params: hit.params } };
    document.dispatchEvent(new CustomEvent('route', { detail: current.info }));
  };

  const animate = document.startViewTransition && document.documentElement.dataset.anim !== 'off' && sharedEl;
  if (animate) {
    const vt = document.startViewTransition(swap);
    try {
      await vt.finished;
    } catch {
      /* Uebergang abgebrochen */
    }
    sharedEl?.style.removeProperty('view-transition-name');
    sharedEl = null;
  } else {
    sharedEl = null;
    swap();
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  return render();
}
