/* Gemeinsames Modul: Anpassung der Startseite (Banner und Reihen).
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCHomeRows) in der Oberflaeche.

   Reihen haben Kennungen: "latest:<Bibliotheks-Id>" (Neu in ...), "continue" (Weiterschauen), "nextUp" (Als Naechstes), "top10Movies", "top10Series"
   (Top 10, Seerr), "favorites", "trending" (Filme im Trend, Seerr). Gespeichert werden nur die Wuensche des Nutzers: "order" (Reihenfolge) und "hidden"
   (ausgeblendet), seit Konfigurationsversion 10 je Profil (config-core.js). Was dort nicht steht (neue Bibliothek, neue Reihe), steht hinter der Reihe,
   hinter der es in der Standardreihenfolge stuende, und ist sichtbar. Unbekannte Eintraege in den Listen schaden nicht (eine geloeschte Bibliothek bleibt
   einfach ohne Wirkung). Vorlage: Jellycloud/Core/HomeRows.swift der Apple-App. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCHomeRows = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { heroSlides: [3, 10] };
  const MAX_LIST = 100;

  /**
   * Standardwerte (stehen auch in den Einstellungen, config.js). Das Banner zeigt nur Neues aus der Mediathek (seit 1.2.14 ohne Trend-Folien aus Seerr,
   * Entscheidung E8 wie die Apple-App).
   */
  const DEFAULTS = {
    hero: true, // Banner oben auf der Startseite
    heroSlides: 6, // Folien im Banner
    rankingWindow: 'week', // Zeitraum der Top 10: 'week' (diese Woche) oder 'day' (heute); gilt fuer das Geraet
    order: [], // gewuenschte Reihenfolge der Reihen (Kennungen)
    hidden: [] // ausgeblendete Reihen (Kennungen)
  };

  /** Top 10 Filme und Top 10 Serien (Seerr). */
  const TOP_MOVIES = 'top10Movies';
  const TOP_SERIES = 'top10Series';
  const RANKING_ROWS = [TOP_MOVIES, TOP_SERIES];
  /** "Meine Anfragen" (Apple-App Build 94): die juengsten eigenen Anfragen bei Seerr mit ihrem Stand als Tag, hoechstens MY_REQUESTS_LIMIT. */
  const MY_REQUESTS = 'myRequests';
  const MY_REQUESTS_LIMIT = 10;
  /** Merkliste von Seerr (Build 94): die juengsten gemerkten Titel, hoechstens WATCHLIST_LIMIT. */
  const WATCHLIST = 'seerrWatchlist';
  const WATCHLIST_LIMIT = 20;
  /** Entdecken bei Seerr (Build 94): beliebte und kommende Filme und Serien, in der Standardreihenfolge ganz unten. */
  const DISCOVER = {
    seerrPopularMovies: { path: '/discover/movies', mediaType: 'movie', browse: true },
    seerrPopularSeries: { path: '/discover/tv', mediaType: 'tv', browse: true },
    seerrUpcomingMovies: { path: '/discover/movies/upcoming', mediaType: 'movie', browse: false },
    seerrUpcomingSeries: { path: '/discover/tv/upcoming', mediaType: 'tv', browse: false }
  };
  const DISCOVER_ROWS = Object.keys(DISCOVER);
  const STATIC_ROWS = ['continue', 'nextUp', MY_REQUESTS, WATCHLIST, TOP_MOVIES, TOP_SERIES, 'favorites', 'trending', ...DISCOVER_ROWS];
  /** Stehen in der Standardreihenfolge ganz oben: wer etwas angefangen hat, will zuerst dort weitermachen, und die naechste Folge gehoert direkt darunter. */
  const TOP_ROWS = ['continue', 'nextUp'];
  /**
   * Reihen, die es nur mit Seerr gibt (Trend, Anfragen, Merkliste, Top 10, Entdecken): ohne Seerr bleiben sie von der Startseite fort; ihr gemerkter
   * Platz und ob sie ausgeblendet sind, bleiben.
   */
  const SEERR_ROWS = ['trending', MY_REQUESTS, WATCHLIST, ...RANKING_ROWS, ...DISCOVER_ROWS];

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function cleanList(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) {
      if (typeof x === 'string' && x && x.length <= 80 && !out.includes(x)) out.push(x);
      if (out.length >= MAX_LIST) break;
    }
    return out;
  }

  /** Bringt rohe (gespeicherte oder vom Fenster kommende) Werte in eine gueltige Form: Grenzen, Typen, doppelte und fremde Eintraege. */
  function homeConfig(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      hero: r.hero !== false,
      heroSlides: clampInt(r.heroSlides, LIMITS.heroSlides[0], LIMITS.heroSlides[1], DEFAULTS.heroSlides),
      rankingWindow: r.rankingWindow === 'day' ? 'day' : 'week',
      order: cleanList(r.order),
      hidden: cleanList(r.hidden)
    };
  }

  /**
   * Standardreihenfolge: Weiterschauen und Als Naechstes ganz oben, dann die eigenen Anfragen und die Merkliste, dann die Top 10, dann die
   * Neuzugaenge je Bibliothek (in Bibliotheksreihenfolge), dann die uebrigen festen Reihen (Favoriten, Filme im Trend, Entdecken).
   */
  function defaultOrder(libraryIds) {
    const first = [...TOP_ROWS, MY_REQUESTS, WATCHLIST, ...RANKING_ROWS];
    return [...first, ...(libraryIds || []).map((id) => `latest:${id}`), ...STATIC_ROWS.filter((id) => !first.includes(id))];
  }

  /**
   * Alle vorhandenen Reihen in der Reihenfolge des Nutzers (auch die ausgeblendeten): seine Reihenfolge (nur was es gibt); eine Reihe, die
   * darin noch nicht vorkommt (neue Bibliothek, neue Reihe wie die Top 10), steht hinter der Reihe, hinter der sie in der
   * Standardreihenfolge stuende, ohne eine solche ganz vorn. Bis 1.2.4 kam sie ans Ende: wer seine Reihen einmal geordnet hatte, haette eine
   * neue Bibliothek unter allem anderen gefunden.
   * @param {string[]} present vorhandene Kennungen in Standardreihenfolge
   */
  function arrangeAll(present, order) {
    const have = new Set(present);
    const out = [];
    for (const id of cleanList(order)) if (have.has(id) && !out.includes(id)) out.push(id);
    present.forEach((id, index) => {
      if (out.includes(id)) return;
      // die naechste Reihe davor (in der Standardreihenfolge), die schon einen Platz hat
      let anchor = null;
      for (let i = index - 1; i >= 0; i--) {
        if (out.includes(present[i])) {
          anchor = present[i];
          break;
        }
      }
      out.splice(anchor === null ? 0 : out.indexOf(anchor) + 1, 0, id);
    });
    return out;
  }

  /** Die sichtbaren Reihen in der Reihenfolge des Nutzers. */
  function arrangeRows(present, order, hidden) {
    const off = new Set(cleanList(hidden));
    return arrangeAll(present, order).filter((id) => !off.has(id));
  }

  /** Verschiebt `id` in `list` um `delta` Plaetze (negativ = nach oben); am Rand bleibt es stehen. Gibt eine neue Liste zurueck. */
  function moveRow(list, id, delta) {
    const i = list.indexOf(id);
    if (i < 0) return [...list];
    const j = Math.min(list.length - 1, Math.max(0, i + delta));
    const out = [...list];
    out.splice(i, 1);
    out.splice(j, 0, id);
    return out;
  }

  return { LIMITS, DEFAULTS, STATIC_ROWS, TOP_ROWS, TOP_MOVIES, TOP_SERIES, RANKING_ROWS, MY_REQUESTS, MY_REQUESTS_LIMIT, WATCHLIST, WATCHLIST_LIMIT, DISCOVER, DISCOVER_ROWS, SEERR_ROWS, homeConfig, defaultOrder, arrangeAll, arrangeRows, moveRow };
});
