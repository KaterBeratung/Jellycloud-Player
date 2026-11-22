/* Gemeinsames Modul: die Seite einer Person und die Besetzungsreihen, die auf sie fuehren. Eine Seite fuer zwei Wege: aus der Besetzung eines Titels der
   Mediathek (Kennung bei Jellyfin) und eines Seerr-Titels (Nummer bei TMDB, wie Seerr sie nennt). Die Quellen bleiben getrennt (Mediathek: Jellyfin;
   Filmografie und fehlende Angaben: Seerr), verbunden werden sie nur ueber die TMDB-Nummer der Person, nie ueber ihren Namen. Fehlendes bleibt leer, nichts
   wird geschaetzt. Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCPerson). Vorlage: Features/Person/PersonView.swift und CastRow.swift der
   Apple-App (Build 92). Sprache: 'de' (Standard) oder 'en'. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seerr-facts'));
  else root.JCPerson = factory(root.JCSeerrFacts);
})(typeof self !== 'undefined' ? self : this, function (Facts) {
  'use strict';

  const WORDS = {
    de: {
      born: 'Geboren am {date}', bornIn: 'Geboren am {date} in {place}', bornPlace: 'Geboren in {place}', died: 'Gestorben am {date}', diedAge: 'Gestorben am {date} ({age} Jahre)',
      age: '{age} Jahre alt', one: '1 Titel in deiner Bibliothek', inLibrary: '{list} in deiner Bibliothek', and: ' und ',
      movie: '1 Film', movies: '{n} Filme', serie: '1 Serie', series: '{n} Serien'
    },
    en: {
      born: 'Born {date}', bornIn: 'Born {date} in {place}', bornPlace: 'Born in {place}', died: 'Died {date}', diedAge: 'Died {date} (aged {age})',
      age: '{age} years old', one: '1 title in your library', inLibrary: '{list} in your library', and: ' and ',
      movie: '1 movie', movies: '{n} movies', serie: '1 show', series: '{n} shows'
    }
  };
  const words = (lang) => WORDS[String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de'];
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const str = (v, max = 12000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const ID = /^[0-9a-fA-F-]{8,40}$/;

  // ---------- Ziel ----------

  /** Ziel einer Person: { library: Kennung } oder { seerr: Nummer }. Mediathek und Seerr sind verschiedene Ziele, auch bei gleicher Zahl; ohne gueltige Kennung null. */
  function routeKey(route) {
    if (route && typeof route.library === 'string' && ID.test(route.library)) return `lib-${route.library}`;
    if (route && Number.isInteger(+route.seerr) && +route.seerr > 0 && route.library === undefined) return `tmdb-${Number(route.seerr)}`;
    return null;
  }

  /** Adresse der Seite (#/person/<Kennung> bzw. #/person/tmdb/<Nummer>); ohne gueltige Kennung null (dann wird die Person nur angezeigt). */
  function href(route) {
    const k = routeKey(route);
    if (!k) return null;
    return k.startsWith('lib-') ? `#/person/${k.slice(4)}` : `#/person/tmdb/${k.slice(5)}`;
  }

  // ---------- Lebensdaten ----------

  const validDay = (y, m, d) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  };
  const pad = (n) => String(n).padStart(2, '0');

  /** Seerr nennt den Tag ohne Uhrzeit ("1980-04-07"): so bleibt er, in jeder Zeitzone derselbe Tag. Unlesbares ergibt null. */
  function seerrDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(text, 40));
    return m && validDay(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  /**
   * Jellyfin speichert den Tag als Mitternacht beim Server und liefert ihn in UTC (der 7. April kommt als "1918-04-06T23:00:00Z"): mit zwoelf Stunden Aufschlag
   * landet jede Zeitzone des Servers auf dem richtigen Tag. Unlesbares ergibt null.
   */
  function libraryDay(iso) {
    const s = str(iso, 60);
    if (s.length < 10) return null;
    const ms = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms + 12 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  /** Volle Jahre zwischen zwei Tagen ("YYYY-MM-DD"). */
  function yearsBetween(from, to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
  }
  const localDay = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  /** "Norwood, London, England, UK" -> "Norwood, London". */
  function shortPlace(place) {
    return str(place, 300).split(',').map((p) => p.trim()).filter(Boolean).slice(0, 2).join(', ');
  }

  // ---------- Angaben der Person ----------

  /** Person der Mediathek (image: Adresse ihres Bildes oder null). */
  function fromLibrary(p, image = null) {
    const place = Array.isArray(p?.ProductionLocations) ? p.ProductionLocations.find((x) => typeof x === 'string' && x.trim()) : null;
    return { name: str(p?.Name, 200), biography: str(p?.Overview), born: libraryDay(p?.PremiereDate), died: libraryDay(p?.EndDate), birthplace: place ? shortPlace(place) || null : null, image: image ?? null };
  }

  /** Person bei Seerr (normalizePerson aus src/shared/seerr.js). */
  function fromSeerr(p, image = null) {
    return { name: str(p?.name, 200), biography: str(p?.biography), born: seerrDay(p?.birthday), died: seerrDay(p?.deathday), birthplace: p?.placeOfBirth ? shortPlace(p.placeOfBirth) || null : null, image: image ?? null };
  }

  /** Ergaenzt, was fehlt, aus einer zweiten Quelle (die Mediathek kennt Biografie und Daten oft nicht, Seerr schon). Vorhandenes bleibt. */
  function fillGaps(a, b) {
    if (!a) return b ?? null;
    if (!b) return a;
    const out = { ...a };
    for (const k of ['name', 'biography', 'born', 'died', 'birthplace', 'image']) if (!out[k] && b[k]) out[k] = b[k];
    return out;
  }

  /** Fehlt etwas, das Seerr ergaenzen koennte (Biografie, Geburtstag, Bild)? */
  const hasGaps = (p) => !p || !p.biography || !p.born || !p.image;

  /** Zeilen unter dem Namen: "Geboren am 7. April 1918 in Norwood, London", "Gestorben am 19. Dezember 1996 (78 Jahre)" bzw. "38 Jahre alt". */
  function facts(p, { lang = 'de', now = new Date() } = {}) {
    if (!p) return [];
    const w = words(lang);
    const out = [];
    const born = p.born ? Facts.day(p.born, lang) : null;
    const died = p.died ? Facts.day(p.died, lang) : null;
    if (born) out.push(fill(p.birthplace ? w.bornIn : w.born, { date: born, place: p.birthplace }));
    else if (p.birthplace) out.push(fill(w.bornPlace, { place: p.birthplace }));
    if (died) out.push(p.born ? fill(w.diedAge, { date: died, age: yearsBetween(p.born, p.died) }) : fill(w.died, { date: died }));
    else if (p.born) {
      const age = yearsBetween(p.born, localDay(now));
      if (age >= 0 && age < 130) out.push(fill(w.age, { age }));
    }
    return out;
  }

  // ---------- Titel der Seite ----------

  const tmdbOf = (item) => {
    const v = Object.entries(item?.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === 'tmdb')?.[1];
    return /^\d{1,9}$/.test(String(v ?? '')) ? String(Number(v)) : null;
  };

  /** Titel der Mediathek nach Art: Filme, Serien und Folgen (nur Folgen aus Serien, die nicht schon als Ganzes in der Liste stehen). */
  function libraryGroups(items) {
    const list = Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : [];
    const movies = list.filter((i) => i.Type === 'Movie');
    const series = list.filter((i) => i.Type === 'Series');
    const ids = new Set(series.map((i) => i.Id));
    const episodes = list.filter((i) => i.Type === 'Episode' && !ids.has(i.SeriesId ?? ''));
    return { movies, series, episodes };
  }

  /** "1 Titel in deiner Bibliothek", sonst "3 Filme und 1 Serie in deiner Bibliothek" (Folgen zaehlen zu ihrer Serie); ohne Titel null. */
  function libraryBadge(items, lang = 'de') {
    const list = Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : [];
    if (!list.length) return null;
    const w = words(lang);
    if (list.length === 1) return w.one;
    const movies = list.filter((i) => i.Type === 'Movie').length;
    const series = new Set(list.map((i) => (i.Type === 'Series' ? i.Id : i.Type === 'Episode' ? i.SeriesId : null)).filter(Boolean)).size;
    const parts = [movies ? (movies === 1 ? w.movie : fill(w.movies, { n: movies })) : null, series ? (series === 1 ? w.serie : fill(w.series, { n: series })) : null].filter(Boolean);
    return parts.length ? fill(w.inLibrary, { list: parts.join(w.and) }) : null;
  }

  /**
   * Die Reihen der Seite: zuerst, was in der Mediathek liegt ("movies", "series", "episodes"), darunter die Filmografie aus Seerr ohne die Titel, die schon in den
   * Reihen der Mediathek stehen (Abgleich ueber die TMDB-Nummer): vor der Kamera Filme und Serien ("moreMovies", "moreSeries"; ohne Titel der Mediathek heissen sie
   * "movies" und "series"), dann die Arbeit hinter der Kamera ("crew"). Leere Reihen fallen weg.
   * @returns {({kind:'library', key:string, items:object[], thumbs:boolean}|{kind:'credits', key:string, credits:object[]})[]}
   */
  function rows({ items = [], filmography = null } = {}) {
    const g = libraryGroups(items);
    const out = [['movies', g.movies, false], ['series', g.series, false], ['episodes', g.episodes, true]].filter(([, l]) => l.length).map(([key, list, thumbs]) => ({ kind: 'library', key, items: list, thumbs }));
    if (!filmography) return out;
    const owned = new Set([...g.movies.map((i) => tmdbOf(i) && `movie-${tmdbOf(i)}`), ...g.series.map((i) => tmdbOf(i) && `tv-${tmdbOf(i)}`)].filter(Boolean));
    const more = out.length > 0;
    for (const [key, list] of [[more ? 'moreMovies' : 'movies', filmography.movies], [more ? 'moreSeries' : 'series', filmography.series], ['crew', filmography.crew]]) {
      const left = (Array.isArray(list) ? list : []).filter((c) => !owned.has(`${c.mediaType}-${c.id}`));
      if (left.length) out.push({ kind: 'credits', key, credits: left });
    }
    return out;
  }

  // ---------- Besetzungsreihe ----------

  /** Aufgaben der Mediathek ("Director" ...), als Schluessel der Oberflaeche (seerr.crew.<Schluessel>). */
  const LIBRARY_JOBS = { Director: 'director', Writer: 'writer', Producer: 'producer', Composer: 'music', GuestStar: 'guestStar', Actor: 'acting' };

  /** Rolle einer Person der Mediathek: bei Schauspiel die Figur, sonst die Taetigkeit ({ key }); Unbekanntes bleibt, wie der Server es nennt. */
  function libraryRole(p) {
    const role = str(p?.Role, 200);
    if (role && !own(LIBRARY_JOBS, role)) return { text: role };
    const type = str(p?.Type, 60);
    if (own(LIBRARY_JOBS, type)) return { key: LIBRARY_JOBS[type] };
    return type ? { text: type } : null;
  }

  /**
   * Besetzung eines Titels der Mediathek: Schauspiel, Regie und Gastrollen, hoechstens 30, in der Reihenfolge des Servers. Je Eintrag Name, Rollen ({ key }|{ text }),
   * Ziel ({ library: Kennung }, ohne Kennung null: dann nur angezeigt) und die Person selbst (fuer ihr Bild).
   */
  function libraryCast(people) {
    return (Array.isArray(people) ? people : [])
      .filter((p) => p && ['Actor', 'Director', 'GuestStar'].includes(p.Type) && str(p.Name, 200))
      .slice(0, 30)
      .map((p) => ({ name: str(p.Name, 200), roles: [libraryRole(p)].filter(Boolean), route: typeof p.Id === 'string' && ID.test(p.Id) ? { library: p.Id } : null, person: p }));
  }

  /**
   * Besetzung eines Seerr-Titels (normalizeDetails): zuerst Regie bzw. die Schoepfer der Serie und Drehbuch, dann die Darsteller mit ihrer Rolle (ohne Rolle
   * "Schauspiel"), dahinter Produktion und Musik. Jede Person mit Nummer fuehrt auf ihre Seite ({ seerr: Nummer }), ohne Nummer null.
   */
  function seerrCast(details) {
    const route = (id) => (Number.isInteger(id) && id > 0 ? { seerr: id } : null);
    const crew = (list) => (Array.isArray(list) ? list : []).map((c) => ({ name: c.name, roles: (c.roles ?? []).map((key) => ({ key })), route: route(c.id), profilePath: c.profilePath ?? null }));
    const cast = (Array.isArray(details?.cast) ? details.cast : []).map((c) => ({ name: c.name, roles: [c.character ? { text: c.character } : { key: 'acting' }], route: route(c.id), profilePath: c.profilePath ?? null }));
    return [...crew(details?.crew), ...cast, ...crew(details?.furtherCrew)].filter((e) => e.name);
  }

  return { routeKey, href, seerrDay, libraryDay, shortPlace, fromLibrary, fromSeerr, fillGaps, hasGaps, facts, libraryGroups, libraryBadge, rows, libraryRole, libraryCast, seerrCast, tmdbOf };
});
