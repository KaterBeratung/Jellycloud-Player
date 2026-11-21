/* Gemeinsames Modul: Schreibweisen der Angabenzeilen (Laufzeit, Uhrzeit, Staffeln, Bewertung, Folgen, Art eines Eintrags). Eine Stelle fuer
   alle Ansichten: vorher schrieben Banner, Detailseite und Seerr-Fenster Staffeln, Bewertung und Laufzeit je selbst (das Seerr-Fenster zeigte
   "148 Min.", die Detailseite "2 Std. 28 Min."). Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCFormat).
   Vorlage: Jellycloud/Design/Format.swift der Apple-App (Build 91). Sprache: 'de' (Standard) oder 'en'. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORDS = {
    // season/seasons: vor Nummern ("Staffel 3", "Season 3"); one/many: nach einer Anzahl ("1 Staffel", "3 seasons")
    de: { h: 'Std.', min: 'Min.', season: 'Staffel', seasons: 'Staffeln', one: 'Staffel', many: 'Staffeln', kinds: { Movie: 'Film', Series: 'Serie', Episode: 'Folge', Season: 'Staffel', BoxSet: 'Kollektion' } },
    en: { h: 'h', min: 'min', season: 'Season', seasons: 'Seasons', one: 'season', many: 'seasons', kinds: { Movie: 'Movie', Series: 'Show', Episode: 'Episode', Season: 'Season', BoxSet: 'Collection' } }
  };
  const words = (lang) => WORDS[String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de'];
  const int = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

  /** "1:05" bzw. "1:02:05" (Zeitanzeige im Player und auf dem Fortsetzen-Knopf). */
  function clock(sec) {
    const t = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  /**
   * Laufzeit: unter einer Stunde in Minuten ("45 Min."), sonst Stunden und Minuten ("2 Std. 10 Min."); volle Stunden ohne "0 Min." ("2 Std.",
   * hier bewusst ruhiger als die Apple-App). null ohne Laufzeit (0, fehlt, keine Zahl).
   */
  function runtime(seconds, lang) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return null;
    const w = words(lang);
    const minutes = Math.max(1, Math.round(s / 60));
    if (minutes < 60) return `${minutes} ${w.min}`;
    const rest = minutes % 60;
    return rest ? `${Math.floor(minutes / 60)} ${w.h} ${rest} ${w.min}` : `${Math.floor(minutes / 60)} ${w.h}`;
  }

  /** "1 Staffel" bzw. "3 Staffeln" (Angabenzeilen von Banner, Detailseite und Seerr-Fenster). */
  function seasonCount(n, lang) {
    const c = int(n);
    if (c === null || c < 1) return '';
    const w = words(lang);
    return `${c} ${c === 1 ? w.one : w.many}`;
  }

  /**
   * Angefragte Staffeln: "Staffel 3", "Staffeln 1, 2", "Staffeln 1–20", "Staffeln 1–3, 5, 7–9". Drei und mehr aufeinanderfolgende als
   * Bereich (bei 20 Staffeln stand sonst "Staffeln 1, 2, 3, 4, …" und der Rest war abgeschnitten). Doppelte und Unsinn fallen weg.
   */
  function seasonList(numbers, lang) {
    const w = words(lang);
    const sorted = [...new Set((Array.isArray(numbers) ? numbers : []).map(int).filter((n) => n !== null && n >= 0))].sort((a, b) => a - b);
    if (!sorted.length) return '';
    if (sorted.length === 1) return `${w.season} ${sorted[0]}`;
    const parts = [];
    let start = sorted[0];
    let last = sorted[0];
    const close = () => {
      if (last - start >= 2) parts.push(`${start}–${last}`);
      else for (let n = start; n <= last; n++) parts.push(String(n));
    };
    for (const n of sorted.slice(1)) {
      if (n === last + 1) last = n;
      else {
        close();
        start = n;
        last = n;
      }
    }
    close();
    return `${w.seasons} ${parts.join(', ')}`;
  }

  /** Bewertung als Zahl mit einer Nachkommastelle ("8.1"); '' ohne Bewertung. */
  function score(value) {
    const v = Number(value);
    return value === null || value === undefined || !Number.isFinite(v) || v <= 0 ? '' : v.toFixed(1);
  }

  /** "★ 8.1" (Bewertung in reinen Textzeilen; mit Symbol daneben reicht score). */
  const rating = (value) => (score(value) ? `★ ${score(value)}` : '');

  /** "S1 · E3" ohne den Namen der Folge (ParentIndexNumber, IndexNumber von Jellyfin; was fehlt, entfaellt samt Trennzeichen). */
  function episodeNumbers(item) {
    const s = int(item && item.ParentIndexNumber);
    const e = int(item && item.IndexNumber);
    return [s !== null ? `S${s}` : '', e !== null ? `E${e}` : ''].filter(Boolean).join(' · ');
  }

  /** "S2 · E5 · Titel" fuer Folgen. */
  function episodeLabel(item) {
    return [episodeNumbers(item), (item && typeof item.Name === 'string' && item.Name) || ''].filter(Boolean).join(' · ');
  }

  /** Art des Eintrags in einem Wort, fuer Zeilen wie "Film · Animation · Abenteuer" (unbekannt: Film). */
  function kindName(type, lang) {
    const k = words(lang).kinds;
    return k[type] || k.Movie;
  }

  return { clock, runtime, seasonCount, seasonList, score, rating, episodeNumbers, episodeLabel, kindName };
});
