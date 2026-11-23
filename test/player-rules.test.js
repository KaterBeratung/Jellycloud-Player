'use strict';
// Regeln des Players (Plan P22, E10 "Wie Apple, ueberall"; src/shared/player-rules.js) nach PlayerModel+Monitoring und +Controls der Apple-App:
// nur "Intro ueberspringen" ueber dem Bild, Rueckblick und Vorschau nur automatisch, Countdown "Naechste Folge" im Abspann oder am Ende, Bildformat.
// Die Apple-App hat fuer diese Regeln keine eigenen Unit-Tests (nur Oberflaechen-Tests); die Faelle hier folgen ihrem Quelltext.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../src/shared/player-rules');
const { ConfigStore } = require('../src/main/config');

const prefs = (o = {}) => ({ skipIntro: 'button', skipOutro: 'button', skipRecap: 'off', skipPreview: 'off', skipDelay: 5, ...o });
// Folge von 1500 s: Intro 60-150, Rueckblick 0-40, Vorschau 1400-1420, Abspann bis ans Ende 1440-1500
const SEGS = [
  { type: 'Recap', start: 0, end: 40 },
  { type: 'Intro', start: 60, end: 150 },
  { type: 'Preview', start: 1400, end: 1420 },
  { type: 'Outro', start: 1440, end: 1500 }
];
const ctx = (t, o = {}) => ({ t, duration: 1500, segments: SEGS, prefs: prefs(o.prefs), hasNext: true, autoplayNext: true, paused: false, reachedEnd: false, ...o, prefs: prefs(o.prefs) });

test('Einstellungen: erlaubte Werte je Art, Unbekanntes faellt auf den Standard; Rueckblick und Vorschau ohne "Knopf zeigen"', () => {
  assert.equal(R.skipMode(prefs(), 'Intro'), 'button');
  assert.equal(R.skipMode(prefs({ skipIntro: 'auto' }), 'Intro'), 'auto');
  assert.equal(R.skipMode(prefs({ skipIntro: 'quatsch' }), 'Intro'), 'button');
  assert.equal(R.skipMode(prefs({ skipRecap: 'button' }), 'Recap'), 'off', 'Rueckblick hat keinen Knopf');
  assert.equal(R.skipMode(prefs({ skipPreview: 'auto' }), 'Preview'), 'auto');
  assert.equal(R.skipMode(prefs(), 'Commercial'), 'off', 'andere Arten gibt es nicht');
  assert.deepEqual(R.SKIP_DELAYS, [0, 3, 5, 8, 10]);
  assert.equal(R.skipDelay(prefs({ skipDelay: 8 })), 8);
  assert.equal(R.skipDelay(prefs({ skipDelay: 7 })), 5, 'nur die Stufen');
  assert.equal(R.skipsAutomatically(prefs()), false, 'Standard: nichts auf Automatisch');
  for (const key of ['skipIntro', 'skipOutro', 'skipRecap', 'skipPreview']) assert.equal(R.skipsAutomatically(prefs({ [key]: 'auto' })), true, key);
  assert.deepEqual([0, 3, 6, 10, 15, 'x'].map(R.delayFromCountdown), [0, 3, 5, 10, 10, 5], 'alter Countdown -> naechste Wartezeit');
});

test('Nur "Intro ueberspringen" bekommt einen Knopf; Rueckblick und Vorschau auf "Knopf zeigen" zaehlen als aus', () => {
  const e = R.createSkipEngine();
  e.reset('ep1');
  assert.deepEqual(e.tick(ctx(70)), { segment: SEGS[1], button: 'Intro', timer: null, skip: null, countdown: null });
  assert.equal(e.tick(ctx(149.5)).button, null, 'die letzte Sekunde zaehlt nicht mehr');
  assert.equal(e.tick(ctx(10)).segment, null, 'Rueckblick aus');
  assert.equal(e.tick(ctx(10, { prefs: { skipRecap: 'button' } })).segment, null);
  assert.equal(e.tick(ctx(10, { prefs: { skipIntro: 'off' } })).button, null);
  assert.equal(e.tick(ctx(1410, { prefs: { skipPreview: 'auto' } })).button, null, 'Vorschau ohne Knopf, auch wenn automatisch');
});

test('Automatisch: der Intro-Knopf fuellt sich ueber die Wartezeit (Spielzeit), dann Sprung ans Ende; einmal je Abschnitt', () => {
  const e = R.createSkipEngine();
  e.reset('ep1');
  const o = { prefs: { skipIntro: 'auto', skipDelay: 8 } };
  const a = e.tick(ctx(60, o));
  assert.deepEqual([a.button, a.timer], ['Intro', { start: 60, duration: 8 }]);
  assert.deepEqual(e.tick(ctx(64, o)).timer, { start: 60, duration: 8 }, 'der Timer laeuft weiter');
  const done = e.tick(ctx(68.2, o));
  assert.deepEqual([done.skip, done.button], [{ to: 150, type: 'Intro' }, null]);
  const back = e.tick(ctx(70, o));
  assert.deepEqual([back.button, back.timer, back.skip], ['Intro', null, null], 'zurueckgesprungen: nur der Knopf, kein zweiter Timer');
});

test('Automatisch: "Sofort" springt gleich; der Timer endet nie hinter dem Abschnitt; Rueckblick und Vorschau springen mit Meldung', () => {
  const e = R.createSkipEngine();
  e.reset('ep1');
  assert.deepEqual(e.tick(ctx(61, { prefs: { skipIntro: 'auto', skipDelay: 0 } })).skip, { to: 150, type: 'Intro' });
  const e2 = R.createSkipEngine();
  e2.reset('ep1');
  assert.deepEqual(e2.tick(ctx(147, { prefs: { skipIntro: 'auto', skipDelay: 10 } })).timer, { start: 147, duration: 2 }, 'hoechstens bis kurz vor das Ende');
  const e3 = R.createSkipEngine();
  e3.reset('ep1');
  const o = { prefs: { skipRecap: 'auto', skipDelay: 3 } };
  assert.equal(e3.tick(ctx(5, o)).skip, null);
  assert.deepEqual(e3.tick(ctx(8.1, o)).skip, { to: 40, type: 'Recap' });
});

test('Neuer Eintrag: was uebersprungen war, gilt nicht mehr; Taste "Ueberspringen" springt und merkt sich den Abschnitt', () => {
  const e = R.createSkipEngine();
  e.reset('ep1');
  const o = { prefs: { skipIntro: 'auto', skipDelay: 0 } };
  e.tick(ctx(61, o));
  assert.equal(e.tick(ctx(61, o)).skip, null);
  e.reset('ep2');
  assert.deepEqual(e.tick(ctx(61, o)).skip, { to: 150, type: 'Intro' });
  const f = R.createSkipEngine();
  f.reset('ep3');
  assert.deepEqual(f.skipPressed(ctx(80, { prefs: { skipIntro: 'auto' } })), { to: 150, type: 'Intro' });
  assert.equal(f.tick(ctx(80, { prefs: { skipIntro: 'auto' } })).timer, null, 'nach dem Druck kein Timer mehr fuer diesen Abschnitt');
  assert.equal(f.skipPressed(ctx(200)), null, 'ausserhalb eines Abschnitts nichts');
});

test('Abspann bis ans Ende: Countdown schon im Abspann, "Knopf zeigen" 10 s, "Automatisch" so lange wie die Wartezeit (mindestens 5 s)', () => {
  const e = R.createSkipEngine();
  e.reset('ep1');
  assert.deepEqual(e.tick(ctx(1441)).countdown, { action: 'start', seconds: 10, inCredits: true });
  assert.equal(e.tick(ctx(1442)).countdown, null, 'laeuft schon');
  assert.deepEqual(e.countdown, { seconds: 10, inCredits: true });
  for (const [delay, seconds] of [[0, 5], [3, 5], [8, 8], [10, 10]]) {
    const f = R.createSkipEngine();
    f.reset('x');
    assert.deepEqual(f.tick(ctx(1441, { prefs: { skipOutro: 'auto', skipDelay: delay } })).countdown, { action: 'start', seconds, inCredits: true }, `Wartezeit ${delay}`);
  }
  const g = R.createSkipEngine();
  g.reset('x');
  assert.equal(g.tick(ctx(1495)).countdown.seconds, 5, 'nie laenger, als der Abspann noch dauert (mindestens 5 s Zeit zum Reagieren)');
  assert.equal(R.creditsCountdownSeconds({ prefs: prefs(), t: 1498.5, duration: 1500 }), 5);
  assert.equal(R.creditsCountdownSeconds({ prefs: prefs(), t: 1430, duration: 1500 }), 10);
});

test('Kein Countdown im Abspann: ohne naechste Folge, ohne "Naechste Folge automatisch", Abspann aus, Szene nach dem Abspann, angehalten', () => {
  const none = (o) => {
    const e = R.createSkipEngine();
    e.reset('x');
    return e.tick(ctx(1450, o)).countdown;
  };
  assert.equal(none({ hasNext: false }), null);
  assert.equal(none({ autoplayNext: false }), null);
  assert.equal(none({ prefs: { skipOutro: 'off' } }), null);
  assert.equal(none({ paused: true }), null);
  assert.equal(none({ segments: [{ type: 'Outro', start: 1400, end: 1460 }] }), null, 'Abspann endet 40 s vor dem Ende: es folgt noch eine Szene');
  assert.equal(none({ duration: 0 }), null);
});

test('Countdown im Abspann: zurueckspringen nimmt ihn zurueck; Anhalten blendet ihn aus und er kommt erst am Ende wieder; Ausblenden ebenso', () => {
  const e = R.createSkipEngine();
  e.reset('x');
  e.tick(ctx(1441));
  assert.deepEqual(e.tick(ctx(1300)).countdown, { action: 'hide' }, 'vor den Abspann gesprungen');
  assert.equal(e.countdown, null);
  assert.equal(e.tick(ctx(1441)).countdown.action, 'start', 'wieder im Abspann: neu');
  assert.deepEqual(e.paused(), { action: 'hide' });
  assert.equal(e.tick(ctx(1450)).countdown, null, 'ausgeblendet: kommt im Abspann nicht wieder');
  assert.deepEqual(e.ended({ hasNext: true, autoplayNext: true }), { action: 'start', seconds: 5, inCredits: false }, 'am Ende kommt er wieder (5 s)');
  const f = R.createSkipEngine();
  f.reset('y');
  f.tick(ctx(1441));
  assert.deepEqual(f.cancel(), { action: 'hide' }, '"Ausblenden" im Abspann: der Abspann laeuft weiter');
  assert.equal(f.tick(ctx(1445)).countdown, null);
  assert.equal(f.paused(), null, 'ohne Countdown nichts');
});

test('Ende der Folge: laeuft der Countdown schon, zaehlt er weiter (Schliessen schliesst dann den Player); ohne naechste Folge schliessen', () => {
  const e = R.createSkipEngine();
  e.reset('x');
  e.tick(ctx(1441));
  assert.deepEqual(e.ended({ hasNext: true, autoplayNext: true }), { action: 'continue' });
  assert.deepEqual(e.countdown, { seconds: 10, inCredits: false });
  assert.deepEqual(e.cancel(), { action: 'close' }, 'am Ende schliesst "Schliessen" den Player');
  const f = R.createSkipEngine();
  f.reset('y');
  assert.deepEqual(f.ended({ hasNext: false, autoplayNext: true }), { action: 'close' });
  assert.deepEqual(f.ended({ hasNext: true, autoplayNext: false }), { action: 'close' });
  const g = R.createSkipEngine();
  g.reset('z');
  assert.deepEqual(g.ended({ hasNext: true, autoplayNext: true }), { action: 'start', seconds: 5, inCredits: false });
  assert.deepEqual(g.countdownFinished(), { action: 'next' });
  assert.equal(g.countdown, null);
});

test('"Ueberspringen" im Abspann mit laufendem Countdown startet die naechste Folge; Neuladen desselben Eintrags verwirft den Countdown ohne Ausblenden', () => {
  const e = R.createSkipEngine();
  e.reset('x');
  e.tick(ctx(1441));
  assert.deepEqual(e.skipPressed(ctx(1442)), { next: true });
  e.dropCountdown();
  assert.equal(e.countdown, null);
  assert.equal(e.tick(ctx(1443)).countdown.action, 'start', 'nicht als ausgeblendet gemerkt');
  const f = R.createSkipEngine();
  f.reset('y');
  assert.deepEqual(f.skipPressed(ctx(1441, { hasNext: false })), { to: 1500, type: 'Outro' }, 'ohne Countdown springt "Ueberspringen" ans Ende des Abspanns');
});

test('Bildformat: Automatisch fuellt bei fast gleichem Seitenverhaeltnis (bis 12 %), sonst einpassen; feste Wahl bleibt', () => {
  assert.equal(R.resolveFormat('auto', 16 / 9, 16 / 10), 'fill', '16:9 auf 16:10');
  assert.equal(R.resolveFormat('auto', 1.85, 16 / 9), 'fill');
  assert.equal(R.resolveFormat('auto', 2.39, 16 / 9), 'fit', 'Breitbild auf 16:9');
  assert.equal(R.resolveFormat('auto', 4 / 3, 16 / 9), 'fit');
  assert.equal(R.resolveFormat('auto', null, 16 / 9), 'fit', 'Video noch unbekannt');
  for (const f of ['fit', 'fill', 'stretch']) assert.equal(R.resolveFormat(f, 2.39, 16 / 9), f);
  assert.equal(R.videoFormat('21:9'), 'auto', 'alte feste Seitenverhaeltnisse gibt es nicht mehr');
});

test('Kleines Bild im Abspann: links, mittig, im Seitenverhaeltnis des Videos; Raender fuer mpv passen genau zur Lage', () => {
  const m = R.miniPicture(1920, 1080, 16 / 9);
  assert.deepEqual(m.rect, { x: 115, y: 292, w: 883, h: 497 });
  const { left, right, top, bottom } = m.margins;
  assert.ok(Math.abs(left * 1920 - 115) < 0.01 && Math.abs((1 - left - right) * 1920 - 883) < 0.01 && Math.abs(top * 1080 - 292) < 0.01 && Math.abs((1 - top - bottom) * 1080 - 497) < 0.01);
  const tall = R.miniPicture(1000, 900, 4 / 3);
  assert.ok(tall.rect.h <= 900 * 0.62 + 1 && Math.abs(tall.rect.w / tall.rect.h - 4 / 3) < 0.01, 'hohe Flaeche: durch die Hoehe begrenzt');
  assert.equal(R.miniPicture(0, 0, 1.7), null);
  assert.ok(Math.abs(R.miniPicture(1920, 1080, null).rect.w / R.miniPicture(1920, 1080, null).rect.h - 16 / 9) < 0.01, 'ohne Seitenverhaeltnis 16:9');
});

test('Uebernahme beim Laden: alter Countdown -> Wartezeit, Rueckblick folgte "Intro automatisch", Unlesbares faellt auf den Standard', () => {
  const load = (player) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-p22-'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 10, deviceId: 'abc', servers: [], settings: { player } }));
    const c = new ConfigStore(dir, { isEncryptionAvailable: () => false });
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    fs.rmSync(dir, { recursive: true, force: true });
    return { p: c.settings.player, disk: disk.settings.player };
  };
  const a = load({ skipIntro: 'auto', skipCountdown: 6 });
  assert.deepEqual([a.p.skipDelay, a.p.skipRecap, 'skipCountdown' in a.p, 'skipCountdown' in a.disk], [5, 'auto', false, false]);
  const b = load({ skipIntro: 'button', skipCountdown: 15 });
  assert.deepEqual([b.p.skipDelay, b.p.skipRecap], [10, 'off']);
  const c = load({ skipCountdown: 0, skipDelay: 8, skipRecap: 'off', skipIntro: 'auto' });
  assert.deepEqual([c.p.skipDelay, c.p.skipRecap], [8, 'off'], 'schon neue Werte: die bleiben');
  const d = load({ skipDelay: 7, skipRecap: 'button', skipOutro: 'x', videoFormat: '21:9' });
  assert.deepEqual([d.p.skipDelay, d.p.skipRecap, d.p.skipOutro, d.p.videoFormat], [5, 'off', 'button', 'auto']);
});
