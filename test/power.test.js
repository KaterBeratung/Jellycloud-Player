'use strict';
/**
 * Lebenszyklus unter Windows (src/main/power.js, Plan P20): Ruhezustand beendet sofort und genau einmal, langer Schlaf (auch ohne "suspend", wenn der
 * Prozess eingefroren war) nach dem Aufwachen, kurzer nicht; je Wiedergabe eine eigene Sitzung. Dazu X6: Ende der Umsetzung bei jedem HLS-Strom.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSleepClock, attachPowerLifecycle } = require('../src/main/power');
const { createLifecycle } = require('../src/shared/lifecycle');
const { resolvePlayback } = require('../src/main/profile');

class FakePlayer extends EventEmitter {
  constructor() {
    super();
    this.stops = 0;
    this.saves = 0;
  }
  stop() {
    this.stops++;
  }
  savePosition() {
    this.saves++;
  }
}

/** Gestellte Uhren: mono (Prozess lief) und wall (Uhrzeit), dazu ein Herzschlag auf Zuruf. */
function setup() {
  const t = { mono: 0, wall: 1_800_000_000_000 };
  const beats = [];
  const clock = createSleepClock({ mono: () => t.mono, wall: () => t.wall });
  const player = new FakePlayer();
  const power = new EventEmitter();
  const p = attachPowerLifecycle({
    player,
    power,
    createLifecycle,
    clock,
    hooks: { sleep: () => new Promise((r) => beats.push(r)) } // ein Herzschlag laeuft erst, wenn der Test ihn ausloest
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  /** Zeit vergeht (ms): der Prozess laeuft und schlaegt alle 5 s. */
  const run = async (ms) => {
    for (let done = 0; done < ms; done += 5000) {
      t.mono += 5000;
      t.wall += 5000;
      beats.splice(0).forEach((r) => r());
      await flush();
    }
  };
  /** Der Prozess war eingefroren (Modern Standby), ohne "suspend": danach der naechste Herzschlag. */
  const frozen = async (ms) => {
    t.mono += ms;
    t.wall += ms;
    beats.splice(0).forEach((r) => r());
    await flush();
  };
  return { t, player, power, p, run, frozen, flush };
}

test('Ruhezustand: die Sitzung endet sofort (das Ende geht vor dem Einschlafen hinaus), genau einmal', async () => {
  const { player, power, flush } = setup();
  player.emit('active', true);
  power.emit('suspend');
  assert.equal(player.stops, 1, 'sofort, ohne einen weiteren Schritt');
  power.emit('suspend');
  await flush();
  assert.equal(player.stops, 1, 'das folgende Schliessen und weitere Meldungen beenden nichts doppelt');
  player.emit('active', false);
  power.emit('resume');
  await flush();
  assert.equal(player.stops, 1);
});

test('Ohne laufende Wiedergabe tut der Ruhezustand nichts', async () => {
  const { player, power, flush } = setup();
  power.emit('suspend');
  power.emit('resume');
  await flush();
  assert.equal(player.stops, 0);
});

test('War der Prozess länger als 30 s eingefroren (Modern Standby, ohne "suspend"), endet die Sitzung beim nächsten Herzschlag', async () => {
  const { player, run, frozen } = setup();
  player.emit('active', true);
  await run(20000);
  assert.equal(player.stops, 0);
  await frozen(600000);
  assert.equal(player.stops, 1);
});

test('Kurze Aussetzer und ein Fenster im Hintergrund beenden nichts', async () => {
  const { player, run, frozen } = setup();
  player.emit('active', true);
  await run(60000);
  await frozen(20000);
  await run(600000);
  assert.ok(player.stops === 0 && player.saves === 0, 'kein "App verlassen" unter Windows: ein Fenster im Hintergrund spielt weiter');
});

test('Aufwachen nach langem Schlaf, dessen "suspend" die Sitzung nicht beenden konnte: Ende beim Aufwachen', async () => {
  const { t, player, power, p, flush } = setup();
  player.emit('active', true);
  p.clock.suspended(); // nur die Uhr merkt sich das Einschlafen (als waere die Sitzung danach noch einmal angelaufen)
  t.wall += 120000;
  power.emit('resume');
  await flush();
  assert.equal(player.stops, 1);
});

test('Je Wiedergabe eine eigene Sitzung: nach dem Schliessen beginnt die nächste frisch', async () => {
  const { player, power, flush } = setup();
  player.emit('active', true);
  player.emit('active', false);
  player.emit('active', true);
  power.emit('suspend');
  await flush();
  assert.equal(player.stops, 1);
  player.emit('active', false);
  player.emit('active', true);
  power.emit('suspend');
  await flush();
  assert.equal(player.stops, 2, 'die zweite Wiedergabe endet ebenso, die erste nicht noch einmal');
});

test('Schlafuhr: Lücken des Prozesses über zwei Takte und die Zeit zwischen suspend und resume zählen als Schlaf', () => {
  let mono = 0;
  let wall = 0;
  const c = createSleepClock({ mono: () => mono, wall: () => wall });
  assert.equal(c.asleep(), 0);
  mono += 5000;
  assert.equal(c.asleep(), 0, 'ein normaler Takt');
  mono += 9000;
  assert.equal(c.asleep(), 0, 'knapp unter zwei Takten: kein Schlaf');
  mono += 65000;
  assert.equal(c.asleep(), 60, 'die Luecke ohne den einen Takt');
  c.suspended();
  wall += 45000;
  c.resumed();
  assert.equal(c.asleep(), 105);
  c.resumed();
  assert.equal(c.asleep(), 105, 'resume ohne suspend zaehlt nicht');
});

test('Ende der Umsetzung bei jedem Strom, den der Server baut: Transcode und Direct Stream über HLS, nicht Direct Play', () => {
  const src = (o) => ({ Id: 'src', Container: 'mkv', MediaStreams: [], ...o });
  const plan = (s) => resolvePlayback({ info: { MediaSources: [s], PlaySessionId: 'ps' }, base: 'http://srv', itemId: 'item', deviceId: 'dev' });
  assert.equal(plan(src({ SupportsDirectPlay: true })).isHls, false);
  const remux = plan(src({ SupportsDirectPlay: false, SupportsDirectStream: true, TranscodingUrl: '/videos/item/master.m3u8?x=1' }));
  assert.deepEqual([remux.method, remux.isHls], ['DirectStream', true]);
  const tc = plan(src({ SupportsDirectPlay: false, SupportsDirectStream: false, TranscodingUrl: '/videos/item/master.m3u8' }));
  assert.deepEqual([tc.method, tc.isHls], ['Transcode', true]);
  const staticStream = plan(src({ SupportsDirectPlay: false, SupportsDirectStream: true }));
  assert.deepEqual([staticStream.method, staticStream.isHls], ['DirectStream', false]);
});
