import { h, icon, $ } from './dom.js';
import { t, setLocale } from './i18n.js';
import { state, refreshState, activeServer, updateSettings } from './state.js';
import { applyAppearance } from './theme.js';
import { api } from './api.js';
import { route, start, refresh, navigate, invalidate } from './router.js';
import { toast, closeMenu, initialsOf, pageStatus, openMenu, confirmDialog } from './ui.js';
import { closeQuickConnect, openQuickConnect } from './views/quick-connect.js';
import { requestsView } from './views/requests.js';
import { syncAmbient } from './ambient.js';
import { syncGlow } from './glow.js';
import { homeView } from './views/home.js';
import { libraryView } from './views/library.js';
import { detailView } from './views/detail.js';
import { seerrTitleView } from './views/seerr-title.js';
import { personView } from './views/person.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';
import { loginView } from './views/login.js';
import { installNoDrag } from './no-drag.js';
import { installCompact } from './compact.js';
import { playSplash, splashActive, afterSplash } from './splash.js';
import { installMotion } from './motion.js';
import { runConnectionCheck } from './connection.js';

installNoDrag();
installMotion(); // Bewegung nur nach der Systemeinstellung "Bewegung reduzieren" (data-anim)
installCompact(); // Handy: <html data-compact="on"> bei schmalem Fenster (im Desktop-Programm ohne Wirkung)
const root = $('#app');
let routerStarted = false;
let splashStarted = false; // die Startanimation gibt es nur beim Start der App, nicht bei jedem Neuaufbau (erneute Anmeldung, Sprache, Neu laden)
let currentLogin = null;

const Nav = window.JCNav; // die fuenf Reiter (src/shared/nav.js), die einzige Stelle dafuer

route(/^\/home$/, () => homeView(), { cache: true, nav: 'home' });
route(/^\/movies$/, () => libraryView({ tab: 'movies' }), { cache: true, nav: 'movies' });
route(/^\/shows$/, () => libraryView({ tab: 'shows' }), { cache: true, nav: 'shows' });
route(/^\/requests$/, () => requestsView(), { nav: 'requests' });
route(/^\/library\/(?<id>[0-9a-fA-F-]+)$/, (p) => libraryView(p), { cache: true }); // von der Startseite geoeffnet ("Neu in ...")
route(/^\/item\/(?<id>[0-9a-fA-F-]+)$/, (p) => detailView(p));
route(/^\/seerr\/(?<type>movie|tv)\/(?<id>\d{1,9})$/, (p) => seerrTitleView(p)); // Seite eines Seerr-Titels (seerr-open.js oeffnet sie)
route(/^\/person\/tmdb\/(?<tmdb>\d{1,9})$/, (p) => personView(p)); // Seite einer Person aus der Besetzung eines Seerr-Titels (Nummer bei TMDB)
route(/^\/person\/(?<id>[0-9a-fA-F-]{8,40})$/, (p) => personView(p)); // Seite einer Person der Mediathek
route(/^\/search$/, (p) => searchView(p), { nav: 'search' });
route(/^\/settings(?:\/(?<section>\w+))?$/, (p) => settingsView(p), { nav: 'settings' });
route(/^\/admin(?:\/(?<section>\w+))?$/, (p) => adminView(p), { nav: 'admin' });

function localeFromSettings() {
  const l = state.settings?.language;
  return l && l !== 'auto' ? l : state.locale || navigator.language;
}

function showLogin({ cancellable = false, message = '' } = {}) {
  currentLogin?.destroy?.();
  currentLogin = null;
  closeMenu();
  closeQuickConnect();
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
  syncGlow(currentLogin.el); // Bereich Anmeldung
  if (message) toast(message, { type: 'error' });
}

/**
 * Tab-Leiste unten fuer das Handy (nur ausserhalb des Desktop-Programms gebaut; sichtbar nur in der kompakten Ansicht, siehe app.css): dieselben
 * fuenf Reiter wie die Kapsel am Desktop (Start, Filme, Serien, Anfragen, Suche). Die Einstellungen sind kein Reiter (Profilmenue oben rechts).
 */
function buildTabbar() {
  const items = Nav.TABS.map((tab) => {
    const a = h('a', { class: 'tabbar-item', href: `#${tab.path}` }, icon(tab.icon, 24), h('span', null, t(tab.label)));
    a._tab = tab.key;
    return a;
  });
  return { el: h('nav', { class: 'tabbar', 'aria-label': t('nav.tabs') }, items), items };
}

/**
 * Profilmenue am Profilsymbol (wie die Apple-App, Notiz design-system "Profilmenue"): Abschnitt Profile (der Haken beim aktiven, darunter
 * "Aktiv · Adresse"; die anderen mit ihrer Adresse), dann Quick Connect, Server oder Profil hinzufuegen, Einstellungen und zuletzt Abmelden.
 * Haken und Symbole stehen in einer Spalte. (Mitteilungen kommen mit Paket P17 dazu, nur mit Seerr.)
 */
function openProfileMenu(anchor) {
  const max = state.maxProfiles ?? 4;
  const entries = [
    { header: true, label: t('acct.profiles') },
    ...state.servers.map((s) => {
      const on = s.id === state.activeServerId;
      return { id: 'profile', profile: s.id, label: s.label || s.userName, sub: on ? `${t('set.active')} · ${s.url}` : s.url, selected: on };
    }),
    { separator: true },
    { id: 'qc', label: t('qc.title'), icon: 'qc' },
    { id: 'add', label: t('acct.add'), icon: 'plus' },
    { id: 'settings', label: t('nav.settings'), icon: 'settings' },
    { separator: true },
    { id: 'signout', label: t('set.signOut'), icon: 'logout', danger: true }
  ];
  openMenu(anchor, entries, {
    align: 'right',
    minWidth: 280,
    maxHeight: 640,
    columns: false,
    onPick: async (e) => {
      if (e.id === 'profile') {
        if (e.profile === state.activeServerId) return;
        try {
          await window.jc.switchServer(e.profile);
          document.dispatchEvent(new CustomEvent('relogin'));
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      } else if (e.id === 'qc') {
        openQuickConnect({ onSignedOut: () => document.dispatchEvent(new CustomEvent('session-expired')) });
      } else if (e.id === 'add') {
        // Voll (vier Profile): der Hinweis gleich hier, statt erst nach der Anmeldung (die der Server dann wieder abmelden muesste)
        if (state.servers.length >= max) toast(t('login.profileLimit', { n: max }), { type: 'error' });
        else document.dispatchEvent(new CustomEvent('add-server'));
      } else if (e.id === 'settings') {
        navigate('/settings');
      } else if (e.id === 'signout') {
        if (!(await confirmDialog({ title: t('acct.signOutTitle'), text: t('acct.signOutText'), confirmLabel: t('set.signOut'), danger: true }))) return;
        try {
          await window.jc.logout();
          document.dispatchEvent(new CustomEvent('relogin'));
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      }
    }
  });
}

// Punkt am Zahnrad, solange ein Update gefunden, geladen oder bereit ist (wird von buildShell belegt)
let paintUpdateDot = () => {};
let shellCleanup = null; // raeumt die Zuhoerer des zuletzt gebauten Rahmens ab (buildShell)

function buildShell() {
  closeQuickConnect(); // eine offene Maske gehoert zum alten Rahmen
  currentLogin?.destroy?.(); // die Anmeldung (oder der Hinweis "nicht erreichbar") weicht dem Rahmen
  currentLogin = null;
  const brand = h('a',{ class: 'brand', href: '#/home', 'aria-label': 'Jellycloud Player' }, h('span', { class: 'brand-mark sm' }, icon('cloud-logo', 30)), h('span', { class: 'brand-name' }, 'Jellycloud'));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' });
  const indicator = h('span', { class: 'nav-indicator hidden' });
  nav.append(indicator);
  // Die fuenf Reiter (Start, Filme, Serien, Anfragen, Suche), immer alle; Strg+1 bis Strg+5 waehlen sie. Ein Klick auf den schon gewaehlten
  // Reiter fuehrt an den Anfang seiner Seite zurueck.
  const links = Nav.TABS.map((tab, i) => {
    const a = h('a', { class: 'nav-link', href: `#${tab.path}`, title: `${t(tab.label)} (Strg+${i + 1})` }, t(tab.label));
    a._tab = tab.key;
    nav.append(a);
    return a;
  });
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('.nav-link');
    if (a && location.hash === a.getAttribute('href')) view.scrollTo({ top: 0, behavior: document.documentElement.dataset.anim === 'reduced' ? 'auto' : 'smooth' });
  });

  // Rechte Kapsel (Entscheidung E9): Neu laden, Verwaltung (nur Administratoren), Einstellungen (dort haengt der Update-Punkt) und das Profilsymbol
  // mit dem Profilmenue; gleich grosse runde Scheiben, gleiche Hoehe und Bauart wie die Kapsel der Reiter
  const tools = h('div', { class: 'tools toolpill' });
  const reload = h('button', { class: 'tool', type: 'button', title: `${t('action.reload')} (F5)`, 'aria-label': t('action.reload'), onclick: () => reloadData() }, icon('refresh', 20));
  const settings = h('a', { class: 'tool', href: '#/settings', title: t('nav.settings'), 'aria-label': t('nav.settings') }, icon('settings', 20));
  const admin = state.isAdmin ? h('a', { class: 'tool', href: '#/admin', title: t('nav.admin'), 'aria-label': t('nav.admin') }, icon('shield', 20)) : null;
  const srv = activeServer();
  const who = h('button', { class: 'tool who', type: 'button', 'aria-haspopup': 'menu', title: srv ? `${srv.label || srv.userName} @ ${srv.name || srv.url}` : '', 'aria-label': t('nav.profileMenu') }, h('span', { class: 'avatar-sm' }, initialsOf(srv?.label || srv?.userName)));
  who.addEventListener('click', () => openProfileMenu(who));
  tools.append(reload, ...(admin ? [admin] : []), settings, who);
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
  // Der gewaehlte Reiter bleibt gewaehlt, solange eine Seite aus ihm offen ist (Detailseite, Mediathek, Einstellungen), wie in der Apple-App
  let currentTab = 'home';
  const markActive = (info) => {
    const path = info?.path ?? '/home';
    if (Nav.TABS.some((x) => x.key === info?.nav)) currentTab = info.nav;
    let active = null;
    for (const a of links) {
      const on = a._tab === currentTab;
      a.classList.toggle('on', on);
      if (on) {
        a.setAttribute('aria-current', 'page');
        active = a;
      } else a.removeAttribute('aria-current');
    }
    settings.classList.toggle('on', path.startsWith('/settings'));
    admin?.classList.toggle('on', path.startsWith('/admin'));
    for (const a of tabbar?.items ?? []) {
      const on = a._tab === currentTab;
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
    syncAmbient(view.firstElementChild); // Hintergrundton der jetzt sichtbaren Ansicht (oder ausblenden; nur Detailseiten)
    syncGlow(view.firstElementChild); // Ambient Glow des Bereichs der jetzt sichtbaren Ansicht (glow.js; Seiten ohne Bereich: keiner)
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
    if (!state.devNoSplash) playSplash(); // darunter baut sich die Oberflaeche ganz normal auf (devNoSplash: nur in den Szenarien, main.js)
  }
  if (!state.loggedIn) return showLogin();
  let conn;
  try {
    // Bibliotheken und Verbindungspruefung zusammen (Start und Profilwechsel); die Pruefung liest /Users/Me und damit auch, ob das Konto Administrator ist.
    // Scheitern die Bibliotheken, geht es sofort weiter (die Pruefung wirft nie und haelt den Start nicht auf).
    [state.views, conn] = await Promise.all([api.getViews(), runConnectionCheck({ quiet: true })]);
  } catch (e) {
    // Nur eine abgelaufene Anmeldung fuehrt zur Anmeldung; ein Netz- oder Serverfehler zeigt den Zustand mit "Erneut versuchen" und loescht nichts
    if (e.status === 401) return showLogin({ message: t('toast.sessionExpired') });
    return showStartFailure(e);
  }
  if (conn.jellyfin.state === 'unauthorized') return showLogin({ message: t('toast.sessionExpired') });
  state.isAdmin = !!conn.jellyfin.isAdmin;
  buildShell();
  if (state.justUpdated && !announcedUpdate) {
    announcedUpdate = true;
    afterSplash(() => toast(t('upd.done', { v: state.appVersion }))); // unter der Startanimation sah man ihn nicht
  }
  if (!/^#\/(home|movies|shows|requests|library|item|seerr|person|search|settings|admin)/.test(location.hash)) location.hash = '#/home';
  if (!state.isAdmin && /^#\/admin/.test(location.hash)) location.hash = '#/home';
  if (routerStarted) await refresh();
  else {
    routerStarted = true;
    await start();
  }
  // Ein Update, das schon vor der Anmeldung oder dem Aufbau gefunden wurde, meldet sich jetzt (der Punkt am Zahnrad ist ohnehin da)
  afterSplash(() => setTimeout(announceUpdate, 1500));
}

/**
 * Start ohne Verbindung (wie die Apple-App): statt der Anmeldung der Zustand mit "Erneut versuchen"; die Anmeldung bleibt gespeichert. Daneben fuehrt
 * ein Weg zu einem anderen gemerkten Profil oder Server.
 */
function showStartFailure(e) {
  currentLogin?.destroy?.();
  currentLogin = null;
  closeMenu();
  closeQuickConnect();
  shellCleanup?.();
  shellCleanup = null;
  const srv = activeServer();
  const offline = !e.status || (e.status >= 502 && e.status <= 504);
  const other = h('button', { class: 'link-btn', type: 'button', onclick: () => showLogin({ cancellable: true }) }, t('start.otherProfile'));
  const el = h('div', { class: 'page start-status', 'data-glow': 'signIn' });
  el.append(
    pageStatus({
      kind: 'failed',
      symbol: offline ? 'server' : 'warning',
      title: offline ? t('start.unreachableTitle') : t('start.failedTitle'),
      text: offline ? t('start.unreachableText', { server: srv?.name || srv?.url || '' }) : e.message,
      retry: () => boot(),
      more: [other]
    })
  );
  currentLogin = { el };
  root.replaceChildren(h('div', { class: 'drag-strip' }), el);
  syncGlow(el);
}

// ---------- Verbindungspruefung (connection.js) ----------

// Rueckkehr in die App: das Fenster war verdeckt (minimiert, Handy im Hintergrund) und ist wieder sichtbar
let hiddenSince = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenSince = Date.now();
    return;
  }
  if (!hiddenSince) return;
  hiddenSince = 0;
  if (state.loggedIn && $('#view')) runConnectionCheck();
});

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
  // Liegt eine Maske ueber der App (Quick Connect), ruhen die Tastenkuerzel der App darunter
  if (!state.loggedIn || !$('#view') || document.documentElement.classList.contains('covered')) return;
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    reloadData({ hard: e.shiftKey });
  } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && Nav.tabForDigit(e.key)) {
    // Strg+1 bis Strg+5: Start, Filme, Serien, Anfragen, Suche (Entscheidung E9; am Mac Cmd)
    e.preventDefault();
    navigate(Nav.tabForDigit(e.key).path);
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

// Zurueck-Taste des Handys (Android: MainActivity fragt window.JCWeb.back, src/web/jc-web.js). Erst ein offenes Menue oder Fenster schliessen
// (sie hoeren auf Escape und melden das mit preventDefault), sonst eine Seite zurueck; auf der Startseite und bei der Anmeldung bleibt das
// Ereignis unbehandelt, dann geht die App in den Hintergrund.
document.addEventListener('jc-back', (e) => {
  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.dispatchEvent(esc);
  if (esc.defaultPrevented) return e.preventDefault();
  if (!state.loggedIn || !$('#view') || document.documentElement.classList.contains('covered')) return;
  const path = location.hash.slice(1).split('?')[0];
  if (!path || path === '/' || path === '/home') return;
  e.preventDefault();
  if (history.length > 1) history.back();
  else navigate('/home');
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
});

boot();
