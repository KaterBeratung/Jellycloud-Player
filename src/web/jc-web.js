/* window.jc ohne Electron: die Schnittstelle der Oberflaeche fuer Browser und Handy-Huellen (Capacitor).
   Im Desktop-Programm stellt die Vorlade-Datei (src/preload/app-preload.js) window.jc bereit und der Hauptprozess die Rueckseite; hier laeuft dieselbe Rueckseite
   (src/shared/backend.js) direkt in der Seite. Die Oberflaeche merkt keinen Unterschied.

   Das Gehaeuse (die Handy-App) darf vorher window.JCHost setzen und Folgendes liefern, alles freiwillig:
     fetch(url, init)      Abruffunktion, z. B. die native HTTP-Schicht (kein CORS, Cookies fuer Seerr); Standard: fetch des Browsers
     storage {get,set}     Ablage der Konfiguration (Zeichenketten); Standard: localStorage. Zugangsdaten sind dort nur kodiert, nicht verschluesselt: auf dem Handy den
                           sicheren Speicher (Keychain / Keystore) einsetzen
     codec {encode,decode} eigene Verschluesselung der Zugangsdaten (Standard: "plain:" mit Base64)
     version, platform     Version der App und "ios" | "android" | "web"
     deviceName            Name des Geraets fuer den Server
     play(req, ctx)        spielt einen Eintrag mit dem nativen Player ab; ctx = { client } mit baseUrl, token (Header: client.authHeader())
     openExternal(url)     Link im Systembrowser oeffnen
   Fuer Ereignisse des Gehaeuses: window.JCWeb.playerActive(bool) und window.JCWeb.playerClosed(info). */
(function () {
  'use strict';
  if (window.jc) return; // Desktop-Programm: die Vorlade-Datei hat schon alles bereitgestellt
  const { createBackend } = window.JCBackend;
  const { ConfigCore } = window.JCConfig;
  const { tmdbImageUrl } = window.JCSeerr;
  const host = window.JCHost ?? {};

  // ---------- Ablage und Zugangsdaten ----------
  const KEY = 'jellycloud.config';
  const storage = host.storage ?? {
    get: (k) => {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* Speicher voll oder gesperrt (privates Fenster): die Einstellungen gelten dann nur bis zum Schliessen */
      }
    }
  };
  const io = { read: () => storage.get(KEY), write: (text) => storage.set(KEY, text) };

  const utf8ToB64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64ToUtf8 = (s) => decodeURIComponent(escape(atob(s)));
  const codec = host.codec ?? {
    encode: (token) => `plain:${utf8ToB64(token)}`,
    decode: (stored) => (stored.startsWith('plain:') ? b64ToUtf8(stored.slice(6)) : null)
  };

  /** Einfache, gleichmaessige 53-Bit-Pruefsumme (cyrb53) als 12 Hex-Zeichen: Kennung eines Servers/Kontos, kein Sicherheitsmerkmal. */
  function hashId(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(0, 12);
  }
  const uuid = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
  };

  const config = new ConfigCore(io, codec, { uuid, hashId });
  const doFetch = host.fetch ?? ((url, init) => window.fetch(url, init));
  const platform = host.platform ?? 'web';

  const backend = createBackend({
    config,
    fetch: doFetch,
    appVersion: () => String(host.version ?? 'web'),
    locale: () => navigator.language || 'de',
    deviceName: host.deviceName,
    extraState: () => ({ platform, mpv: null, autostartSupported: false, update: null, discordBuiltIn: false, justUpdated: false })
  });
  backend.buildSeerr();
  if (config.data.activeServerId) backend.activateServer(config.data.activeServerId);

  // ---------- Hilfen ----------
  /** Wie die Vorlade-Datei: Fehler als einfaches Objekt mit message, status und code (die Oberflaeche liest genau diese Felder). */
  async function call(fn) {
    try {
      return await fn();
    } catch (e) {
      throw { name: 'JellycloudError', message: e?.message ?? String(e ?? 'Unbekannter Fehler'), status: e?.status ?? 0, code: e?.code ?? null };
    }
  }
  const unsupported = (what) => () => call(async () => Promise.reject(new Error(`${what} gibt es in dieser Fassung nicht`)));

  const listeners = { player: new Set(), closed: new Set() };
  const subscribe = (set) => (cb) => {
    set.add(cb);
    return () => set.delete(cb);
  };
  window.JCWeb = {
    playerActive: (on) => listeners.player.forEach((cb) => cb(!!on)),
    playerClosed: (info) => listeners.closed.forEach((cb) => cb(info))
  };

  // ---------- Bilder ----------
  // Die Oberflaeche nennt Bilder als jellycloud://-Adressen (im Desktop-Programm holt sie ein Protokoll mit Zugangsdaten und Bildspeicher).
  // Hier werden sie zu den Adressen des Servers: Jellyfin liefert Bilder ohne Anmeldung, der Browser bzw. die WebView haelt sie im Zwischenspeicher.
  const GUID = /^[0-9a-fA-F-]{32,36}$/;
  const IMAGE_TYPES = new Set(['Primary', 'Backdrop', 'Thumb', 'Logo', 'Banner', 'Art', 'Chapter']);
  function mapImage(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'jellycloud:') return url; // schon eine echte Adresse (data:, blob: ...)
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (u.hostname === 'tmdb') return tmdbImageUrl(...parts) ?? '';
      const base = backend.client?.baseUrl;
      if (!base) return '';
      const q = new URLSearchParams();
      for (const k of ['maxWidth', 'maxHeight', 'quality', 'tag']) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k).replace(/[^\w.-]/g, ''));
      if (u.hostname === 'img') {
        const [id, type, idx] = parts;
        if (!GUID.test(id ?? '') || !IMAGE_TYPES.has(type)) return '';
        return `${base}/Items/${id}/Images/${type}${idx !== undefined && /^\d+$/.test(idx) ? `/${idx}` : ''}?${q}`;
      }
      if (u.hostname === 'avatar') return GUID.test(parts[0] ?? '') ? `${base}/Users/${parts[0]}/Images/Primary?${q}` : '';
      if (u.hostname === 'trickplay') {
        const [id, width, index] = parts;
        if (!GUID.test(id ?? '') || !/^\d+$/.test(width ?? '') || !/^\d+$/.test(index ?? '')) return '';
        const ms = (u.searchParams.get('ms') ?? '').replace(/[^\w-]/g, '');
        return `${base}/Videos/${id}/Trickplay/${width}/${index}.jpg${ms ? `?mediaSourceId=${ms}` : ''}`;
      }
    } catch {
      /* kaputte Adresse */
    }
    return '';
  }

  // ---------- window.jc ----------
  window.jc = {
    web: true,
    mapImage,
    getState: () => call(() => backend.publicState()),
    probeServer: (url) => call(() => backend.probeServer(url)),
    login: (p) => call(() => backend.login(p)),
    quickConnectStart: (url) => call(() => backend.quickConnectStart(url)),
    quickConnectPoll: (p) => call(() => backend.quickConnectPoll(p)),
    logout: () => call(() => backend.logout()),
    switchServer: (id) => call(() => backend.switchServer(id)),
    api: (method, ...args) => call(() => backend.api(method, args)),
    setSettings: (patch) => call(() => backend.setSettings(patch)),
    detectMpv: () => call(async () => null),
    audioDevices: () => call(async () => []),
    audioOutput: () => call(async () => null),
    streamingLimits: (force) => call(() => backend.streamingLimits(force)),
    seerrConnect: (p) => call(() => backend.seerrConnect(p)),
    seerrDisconnect: () => call(() => backend.seerrDisconnect()),
    seerrSearch: (query, page) => call(() => backend.seerrSearch(query, page)),
    seerrTrending: () => call(() => backend.seerrTrending()),
    seerrDetails: (req) => call(() => backend.seerrDetails(req)),
    seerrRequest: (req) => call(() => backend.seerrRequest(req)),
    seerrIssue: (req) => call(() => backend.seerrIssue(req)),
    discordStatus: () => call(async () => ({ state: 'off', error: '', user: '' })),
    discordTest: unsupported('Discord'),
    cacheInfo: () => call(async () => ({ images: 0, bytes: 0 })),
    clearCache: () => call(async () => true),
    resetSettings: () => call(() => backend.resetSettings()),
    play: (req) =>
      call(async () => {
        if (!req || typeof req.itemId !== 'string' || !GUID.test(req.itemId)) throw new Error('Ungültiger Eintrag');
        const play = window.JCHost?.play; // erst jetzt gelesen: das Gehaeuse darf sich auch nach dem Start der Seite melden
        if (!play) throw new Error('Die Wiedergabe gibt es in dieser Fassung noch nicht');
        if (!backend.client) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
        await play(req, { client: backend.client });
        return true;
      }),
    openExternal: (url) =>
      call(async () => {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Nur http(s)-Links erlaubt');
        if (window.JCHost?.openExternal) return window.JCHost.openExternal(url);
        window.open(url, '_blank', 'noopener');
        return true;
      }),
    openNotices: unsupported('Lizenzhinweise als Datei'),
    setTitleBar: () => call(async () => false),
    checkUpdate: unsupported('Selbst-Aktualisierung'),
    downloadUpdate: unsupported('Selbst-Aktualisierung'),
    cancelUpdate: unsupported('Selbst-Aktualisierung'),
    installUpdate: unsupported('Selbst-Aktualisierung'),
    onUpdateState: () => () => {},
    onPlayerActive: subscribe(listeners.player),
    onPlayerClosed: subscribe(listeners.closed)
  };
  document.documentElement.dataset.platform = platform;
})();
