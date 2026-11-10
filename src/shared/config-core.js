/* Gemeinsames Modul: Einstellungen, Standardwerte und die Konfigurationsablage ohne eigene Ein-/Ausgabe.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCConfig) in der Web-/Handy-Fassung.
   Wohin gespeichert wird und wie Zugangsdaten verschluesselt werden, steckt in `io` und `codec` (Hauptprozess: Datei und Windows-DPAPI in src/main/config.js,
   Web/Handy: localStorage bzw. der sichere Speicher des Geraets in src/web/jc-web.js). Der Aufbau der Konfiguration und alle Regeln beim Laden sind fuer alle gleich. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./home-rows'));
  else root.JCConfig = factory(root.JCHomeRows);
})(typeof self !== 'undefined' ? self : this, function (HomeRows) {
  'use strict';
/** Standardwerte aller Einstellungen. Neue Schluessel werden beim Laden automatisch ergaenzt. */
/**
 * Die Update-Quelle: die Release-Dateien des oeffentlichen GitHub-Repos (latest.json und der Installer des neuesten Releases).
 * Der Teil "releases/latest/download/" liefert immer die Dateien des jeweils neuesten Releases, ohne Anmeldung.
 * Sie ist FEST eingebaut: nicht in den Einstellungen zu sehen oder zu aendern, nicht in der Konfigurationsdatei und nicht ueber die Oberflaeche.
 * (Tests setzen die Quelle ueber updater.getSource.)
 */
const DEFAULT_UPDATE_SOURCE = 'https://github.com/KaterBeratung/jellycloud-releases/releases/latest/download/';

const DEFAULT_SETTINGS = {
  language: 'auto', // 'auto' | 'de' | 'en'
  appearance: {
    theme: 'midnight', // midnight | graphite | amoled | daylight
    accent: '#f5f5f7', // neutrales Silberweiss wie bei Apple TV; frei waehlbar (Weiss/Grau/Schwarz passen sich dem Theme an)
    posterSize: 176, // Breite einer Poster-Karte in px
    radius: 18, // Eckenradius in px
    animations: 'full', // full | reduced | off
    blur: true, // Glas-Effekte (Backdrop-Blur)
    heroAutoplay: true, // Hero-Banner wechselt automatisch
    ambient: true, // Hintergrund nimmt dezent die Farbe des gezeigten Banners/Titels auf (wie Apple TV)
    startAnimation: true, // beim Start der App eine kurze Animation mit dem Logo (wie bei Netflix); entfaellt bei Animationen "aus", Klick oder Taste ueberspringt sie
    homeTrending: true, // Startseite: Reihe "Filme im Trend" (aus Seerr; ohne Verbindung steht dort ein Hinweis zur Einrichtung) und bis zu zwei gut bewertete davon im Banner
    showBadges: true, // 4K / HDR / Atmos Badges auf Karten
    cardTitles: true // Titel unter den Postern
  },
  // Startseite anpassen: Banner (an/aus, Folien, Trend-Folien) und Reihen (Reihenfolge, ausgeblendet); Regeln in src/shared/home-rows.js.
  // "Filme im Trend" blendet appearance.homeTrending aus, "Banner wechselt automatisch" ist appearance.heroAutoplay.
  home: structuredClone(HomeRows.DEFAULTS),
  // Discord Rich Presence: zeigt in Discord, was du gerade schaust (Titel, Folge, Poster, Fortschritt). Aus, bis du es einschaltest. Die Anwendung "Jellycloud Player" ist eingebaut
  // (DEFAULT_CLIENT_ID in src/main/discord-presence.js). Regeln: src/main/discord-presence.js (normalizeSettings).
  discord: {
    enabled: false,
    clientId: '', // eigene Application-ID (17 bis 20 Ziffern), nur wenn eine eigene Anwendung benutzt werden soll; leer = die eingebaute
    name: '', // Name der Aktivitaet in Discord ("Schaut <Name>"); leer = der Name der Anwendung ("Jellycloud Player")
    poster: 'auto', // auto (TMDB ueber Seerr, sonst der Server, wenn er oeffentlich per https erreichbar ist) | tmdb | server | off
    hideTitle: false, // nur "Schaut einen Film", kein Titel, kein Poster
    button: false // Knopf "Auf IMDb ansehen" bzw. "Auf TMDB ansehen" (oeffentliche Seite des Titels)
  },
  // mpv ist fest eingebaut (mitgeliefert unter resources\mpv); Pfad, eigene mpv.conf und freie Optionen sind bewusst nicht einstellbar.
  player: {
    // Bild
    hwdec: 'auto-safe', // auto-safe | d3d11va | d3d11va-copy | nvdec | no
    gpuApi: 'd3d11', // d3d11 | vulkan
    hdr: 'auto', // auto | passthrough | tonemap
    toneMapping: 'auto', // auto | bt.2390 | spline | mobius | reinhard | hable | clip
    hdrPeak: 'auto', // auto | yes | no (Spitzenhelligkeit pro Bild messen)
    scalePreset: 'default', // fast | default | high
    deinterlace: 'no', // no | yes
    videoSync: 'audio', // audio | display-resample
    interpolation: false,
    deband: false,
    brightness: 0, // -50..50
    contrast: 0,
    saturation: 0,
    gamma: 0,
    // Ton
    audioPassthrough: false, // AC3 / E-AC3 / DTS / DTS-HD / TrueHD per HDMI
    audioExclusive: false, // WASAPI exklusiv (noetig fuer TrueHD / DTS-HD Bitstream)
    audioDevice: 'auto',
    audioChannels: 'auto', // auto | stereo | 5.1 | 7.1
    nightMode: false, // gleicht Lautstaerkesprünge an (nicht mit Passthrough)
    volume: 100,
    muted: false,
    // Sprache und Untertitel
    audioLanguage: 'server', // server | ISO-639-1 (de, en, ...)
    subtitleMode: 'server', // server | off | forced | always | smart
    subtitleLanguage: 'server',
    subtitleScale: 1,
    subtitlePos: 100, // 50..100 (100 = ganz unten)
    subtitleColor: '#ffffff',
    subtitleOutline: 2, // 0..6 px
    subtitleBackground: 0, // 0..80 % Deckkraft des Hintergrundkastens
    subtitleBold: false,
    subtitleFont: 'Segoe UI',
    subtitleAssStyle: false, // true: eigenen Stil auch auf ASS-Untertitel anwenden
    // Verhalten
    autoplayNext: true,
    skipIntro: 'button', // button | auto | off
    skipOutro: 'button', // button | auto | off
    skipCountdown: 6, // Sekunden, die sich "Intro/Abspann ueberspringen" und "Naechste Folge" fuellen, bevor es von selbst weitergeht (wie bei Netflix); 0 = aus
    resumeRewindSec: 5,
    seekSmall: 5, // Pfeiltasten
    seekBig: 10, // J / L und Knoepfe
    wheelAction: 'volume', // volume | seek | none
    fullscreenOnPlay: false,
    pauseOnMinimize: true,
    pauseScreen: true, // Pausenbildschirm: nach einigen Sekunden Pause zeigt der Player Logo, Beschreibung und "Endet um ..."
    pauseScreenSec: 6, // so lange muss die Pause ohne Bedienung dauern
    preventSleep: true, // Bildschirm waehrend der Wiedergabe nicht abschalten
    // Netzwerk
    maxBitrateMbps: 0, // 0 = Original (Direct Play), sonst Server begrenzt per Transcode
    allowTranscode: true, // false: nur Direct Play / Direct Stream
    bufferMb: 256,
    readaheadSec: 40,
    allowSelfSigned: false // selbstsignierte HTTPS-Zertifikate des eigenen Servers erlauben
  },
  // Trailer im Hintergrund der Detailseite (YouTube-Links des Servers)
  trailer: {
    autoplay: true,
    home: true, // auch im Banner der Startseite abspielen (nur wirksam, wenn autoplay an ist)
    muted: true, // ohne Ton starten; der Lautsprecher-Knopf schaltet ihn ein
    delaySec: 0, // Wartezeit nach dem Oeffnen der Seite (0 = sofort)
    quality: '2160', // Hoechststufe: "2160" (bis 4K), "1080" oder "720"
    volume: 10, // Lautstaerke, wenn der Ton an ist (5 bis 100)
    focusStyle: 'corner', // Absinken im freien Blick: 'corner' (Poster blendet aus, das Logo gleitet in die linke untere Ecke) oder 'poster' (Poster und Titel bleiben zur Haelfte unten stehen)
    focusSec: 10 // so viele Sekunden nach dem Einblenden (ohne Bedienung) beginnen Poster, Titel und Angaben abzusinken und auszublenden; das dauert rund 4 s, nach rund 14 s ist der Trailer frei (0 = nie)
  },
  general: {
    autostart: false, // mit Windows starten (nur installierte App)
    startMinimized: true, // beim Autostart nur in die Taskleiste
    rememberWindow: true, // Fensterposition und -groesse merken
    spoilerProtection: false, // Bilder und Beschreibung ungesehener Folgen ausblenden
    autoUpdate: true, // beim Start und danach alle paar Stunden nach einer neuen Version suchen (laden und installieren nur nach Bestaetigung)
    updateSeen: '' // Version, fuer die der Hinweis "Update verfuegbar" schon gezeigt wurde (nur einmal je Version, danach bleibt der Punkt am Zahnrad)
  }
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Sekunden fuer den Countdown an "Ueberspringen" / "Naechste Folge": ganze Zahl 0..30 (0 = aus); alles andere (fehlt, Text, negativ) faellt auf den Standard zurueck. */
function skipCountdownSec(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return DEFAULT_SETTINGS.player.skipCountdown;
  return Math.min(30, Math.max(0, Math.round(n)));
}

/** Verschmilzt `patch` rekursiv in `base`, ohne unbekannte Typen zu uebernehmen. */
function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isPlainObject(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else if (v !== undefined && (base[k] === undefined || typeof v === typeof base[k])) out[k] = v;
  }
  return out;
}

/**
 * @typedef {{ read(): string|null, write(text: string): void, backupCorrupt?(): void }} ConfigIo  read liefert null (oder wirft ENOENT), wenn es noch keine Konfiguration gibt
 * @typedef {{ encode(token: string): string, decode(stored: string): string|null }} ConfigCodec
 * @typedef {{ uuid(): string, hashId(text: string): string }} ConfigEnv
 */
class ConfigCore {
  /**
   * @param {ConfigIo} io
   * @param {ConfigCodec} codec
   * @param {ConfigEnv} env
   */
  constructor(io, codec, env) {
    this.io = io;
    this.codec = codec;
    this.env = env;
    this.data = {
      version: 9,
      deviceId: env.uuid(),
      activeServerId: null,
      servers: [],
      settings: structuredClone(DEFAULT_SETTINGS)
    };
    this._load();
  }

  _load() {
    try {
      // Ein vorangestelltes BOM (Notepad, PowerShell 5 "-Encoding utf8") darf das Lesen nicht scheitern lassen, sonst gingen Server und Einstellungen verloren.
      const text = this.io.read();
      if (text == null) throw Object.assign(new Error('keine Konfiguration'), { code: 'ENOENT' });
      const raw = JSON.parse(String(text).replace(/^\uFEFF/, ''));
      if (typeof raw.deviceId === 'string') this.data.deviceId = raw.deviceId;
      if (Array.isArray(raw.servers)) this.data.servers = raw.servers.filter((s) => s && s.id && s.url);
      if (typeof raw.activeServerId === 'string') this.data.activeServerId = raw.activeServerId;
      if (raw.window && typeof raw.window === 'object') this.data.window = raw.window;
      if (raw.seerr && typeof raw.seerr === 'object' && raw.seerr.url && raw.seerr.secret) this.data.seerr = raw.seerr;
      this.data.settings = deepMerge(DEFAULT_SETTINGS, raw.settings);
      this.data.settings.home = HomeRows.homeConfig(this.data.settings.home); // Grenzen und Listen pruefen (eine von Hand bearbeitete Datei darf nichts zerlegen)
      // Version 2 (Apple-TV-Stil): der alte Standard-Eckenradius 14 wird einmalig auf den neuen Standard gehoben. Bewusst gewaehlte andere Werte bleiben.
      const ver = raw.version ?? 1;
      const look = this.data.settings.appearance;
      if (ver < 2 && look.radius === 14) look.radius = DEFAULT_SETTINGS.appearance.radius;
      // Version 3: der alte Standard-Akzent (Koenigsblau) wurde durch ein neutrales Silberweiss ersetzt. Eigene Farben bleiben.
      if (ver < 3 && String(look.accent).toLowerCase() === '#0b2dbf') look.accent = DEFAULT_SETTINGS.appearance.accent;
      // Version 4: die Trailer-Standards wurden angehoben (Start nach 8 statt 2 s, Ausblenden nach 20 statt 15 s). Alte Standardwerte ziehen mit, eigene bleiben.
      const trailer = this.data.settings.trailer;
      if (ver < 4 && trailer.delaySec === 2) trailer.delaySec = 8;
      if (ver < 4 && trailer.focusSec === 15) trailer.focusSec = 20;
      // Version 5: das Ausblenden dauert jetzt gut 8 s und beginnt deshalb frueher (10 statt 20 s), damit der Trailer nach rund 20 s frei ist
      if (ver < 5 && trailer.focusSec === 20) trailer.focusSec = DEFAULT_SETTINGS.trailer.focusSec;
      // Version 6: der Trailer startet sofort (0 statt 8 s) und leise (Lautstaerke 10 statt 100 %). Die alten Standardwerte ziehen mit, eigene bleiben.
      if (ver < 6 && trailer.delaySec === 8) trailer.delaySec = DEFAULT_SETTINGS.trailer.delaySec;
      if (ver < 6 && trailer.volume === 100) trailer.volume = DEFAULT_SETTINGS.trailer.volume;
      // Version 9: die Update-Quelle ist fest im Programm (DEFAULT_UPDATE_SOURCE) und weder zu sehen noch zu aendern. Eine eingetragene Quelle der Versionen 7 und 8 faellt weg.
      // Hiess sie "keine Updates" (in Version 7 geleert, in Version 8 eigene Quelle ohne Eintrag), bleibt das als ausgeschaltete automatische Pruefung erhalten.
      const gen = this.data.settings.general;
      if (ver < 9) {
        const src = String(gen.updateSource ?? '').trim();
        if ((ver === 7 && !src) || (ver === 8 && gen.updateCustom && !src)) gen.autoUpdate = false;
      }
      delete gen.updateSource;
      delete gen.updateCustom;
    } catch (e) {
      // Erste Ausfuehrung (keine Datei) oder defekte Datei: Standardwerte verwenden. Eine vorhandene, aber unlesbare Datei wird gesichert, bevor die Standardwerte sie ueberschreiben:
      // darin stehen Server, Anmeldungen und Einstellungen, und von Hand liesse sich daraus noch etwas retten.
      if (e?.code !== 'ENOENT') {
        try {
          this.io.backupCorrupt?.();
        } catch {
          /* Sicherung ist nur ein Angebot */
        }
      }
    }
    this._save();
  }

  _save() {
    this.io.write(JSON.stringify(this.data, null, 2));
  }

  _encode(token) {
    return this.codec.encode(token);
  }

  _decode(stored) {
    if (typeof stored !== 'string') return null;
    try {
      return this.codec.decode(stored);
    } catch {
      /* Token nicht entschluesselbar (anderer Windows-Nutzer): neu anmelden */
      return null;
    }
  }

  get deviceId() {
    return this.data.deviceId;
  }

  get settings() {
    return this.data.settings;
  }


  /** Zuletzt gespeicherte Fensterposition/-groesse ({x, y, width, height, maximized}) oder null. */
  get windowState() {
    const w = this.data.window;
    return w && Number.isFinite(w.width) && Number.isFinite(w.height) ? w : null;
  }

  saveWindowState(state) {
    this.data.window = { x: state.x, y: state.y, width: state.width, height: state.height, maximized: !!state.maximized };
    this._save();
  }

  /** Setzt alle Einstellungen auf die Standardwerte (Server und Anmeldungen bleiben erhalten). */
  resetSettings() {
    this.data.settings = structuredClone(DEFAULT_SETTINGS);
    this._save();
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = deepMerge(this.data.settings, patch);
    if (patch && typeof patch === 'object' && 'home' in patch) this.data.settings.home = HomeRows.homeConfig(this.data.settings.home);
    this._save();
    return this.data.settings;
  }

  /** Zustand fuer die Oberflaeche, ohne Tokens. */
  publicState() {
    return {
      deviceId: this.data.deviceId,
      activeServerId: this.data.activeServerId,
      servers: this.data.servers.map(({ id, url, name, userId, userName }) => ({ id, url, name, userId, userName })),
      // Seerr ohne Zugangsdaten: nur was die Oberflaeche zum Anzeigen braucht
      seerr: this.data.seerr ? { url: this.data.seerr.url, mode: this.data.seerr.mode, userName: this.data.seerr.userName } : null,
      settings: this.data.settings
    };
  }

  /** Seerr-Verbindung (fuer Anfragen). secret = Session-Cookie bzw. API-Schluessel, verschluesselt wie die Jellyfin-Token. */
  saveSeerr({ url, mode, userName, secret }) {
    this.data.seerr = { url, mode, userName, secret: this._encode(secret) };
    this._save();
  }

  /** @returns {{url:string, mode:'jellyfin'|'apikey', userName:string, secret:string}|null} null, wenn nicht verbunden oder nicht entschluesselbar */
  getSeerr() {
    const s = this.data.seerr;
    if (!s) return null;
    const secret = this._decode(s.secret);
    return secret ? { url: s.url, mode: s.mode, userName: s.userName, secret } : null;
  }

  clearSeerr() {
    delete this.data.seerr;
    this._save();
  }

  getServer(id = this.data.activeServerId) {
    const s = this.data.servers.find((x) => x.id === id);
    if (!s) return null;
    return { id: s.id, url: s.url, name: s.name, userId: s.userId, userName: s.userName, token: this._decode(s.token) };
  }

  /** Legt einen Server/Nutzer an oder aktualisiert ihn und macht ihn aktiv. */
  saveServer({ url, name, userId, userName, token }) {
    const id = this.env.hashId(`${url}|${userId}`);
    const entry = { id, url, name, userId, userName, token: this._encode(token) };
    const i = this.data.servers.findIndex((s) => s.id === id);
    if (i >= 0) this.data.servers[i] = entry;
    else this.data.servers.push(entry);
    this.data.activeServerId = id;
    this._save();
    return id;
  }

  setActive(id) {
    if (id !== null && !this.data.servers.some((s) => s.id === id)) return false;
    this.data.activeServerId = id;
    this._save();
    return true;
  }

  removeServer(id) {
    this.data.servers = this.data.servers.filter((s) => s.id !== id);
    if (this.data.activeServerId === id) this.data.activeServerId = this.data.servers[0]?.id ?? null;
    this._save();
  }
}

return { ConfigCore, DEFAULT_SETTINGS, DEFAULT_UPDATE_SOURCE, deepMerge, skipCountdownSec };
});