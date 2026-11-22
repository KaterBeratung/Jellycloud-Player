/* Gemeinsames Modul: die Hauptnavigation (wie die Apple-App, Features/Shell/MainTab.swift) und welche Bibliotheken des Servers in die Reiter
   "Filme" und "Serien" gehoeren (Features/Library/LibraryView.swift, LibraryTab.own). Die einzige Stelle fuer beides: Kopfzeile am Desktop,
   Tab-Leiste in der kompakten Ansicht, Tastenkuerzel Strg+1 bis Strg+5 und die Seiten der Reiter lesen von hier.
   Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCNav). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCNav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Die fuenf Reiter in ihrer Reihenfolge: Start, Filme, Serien, Anfragen, Suche. Immer alle fuenf, auch ohne Seerr: die Leiste aendert ihre
   * Breite nicht beim Einrichten, Entfernen oder Ausfall von Seerr (ohne Seerr zeigt "Anfragen" den Hinweis zum Verbinden). Die Einstellungen
   * sind kein Reiter (Profilmenue, am Desktop auch das Zahnrad). glow: Bereich des Ambient Glow der Seite des Reiters.
   */
  const TABS = Object.freeze(
    [
      { key: 'home', path: '/home', label: 'nav.home', icon: 'home', glow: 'home' },
      { key: 'movies', path: '/movies', label: 'nav.movies', icon: 'film', glow: 'movies' },
      { key: 'shows', path: '/shows', label: 'nav.shows', icon: 'tv', glow: 'series' },
      { key: 'requests', path: '/requests', label: 'nav.requests', icon: 'tray', glow: 'requests' },
      { key: 'search', path: '/search', label: 'nav.search', icon: 'search', glow: 'search' }
    ].map(Object.freeze)
  );

  /** Reiter zu Strg+1 bis Strg+5 (Ziffer als Text); sonst null. */
  const tabForDigit = (digit) => TABS[Number(digit) - 1] ?? null;

  /**
   * Die Bibliotheken des Servers, die in den Reiter gehoeren (tab "movies" oder "shows"), in der Reihenfolge der Auswahl:
   * - wie die Apple-App: Bibliotheken der Art, gemischte ("mixed") in beiden, solche ohne Art bei den Filmen, Kollektionen ("boxsets")
   *   zuletzt unter Filme (der Reiter oeffnet weiter mit den Filmen);
   * - Windows und Android behalten Heimvideos und Musikvideos (E6): sie stehen unter Filme vor den Kollektionen, sonst waeren sie nur noch
   *   ueber die Startseite zu erreichen.
   * @param {{Id:string, CollectionType?:string|null}[]} views
   */
  function ownLibraries(views, tab) {
    const all = Array.isArray(views) ? views.filter((v) => v && typeof v.Id === 'string') : [];
    const type = (v) => (typeof v.CollectionType === 'string' && v.CollectionType ? v.CollectionType : null);
    if (tab === 'shows') return all.filter((v) => type(v) === 'tvshows' || type(v) === 'mixed');
    if (tab !== 'movies') return [];
    const own = all.filter((v) => type(v) === 'movies' || type(v) === null || type(v) === 'mixed');
    const extra = all.filter((v) => type(v) === 'homevideos' || type(v) === 'musicvideos');
    return [...own, ...extra, ...all.filter((v) => type(v) === 'boxsets')];
  }

  /** Die gewaehlte Bibliothek eines Reiters: die gemerkte, wenn es sie noch gibt, sonst die erste. */
  function pickLibrary(own, remembered) {
    return own.find((v) => v.Id === remembered) ?? own[0] ?? null;
  }

  return { TABS, tabForDigit, ownLibraries, pickLibrary };
});
