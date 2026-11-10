/* Gemeinsames Modul: Anpassung der Startseite (Banner und Reihen).
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCHomeRows) in der Oberflaeche.

   Reihen haben Kennungen: "latest:<Bibliotheks-Id>" (Neu in ...), "continue" (Weiterschauen), "nextUp" (Als Naechstes), "favorites", "trending" (Filme im Trend, Seerr).
   Gespeichert werden nur die Wuensche des Nutzers: "order" (Reihenfolge) und "hidden" (ausgeblendet). Was dort nicht steht (neue Bibliothek, neue Reihe),
   kommt in der Standardreihenfolge dahinter und ist sichtbar. Unbekannte Eintraege in den Listen schaden nicht (eine geloeschte Bibliothek bleibt einfach ohne Wirkung). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCHomeRows = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { heroSlides: [3, 10], heroTrend: [0, 4] };
  const MAX_LIST = 100;

  /** Standardwerte (stehen auch in den Einstellungen, config.js). */
  const DEFAULTS = {
    hero: true, // Banner oben auf der Startseite
    heroSlides: 6, // Folien im Banner
    heroTrend: 2, // davon bis zu so viele gut bewertete Trend-Filme (Seerr); 0 = keine
    order: [], // gewuenschte Reihenfolge der Reihen (Kennungen)
    hidden: [] // ausgeblendete Reihen (Kennungen)
  };

  const STATIC_ROWS = ['continue', 'nextUp', 'favorites', 'trending'];
  /** Reihen, die in der Standardreihenfolge GANZ OBEN stehen (vor den Neuzugaengen): wer etwas angefangen hat, will zuerst dort weitermachen. */
  const TOP_ROWS = ['continue'];

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
      heroTrend: clampInt(r.heroTrend, LIMITS.heroTrend[0], LIMITS.heroTrend[1], DEFAULTS.heroTrend),
      order: cleanList(r.order),
      hidden: cleanList(r.hidden)
    };
  }

  /** Standardreihenfolge der vorhandenen Reihen: Weiterschauen ganz oben, dann die Neuzugaenge je Bibliothek (in Bibliotheksreihenfolge), dann die uebrigen festen Reihen. */
  function defaultOrder(libraryIds) {
    return [...TOP_ROWS, ...libraryIds.map((id) => `latest:${id}`), ...STATIC_ROWS.filter((id) => !TOP_ROWS.includes(id))];
  }

  /**
   * Alle vorhandenen Reihen in der Reihenfolge des Nutzers (auch die ausgeblendeten): zuerst seine Reihenfolge (nur was es gibt), dann der Rest wie vorgegeben.
   * @param {string[]} present vorhandene Kennungen in Standardreihenfolge
   */
  function arrangeAll(present, order) {
    const have = new Set(present);
    const out = [];
    for (const id of cleanList(order)) if (have.has(id) && !out.includes(id)) out.push(id);
    for (const id of present) if (!out.includes(id)) out.push(id);
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

  return { LIMITS, DEFAULTS, STATIC_ROWS, TOP_ROWS, homeConfig, defaultOrder, arrangeAll, arrangeRows, moveRow };
});
