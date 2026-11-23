'use strict';
/**
 * Lebenszyklus einer Wiedergabe (src/shared/lifecycle.js, Plan P20): die 20 Faelle aus JellycloudTests/PlaybackLifecycleTests.swift der Apple-App mit
 * gestellter Uhr (keine echte Wartezeit): die 30-Sekunden-Regel, ihre Ausnahmen, konkurrierende Zustandswechsel, Ruhezustand und Beenden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/shared/lifecycle');

/** Gestellte Uhr: sleep wartet, bis run, deviceSleeps oder appStalls die Zeit vorstellt. */
class FakeTime {
  constructor() {
    this.now = 100; // Sekunden seit dem Start, Schlafzeit eingeschlossen
    this.asleep = 0; // davon hat das Geraet geschlafen
    this.frozen = false; // die App ist angehalten: es laeuft nichts, auch wenn die Zeit vergeht
    this.waiters = [];
  }
  sleep(s) {
    return new Promise((resolve) => this.waiters.push({ deadline: this.now + s, resolve }));
  }
  async flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }
  async wake() {
    await this.flush();
    if (this.frozen) return;
    const due = this.waiters.filter((w) => w.deadline <= this.now);
    this.waiters = this.waiters.filter((w) => w.deadline > this.now);
    for (const w of due) w.resolve();
    await this.flush();
  }
  /** Die Zeit vergeht normal, Sekunde fuer Sekunde. */
  async run(seconds) {
    for (let i = 0; i < seconds; i++) {
      this.now += 1;
      await this.wake();
    }
  }
  /** Das Geraet schlaeft und wacht wieder auf. */
  async deviceSleeps(seconds) {
    this.now += seconds;
    this.asleep += seconds;
    await this.wake();
  }
  /** Die Zeit vergeht, ohne dass die App an die Reihe kommt; das Geraet bleibt wach. */
  async appStalls(seconds) {
    this.now += seconds;
    await this.wake();
  }
}

class FakeSession {
  constructor() {
    this.continuesOutsideApp = false;
    this.saved = 0;
    this.ended = 0;
    this.reportedNow = []; // sofort gemeldete Enden, mit dem Stand von ended in diesem Moment
  }
  savePosition() {
    this.saved++;
  }
  endForInactivity() {
    this.ended++;
  }
  reportEndNow() {
    this.reportedNow.push(this.ended);
  }
}

function setup({ expire = null, counters = null } = {}) {
  const time = new FakeTime();
  const life = L.createLifecycle({
    elapsed: () => time.now,
    asleep: () => time.asleep,
    sleep: (s) => time.sleep(s),
    beginBackgroundTime: (expired) => {
      if (counters) counters.granted++;
      if (expire) expire(expired);
      return () => counters && counters.released++;
    }
  });
  return { time, life };
}

// ---------- Die Regel ----------

test('Geht die App in den Hintergrund, wird die Stelle sofort gesichert und die Sitzung nach der Frist beendet, genau einmal', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  await time.run(5);
  life.appLeft();
  assert.ok(s.saved === 1 && s.ended === 0);
  await time.run(L.BACKGROUND_GRACE_S - 1);
  assert.equal(s.ended, 0);
  await time.run(2);
  assert.equal(s.ended, 1);
  await time.run(120);
  assert.ok(s.ended === 1 && life.endedCount === 1);
  assert.ok(L.BACKGROUND_GRACE_S < L.LIMIT_S);
});

test('Zurück innerhalb der Frist: nichts endet, die Frist verfällt, die Wiedergabe lässt sich fortsetzen', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  await time.run(12);
  life.appReturned();
  await time.run(120);
  assert.ok(s.ended === 0 && life.unintendedSince === null);
});

test('Wiederholte Ereignisse ändern nichts: eine Sicherung, eine Frist, ein Ende', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  life.appLeft();
  life.outsidePlaybackChanged();
  life.appLeft();
  assert.equal(s.saved, 1);
  await time.run(25);
  life.appLeft();
  life.appWillTerminate();
  life.systemWillSleep();
  await time.run(60);
  assert.equal(s.ended, 1);
});

test('War die App länger als 30 Sekunden angehalten, ohne dass die Frist laufen konnte, endet die Sitzung bei der Rückkehr', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  time.frozen = true; // das System haelt die App an: keine Frist laeuft ab
  await time.appStalls(45);
  assert.equal(s.ended, 0);
  time.frozen = false;
  life.appReturned();
  await time.run(2);
  assert.equal(s.ended, 1);
});

test('Läuft die Zeit im Hintergrund vor der Frist ab, endet die Sitzung in diesem Moment, und später nicht noch einmal', async () => {
  let expire = null;
  const { time, life } = setup({ expire: (e) => (expire = e) });
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  await time.run(6);
  expire();
  await time.run(1);
  assert.equal(s.ended, 1);
  await time.run(60);
  assert.equal(s.ended, 1);
});

test('Die Zeit im Hintergrund wird erbeten und nach dem Ende oder der Rückkehr zurückgegeben', async () => {
  const counters = { granted: 0, released: 0 };
  const { time, life } = setup({ counters });
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  assert.ok(counters.granted === 1 && counters.released === 0);
  life.appReturned();
  assert.equal(counters.released, 1);
  life.appLeft();
  await time.run(25);
  assert.ok(s.ended === 1 && counters.granted === 2 && counters.released === 2, JSON.stringify(counters));
});

// ---------- Ausnahmen ----------

test('Anhalten im geöffneten Player, auch minutenlang, beendet nichts', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  await time.run(600);
  assert.ok(s.ended === 0 && s.saved === 0);
});

test('Wiedergabe außerhalb der App (Bild im Bild, AirPlay): sie bleibt im Hintergrund beabsichtigt', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  s.continuesOutsideApp = true;
  life.attach(s);
  life.appLeft();
  await time.run(300);
  assert.ok(s.ended === 0 && s.saved === 0);
});

test('Endet die Wiedergabe außerhalb der App, während die App im Hintergrund ist, beginnt die Frist erst dann', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  s.continuesOutsideApp = true;
  life.attach(s);
  life.appLeft();
  await time.run(100);
  s.continuesOutsideApp = false;
  life.outsidePlaybackChanged();
  assert.equal(s.saved, 1);
  await time.run(15);
  assert.equal(s.ended, 0);
  await time.run(10);
  assert.equal(s.ended, 1);
});

test('Beginnt eine Wiedergabe außerhalb der App innerhalb der Frist, verfällt sie', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  await time.run(8);
  s.continuesOutsideApp = true;
  life.outsidePlaybackChanged();
  await time.run(200);
  assert.equal(s.ended, 0);
});

test('Läuft die Wiedergabe beim Ablauf der Frist außerhalb der App weiter (ohne dass es gemeldet wurde), endet sie nicht', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  await time.run(8);
  s.continuesOutsideApp = true; // keine Meldung outsidePlaybackChanged
  await time.run(30);
  assert.equal(s.ended, 0);
});

// ---------- Konkurrierende Wechsel ----------

test('Eine alte Frist beendet keine neu gestartete Wiedergabe', async () => {
  const { time, life } = setup();
  const old = new FakeSession();
  const next = new FakeSession();
  life.attach(old);
  life.appLeft();
  await time.run(15);
  life.detach(old);
  life.attach(next); // neue Wiedergabe, noch im Hintergrund: sie bekommt ihre eigene, volle Frist
  await time.run(10); // die Frist der alten waere jetzt abgelaufen
  assert.ok(old.ended === 0 && next.ended === 0);
  await time.run(15);
  assert.ok(old.ended === 0 && next.ended === 1);
});

test('Zurück, alter Film geschlossen, neuer gestartet: nichts von vorher wirkt nach', async () => {
  const { time, life } = setup();
  const old = new FakeSession();
  const next = new FakeSession();
  life.attach(old);
  life.appLeft();
  await time.run(10);
  life.appReturned();
  life.detach(old);
  life.attach(next);
  await time.run(300);
  assert.ok(old.ended === 0 && next.ended === 0);
});

test('Schließt der Nutzer den Player während der Frist, endet danach nichts mehr', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  life.appLeft();
  await time.run(5);
  life.detach(s);
  await time.run(120);
  assert.ok(s.ended === 0 && life.endedCount === 0);
});

test('Ein Ereignis einer schon geschlossenen Wiedergabe trifft die laufende nicht', async () => {
  const { time, life } = setup();
  const old = new FakeSession();
  const next = new FakeSession();
  life.attach(old);
  life.attach(next);
  life.detach(old);
  life.appLeft();
  await time.run(25);
  assert.ok(next.ended === 1 && old.ended === 0);
});

// ---------- Ruhezustand und Beenden ----------

test('Ruhezustand des Rechners und Beenden der App: das Ende wird sofort gemeldet, noch bevor irgendetwas anderes läuft', async () => {
  const { time, life } = setup();
  const first = new FakeSession();
  const second = new FakeSession();
  life.attach(first);
  life.systemWillSleep();
  // Ohne dass ein weiterer Schritt laeuft: gemeldet ist schon, geschlossen noch nicht
  assert.ok(JSON.stringify(first.reportedNow) === '[0]' && first.ended === 0);
  await time.run(1);
  assert.ok(first.ended === 1 && first.reportedNow.length === 1);
  life.attach(second);
  life.appWillTerminate();
  assert.deepEqual(second.reportedNow, [0]);
  life.appWillTerminate();
  life.systemWillSleep();
  assert.equal(second.reportedNow.length, 1);
});

test('Hat das Gerät länger als 30 Sekunden geschlafen, endet die Sitzung nach dem Aufwachen', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  await time.run(20);
  await time.deviceSleeps(600);
  await time.run(1);
  assert.equal(s.ended, 1);
});

test('Ein kurzer Schlaf des Geräts beendet nichts', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  await time.deviceSleeps(20);
  await time.run(30);
  assert.equal(s.ended, 0);
});

test('Kommt nur die App lange nicht an die Reihe, endet nichts: das Gerät hat nicht geschlafen', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  life.attach(s);
  await time.appStalls(600);
  await time.run(30);
  assert.equal(s.ended, 0);
});

test('Schlief das Gerät, während die Wiedergabe außerhalb der App lief, bleibt die Sitzung', async () => {
  const { time, life } = setup();
  const s = new FakeSession();
  s.continuesOutsideApp = true;
  life.attach(s);
  await time.deviceSleeps(600);
  await time.run(10);
  assert.equal(s.ended, 0);
});

test('Ohne laufende Wiedergabe geschieht bei keinem Ereignis etwas', async () => {
  const counters = { granted: 0, released: 0 };
  const { time, life } = setup({ counters });
  life.appLeft();
  life.systemWillSleep();
  life.appWillTerminate();
  life.beat();
  life.appReturned();
  await time.run(60);
  assert.ok(life.endedCount === 0 && counters.granted === 0);
});
