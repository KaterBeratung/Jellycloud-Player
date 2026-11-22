/* Gemeinsames Modul: der Informationsblock auf der Seite eines Seerr-Titels (Allgemein, Bewertungen, Produktion) mit Beschriftungen und Schreibweisen,
   dazu die Freigabe fuer das Land des Geraets und die Angabenzeile. Nur, was Seerr nennt; nichts wird ergaenzt. Laeuft als CommonJS (Tests) und als
   klassisches Skript (window.JCSeerrFacts). Vorlage: Jellycloud/Core/SeerrFacts.swift und Features/Seerr/SeerrInformation.swift der Apple-App (Build 92).
   Sprache: 'de' (Standard) oder 'en'; Datum, Zahlen, Laender und Sprachen in der Schreibweise der Sprache (Intl). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./format'));
  else root.JCSeerrFacts = factory(root.JCFormat);
})(typeof self !== 'undefined' ? self : this, function (Format) {
  'use strict';

  const WORDS = {
    de: {
      general: 'Allgemein', ratings: 'Bewertungen', production: 'Produktion',
      original: 'Originaltitel', genre: 'Genre', released: 'Erschienen', firstAired: 'Erstausstrahlung', lastAired: 'Zuletzt ausgestrahlt', nextEpisode: 'Nächste Folge',
      runtime: 'Laufzeit', runtimeEp: 'Laufzeit je Folge', extent: 'Umfang', certification: 'Freigabe',
      status: 'Status', networks: 'Sender', studios: 'Studio', countries: 'Land', language: 'Originalsprache',
      vote: 'Stimme', votes: 'Stimmen', episode: 'Folge', episodes: 'Folgen',
      states: { 'Returning Series': 'Wird fortgesetzt', Ended: 'Abgeschlossen', CanceledMovie: 'Abgesagt', Canceled: 'Abgesetzt', 'In Production': 'In Produktion', 'Post Production': 'In Nachbearbeitung', Planned: 'Geplant', Pilot: 'Pilot' }
    },
    en: {
      general: 'General', ratings: 'Ratings', production: 'Production',
      original: 'Original title', genre: 'Genre', released: 'Released', firstAired: 'First aired', lastAired: 'Last aired', nextEpisode: 'Next episode',
      runtime: 'Runtime', runtimeEp: 'Runtime per episode', extent: 'Extent', certification: 'Rating',
      status: 'Status', networks: 'Network', studios: 'Studio', countries: 'Country', language: 'Original language',
      vote: 'vote', votes: 'votes', episode: 'episode', episodes: 'episodes',
      states: { 'Returning Series': 'Returning', Ended: 'Ended', CanceledMovie: 'Canceled', Canceled: 'Canceled', 'In Production': 'In production', 'Post Production': 'Post production', Planned: 'Planned', Pilot: 'Pilot' }
    }
  };
  const langOf = (lang) => (String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de');
  const localeOf = (lang) => (langOf(lang) === 'en' ? 'en-US' : 'de-DE');

  /**
   * Freigabe fuer das Land des Geraets; ohne Angabe dort die der USA, unveraendert. In Deutschland nennt TMDB nur die Zahl: "FSK 12". null ohne Angabe.
   * @param {{certifications?: Object<string,string>}} facts
   */
  function certification(facts, region) {
    const all = facts?.certifications ?? {};
    const r = String(region ?? '').toUpperCase();
    const own = all[r];
    if (own) return r === 'DE' && /^\d+$/.test(own) ? `FSK ${own}` : own;
    return all.US || null;
  }

  /** Stand der Produktion in der Sprache der Oberflaeche. Ein erschienener Film bekommt keine Zeile (das Datum sagt es); Unbekanntes bleibt, wie Seerr es nennt. */
  function statusLabel(status, movie, lang) {
    if (!status) return null;
    if (movie && (status === 'Released' || status === 'Rumored')) return null;
    const states = WORDS[langOf(lang)].states;
    if (status === 'Canceled') return movie ? states.CanceledMovie : states.Canceled;
    return states[status] ?? status;
  }

  /** Ein Tag ohne Uhrzeit ("2026-01-09") in der Schreibweise der Sprache ("9. Januar 2026"); mittags, damit das Datum in jeder Zeitzone stimmt. */
  function day(text, lang) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text ?? '');
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }

  const number = (n, lang) => new Intl.NumberFormat(localeOf(lang)).format(n);
  const score = (value, votes, lang) => {
    const w = WORDS[langOf(lang)];
    const s = new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
    return votes ? `${s} (${number(votes, lang)} ${votes === 1 ? w.vote : w.votes})` : s;
  };
  const displayName = (code, type, lang) => {
    try {
      const name = new Intl.DisplayNames([localeOf(lang)], { type }).of(code);
      return name && name !== code ? name : null;
    } catch {
      return null;
    }
  };

  /**
   * Die Gruppen des Informationsblocks; leere Zeilen und Gruppen entfallen.
   * @param {object} d Angaben eines Titels (seerr.js normalizeDetails)
   * @param {{imdb?: {score:number, votes:number|null}|null, lang?: string, region?: string}} o
   * @returns {{title:string, rows:{label:string, value:string}[]}[]}
   */
  function informationGroups(d, { imdb = null, lang = 'de', region = '' } = {}) {
    const w = WORDS[langOf(lang)];
    const movie = d.mediaType === 'movie';
    const f = d.facts ?? {};
    const runtime = d.runtime ? Format.runtime(d.runtime * 60, lang) : null; // Seerr nennt Minuten
    const general = [];
    const add = (list, label, value) => value && list.push({ label, value });
    add(general, w.original, f.originalTitle);
    add(general, w.genre, (d.genres ?? []).slice(0, 3).join(', '));
    add(general, movie ? w.released : w.firstAired, day(f.released, lang));
    add(general, w.lastAired, day(f.lastAired, lang));
    add(general, w.nextEpisode, day(f.nextEpisode, lang));
    if (movie) add(general, w.runtime, runtime);
    else {
      const extent = [d.seasons ? Format.seasonCount(d.seasons, lang) : '', f.episodes ? `${number(f.episodes, lang)} ${f.episodes === 1 ? w.episode : w.episodes}` : ''].filter(Boolean);
      add(general, w.extent, extent.join(' · '));
      add(general, w.runtimeEp, runtime);
    }
    add(general, w.certification, certification(f, region));

    const ratings = [];
    if (d.rating) add(ratings, 'TMDB', score(d.rating, f.votes, lang));
    if (imdb?.score) add(ratings, 'IMDb', score(imdb.score, imdb.votes, lang));

    const production = [];
    add(production, w.status, statusLabel(f.productionStatus, movie, lang));
    add(production, w.networks, (f.networks ?? []).join(', '));
    add(production, w.studios, (f.studios ?? []).join(', '));
    add(production, w.countries, (f.countries ?? []).slice(0, 3).map((c) => displayName(c, 'region', lang)).filter(Boolean).join(', '));
    add(production, w.language, f.originalLanguage ? displayName(f.originalLanguage, 'language', lang) : null);

    return [
      { title: w.general, rows: general },
      { title: w.ratings, rows: ratings },
      { title: w.production, rows: production }
    ].filter((g) => g.rows.length);
  }

  /** Angabenzeile unter dem Titel: Jahr, Freigabe, Laufzeit, Staffeln, Bewertung (Schreibweisen der Detailseite, format.js). */
  function metaParts(d, { lang = 'de', region = '' } = {}) {
    return [d.year ? String(d.year) : null, certification(d.facts, region), d.runtime ? Format.runtime(d.runtime * 60, lang) : null, d.seasons ? Format.seasonCount(d.seasons, lang) : null].filter(Boolean);
  }

  return { certification, statusLabel, informationGroups, metaParts, day };
});
