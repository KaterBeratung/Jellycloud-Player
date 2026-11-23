/* Gemeinsames Modul: mit welcher Staffel eine Serie beginnt. Die Seite der Serie (welche Staffel sie zuerst zeigt) und "Abspielen" ohne naechste
   Folge (Karten, Banner, Kontextmenue: actions.js resolveSeriesTarget) fragen dieselbe Regel; vorher sprang die Seite bei einer Staffel ohne Nummer
   auf die Extras, und "Abspielen" uebersprang sie. Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCSeasonChoice).
   Vorlage: Jellycloud/Core/SeasonChoice.swift der Apple-App (Build 92). Staffeln und Folgen in der Form von Jellyfin (IndexNumber, ParentIndexNumber, SeasonId). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCSeasonChoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const listOf = (seasons) => (Array.isArray(seasons) ? seasons.filter((s) => s && typeof s === 'object') : []);

  /** Die erste richtige Staffel (Nummer ueber 0; eine Staffel ohne Nummer gilt als richtig), nicht die Extras. Gibt es nur Extras, diese; ohne Staffeln null. */
  function first(seasons) {
    const list = listOf(seasons);
    return list.find((s) => (num(s.IndexNumber) ?? 1) > 0) ?? list[0] ?? null;
  }

  /**
   * Die Staffel beim Oeffnen der Serienseite: die der naechsten Folge, aber nur, wenn sie zu dieser Serie gehoert (nach Id, sonst nach Nummer; eine
   * fremde Staffel ergaebe eine leere Folgenliste), sonst first.
   */
  function initial(seasons, nextUp) {
    const list = listOf(seasons);
    if (nextUp && typeof nextUp === 'object') {
      const byId = nextUp.SeasonId ? list.find((s) => s.Id === nextUp.SeasonId) : null;
      if (byId) return byId;
      const n = num(nextUp.ParentIndexNumber);
      const byNumber = n === null ? null : list.find((s) => num(s.IndexNumber) === n);
      if (byNumber) return byNumber;
    }
    return first(list);
  }

  const ask = (fn) => Promise.resolve().then(fn).catch(() => null);

  /**
   * Was "Abspielen" einer Serie startet (Karten, Banner, Kontextmenue, Seite eines Seerr-Titels; wie JellyfinClient.playTarget der Apple-App): die naechste
   * Folge, sonst die erste Folge der ersten richtigen Staffel (first, nicht die Extras). client: getNextUp(limit, serie), getSeasons(serie),
   * getEpisodes(serie, staffel) von Jellyfin (im Hauptprozess JellyfinClient, in der Oberflaeche api.js). Ergebnis { episode, resume }; resume: an der
   * gemerkten Stelle beginnen (die naechste Folge), episode null, wenn es nichts abzuspielen gibt. Fehler zaehlen wie leere Antworten.
   */
  async function seriesTarget(client, seriesId) {
    const next = await ask(() => client.getNextUp(1, seriesId));
    if (Array.isArray(next) && next[0]) return { episode: next[0], resume: true };
    const season = first(await ask(() => client.getSeasons(seriesId)));
    const episodes = season ? await ask(() => client.getEpisodes(seriesId, season.Id)) : null;
    return { episode: (Array.isArray(episodes) && episodes[0]) || null, resume: false };
  }

  return { first, initial, seriesTarget };
});
