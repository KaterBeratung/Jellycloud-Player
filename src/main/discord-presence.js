'use strict';

const { EventEmitter } = require('node:events');
const { DiscordIpc } = require('./discord-ipc');

/**
 * Discord Rich Presence: zeigt in Discord, was gerade laeuft ("Schaut ..." mit Titel, Folge, Poster und Fortschritt).
 * Dieses Modul kennt weder Electron noch den Player: es bekommt Einstellungen und den aktuellen Stand der Wiedergabe von aussen (main.js)
 * und spricht ueber discord-ipc.js mit der Discord-App. Aufbau:
 *   normalizeSettings / buildActivity / isPublicHttpsUrl / createPosterResolver   reine Funktionen (getestet in test/discord-presence.test.js)
 *   DiscordPresence                                                                Verbindung, Drosselung, Wiederholung
 */

const CLIENT_ID = /^\d{17,20}$/; // Application-ID aus dem Discord-Entwicklerportal (eine "Snowflake")
/**
 * Application-ID der EINGEBAUTEN Discord-Anwendung "Jellycloud Player" (Entwicklerportal des Programmautors). Discord verlangt fuer Rich Presence eine Anwendung; mit einer
 * eingebauten muss niemand eine eigene anlegen, wie bei jellyfin-rpc. Die ID ist oeffentlich (kein Geheimnis). Leer = es ist keine eingebaut, dann traegt jeder seine eigene ein.
 * Wer eine eigene eintraegt (Einstellungen > Discord), benutzt sie statt der eingebauten.
 */
const DEFAULT_CLIENT_ID = '1568667335957676082';
const POSTER_MODES = ['auto', 'tmdb', 'server', 'off'];
const ACTIVITY_WATCHING = 3; // "Schaut ..."

const TEXT = {
  de: { paused: 'Pausiert', movie: 'Schaut einen Film', series: 'Schaut eine Serie', video: 'Schaut ein Video', imdb: 'Auf IMDb ansehen', tmdb: 'Auf TMDB ansehen', test: 'Verbindungstest', testState: 'Alles in Ordnung, das verschwindet gleich wieder' },
  en: { paused: 'Paused', movie: 'Watching a movie', series: 'Watching a show', video: 'Watching a video', imdb: 'View on IMDb', tmdb: 'View on TMDB', test: 'Connection test', testState: 'All good, this disappears in a moment' }
};
const textFor = (lang) => TEXT[String(lang).toLowerCase().startsWith('de') ? 'de' : 'en'];

/** Bringt rohe Einstellungen (aus config.json oder der Oberflaeche) in eine gueltige Form. */
function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    clientId: typeof r.clientId === 'string' ? r.clientId.trim() : '',
    poster: POSTER_MODES.includes(r.poster) ? r.poster : 'auto',
    hideTitle: r.hideTitle === true,
    button: r.button === true,
    // Name der Aktivitaet ("Schaut <Name>"): leer = der Name der Discord-Anwendung
    name: typeof r.name === 'string' ? clip(r.name, 128).trim() : ''
  };
}

/** Text fuer ein Discord-Feld: Leerraum glatt, hoechstens 128 Zeichen, mindestens 2 (Discord lehnt kuerzere ab; ein einzelnes Zeichen bekommt ein geschuetztes Leerzeichen). */
function clip(text, max = 128) {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim());
  if (!chars.length) return '';
  let s = chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
  if (Array.from(s).length < 2) s += ' ';
  return s;
}

const num = (v) => (Number.isFinite(v) ? v : null);

/** "S1E2", bei Doppelfolgen "S1E2-3"; ohne Staffelnummer "E2". */
function episodeCode(item) {
  const s = num(item.ParentIndexNumber);
  const e = num(item.IndexNumber);
  const end = num(item.IndexNumberEnd);
  if (e === null) return s !== null ? `S${s}` : '';
  return `${s !== null ? `S${s}` : ''}E${e}${end !== null && end > e ? `-${end}` : ''}`;
}

function providerId(item, name) {
  const ids = item?.ProviderIds && typeof item.ProviderIds === 'object' ? item.ProviderIds : {};
  const key = Object.keys(ids).find((k) => k.toLowerCase() === name);
  return key ? String(ids[key]).trim() : '';
}

/** Verweis fuer den Knopf: nur oeffentliche Seiten (IMDb, bei Filmen TMDB), nie etwas vom eigenen Server. */
function linkFor(item, text) {
  const imdb = providerId(item, 'imdb');
  if (/^tt\d{6,10}$/.test(imdb)) return { label: text.imdb, url: `https://www.imdb.com/title/${imdb}/` };
  const tmdb = providerId(item, 'tmdb');
  if (item.Type === 'Movie' && /^\d{1,9}$/.test(tmdb)) return { label: text.tmdb, url: `https://www.themoviedb.org/movie/${tmdb}` };
  return null;
}

/**
 * Aktivitaet fuer Discord aus dem Stand der Wiedergabe.
 * @param {{playing:{item:any, position:number, duration:number, paused:boolean, speed:number}, now:number, cfg:ReturnType<typeof normalizeSettings>, lang:string, posterUrl?:string|null}} o
 */
function buildActivity({ playing, now, cfg, lang, posterUrl = null }) {
  const { item } = playing;
  const text = textFor(lang);
  const isEpisode = item.Type === 'Episode';
  const isMovie = item.Type === 'Movie';
  let details;
  let state = '';
  if (cfg.hideTitle) {
    details = isEpisode ? text.series : isMovie ? text.movie : text.video;
  } else if (isEpisode) {
    details = item.SeriesName || item.Name;
    state = [episodeCode(item), item.SeriesName ? item.Name : ''].filter(Boolean).join(' · ');
  } else {
    details = item.Name;
    const genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 2).join(', ') : '';
    state = [num(item.ProductionYear), genres].filter(Boolean).join(' · ');
  }
  if (playing.paused) state = [text.paused, state].filter(Boolean).join(' · ');

  const activity = {
    type: ACTIVITY_WATCHING,
    // Eigener Name der Aktivitaet (Einstellung); ohne ihn gilt der Name der Discord-Anwendung. Er ersetzt nur den Namen, nicht den Titel
    ...(cfg.name ? { name: clip(cfg.name) } : {}),
    // Im Status neben dem Namen steht der Titel ("Schaut Paper Moons"); ohne Titel (verborgen) der Name der Anwendung
    status_display_type: cfg.hideTitle ? 0 : 2,
    details: clip(details),
    ...(state ? { state: clip(state) } : {})
  };

  // Fortschritt: Beginn und Ende als Zeitpunkte (Discord rechnet den Balken selbst weiter). Pausiert gibt es keinen laufenden Balken.
  // Unix-Zeit in SEKUNDEN, wie in Discords eigenen Bibliotheken (die Schnittstelle nimmt zwar auch Millisekunden an, Sekunden sind der dokumentierte Weg).
  const speed = Math.min(4, Math.max(0.25, Number(playing.speed) || 1));
  const duration = Number(playing.duration) > 0 ? Number(playing.duration) : 0;
  if (!playing.paused && duration > 0) {
    const position = Math.min(duration, Math.max(0, Number(playing.position) || 0));
    const start = Math.round(now / 1000 - position / speed);
    activity.timestamps = { start, end: start + Math.round(duration / speed) };
  }

  if (!cfg.hideTitle) {
    const tooltip = clip([activity.details, state].filter(Boolean).join(' · '));
    activity.assets = {
      ...(typeof posterUrl === 'string' && /^https:\/\//.test(posterUrl) && posterUrl.length <= 256 ? { large_image: posterUrl } : {}),
      ...(tooltip ? { large_text: tooltip } : {})
    };
    if (!Object.keys(activity.assets).length) delete activity.assets;
    if (cfg.button) {
      const link = linkFor(item, text);
      if (link) {
        activity.buttons = [{ label: clip(link.label, 32), url: link.url }];
        // Discord zeigt einem den eigenen Knopf nicht an (nur den anderen): der Titel wird deshalb zusaetzlich zum Link, den man auch selbst sieht und anklicken kann
        activity.details_url = link.url;
      }
    }
  }
  return activity;
}

/** Gleiche Anzeige? Der Fortschritt darf um ein paar Sekunden abweichen (die Uhr der Wiedergabe laeuft ohnehin ungenau), alles andere muss gleich sein. */
function sameActivity(a, b, toleranceSec = 3) {
  if (!a || !b) return false;
  const { timestamps: ta, ...restA } = a;
  const { timestamps: tb, ...restB } = b;
  if (JSON.stringify(restA) !== JSON.stringify(restB)) return false;
  if (!ta && !tb) return true;
  if (!ta || !tb) return false;
  return Math.abs(ta.start - tb.start) <= toleranceSec && Math.abs(ta.end - tb.end) <= toleranceSec;
}

/**
 * Kann Discord diese Adresse abrufen? Die Bilder holt nicht dein Rechner, sondern Discord ueber das Internet: ein Server im Heimnetz (localhost, 192.168.x.x, *.local, nur http)
 * ist fuer Discord unsichtbar. Nur https mit oeffentlichem Namen oder oeffentlicher Adresse.
 */
function isPublicHttpsUrl(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[')) return false; // IPv6-Adressen: nicht sicher als oeffentlich zu erkennen
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (!host.includes('.')) return false;
  return !/\.(local|lan|home|internal|localdomain|intranet|corp|home\.arpa|ts\.net)$/.test(host);
}

/**
 * Poster-Adresse fuer Discord. Quellen:
 *   tmdb    das Poster von TMDB, die Adresse kommt von Seerr (Titel nachschlagen). Verraet Discord nichts ueber deinen Server.
 *   server  das Poster vom Jellyfin-Server (die Bildadressen brauchen keine Anmeldung), nur wenn der Server von aussen per https erreichbar ist: Discord bekommt dann die Adresse des Servers zu sehen.
 *   auto    erst TMDB, sonst der Server
 * @param {{getClient:()=>any, getSeerr:()=>any, tmdbImageUrl:(size:string, file:string)=>string|null}} deps
 */
function createPosterResolver({ getClient, getSeerr, tmdbImageUrl }) {
  const seriesTmdb = new Map(); // Serien-Id -> TMDB-Nummer ('' = keine)

  async function seriesTmdbId(seriesId) {
    if (seriesTmdb.has(seriesId)) return seriesTmdb.get(seriesId);
    let id = '';
    try {
      id = providerId(await getClient().getItem(seriesId), 'tmdb');
    } catch {
      /* ohne Nummer kein TMDB-Poster */
    }
    seriesTmdb.set(seriesId, id);
    return id;
  }

  async function tmdbPoster(item) {
    const seerr = getSeerr();
    if (!seerr) return null;
    let type;
    let id = '';
    if (item.Type === 'Movie') {
      type = 'movie';
      id = providerId(item, 'tmdb');
    } else if (item.Type === 'Series') {
      type = 'tv';
      id = providerId(item, 'tmdb');
    } else if (item.SeriesId && (item.Type === 'Episode' || item.Type === 'Season')) {
      type = 'tv';
      id = await seriesTmdbId(item.SeriesId);
    }
    if (!type || !/^\d{1,9}$/.test(id)) return null;
    const details = await seerr.details(type, Number(id));
    const file = typeof details?.posterPath === 'string' ? details.posterPath.replace(/^\//, '') : '';
    return file ? tmdbImageUrl('w500', file) : null;
  }

  function serverPoster(item) {
    const client = getClient();
    if (!client || !isPublicHttpsUrl(client.baseUrl)) return null;
    // Folgen zeigen das Poster der Serie (das Bild der Folge ist ein Querformat-Standbild)
    const isEpisode = item.Type === 'Episode' || item.Type === 'Season';
    const id = isEpisode ? item.SeriesId : item.Id;
    const tag = isEpisode ? item.SeriesPrimaryImageTag : item.ImageTags?.Primary;
    if (!id || !tag || !/^[0-9a-fA-F-]{32,36}$/.test(String(id)) || !/^[\w.-]{1,64}$/.test(String(tag))) return null;
    return `${client.baseUrl.replace(/\/+$/, '')}/Items/${id}/Images/Primary?maxWidth=500&quality=90&tag=${tag}`;
  }

  return async function resolve(item, mode) {
    if (!item || mode === 'off') return null;
    if (mode === 'tmdb' || mode === 'auto') {
      try {
        const url = await tmdbPoster(item);
        if (url) return url;
      } catch {
        /* Seerr nicht erreichbar: bei "auto" weiter mit dem Server */
      }
    }
    if (mode === 'server' || mode === 'auto') return serverPoster(item);
    return null;
  };
}

/** Fassungen einer Anzeige, vom vollen Umfang zur schlichtesten: ohne die neueren Felder (Art der Status-Anzeige, eigener Name), dann ohne Knopf und als "Spielt" statt "Schaut". */
const VARIANTS = [
  (a) => a,
  (a) => {
    const { status_display_type: _s, name: _n, details_url: _u, ...rest } = a;
    return rest;
  },
  (a) => {
    const { status_display_type: _s, name: _n, details_url: _u, type: _t, buttons: _b, ...rest } = a;
    return rest;
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const displayName = (user) => user?.globalName || user?.username || '';

/**
 * Haelt die Anzeige in Discord auf dem Stand der Wiedergabe. refresh() wird bei jeder Aenderung gerufen (Start, Pause, Sprung, Ende, Einstellungen); alles Weitere
 * regelt dieses Objekt: Verbindung bei Bedarf, hoechstens eine Aktualisierung alle paar Sekunden (Discord drosselt), nichts doppelt senden, beim Ende der Wiedergabe
 * erst nach kurzer Schonfrist entfernen (Folgenwechsel flackert nicht), erneuter Versuch, wenn Discord (noch) nicht da ist.
 *
 * Zustand fuer die Oberflaeche (status()): off, no-id (keine ID eingebaut und keine eigene eingetragen), invalid-id (eigene ID unvollstaendig), idle, showing, no-discord, bad-id, error.
 */
class DiscordPresence extends EventEmitter {
  /**
   * @param {{getSettings:()=>any, getPlaying:()=>({item:any, position:number, duration:number, paused:boolean, speed:number}|null), resolvePoster?:(item:any, mode:string)=>Promise<string|null>,
   *   getLanguage?:()=>string, createIpc?:(o:any)=>DiscordIpc, pathFor?:(i:number)=>string, now?:()=>number,
   *   minIntervalMs?:number, graceMs?:number, retryMs?:number, debounceMs?:number, posterWaitMs?:number, testMs?:number}} o
   */
  constructor(o) {
    super();
    this.getSettings = o.getSettings;
    this.getPlaying = o.getPlaying;
    this.resolvePoster = o.resolvePoster ?? (async () => null);
    this.getLanguage = o.getLanguage ?? (() => 'en');
    this.createIpc = o.createIpc ?? ((opts) => new DiscordIpc(opts));
    this.pathFor = o.pathFor;
    this.now = o.now ?? Date.now; // Uhrzeit fuer den Fortschritt (Unix-Zeit in ms)
    this.mono = o.mono ?? (() => performance.now()); // gleichmaessige Uhr fuer die Drosselung (unabhaengig von Zeitspruengen der Systemuhr)
    this.minIntervalMs = o.minIntervalMs ?? 5000;
    this.graceMs = o.graceMs ?? 3000;
    this.retryMs = o.retryMs ?? 15000;
    this.debounceMs = o.debounceMs ?? 300;
    this.posterWaitMs = o.posterWaitMs ?? 1500;
    this.testMs = o.testMs ?? 10000;
    this.defaultClientId = o.defaultClientId ?? DEFAULT_CLIENT_ID; // eingebaute Anwendung (leer: keine)
    this.ipc = null;
    this.ipcId = '';
    this.connecting = null;
    this.lastSent = null;
    this.lastSentAt = -Infinity; // gleichmaessige Uhr (mono) der letzten Aktualisierung
    this.badId = ''; // Application-ID, die Discord abgelehnt hat: wird nicht erneut versucht, bis sie geaendert wird
    this.level = 0; // welche Fassung der Anzeige Discord annimmt (VARIANTS): 0 = voll
    this.timer = null;
    this.graceTimer = null;
    this.testTimer = null;
    this.testIpc = null;
    this.running = false;
    this.again = false;
    this.disposed = false;
    this.posters = new Map(); // "Modus:Id" -> { promise, url? }
    this.info = { state: 'off', error: '', user: '' };
  }

  /** Stand fuer die Einstellungen (builtIn: ist eine Anwendung eingebaut, braucht niemand eine eigene ID). */
  status() {
    return { ...this.info, user: this.ipc?.connected ? displayName(this.ipc.user) : this.info.user, builtIn: !!this.defaultClientId };
  }

  /**
   * Welche Application-ID gilt? Eine eigene (Einstellung), sonst die eingebaute. Eine halb getippte eigene ID ist ein Fehler ("invalid-id"), keine stille Rueckkehr zur eingebauten.
   * @returns {{id:string, problem?:'invalid-id'|'no-id'}}
   */
  _resolveId(raw) {
    const own = String(raw ?? '').trim();
    if (!own) return CLIENT_ID.test(this.defaultClientId) ? { id: this.defaultClientId } : { id: '', problem: 'no-id' };
    return CLIENT_ID.test(own) ? { id: own } : { id: '', problem: 'invalid-id' };
  }

  _setInfo(state, error = '') {
    this.info = { state, error, user: this.ipc?.connected ? displayName(this.ipc.user) : '' };
    this.emit('status', this.status());
  }

  /** Etwas hat sich geaendert (Wiedergabe oder Einstellungen): gleich, aber gebuendelt neu bewerten. */
  refresh() {
    if (this.disposed) return;
    this._later(this.debounceMs);
  }

  _later(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this._run();
    }, Math.max(0, ms));
    this.timer.unref?.();
  }

  async _run() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this._step();
      } while (this.again && !this.disposed);
    } catch (e) {
      this._setInfo('error', e?.message ?? String(e));
    } finally {
      this.running = false;
    }
  }

  async _step() {
    if (this.disposed) return;
    const cfg = normalizeSettings(this.getSettings());
    if (!cfg.enabled) return this._stop('off');
    const resolved = this._resolveId(cfg.clientId);
    if (resolved.problem) return this._stop(resolved.problem);
    cfg.clientId = resolved.id; // ab hier die wirksame ID (eigene oder eingebaute)
    if (this.badId && this.badId !== cfg.clientId) this.badId = ''; // eine andere ID: neuer Versuch
    if (this.badId) return; // diese ID hat Discord schon abgelehnt (Status "bad-id" steht)
    if (this.ipc && this.ipcId !== cfg.clientId) await this._dropIpc(true); // andere Anwendung gewaehlt: neu verbinden
    let playing = this.getPlaying();
    if (!playing) {
      // Nichts laeuft: die Anzeige bleibt noch kurz stehen (zwischen zwei Folgen, beim Neuladen), dann wird sie entfernt
      if (this.lastSent && !this.graceTimer) {
        this.graceTimer = setTimeout(() => {
          this.graceTimer = null;
          this._clear().catch(() => {});
        }, this.graceMs);
        this.graceTimer.unref?.();
      } else if (!this.lastSent && !['idle', 'no-discord', 'bad-id', 'error'].includes(this.info.state)) this._setInfo('idle');
      return;
    }
    clearTimeout(this.graceTimer);
    this.graceTimer = null;

    let posterUrl = null;
    if (!cfg.hideTitle && cfg.poster !== 'off') {
      posterUrl = await this._poster(playing.item, cfg.poster);
      // Waehrend des Wartens kann sich die Wiedergabe geaendert haben (naechste Folge, Ende): neu bewerten
      const fresh = this.getPlaying();
      if (!fresh || fresh.item.Id !== playing.item.Id) {
        this.again = true;
        return;
      }
      playing = fresh;
    }
    const activity = buildActivity({ playing, now: this.now(), cfg, lang: this.getLanguage(), posterUrl });
    if (this.lastSent && sameActivity(this.lastSent, activity)) return;
    const wait = this.lastSentAt + this.minIntervalMs - this.mono();
    if (wait > 0) {
      this._later(wait); // Discord begrenzt die Zahl der Aktualisierungen: spaeter, mit dem dann neuesten Stand
      return;
    }
    await this._send(cfg, activity);
  }

  _poster(item, mode) {
    const key = `${mode}:${item.Id}`;
    let entry = this.posters.get(key);
    if (!entry) {
      entry = { url: undefined };
      entry.promise = Promise.resolve()
        .then(() => this.resolvePoster(item, mode))
        .then(
          (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null),
          () => null
        )
        .then((u) => {
          entry.url = u;
          this.refresh(); // kam das Poster erst nach der ersten Anzeige: nachreichen
          return u;
        });
      this.posters.set(key, entry);
      if (this.posters.size > 40) this.posters.delete(this.posters.keys().next().value);
    }
    if (entry.url !== undefined) return Promise.resolve(entry.url);
    return Promise.race([entry.promise, sleep(this.posterWaitMs).then(() => null)]);
  }

  async _connect(clientId) {
    if (this.ipc?.connected && this.ipcId === clientId) return this.ipc;
    if (this.connecting) return this.connecting;
    const ipc = this.createIpc({ clientId, pathFor: this.pathFor });
    this.connecting = (async () => {
      try {
        await ipc.open();
      } catch (e) {
        ipc.close();
        throw e;
      }
      ipc.on('close', () => this._onClosed(ipc));
      this.ipc = ipc;
      this.ipcId = clientId;
      return ipc;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  _onClosed(ipc) {
    if (this.ipc !== ipc) return;
    this.ipc = null;
    this.lastSent = null; // Discord hat die Anzeige mit der Verbindung verloren
    this.level = 0; // vielleicht wurde Discord inzwischen aktualisiert: wieder mit dem vollen Umfang beginnen
    this._setInfo('idle');
    this.refresh(); // laeuft noch etwas, verbindet der naechste Schritt neu
  }

  async _send(cfg, activity) {
    try {
      await this._connect(cfg.clientId);
    } catch (e) {
      this._setInfo(e.kind === 'bad-id' ? 'bad-id' : e.kind === 'no-discord' ? 'no-discord' : 'error', e.message);
      if (e.kind === 'bad-id') this.badId = cfg.clientId; // das aendert sich nicht von selbst: erst bei einer neuen ID wieder versuchen
      else this._later(this.retryMs); // Discord laeuft vielleicht gleich: bei laufender Wiedergabe erneut versuchen
      return;
    }
    // Lehnt Discord die Anzeige ab (aeltere Discord-Versionen kennen manche Felder nicht), schlichtere Fassungen versuchen und die erste, die klappt, fuer die Zukunft merken
    let error = null;
    for (let level = this.level; level < VARIANTS.length; level++) {
      try {
        await this.ipc.setActivity(VARIANTS[level](activity));
        this.level = level;
        error = null;
        break;
      } catch (e) {
        error = e;
        if (e.kind !== 'rejected') break; // Verbindung weg oder keine Antwort: andere Fassung hilft nicht
      }
    }
    if (error) {
      this._setInfo('error', error.message);
      if (error.kind === 'closed' || error.kind === 'timeout') this._later(this.retryMs);
      return;
    }
    this.lastSent = activity; // die gebaute Fassung (zum Vergleichen), nicht die abgespeckte
    this.lastSentAt = this.mono();
    this._setInfo('showing');
  }

  async _clear() {
    if (!this.lastSent) return;
    this.lastSent = null;
    try {
      await this.ipc?.clearActivity();
    } catch {
      /* Verbindung weg: Discord raeumt selbst auf */
    }
    this._setInfo('idle');
  }

  async _dropIpc(graceful) {
    const ipc = this.ipc;
    this.ipc = null;
    this.lastSent = null;
    if (!ipc) return;
    ipc.removeAllListeners('close');
    if (graceful) await ipc.clearActivity().catch(() => {});
    ipc.close();
  }

  async _stop(state) {
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.badId = ''; // aus- und wieder einschalten ist ein neuer Versuch
    await this._dropIpc(true);
    if (this.info.state !== state) this._setInfo(state);
  }

  /**
   * Verbindungstest mit der angegebenen Application-ID: verbindet, zeigt kurz eine Testanzeige und entfernt sie wieder. Unabhaengig vom Schalter.
   * @returns {Promise<{ok:true, user:string}|{ok:false, kind:string, message?:string}>}
   */
  async test(clientId) {
    const { id, problem } = this._resolveId(clientId);
    if (problem) return { ok: false, kind: problem };
    if (this.getPlaying()) return { ok: false, kind: 'busy' };
    const text = textFor(this.getLanguage());
    const name = normalizeSettings(this.getSettings()).name;
    const ipc = this.createIpc({ clientId: id, pathFor: this.pathFor });
    try {
      const user = await ipc.open();
      const now = this.now();
      // Die Testanzeige traegt den eingestellten Namen: so sieht man gleich, wie er in Discord aussieht
      await ipc.setActivity({ type: ACTIVITY_WATCHING, ...(name ? { name: clip(name) } : {}), status_display_type: 0, details: clip('Jellycloud Player'), state: clip(text.testState), timestamps: { start: Math.round(now / 1000), end: Math.round((now + this.testMs) / 1000) } });
      clearTimeout(this.testTimer);
      this.testIpc?.close();
      this.testIpc = ipc;
      this.testTimer = setTimeout(() => {
        ipc.close();
        if (this.testIpc === ipc) this.testIpc = null;
      }, this.testMs);
      this.testTimer.unref?.();
      if (this.badId === id) {
        this.badId = ''; // die ID gilt jetzt doch (etwa weil die Anwendung inzwischen angelegt wurde)
        this.refresh();
      }
      return { ok: true, user: displayName(user) };
    } catch (e) {
      ipc.close();
      return { ok: false, kind: e.kind ?? 'error', message: e.message };
    }
  }

  /** Beim Beenden der App: Anzeige entfernen, Verbindung schliessen. */
  async shutdown() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.graceTimer);
    clearTimeout(this.testTimer);
    this.testIpc?.close();
    this.testIpc = null;
    await Promise.race([this._dropIpc(true), sleep(800)]);
  }
}

module.exports = { CLIENT_ID, DEFAULT_CLIENT_ID, POSTER_MODES, normalizeSettings, clip, episodeCode, buildActivity, sameActivity, isPublicHttpsUrl, createPosterResolver, DiscordPresence };
