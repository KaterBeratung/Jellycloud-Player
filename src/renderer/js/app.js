import { h, icon, $ } from './dom.js';
import { t, setLocale } from './i18n.js';
import { state, refreshState, SUPPORTED_COLLECTIONS, activeServer, updateSettings } from './state.js';
import { applyAppearance } from './theme.js';
import { api } from './api.js';
import { route, start, refresh, navigate, invalidate } from './router.js';
import { toast, closeMenu, initialsOf } from './ui.js';
import { syncAmbient } from './ambient.js';
import { homeView } from './views/home.js';
import { libraryView } from './views/library.js';
import { detailView } from './views/detail.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';
import { loginView } from './views/login.js';
import { installNoDrag } from './no-drag.js';
import { installCompact } from './compact.js';
import { playSplash, splashEnabled, splashActive, afterSplash } from './splash.js';

installNoDrag();
installCompact(); // Handy: <html data-compact="on"> bei schmalem Fenster (im Desktop-Programm ohne Wirkung)
const root = $('#app');
let routerStarted = false;
let splashStarted = false; // die Startanimation gibt es nur beim Start der App, nicht bei jedem Neuaufbau (erneute Anmeldung, Sprache, Neu laden)
let currentLogin = null;

route(/^\/home$/, () => homeView(), { cache: true, nav: 'home' });
route(/^\/library\/(?<id>[0-9a-fA-F-]+)$/, (p) => libraryView(p), { cache: true });
route(/^\/item\/(?<id>[0-9a-fA-F-]+)$/, (p) => detailView(p));
route(/^\/search$/, (p) => searchView(p), { nav: 'search' });
route(/^\/settings(?:\/(?<section>\w+))?$/, (p) => settingsView(p), { nav: 'settings' });
route(/^\/admin(?:\/(?<section>\w+))?$/, (p) => adminView(p), { nav: 'admin' });

function localeFromSettings() {
  const l = state.settings?.language;
  return l && l !== 'auto' ? l : state.locale || navigator.language;
}

function showLogin({ cancellable = false, message = '' } = {}) {
  currentLogin?.destroy?.();
  closeMenu();
  shellCleanup?.(); // der Rahmen weicht der Anmeldung
  shellCleanup = null;
  const done = async () => {
    invalidate();
    location.hash = '#/home';
    await boot();
  };
  currentLogin = loginView({
    onDone: done,
    onCancel: cancellable ? () => boot() : undefined
  });
  root.replaceChildren(h('div', { class: 'drag-strip' }), currentLogin.el);
  if (message) toast(message, { type: 'error' });
}

function navItems() {
  const items = [{ key: 'home', path: '/home', label: t('nav.home'), match: /^\/home/ }];
  for (const v of state.views.filter((x) => SUPPORTED_COLLECTIONS.has(x.CollectionType))) {
    items.push({ key: v.Id, path: `/library/${v.Id}`, label: v.Name, match: new RegExp(`^/library/${v.Id}`) });
  }
  return items;
}

const TAB_ICONS = { movies: 'film', tvshows: 'tv', music: 'music' };
/**
 * Tab-Leiste unten fuer das Handy (nur ausserhalb des Desktop-Programms gebaut; sichtbar nur in der kompakten Ansicht, siehe app.css):
 * Start, bis zu drei Bibliotheken, Suche, Einstellungen. Weitere Bibliotheken erreicht man ueber die Reihentitel der Startseite und die Suche.
 */
function buildTabbar() {
  const libs = state.views.filter((x) => SUPPORTED_COLLECTIONS.has(x.CollectionType)).slice(0, 3);
  const defs = [
    { path: '/home', label: t('nav.home'), ico: 'home', match: /^\/home/ },
    ...libs.map((v) => ({ path: `/library/${v.Id}`, label: v.Name, ico: TAB_ICONS[v.CollectionType] ?? 'folder', match: new RegExp(`^/library/${v.Id}`) })),
    { path: '/search', label: t('nav.search'), ico: 'search', match: /^\/search/ },
    { path: '/settings', label: t('nav.settings'), ico: 'settings', match: /^\/(settings|admin)/ }
  ];
  const items = defs.map((d) => {
    const a = h('a', { class: 'tabbar-item', href: `#${d.path}` }, icon(d.ico, 24), h('span', null, d.label));
    a._match = d.match;
    return a;
  });
  return { el: h('nav', { class: 'tabbar', 'aria-label': 'Tab-Leiste' }, items), items };
}

// Punkt am Zahnrad, solange ein Update gefunden, geladen oder bereit ist (wird von buildShell belegt)
let paintUpdateDot = () => {};
let shellCleanup = null; // raeumt die Zuhoerer des zuletzt gebauten Rahmens ab (buildShell)

function buildShell() {
  const brand = h('a', { class: 'brand', href: '#/home', 'aria-label': 'Jellycloud Player' }, h('span', { class: 'brand-mark sm' }, icon('cloud-logo', 30)), h('span', { class: 'brand-name' }, 'Jellycloud'));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' });
  const indicator = h('span', { class: 'nav-indicator hidden' });
  nav.append(indicator);
  const links = navItems().map((it) => {
    const a = h('a', { class: 'nav-link', href: `#${it.path}` }, it.label);
    a._item = it;
    nav.append(a);
    return a;
  });

  // Rechte Kapsel: gleiche Hoehe und gleiche Bauart wie die linke; darin drei gleich grosse Scheiben (Suche, Einstellungen, Konto)
  const tools = h('div', { class: 'tools toolpill' });
  const search = h('a', { class: 'tool', href: '#/search', title: `${t('nav.search')} (Strg+K)`, 'aria-label': t('nav.search') }, icon('search', 20));
  const reload = h('button', { class: 'tool', type: 'button', title: `${t('action.reload')} (F5)`, 'aria-label': t('action.reload'), onclick: () => reloadData() }, icon('refresh', 20));
  const settings = h('a', { class: 'tool', href: '#/settings', title: t('nav.settings'), 'aria-label': t('nav.settings') }, icon('settings', 20));
  // Verwaltung nur fuer Administratoren: gleiche runde Scheibe wie die anderen, vor den Einstellungen
  const admin = state.isAdmin ? h('a', { class: 'tool', href: '#/admin', title: t('nav.admin'), 'aria-label': t('nav.admin') }, icon('shield', 20)) : null;
  const srv = activeServer();
  const who = h('button', { class: 'tool who', type: 'button', title: srv ? `${srv.userName} @ ${srv.name || srv.url}` : '', 'aria-label': t('nav.account'), onclick: () => navigate('/settings/account') }, h('span', { class: 'avatar-sm' }, initialsOf(srv?.userName)));
  tools.append(search, reload, ...(admin ? [admin] : []), settings, who);
  // Versionshinweis in Gruen unter dem Konto (rechtsbuendig unter der Kapsel), solange ein Update gefunden, geladen oder bereit ist
  const updateNote = h('a', { class: 'update-note', href: '#/settings/about', hidden: true });

  // Die Navigation ist eine Glas-Kapsel (Hoehe wie das Logo); die Marke steht als eigene Kapsel links
  const pill = h('div', { class: 'navpill' }, nav);
  // Zwei Zeilen: ganz oben die Titelzeile (Ziehflaeche + System-Fensterknoepfe), darunter Marke, Kapsel und Icons
  // Marke links, Kapsel mittig (wie die Tab-Leiste in Apple TV), Werkzeuge rechts; der freie Platz daneben bleibt Ziehflaeche
  const topbar = h('header', { class: 'topbar' }, h('div', { class: 'titlebar' }), h('div', { class: 'navrow' }, h('div', { class: 'navrow-start' }, brand, h('span', { class: 'grow' })), pill, h('div', { class: 'navrow-end' }, h('span', { class: 'grow' }), tools, updateNote)));
  const view = h('main', { id: 'view', tabindex: '-1' });
  const tabbar = state.platform !== 'desktop' ? buildTabbar() : null; // im Windows-Programm gibt es sie nicht
  root.replaceChildren(topbar, view, ...(tabbar ? [tabbar.el] : []));

  const place = (target) => {
    if (!target) {
      indicator.classList.add('hidden');
      return;
    }
    indicator.classList.remove('hidden');
    indicator.style.width = `${target.offsetWidth}px`;
    indicator.style.transform = `translateX(${target.offsetLeft}px)`;
  };
  const markActive = (info) => {
    const path = info?.path ?? '/home';
    let active = null;
    for (const a of links) {
      const on = a._item.match.test(path);
      a.classList.toggle('on', on);
      if (on) active = a;
    }
    search.classList.toggle('on', path.startsWith('/search'));
    settings.classList.toggle('on', path.startsWith('/settings'));
    admin?.classList.toggle('on', path.startsWith('/admin'));
    for (const a of tabbar?.items ?? []) {
      const on = a._match.test(path);
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    place(active);
  };
  // Den Rahmen baut jede Anmeldung, Sprachwahl und jedes harte Neuladen neu auf: die Zuhoerer des vorigen Rahmens muessen weg, sonst bleibt er samt Ansicht im Speicher und jede Seite
  // laeuft durch eine wachsende Zahl veralteter Zuhoerer
  shellCleanup?.();
  const onRoute = (e) => {
    markActive(e.detail);
    paintUpdateDot();
    syncAmbient(view.firstElementChild); // Hintergrundton der jetzt sichtbaren Ansicht (oder ausblenden)
  };
  document.addEventListener('route', onRoute);
  const resizeObserver = new ResizeObserver(() => place(links.find((a) => a.classList.contains('on'))));
  resizeObserver.observe(nav);
  shellCleanup = () => {
    document.removeEventListener('route', onRoute);
    resizeObserver.disconnect();
  };

  paintUpdateDot = () => {
    const u = state.update;
    const pending = ['available', 'downloading', 'ready'].includes(u?.status);
    settings.classList.toggle('has-update', pending);
    const title = pending ? `${t('nav.settings')} · ${t('upd.dotTitle', { v: u.version })}` : t('nav.settings');
    settings.title = title;
    settings.setAttribute('aria-label', title);
    // Der Hinweis unter dem Konto fuehrt zu Einstellungen > Info und ist dort ueberfluessig (dort steht alles ausfuehrlich)
    updateNote.hidden = !pending || location.hash.startsWith('#/settings/about');
    if (pending) {
      updateNote.textContent = t('upd.badge'); // nur "Update verfuegbar"; die Versionsnummer steht im Tooltip und auf der Info-Seite
      updateNote.title = t('upd.dotTitle', { v: u.version });
      updateNote.dataset.status = u.status;
    }
  };
  paintUpdateDot();

  let ticking = false;
  view.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        topbar.classList.toggle('scrolled', view.scrollTop > 24);
        ticking = false;
      });
    },
    { passive: true }
  );
}

async function boot() {
  closeMenu();
  try {
    await refreshState();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'fatal' }, h('h2', null, t('error.startFailed')), h('p', null, e.message)));
    return;
  }
  setLocale(localeFromSettings());
  applyAppearance(state.settings.appearance);
  if (!splashStarted) {
    splashStarted = true;
    if (splashEnabled(state.settings.appearance)) playSplash(state.settings.appearance); // darunter baut sich die Oberflaeche ganz normal auf
  }
  if (!state.loggedIn) return showLogin();
  try {
    // Bibliotheken und Rechte des Kontos zusammen holen; ob es Administrator ist, steht in seiner Richtlinie (ein Fehler dabei heisst: kein Administrator)
    [state.views, state.isAdmin] = await Promise.all([api.getViews(), api.getMe().then((me) => !!me?.Policy?.IsAdministrator).catch(() => false)]);
  } catch (e) {
    return showLogin({ message: e.status === 401 ? t('toast.sessionExpired') : e.message });
  }
  buildShell();
  if (state.justUpdated && !announcedUpdate) {
    announcedUpdate = true;
    afterSplash(() => toast(t('upd.done', { v: state.appVersion }))); // unter der Startanimation sah man ihn nicht
  }
  if (!/^#\/(home|library|item|search|settings|admin)/.test(location.hash)) location.hash = '#/home';
  if (!state.isAdmin && /^#\/admin/.test(location.hash)) location.hash = '#/home';
  if (routerStarted) await refresh();
  else {
    routerStarted = true;
    await start();
  }
  // Ein Update, das schon vor der Anmeldung oder dem Aufbau gefunden wurde, meldet sich jetzt (der Punkt am Zahnrad ist ohnehin da)
  afterSplash(() => setTimeout(announceUpdate, 1500));
}

// ---------- Neu laden ----------

let reloading = false;
/**
 * Holt die Daten der sichtbaren Ansicht neu vom Server (F5, Knopf, "Mehr"-Menue). Mit hard (Strg+Umschalt+R) wird zusaetzlich der
 * Bildspeicher geleert und alles neu aufgebaut, etwa wenn sich Bibliotheken oder Bilder auf dem Server geaendert haben.
 */
async function reloadData({ hard = false } = {}) {
  if (!state.loggedIn || reloading) return;
  reloading = true;
  try {
    if (hard) {
      await window.jc.clearCache().catch(() => {});
      await boot();
    } else {
      await refresh();
    }
    toast(t('toast.reloaded'));
  } finally {
    reloading = false;
  }
}
document.addEventListener('reload-data', () => reloadData());

// ---------- globale Ereignisse ----------

document.addEventListener('session-expired', () => showLogin({ message: t('toast.sessionExpired') }));
document.addEventListener('relogin', () => {
  invalidate();
  boot();
});
document.addEventListener('add-server', () => showLogin({ cancellable: true }));
document.addEventListener('relocalize', () => boot());

// ---------- Updates ----------

let announcedUpdate = false; // "Aktualisiert auf ..." nur einmal je Start
let notifiedVersion = null; // fuer diese Version wurde der Hinweis in diesem Lauf schon gezeigt

/**
 * Hinweis auf ein gefundenes Update, so dass er nicht nervt: hoechstens EINMAL JE VERSION (gemerkt in den Einstellungen, auch ueber Neustarts), kurz und ohne Zwang;
 * danach bleibt nur der kleine Punkt am Zahnrad. Er erscheint nur, wenn man ihn sieht und nichts stoert: Fenster sichtbar (nicht minimiert), keine Wiedergabe und kein Start der Wiedergabe.
 * Sonst wartet er, bis das Fenster wieder sichtbar ist oder der Film zu Ende. Auf der Info-Seite steht das Ergebnis ohnehin, dort gibt es keinen Hinweis (die Version gilt trotzdem als gesehen).
 */
function announceUpdate() {
  const s = state.update;
  if (s?.status !== 'available' || !state.loggedIn || !$('#view')) return;
  if (notifiedVersion === s.version || state.settings?.general?.updateSeen === s.version) return;
  const html = document.documentElement;
  if (document.visibilityState !== 'visible' || html.classList.contains('playing') || html.classList.contains('is-starting') || splashActive()) return;
  notifiedVersion = s.version;
  updateSettings({ general: { updateSeen: s.version } }).catch(() => {});
  if (location.hash.startsWith('#/settings/about')) return;
  toast(t('upd.found', { v: s.version }), { action: { label: t('upd.show'), run: () => navigate('/settings/about') }, duration: 9000 });
}
window.jc.onUpdateState((s) => {
  state.update = s;
  paintUpdateDot();
  document.dispatchEvent(new CustomEvent('update-state'));
  announceUpdate();
});
document.addEventListener('visibilitychange', announceUpdate);

// Waehrend der Wiedergabe liegt das Video ueber der Oberflaeche: Animationen dahinter anhalten (spart GPU).
window.jc.onPlayerActive((on) => document.documentElement.classList.toggle('playing', on));

window.jc.onPlayerClosed(() => {
  invalidate();
  refresh();
  setTimeout(announceUpdate, 1500); // ein waehrend des Films gefundenes Update meldet sich erst danach
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (!state.loggedIn || !$('#view')) return;
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    reloadData({ hard: e.shiftKey });
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    navigate('/search');
  } else if (!typing && e.key === '/') {
    e.preventDefault();
    navigate('/search');
  } else if (!typing && (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft'))) {
    e.preventDefault();
    history.back();
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
});

boot();
