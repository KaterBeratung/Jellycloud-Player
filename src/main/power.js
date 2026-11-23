'use strict';

/**
 * Lebenszyklus der Wiedergabe unter Windows (Plan P20, wie Playback/PlaybackLifecycle+System.swift der Apple-App auf dem Mac): die gemeinsame Verwaltung
 * (src/shared/lifecycle.js) mit den Ereignissen des Rechners. Wie auf dem Mac spielt ein Fenster, das nicht vorne ist, sichtbar weiter: "App verlassen"
 * gibt es hier nicht ("Pause beim Minimieren" bleibt eine eigene Einstellung). Es zaehlen:
 * - Ruhezustand (powerMonitor "suspend"): das Ende geht sofort hinaus und der Player schliesst. Windows wartet dabei nicht auf eine Anwendung: die Meldung
 *   laeuft gegen das Einschlafen (anders als auf dem Mac, wo das System auf die behandelte Meldung wartet).
 * - Herzschlag alle 5 s: hat der Rechner laenger als 30 s geschlafen, endet die Sitzung nach dem Aufwachen. Schlafzeit sind die Zeit zwischen "suspend"
 *   und "resume" und jede Luecke, in der der Hauptprozess nicht lief (Modern Standby friert Programme ein, ohne "suspend" zu melden). Unter Windows bremst das
 *   System den Hauptprozess sonst nicht (kein App Nap): steht er laenger still, schlief der Rechner.
 * - Beenden der App: wie bisher in main.js (before-quit wartet auf die Meldungen).
 */

/**
 * Schlafzeit des Rechners in Sekunden fuer den Herzschlag.
 * @param {{mono?:() => number, wall?:() => number, beatMs?:number}} [o] mono: Zeit in ms, die nicht verstellt werden kann; wall: Uhrzeit in ms
 */
function createSleepClock({ mono = () => performance.now(), wall = () => Date.now(), beatMs = 5000 } = {}) {
  let total = 0;
  let lastMono = null;
  let suspendedAt = null;
  return {
    /** Gelesen bei jedem Herzschlag: lief der Prozess laenger als zwei Takte nicht, zaehlt die Luecke (ohne den einen Takt) als Schlaf. */
    asleep() {
      const t = mono();
      if (lastMono !== null) {
        const gap = t - lastMono;
        if (gap > 2 * beatMs) total += gap - beatMs;
      }
      lastMono = t;
      return total / 1000;
    },
    /** Der Rechner geht schlafen. */
    suspended() {
      suspendedAt = wall();
    },
    /** Der Rechner ist aufgewacht: die Zeit seit "suspend" ist Schlaf. */
    resumed() {
      if (suspendedAt === null) return;
      const gap = wall() - suspendedAt;
      suspendedAt = null;
      if (gap > 0) total += gap;
    }
  };
}

/**
 * Der Player als Wiedergabe-Sitzung fuer die Verwaltung. Ende ist immer der vorhandene Weg des Schliessens (PlayerController.stop: Stelle und Ende an den
 * Server, dann das Ende der eigenen Umsetzung); ein zweiter Aufruf bewirkt nichts.
 */
function playerSession(player) {
  let ended = null; // der eine Aufruf von stop: genau ein Ende je Sitzung
  const end = () => (ended ??= Promise.resolve(player.stop()));
  return {
    continuesOutsideApp: false,
    savePosition: () => player.savePosition(),
    endForInactivity: end,
    // Windows haelt nichts an, bis die Meldung draussen ist: sie geht sofort los (stop meldet im Hintergrund), das folgende Schliessen ruft nichts doppelt
    reportEndNow: () => {
      end();
    }
  };
}

/**
 * Verbindet die Verwaltung mit dem Player und dem Rechner. power: powerMonitor von Electron (on/off).
 * @returns {{lifecycle:object, clock:object, dispose:() => void}}
 */
function attachPowerLifecycle({ player, power, createLifecycle, log = () => {}, clock = createSleepClock(), hooks = {} }) {
  const lifecycle = createLifecycle({ asleep: () => clock.asleep(), log, ...hooks });
  // Je Wiedergabe eine eigene Sitzung: eine Frist oder ein Herzschlag einer frueheren trifft nie die naechste
  let session = null;
  const onActive = (on) => {
    if (on) {
      session = playerSession(player);
      lifecycle.attach(session);
    } else if (session) {
      lifecycle.detach(session);
      session = null;
    }
  };
  const onSuspend = () => {
    clock.suspended();
    lifecycle.systemWillSleep();
  };
  const onResume = () => {
    clock.resumed();
    lifecycle.beat(); // gleich nach dem Aufwachen, nicht erst beim naechsten Takt
  };
  player.on('active', onActive);
  power.on('suspend', onSuspend);
  power.on('resume', onResume);
  return {
    lifecycle,
    clock,
    dispose() {
      player.off('active', onActive);
      power.off('suspend', onSuspend);
      power.off('resume', onResume);
    }
  };
}

module.exports = { createSleepClock, playerSession, attachPowerLifecycle };
