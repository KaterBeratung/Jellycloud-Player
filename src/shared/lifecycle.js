/* Gemeinsames Modul: Lebenszyklus einer Wiedergabe (Plan P20, wie Playback/PlaybackLifecycle.swift der Apple-App, Notizen/stream-beendigung.md).
   Findet keine beabsichtigte Wiedergabe mehr statt, endet die Sitzung beim Server spaetestens nach 30 Sekunden; sonst liefe ein Strom weiter, nachdem das
   Geraet schlafen gegangen oder die App verlassen worden ist (der Server setzte weiter um, bis er die Sitzung selbst aufgab).
   "Beabsichtigt" ist eine Wiedergabe, solange die App vorne ist (spielend oder angehalten) oder ausserhalb der App weiterlaeuft. Anhalten, Springen, Puffern,
   Spur- und Qualitaetswechsel und kurze Unterbrechungen beruehren sie nicht: dafuer gibt es hier kein Ereignis.
   Eine Stelle, ein Ablauf: die Ereignisse der Plattform kommen hier an, es laeuft hoechstens eine Frist, und beendet wird ueber den vorhandenen Weg des Players
   (session.endForInactivity), genau einmal. Eine Frist gehoert zu genau der Wiedergabe, fuer die sie begann: ein danach gestarteter Film wird von ihr nie beendet.
   Uhr, Warten und Hintergrundzeit sind austauschbar (hooks), damit die Regel ohne Wartezeit testbar ist. Laeuft als CommonJS (Hauptprozess, Tests) und als
   klassisches Skript (window.JCLifecycle). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCLifecycle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Spaetestens nach so vielen Sekunden ohne beabsichtigte Wiedergabe endet die Sitzung. */
  const LIMIT_S = 30;
  /** Im Hintergrund endet sie frueher: das System gibt einer App dort nur begrenzte Zeit, danach koennte sie das Ende nicht mehr melden. */
  const BACKGROUND_GRACE_S = 20;
  /** Takt des Herzschlags, der bemerkt, dass das Geraet geschlafen hat. */
  const BEAT_S = 5;
  /** So lange wartet die App beim Beenden und vor dem Ruhezustand hoechstens auf die Antwort des Servers. */
  const EXIT_WAIT_S = 2;

  /**
   * @typedef {object} PlaybackSession
   * @property {boolean} continuesOutsideApp die Wiedergabe laeuft ausserhalb der App weiter (dann ist sie auch im Hintergrund beabsichtigt)
   * @property {() => void} savePosition Stelle beim Server sichern, ohne etwas zu beenden
   * @property {() => Promise<void>|void} endForInactivity der vorhandene Weg des Schliessens; ein zweiter Aufruf bewirkt nichts
   * @property {(waitS:number) => void} reportEndNow das Ende sofort melden (Beenden der App, Ruhezustand); das anschliessende Schliessen meldet nichts doppelt
   */

  /**
   * @param {object} [hooks]
   * @param {() => number} [hooks.elapsed] Sekunden seit dem Start, Schlafzeit des Geraets eingeschlossen (keine Uhrzeit: ein Stellen der Uhr aendert nichts)
   * @param {() => number} [hooks.asleep] so lange hat das Geraet seit dem Start geschlafen (Sekunden)
   * @param {(seconds:number) => Promise<void>} [hooks.sleep] warten
   * @param {(expired:() => void) => () => void} [hooks.beginBackgroundTime] Zeit im Hintergrund erbitten; zurueck kommt, womit die Bitte endet
   * @param {(text:string) => void} [hooks.log]
   */
  function createLifecycle(hooks = {}) {
    const started = Date.now();
    const h = {
      elapsed: () => (Date.now() - started) / 1000,
      asleep: () => 0,
      sleep: (s) => new Promise((r) => setTimeout(r, s * 1000)),
      beginBackgroundTime: () => () => {},
      log: () => {}
    };
    for (const [k, v] of Object.entries(hooks)) if (typeof v === 'function') h[k] = v;
    let session = null;
    let away = false;
    let unintendedSince = null;
    let endedCount = 0;
    let countdown = null; // Kennzeichen der laufenden Frist (ein Objekt); null: keine
    let heartbeat = null; // Kennzeichen des laufenden Herzschlags
    let release = null;
    let asleepAtLastBeat = null;

    const intended = () => !session || !away || !!session.continuesOutsideApp;

    function cancelCountdown() {
      if (unintendedSince === null && !countdown) return;
      if (session && unintendedSince !== null) h.log('Wiedergabe wieder beabsichtigt: Frist verfällt');
      countdown = null;
      unintendedSince = null;
      const r = release;
      release = null;
      if (r) r();
    }

    function forget() {
      countdown = null;
      heartbeat = null;
      unintendedSince = null;
      asleepAtLastBeat = null;
      session = null;
      const r = release;
      release = null;
      if (r) r();
    }

    /** Beendet die laufende Sitzung, genau einmal: danach ist sie vergessen, weitere Ereignisse treffen sie nicht mehr. */
    function end(reason) {
      const ending = session;
      if (!ending) return;
      const r = release;
      release = null;
      forget();
      endedCount++;
      h.log(`Sitzung endet: ${reason}`);
      Promise.resolve()
        .then(() => ending.endForInactivity())
        .catch(() => {})
        .then(() => r && r());
    }

    /** Wie end, wenn danach nichts mehr laeuft: erst das Ende sofort melden, dann den Player auf dem gewohnten Weg schliessen. */
    function endNow(reason) {
      const ending = session;
      if (!ending) return;
      try {
        ending.reportEndNow(EXIT_WAIT_S);
      } catch {
        /* die Meldung ist nicht zu retten; geschlossen wird trotzdem */
      }
      end(reason);
    }

    function evaluate() {
      const current = session;
      if (!current) return cancelCountdown();
      if (intended()) return cancelCountdown();
      if (unintendedSince !== null) return; // die Frist laeuft schon: wiederholte Ereignisse aendern nichts
      unintendedSince = h.elapsed();
      current.savePosition();
      h.log(`keine beabsichtigte Wiedergabe mehr: Stelle gesichert, Frist ${BACKGROUND_GRACE_S} s`);
      const mine = {};
      countdown = mine;
      release = h.beginBackgroundTime(() => {
        if (countdown === mine) end('Hintergrundzeit abgelaufen');
      });
      Promise.resolve(h.sleep(BACKGROUND_GRACE_S)).then(() => {
        // Nur diese Frist (jede neue Wiedergabe, jede Rueckkehr verwirft sie) und nur, wenn die Wiedergabe inzwischen nicht wieder beabsichtigt ist (etwa
        // ausserhalb der App weiterlaeuft, ohne dass das gemeldet wurde)
        if (countdown !== mine || intended()) return;
        end('Frist abgelaufen');
      }, () => {});
    }

    /**
     * Herzschlag: hat das Geraet seit dem letzten laenger als die Grenze geschlafen und lief die Wiedergabe nicht ausserhalb der App weiter, ist der Strom
     * laengst abgerissen: die Sitzung endet. Gemessen wird Schlaf des Geraets (hooks.asleep), nicht der Abstand zweier Herzschlaege.
     */
    function beat() {
      const asleep = h.asleep();
      const last = asleepAtLastBeat;
      asleepAtLastBeat = asleep;
      if (!session || last === null || asleep - last <= LIMIT_S || session.continuesOutsideApp) return;
      end(`Gerät hat ${Math.round(asleep - last)} s geschlafen`);
    }

    return {
      /** Eine Wiedergabe beginnt. Fristen einer frueheren verfallen. */
      attach(next) {
        cancelCountdown();
        session = next;
        asleepAtLastBeat = h.asleep();
        const mine = {};
        heartbeat = mine;
        (async () => {
          while (heartbeat === mine) {
            try {
              await h.sleep(BEAT_S);
            } catch {
              return;
            }
            if (heartbeat !== mine) return;
            beat();
          }
        })();
        evaluate();
      },
      /** Der Player ist zu (geschlossen, zu Ende): nichts mehr zu ueberwachen. Eine andere als die laufende Wiedergabe aendert nichts. */
      detach(old) {
        if (session === old) forget();
      },
      /** Die App ist in den Hintergrund gegangen (Sperren, Home, anderes Programm). */
      appLeft() {
        away = true;
        evaluate();
      },
      /** Die App ist wieder vorne. War sie laenger weg als die Grenze, ohne dass die Frist laufen konnte, endet die Sitzung jetzt; sonst verfaellt die Frist. */
      appReturned() {
        away = false;
        if (unintendedSince !== null && h.elapsed() - unintendedSince >= LIMIT_S) end(`zurück nach mehr als ${LIMIT_S} s`);
        else evaluate();
      },
      /** Die Wiedergabe ausserhalb der App hat begonnen oder aufgehoert. */
      outsidePlaybackChanged: () => evaluate(),
      /** Der Rechner geht in den Ruhezustand: danach ist das Netz weg, das Ende laesst sich nur jetzt noch melden. */
      systemWillSleep: () => endNow('Ruhezustand'),
      /** Die App wird beendet. */
      appWillTerminate: () => endNow('App beendet'),
      beat,
      get session() {
        return session;
      },
      get away() {
        return away;
      },
      get unintendedSince() {
        return unintendedSince;
      },
      get endedCount() {
        return endedCount;
      }
    };
  }

  return { LIMIT_S, BACKGROUND_GRACE_S, BEAT_S, EXIT_WAIT_S, createLifecycle };
});
