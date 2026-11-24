'use strict';

const { app, BrowserWindow, ipcMain, protocol, net, shell, Menu, safeStorage, session, screen, webFrameMain, dialog, Notification, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { ConfigStore, notifyIo, DEFAULT_UPDATE_SOURCE } = require('./config');
const { PlayerController } = require('./player');
const { AudioOutputProbe } = require('./audio-output');
const { autostartSupported, setAutostart, syncAutostart, shouldStartMinimized } = require('./autostart');
const { tmdbImageUrl } = require('./seerr');
const { createBackend } = require('../shared/backend');
const { Updater } = require('./updater');
const { ImageCache } = require('./image-cache');
const { DiscordPresence, createPosterResolver } = require('./discord-presence');
const { pipePath: discordPipePath } = require('./discord-ipc');
const { SystemNotifier } = require('./system-notify');
const { RemoteChannel } = require('./remote-channel');
const { attachPowerLifecycle } = require('./power');
const { createLifecycle } = require('../shared/lifecycle');

const ROOT = path.join(__dirname, '..', '..');
const EMBED_REFERER = 'https://jellycloud.player/';
const DEV = process.env.JC_DEV === '1';

protocol.registerSchemesAsPrivileged([{ scheme: 'jellycloud', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !DEV) {
  app.quit();
}

/** @type {BrowserWindow|null} */
let mainWin = null;
/** @type {ConfigStore} */
let config;
/** Rueckseite der Oberflaeche (Anmeldung, Jellyfin, Seerr, Einstellungen): dasselbe Modul wie in der Web-/Handy-Fassung, siehe src/shared/backend.js */
/** @type {ReturnType<typeof createBackend>} */
let backend;
/** @type {PlayerController} */
let player;
const audioProbe = new AudioOutputProbe();
let quitting = false;
/** Wahr, sobald die IPC-Handler stehen. Vorher darf kein Fenster entstehen: die Oberflaeche bekaeme auf "state:get" keine Antwort und zeigt "Start fehlgeschlagen". */
let booted = false;
/** Nur in den Szenarien (JC_DEV=1, --shots): die Oberflaeche spielt keine Startanimation (Zustand devNoSplash). */
let devNoSplash = DEV && process.argv.some((a) => a.startsWith('--shots='));

const netFetch = (url, init) => net.fetch(url, init);

/** Kennzeichen des Netzes dieses Rechners: Name und Adresse jedes aktiven Adapters (ohne Loopback). Nur fuer den Vergleich, nie gespeichert oder gemeldet. */
function networkSignature() {
  try {
    return Object.entries(os.networkInterfaces())
      .flatMap(([name, list]) => (list ?? []).filter((a) => !a.internal).map((a) => `${name}=${a.address}`))
      .sort()
      .join('|');
  } catch {
    return '';
  }
}

/** @type {Updater|null} */
let updater = null;

/** @type {DiscordPresence|null} Rich Presence: zeigt in Discord, was gerade laeuft (siehe discord-presence.js) */
let presence = null;
/** Lebenszyklus der Wiedergabe (Plan P20, src/main/power.js): { lifecycle, clock } */
let power = null;

/**
 * Mitteilungen des Systems (Plan P18, src/main/system-notify.js): Benachrichtigungen von Windows, solange das Programm laeuft. Antippen holt das Fenster nach
 * vorn; gehoert die Mitteilung zum aktiven Profil, merkt sich der Hauptprozess ihr Ziel, bis die Oberflaeche es abholt (notify:take; sie kann gerade neu laden).
 */
let pendingOpen = null;

/**
 * Steuerkanal (Plan P19, src/main/remote-channel.js): offen, solange der Player laeuft; so kann ein anderes Geraet desselben Kontos die Wiedergabe hier
 * anhalten und dort weiterspielen ("Auf diesem Geraet fortsetzen"). Angenommen werden nur Stop, Pause, Unpause und PlayPause.
 */
const channel = new RemoteChannel();
channel.on('command', (command) => player?.remote(command));

const notifier = new SystemNotifier({
  create: (options) => new Notification(options),
  isSupported: () => Notification.isSupported(),
  isForeground: () => !!mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized() && mainWin.isFocused(),
  onClick: (target) => {
    showMain();
    const t = backend?.systemNotificationTapped(target) ?? null;
    if (!t) return;
    pendingOpen = t;
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('notify:open');
  }
});

/** Verpackt einen IPC-Handler: ignoriert das Event, liefert { ok, data } bzw. { ok:false, error, status, code }. */
function wrap(fn) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e), status: e?.status ?? 0, code: e?.code ?? null };
    }
  };
}
// ---------- Bild-Protokoll mit Cache ----------

const IMAGE_CACHE_LIMIT = 64 * 1024 * 1024; // Bildspeicher im Hauptprozess (Poster rund 40 KB, Hintergruende einige 100 KB): bleibt nach dem Durchblaettern grosser Bibliotheken im Arbeitsspeicher
const imageCache = new ImageCache(IMAGE_CACHE_LIMIT);
/** Laufende Abrufe je Adresse: dasselbe Bild, das mehrere Stellen gleichzeitig brauchen (Banner und Reihe, schnelles Blaettern), wird nur einmal geholt. */
const imageFetches = new Map();
const GUID = /^[0-9a-fA-F-]{32,36}$/;
const IMAGE_TYPES = new Set(['Primary', 'Backdrop', 'Thumb', 'Logo', 'Banner', 'Art', 'Chapter']);

function resolveImageTarget(url) {
  const kind = url.hostname;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const q = url.searchParams;
  const base = backend.client.baseUrl;
  const out = new URLSearchParams();
  for (const k of ['maxWidth', 'maxHeight', 'quality', 'tag']) if (q.get(k)) out.set(k, q.get(k).replace(/[^\w.-]/g, ''));
  if (kind === 'img') {
    const [id, type, idx] = parts;
    if (!GUID.test(id ?? '') || !IMAGE_TYPES.has(type)) return null;
    return `${base}/Items/${id}/Images/${type}${idx !== undefined && /^\d+$/.test(idx) ? `/${idx}` : ''}?${out}`;
  }
  if (kind === 'trickplay') {
    const [id, width, index] = parts;
    if (!GUID.test(id ?? '') || !/^\d+$/.test(width ?? '') || !/^\d+$/.test(index ?? '')) return null;
    const ms = (q.get('ms') ?? '').replace(/[^\w-]/g, '');
    return `${base}/Videos/${id}/Trickplay/${width}/${index}.jpg${ms ? `?mediaSourceId=${ms}` : ''}`;
  }
  if (kind === 'avatar') {
    const [id] = parts;
    if (!GUID.test(id ?? '')) return null;
    return `${base}/Users/${id}/Images/Primary?${out}`;
  }
  return null;
}

/** Holt ein Bild (mit den Zugangsdaten des Kontos, TMDB-Bilder ohne) und legt es im Bildspeicher ab. */
async function fetchImage(target, tmdb) {
  if (!tmdb && !backend.client) return { status: 401 };
  const res = await net.fetch(target, tmdb ? {} : { headers: { Authorization: backend.client.authHeader() } });
  if (!res.ok) return { status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  imageCache.put(target, { buf, type });
  return { buf, type };
}

const imageReply = ({ buf, type }) => new Response(buf, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });

function registerImageProtocol() {
  protocol.handle('jellycloud', async (request) => {
    let target;
    let tmdb = false;
    try {
      const url = new URL(request.url);
      // Poster von Seerr-Suchergebnissen kommen von TMDB: ohne Jellyfin-Zugangsdaten (die duerfen nie zu fremden Servern gehen), nur bekannte Groessen
      tmdb = url.hostname === 'tmdb';
      if (!tmdb && !backend.client) return new Response(null, { status: 401 });
      target = tmdb ? tmdbImageUrl(...url.pathname.split('/').filter(Boolean).map(decodeURIComponent)) : resolveImageTarget(url);
    } catch {
      return new Response(null, { status: 400 }); // kaputte Adresse (etwa eine abgeschnittene Prozent-Kodierung)
    }
    if (!target) return new Response(null, { status: 400 });
    const hit = imageCache.get(target);
    if (hit) return imageReply(hit);
    try {
      let run = imageFetches.get(target);
      if (!run) {
        run = fetchImage(target, tmdb).finally(() => imageFetches.delete(target));
        imageFetches.set(target, run);
      }
      const r = await run;
      return r.buf ? imageReply(r) : new Response(null, { status: r.status });
    } catch {
      return new Response(null, { status: 502 });
    }
  });
}

// ---------- Fenster ----------

/** Gespeicherte Fensterposition, nur wenn sie noch auf einem vorhandenen Monitor liegt. */
function restoredBounds() {
  if (!config.settings.general?.rememberWindow) return null;
  const w = config.windowState;
  if (!w) return null;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return Number.isFinite(w.x) && Number.isFinite(w.y) && w.x < a.x + a.width - 80 && w.x + w.width > a.x + 80 && w.y >= a.y - 20 && w.y < a.y + a.height - 80;
  });
  return { width: Math.max(920, w.width), height: Math.max(620, w.height), ...(onScreen ? { x: w.x, y: w.y } : {}), maximized: w.maximized };
}

let windowSaveTimer = null;
function saveWindowState() {
  if (!mainWin || mainWin.isDestroyed() || mainWin.isFullScreen() || mainWin.isMinimized() || !config.settings.general?.rememberWindow) return;
  try {
    const b = mainWin.getNormalBounds();
    config.saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: mainWin.isMaximized() });
  } catch (e) {
    // Aus einem Zeitgeber heraus ein Fehler waere ein Absturzfenster des Hauptprozesses; die Fensterposition ist es nicht wert
    console.error('Fensterposition nicht gespeichert:', e?.message ?? e);
  }
}
const scheduleWindowSave = () => {
  clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(saveWindowState, 600);
};

// YouTube-Einbettung (Trailer): Die Einbettung blendet bei jedem Anhalten und Fortsetzen ihr Symbol ein (grauer Kreis mit Pause-Zeichen in der Bildmitte, dazu den Ladekreis). Dafuer gibt es keinen
// Parameter, und die Oberflaeche kommt als fremde Seite nicht an den Rahmen heran. Der Hauptprozess aber darf Code in jeden Rahmen schicken (WebFrameMain): er haengt dem Rahmen ein Stylesheet an
// (adoptedStyleSheets, unterliegt keiner Inhaltsrichtlinie), das die Steuerflaeche der Einbettung ausblendet. Das Video selbst und die Schnittstelle (postMessage) bleiben unberuehrt. Ein
// eigener Skriptkontext in fremden Rahmen (nodeIntegrationInSubFrames) ist dafuer nicht noetig, Sandbox und Kontext-Isolierung der Oberflaeche bleiben wie sie sind.
const EMBED_URL = /^https:\/\/www\.youtube-nocookie\.com\/embed\//;
// Neue Oberflaeche der Einbettung (Mittelknoepfe, Ladekreis, Steuerleiste) und die klassische (Bezel, grosse Play-Taste, Ladekreis)
const EMBED_HIDE_CSS = [
  'player-middle-controls',
  '.ytPlayerControlsContainerHost',
  '.ytp-bezel',
  '.ytp-bezel-text-wrapper',
  '.ytp-large-play-button',
  '.ytp-spinner',
  '.ytp-pause-overlay',
  '.ytp-pause-overlay-container'
].join(', ') + ' { display: none !important; }';
const EMBED_HIDE_JS = `(() => {
  if (window.__jcQuiet) return 0;
  window.__jcQuiet = 1;
  const s = new CSSStyleSheet();
  s.replaceSync(${JSON.stringify(EMBED_HIDE_CSS)});
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  return 1;
})()`;
/** Schickt das Stylesheet in einen Rahmen, falls er eine YouTube-Einbettung ist (mehrfach rufbar). Fehler (Rahmen schon weg, Seite im Umbau) sind harmlos: der naechste Aufruf holt es nach. */
function quietEmbedFrame(processId, routingId) {
  try {
    const frame = webFrameMain.fromId(processId, routingId);
    if (frame && EMBED_URL.test(frame.url)) frame.executeJavaScript(EMBED_HIDE_JS).catch(() => {});
  } catch {
    /* Rahmen nicht mehr da */
  }
}

function createMainWindow() {
  const theme = { color: '#00000000', symbolColor: '#e8e9ee', height: 36 };
  const saved = restoredBounds();
  mainWin = new BrowserWindow({
    width: 1400,
    height: 880,
    ...(saved ? { width: saved.width, height: saved.height, ...(saved.x !== undefined ? { x: saved.x, y: saved.y } : {}) } : {}),
    minWidth: 920,
    minHeight: 620,
    show: false,
    title: 'Jellycloud Player',
    backgroundColor: '#0a0b10',
    icon: path.join(ROOT, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: theme,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'app-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  if (saved?.maximized) mainWin.maximize();
  mainWin.on('resize', scheduleWindowSave);
  mainWin.on('move', scheduleWindowSave);
  mainWin.on('close', saveWindowState);
  // Beim Autostart (und "Minimiert starten") bleibt das Fenster in der Taskleiste, bis man es oeffnet.
  mainWin.once('ready-to-show', () => (shouldStartMinimized({ general: config.settings.general }) ? mainWin.minimize() : mainWin.show()));
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  // Trailer-Rahmen: gleich beim Anlegen des Dokuments (Navigation uebernommen) und nach dem Laden, damit das Symbol auch beim allerersten Bild nicht aufblitzt
  mainWin.webContents.on('did-frame-navigate', (_e, _url, _code, _text, isMainFrame, processId, routingId) => {
    if (!isMainFrame) quietEmbedFrame(processId, routingId);
  });
  mainWin.webContents.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    if (!isMainFrame) quietEmbedFrame(processId, routingId);
  });
  mainWin.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  if (DEV) {
    mainWin.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) mainWin.webContents.toggleDevTools();
    });
  }
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

function showMain() {
  if (!booted) return; // Start laeuft noch (oder ist gescheitert): ein zweiter Aufruf der App legt kein Fenster ohne Handler an
  if (!mainWin || mainWin.isDestroyed()) return createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

// ---------- IPC ----------

function registerIpc() {
  // Anmeldung, Jellyfin, Seerr und Einstellungen: alles steckt in src/shared/backend.js (dasselbe Modul benutzt die Web-/Handy-Fassung)
  ipcMain.handle('state:get', wrap(() => backend.publicState()));
  ipcMain.handle('server:probe', wrap((url) => backend.probeServer(url)));
  ipcMain.handle('auth:login', wrap((p) => backend.login(p)));
  ipcMain.handle('auth:qc-start', wrap((url) => backend.quickConnectStart(url)));
  ipcMain.handle('auth:qc-poll', wrap((p) => backend.quickConnectPoll(p)));
  ipcMain.handle('auth:logout', wrap(() => backend.logout()));
  ipcMain.handle('auth:switch', wrap((id) => backend.switchServer(id)));
  // Profile (eigener Name, Adresse, entfernen), Verbindungspruefung und Quick Connect fuer andere Geraete (der Code wird nirgends protokolliert)
  ipcMain.handle('profile:update', wrap((p) => backend.updateProfile(p)));
  ipcMain.handle('profile:remove', wrap((id) => backend.removeProfile(id)));
  ipcMain.handle('conn:check', wrap((o) => backend.checkConnection({ seerr: o?.seerr !== false })));
  ipcMain.handle('qc:available', wrap((id) => backend.quickConnectAvailable(id)));
  ipcMain.handle('qc:authorize', wrap((p) => backend.quickConnectAuthorize(p)));
  ipcMain.handle('jf:call', wrap((method, args) => backend.api(method, args)));

  // ---------- Seerr (Anfragen) ----------
  ipcMain.handle('seerr:connect', wrap((p) => backend.seerrConnect(p)));
  ipcMain.handle('seerr:connectQuick', wrap((p) => backend.seerrConnectQuick(p)));
  ipcMain.handle('seerr:issues', wrap((p) => backend.seerrIssues(p)));
  ipcMain.handle('seerr:issueGet', wrap((id) => backend.seerrIssueGet(id)));
  ipcMain.handle('seerr:issueComment', wrap((p) => backend.seerrIssueComment(p)));
  ipcMain.handle('seerr:issueResolve', wrap((p) => backend.seerrIssueResolve(p)));
  ipcMain.handle('seerr:issueDelete', wrap((id) => backend.seerrIssueDelete(id)));
  ipcMain.handle('seerr:requestUpdate', wrap((p) => backend.seerrRequestUpdate(p)));
  ipcMain.handle('seerr:markAvailable', wrap((p) => backend.seerrMarkAvailable(p)));
  ipcMain.handle('seerr:services', wrap((m) => backend.seerrServices(m)));
  ipcMain.handle('seerr:serviceChoices', wrap((p) => backend.seerrServiceChoices(p)));
  ipcMain.handle('seerr:requesters', wrap(() => backend.seerrRequesters()));
  ipcMain.handle('seerr:discover', wrap((p) => backend.seerrDiscover(p)));
  ipcMain.handle('seerr:genres', wrap((t) => backend.seerrGenres(t)));
  ipcMain.handle('seerr:watchlist', wrap(() => backend.seerrWatchlist()));
  ipcMain.handle('seerr:setWatchlist', wrap((p) => backend.seerrSetWatchlist(p)));
  ipcMain.handle('seerr:disconnect', wrap(() => backend.seerrDisconnect()));
  ipcMain.handle('seerr:check', wrap(() => backend.seerrCheck()));
  ipcMain.handle('seerr:search', wrap((query, page) => backend.seerrSearch(query, page)));
  ipcMain.handle('seerr:trending', wrap(() => backend.seerrTrending()));
  ipcMain.handle('seerr:details', wrap((req) => backend.seerrDetails(req)));
  ipcMain.handle('seerr:request', wrap((req) => backend.seerrRequest(req)));
  ipcMain.handle('seerr:related', wrap((req) => backend.seerrRelated({ mediaType: req?.mediaType, tmdbId: Number(req?.tmdbId), kind: String(req?.kind ?? '') })));
  ipcMain.handle('seerr:collection', wrap((id) => backend.seerrCollection(Number(id))));
  ipcMain.handle('seerr:imdb', wrap((tmdbId) => backend.seerrImdb(Number(tmdbId))));
  ipcMain.handle('top10:get', wrap((o) => backend.topTen({ window: o?.window === 'day' ? 'day' : 'week', force: o?.force === true })));
  ipcMain.handle('top10:status', wrap((o) => backend.topTenStatus({ window: o?.window === 'day' ? 'day' : 'week' })));
  ipcMain.handle('seerr:person', wrap((id) => backend.seerrPerson(Number(id))));
  ipcMain.handle('seerr:filmography', wrap((id) => backend.seerrFilmography(Number(id))));
  ipcMain.handle('seerr:quota', wrap(() => backend.seerrQuota()));
  ipcMain.handle('seerr:requests', wrap((o) => backend.seerrRequests({ scope: o?.scope === 'manage' ? 'manage' : 'mine', skip: Number(o?.skip) || 0, take: Number(o?.take) || 50 })));
  ipcMain.handle('seerr:media', wrap((req) => backend.seerrMedia({ mediaType: req?.mediaType, tmdbId: Number(req?.tmdbId) })));
  ipcMain.handle('seerr:requestAction', wrap((req) => backend.seerrRequestAction({ id: Number(req?.id), action: String(req?.action ?? '') })));
  ipcMain.handle('seerr:issue', wrap((req) => backend.seerrIssue(req)));
  // ---------- Mitteilungen (Plan P17): Liste, Abgleich, Lesen und Entfernen, Einstellungen des aktiven Profils ----------
  ipcMain.handle('notify:get', wrap(() => backend.notifications()));
  ipcMain.handle('notify:sync', wrap((o) => backend.notificationsSync({ force: o?.force === true })));
  ipcMain.handle('notify:read', wrap((req) => backend.notificationRead({ id: String(req?.id ?? '').slice(0, 120), read: req?.read !== false })));
  ipcMain.handle('notify:readAll', wrap(() => backend.notificationsReadAll()));
  ipcMain.handle('notify:remove', wrap((id) => backend.notificationRemove(String(id ?? '').slice(0, 120))));
  ipcMain.handle('notify:removeAll', wrap(() => backend.notificationsRemoveAll()));
  ipcMain.handle('notify:prefs', wrap((p) => backend.notificationPrefs(p && typeof p === 'object' ? p : {})));
  // Mitteilungen des Systems (Plan P18): Windows fragt nicht nach einer Erlaubnis und sagt nicht, ob es sie zeigt; der Weg fuehrt in seine Einstellungen
  ipcMain.handle('notify:systemStatus', wrap(() => notifier.status()));
  ipcMain.handle('notify:systemRequest', wrap(() => notifier.request()));
  ipcMain.handle('notify:systemSettings', wrap(() => shell.openExternal('ms-settings:notifications').then(() => true)));
  // ---------- Auf diesem Geraet fortsetzen (Plan P19): Sitzungen des eigenen Kontos, Eintrag, Stopp einer eben gelesenen eigenen Sitzung ----------
  ipcMain.handle('handoff:sessions', wrap(() => backend.handoffSessions()));
  ipcMain.handle('handoff:item', wrap((req) => backend.handoffItem({ id: String(req?.id ?? ''), timeout: Number(req?.timeout) || undefined })));
  ipcMain.handle('handoff:stop', wrap((id) => backend.handoffStop(String(id ?? '').slice(0, 120))));
  ipcMain.handle('notify:take', wrap(() => {
    const t = pendingOpen;
    pendingOpen = null;
    return t;
  }));

  ipcMain.handle('settings:set', wrap((patch) => backend.setSettings(patch)));
  // ---------- Discord Rich Presence ----------
  ipcMain.handle('discord:status', wrap(() => presence?.status() ?? { state: 'off', error: '', user: '' }));
  ipcMain.handle('discord:test', wrap((clientId) => presence.test(typeof clientId === 'string' ? clientId : '')));

  // ---------- Updates ----------
  ipcMain.handle('update:check', wrap(() => updater.check({ manual: true })));
  ipcMain.handle('update:download', wrap(() => updater.download()));
  ipcMain.handle('update:cancel', wrap(() => updater.cancel()));
  ipcMain.handle('update:install', wrap(() => updater.install()));

  ipcMain.handle('mpv:detect', wrap(() => player.detectMpv()));

  // mpv ist fest eingebaut: nur Statusabfrage und Geraeteliste, keine Pfadauswahl.
  ipcMain.handle('mpv:audio-devices', wrap(() => player.audioDevices()));
  // Erkanntes Ausgabegeraet und die daraus gewaehlte Kanalzahl (Einstellungen, Detailseite)
  ipcMain.handle('audio:output', wrap(() => player.audioOutput()));
  // Bitratengrenze des Servers fuer diese Verbindung (null, wenn nicht angemeldet)
  ipcMain.handle('server:limits', wrap((force) => backend.streamingLimits(force)));
  ipcMain.handle('cache:info', wrap(() => ({ images: imageCache.size, bytes: imageCache.bytes })));
  ipcMain.handle('cache:clear', wrap(() => {
    imageCache.clear();
    return true;
  }));
  ipcMain.handle('settings:reset', wrap(() => backend.resetSettings()));

  ipcMain.handle('player:play', wrap(async (req) => {
    if (!req || typeof req.itemId !== 'string' || !GUID.test(req.itemId)) throw new Error('Ungültiger Eintrag');
    await player.play(req);
    return true;
  }));
  // Wie der Server einen Eintrag liefern wuerde (Direct Play, Direct Stream, Transcode), ohne abzuspielen: fuer das Wiedergabe-Tag der Detailseite
  ipcMain.handle('player:outlook', wrap(async (req) => {
    if (!req || typeof req.itemId !== 'string' || !GUID.test(req.itemId)) throw new Error('Ungültiger Eintrag');
    return player.outlook({ itemId: req.itemId, mediaSourceId: typeof req.mediaSourceId === 'string' ? req.mediaSourceId : undefined, audioIndex: Number.isInteger(req.audioIndex) ? req.audioIndex : undefined, subtitleIndex: Number.isInteger(req.subtitleIndex) ? req.subtitleIndex : undefined });
  }));

  // Hinweise zu mitgelieferter Software (mpv, Electron): THIRD-PARTY.txt neben dem Programm
  ipcMain.handle('app:notices', wrap(async () => {
    const file = app.isPackaged ? path.join(process.resourcesPath, 'THIRD-PARTY.txt') : path.join(ROOT, 'THIRD-PARTY.txt');
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return true;
  }));

  ipcMain.handle('shell:open', wrap((url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Nur http(s)-Links erlaubt');
    return shell.openExternal(url);
  }));

  ipcMain.handle('window:titlebar', wrap((o) => {
    if (!mainWin || mainWin.isDestroyed() || process.platform !== 'win32') return false;
    const color = typeof o?.color === 'string' && /^#[0-9a-fA-F]{6,8}$/.test(o.color) ? o.color : '#00000000';
    const symbolColor = typeof o?.symbolColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.symbolColor) ? o.symbolColor : '#e8e9ee';
    mainWin.setTitleBarOverlay({ color, symbolColor, height: 36 });
    return true;
  }));
}

// ---------- Start ----------

app.setAppUserModelId('dev.jellycloud.player');

/** Nebensache beim Start: scheitert sie, laeuft die App trotzdem (der Grund steht im Protokoll). */
function bestEffort(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(`${label}:`, e);
    return undefined;
  }
}

/** Ein Fehler beim Start darf die App nicht als unsichtbaren Prozess zuruecklassen: der haelt die Einzelinstanz-Sperre, und der naechste Aufruf bekaeme ein Fenster ohne Handler. */
function startupFailed(e) {
  console.error('Start fehlgeschlagen:', e);
  if (!DEV) {
    try {
      dialog.showErrorBox('Jellycloud Player', `Der Start ist fehlgeschlagen:\n${e?.message ?? e}`);
    } catch {
      /* ohne Meldung beenden */
    }
  }
  app.exit(1);
}

async function startUp() {
  if (!gotLock && !DEV) return; // zweite Instanz: sie beendet sich schon, die laufende zeigt ihr Fenster
  Menu.setApplicationMenu(null);
  config = new ConfigStore(app.getPath('userData'), safeStorage);
  bestEffort('Autostart', () => syncAutostart(app, config.settings.general.autostart));
  backend = createBackend({
    config,
    fetch: netFetch,
    appVersion: () => app.getVersion(),
    locale: () => app.getLocale(),
    // Was nur der Desktop kennt: mpv, Autostart, Updates, Discord; "platform" sagt der Oberflaeche, auf welchem Geraet sie laeuft
    extraState: () => ({
      platform: 'desktop',
      mpv: player ? player.detectMpv() : null,
      autostartSupported: autostartSupported(app),
      update: updater?.state ?? null,
      discordBuiltIn: !!presence?.defaultClientId, // Discord-Anwendung eingebaut: niemand braucht eine eigene Application-ID
      justUpdated: process.argv.includes('--updated'), // der Installer hat die App nach einem Update gestartet
      // Nur in den Szenarien (JC_DEV=1, --shots): ohne Startanimation (sie verdeckt die Oberflaeche und schluckt Klicks); startup-anim.js schaltet sie per ctx.splash wieder ein
      ...(devNoSplash ? { devNoSplash: true } : {})
    }),
    onSettings: (patch, settings) => {
      if (patch === null) setAutostart(app, settings.general.autostart); // Standardwerte (Autostart: aus)
      else {
        if (patch?.general && 'autostart' in patch.general) setAutostart(app, settings.general.autostart);
        if (patch?.discord || patch?.language) presence?.refresh();
      }
    },
    // Mitteilungen je Profil und Seerr-Server: Dateien unter userData\notifications; jede Aenderung geht als Zahl an die Oberflaeche (roter Punkt)
    notifyIo: notifyIo(path.join(app.getPath('userData'), 'notifications')),
    onNotifications: (summary) => {
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('notify:changed', summary);
    },
    systemNotify: notifier,
    // Heimnetz-Pruefung (Plan P21): das Netz des Rechners als Kennzeichen (Adapter und Adressen, nur im Speicher). Wechselt es (anderes WLAN, VPN an
    // oder aus), gilt keine gemerkte Einstufung mehr. Ueber welche Schnittstelle eine Verbindung laeuft, laesst sich hier nicht bestimmen (unbekannt).
    connection: () => ({ signature: networkSignature() })
  });
  backend.buildSeerr();

  // Updates: heruntergeladene Installer liegen in userData\updates. Geprueft wird kurz nach dem Start und dann alle paar Stunden, geladen und installiert nur auf Klick.
  updater = new Updater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    dir: path.join(app.getPath('userData'), 'updates'),
    getSource: () => DEFAULT_UPDATE_SOURCE, // fest eingebaut, siehe config.js
    fetch: netFetch,
    canInstall: () => !player?.active,
    quit: () => app.quit()
  });
  updater.on('state', (s) => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update:state', s);
  });
  bestEffort('Aufraeumen der Installer', () => updater.purge()); // alte und halbe Installer von frueheren Updates (der gerade fertige Installer ist kurz noch gesperrt)
  // Die Szenarien (--shots) laufen ohne automatische Pruefung: sie sollen nicht vom Netz und von der Standard-Quelle abhaengen
  if (!(DEV && process.argv.some((a) => a.startsWith('--shots=')))) updater.schedule({ enabled: () => config.settings.general.autoUpdate, firstMs: 4000 }); // beim Start nach wenigen Sekunden, danach alle sechs Stunden

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // YouTube-Einbettung (Trailer): YouTube verlangt dafuer einen Referer, sonst Fehler 153. Die Oberflaeche liegt unter file:// und sendet keinen,
  // daher bekommt nur diese eine Anfrage einen Referer, der die App kenntlich macht.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (details, cb) => {
    cb({ requestHeaders: { ...details.requestHeaders, Referer: EMBED_REFERER } });
  });
  session.defaultSession.setCertificateVerifyProc((req, cb) => {
    const allow = config.settings.player.allowSelfSigned;
    const host = backend.client ? new URL(backend.client.baseUrl).hostname : null;
    cb(allow && host && req.hostname === host ? 0 : -3);
  });

  const fake =
    DEV && process.env.JC_FAKE_MPV === '1'
      ? { exe: process.execPath, prefix: [path.join(ROOT, 'test', 'fake-mpv.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
      : null;

  player = new PlayerController({
    getClient: () => backend.client,
    getLimits: () => backend.limits,
    refreshLimits: (force) => backend.refreshLimits(force), // beim Start neu (force): die Verbindung kann sich geaendert haben
    measureBandwidth: (o) => backend.measureBandwidth(o),
    getSettings: () => config.settings,
    saveSettings: (patch) => config.updateSettings(patch),
    getHostWindow: () => mainWin,
    getUi: () => ({
      appearance: config.settings.appearance,
      language: config.settings.language === 'auto' ? app.getLocale() : config.settings.language,
      playback: { seekSmall: config.settings.player.seekSmall, seekBig: config.settings.player.seekBig, wheelAction: config.settings.player.wheelAction },
      pauseScreen: { on: config.settings.player.pauseScreen !== false, sec: Number(config.settings.player.pauseScreenSec) || 6 },
      subtitleLanguage: config.settings.player.subtitleLanguage // bevorzugte Sprache: lange Untertitel-Listen zeigen sie zuerst
    }),
    paths: {
      preload: path.join(ROOT, 'src', 'preload', 'player-preload.js'),
      playerHtml: path.join(ROOT, 'src', 'player', 'player.html'),
      icon: path.join(ROOT, 'build', 'icon.png'),
      resources: process.resourcesPath,
      appRoot: ROOT
    },
    fake,
    audioProbe: fake ? null : audioProbe
  });
  player.on('active', (on) => {
    mainWin?.webContents.send('player:active', on);
    // Steuerbar nur waehrend der Wiedergabe: Kanal und Anmeldung der Steuerung kommen und gehen mit dem Player
    if (on) channel.open(backend.client);
    else channel.close();
  });
  // Discord Rich Presence: jede Aenderung der Wiedergabe (Start, Pause, Sprung, Ende) und der Einstellungen stoesst die Aktualisierung an
  presence = new DiscordPresence({
    getSettings: () => config.settings.discord,
    getPlaying: () => player.nowPlaying(),
    getLanguage: () => (config.settings.language === 'auto' ? app.getLocale() : config.settings.language),
    resolvePoster: createPosterResolver({ getClient: () => backend.client, getSeerr: () => backend.seerr, tmdbImageUrl }),
    // Die Szenarien (JC_DEV) lenken die Verbindung auf eine eigene Fake-Pipe um (tools/shots/discord.js), damit ein echtes Discord nie angefasst wird
    pathFor: (i) => (DEV && process.env.JC_DISCORD_PIPE ? `${process.env.JC_DISCORD_PIPE}${i}` : discordPipePath(i))
  });
  player.on('nowplaying', () => presence.refresh());
  // Lebenszyklus (Plan P20, src/main/power.js): Ruhezustand beendet die Sitzung sofort, langer Schlaf nach dem Aufwachen; ein Fenster im Hintergrund spielt weiter
  power = attachPowerLifecycle({ player, power: powerMonitor, createLifecycle, log: DEV ? (text) => console.log(`JCLifecycle ${text}`) : undefined });
  presence.refresh(); // ist es schon eingeschaltet, steht die Verbindung, bevor etwas laeuft
  player.on('closed', (info) => {
    if (quitting) return;
    showMain();
    mainWin?.webContents.send('player:closed', info);
  });
  // Kam die Stopped-Meldung erst nach "closed" beim Server an, laedt die Oberflaeche ihre Listen noch einmal.
  player.on('reported', (info) => {
    if (!quitting) mainWin?.webContents.send('player:closed', info);
  });

  registerImageProtocol();
  registerIpc();
  booted = true;
  if (config.data.activeServerId) backend.activateServer(config.data.activeServerId);
  createMainWindow();
  // Ausgabegeraet im Hintergrund erkennen, damit der Start der ersten Wiedergabe nicht darauf warten muss.
  if (!fake) setTimeout(() => audioProbe.refresh(), 1200).unref?.();

  // Entwickler-Hook: Szenario-Skript fuer automatische Screenshots (nur mit JC_DEV=1)
  const shots = DEV ? process.argv.find((a) => a.startsWith('--shots=')) : null;
  if (shots) {
    mainWin.webContents.once('did-finish-load', async () => {
      const ctx = {
        app,
        get win() {
          return mainWin;
        },
        player,
        config,
        /** Rueckseite (tools/shots/limits.js: gemerkte Bandbreite und Heimnetz-Pruefung verwerfen) */
        backend,
        updater,
        presence,
        /** Mitteilungen des Systems: die Szenarien setzen create (und isSupported) auf eine Attrappe und fangen so jede Mitteilung ab (tools/shots/system-notify.js) */
        notifier,
        /** Steuerkanal waehrend der Wiedergabe (tools/shots/handoff.js) */
        channel,
        /** Lebenszyklus der Wiedergabe (tools/shots/back-latency.js); powerMonitor, um Ruhezustand und Aufwachen nachzustellen */
        get power() {
          return power;
        },
        powerMonitor,
        wait: (ms) => new Promise((r) => setTimeout(r, ms)),
        /** Startanimation fuer die naechsten Starts (Neu laden) ein- oder ausschalten; die Szenarien beginnen ohne (devNoSplash) */
        splash: (on) => {
          devNoSplash = !on;
        },
        /** Systemeinstellung "Bewegung reduzieren" nachstellen (prefers-reduced-motion) fuer ein Fenster (Standard: das Hauptfenster); motion.js folgt sofort */
        reducedMotion: async (on, wc = mainWin.webContents) => {
          if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
          await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
        },
        run: (js) => mainWin.webContents.executeJavaScript(js),
        capture: async (file, win = mainWin) => {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
        }
      };
      try {
        await require(path.resolve(shots.slice('--shots='.length)))(ctx);
      } catch (e) {
        console.error('Szenario fehlgeschlagen:', e);
        process.exitCode = 1;
      }
      app.quit();
    });
  }
}

app.whenReady().then(startUp).catch(startupFailed);

app.on('second-instance', () => showMain());
app.on('window-all-closed', () => {
  if (!player?.active) app.quit();
});
// Beim Beenden die laufende Wiedergabe sauber abschliessen: die letzte Position muss noch zum Server (kurze Frist), erst dann Ende.
app.on('before-quit', (e) => {
  presence?.shutdown().catch(() => {}); // Anzeige in Discord entfernen (ohnehin weg, sobald die Verbindung mit dem Prozess endet)
  if (quitting || !player) return;
  if (!player.active && !player.cur && !player.hasPendingReports()) return;
  e.preventDefault();
  quitting = true;
  Promise.race([player.stop().then(() => player.flushReports(2500)), new Promise((r) => setTimeout(r, 4000))])
    .catch(() => {})
    .finally(() => app.quit());
});
