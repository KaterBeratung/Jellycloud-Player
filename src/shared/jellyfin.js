/* Gemeinsames Modul: laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCJellyfin) in der Oberflaeche der Web-/Handy-Fassung (src/web).
   Keine eigenen Abhaengigkeiten ausser dem eingespeisten fetch; `node:os` nur, wenn es Node gibt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require : null);
  else root.JCJellyfin = factory(null);
})(typeof self !== 'undefined' ? self : this, function (nodeRequire) {
  'use strict';

  const os = nodeRequire ? nodeRequire('node:os') : null;
const TICKS_PER_SECOND = 10_000_000;

class JellyfinError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'JellyfinError';
    this.status = status;
    this.body = body;
  }
}

/** Entfernt Pfad-Reste wie /web/index.html und schliessende Schraegstriche. */
function normalizeServerUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new JellyfinError('Server-Adresse fehlt');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new JellyfinError('Ungueltige Server-Adresse');
  }
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

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: init.signal ?? ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Findet einen erreichbaren Jellyfin-Server und liefert die oeffentlichen Infos. */
async function probeServer(input, fetchImpl = globalThis.fetch) {
  let lastErr = null;
  for (const url of candidateUrls(input)) {
    try {
      const res = await fetchWithTimeout(fetchImpl, `${url}/System/Info/Public`, { headers: { Accept: 'application/json' } }, 6000);
      if (!res.ok) throw new JellyfinError(`Server antwortet mit ${res.status}`, { status: res.status });
      const info = await res.json();
      if (!info || !info.Id) throw new JellyfinError('Das ist kein Jellyfin-Server');
      return { url, info };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new JellyfinError(
    lastErr && lastErr.name === 'AbortError' ? 'Zeitueberschreitung beim Verbinden' : `Server nicht erreichbar${lastErr ? `: ${lastErr.message}` : ''}`
  );
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
    this.clientName = opts.clientName ?? 'Jellycloud Player';
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
      if (e && e.name === 'AbortError') throw new JellyfinError('Zeitueberschreitung bei der Anfrage');
      throw new JellyfinError(`Netzwerkfehler: ${e && e.message ? e.message : e}`);
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

  async quickConnectEnabled() {
    try {
      const r = await this.request('GET', '/QuickConnect/Enabled');
      return r === true;
    } catch {
      return false;
    }
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

  postCapabilities() {
    return this.request('POST', '/Sessions/Capabilities/Full', {
      body: { PlayableMediaTypes: ['Audio', 'Video'], SupportedCommands: [], SupportsMediaControl: false, SupportsPersistentIdentifier: true }
    }).catch(() => null);
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

  async search(term, limit = 40) {
    const r = await this.getItems({ searchTerm: term, includeItemTypes: 'Movie,Series,Episode,BoxSet', recursive: true, limit });
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

  /**
   * Fragt ab, ob der Server die Bitrate dieser Verbindung begrenzt. Erst die Verbindungsart (/System/Endpoint): im lokalen Netz gibt es
   * keine Grenze, dann bleibt es bei dieser einen kleinen Anfrage. Nur ueber das Internet (oder wenn die Art unbekannt ist) werden die
   * Grenzen gelesen: Benutzer-Richtlinie und serverweit. Die Server-Einstellung ist nicht fuer jeden lesbar; fehlt sie, gilt, was sich lesen laesst.
   */
  async getStreamingLimits() {
    const endpoint = await this.request('GET', '/System/Endpoint', { timeout: 8000 }).catch(() => null);
    if (endpoint && (endpoint.IsInNetwork === true || endpoint.IsLocal === true)) return describeStreamingLimits({ endpoint });
    const [me, config] = await Promise.all([this.getMe().catch(() => null), this.request('GET', '/System/Configuration', { timeout: 8000 }).catch(() => null)]);
    return describeStreamingLimits({ endpoint, me, config });
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

const positiveBps = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : 0);

/**
 * Fasst zusammen, welche Bitratengrenze der Server fuer diese Verbindung anwendet. Reine Funktion (testbar).
 * Die Grenzen des Servers gelten nur fuer Clients, die er nicht als lokal erkennt (Internet): Benutzer-Richtlinie
 * (UserPolicy.RemoteClientBitrateLimit) und serverweit (ServerConfiguration.RemoteClientBitrateLimit), Bit pro Sekunde, 0 = keine. Es gilt die kleinere.
 * @param {{endpoint?:{IsLocal?:boolean, IsInNetwork?:boolean}|null, me?:any, config?:any}} o
 * @returns {{remote:boolean|null, user:number, server:number, limitBps:number, serverKnown:boolean}}
 *   remote: true = Internet, false = lokales Netz, null = unbekannt
 */
function describeStreamingLimits({ endpoint = null, me = null, config = null } = {}) {
  const local = !!endpoint && (endpoint.IsInNetwork === true || endpoint.IsLocal === true);
  const user = positiveBps(me?.Policy?.RemoteClientBitrateLimit);
  const server = positiveBps(config?.RemoteClientBitrateLimit);
  const active = [user, server].filter(Boolean);
  return { remote: endpoint ? !local : null, user, server, limitBps: active.length ? Math.min(...active) : 0, serverKnown: config != null };
}

/**
 * Methoden des JellyfinClient, die die Oberflaeche aufrufen darf (window.jc.api): nur diese, alles andere lehnt die Rueckseite ab.
 * Die Verwaltung ist fuer Administratoren gedacht (die Oberflaeche zeigt sie nur ihnen, der Server prueft es ohnehin und antwortet sonst mit 403).
 */
const CALLABLE_METHODS = [
  'getViews', 'getItems', 'getItem', 'getResume', 'getNextUp', 'getLatest', 'getSeasons', 'getEpisodes', 'getSimilar', 'getGenres', 'search', 'setPlayed', 'setFavorite', 'refreshItem', 'getMe',
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
  describeStreamingLimits,
  checkId,
  checkText,
  checkList,
  LIST_FIELDS,
  DETAIL_FIELDS,
  CALLABLE_METHODS
};
});
