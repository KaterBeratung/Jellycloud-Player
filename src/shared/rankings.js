/* Gemeinsames Modul: Top 10 Filme und Top 10 Serien. Welche Titel der EIGENEN Mediathek gerade im Trend liegen: die Rangfolge kommt von Seerr
   (/discover/trending mit Art und Zeitraum), gezeigt wird nur, was es in der Mediathek gibt und was das Profil sehen darf, in der Reihenfolge der Trends,
   hoechstens zehn, ohne Ersatzinhalte. Ohne Seerr gibt es keine Quelle und keine Anfrage. Regeln, Laden, Zwischenspeicher (30 min je Server, Profil, Seerr
   und Zeitraum), Masse der Karten und die Texte. Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCRankings).
   Vorlage: Jellycloud/Core/Rankings.swift, Features/Home/TopTenRow.swift und Features/Settings/TopTenSettings.swift der Apple-App (Build 81 bis 93). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCRankings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** So viele Titel zeigt eine Reihe hoechstens. */
  const LIMIT = 10;
  /** So viele Seiten der Trendliste (je 20 Titel) werden hoechstens gelesen, um zehn vorhandene Titel zu finden. */
  const MAX_PAGES = 5;
  /** So lange gilt eine geladene Rangfolge. */
  const LIFETIME_MS = 30 * 60 * 1000;
  /** Die Arten: Typ bei Jellyfin, Art bei Seerr, Kennung der Reihe (src/shared/home-rows.js). */
  const KINDS = {
    movies: { itemType: 'Movie', mediaType: 'movie', row: 'top10Movies' },
    series: { itemType: 'Series', mediaType: 'tv', row: 'top10Series' }
  };

  const WORDS = {
    de: {
      day: 'Heute', week: 'Diese Woche', dayPhrase: 'heute', weekPhrase: 'diese Woche',
      caption: 'Im Trend {w} · aus deiner Mediathek · Quelle Seerr',
      notConnected: 'Seerr ist nicht verbunden', loading: 'Seerr · wird geladen …', unreachable: 'Seerr · nicht erreichbar',
      current: 'Seerr · {w} · {m} {mw}, {s} {sw}', movie: 'Film', movies: 'Filme', serie: 'Serie', series: 'Serien',
      footer: 'Die Reihen „Top 10 Filme“ und „Top 10 Serien“ zeigen, welche Titel deiner Mediathek gerade im Trend liegen: die Rangfolge kommt von Seerr, gezeigt wird nur, was es bei dir gibt und was dein Profil sehen darf.',
      footerNoSeerr: ' Ohne Seerr bleiben die Reihen aus.',
      footerDayOnly: ' Dieser Seerr-Server liefert nur die Trends von heute.',
      footerStats: ' Wiedergabestatistiken des eigenen Servers stehen nicht zur Wahl: Jellyfin gibt sie ohne Zusatz-Plugin und Administratorrechte nicht heraus.'
    },
    en: {
      day: 'Today', week: 'This week', dayPhrase: 'today', weekPhrase: 'this week',
      caption: 'Trending {w} · from your library · source Seerr',
      notConnected: 'Seerr is not connected', loading: 'Seerr · loading …', unreachable: 'Seerr · unreachable',
      current: 'Seerr · {w} · {m} {mw}, {s} {sw}', movie: 'movie', movies: 'movies', serie: 'show', series: 'shows',
      footer: 'The rows “Top 10 Movies” and “Top 10 Shows” show which titles of your library are trending right now: the ranking comes from Seerr, and only what you have and what your profile may see is shown.',
      footerNoSeerr: ' Without Seerr, the rows stay off.',
      footerDayOnly: ' This Seerr server only provides today’s trends.',
      footerStats: ' Playback statistics of your own server are not offered: Jellyfin does not provide them without an add-on plugin and administrator rights.'
    }
  };
  const words = (lang) => WORDS[String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de'];
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

  /** Zeitraum: 'day' oder 'week' (Standard: diese Woche). */
  const normWindow = (w) => (w === 'day' ? 'day' : 'week');
  /** Die Zeitraeume, die Seerr liefert: beide, wenn der Server sie befolgt (oder es noch nicht bekannt ist); ein aelteres Seerr nur "heute". */
  const windows = (honors) => (honors === false ? ['day'] : ['day', 'week']);

  /**
   * Die Eintraege der Mediathek zu einer Trendliste, in deren Reihenfolge: hoechstens `limit`, jeder Titel und jeder Eintrag nur einmal. `index` ordnet
   * TMDB-Nummern den Eintraegen zu (nur, was das Profil sehen darf). Zugeordnet wird allein ueber die Nummer und nur innerhalb derselben Art.
   * @param {{tmdbId:number, kind:'movies'|'series'}[]} ranking
   * @param {Map<number,string>|Object<string,string>} index
   */
  function match(ranking, kind, index, limit = LIMIT) {
    const get = (id) => (index instanceof Map ? index.get(id) : index?.[id]);
    const seenTitles = new Set();
    const seenItems = new Set();
    const out = [];
    for (const entry of Array.isArray(ranking) ? ranking : []) {
      if (!entry || entry.kind !== kind || seenTitles.has(entry.tmdbId)) continue;
      seenTitles.add(entry.tmdbId);
      const item = get(entry.tmdbId);
      if (!item || seenItems.has(item)) continue;
      seenItems.add(item);
      out.push(item);
      if (out.length === limit) break;
    }
    return out;
  }

  /** Der Zwischenspeicher gilt je Server, Profil, Seerr-Server und Zeitraum: aendert sich eines davon, zaehlt das alte Ergebnis nicht mehr. */
  const cacheKey = ({ server = '', user = '', seerrAddress = '', window = 'week' } = {}) => [server, user, 'seerr', seerrAddress, normWindow(window)].join('|');

  /**
   * Eine Seite der Trends von Seerr. Das aktuelle Seerr nimmt Art und Zeitraum entgegen; aeltere Versionen uebergehen beide und liefern Filme, Serien und
   * Personen gemischt mit den Trends von heute. honored: der Server hat die Angaben befolgt (die Seite enthaelt nur die verlangte Art); null bei einer leeren
   * Seite (sie sagt nichts darueber; die Apple-App wertete sie als "nicht befolgt" und zeigte dann "heute", obwohl der Server die Woche kennt).
   * @returns {{titles:{tmdbId:number, kind:string, title:string}[], honored:boolean|null, more:boolean}}
   */
  function parsePage(answer, kind, page = 1) {
    const wanted = KINDS[kind]?.mediaType ?? 'movie';
    const raw = Array.isArray(answer?.results) ? answer.results : [];
    const typed = raw.filter((r) => r && typeof r.mediaType === 'string' && Number.isInteger(r.id));
    const media = typed.filter((r) => r.mediaType === 'movie' || r.mediaType === 'tv');
    const honored = typed.length === 0 ? null : media.length > 0 && media.every((r) => r.mediaType === wanted) && typed.length === media.length;
    const titles = media.filter((r) => r.mediaType === wanted).map((r) => ({ tmdbId: r.id, kind, title: String((r.mediaType === 'movie' ? r.title : r.name) ?? '') }));
    const total = Number(answer?.totalPages);
    return { titles, honored, more: page < (Number.isFinite(total) ? total : 1) };
  }

  /**
   * Laedt beide Reihen nebeneinander: je Art die erste Seite der Trends und das Verzeichnis der Mediathek (TMDB-Nummer -> Eintrag) gleichzeitig, weitere
   * Seiten nur, solange keine zehn Treffer da sind (hoechstens MAX_PAGES), dann die Eintraege in der Reihenfolge der Trends. Befolgt Seerr Art und Zeitraum
   * nicht (aelteres Seerr), sind es die Trends von heute. Scheitert die erste Seite oder das Verzeichnis, scheitert das Laden (kein Ersatz).
   * @param {{jellyfin:{tmdbIndex(type:string):Promise<Map<number,string>>, itemsInOrder(ids:string[]):Promise<object[]>}, seerr:{rankingPage(kind:string, window:string, page:number):Promise<ReturnType<typeof parsePage>>}, window:string}} o
   */
  async function load({ jellyfin, seerr, window }) {
    const w = normWindow(window);
    const list = async (kind) => {
      const indexRun = jellyfin.tmdbIndex(KINDS[kind].itemType);
      indexRun.catch(() => {}); // scheitert die erste Seite zuerst, bleibt der Fehler des Verzeichnisses nicht unbehandelt
      const first = await seerr.rankingPage(kind, w, 1);
      let ranking = first.titles;
      let more = first.more;
      const index = await indexRun;
      if (!index.size) return { items: [], honored: first.honored };
      for (let page = 2; match(ranking, kind, index).length < LIMIT && page <= MAX_PAGES && more; page++) {
        let next;
        try {
          next = await seerr.rankingPage(kind, w, page);
        } catch {
          break; // eine spaetere Seite scheitert: es bleibt bei dem, was da ist
        }
        if (!next.titles.length) break;
        ranking = ranking.concat(next.titles);
        more = next.more;
      }
      return { items: await jellyfin.itemsInOrder(match(ranking, kind, index)), honored: first.honored };
    };
    const [m, s] = await Promise.all([list('movies'), list('series')]);
    // Nur wenn beide Listen allein die verlangte Art enthalten, befolgt der Server die Angaben (eine gemischte Liste kann zufaellig nur Filme haben)
    const honors = m.honored !== false && s.honored !== false;
    return { window: honors ? w : 'day', movies: m.items, series: s.items, honors };
  }

  /**
   * Der Zwischenspeicher der Rangfolge (im Hauptprozess, je laufender App): get(key, ...) laedt, wenn noetig. Ein anderer Schluessel (Server, Profil, Seerr,
   * Zeitraum) verwirft das Vorige sofort; eine Antwort, die danach noch eintrifft, wird verworfen (Code RANKINGS_STALE). Innerhalb von LIFETIME_MS kommt die
   * Rangfolge aus dem Speicher, die Eintraege selbst (Gesehen, gemerkte Stelle, geloescht) werden aber frisch geholt; force laedt alles neu. Scheitert ein
   * Laden, bleibt eine schon geladene Liste stehen (mit failure). Zwei gleichzeitige Wuensche fuer denselben Schluessel teilen sich ein Laden.
   */
  function createStore({ now = () => Date.now() } = {}) {
    let key = null;
    let epoch = 0;
    let entry = null; // { window, honors, loadedAt, movies, series }
    let failure = null;
    let running = null;
    let honorsSeen = null; // befolgt das Seerr Art und Zeitraum? (letzte Antwort, fuer die Einstellungen)
    const stale = () => Object.assign(new Error('Die Rangliste gehoert zu einem vorigen Profil'), { code: 'RANKINGS_STALE' });
    const publicOf = (e, extra = {}) => ({ available: true, window: e.window, honors: e.honors, loadedAt: e.loadedAt, movies: e.movies, series: e.series, ...extra });

    function switchTo(k) {
      if (k === key) return;
      key = k;
      epoch++;
      entry = null;
      failure = null;
      running = null;
    }

    return {
      /**
       * @param {string|null} k Schluessel (cacheKey); null: keine Quelle (ohne Seerr), alles vergessen
       * @param {{force?:boolean, full:() => Promise<{window:string, honors:boolean, movies:object[], series:object[]}>, items:(ids:string[]) => Promise<object[]>}} o
       */
      get(k, { force = false, full, items }) {
        if (k == null) {
          switchTo(null);
          return Promise.resolve({ available: false });
        }
        switchTo(k);
        if (running) return running; // laeuft schon ein Laden fuer dieselbe Anfrage, geschieht nichts (auch erzwungen nicht: zwei Laeufe ueberholten sich sonst)
        const mine = epoch;
        const cached = !force && entry && now() - entry.loadedAt < LIFETIME_MS ? entry : null;
        const run = (async () => {
          try {
            let next;
            if (cached) {
              const [movies, series] = await Promise.all([items(cached.movies.map((i) => i.Id)), items(cached.series.map((i) => i.Id))]);
              next = { ...cached, movies, series };
            } else {
              const r = await full();
              next = { window: r.window, honors: r.honors, loadedAt: now(), movies: r.movies, series: r.series };
            }
            if (mine !== epoch) throw stale();
            entry = next;
            failure = null;
            if (typeof next.honors === 'boolean') honorsSeen = next.honors;
            return publicOf(next);
          } catch (e) {
            if (mine !== epoch || e?.code === 'RANKINGS_STALE') throw stale();
            failure = e?.message || String(e);
            if (entry) return publicOf(entry, { failure }); // besser die Liste von vorhin als keine
            throw e;
          } finally {
            if (running === run) running = null;
          }
        })();
        running = run;
        return run;
      },
      /** Was gerade gilt (Einstellungen > Startseite > Top 10), ohne zu laden. */
      status(k) {
        const same = k != null && k === key;
        return {
          available: k != null,
          honors: honorsSeen,
          loading: same && !!running && !entry,
          failure: same ? failure : null,
          result: same && entry ? { window: entry.window, movies: entry.movies.length, series: entry.series.length } : null
        };
      },
      /** Alles vergessen (Abmelden, Seerr getrennt). */
      reset() {
        switchTo(null);
        honorsSeen = null;
      }
    };
  }

  // ---------- Masse der Karten (aus der Plakatbreite der Reihen; Apple: TopTenMetrics) ----------
  /**
   * Plakat 1,12 x so breit wie in den uebrigen Reihen, Ziffer 1,2 x Plakathoehe (sichtbar rund fuenf Sechstel des Plakats), das Plakat schiebt sich um
   * 13 % der Schriftgroesse ueber sie; die Grundlinie der Ziffer liegt auf der Unterkante des Plakats. Rand 1 %, Schein 2,2 % und 6 % der Schriftgroesse.
   */
  function metrics(baseWidth) {
    const posterW = Math.round(baseWidth * 1.12);
    const posterH = Math.round(posterW * 1.5);
    const size = Math.round(posterH * 1.2);
    const overlap = Math.round(size * 0.13);
    const numeralWidth = (rank) => Math.round(size * (rank >= 10 ? 0.74 : 0.43));
    const bloomRadius = size * 0.06;
    const haloLift = size * 0.35;
    return {
      posterW, posterH, size, overlap, numeralWidth,
      cardWidth: (rank) => numeralWidth(rank) - overlap + posterW,
      tracking: (rank) => (rank >= 10 ? -size * 0.02 : 0),
      rim: size * 0.01,
      glowRadius: size * 0.022,
      bloomRadius,
      bleed: Math.ceil(bloomRadius * 2.5),
      haloLift,
      haloSize: (rank) => ({ width: numeralWidth(rank) + posterW * 1.5, height: 2 * (posterH - haloLift) })
    };
  }

  // ---------- Texte ----------
  const phrase = (window, lang) => (normWindow(window) === 'day' ? words(lang).dayPhrase : words(lang).weekPhrase);
  /** "Im Trend diese Woche · aus deiner Mediathek · Quelle Seerr". */
  const caption = (window, lang = 'de') => fill(words(lang).caption, { w: phrase(window, lang) });
  const windowTitle = (window, lang = 'de') => (normWindow(window) === 'day' ? words(lang).day : words(lang).week);
  /** "Seerr · diese Woche · 10 Filme, 4 Serien": was die Reihen gerade zeigen. */
  function currentLine({ connected, result, loading, failure }, lang = 'de') {
    const w = words(lang);
    if (!connected) return w.notConnected;
    if (result) return fill(w.current, { w: phrase(result.window, lang), m: result.movies, mw: result.movies === 1 ? w.movie : w.movies, s: result.series, sw: result.series === 1 ? w.serie : w.series });
    if (loading) return w.loading;
    if (failure) return w.unreachable;
    return 'Seerr';
  }
  function footer({ connected, honors }, lang = 'de') {
    const w = words(lang);
    let text = w.footer;
    if (!connected) text += w.footerNoSeerr;
    if (connected && honors === false) text += w.footerDayOnly;
    return text + w.footerStats;
  }
  /** "2024 · Science-Fiction": Jahr und erstes Genre unter dem Titel einer Karte, soweit vorhanden. */
  const detailLine = (item) => [item?.ProductionYear, Array.isArray(item?.Genres) ? item.Genres[0] : null].filter(Boolean).join(' · ');

  return { LIMIT, MAX_PAGES, LIFETIME_MS, KINDS, normWindow, windows, match, cacheKey, parsePage, load, createStore, metrics, caption, windowTitle, currentLine, footer, detailLine };
});
