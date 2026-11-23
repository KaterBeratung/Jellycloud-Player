/* Gemeinsames Modul: Einstellungen, Standardwerte und die Konfigurationsablage ohne eigene Ein-/Ausgabe.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCConfig) in der Web-/Handy-Fassung.
   Wohin gespeichert wird und wie Zugangsdaten verschluesselt werden, steckt in `io` und `codec` (Hauptprozess: Datei und Windows-DPAPI in src/main/config.js,
   Web/Handy: localStorage bzw. der sichere Speicher des Geraets in src/web/jc-web.js). Der Aufbau der Konfiguration und alle Regeln beim Laden sind fuer alle gleich. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./home-rows'), require('./glow'), require('./player-rules'));
  else root.JCConfig = factory(root.JCHomeRows, root.JCGlow, root.JCPlayerRules);
})(typeof self !== 'undefined' ? self : this, function (HomeRows, Glow, PlayerRules) {
  'use strict';
/** Standardwerte aller Einstellungen. Neue Schluessel werden beim Laden automatisch ergaenzt. */
/**
 * Die Update-Quelle: die Release-Dateien des oeffentlichen GitHub-Repos (latest.json und der Installer des neuesten Releases).
 * Der Teil "releases/latest/download/" liefert immer die Dateien des jeweils neuesten Releases, ohne Anmeldung.
 * Sie ist FEST eingebaut: nicht in den Einstellungen zu sehen oder zu aendern, nicht in der Konfigurationsdatei und nicht ueber die Oberflaeche.
 * (Tests setzen die Quelle ueber updater.getSource.)
 */
const DEFAULT_UPDATE_SOURCE = 'https://github.com/KaterBeratung/Jellycloud-Player/releases/latest/download/';

const DEFAULT_SETTINGS = {
  language: 'auto', // 'auto' | 'de' | 'en'
  appearance: {
    theme: 'midnight', // midnight | graphite | amoled | midnightBlue (nur dunkle Designs wie in der Apple-App; ein gespeichertes "daylight" wird midnightBlue)
    accent: '#f5f5f7', // neutrales Silberweiss wie bei Apple TV; frei waehlbar (Weiss/Grau/Schwarz passen sich dem Theme an)
    posterSize: 176, // Breite einer Poster-Karte in px
    // Eckenradius fest 18 px und keine Animationsstufe mehr (Entscheidung E7, wie in der Apple-App): Bewegung nimmt allein die Systemeinstellung zurueck
    blur: true, // Glas-Effekte (Backdrop-Blur)
    heroAutoplay: true, // Hero-Banner wechselt automatisch
    ambient: true, // Hintergrund nimmt dezent die Farbe des gezeigten Banners/Titels auf (wie Apple TV)
    cardTitles: true // Titel unter den Postern
  },
  // Startseite anpassen: Banner (an/aus, Folien), Zeitraum der Top 10 und Reihen (Reihenfolge, ausgeblendet, je Profil); Regeln in src/shared/home-rows.js.
  // "Banner wechselt automatisch" ist appearance.heroAutoplay. "Filme im Trend" ist seit 1.2.14 eine Reihe wie jede andere (ausblenden ueber "hidden").
  home: structuredClone(HomeRows.DEFAULTS),
  // Ambient Glow (wie in der Apple-App): an, Verlauf Lila zu Blau, 100 %, je Bereich an und ohne eigene Einstellung. Regeln, tolerantes Lesen und
  // Aendern in src/shared/glow.js; gespeichert wird die ganze Einstellung (updateSettings ersetzt sie, statt sie zu verschmelzen).
  glow: Glow.defaults(),
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
    // Android (Plan P21, wie die Apple-App): Mehrkanalspur behalten, auch wenn die Tonausgabe nur Stereo kann (sonst dort die Stereo-Spur derselben
    // Sprache, wenn es eine gibt). Windows waehlt nach der Tonausgabe (audioChannels) und nutzt den Schalter nicht.
    keepSurround: false,
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
    // Ueberspringen wie in der Apple-App (Plan P22, E10; Regeln in src/shared/player-rules.js): ueber dem Bild nur "Intro ueberspringen"; der Abspann
    // bestimmt den Countdown zur naechsten Folge; Rueckblick und Vorschau nur automatisch oder gar nicht. skipDelay: Wartezeit bei "Automatisch" (0/3/5/8/10 s).
    skipIntro: 'button', // button | auto | off
    skipOutro: 'button', // button | auto | off
    skipRecap: 'off', // auto | off
    skipPreview: 'off', // auto | off
    skipDelay: 5,
    // Standardbild (Bildformat beim Start): auto | fit | fill | stretch; im Player je Wiedergabe umschaltbar
    videoFormat: 'auto',
    resumeRewindSec: 5,
    seekSmall: 5, // Pfeiltasten
    seekBig: 10, // J / L und Knoepfe
    wheelAction: 'volume', // volume | seek | none
    fullscreenOnPlay: false,
    pauseOnMinimize: true,
    pauseScreen: true, // Pausenbildschirm: nach einigen Sekunden Pause zeigt der Player Logo, Beschreibung und "Endet um ..."
    pauseScreenSec: 6, // so lange muss die Pause ohne Bedienung dauern
    preventSleep: true, // Bildschirm waehrend der Wiedergabe nicht abschalten
    // Andere Geraete: "Auf diesem Geraet fortsetzen" auf der Startseite anbieten (Plan P19). Aus: keine Abfrage der Sitzungen; den Stopp anderer Geraete nimmt
    // die App waehrend der Wiedergabe trotzdem an (sonst koennte kein anderes Geraet uebernehmen)
    showHandoff: true,
    // Netzwerk
    // Bitratengrenze (Plan P21, src/shared/bitrate.js): 0 = Automatisch (im Heimnetz ohne Grenze, ueber das Internet nach der gemessenen Bandbreite),
    // sonst Mbit/s; ueber das Internet gilt die Grenze des Servers immer zuerst
    maxBitrateMbps: 0,
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
/** Nur dunkle Designs (wie in der Apple-App). */
const THEMES = ['midnight', 'graphite', 'amoled', 'midnightBlue'];
/** Hoechstens vier Profile je Geraet. */
const MAX_PROFILES = 4;
const cleanLabel = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '');
/** Ein gespeichertes Profil tolerant: eigener Name und Seerr nur, wenn sie lesbar sind (eine leere Sitzung heisst: eingerichtet, aber abgemeldet). */
function readProfile(s) {
  const out = { ...s, label: cleanLabel(s.label) };
  const z = s.seerr;
  if (z && typeof z === 'object' && typeof z.url === 'string' && z.url && typeof z.secret === 'string') out.seerr = { url: z.url, userName: String(z.userName ?? ''), jellyfinUserId: typeof z.jellyfinUserId === 'string' ? z.jellyfinUserId : '', secret: z.secret };
  else delete out.seerr;
  return out;
}
/** Reihen je Profil tolerant: ein unlesbarer Eintrag faellt allein weg. */
function readRowsMap(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [id, r] of Object.entries(raw)) {
    if (!isPlainObject(r) || id === '__proto__') continue;
    const c = HomeRows.homeConfig({ order: r.order, hidden: r.hidden });
    if (c.order.length || c.hidden.length) out[id] = { order: c.order, hidden: c.hidden };
  }
  return out;
}
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
      version: 10,
      deviceId: env.uuid(),
      activeServerId: null,
      servers: [],
      settings: structuredClone(DEFAULT_SETTINGS),
      homeRowsByProfile: {},
      homeRowsAdopted: false
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
      this.data.settings = deepMerge(DEFAULT_SETTINGS, raw.settings);
      this.data.settings.home = HomeRows.homeConfig(this.data.settings.home); // Grenzen und Listen pruefen (eine von Hand bearbeitete Datei darf nichts zerlegen)
      this.data.settings.glow = Glow.normalize(raw.settings?.glow); // Ambient Glow tolerant lesen (Unlesbares faellt einzeln weg)
      // (Version 2 hob den alten Eckenradius 14 an; seit Version 10 gibt es keinen Eckenradius mehr.)
      const ver = raw.version ?? 1;
      const look = this.data.settings.appearance;
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
      // Tags (4K, HDR, Atmos ...) haben keinen Schalter mehr (wie in der Apple-App, Entscheidung E7): ein gespeicherter Wert faellt weg
      delete look.showBadges;
      // Version 10 (Angleichung an die Apple-App): nur dunkle Designs (das helle "daylight" wird Midnight Blue), keine Animationsstufe (Bewegung nimmt
      // allein die Systemeinstellung "Bewegung reduzieren" zurueck), kein Eckenradius, kein Schalter fuer die Startanimation (Entscheidung E7).
      if (look.theme === 'daylight') look.theme = 'midnightBlue';
      if (!THEMES.includes(look.theme)) look.theme = DEFAULT_SETTINGS.appearance.theme;
      delete look.animations;
      delete look.radius;
      delete look.startAnimation;
      // Profile: eigener Name (nur auf diesem Geraet) und Seerr je Profil; tolerant gelesen
      this.data.servers = this.data.servers.map((s) => readProfile(s));
      // Reihen der Startseite je Profil (bleiben auch nach dem Abmelden); die Reihen des Geraets gehen einmal an die gemerkten Profile (_adoptHomeRows)
      this.data.homeRowsByProfile = readRowsMap(raw.homeRowsByProfile);
      this.data.homeRowsAdopted = raw.homeRowsAdopted === true;
      // Seit 1.2.14 (Entscheidung E8, wie die Apple-App): "Filme im Trend" hat keinen eigenen Schalter mehr, sondern ist eine Reihe wie jede andere. War der
      // alte Schalter aus, ist die Reihe ausgeblendet: bei jedem Profil und bei den Reihen des Geraets (die gehen spaeter an neue Profile). Laeuft bei jedem
      // Lesen, bis die Datei ohne den alten Schalter gespeichert ist; doppelt ausgeblendet wird nichts.
      if (raw.settings?.appearance?.homeTrending === false) {
        const hide = (r) => ({ order: r.order, hidden: r.hidden.includes('trending') ? r.hidden : [...r.hidden, 'trending'] });
        const device = this.data.settings.home;
        this.data.settings.home = HomeRows.homeConfig({ ...device, hidden: hide(device).hidden });
        if (this.data.homeRowsAdopted) for (const s of this.data.servers) this.setHomeRows(hide(this.homeRows(s.id)), s.id, { save: false });
      }
      delete look.homeTrending;
      // Seit 1.2.21 (Plan P22, E10): statt des Countdowns an den Knoepfen (0/3/6/10/15 s) eine Wartezeit fuer "Automatisch" (0/3/5/8/10 s), die naechste
      // passende gilt; der Rueckblick hatte keinen eigenen Schalter und folgte "Intro" auf "Automatisch". Laeuft, bis die Datei ohne die alten Werte gespeichert ist.
      const play = this.data.settings.player;
      const rawPlay = raw.settings?.player ?? {};
      if (rawPlay.skipCountdown !== undefined && rawPlay.skipDelay === undefined) play.skipDelay = PlayerRules.delayFromCountdown(rawPlay.skipCountdown);
      if (rawPlay.skipCountdown !== undefined && rawPlay.skipRecap === undefined) play.skipRecap = rawPlay.skipIntro === 'auto' ? 'auto' : 'off';
      delete play.skipCountdown;
      if (!PlayerRules.SKIP_DELAYS.includes(play.skipDelay)) play.skipDelay = PlayerRules.DEFAULT_SKIP_DELAY;
      for (const type of PlayerRules.SEGMENT_TYPES) {
        const key = PlayerRules.SETTING_KEYS[type];
        if (!PlayerRules.SKIP_MODES[type].includes(play[key])) play[key] = PlayerRules.DEFAULT_MODES[type];
      }
      play.videoFormat = PlayerRules.videoFormat(play.videoFormat);
      if (typeof raw.seerrAddress === 'string' && raw.seerrAddress) this.data.seerrAddress = raw.seerrAddress.slice(0, 300);
      // Seerr bis Version 9: eine Verbindung fuer das ganze Geraet. Sie geht an das aktive Profil, wenn der Benutzername passt (Jellyfin-Konto); sonst wird
      // nur die Adresse vorbelegt. Verbindungen mit API-Schluessel verfallen (Entscheidung E12): einmal mit dem Jellyfin-Konto neu anmelden.
      if (ver < 10 && raw.seerr && typeof raw.seerr === 'object' && typeof raw.seerr.url === 'string' && raw.seerr.url) {
        const active = this.data.servers.find((s) => s.id === this.data.activeServerId);
        const same = active && raw.seerr.mode !== 'apikey' && typeof raw.seerr.secret === 'string' && raw.seerr.secret && String(raw.seerr.userName ?? '').trim().toLowerCase() === String(active.userName ?? '').trim().toLowerCase();
        if (same) active.seerr = { url: raw.seerr.url, userName: String(raw.seerr.userName), jellyfinUserId: '', secret: raw.seerr.secret };
        else this.data.seerrAddress = raw.seerr.url.slice(0, 300);
      }
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
    this.data.version = 10;
    this._adoptHomeRows();
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

  get maxProfiles() {
    return MAX_PROFILES;
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

  /** Setzt alle Einstellungen auf die Standardwerte (Server und Anmeldungen bleiben erhalten); die Reihen der Startseite des aktiven Profils auch. */
  resetSettings() {
    this.data.settings = structuredClone(DEFAULT_SETTINGS);
    if (this.data.homeRowsAdopted && this.data.activeServerId) delete this.data.homeRowsByProfile[this.data.activeServerId];
    this._save();
    return this.publicState().settings;
  }

  /**
   * Aendert Einstellungen. Reihenfolge und ausgeblendete Reihen der Startseite (home.order, home.hidden) gehoeren dem aktiven Profil (seit Version 10);
   * Banner und Folien gelten fuer das Geraet. Ohne Profil (abgemeldet) bleiben die Reihen beim Geraet.
   */
  updateSettings(patch) {
    let p = patch;
    if (p && typeof p === 'object' && p.home && typeof p.home === 'object' && this.data.homeRowsAdopted && this.data.activeServerId && ('order' in p.home || 'hidden' in p.home)) {
      const cur = this.homeRows();
      this.setHomeRows({ order: 'order' in p.home ? p.home.order : cur.order, hidden: 'hidden' in p.home ? p.home.hidden : cur.hidden }, this.data.activeServerId, { save: false });
      const { order, hidden, ...rest } = p.home;
      p = { ...p, home: rest };
    }
    this.data.settings = deepMerge(this.data.settings, p);
    if (p && typeof p === 'object' && 'home' in p) this.data.settings.home = HomeRows.homeConfig(this.data.settings.home);
    // Ambient Glow: die Oberflaeche schickt die ganze Einstellung (src/shared/glow.js set.*); sie ersetzt die alte, damit Bereiche auch wegfallen koennen
    if (p && typeof p === 'object' && 'glow' in p) this.data.settings.glow = Glow.normalize(p.glow);
    this._save();
    return this.publicState().settings;
  }

  /** Zustand fuer die Oberflaeche, ohne Tokens. Die Einstellungen tragen die Reihen der Startseite des aktiven Profils. */
  publicState() {
    const active = this.data.servers.find((s) => s.id === this.data.activeServerId);
    const rows = this.homeRows();
    return {
      deviceId: this.data.deviceId,
      activeServerId: this.data.activeServerId,
      servers: this.data.servers.map(({ id, url, name, userId, userName, label }) => ({ id, url, name, userId, userName, label: label || '' })),
      maxProfiles: MAX_PROFILES,
      // Seerr des aktiven Profils ohne Zugangsdaten; seerrAddress: Adresse zum Vorbelegen (eigene oder aus der Zeit vor Version 10)
      seerr: active?.seerr ? { url: active.seerr.url, userName: active.seerr.userName } : null,
      seerrAddress: active?.seerr?.url ?? this.data.seerrAddress ?? null,
      settings: { ...this.data.settings, home: { ...this.data.settings.home, order: rows.order, hidden: rows.hidden } }
    };
  }

  // ---------- Reihen der Startseite je Profil ----------
  /** Reihen eines Profils: vor der Uebernahme die des Geraets, danach die eigenen (ein neues Profil und "kein Profil" beginnen mit der Standardfolge). */
  homeRows(id = this.data.activeServerId) {
    if (!this.data.homeRowsAdopted) return { order: [...this.data.settings.home.order], hidden: [...this.data.settings.home.hidden] };
    const map = this.data.homeRowsByProfile;
    const r = id && Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
    return r ? { order: [...r.order], hidden: [...r.hidden] } : { order: [], hidden: [] };
  }

  setHomeRows(rows, id = this.data.activeServerId, { save = true } = {}) {
    if (!id) return;
    const clean = HomeRows.homeConfig({ order: rows?.order, hidden: rows?.hidden });
    if (!clean.order.length && !clean.hidden.length) delete this.data.homeRowsByProfile[id];
    else this.data.homeRowsByProfile[id] = { order: clean.order, hidden: clean.hidden };
    if (save) this._save();
  }

  /**
   * Einmalig: die Reihen des Geraets (bis Version 9) werden die jedes gemerkten Profils. Ohne gemerktes Profil wartet die Uebernahme, sonst gingen
   * die Reihen verloren; ohne eigene Reihen gibt es nichts zu uebernehmen. Die Felder des Geraets bleiben gespeichert, wie sie waren.
   */
  _adoptHomeRows() {
    if (this.data.homeRowsAdopted) return;
    const device = { order: this.data.settings.home.order, hidden: this.data.settings.home.hidden };
    const has = device.order.length || device.hidden.length;
    if (!has) {
      this.data.homeRowsAdopted = true;
      return;
    }
    if (!this.data.servers.length) return;
    for (const s of this.data.servers) this.data.homeRowsByProfile[s.id] = { order: [...device.order], hidden: [...device.hidden] };
    this.data.homeRowsAdopted = true;
  }

  // ---------- Profile ----------
  /** Kennung eines Profils (Server und Benutzer). */
  profileId(url, userId) {
    return this.env.hashId(`${url}|${userId}`);
  }

  /** Hoechstens vier Profile (wie in der Apple-App): ein schon gemerktes darf sich immer neu anmelden; ueber der Grenze kommt nur keines dazu. */
  mayAddProfile(id) {
    return this.data.servers.some((s) => s.id === id) || this.data.servers.length < MAX_PROFILES;
  }

  /** Eigener Name eines Profils (nur auf diesem Geraet; leer: der Name des Benutzers). */
  setProfileLabel(id, label) {
    const s = this.data.servers.find((x) => x.id === id);
    if (!s) return false;
    s.label = cleanLabel(label);
    this._save();
    return true;
  }

  // ---------- Seerr je Profil (seit Version 10; nur mit dem Jellyfin-Konto, kein API-Schluessel) ----------
  /** Seerr des aktiven Profils. secret = Sitzungs-Cookie, verschluesselt wie die Jellyfin-Token. */
  saveSeerr({ url, userName, jellyfinUserId = '', secret }) {
    const s = this.data.servers.find((x) => x.id === this.data.activeServerId);
    if (!s) throw Object.assign(new Error('Kein Profil angemeldet'), { code: 'NO_PROFILE' });
    s.seerr = { url, userName: String(userName ?? ''), jellyfinUserId: String(jellyfinUserId ?? ''), secret: this._encode(secret) };
    this.data.seerrAddress = String(url).slice(0, 300); // zuletzt verwendete Adresse: ein anderes Profil findet sie vorbelegt (wie die Apple-App), keine Zugangsdaten
    this._save();
  }

  /**
   * Seerr eines Profils; null, wenn keines eingerichtet ist. secret ist leer, wenn die Sitzung verworfen wurde (fremde Sitzung) oder sich nicht
   * entschluesseln laesst: dann bleibt Seerr eingerichtet, und die Oberflaeche bietet "Erneut anmelden" an (die Einrichtung geht nicht verloren).
   * @returns {{url:string, userName:string, jellyfinUserId:string, secret:string}|null}
   */
  getSeerr(id = this.data.activeServerId) {
    const s = this.data.servers.find((x) => x.id === id)?.seerr;
    if (!s) return null;
    const secret = s.secret ? this._decode(s.secret) : null;
    return { url: s.url, userName: s.userName, jellyfinUserId: s.jellyfinUserId || '', secret: secret || '' };
  }

  /** Verwirft nur die Sitzung eines Profils (Adresse und Konto bleiben fuer "Erneut anmelden"). */
  dropSeerrSession(id = this.data.activeServerId) {
    const s = this.data.servers.find((x) => x.id === id);
    if (!s?.seerr) return false;
    s.seerr = { ...s.seerr, secret: '' };
    this._save();
    return true;
  }

  clearSeerr() {
    const s = this.data.servers.find((x) => x.id === this.data.activeServerId);
    if (s?.seerr) {
      this.data.seerrAddress = s.seerr.url; // zum erneuten Anmelden vorbelegt
      delete s.seerr;
    }
    this._save();
  }

  getServer(id = this.data.activeServerId) {
    const s = this.data.servers.find((x) => x.id === id);
    if (!s) return null;
    return { id: s.id, url: s.url, name: s.name, serverId: typeof s.serverId === 'string' ? s.serverId : '', userId: s.userId, userName: s.userName, label: s.label || '', token: this._decode(s.token) };
  }

  /**
   * Legt ein Profil (Server und Benutzer) an oder aktualisiert es und macht es aktiv; eigener Name und Seerr bleiben. serverId: Kennung des Servers
   * (/System/Info/Public), damit eine neue Adresse spaeter als derselbe Server erkannt wird. Ueber der Grenze: Fehler PROFILE_LIMIT.
   */
  saveServer({ url, name, serverId = '', userId, userName, token }) {
    const id = this.profileId(url, userId);
    const i = this.data.servers.findIndex((s) => s.id === id);
    if (i < 0 && !this.mayAddProfile(id)) throw Object.assign(new Error(`Höchstens ${MAX_PROFILES} Profile`), { code: 'PROFILE_LIMIT' });
    const prev = i >= 0 ? this.data.servers[i] : {};
    const sid = typeof serverId === 'string' && serverId ? serverId : typeof prev.serverId === 'string' ? prev.serverId : '';
    const entry = { id, url, name, ...(sid ? { serverId: sid } : {}), userId, userName, token: this._encode(token), label: prev.label || '', ...(prev.seerr ? { seerr: prev.seerr } : {}) };
    if (i >= 0) this.data.servers[i] = entry;
    else this.data.servers.push(entry);
    this.data.activeServerId = id;
    this._adoptHomeRows(); // das erste Profil nach einem Start ohne Profil bekommt die Reihen des Geraets
    this._save();
    return id;
  }

  setActive(id) {
    if (id !== null && !this.data.servers.some((s) => s.id === id)) return false;
    this.data.activeServerId = id;
    this._save();
    return true;
  }

  /**
   * Neue Adresse fuer ein Profil (derselbe Server, geprueft von der Rueckseite): die Kennung des Profils haengt an der Adresse und aendert sich mit;
   * Anmeldung, eigener Name, Seerr-Sitzung und Reihen der Startseite ziehen mit, ein aktives Profil bleibt aktiv. Gibt die neue Kennung zurueck.
   * Ist dasselbe Konto unter der neuen Adresse schon gemerkt: Fehler PROFILE_EXISTS (zwei Eintraege lassen sich nicht stillschweigend zusammenlegen).
   */
  moveProfile(id, { url, name, serverId }) {
    const s = this.data.servers.find((x) => x.id === id);
    if (!s) throw Object.assign(new Error('Unbekanntes Profil'), { code: 'NO_PROFILE' });
    const next = this.profileId(url, s.userId);
    if (next !== id && this.data.servers.some((x) => x.id === next)) throw Object.assign(new Error('Dieses Profil ist unter der Adresse schon gemerkt'), { code: 'PROFILE_EXISTS' });
    s.id = next;
    s.url = url;
    if (typeof name === 'string' && name) s.name = name;
    if (typeof serverId === 'string' && serverId) s.serverId = serverId;
    if (this.data.activeServerId === id) this.data.activeServerId = next;
    const rows = this.data.homeRowsByProfile;
    if (next !== id && Object.prototype.hasOwnProperty.call(rows, id)) {
      rows[next] = rows[id];
      delete rows[id];
    }
    this._save();
    return next;
  }

  /** Entfernt ein Profil samt seiner Seerr-Sitzung; seine Reihen der Startseite bleiben (bei erneuter Anmeldung wieder da). */
  removeServer(id) {
    this.data.servers = this.data.servers.filter((s) => s.id !== id);
    if (this.data.activeServerId === id) this.data.activeServerId = this.data.servers[0]?.id ?? null;
    this._save();
  }
}
return { ConfigCore, DEFAULT_SETTINGS, DEFAULT_UPDATE_SOURCE, THEMES, MAX_PROFILES, deepMerge };
});