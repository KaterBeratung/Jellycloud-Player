/* Gemeinsames Modul: laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCSeerr) in der Oberflaeche der Web-/Handy-Fassung (src/web).
   Keine eigenen Abhaengigkeiten ausser dem eingespeisten fetch. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seerr-state'));
  else root.JCSeerr = factory(root.JCSeerrState);
})(typeof self !== 'undefined' ? self : this, function (SeerrState) {
  'use strict';
/**
 * Anbindung an Seerr (Jellyseerr / Overseerr): Titel suchen, die noch nicht in der Bibliothek sind, und anfragen.
 * Alles laeuft im Hauptprozess, Zugangsdaten verlassen ihn nie (wie beim Jellyfin-Token).
 * API: /api/v1, Anmeldung nur per Jellyfin-Konto (Session-Cookie connect.sid; einen API-Schluessel nimmt die App seit Version 10 nicht mehr, Entscheidung E12).
 */

/** mediaInfo.status bei Seerr (6 gesperrt, 7 geloescht; die Regeln dazu in seerr-state.js) */
const MEDIA_STATUS = SeerrState.SEERR_MEDIA;
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
    throw new SeerrError('Ungültige Seerr-Adresse');
  }
  if (!u.hostname) throw new SeerrError('Ungültige Seerr-Adresse');
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
 * haengte es spaeter an jede Anfrage: eine falsche Anmeldung wuerde durch das alte Cookie akzeptiert, "Trennen" liesse es liegen, und ein Profil saehe das Seerr eines anderen.
 * Die Anmeldung wird ausschliesslich ueber unseren eigenen Header (Cookie) mitgegeben.
 * cache "no-store": keine Antwort aus dem Zwischenspeicher; die Sitzung steht in einer Kopfzeile, die nicht zu dessen Schluessel gehoert, ein Profil bekaeme
 * sonst womoeglich die Antwort eines anderen (wie die Apple-App: eine Sitzung fuer alle Profile, ohne Zwischenspeicher, Frist 20 s).
 */
async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Ein Abbruch von aussen (Frist der Verbindungspruefung) bricht diese Anfrage mit ab
  const outer = init.signal;
  const onOuter = () => ctrl.abort();
  if (outer) outer.aborted ? ctrl.abort() : outer.addEventListener('abort', onOuter, { once: true });
  try {
    return await fetchImpl(url, { credentials: 'omit', cache: 'no-store', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
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

const intOf = (v) => (Number.isInteger(+v) && v !== null && v !== '' ? +v : null);
const nonEmpty = (v, max = 300) => text(v, max) || null;

/**
 * Mitwirkende hinter der Kamera (wie SeerrCredit.keyCrew der Apple-App): vorn Regie (Serie: die Schoepfer, "creator") und Drehbuch, danach Produktion
 * und Musik; je Person ein Eintrag mit allen ihren Aufgaben (roles: Schluessel, die die Oberflaeche uebersetzt). Die uebrigen Gewerke bleiben weg.
 */
function keyCrew(d, movie) {
  const raw = Array.isArray(d.credits?.crew) ? d.credits.crew : [];
  const entry = (c, role) => {
    const name = text(c?.name, 120);
    if (!name) return null;
    const pic = c?.profilePath ?? c?.profile_path;
    return { id: intOf(c?.id), name, roles: [role], profilePath: TMDB_PATH.test(pic ?? '') ? pic : null };
  };
  const identity = (c) => (c.id !== null ? `id-${c.id}` : `name-${c.name}`);
  /** Je Person ein Eintrag, die Aufgaben in der Reihenfolge ihres ersten Auftretens, hoechstens limit Personen. */
  const merged = (list, limit) => {
    const order = [];
    const byKey = new Map();
    for (const c of list.filter(Boolean)) {
      const k = identity(c);
      if (!byKey.has(k)) {
        order.push(k);
        byKey.set(k, { ...c, roles: [] });
      }
      const e = byKey.get(k);
      for (const r of c.roles) if (!e.roles.includes(r)) e.roles.push(r);
    }
    return order.slice(0, limit).map((k) => byKey.get(k));
  };
  const jobs = (wanted, role, limit) => merged(raw.filter((c) => wanted.includes(c?.job)).map((c) => entry(c, role)), limit);
  const creators = movie ? [] : (Array.isArray(d.createdBy) ? d.createdBy : []).slice(0, 3).map((c) => entry(c, 'creator'));
  const lead = merged([...creators, ...jobs(['Director'], 'director', 3), ...jobs(['Screenplay', 'Writer', 'Story', 'Teleplay'], 'writer', 3)], 5);
  const known = new Set(lead.map(identity));
  const further = [...jobs(['Producer', 'Executive Producer'], 'producer', 2), ...jobs(['Original Music Composer', 'Music'], 'music', 1)].filter((c) => !known.has(identity(c)));
  return { lead, further };
}

/**
 * Weitere Angaben eines Titels fuer den Informationsblock (wie SeerrFacts der Apple-App): roh, ohne Deutung; Fehlendes bleibt leer. Die Freigaben je Land
 * (Film: die erste Veroeffentlichung mit Angabe; Serie: die Einstufung) waehlt src/shared/seerr-facts.js fuer das Land des Geraets.
 */
function factsOf(d, movie, title) {
  const names = (list) => (Array.isArray(list) ? list.map((x) => text(x?.name, 120)).filter(Boolean).slice(0, 3) : []);
  const original = nonEmpty(movie ? d.originalTitle : d.originalName);
  const certifications = {};
  if (movie) {
    for (const e of Array.isArray(d.releases?.results) ? d.releases.results : []) {
      const region = text(e?.iso_3166_1, 4);
      const found = (Array.isArray(e?.release_dates) ? e.release_dates : []).map((r) => text(r?.certification, 20)).find(Boolean);
      if (region && found) certifications[region] = found;
    }
  } else {
    for (const e of Array.isArray(d.contentRatings?.results) ? d.contentRatings.results : []) {
      const region = text(e?.iso_3166_1, 4);
      const rating = text(e?.rating, 20);
      if (region && rating) certifications[region] = rating;
    }
  }
  const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v ?? '') ? v.slice(0, 10) : null);
  const votes = intOf(d.voteCount);
  const episodes = intOf(d.numberOfEpisodes);
  return {
    originalTitle: original && original !== title ? original : null,
    released: day(movie ? d.releaseDate : d.firstAirDate),
    lastAired: movie ? null : day(d.lastAirDate),
    nextEpisode: day(d.nextEpisodeToAir?.airDate),
    votes: votes && votes > 0 ? votes : null,
    studios: names(d.productionCompanies),
    networks: movie ? [] : names(d.networks),
    countries: (Array.isArray(d.productionCountries) ? d.productionCountries : []).map((c) => text(c?.iso_3166_1, 4)).filter(Boolean),
    originalLanguage: nonEmpty(d.originalLanguage, 10),
    productionStatus: nonEmpty(d.status, 60),
    episodes: !movie && episodes && episodes > 0 ? episodes : null,
    certifications
  };
}

/**
 * Staffeln einer Serie mit ihrem Stand (ohne Staffel 0, "Extras"): der Stand je Staffel aus mediaInfo.seasons; angefragte Staffeln stehen bei Seerr zunaechst
 * nur in den Anfragen (mediaInfo.requests[].seasons, am echten Seerr 3.5.1 gesehen) und gelten als angefragt, solange die Anfrage nicht abgelehnt ist.
 */
function seasonsOf(d) {
  const info = d.mediaInfo && typeof d.mediaInfo === 'object' ? d.mediaInfo : {};
  const known = new Map((Array.isArray(info.seasons) ? info.seasons : []).filter((s) => intOf(s?.seasonNumber) !== null).map((s) => [intOf(s.seasonNumber), { status: Number(s.status) || 0, status4k: Number(s.status4k) || 0 }]));
  const requested = new Set();
  const requested4k = new Set();
  for (const r of Array.isArray(info.requests) ? info.requests : []) {
    if (Number(r?.status) === SeerrState.SEERR_REQUEST.DECLINED) continue;
    for (const s of Array.isArray(r?.seasons) ? r.seasons : []) {
      const n = intOf(s?.seasonNumber);
      if (n !== null) (r.is4k === true ? requested4k : requested).add(n);
    }
  }
  const pending = SeerrState.SEERR_MEDIA.PENDING;
  return (Array.isArray(d.seasons) ? d.seasons : [])
    .filter((s) => intOf(s?.seasonNumber) > 0)
    .map((s) => {
      const n = intOf(s.seasonNumber);
      return {
        number: n,
        name: text(s.name, 120),
        episodes: intOf(s.episodeCount) ?? 0,
        status: Math.max(known.get(n)?.status ?? 0, requested.has(n) ? pending : 0),
        status4k: Math.max(known.get(n)?.status4k ?? 0, requested4k.has(n) ? pending : 0),
        airDate: /^\d{4}-\d{2}-\d{2}$/.test(s.airDate ?? '') ? s.airDate : null,
        posterPath: TMDB_PATH.test(s.posterPath ?? '') ? s.posterPath : null
      };
    })
    .sort((a, b) => a.number - b.number);
}

/** Stand der neuesten allgemeinen Anfrage eines Titels (Seerr zaehlt die Nummern hoch), sonst null: fuer den Stand der Seite (seerr-state.js titleState). */
function latestRequestOf(d) {
  const list = (Array.isArray(d.mediaInfo?.requests) ? d.mediaInfo.requests : []).filter((r) => r && r.is4k !== true && Number.isInteger(+r.id));
  if (!list.length) return null;
  const s = Number(list.reduce((a, b) => (+b.id > +a.id ? b : a)).status);
  return s >= 1 && s <= 5 ? s : null;
}

/**
 * Reduziert die Detailantwort von Seerr (GET /movie/{id}, /tv/{id}) auf das, was die Seite eines Titels braucht. Alles bekommt einen festen Typ und eine Obergrenze,
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
    status4k: Number(d.mediaInfo?.status4k) || 0,
    latestRequest: latestRequestOf(d),
    // Regie bei Filmen, "Erstellt von" bei Serien
    directors: movie ? names(crew.filter((c) => c?.job === 'Director'), 3) : names(d.createdBy, 3),
    crew: keyCrew(d, movie).lead,
    furtherCrew: keyCrew(d, movie).further,
    cast: (Array.isArray(d.credits?.cast) ? d.credits.cast : [])
      .map((c) => ({ id: intOf(c?.id), name: text(c?.name, 120), character: text(c?.character, 120), profilePath: TMDB_PATH.test(c?.profilePath ?? '') ? c.profilePath : null }))
      .filter((c) => c.name)
      .slice(0, 20),
    seasons: movie ? null : number(d.numberOfSeasons),
    episodes: movie ? null : number(d.numberOfEpisodes),
    seasonList: movie ? [] : seasonsOf(d),
    seriesStatus: movie ? '' : text(d.status, 60),
    facts: factsOf(d, movie, title),
    collection: movie && Number.isInteger(+d.collection?.id) && text(d.collection?.name, 200) ? { id: Number(d.collection.id), name: text(d.collection.name, 200) } : null,
    trailerKey: trailerKeyOf(d.relatedVideos) // fuer den Trailer im Hintergrund (Startseite, Seite des Titels)
  };
}

// ---------- Personen (wie SeerrPeople der Apple-App): Quelle ist allein Seerr (/person/<n>, /person/<n>/combined_credits; Form nach server/models/Person.ts
// von Seerr 3.5.1), zugeordnet wird nur ueber Nummern, nie ueber Namen ----------

/** Aufgaben im Stab, die die Oberflaeche uebersetzt (seerr.crew.<Schluessel>); die Gewerke nur, wenn Seerr keine Aufgabe nennt. */
const CREW_JOBS = {
  Director: 'director', 'Co-Director': 'director', Screenplay: 'writer', Writer: 'writer', Story: 'writer', Teleplay: 'writer', Novel: 'source', Characters: 'source',
  Producer: 'producer', 'Executive Producer': 'producer', 'Co-Producer': 'producer', 'Original Music Composer': 'music', Music: 'music', 'Director of Photography': 'camera',
  Editor: 'editing', Creator: 'creator'
};
const CREW_DEPARTMENTS = {
  Directing: 'director', Writing: 'writer', Production: 'producer', Sound: 'sound', Camera: 'camera', Editing: 'editing', Art: 'art', 'Costume & Make-Up': 'costume',
  'Visual Effects': 'effects', Lighting: 'lighting', Acting: 'acting', Crew: 'crew'
};

/**
 * Aufgabe im Stab: { key } fuer die gaengigen Aufgaben (sonst das Gewerk, wenn Seerr keine Aufgabe nennt), sonst { text } unveraendert, wie Seerr es nennt (nichts
 * Erfundenes); ohne beides null.
 */
function crewRole(job, department) {
  const j = text(job, 120).trim();
  const d = text(department, 120).trim();
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (own(CREW_JOBS, j)) return { key: CREW_JOBS[j] };
  if (!j && own(CREW_DEPARTMENTS, d)) return { key: CREW_DEPARTMENTS[d] };
  const raw = j || d;
  return raw ? { text: raw } : null;
}

/** Eine Person, wie Seerr sie nennt (GET /person/<n>); Fehlendes bleibt leer (nichts wird ergaenzt). Ohne Namen null. */
function normalizePerson(id, d) {
  const name = text(d?.name, 200).trim();
  if (!name || !Number.isInteger(+id) || +id <= 0) return null;
  const pic = d.profilePath;
  return {
    id: Number(id),
    name,
    biography: text(d.biography, 12000).trim(),
    birthday: nonEmpty(d.birthday, 10),
    deathday: nonEmpty(d.deathday, 10),
    placeOfBirth: nonEmpty(d.placeOfBirth, 200),
    profilePath: TMDB_PATH.test(pic ?? '') ? pic : null,
    department: nonEmpty(d.knownForDepartment, 60)
  };
}

/**
 * Filmografie einer Person (GET /person/<n>/combined_credits): vor der Kamera Filme und Serien, dahinter die Mitwirkung. Je Titel ein Eintrag (ein Titel kommt je
 * Rolle oder Aufgabe einmal: die Rollen zusammengefasst), das Bekannteste zuerst (Zahl der Stimmen), bei gleicher Zahl die Reihenfolge von Seerr. Eintraege ohne Art
 * (Film, Serie) oder Titel fallen weg. Jeder Eintrag ist ein Titel wie ein Suchergebnis (mit seinem Stand) und traegt roles: [{ text }] (Figur) bzw. [{ key }|{ text }]
 * (Aufgabe, crewRole). Das ist, was Seerr (TMDB) kennt, ohne Gewaehr auf Vollstaendigkeit.
 */
function buildFilmography(raw) {
  const merged = (list, roleOf) => {
    const order = [];
    const byKey = new Map();
    for (const r of Array.isArray(list) ? list : []) {
      const n = normalizeResult(r && typeof r === 'object' ? r : null);
      if (!n) continue;
      const k = `${n.mediaType}-${n.id}`;
      const role = roleOf(r);
      if (!byKey.has(k)) {
        order.push(k);
        byKey.set(k, { ...n, roles: [], votes: intOf(r.voteCount) ?? 0 });
      }
      const e = byKey.get(k);
      if (role && !e.roles.some((x) => (role.key ? x.key === role.key : x.text === role.text))) e.roles.push(role);
    }
    return order
      .map((k, index) => ({ e: byKey.get(k), index }))
      .sort((a, b) => b.e.votes - a.e.votes || a.index - b.index)
      .map(({ e }) => {
        const { votes, ...credit } = e;
        return credit;
      });
  };
  const acting = merged(raw?.cast, (r) => {
    const c = text(r.character, 200).trim();
    return c ? { text: c } : null;
  });
  return {
    movies: acting.filter((c) => c.mediaType === 'movie'),
    series: acting.filter((c) => c.mediaType === 'tv'),
    crew: merged(raw?.crew, (r) => crewRole(r.job, r.department))
  };
}

/** Titel einer Liste (empfohlene, aehnliche, Filmreihe): ohne Personen, jeder einmal; nennt ein Eintrag seine Art nicht, gilt type. */
function titleList(raw, type) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map((r) => normalizeResult(r && typeof r === 'object' ? { ...r, mediaType: r.mediaType ?? type } : null))
    .filter((r) => r && !seen.has(`${r.mediaType}-${r.id}`) && seen.add(`${r.mediaType}-${r.id}`));
}

/** Kontingent eines Benutzers je Art (GET /user/<id>/quota); ohne Grenze limit null. */
function normalizeQuota(q) {
  const one = (x) => {
    const limit = intOf(x?.limit);
    const remaining = intOf(x?.remaining);
    const days = intOf(x?.days);
    return { limit: limit && limit > 0 ? limit : null, remaining: remaining !== null && remaining >= 0 ? remaining : null, days: days && days > 0 ? days : null, restricted: x?.restricted === true };
  };
  return { movie: one(q?.movie), tv: one(q?.tv) };
}

const TMDB_SIZES = new Set(['w154', 'w185', 'w342', 'w500', 'w780', 'w1280']); // w1280: Hintergrundbilder im Banner der Startseite
const TMDB_FILE = /^[A-Za-z0-9_-]{8,64}\.(?:jpg|jpeg|png|webp)$/;

/** URL eines TMDB-Posters, nur fuer bekannte Groessen und harmlose Dateinamen (sonst null). */
function tmdbImageUrl(size, file) {
  return TMDB_SIZES.has(size) && TMDB_FILE.test(String(file ?? '')) ? `https://image.tmdb.org/t/p/${size}/${file}` : null;
}

/**
 * Eine Anfrage, wie Seerr sie liefert (GET /request; ohne Titel, den holt media). Wie SeerrRequest.parse der Apple-App: Unvollstaendiges ergibt
 * null. mediaStatus: Stand des Titels (bei einer 4K-Anfrage der der 4K-Fassung); seasons: angefragte Staffeln, sortiert; readySeasons: wie viele
 * davon Seerr als geliefert fuehrt (Stand der Staffel in der Anfrage: abgeschlossen); modifierId: wer zuletzt entschieden hat.
 */
function normalizeRequest(r) {
  if (!r || typeof r !== 'object' || !Number.isInteger(+r.id) || +r.id <= 0) return null;
  const m = r.media && typeof r.media === 'object' ? r.media : null;
  const type = m?.mediaType ?? r.type;
  if (!m || !Number.isInteger(+m.tmdbId) || (type !== 'movie' && type !== 'tv')) return null;
  const is4k = r.is4k === true;
  const status = Number(r.status);
  const asked = Array.isArray(r.seasons) ? r.seasons.filter((s) => s && Number.isInteger(+s.seasonNumber)) : [];
  const by = r.requestedBy && typeof r.requestedBy === 'object' ? r.requestedBy : {};
  const created = typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : null;
  return {
    id: Number(r.id),
    status: status >= 1 && status <= 5 ? status : null,
    is4k,
    created,
    mediaType: type,
    tmdbId: Number(m.tmdbId),
    mediaStatus: Number(is4k ? m.status4k : m.status) || 0,
    seasons: [...new Set(asked.map((s) => Number(s.seasonNumber)))].sort((a, b) => a - b),
    readySeasons: asked.filter((s) => Number(s.status) === SeerrState.SEERR_REQUEST.COMPLETED).length,
    requesterId: Number.isInteger(+by.id) ? Number(by.id) : 0,
    requesterName: text(by.displayName || by.jellyfinUsername || by.username, 120),
    modifierId: Number.isInteger(+r.modifiedBy?.id) ? Number(r.modifiedBy.id) : null
  };
}

/** Aktionen an einer Anfrage: Methode und Pfad (zurueckziehen und entfernen sind bei Seerr dasselbe: DELETE, entfernt nur die Anfrage). */
const REQUEST_ACTIONS = Object.freeze({
  approve: ['POST', '/approve'],
  decline: ['POST', '/decline'],
  retry: ['POST', '/retry'],
  withdraw: ['DELETE', ''],
  remove: ['DELETE', '']
});

/** Abfragen, deren Texte von der Sprache abhaengen (Titel, Handlung, Personen); Anmeldung, Anfragen und Rechte nicht (wie die Apple-App). */
const CONTENT_PATHS = ['/search', '/discover/', '/movie/', '/tv/', '/person/', '/collection/'];

/** Kurzform einer Sprache fuer Seerr ("de-DE" -> "de"); Unbrauchbares ergibt '' (dann nimmt Seerr die Anzeigesprache des Seerr-Kontos). */
function seerrLanguage(value) {
  const m = /^([a-z]{2,3})(?:[-_]|$)/i.exec(String(value ?? '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * Der angemeldete Seerr-Benutzer, wie Seerr ihn meldet (/auth/me): Nummer, Name, Rechte (Bitfeld) und das Jellyfin-Konto, zu dem er gehoert.
 * Nur im Speicher, bei jeder Pruefung neu; unbekannte Rechte ergeben 0 (nichts freigeschaltet). Ohne Nummer null.
 */
function normalizeUser(d) {
  if (!d || typeof d !== 'object' || !Number.isInteger(+d.id)) return null;
  const perms = Number(d.permissions);
  return {
    id: Number(d.id),
    displayName: text(d.displayName || d.jellyfinUsername || d.username, 120),
    permissions: Number.isInteger(perms) && perms >= 0 ? perms : 0,
    jellyfinUserId: typeof d.jellyfinUserId === 'string' ? d.jellyfinUserId.slice(0, 64) : ''
  };
}

class SeerrClient {
  /** Nur mit der Sitzung des Jellyfin-Kontos (Cookie connect.sid); einen API-Schluessel gibt es seit Version 10 nicht mehr (Entscheidung E12).
   * language: Sprache der Texte (Kurzform oder eine Funktion, die sie liefert), geht als language= an die Abfragen von Titeln, Suche und Personen.
   * @param {{baseUrl:string, cookie?:string|null, fetch?:typeof fetch, language?:string|(() => string)}} o */
  constructor({ baseUrl, cookie = null, fetch = globalThis.fetch, language = '' }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.cookie = cookie;
    this.fetch = fetch;
    this.language = language;
  }

  headers(extra = {}) {
    const h = { Accept: 'application/json', ...extra };
    if (this.cookie) h.Cookie = `connect.sid=${this.cookie}`;
    return h;
  }

  async request(method, path, { query, body, timeout = 20000, signal } = {}) {
    // Ohne Angabe liefert Seerr Titel und Handlung in der Anzeigesprache des Seerr-Kontos, die zur App nicht passen muss (Apple: Build 92)
    if (method === 'GET' && CONTENT_PATHS.some((p) => path.startsWith(p)) && !query?.language) {
      const lang = seerrLanguage(typeof this.language === 'function' ? this.language() : this.language);
      if (lang) query = { ...query, language: lang };
    }
    const q = query ? `?${Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    const init = { method, headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(signal ? { signal } : {}) };
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

  /** Angemeldeter Benutzer mit seinen Rechten (prueft zugleich, ob die Sitzung gilt), siehe normalizeUser; ohne Nummer ein Fehler. */
  async me({ signal, timeout } = {}) {
    const u = normalizeUser(await this.request('GET', '/auth/me', { signal, timeout }));
    if (!u) throw new SeerrError('Seerr hat keinen Benutzer gemeldet');
    return u;
  }

  /** Meldet die Sitzung bei Seerr ab (beim Trennen, Abmelden, Entfernen des Profils und bei einer fremden Sitzung); Fehler zaehlen nicht. */
  async logout() {
    if (!this.cookie) return;
    await this.request('POST', '/auth/logout', { timeout: 5000 }).catch(() => {});
  }

  /** @returns {Promise<ReturnType<typeof normalizeResult>[]>} nur Filme und Serien */
  async search(query, page = 1) {
    const r = await this.request('GET', '/search', { query: { query, page } });
    return (r?.results ?? []).map(normalizeResult).filter(Boolean);
  }

  /**
   * Filme, die gerade im Trend liegen (GET /discover/trending, Seerr mischt dort Filme, Serien und Personen). Serien, Personen, doppelte Eintraege und gesperrte Titel
   * (Stand 6) fallen weg, geloeschte (7) bleiben (sie lassen sich wieder anfragen); es werden hoechstens drei Seiten gelesen, bis `limit` Filme da sind. Scheitert
   * eine spaetere Seite, bleibt es bei dem, was schon da ist.
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
        if (n?.mediaType !== 'movie' || SeerrState.isBlocklisted(n.status) || seen.has(n.id)) continue;
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
   * Eine Seite der Anfragen, neueste zuerst (GET /request, wie Seerr 3.5.1: take, skip, filter all, sort added; userId: nur die Anfragen dieses
   * Benutzers, requestedBy). received zaehlt auch unlesbare Eintraege (dort beginnt die naechste Seite), total ist pageInfo.results (sonst null).
   * @returns {Promise<{requests: ReturnType<typeof normalizeRequest>[], received: number, asked: number, total: number|null}>}
   */
  async requestPage({ userId = null, skip = 0, take = 50 } = {}) {
    const t = Math.min(1000, Math.max(1, Math.trunc(Number(take)) || 50));
    const s = Math.max(0, Math.trunc(Number(skip)) || 0);
    const query = { take: t, skip: s, filter: 'all', sort: 'added', ...(Number.isInteger(userId) && userId > 0 ? { requestedBy: userId } : {}) };
    const r = await this.request('GET', '/request', { query });
    const raw = Array.isArray(r?.results) ? r.results : [];
    const total = Number(r?.pageInfo?.results);
    return { requests: raw.map(normalizeRequest).filter(Boolean), received: raw.length, asked: t, total: Number.isInteger(total) && total >= 0 ? total : null };
  }

  /** Titel, Jahr, Bild und Stand eines Titels (fuer die Plakate der Anfragen), wie ein Suchergebnis; null, wenn die Antwort keinen Titel hat. */
  async media(mediaType, tmdbId) {
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new SeerrError('Unbekannter Medientyp');
    if (!Number.isInteger(+tmdbId) || +tmdbId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    const d = await this.request('GET', `/${mediaType}/${Number(tmdbId)}`);
    return normalizeResult(d && typeof d === 'object' ? { ...d, mediaType } : null);
  }

  /**
   * Aendert eine Anfrage: genehmigen, ablehnen, erneut versuchen (Recht "Anfragen verwalten"), zurueckziehen (eigene, solange sie wartet) oder
   * entfernen (verwalten). Entfernt nur die Anfrage, nie den Titel oder seine Dateien. Seerr prueft die Rechte selbst.
   */
  async requestAction(id, action) {
    const spec = REQUEST_ACTIONS[action];
    if (!spec) throw new SeerrError('Unbekannte Aktion');
    if (!Number.isInteger(+id) || +id <= 0) throw new SeerrError('Ungueltige Anfrage');
    await this.request(spec[0], `/request/${Number(id)}${spec[1]}`);
  }

  /** Empfohlene (kind "recommendations") oder aehnliche Titel ("similar"): die erste Seite von Seerr mit dem Stand je Titel, ohne den Titel selbst. */
  async related(mediaType, tmdbId, kind) {
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new SeerrError('Unbekannter Medientyp');
    if (kind !== 'recommendations' && kind !== 'similar') throw new SeerrError('Unbekannte Liste');
    if (!Number.isInteger(+tmdbId) || +tmdbId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    const r = await this.request('GET', `/${mediaType}/${Number(tmdbId)}/${kind}`, { query: { page: 1 } });
    return titleList(r?.results, mediaType).filter((x) => !(x.mediaType === mediaType && x.id === Number(tmdbId)));
  }

  /** Die Filme einer Filmreihe in der Reihenfolge von Seerr (nach Erscheinen). */
  async collection(id) {
    if (!Number.isInteger(+id) || +id <= 0) throw new SeerrError('Ungueltige Filmreihe');
    const r = await this.request('GET', `/collection/${Number(id)}`);
    return titleList(r?.parts, 'movie');
  }

  /** Bewertung von IMDb zu einem Film, wie Seerr sie holt ({ score, votes }); null ohne Bewertung. (Rotten Tomatoes ordnet Seerr nur ueber den Titel zu: nicht uebernommen.) */
  async imdbRating(tmdbId) {
    if (!Number.isInteger(+tmdbId) || +tmdbId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    const r = await this.request('GET', `/movie/${Number(tmdbId)}/ratingscombined`);
    const score = Number(r?.imdb?.criticsScore);
    if (!Number.isFinite(score) || score <= 0) return null;
    const votes = intOf(r.imdb.criticsScoreCount);
    return { score, votes: votes && votes > 0 ? votes : null };
  }

  /** Eine Person mit Biografie, Lebensdaten und Bild (normalizePerson); ohne Namen ein Fehler. */
  async person(id) {
    if (!Number.isInteger(+id) || +id <= 0) throw new SeerrError('Ungueltige Person');
    const p = normalizePerson(Number(id), await this.request('GET', `/person/${Number(id)}`));
    if (!p) throw new SeerrError('Unerwartete Antwort von Seerr');
    return p;
  }

  /** Filmografie einer Person mit dem Stand jedes Titels (buildFilmography). */
  async filmography(id) {
    if (!Number.isInteger(+id) || +id <= 0) throw new SeerrError('Ungueltige Person');
    return buildFilmography(await this.request('GET', `/person/${Number(id)}/combined_credits`));
  }

  /** Kontingent des Benutzers fuer Filme und Serien (normalizeQuota). */
  async quota(userId) {
    if (!Number.isInteger(+userId) || +userId <= 0) throw new SeerrError('Unbekannter Benutzer');
    return normalizeQuota(await this.request('GET', `/user/${Number(userId)}/quota`));
  }

  /**
   * Stellt eine Anfrage: einen Film oder bei Serien die gewaehlten Staffeln (seasons: Nummern; ohne: alle). Immer eine allgemeine Anfrage, nie eine 4K-Anfrage
   * (wie die Apple-App, auch mit dem Recht dazu). Seerr prueft Rechte, Kontingent und doppelte Anfragen selbst.
   * @returns {Promise<{id:number|null, requestStatus:number|null, mediaStatus:number|null}>}
   *   requestStatus: 1 wartet auf Freigabe, 2 freigegeben, 3 abgelehnt. mediaStatus: siehe MEDIA_STATUS.
   */
  async requestMedia({ mediaType, mediaId, seasons = null }) {
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new SeerrError('Unbekannter Medientyp');
    if (!Number.isFinite(+mediaId) || +mediaId <= 0) throw new SeerrError('Ungueltige Titel-ID');
    let chosen = 'all';
    if (mediaType === 'tv' && Array.isArray(seasons)) {
      chosen = [...new Set(seasons.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1000))].sort((a, b) => a - b);
      if (!chosen.length) throw new SeerrError('Keine Staffel gewaehlt');
    }
    const body = { mediaType, mediaId: Number(mediaId), is4k: false, ...(mediaType === 'tv' ? { seasons: chosen } : {}) };
    const r = await this.request('POST', '/request', { body });
    return { id: r?.id ?? null, requestStatus: Number(r?.status) || null, mediaStatus: Number(r?.media?.status) || null };
  }
}

return { MEDIA_STATUS, ISSUE_TYPES, CONTENT_PATHS, REQUEST_ACTIONS, SeerrError, SeerrClient, normalizeSeerrUrl, candidateSeerrUrls, probeSeerr, loginWithJellyfin, sessionCookieFrom, normalizeResult, normalizeDetails, normalizeUser, normalizeRequest, normalizeQuota, normalizePerson, buildFilmography, crewRole, seerrLanguage, tmdbImageUrl };
});
