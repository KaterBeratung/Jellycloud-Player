/* Gemeinsames Modul: Regeln des Players wie in der Apple-App (Plan P22, Entscheidung E10 "Wie Apple, ueberall"; dort PlayerModel+Monitoring,
   PlayerModel+Controls und die Einstellungen "Ueberspringen" und "Standardbild"). Ohne Oberflaeche und ohne Uhr: der Player meldet Zeit und Ereignisse,
   die Regeln sagen, was zu tun ist. Windows (src/main/player.js) nutzt sie direkt; der native Player von Android (PlayerActivity.java) bildet dieselben
   Regeln nach, die Werte (Wartezeiten, Countdown) kommen von hier ueber die Huelle (mobile/host-capacitor.js).
   - Ueber dem Bild steht nur "Intro ueberspringen" (Wunsch des Nutzers); bei "Automatisch" fuellt sich der Knopf, dann springt der Player.
   - Rueckblick und Vorschau: nur "Automatisch" oder "Aus" (uebersprungen mit kurzer Meldung).
   - Abspann bis ans Ende der Folge und es gibt eine naechste: Countdown "Naechste Folge" schon im Abspann (bei "Knopf zeigen" 10 s, bei "Automatisch"
     so lange wie die Wartezeit, mindestens 5 s); sonst am Ende der Folge 5 s.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCPlayerRules). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCPlayerRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Wartezeiten fuer "Automatisch springen" in Sekunden (0 = sofort). */
  const SKIP_DELAYS = [0, 3, 5, 8, 10];
  const DEFAULT_SKIP_DELAY = 5;
  /** Countdown am Ende der Folge. */
  const COUNTDOWN_S = 5;
  /** Countdown, wenn er schon mit dem Abspann beginnt und der Abspann auf "Knopf zeigen" steht. */
  const CREDITS_COUNTDOWN_S = 10;
  /** So lange steht die Meldung "... uebersprungen". */
  const NOTICE_MS = 3000;
  /** Abschnitte, die der Server liefert (Medien-Segmente), und die Einstellung je Art. */
  const SEGMENT_TYPES = ['Intro', 'Outro', 'Recap', 'Preview'];
  const SETTING_KEYS = { Intro: 'skipIntro', Outro: 'skipOutro', Recap: 'skipRecap', Preview: 'skipPreview' };
  /** Erlaubte Werte je Art: Rueckblick und Vorschau haben keinen Knopf (nur Intro bekommt einen), also kein "Knopf zeigen". */
  const SKIP_MODES = { Intro: ['button', 'auto', 'off'], Outro: ['button', 'auto', 'off'], Recap: ['auto', 'off'], Preview: ['auto', 'off'] };
  const DEFAULT_MODES = { Intro: 'button', Outro: 'button', Recap: 'off', Preview: 'off' };

  /** Der Modus einer Abschnittsart nach den Einstellungen: 'button' | 'auto' | 'off'; Unbekanntes faellt auf den Standard der Art. */
  function skipMode(prefs, type) {
    const allowed = SKIP_MODES[type];
    if (!allowed) return 'off';
    const v = prefs?.[SETTING_KEYS[type]];
    return allowed.includes(v) ? v : DEFAULT_MODES[type];
  }

  /** Wartezeit fuer "Automatisch springen" in Sekunden. */
  function skipDelay(prefs) {
    const n = Number(prefs?.skipDelay);
    return SKIP_DELAYS.includes(n) ? n : DEFAULT_SKIP_DELAY;
  }

  /** Steht mindestens eine Art auf "Automatisch"? Nur dann wirkt die Wartezeit (sonst ist ihre Zeile ausgeschaltet, wie in der Apple-App). */
  function skipsAutomatically(prefs) {
    return SEGMENT_TYPES.some((t) => skipMode(prefs, t) === 'auto');
  }

  /** Uebernahme der frueheren Einstellung "Countdown" (0/3/6/10/15 s) in die naechste Wartezeit. */
  function delayFromCountdown(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n)) return DEFAULT_SKIP_DELAY;
    return SKIP_DELAYS.reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best), SKIP_DELAYS[0]);
  }

  /** Der Abschnitt, in dem die Wiedergabe steht (die letzte Sekunde zaehlt nicht mehr dazu), sofern seine Art nicht aus ist. */
  function activeSegment(segments, t, prefs) {
    return (segments ?? []).find((s) => skipMode(prefs, s.type) !== 'off' && t >= s.start && t < s.end - 1) ?? null;
  }

  /**
   * Der Abspann, mit dem der Countdown zur naechsten Folge beginnt: es gibt eine naechste Folge, "Naechste Folge automatisch" ist an, der Abspann ist
   * nicht aus und reicht bis ans Ende (hoechstens 5 s davor). Kommt danach noch eine Szene, bleibt es beim Abspann; der Countdown folgt am Ende.
   */
  function creditsForCountdown({ segments, t, duration, prefs, hasNext, autoplayNext }) {
    if (!hasNext || !autoplayNext || !(duration > 0)) return null;
    return (segments ?? []).find((s) => s.type === 'Outro' && skipMode(prefs, s.type) !== 'off' && t >= s.start && t < s.end && s.end >= duration - 5) ?? null;
  }

  /** Laenge des Countdowns im Abspann: "Automatisch" so lange wie die Wartezeit (mindestens 5 s), "Knopf zeigen" 10 s; nie laenger, als der Abspann noch dauert. */
  function creditsCountdownSeconds({ prefs, t, duration }) {
    const wanted = skipMode(prefs, 'Outro') === 'auto' ? Math.max(COUNTDOWN_S, skipDelay(prefs)) : CREDITS_COUNTDOWN_S;
    const left = Math.floor(duration - t);
    return Math.max(3, Math.min(wanted, Math.max(left, COUNTDOWN_S)));
  }

  const segmentKey = (itemKey, s) => `${itemKey}|${s.type}|${s.start}`;
  const sameSegment = (a, b) => !!a && !!b && a.type === b.type && a.start === b.start && a.end === b.end;

  /**
   * Zustand des Ueberspringens und des Countdowns fuer eine Folge (je Eintrag neu: reset). Der Player ruft tick() bei jeder Zeitmeldung und die
   * Ereignisse (Ende, Pause, Ueberspringen, Schliessen des Countdowns); zurueck kommt, was zu tun ist. Den Countdown selbst zaehlt der Player (Wanduhr)
   * und meldet sein Ende mit countdownFinished().
   */
  function createSkipEngine() {
    let itemKey = '';
    let autoSkipped = new Set();
    let timer = null; // { key, start, duration } in Spielzeit: Pause haelt ihn an
    let countdown = null; // { seconds, inCredits }
    let creditsDismissed = false;

    function startCountdown(seconds, inCredits) {
      countdown = { seconds, inCredits };
      return { action: 'start', seconds, inCredits };
    }

    return {
      /** Neue Folge oder neuer Eintrag: nichts Gemerktes gilt mehr. */
      reset(key) {
        itemKey = String(key ?? '');
        autoSkipped = new Set();
        timer = null;
        countdown = null;
        creditsDismissed = false;
      },
      get countdown() {
        return countdown ? { ...countdown } : null;
      },
      /** Derselbe Eintrag wird neu geladen (Spur, Qualitaet): ein laufender Countdown verschwindet, ohne als ausgeblendet zu gelten. */
      dropCountdown() {
        countdown = null;
      },

      /**
       * Eine Zeitmeldung. ctx: { t, duration, segments, prefs, hasNext, autoplayNext, paused (vom Nutzer angehalten), reachedEnd }.
       * Ergebnis: { segment (aktiver Abschnitt), button (Art, die einen Knopf bekommt: nur 'Intro', und nicht waehrend des Countdowns),
       * timer ({ start, duration } beim automatischen Springen: daraus fuellt sich der Knopf), skip ({ to, type }: springen und melden),
       * countdown ({ action: 'start', seconds, inCredits } | { action: 'hide' } | null) }.
       */
      tick(ctx) {
        const { t, duration, segments, prefs } = ctx;
        let seg = activeSegment(segments, t, prefs);
        let skip = null;
        let cd = null;
        // Abspann bis zum Ende: statt des Timers zum Ueberspringen laeuft der Countdown zur naechsten Folge
        const credits = creditsForCountdown(ctx);
        if (credits) {
          if (!countdown && !creditsDismissed && !ctx.paused && !ctx.reachedEnd) cd = startCountdown(creditsCountdownSeconds({ prefs, t, duration }), true);
        } else if (countdown?.inCredits && !ctx.reachedEnd) {
          countdown = null; // zurueckgesprungen: der Countdown gehoert zum Abspann
          cd = { action: 'hide' };
        }
        if (seg && skipMode(prefs, seg.type) === 'auto' && !sameSegment(seg, credits)) {
          const key = segmentKey(itemKey, seg);
          // einmal je Abschnitt: wer zurueckspringt, bekommt danach nur den Knopf (Intro) ohne Timer
          if (!autoSkipped.has(key)) {
            if (timer?.key !== key) timer = { key, start: t, duration: Math.min(skipDelay(prefs), Math.max(0.5, seg.end - 1 - t)) };
            const p = timer.duration <= 0 ? 1 : Math.min(1, Math.max(0, (t - timer.start) / timer.duration));
            if (p >= 1) {
              autoSkipped.add(key);
              timer = null;
              skip = { to: seg.end, type: seg.type };
              seg = null;
            }
          }
        } else {
          timer = null;
        }
        const button = seg && seg.type === 'Intro' && !countdown ? 'Intro' : null;
        return { segment: seg, button, timer: button && timer ? { start: timer.start, duration: timer.duration } : null, skip, countdown: cd };
      },

      /** "Ueberspringen" (Knopf oder Taste): im Abspann mit laufendem Countdown die naechste Folge, sonst ans Ende des Abschnitts. */
      skipPressed(ctx) {
        const seg = activeSegment(ctx.segments, ctx.t, ctx.prefs);
        if (!seg) return null;
        if (countdown?.inCredits && sameSegment(seg, creditsForCountdown(ctx))) return { next: true };
        autoSkipped.add(segmentKey(itemKey, seg));
        timer = null;
        return { to: seg.end, type: seg.type };
      },

      /** Ende der Folge: Countdown (oder weiterzaehlen, wenn er schon im Abspann laeuft), ohne naechste Folge schliessen. */
      ended({ hasNext, autoplayNext }) {
        if (!hasNext || !autoplayNext) return { action: 'close' };
        if (countdown) {
          countdown.inCredits = false; // ab jetzt schliesst "Schliessen" den Player
          return { action: 'continue' };
        }
        return startCountdown(COUNTDOWN_S, false);
      },

      /** Der Nutzer haelt an: im Abspann verschwindet der Countdown (wer anhaelt, will nicht gleich in der naechsten Folge landen). */
      paused() {
        if (!countdown?.inCredits) return null;
        creditsDismissed = true;
        countdown = null;
        return { action: 'hide' };
      },

      /** "Ausblenden" bzw. "Schliessen" am Countdown: im Abspann nur ausblenden (er kommt am Ende wieder), am Ende den Player schliessen. */
      cancel() {
        if (!countdown) return null;
        if (countdown.inCredits) {
          creditsDismissed = true;
          countdown = null;
          return { action: 'hide' };
        }
        countdown = null;
        return { action: 'close' };
      },

      /** Der Countdown ist abgelaufen (oder "Abspielen" gedrueckt): die naechste Folge. */
      countdownFinished() {
        countdown = null;
        return { action: 'next' };
      }
    };
  }

  // ---------- Bildformat ----------

  /** Bildformate wie in der Apple-App (Standardbild und Menue "Qualitaet & Bildformat"). */
  const VIDEO_FORMATS = ['auto', 'fit', 'fill', 'stretch'];
  /**
   * "Automatisch" fuellt, wenn Bild und Flaeche fast dasselbe Seitenverhaeltnis haben (dann gehen nur schmale Raender verloren: 16:9 auf 16:10, 1,85:1 auf
   * 16:9), sonst passt es das ganze Bild ein (2,39:1 und 4:3 auf 16:9). Die Grenze von 12 % Unterschied ist eigene Wahl: die Apple-App nennt ihren Wert
   * im Referenzstand nicht.
   */
  const AUTO_FILL_TOLERANCE = 0.12;

  function videoFormat(value) {
    return VIDEO_FORMATS.includes(value) ? value : 'auto';
  }

  /** Was "Automatisch" gerade bedeutet: 'fill' oder 'fit'; ohne bekannte Seitenverhaeltnisse 'fit'. */
  function resolveFormat(format, videoAspect, screenAspect) {
    const f = videoFormat(format);
    if (f !== 'auto') return f;
    if (!(videoAspect > 0) || !(screenAspect > 0)) return 'fit';
    const diff = Math.max(videoAspect, screenAspect) / Math.min(videoAspect, screenAspect) - 1;
    return diff <= AUTO_FILL_TOLERANCE ? 'fill' : 'fit';
  }

  // ---------- Kleines Bild im Abspann (Windows: Raender von mpv) ----------

  /**
   * Lage des laufenden Bildes, solange im Abspann der Countdown laeuft: links, senkrecht mittig, hoechstens 46 % der Breite und 62 % der Hoehe,
   * genau im Seitenverhaeltnis des Videos (sonst haette mpv innen schwarze Raender). Ergebnis in Bildpunkten der Flaeche und als Raender fuer mpv
   * (video-margin-ratio-left/right/top/bottom).
   */
  function miniPicture(width, height, videoAspect) {
    if (!(width > 0) || !(height > 0)) return null;
    const aspect = videoAspect > 0 ? videoAspect : 16 / 9;
    let w = width * 0.46;
    let h = w / aspect;
    if (h > height * 0.62) {
      h = height * 0.62;
      w = h * aspect;
    }
    const x = Math.round(width * 0.06);
    const y = Math.round((height - h) / 2);
    w = Math.round(w);
    h = Math.round(h);
    return {
      rect: { x, y, w, h },
      margins: { left: x / width, right: (width - x - w) / width, top: y / height, bottom: (height - y - h) / height }
    };
  }

  return {
    SKIP_DELAYS,
    DEFAULT_SKIP_DELAY,
    COUNTDOWN_S,
    CREDITS_COUNTDOWN_S,
    NOTICE_MS,
    SEGMENT_TYPES,
    SETTING_KEYS,
    SKIP_MODES,
    DEFAULT_MODES,
    VIDEO_FORMATS,
    AUTO_FILL_TOLERANCE,
    skipMode,
    skipDelay,
    skipsAutomatically,
    delayFromCountdown,
    activeSegment,
    creditsForCountdown,
    creditsCountdownSeconds,
    createSkipEngine,
    videoFormat,
    resolveFormat,
    miniPicture
  };
});
