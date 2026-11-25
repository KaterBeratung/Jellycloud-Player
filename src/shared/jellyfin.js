/* Gemeinsames Modul: laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCJellyfin) in der Oberflaeche der Web-/Handy-Fassung (src/web).
   Keine eigenen Abhaengigkeiten ausser dem eingespeisten fetch; `node:os` nur, wenn es Node gibt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require : null, require('./bitrate'));
  else root.JCJellyfin = factory(null, root.JCBitrate);
})(typeof self !== 'undefined' ? self : this, function (nodeRequire, Bitrate) {
  'use strict';

  const os = nodeRequire ? nodeRequire('node:os') : null;
const TICKS_PER_SECOND = 10_000_000;
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Jellyfin haengt das Token als ApiKey (aeltere Fassungen: api_key) an die Adresse des Stroms und der Untertitel (StreamInfo.ToUrl, nachgelesen im
 * Quelltext von Jellyfin, Plan Q5). mpv und Media3 senden es im Kopf (Authorization), den der Server fuer jede Anfrage annimmt; darum faellt es hier
 * aus der Adresse. So steht es nie in Adressen, die ein Player oeffnet, anzeigt oder protokolliert. Alles andere bleibt Zeichen fuer Zeichen gleich.
 */
function withoutAccessToken(url) {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const kept = query.split('&').filter((part) => part && !/^api_?key(=|$)/i.test(part));
  return `${url.slice(0, q)}${kept.length ? `?${kept.join('&')}` : ''}${hash < 0 ? '' : url.slice(hash)}`;
}

/**
 * Fehler von Jellyfin. code: "OFFLINE" (Server nicht erreicht) oder "TIMEOUT" (keine Antwort in der Frist), sonst null; er geht als einziges Merkmal
 * neben status ueber die IPC-Grenze und trennt in der Oberflaeche "nicht erreichbar" von einer Antwort des Servers.
 */
class JellyfinError extends Error {
  constructor(message, { status = 0, body = null, code = null } = {}) {
    super(message);
    this.name = 'JellyfinError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

/** Schema ergaenzen (http), Host klein, Standardport, Anfrage, Fragment und Zugangsdaten weg (new URL), Pfad-Reste wie /web/index.html und schliessende Schraegstriche weg. */
function normalizeServerUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new JellyfinError('Server-Adresse fehlt');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new JellyfinError('Ungültige Server-Adresse');
  }
  if (!u.hostname) throw new JellyfinError('Ungültige Server-Adresse');
  const p = u.pathname.replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '');
  return `${u.origin}${p}`;
}

/** Ohne Schema probieren wir https, dann http, dann http mit Standardport 8096. */
function candidateUrls(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new JellyfinError('Server-Adresse fehlt');
  if (/^https?:\/\//i.test(s)) return [normalizeServerUrl(s)];
  const withHttps = normalizeServerUrl(`https://${s}`);
  const withHttp = normalizeServerUrl(`http://${s}`);
  const out = [withHttps, withHttp];
  try {
    if (!new URL(withHttp).port) out.push(normalizeServerUrl(`http://${s.replace(/\/.*$/, '')}:8096`));
  } catch {
    /* ignorieren */
  }
  return out;
}

/**
 * fetch mit Frist: nach timeoutMs wird abgebrochen (signal) und das Warten endet mit einem AbortError, auch wenn die Abruffunktion das Signal
 * nicht kennt (die native HTTP-Schicht der Android-Huelle, mobile/host-capacitor.js; vorher wartete sie dort bis zu ihrer eigenen Frist von 10 s
 * fuer den Aufbau und 20 s fuer die Antwort). Bringt der Aufrufer ein eigenes Signal mit, gilt nur seins.
 */
async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 20000) {
  if (init.signal) return fetchImpl(url, init);
  const ctrl = new AbortController();
  let timer = null;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(Object.assign(new Error('Zeitueberschreitung'), { name: 'AbortError' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Findet einen erreichbaren Jellyfin-Server und liefert die oeffentlichen Infos. */
async function probeServer(input, fetchImpl = globalThis.fetch) {
  let lastErr = null;
  let answered = false; // unter einer der Adressen hat etwas geantwortet (auch etwas, das kein Jellyfin ist): dann ist es kein Netzfehler
  for (const url of candidateUrls(input)) {
    try {
      const res = await fetchWithTimeout(fetchImpl, `${url}/System/Info/Public`, { headers: { Accept: 'application/json' } }, 6000);
      answered = true;
      if (!res.ok) throw new JellyfinError(`Server antwortet mit ${res.status}`, { status: res.status });
      let info = null;
      try {
        info = await res.json();
      } catch {
        /* kein JSON: kein Jellyfin */
      }
      if (!info || !info.Id) throw new JellyfinError('Das ist kein Jellyfin-Server');
      return { url, info };
    } catch (e) {
      lastErr = e;
    }
  }
  const timedOut = !answered && !!lastErr && lastErr.name === 'AbortError';
  throw new JellyfinError(timedOut ? 'Zeitueberschreitung beim Verbinden' : `Server nicht erreichbar${lastErr ? `: ${lastErr.message}` : ''}`, {
    code: answered ? null : timedOut ? 'TIMEOUT' : 'OFFLINE'
  });
}

function toQuery(query) {
  if (!query) return '';
  if (query instanceof URLSearchParams) {
    const s = query.toString();
    return s ? `?${s}` : '';
  }
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Kennungen (Eintraege, Benutzer, Aufgaben) bestehen nur aus Hex-Ziffern und Bindestrichen: sonst Fehler, bevor sie in einen Pfad gelangen. */
function checkId(id) {
  const s = String(id ?? '');
  if (!/^[0-9a-fA-F-]{8,40}$/.test(s)) throw new JellyfinError('Ungueltige Kennung', { status: 400 });
  return s;
}

/** Text ohne Steuerzeichen (ausser Zeilenumbruechen) in den Laengengrenzen; sonst verstaendlicher Fehler. */
function checkText(value, what, min, max) {
  const s = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length < min) throw new JellyfinError(`${what} fehlt`, { status: 400 });
  if (s.length > max) throw new JellyfinError(`${what} ist zu lang (hoechstens ${max} Zeichen)`, { status: 400 });
  return s;
}

/** Liste von Texten: leere fallen weg, doppelte auch, Anzahl und Laenge sind begrenzt. */
function checkList(value, what, maxCount, maxLen) {
  if (!Array.isArray(value)) throw new JellyfinError(`${what}: Liste erwartet`, { status: 400 });
  const out = [];
  for (const v of value) {
    const s = checkText(v, what, 0, maxLen);
    if (s && !out.includes(s)) out.push(s);
  }
  if (out.length > maxCount) throw new JellyfinError(`${what}: hoechstens ${maxCount} Eintraege`, { status: 400 });
  return out;
}

/** Die Felder, die das Bearbeiten-Fenster kennt. */
function pickEditable(dto) {
  return {
    Id: dto.Id,
    Type: dto.Type,
    Name: dto.Name ?? '',
    OriginalTitle: dto.OriginalTitle ?? '',
    Overview: dto.Overview ?? '',
    Taglines: dto.Taglines ?? [],
    ProductionYear: dto.ProductionYear ?? null,
    OfficialRating: dto.OfficialRating ?? '',
    Genres: dto.Genres ?? [],
    Tags: dto.Tags ?? []
  };
}

const LIST_FIELDS = ['PrimaryImageAspectRatio', 'ProductionYear', 'CommunityRating', 'OfficialRating', 'RunTimeTicks', 'ImageBlurHashes', 'ParentIndexNumber', 'IndexNumber', 'SeriesName', 'MediaStreams', 'Overview', 'Taglines', 'Genres', 'DateCreated'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'People', 'MediaSources', 'Chapters', 'Trickplay', 'Studios', 'ProviderIds', 'RemoteTrailers', 'CriticRating', 'ParentId', 'SeasonName', 'SeriesId', 'SeriesPrimaryImageTag', 'ExternalUrls'];

class JellyfinClient {
  /**
   * @param {{baseUrl:string, token?:string|null, userId?:string|null, deviceId:string, clientName?:string, clientVersion?:string, deviceName?:string, fetch?:typeof fetch}} opts
   */
  constructor(opts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token ?? null;
    this.userId = opts.userId ?? null;
    this.deviceId = opts.deviceId;
    // Name des Programms wie bei allen Jellycloud-Apps (Regel 1 der Wiedergabeuebernahme, Plan P19 K10): andere Geraete erkennen es daran
    this.clientName = opts.clientName ?? 'Jellycloud';
    this.clientVersion = opts.clientVersion ?? '0.1.0';
    this.deviceName = (opts.deviceName ?? (os ? os.hostname() : 'Web')).replace(/[^\x20-\x7e]/g, '?').replace(/"/g, "'");
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.logoutTimeoutMs = 4000; // Zeitgrenze fuer das Abmelden beim Server (die uebrigen Anfragen: 20 s)
  }

  authHeader() {
    const parts = [
      `Client="${this.clientName}"`,
      `Device="${this.deviceName}"`,
      `DeviceId="${this.deviceId}"`,
      `Version="${this.clientVersion}"`
    ];
    if (this.token) parts.push(`Token="${this.token}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  /** Header fuer mpv (Direct Play): enthaelt das Token, damit es nicht in der URL steht. */
  mpvHeaders() {
    return [`Authorization: ${this.authHeader()}`];
  }

  url(path, query) {
    return `${this.baseUrl}${path}${toQuery(query)}`;
  }

  async request(method, path, { query, body, signal, timeout = 20000, raw = false } = {}) {
    const headers = { Authorization: this.authHeader(), Accept: 'application/json' };
    const init = { method, headers, signal };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchWithTimeout(this.fetch, this.url(path, query), init, timeout);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new JellyfinError('Zeitueberschreitung bei der Anfrage', { code: 'TIMEOUT' });
      throw new JellyfinError(`Netzwerkfehler: ${e && e.message ? e.message : e}`, { code: 'OFFLINE' });
    }
    if (raw) return res;
    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* ignorieren */
      }
      throw new JellyfinError(res.status === 401 ? 'Nicht angemeldet' : `HTTP ${res.status}`, { status: res.status, body: text });
    }
    if (res.status === 204) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return null;
    return res.json();
  }

  /** Probiert mehrere Pfade nacheinander (neue / aeltere Jellyfin-Versionen). */
  async requestFirst(method, paths, opts) {
    let lastErr;
    for (const p of paths) {
      try {
        return await this.request(method, p, opts);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof JellyfinError) || ![404, 405].includes(e.status)) throw e;
      }
    }
    throw lastErr;
  }

  // ---------- Anmeldung ----------
  async authenticateByName(username, password) {
    const r = await this.request('POST', '/Users/AuthenticateByName', { body: { Username: username, Pw: password ?? '' } });
    return this._adoptAuth(r);
  }

  /** Bietet der Server Quick Connect an? strict: Netz- und Serverfehler werfen (statt "nein"), damit "ausgeschaltet" nur heisst, was der Server sagt. */
  async quickConnectEnabled({ strict = false } = {}) {
    try {
      const r = await this.request('GET', '/QuickConnect/Enabled', { timeout: 10000 });
      return r === true;
    } catch (e) {
      if (strict) throw e;
      return false;
    }
  }

  /**
   * Bestaetigt den Code eines ANDEREN Geraets mit dem Konto dieses Clients (Quick Connect fuer andere Geraete). Der Code steht nur in dieser einen
   * Anfrage, wie Jellyfin ihn verlangt; hier wird er weder gemerkt noch protokolliert.
   */
  quickConnectAuthorize(code) {
    return this.request('POST', '/QuickConnect/Authorize', { query: { code, userId: this.userId }, timeout: 15000 });
  }

  quickConnectInitiate() {
    return this.request('POST', '/QuickConnect/Initiate');
  }

  quickConnectCheck(secret) {
    return this.request('GET', '/QuickConnect/Connect', { query: { secret } });
  }

  async authenticateWithQuickConnect(secret) {
    const r = await this.request('POST', '/Users/AuthenticateWithQuickConnect', { body: { Secret: secret } });
    return this._adoptAuth(r);
  }

  _adoptAuth(r) {
    this.token = r.AccessToken;
    this.userId = r.User.Id;
    return { token: r.AccessToken, userId: r.User.Id, userName: r.User.Name, serverId: r.ServerId };
  }

  async logout() {
    try {
      // Kurze Zeitgrenze: ist der Server nicht erreichbar, soll das Abmelden nicht 20 s haengen (lokal wird ohnehin abgemeldet)
      await this.request('POST', '/Sessions/Logout', { timeout: this.logoutTimeoutMs });
    } catch {
      /* Token war evtl. schon ungueltig */
    }
  }

  getMe() {
    return this.request('GET', '/Users/Me');
  }

  getPublicInfo() {
    return this.request('GET', '/System/Info/Public');
  }

  /**
   * Faehigkeiten dieser Sitzung. mediaControl: sie nimmt Befehle an (nur waehrend der Wiedergabe, zusammen mit dem offenen Steuerkanal; erst dann fuehrt der
   * Server sie als steuerbar, Plan P19). Keine weiteren Befehle angemeldet.
   */
  postCapabilities({ mediaControl = false } = {}) {
    return this.request('POST', '/Sessions/Capabilities/Full', {
      body: { PlayableMediaTypes: ['Audio', 'Video'], SupportedCommands: [], SupportsMediaControl: mediaControl === true, SupportsPersistentIdentifier: true },
      timeout: 8000
    }).catch(() => null);
  }

  // ---------- Auf diesem Geraet fortsetzen (Plan P19) ----------
  /**
   * Die Sitzungen, die dieses Konto steuern darf und die sich in den letzten 90 s gemeldet haben (fuer ein normales Konto die eigenen, fuer einen Administrator
   * alle; welche davon angeboten werden, entscheidet src/shared/handoff.js). Roh, wie der Server sie liefert; ohne angemeldetes Konto keine Anfrage.
   */
  async remoteSessions() {
    if (!this.userId) return [];
    const r = await this.request('GET', '/Sessions', { query: { ControllableByUserId: this.userId, ActiveWithinSeconds: 90 }, timeout: 8000 });
    return Array.isArray(r) ? r : [];
  }

  /**
   * Alle Sitzungen, die der Server diesem Konto nennt und die sich in den letzten 16 Minuten gemeldet haben ("Laeuft gerade" und die Angebote "Auf diesem
   * Geraet fortsetzen" aus einer Abfrage, Regel 18 der Apple-App): einem Administrator alle Konten, sonst die eigenen. Roh; ohne Konto keine Anfrage.
   */
  async sessionsOverview() {
    if (!this.userId) return [];
    const r = await this.request('GET', '/Sessions', { query: { ActiveWithinSeconds: 960 }, timeout: 8000 });
    return Array.isArray(r) ? r : [];
  }

  /** Pause oder Abspielen auf einer anderen Sitzung (Regel 14: nie PlayPause). Wessen Sitzung das sein darf, prueft die Rueckseite vorher. */
  sendPlaystate(sessionId, command) {
    if (command !== 'Pause' && command !== 'Unpause') return Promise.reject(new JellyfinError('Unbekannter Befehl', { status: 400 }));
    return this.request('POST', `/Sessions/${encodeURIComponent(String(sessionId))}/Playing/${command}`, { timeout: 8000 });
  }

  /** Haelt die Wiedergabe einer anderen Sitzung an. Wessen Sitzung das sein darf, prueft die App vorher selbst an frisch gelesenen Sitzungen. */
  stopRemotePlayback(sessionId) {
    return this.request('POST', `/Sessions/${encodeURIComponent(String(sessionId))}/Playing/Stop`, { timeout: 8000 });
  }

  /** Eintrag fuer die Uebernahme: gemerkte Stelle und ob es etwas zum Abspielen gibt (MediaSources), mit eigener Zeitgrenze. */
  async handoffItem(id, timeout = 8000) {
    const r = await this.request('GET', '/Items', { query: { userId: this.userId, ids: id, fields: ['MediaSources'], enableUserData: true, enableImages: false }, timeout });
    const item = r?.Items?.[0];
    if (!item) throw new JellyfinError('Eintrag nicht gefunden', { status: 404 });
    const ticks = item.UserData?.PlaybackPositionTicks;
    return { positionTicks: Number.isFinite(ticks) ? ticks : null, playable: Array.isArray(item.MediaSources) && item.MediaSources.length > 0 };
  }

  // ---------- Bibliothek ----------
  async getViews() {
    const r = await this.requestFirst('GET', ['/UserViews', `/Users/${this.userId}/Views`], { query: { userId: this.userId } });
    return r.Items ?? [];
  }

  getItems(query = {}) {
    return this.request('GET', '/Items', { query: { userId: this.userId, enableImageTypes: 'Primary,Backdrop,Thumb,Logo', imageTypeLimit: 1, enableUserData: true, fields: LIST_FIELDS, ...query } });
  }

  async getItem(id) {
    const r = await this.getItems({ ids: id, fields: DETAIL_FIELDS, imageTypeLimit: 3 });
    const item = r.Items?.[0];
    if (!item) throw new JellyfinError('Eintrag nicht gefunden', { status: 404 });
    return item;
  }

  async getResume(limit = 16) {
    const query = { userId: this.userId, limit, mediaTypes: 'Video', fields: LIST_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb,Logo', imageTypeLimit: 1 };
    const r = await this.requestFirst('GET', ['/UserItems/Resume', `/Users/${this.userId}/Items/Resume`], { query });
    return r.Items ?? [];
  }

  async getNextUp(limit = 16, seriesId) {
    const r = await this.request('GET', '/Shows/NextUp', {
      query: { userId: this.userId, limit, seriesId, fields: LIST_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb,Logo', imageTypeLimit: 1, disableFirstEpisode: false }
    });
    return r.Items ?? [];
  }

  async getLatest(parentId, limit = 20) {
    // Mit Logo: das Banner der Startseite zeigt es statt des Titels als Text (ohne Logo in der Antwort gaebe es nur den Text)
    const query = { userId: this.userId, parentId, limit, fields: LIST_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb,Logo', imageTypeLimit: 1, groupItems: true };
    const r = await this.requestFirst('GET', ['/Items/Latest', `/Users/${this.userId}/Items/Latest`], { query });
    return Array.isArray(r) ? r : r?.Items ?? [];
  }

  async getSeasons(seriesId) {
    const r = await this.request('GET', `/Shows/${seriesId}/Seasons`, { query: { userId: this.userId, fields: LIST_FIELDS, enableUserData: true } });
    return r.Items ?? [];
  }

  async getEpisodes(seriesId, seasonId) {
    const r = await this.request('GET', `/Shows/${seriesId}/Episodes`, { query: { userId: this.userId, seasonId, fields: LIST_FIELDS, enableUserData: true } });
    return r.Items ?? [];
  }

  async getGenres(parentId, includeItemTypes) {
    const r = await this.request('GET', '/Genres', { query: { userId: this.userId, parentId, includeItemTypes, sortBy: 'SortName' } });
    return (r.Items ?? []).map((g) => g.Name);
  }

  async getSimilar(id, limit = 12) {
    try {
      const r = await this.request('GET', `/Items/${id}/Similar`, { query: { userId: this.userId, limit, fields: LIST_FIELDS } });
      return r.Items ?? [];
    } catch {
      return [];
    }
  }

  // ---------- Top 10 (src/shared/rankings.js; nur fuer die Rueckseite, nicht aus der Oberflaeche aufrufbar) ----------

  /**
   * TMDB-Nummer -> Eintrag fuer alle Filme ("Movie") oder Serien ("Series"), die das angemeldete Profil sehen darf: eine schlanke Liste (nur Kennung und
   * Nummern, ohne Bilder und Nutzerdaten), seitenweise, damit auch grosse Mediatheken bei wenigen hundert Kilobyte je Seite bleiben. Hat die Mediathek einen
   * Titel mehrfach (zwei Fassungen, zwei Bibliotheken), gilt der erste Eintrag.
   * @returns {Promise<Map<number,string>>}
   */
  async tmdbIndex(itemType, { pageSize = 2000, maxItems = 60000 } = {}) {
    if (itemType !== 'Movie' && itemType !== 'Series') throw new JellyfinError('Unbekannte Art', { status: 400 });
    const index = new Map();
    for (let start = 0; start < maxItems; start += pageSize) {
      const r = await this.request('GET', '/Items', { query: { userId: this.userId, includeItemTypes: itemType, recursive: true, fields: 'ProviderIds', enableImages: false, enableUserData: false, enableTotalRecordCount: false, startIndex: start, limit: pageSize } });
      const page = r?.Items ?? [];
      for (const item of page) {
        const raw = Object.entries(item?.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === 'tmdb')?.[1];
        const id = /^\d{1,9}$/.test(String(raw ?? '')) ? Number(raw) : null;
        if (id && !index.has(id) && typeof item.Id === 'string') index.set(id, item.Id);
      }
      if (page.length < pageSize) break;
    }
    return index;
  }

  /** Die Eintraege zu diesen Kennungen in deren Reihenfolge, mit allem, was eine Karte braucht. Was das Profil nicht (mehr) sehen darf oder was geloescht ist, fehlt. */
  async itemsInOrder(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter((id) => /^[0-9a-fA-F-]{8,40}$/.test(String(id))).slice(0, 50);
    if (!list.length) return [];
    const r = await this.getItems({ ids: list.join(','), fields: [...LIST_FIELDS, 'ProviderIds'] });
    const byId = new Map((r.Items ?? []).map((i) => [i.Id, i]));
    return list.map((id) => byId.get(id)).filter(Boolean);
  }

  // ---------- Personen (wie die Apple-App, Seite einer Person) ----------

  /** Eine Person (Schauspiel, Regie ...) mit Biografie, Geburts- und Todestag, Geburtsort und ihren Nummern bei anderen Diensten (TMDB). */
  async getPerson(id) {
    const r = await this.getItems({ ids: checkId(id), fields: ['Overview', 'PremiereDate', 'EndDate', 'ProductionLocations', 'ProviderIds'], enableImageTypes: 'Primary,Backdrop' });
    const person = r.Items?.[0];
    // Die Kennung eines Films oder einer Serie ist keine Person (Adresse von Hand)
    if (!person || (person.Type && person.Type !== 'Person')) throw new JellyfinError('Person nicht gefunden', { status: 404 });
    return person;
  }

  /** Was es von einer Person in der Mediathek gibt: Filme, Serien und Folgen (Gastrollen), das Neueste zuerst; mit den TMDB-Nummern fuer den Abgleich mit Seerr. */
  async getPersonItems(id) {
    const r = await this.getItems({ personIds: checkId(id), recursive: true, includeItemTypes: 'Movie,Series,Episode', sortBy: 'ProductionYear,PremiereDate,SortName', sortOrder: 'Descending', limit: 300, fields: [...LIST_FIELDS, 'ProviderIds'] });
    return r.Items ?? [];
  }

  /**
   * Die Person der Mediathek mit dieser TMDB-Nummer (Seite einer Person aus der Besetzung eines Seerr-Titels). Der Name grenzt nur die Suche ein; zugeordnet wird
   * allein ueber die Nummer, nie ueber den Namen. Ohne Treffer oder bei einem Fehler null.
   */
  async personByTmdb(tmdbId, name) {
    const n = Number(tmdbId);
    const term = String(name ?? '').trim().slice(0, 200);
    if (!Number.isInteger(n) || n <= 0 || !term) return null;
    const r = await this.request('GET', '/Persons', { query: { searchTerm: term, userId: this.userId, fields: 'ProviderIds', limit: 20, enableImages: false } }).catch(() => null);
    const tmdbOf = (p) => Object.entries(p?.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === 'tmdb')?.[1];
    return (r?.Items ?? []).find((p) => String(tmdbOf(p) ?? '') === String(n)) ?? null;
  }

  /**
   * Bittet den Server, fehlende Angaben einer Person nachzuladen (Jellyfin holt Biografie und Lebensdaten erst bei Bedarf). Nur fuer Administratoren; sonst lehnt der
   * Server ab. Vorhandenes bleibt (nichts wird ersetzt). true, wenn der Server den Auftrag angenommen hat.
   */
  async refreshPerson(id) {
    try {
      await this.request('POST', `/Items/${checkId(id)}/Refresh`, { query: { metadataRefreshMode: 'FullRefresh', imageRefreshMode: 'Default', replaceAllMetadata: false, replaceAllImages: false } });
      return true;
    } catch {
      return false;
    }
  }

  /** Suche in der Mediathek; mit den TMDB-Nummern (ProviderIds), damit die Suche Treffer von Seerr ueber Nummer und Art abgleichen kann, nie ueber den Titel. */
  async search(term, limit = 40) {
    const r = await this.getItems({ searchTerm: term, includeItemTypes: 'Movie,Series,Episode,BoxSet', recursive: true, limit, fields: [...LIST_FIELDS, 'ProviderIds'] });
    return r.Items ?? [];
  }

  setPlayed(id, played) {
    return this.requestFirst(played ? 'POST' : 'DELETE', [`/UserPlayedItems/${id}`, `/Users/${this.userId}/PlayedItems/${id}`], { query: { userId: this.userId } });
  }

  setFavorite(id, favorite) {
    return this.requestFirst(favorite ? 'POST' : 'DELETE', [`/UserFavoriteItems/${id}`, `/Users/${this.userId}/FavoriteItems/${id}`], { query: { userId: this.userId } });
  }

  /**
   * Der Server holt Metadaten und Bilder eines Eintrags neu ("Metadaten aktualisieren"). Nur fuer Administratoren (sonst 403);
   * der Server arbeitet im Hintergrund weiter. replaceAll: vorhandene Metadaten und Bilder ersetzen statt nur Fehlendes zu ergaenzen.
   */
  refreshItem(id, { replaceAll = false } = {}) {
    return this.request('POST', `/Items/${id}/Refresh`, {
      query: { recursive: true, metadataRefreshMode: 'FullRefresh', imageRefreshMode: 'FullRefresh', replaceAllMetadata: replaceAll, replaceAllImages: replaceAll }
    });
  }

  // ---------- Verwaltung (nur fuer Administratoren; jeder andere Benutzer bekommt vom Server 403) ----------
  // Alle Kennungen werden geprueft, bevor sie in einen Pfad gelangen, Texte werden begrenzt. Gefaehrliche Aktionen bestaetigt die Oberflaeche vorher.

  getSystemInfo() {
    return this.request('GET', '/System/Info');
  }

  /** Alle Bibliotheken nach neuen und geaenderten Dateien durchsuchen (laeuft auf dem Server im Hintergrund weiter). */
  refreshLibrary() {
    return this.request('POST', '/Library/Refresh');
  }

  async getScheduledTasks() {
    const r = await this.request('GET', '/ScheduledTasks', { query: { isHidden: false } });
    return Array.isArray(r) ? r : [];
  }

  async startTask(taskId) {
    return this.request('POST', `/ScheduledTasks/Running/${checkId(taskId)}`);
  }

  async stopTask(taskId) {
    return this.request('DELETE', `/ScheduledTasks/Running/${checkId(taskId)}`);
  }

  /** Aktive Sitzungen (in den letzten 16 Minuten aktiv): wer schaut was, auf welchem Geraet. */
  async getSessions() {
    const r = await this.request('GET', '/Sessions', { query: { activeWithinSeconds: 960 } });
    return Array.isArray(r) ? r : [];
  }

  async getActivity(limit = 60) {
    const r = await this.request('GET', '/System/ActivityLog/Entries', { query: { limit: Math.min(200, Math.max(1, Math.round(+limit) || 60)), startIndex: 0 } });
    return r?.Items ?? [];
  }

  async getUsers() {
    const r = await this.request('GET', '/Users');
    return Array.isArray(r) ? r : [];
  }

  async createUser(name, password = '') {
    return this.request('POST', '/Users/New', { body: { Name: checkText(name, 'Name', 1, 64), Password: String(password ?? '').slice(0, 200) } });
  }

  /** Sperrt oder entsperrt einen Benutzer: die Richtlinie des Benutzers wird gelesen und mit geaendertem IsDisabled zurueckgeschrieben (der Server verlangt sie komplett). */
  async setUserDisabled(userId, disabled) {
    const id = this._otherUser(userId, 'sperren');
    const user = await this.request('GET', `/Users/${id}`);
    if (user?.Policy?.IsAdministrator && disabled) throw new JellyfinError('Administratoren lassen sich hier nicht sperren', { status: 400 });
    return this.request('POST', `/Users/${id}/Policy`, { body: { ...(user?.Policy ?? {}), IsDisabled: !!disabled } });
  }

  /** Setzt das Passwort zurueck (danach ist es leer) oder auf einen neuen Wert. */
  async resetUserPassword(userId) {
    return this.request('POST', `/Users/${checkId(userId)}/Password`, { body: { ResetPassword: true } });
  }

  async setUserPassword(userId, password) {
    return this.request('POST', `/Users/${checkId(userId)}/Password`, { body: { NewPw: checkText(password, 'Passwort', 1, 200) } });
  }

  async deleteUser(userId) {
    return this.request('DELETE', `/Users/${this._otherUser(userId, 'loeschen')}`);
  }

  _otherUser(userId, what) {
    const id = checkId(userId);
    if (id.replace(/-/g, '').toLowerCase() === String(this.userId ?? '').replace(/-/g, '').toLowerCase()) throw new JellyfinError(`Das eigene Konto laesst sich hier nicht ${what}`, { status: 400 });
    return id;
  }

  /** Der vollstaendige Eintrag, wie der Server ihn zum Bearbeiten liefert (neue Server: /Items/{id}, aeltere: /Users/{id}/Items/{id}). */
  _editableItem(id) {
    return this.requestFirst('GET', [`/Items/${id}`, `/Users/${this.userId}/Items/${id}`], { query: { userId: this.userId } });
  }

  /** Die bearbeitbaren Felder eines Eintrags fuer das Bearbeiten-Fenster. */
  async getItemForEdit(itemId) {
    const dto = await this._editableItem(checkId(itemId));
    return pickEditable(dto);
  }

  /**
   * Speichert geaenderte Felder (Titel, Originaltitel, Beschreibung, Slogan, Jahr, Altersfreigabe, Genres, Tags). Der Server verlangt den ganzen Eintrag:
   * er wird frisch gelesen, nur diese Felder werden ersetzt, dann geht er zurueck (so bleibt alles andere unveraendert).
   */
  async updateItem(itemId, patch) {
    const id = checkId(itemId);
    const dto = await this._editableItem(id);
    const p = patch ?? {};
    if ('Name' in p) dto.Name = checkText(p.Name, 'Titel', 1, 300);
    if ('OriginalTitle' in p) dto.OriginalTitle = checkText(p.OriginalTitle, 'Originaltitel', 0, 300);
    if ('Overview' in p) dto.Overview = checkText(p.Overview, 'Beschreibung', 0, 10000);
    if ('OfficialRating' in p) dto.OfficialRating = checkText(p.OfficialRating, 'Altersfreigabe', 0, 40);
    if ('Taglines' in p) dto.Taglines = checkList(p.Taglines, 'Slogan', 10, 300);
    if ('Genres' in p) dto.Genres = checkList(p.Genres, 'Genres', 40, 80);
    if ('Tags' in p) dto.Tags = checkList(p.Tags, 'Tags', 60, 80);
    if ('ProductionYear' in p) {
      const y = p.ProductionYear === null || p.ProductionYear === '' ? null : Math.round(+p.ProductionYear);
      if (y !== null && !(y >= 1800 && y <= 2200)) throw new JellyfinError('Jahr ungueltig', { status: 400 });
      dto.ProductionYear = y;
    }
    await this.request('POST', `/Items/${id}`, { body: dto });
    return pickEditable(dto);
  }

  /** Loescht einen Eintrag vom Server (Dateien und Eintrag, je nach Server-Einstellung). Nicht rueckgaengig zu machen. */
  async deleteItem(itemId) {
    return this.request('DELETE', `/Items/${checkId(itemId)}`);
  }

  /** Online-Suche nach dem richtigen Treffer (Identifizieren). type: Movie oder Series. */
  async searchRemote(itemId, type, { name, year } = {}) {
    if (!['Movie', 'Series'].includes(type)) throw new JellyfinError('Nur Filme und Serien lassen sich identifizieren', { status: 400 });
    const y = year === undefined || year === null || year === '' ? undefined : Math.round(+year);
    const r = await this.request('POST', `/Items/RemoteSearch/${type}`, {
      body: { SearchInfo: { Name: checkText(name, 'Name', 1, 300), Year: Number.isFinite(y) ? y : undefined }, ItemId: checkId(itemId), IncludeDisabledProviders: true },
      timeout: 40000
    });
    return Array.isArray(r) ? r : [];
  }

  /** Uebernimmt einen Treffer der Online-Suche fuer den Eintrag (Metadaten und Bilder werden ersetzt). */
  async applyRemoteMatch(itemId, result) {
    const r = result && typeof result === 'object' ? result : {};
    return this.request('POST', `/Items/RemoteSearch/Apply/${checkId(itemId)}`, {
      query: { replaceAllImages: true },
      body: { Name: String(r.Name ?? '').slice(0, 300), ProductionYear: r.ProductionYear ?? null, ProviderIds: r.ProviderIds && typeof r.ProviderIds === 'object' ? r.ProviderIds : {}, SearchProviderName: String(r.SearchProviderName ?? '').slice(0, 80), ImageUrl: r.ImageUrl ?? null },
      timeout: 40000
    });
  }

  restartServer() {
    return this.request('POST', '/System/Restart');
  }

  shutdownServer() {
    return this.request('POST', '/System/Shutdown');
  }

  /** Wie der Server diese Verbindung einstuft (GET /System/Endpoint, jedes Konto darf fragen): { inNetwork: true | false | null }, null ohne Antwort. */
  async getEndpoint() {
    let r;
    try {
      r = await this.request('GET', '/System/Endpoint', { timeout: 4000 });
    } catch {
      return null;
    }
    return { inNetwork: typeof r?.IsInNetwork === 'boolean' ? r.IsInNetwork : null };
  }

  /**
   * Antwortet unter der Heimadresse, die der Server nennt (/System/Info/Public: LocalAddress), derselbe Server (gleiche Id)? Kurze Fristen: von
   * unterwegs geht die Heimadresse meist ins Leere. Die Frage dort geht ohne Token (sie braucht keins). Nennt der Server die Adresse, unter der er
   * ohnehin erreicht wird, hilft sie nicht weiter: false.
   */
  async homeAddressAnswers() {
    const info = await this.request('GET', '/System/Info/Public', { timeout: 4000 }).catch(() => null);
    const id = info?.Id;
    const raw = String(info?.LocalAddress ?? '').trim().replace(/\/+$/, '');
    if (!id || !raw) return false;
    let home;
    let base;
    try {
      home = new URL(raw);
      base = new URL(this.baseUrl);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(home.protocol) || !home.hostname) return false;
    if (home.hostname.toLowerCase() === base.hostname.toLowerCase() && home.port === base.port) return false;
    try {
      const res = await fetchWithTimeout(this.fetch, `${raw}/System/Info/Public`, { headers: { Accept: 'application/json' } }, 3000);
      if (!res.ok) return false;
      const answer = await res.json();
      return answer?.Id === id;
    } catch {
      return false;
    }
  }

  /**
   * Eine Messung der Bandbreite zum Server (GET /Playback/BitrateTest?Size=<Bytes>, wie die offiziellen Apps): so viele Bytes laden und durch die Zeit
   * teilen. Mbit/s, null ohne brauchbare Antwort (Server kennt den Test nicht, Frist abgelaufen, weniger als die Haelfte angekommen).
   */
  async bitrateTest(bytes, timeoutMs = 12000) {
    const ctrl = new AbortController();
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(null);
      }, timeoutMs);
    });
    const run = (async () => {
      const start = nowMs();
      const res = await this.request('GET', '/Playback/BitrateTest', { query: { Size: bytes }, raw: true, signal: ctrl.signal });
      if (!res.ok) return null;
      // Desktop: Bytes zaehlen; die native Anfrage der Android-Huelle liefert Text, dort zaehlt die Laenge laut Kopf
      const size = typeof res.arrayBuffer === 'function' ? (await res.arrayBuffer()).byteLength : Number(res.headers.get('content-length')) || (await res.text()).length;
      const seconds = (nowMs() - start) / 1000;
      if (size < bytes / 2 || seconds <= 0.001) return null;
      return (size * 8) / seconds / 1_000_000;
    })().catch(() => null);
    try {
      return await Promise.race([run, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Heimnetz oder Internet, und welche Grenze der Server dort setzt (Plan P21, Regel wie HomeNetwork der Apple-App, Bitratensteuerung in
   * src/shared/bitrate.js). Erst die Einstufung des Servers (/System/Endpoint); bei einer oeffentlichen Adresse, die der Server nicht als entfernt
   * einstuft, die Probe der Heimadresse (probeHome: die Rueckseite merkt sich ihr Ergebnis je Netz). Nur ausserhalb des Heimnetzes werden die Grenzen
   * gelesen: die des Kontos und die des Servers (die Server-Einstellung ist nicht fuer jeden lesbar). viaLocalInterface: false = Mobilfunk (nie Heimnetz).
   * resolveHost(host) -> Promise<string[]>: DNS des Geraets (Windows, Android); loest ein Name, der nicht schon dem Namen nach lokal ist (".int",
   * eigene Domain mit Split-DNS), auf eine private Adresse auf, zaehlt er wie eine private Adresse (Bitrate.hostResolvesLocal). Ohne: nur der Name.
   */
  async getStreamingLimits({ viaLocalInterface = null, probeHome = (run) => run(), resolveHost = null } = {}) {
    const [endpoint, resolvesLocal] = await Promise.all([this.getEndpoint(), Bitrate.hostResolvesLocal(this.baseUrl, resolveHost)]);
    const looksLocal = Bitrate.addressLooksLocal(this.baseUrl) || resolvesLocal;
    const serverView = endpoint ? endpoint.inNetwork : null;
    const probe = serverView !== false && !looksLocal && viaLocalInterface !== false;
    const homeAnswers = probe ? await Promise.resolve(probeHome(() => this.homeAddressAnswers())).catch(() => false) : false;
    const home = Bitrate.isHome({ serverInNetwork: serverView, addressLooksLocal: looksLocal, viaLocalInterface, homeAddressAnswers: homeAnswers });
    // Gemerkt wird nur, was feststeht: hat der Server bei einer privaten Adresse nicht geantwortet, fragt die naechste Planung neu
    const settled = endpoint !== null || !looksLocal;
    if (home) return Bitrate.summarizeLimits({ home, serverView, settled });
    const [me, config] = await Promise.all([
      this.request('GET', '/Users/Me', { timeout: 6000 }).catch(() => null),
      this.request('GET', '/System/Configuration', { timeout: 6000 }).catch(() => null)
    ]);
    return Bitrate.summarizeLimits({ home, serverView, settled, me, config });
  }

  async getMediaSegments(id) {
    try {
      const q = new URLSearchParams();
      for (const t of ['Intro', 'Outro', 'Recap', 'Preview']) q.append('includeSegmentTypes', t);
      const r = await this.request('GET', `/MediaSegments/${id}`, { query: q });
      return r?.Items ?? [];
    } catch {
      return [];
    }
  }

  // ---------- Wiedergabe ----------
  /** forceTranscode: Direct Play und Direct Stream ausschliessen (Rueckfall, wenn die Datei so nicht abspielbar war). */
  getPlaybackInfo(id, { deviceProfile, startTicks = 0, maxBitrate, mediaSourceId, audioIndex, subtitleIndex, enableTranscoding = true, forceTranscode = false } = {}) {
    return this.request('POST', `/Items/${id}/PlaybackInfo`, {
      body: {
        UserId: this.userId,
        StartTimeTicks: startTicks,
        MaxStreamingBitrate: maxBitrate,
        MediaSourceId: mediaSourceId,
        AudioStreamIndex: audioIndex,
        SubtitleStreamIndex: subtitleIndex,
        AutoOpenLiveStream: true,
        EnableDirectPlay: !forceTranscode,
        EnableDirectStream: !forceTranscode,
        EnableTranscoding: enableTranscoding || forceTranscode,
        AllowVideoStreamCopy: true,
        AllowAudioStreamCopy: true,
        DeviceProfile: deviceProfile
      }
    });
  }

  // Meldungen laufen im Hintergrund und duerfen die Bedienung nie aufhalten: kurze Zeitgrenze, Fehler werden verschluckt.
  reportStart(p) {
    return this.request('POST', '/Sessions/Playing', { body: p, timeout: 8000 }).catch(() => null);
  }

  reportProgress(p) {
    return this.request('POST', '/Sessions/Playing/Progress', { body: p, timeout: 8000 }).catch(() => null);
  }

  reportStopped(p) {
    return this.request('POST', '/Sessions/Playing/Stopped', { body: p, timeout: 8000 }).catch(() => null);
  }

  /** Beendet einen serverseitigen Transcode (HLS), falls einer lief. */
  stopEncoding(playSessionId) {
    return this.request('DELETE', '/Videos/ActiveEncodings', { query: { deviceId: this.deviceId, playSessionId }, timeout: 8000 }).catch(() => null);
  }
}

/**
 * Methoden des JellyfinClient, die die Oberflaeche aufrufen darf (window.jc.api): nur diese, alles andere lehnt die Rueckseite ab.
 * Die Verwaltung ist fuer Administratoren gedacht (die Oberflaeche zeigt sie nur ihnen, der Server prueft es ohnehin und antwortet sonst mit 403).
 */
const CALLABLE_METHODS = [
  'getViews', 'getItems', 'getItem', 'getResume', 'getNextUp', 'getLatest', 'getSeasons', 'getEpisodes', 'getSimilar', 'getGenres', 'search', 'setPlayed', 'setFavorite', 'refreshItem', 'getMe',
  'getPerson', 'getPersonItems', 'personByTmdb', 'refreshPerson',
  'getSystemInfo', 'refreshLibrary', 'getScheduledTasks', 'startTask', 'stopTask', 'getSessions', 'getActivity', 'getUsers', 'createUser', 'setUserDisabled', 'resetUserPassword', 'setUserPassword', 'deleteUser',
  'getItemForEdit', 'updateItem', 'deleteItem', 'searchRemote', 'applyRemoteMatch', 'restartServer', 'shutdownServer'
];

const ticksToSeconds = (t) => (t || 0) / TICKS_PER_SECOND;
const secondsToTicks = (s) => Math.round((s || 0) * TICKS_PER_SECOND);

return {
  JellyfinClient,
  JellyfinError,
  TICKS_PER_SECOND,
  normalizeServerUrl,
  candidateUrls,
  probeServer,
  ticksToSeconds,
  secondsToTicks,
  withoutAccessToken,
  checkId,
  checkText,
  checkList,
  LIST_FIELDS,
  DETAIL_FIELDS,
  CALLABLE_METHODS
};
});
