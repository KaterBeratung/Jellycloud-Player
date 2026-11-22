/* Gemeinsames Modul: was die Suche zeigt, solange keine Treffer dastehen, und welche Treffer von Seerr unter den Treffern der Mediathek stehen. Laeuft als
   CommonJS (Tests) und als klassisches Skript (window.JCSearchStatus). Vorlage: Features/Search/SearchStatus.swift und SearchView.swift der Apple-App
   (Build 91/92); Regeln in Notizen/seerr-integration.md ("Suche"). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seerr-state'));
  else root.JCSearchStatus = factory(root.JCSeerrState);
})(typeof self !== 'undefined' ? self : this, function (SeerrState) {
  'use strict';

  /** So lange ruht die Eingabe, bevor gesucht wird (wie die Apple-App). */
  const QUIET_MS = 350;

  /**
   * Der Hinweis der Seite ohne Treffer, an einer Stelle entschieden: leeres Feld -> 'prompt'; die Suche nach genau diesem Text laeuft oder steht noch aus
   * -> 'loading'; sonst der Fehler ('failed') oder 'noResults'. "Keine Ergebnisse" und ein Fehler gelten nur fuer den beantworteten Text (answered: der Text
   * der letzten abgeschlossenen Suche, null: noch keine); waehrend der Eingabe, bevor die Suche beginnt, hiess es sonst "Keine Ergebnisse" zu einem Text,
   * nach dem noch gar nicht gesucht worden war.
   * @param {{term:string, answered:string|null, searching:boolean, error:string|null}} o term ohne Leerraum am Rand
   * @returns {{kind:'prompt'}|{kind:'loading'}|{kind:'failed', message:string}|{kind:'noResults', term:string}}
   */
  function resolve({ term = '', answered = null, searching = false, error = null } = {}) {
    if (!term) return { kind: 'prompt' };
    if (searching || answered !== term) return { kind: 'loading' };
    if (error) return { kind: 'failed', message: String(error) };
    return { kind: 'noResults', term };
  }

  /** "Art-Nummer" eines Titels der Mediathek fuer den Abgleich (nur Filme und Serien mit TMDB-Nummer), sonst null. */
  function libraryKey(item) {
    const kind = item?.Type === 'Movie' ? 'movie' : item?.Type === 'Series' ? 'tv' : null;
    const tmdb = Object.entries(item?.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === 'tmdb')?.[1];
    return kind && /^\d{1,9}$/.test(String(tmdb ?? '')) ? `${kind}-${Number(tmdb)}` : null;
  }

  /**
   * Treffer von Seerr, die nicht (ganz) in der Mediathek sind: ohne die, die Seerr als vorhanden kennt, und ohne die, die schon unter den Treffern der Mediathek
   * stehen (gleiche TMDB-Nummer und Art; nie ueber den Titel). Teilweise vorhandene Serien bleiben, sie lassen sich weiter anfragen.
   * @param {{mediaType:'movie'|'tv', id:number, status:number}[]} seerrResults
   * @param {object[]} libraryItems Treffer der Mediathek (mit ProviderIds)
   */
  function requestable(seerrResults, libraryItems) {
    const owned = new Set((Array.isArray(libraryItems) ? libraryItems : []).map(libraryKey).filter(Boolean));
    const M = SeerrState.SEERR_MEDIA;
    return (Array.isArray(seerrResults) ? seerrResults : []).filter((r) => r && r.status !== M.AVAILABLE && (r.status === M.PARTIALLY_AVAILABLE || !owned.has(`${r.mediaType}-${r.id}`)));
  }

  return { QUIET_MS, resolve, requestable, libraryKey };
});
