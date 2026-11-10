/* Gemeinsames Modul: laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCSeerr) in der Oberflaeche der Web-/Handy-Fassung (src/web).
   Keine eigenen Abhaengigkeiten ausser dem eingespeisten fetch. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCSeerr = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
/**
 * Anbindung an Seerr (Jellyseerr / Overseerr): Titel suchen, die noch nicht in der Bibliothek sind, und anfragen.
 * Alles laeuft im Hauptprozess, Zugangsdaten verlassen ihn nie (wie beim Jellyfin-Token).
 * API: /api/v1, Anmeldung per Jellyfin-Konto (Session-Cookie connect.sid) oder API-Schluessel (Header X-Api-Key).
 */

/** mediaInfo.status bei Seerr */
const MEDIA_STATUS = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIALLY_AVAILABLE: 4, AVAILABLE: 5, DELETED: 6 };
/** Art eines gemeldeten Problems (Seerr: IssueType) */
const ISSUE_TYPES = { VIDEO: 1, AUDIO: 2, SUBTITLES: 3, OTHER: 4 };

class SeerrError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'SeerrError';
    this.status = status;
    this.body = body;
  }
}

/** Entfernt Pfadreste wie /api/v1 und schliessende Schraegstriche. */
function normalizeSeerrUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new SeerrError('Seerr-Adresse fehlt');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new SeerrError('Ungueltige Seerr-Adresse');
  }
  return `${u.origin}${u.pathname.replace(/\/api(\/v1)?\/?$/i, '').replace(/\/+$/, '')}`;
}

/** Ohne Schema probieren wir https, dann http, dann http mit dem Standardport 5055. */
function candidateSeerrUrls(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new SeerrError('Seerr-Adresse fehlt');
  if (/^https?:\/\//i.test(s)) return [normalizeSeerrUrl(s)];
  const out = [normalizeSeerrUrl(`https://${s}`), normalizeSeerrUrl(`http://${s}`)];
  try {
    if (!new URL(out[1]).port) out.push(normalizeSeerrUrl(`http://${s.replace(/\/.*$/, '')}:5055`));
  } catch {
    /* ignorieren */
  }
  return out;
}

/**
 * credentials "omit": Der Cookie-Speicher von Chromium (Electron net.fetch) bleibt aussen vor. Sonst legte er das Seerr-Cookie selbst ab und
 * haengte es spaeter an jede Anfrage: ein falscher API-Schluessel wuerde durch das alte Cookie akzeptiert, und "Trennen" liesse es liegen.
 * Die Anmeldung wird ausschliesslich ueber unsere eigenen Header (Cookie bzw. X-Api-Key) mitgegeben.
 */
async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { credentials: 'omit', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Findet einen erreichbaren Seerr-Server (GET /api/v1/status ist oeffentlich). */
async function probeSeerr(input, fetchImpl = globalThis.fetch) {
  let lastErr = null;
  for (const url of candidateSeerrUrls(input)) {
    try {
      const res = await fetchWithTimeout(fetchImpl, `${url}/api/v1/status`, { headers: { Accept: 'application/json' } }, 6000);
      if (!res.ok) throw new SeerrError(`Server antwortet mit ${res.status}`, { status: res.status });
      const info = await res.json();
      if (!info || typeof info.version !== 'string') throw new SeerrError('Das ist kein Seerr-Server');
      return { url, version: info.version };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new SeerrError(lastErr?.name === 'AbortError' ? 'Zeitueberschreitung beim Verbinden' : `Seerr nicht erreichbar${lastErr ? `: ${lastErr.message}` : ''}`);
}

/** Nimmt den Wert des Session-Cookies connect.sid aus der Antwort. */
function sessionCookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of list) {
    const m = /(?:^|[\s,])connect\.sid=([^;,\s]+)/.exec(String(line));
    if (m) return m[1];
  }
  return null;
}

/** Anmeldung mit dem Jellyfin-Konto. @returns {{cookie:string, user:object}} */
async function loginWithJellyfin(baseUrl, username, password, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/v1/auth/jellyfin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password })
    });
  } catch (e) {
    throw new SeerrError(e?.name === 'AbortError' ? 'Zeitueberschreitung bei der Anmeldung' : `Netzwerkfehler: ${e?.message ?? e}`);
  }
  if (!res.ok) throw new SeerrError(res.status === 401 || res.status === 403 ? 'Anmeldung bei Seerr abgelehnt (Benutzername oder Passwort?)' : `HTTP ${res.status}`, { status: res.status });
  const cookie = sessionCookieFrom(res);
  if (!cookie) throw new SeerrError('Seerr hat keine Sitzung geliefert');
  return { cookie, user: await res.json().catch(() => ({})) };
}

const yearOf = (d) => (typeof d === 'string' && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

/** Reduziert ein Suchergebnis auf das, was die Oberflaeche braucht. Personen und Unbekanntes ergeben null. */
function normalizeResult(r) {
  if (!r || (r.mediaType !== 'movie' && r.mediaType !== 'tv')) return null;
  const movie = r.mediaType === 'movie';
  const title = movie ? r.title ?? r.originalTitle : r.name ?? r.originalName;
  if (!title || !Number.isFinite(+r.id)) return null;
  return {
    mediaType: r.mediaType,
    id: Number(r.id),
    title: String(title),
    year: yearOf(movie ? r.releaseDate : r.firstAirDate),
    overview: typeof r.overview === 'string' ? r.overview : '',
    posterPath: typeof r.posterPath === 'string' ? r.posterPath : null,
    status: Number(r.mediaInfo?.status) || 0
  };
}

const TMDB_PATH = /^\/[A-Za-z0-9_-]{8,64}\.(?:jpg|jpeg|png|webp)$/;
const text = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const number = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(+v) ? +v : null);
/** Bewertung (TMDB voteAverage) auf eine Nachkommastelle; keine oder 0 ergibt null. */
const ratingOf = (v) => {
  const n = number(v);
  return n && n > 0 ? Math.round(n * 10) / 10 : null;
};
/** YouTube-Schluessel des ersten Trailers (sonst Teasers) aus den "relatedVideos" von Seerr; nur echte 11-Zeichen-Schluessel, sonst null. */
function trailerKeyOf(list) {
  const vids = (Array.isArray(list) ? list : []).filter((v) => v && v.site === 'YouTube' && /^[A-Za-z0-9_-]{11}$/.test(v.key ?? ''));
  return (vids.find((v) => v.type === 'Trailer') ?? vids.find((v) => v.type === 'Teaser'))?.key ?? null;
}

/**
 * Reduziert die Detailantwort von Seerr (GET /movie/{id}, /tv/{id}) auf das, was die Detailansicht braucht. Alles bekommt einen festen Typ und eine Obergrenze,
 * Unbekanntes faellt weg; Bildpfade gelten nur in der Form, die das App-Protokoll fuer TMDB annimmt.
 */
function normalizeDetails(mediaType, d) {
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !d || typeof d !== 'object' || !Number.isFinite(+d.id)) return null;
  const movie = mediaType === 'movie';
  const title = text(movie ? d.title ?? d.originalTitle : d.name ?? d.originalName, 300);
  if (!title) return null;
  const original = text(movie ? d.originalTitle : d.originalName, 300);
  const date = text(movie ? d.releaseDate : d.firstAirDate, 10);
  const names = (list, max) => (Array.isArray(list) ? list.map((x) => text(x?.name, 120)).filter(Boolean).slice(0, max) : []);
  const crew = Array.isArray(d.credits?.crew) ? d.credits.crew : [];
  const rating = number(d.voteAverage);
  return {
    mediaType,
    id: Number(d.id),
    title,
    originalTitle: original && original !== title ? original : '',
    tagline: text(d.tagline, 300),
    overview: text(d.overview),
    year: yearOf(date),
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    runtime: movie ? number(d.runtime) || null : number(Array.isArray(d.episodeRunTime) ? d.episodeRunTime[0] : null) || null,
    rating: rating && rating > 0 ? Math.round(rating * 10) / 10 : null,
    genres: names(d.genres, 6),
    posterPath: TMDB_PATH.test(d.posterPath ?? '') ? d.posterPath : null,
    backdropPath: TMDB_PATH.test(d.backdropPath ?? '') ? d.backdropPath : null,
    status: Number(d.mediaInfo?.status) || 0,
    // Regie bei Filmen, "Erstellt von" bei Serien
    directors: movie ? names(crew.filter((c) => c?.job === 'Director'), 3) : names(d.createdBy, 3),
    cast: (Array.isArray(d.credits?.cast) ? d.credits.cast : [])
      .map((c) => ({ name: text(c?.name, 120), character: text(c?.character, 120), profilePath: TMDB_PATH.test(c?.profilePath ?? '') ? c.profilePath : null }))
      .filter((c) => c.name)
      .slice(0, 12),
    seasons: movie ? null : number(d.numberOfSeasons),
    episodes: movie ? null : number(d.numberOfEpisodes),
    seriesStatus: movie ? '' : text(d.status, 60),
    trailerKey: trailerKeyOf(d.relatedVideos) // fuer den Trailer im Banner der Startseite
  };
}

const TMDB_SIZES = new Set(['w154', 'w185', 'w342', 'w500', 'w780', 'w1280']); // w1280: Hintergrundbilder im Banner der Startseite
const TMDB_FILE = /^[A-Za-z0-9_-]{8,64}\.(?:jpg|jpeg|png|webp)$/;

/** URL eines TMDB-Posters, nur fuer bekannte Groessen und harmlose Dateinamen (sonst null). */
function tmdbImageUrl(size, file) {
  return TMDB_SIZES.has(size) && TMDB_FILE.test(String(file ?? '')) ? `https://image.tmdb.org/t/p/${size}/${file}` : null;
}

class SeerrClient {
  /** @param {{baseUrl:string, apiKey?:string|null, cookie?:string|null, fetch?:typeof fetch}} o */
  constructor({ baseUrl, apiKey = null, cookie = null, fetch = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.cookie = cookie;
    this.fetch = fetch;
  }

  headers(extra = {}) {
    const h = { Accept: 'application/json', ...extra };
    if (this.apiKey) h['X-Api-Key'] = this.apiKey;
    else if (this.cookie) h.Cookie = `connect.sid=${this.cookie}`;
    return h;
  }

  async request(method, path, { query, body, timeout = 20000 } = {}) {
    const q = query ? `?${Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    const init = { method, headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    if (body !== undefined) init.body = JSON.stringify(body);
    let res;
    try {
      res = await fetchWithTimeout(this.fetch, `${this.baseUrl}/api/v1${path}${q}`, init, timeout);
    } catch (e) {
      throw new SeerrError(e?.name === 'AbortError' ? 'Zeitueberschreitung bei der Anfrage an Seerr' : `Netzwerkfehler: ${e?.message ?? e}`);
    }
    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        /* ignorieren */
      }
      let message = '';
      try {
        message = JSON.parse(text).message ?? '';
      } catch {
        /* kein JSON */
      }
      const fallback = { 401: 'Seerr-Anmeldung abgelaufen', 403: 'Keine Berechtigung oder Kontingent erreicht', 404: 'Nicht gefunden', 409: 'Bereits angefragt' }[res.status] ?? `HTTP ${res.status}`;
      throw new SeerrError(res.status === 401 || res.status === 403 || res.status === 409 ? fallback : message || fallback, { status: res.status, body: text });
    }
    return res.status === 204 ? null : res.json();
  }

  /** Angemeldeter Benutzer (prueft zugleich, ob Cookie bzw. Schluessel gueltig sind). */
  me() {
    return this.request('GET', '/auth/me');
  }

  /** @returns {Promise<ReturnType<typeof normalizeResult>[]>} nur Filme und Serien */
  async search(query, page = 1) {
    const r = await this.request('GET', '/search', { query: { query, page } });
    return (r?.results ?? []).map(normalizeResult).filter(Boolean);
  }

  /**
   * Filme, die gerade im Trend liegen (GET /discover/trending, Seerr mischt dort Filme, Serien und Personen). Serien, Personen, doppelte Eintraege und gesperrte Titel
   * (Stand ueber 6) fallen weg; es werden hoechstens drei Seiten gelesen, bis `limit` Filme da sind. Scheitert eine spaetere Seite, bleibt es bei dem, was schon da ist.
   * Zusaetzlich zum normalisierten Ergebnis: `rating` (TMDB-Bewertung, eine Nachkommastelle, sonst null) und `backdropPath` (Hintergrundbild, sonst null).
   * @returns {Promise<(ReturnType<typeof normalizeResult> & { rating: number|null, backdropPath: string|null })[]>}
   */
  async trending({ limit = 20 } = {}) {
    const seen = new Set();
    const out = [];
    for (let page = 1; page <= 3 && out.length < limit; page++) {
      let r;
      try {
        r = await this.request('GET', '/discover/trending', { query: { page } });
      } catch (e) {
        if (page === 1) throw e;
        break;
      }
      for (const raw of r?.results ?? []) {
        const n = normalizeResult(raw);
        if (n?.mediaType !== 'movie' || n.status > MEDIA_STATUS.DELETED || seen.has(n.id)) continue;
        seen.add(n.id);
        // Bewertung und Hintergrundbild kommen fuers Banner der Startseite mit (gut bewertete Trend-Titel); die Karten brauchen sie nicht
        out.push({ ...n, rating: ratingOf(raw.voteAverage), backdropPath: TMDB_PATH.test(raw.backdropPath ?? '') ? raw.backdropPath : null });
      }
      if (page >= (Number(r?.totalPages) || 1)) break;
    }
    return out.slice(0, limit);
  }

  /**
   * Meldet ein Problem zu einem Titel (Seerr: "Issues"). Seerr will seine eigene Medien-Nummer, nicht die TMDB-Nummer: sie steht in den Details des Titels (mediaInfo.id)
   * und gibt es nur, wenn Seerr den Titel kennt (angefragt oder aus der Bibliothek synchronisiert). Der Kommentar ist freiwillig; Seerr verlangt aber einen Text,
   * deshalb ersetzt ein leerer Kommentar durch `fallbackMessage` (die Oberflaeche liefert ihn in ihrer Sprache).
   * Bei Serien gelten Staffel und Folge (0 = alle).
   * @param {{mediaType:'movie'|'tv', tmdbId:number, issueType:number, message?:string, fallbackMessage?:string, season?:number, episode?:number}} o
   * @returns {Promise<{ id: number|null }>}
   */
  async reportIssue({ mediaType, tmdbId, issueType, message = '', fallbackMessage = '', season = 0, episode = 0 } = {}) {
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new SeerrError('Unbekannter Medientyp');
    if (!Number.isInteger(+tmdbId) || +tmdbId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    if (!Object.values(ISSUE_TYPES).includes(Number(issueType))) throw new SeerrError('Unbekannte Art des Problems');
    const info = await this.request('GET', `/${mediaType}/${Number(tmdbId)}`);
    const mediaId = Number(info?.mediaInfo?.id);
    if (!Number.isInteger(mediaId) || mediaId <= 0) {
      throw new SeerrError('Seerr kennt diesen Titel noch nicht. Synchronisiere die Bibliothek in Seerr (Einstellungen > Jellyfin > Bibliotheken) und versuche es erneut.', { status: 404 });
    }
    const nonNegative = (v) => (Number.isInteger(+v) && +v >= 0 ? +v : 0);
    const body = {
      issueType: Number(issueType),
      message: text(message, 2000).trim() || text(fallbackMessage, 2000).trim() || '-',
      mediaId,
      ...(mediaType === 'tv' ? { problemSeason: nonNegative(season), problemEpisode: nonNegative(episode) } : {})
    };
    let r;
    try {
      r = await this.request('POST', '/issue', { body });
    } catch (e) {
      // 403: das Konto darf keine Probleme melden (Berechtigung "Probleme melden" fehlt); 401 bleibt der Abmeldefall (SEERR_AUTH)
      if (e.status === 403) throw new SeerrError('Dein Seerr-Konto darf keine Probleme melden.', { status: 403, body: e.body });
      throw e;
    }
    return { id: Number.isFinite(+r?.id) ? +r.id : null };
  }

  /** Einzelheiten zu einem Titel (Beschreibung, Besetzung, Bewertung ...), siehe normalizeDetails. */
  async details(mediaType, mediaId) {
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new SeerrError('Unbekannter Medientyp');
    if (!Number.isFinite(+mediaId) || +mediaId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    const r = await this.request('GET', `/${mediaType}/${Number(mediaId)}`);
    const d = normalizeDetails(mediaType, r);
    if (!d) throw new SeerrError('Unerwartete Antwort von Seerr');
    return d;
  }

  /**
   * Stellt eine Anfrage. Serien werden komplett angefragt (alle Staffeln).
   * @returns {Promise<{id:number|null, requestStatus:number|null, mediaStatus:number|null}>}
   *   requestStatus: 1 wartet auf Freigabe, 2 freigegeben, 3 abgelehnt. mediaStatus: siehe MEDIA_STATUS.
   */
  async requestMedia({ mediaType, mediaId }) {
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new SeerrError('Unbekannter Medientyp');
    if (!Number.isFinite(+mediaId) || +mediaId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    const body = { mediaType, mediaId: Number(mediaId), ...(mediaType === 'tv' ? { seasons: 'all' } : {}) };
    const r = await this.request('POST', '/request', { body });
    return { id: r?.id ?? null, requestStatus: Number(r?.status) || null, mediaStatus: Number(r?.media?.status) || null };
  }
}

return { MEDIA_STATUS, ISSUE_TYPES, SeerrError, SeerrClient, normalizeSeerrUrl, candidateSeerrUrls, probeSeerr, loginWithJellyfin, sessionCookieFrom, normalizeResult, normalizeDetails, tmdbImageUrl };
});
