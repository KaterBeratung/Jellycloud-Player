'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const HR = require('../src/shared/home-rows');
const { ConfigStore, DEFAULT_SETTINGS } = require('../src/main/config');

test('Standardwerte der Startseite: Banner an, 6 Folien, 2 Trend-Folien, nichts umgestellt oder ausgeblendet', () => {
  assert.deepEqual(HR.DEFAULTS, { hero: true, heroSlides: 6, heroTrend: 2, order: [], hidden: [] });
  assert.deepEqual(DEFAULT_SETTINGS.home, HR.DEFAULTS);
  assert.notEqual(DEFAULT_SETTINGS.home, HR.DEFAULTS, 'die Einstellungen haben eine eigene Kopie');
});

test('homeConfig: Grenzen, Typen, doppelte und fremde Eintraege werden bereinigt', () => {
  assert.deepEqual(HR.homeConfig(undefined), HR.DEFAULTS);
  assert.deepEqual(HR.homeConfig(null), HR.DEFAULTS);
  assert.deepEqual(HR.homeConfig('x'), HR.DEFAULTS);
  const c = HR.homeConfig({ hero: false, heroSlides: 99, heroTrend: -5, order: ['continue', 'continue', 7, '', null, 'favorites'], hidden: 'nein' });
  assert.equal(c.hero, false);
  assert.equal(c.heroSlides, 10, 'obere Grenze');
  assert.equal(c.heroTrend, 0, 'untere Grenze');
  assert.deepEqual(c.order, ['continue', 'favorites'], 'Doppelte, Zahlen und leere Eintraege fallen weg');
  assert.deepEqual(c.hidden, [], 'keine Liste: leer');
  assert.equal(HR.homeConfig({ heroSlides: 2 }).heroSlides, 3);
  assert.equal(HR.homeConfig({ heroSlides: 'abc' }).heroSlides, 6, 'keine Zahl: Standard');
  assert.equal(HR.homeConfig({ heroSlides: 4.6 }).heroSlides, 5, 'gerundet');
  assert.equal(HR.homeConfig({ hero: 0 }).hero, true, 'nur ein echtes false schaltet das Banner aus');
  assert.equal(HR.homeConfig({ order: ['x'.repeat(200)] }).order.length, 0, 'zu lange Kennungen fallen weg');
  const many = Array.from({ length: 500 }, (_, i) => `latest:${i}`);
  assert.equal(HR.homeConfig({ order: many }).order.length, 100, 'Liste ist begrenzt');
});

test('defaultOrder: Weiterschauen ganz oben, dann die Neuzugaenge je Bibliothek, dann die uebrigen festen Reihen', () => {
  assert.deepEqual(HR.defaultOrder(['a', 'b']), ['continue', 'latest:a', 'latest:b', 'nextUp', 'favorites', 'trending']);
  assert.deepEqual(HR.defaultOrder([]), ['continue', 'nextUp', 'favorites', 'trending']);
  assert.equal(HR.defaultOrder(['a'])[0], 'continue', 'Weiterschauen steht standardmaessig an erster Stelle');
  assert.deepEqual(HR.TOP_ROWS, ['continue']);
  assert.equal(new Set(HR.defaultOrder(['a', 'b'])).size, 6, 'keine Reihe doppelt');
});

test('arrangeRows: eigene Reihenfolge zuerst, Neues und Unbekanntes sortiert sich sinnvoll ein, Ausgeblendetes fehlt', () => {
  const present = HR.defaultOrder(['a', 'b']);
  assert.deepEqual(HR.arrangeRows(present, [], []), present, 'ohne Wuensche bleibt es die Standardreihenfolge');
  assert.deepEqual(HR.arrangeRows(present, ['favorites', 'continue'], []).slice(0, 3), ['favorites', 'continue', 'latest:a'], 'gewuenschte zuerst, Rest dahinter in Standardreihenfolge');
  assert.deepEqual(HR.arrangeRows(present, [], ['continue', 'trending']), ['latest:a', 'latest:b', 'nextUp', 'favorites']);
  // geloeschte Bibliothek in der Liste: ohne Wirkung; neue Bibliothek c erscheint dahinter (an ihrer Standardstelle unter den Rest)
  const out = HR.arrangeRows(HR.defaultOrder(['a', 'c']), ['latest:gone', 'latest:a', 'trending'], []);
  assert.deepEqual(out, ['latest:a', 'trending', 'continue', 'latest:c', 'nextUp', 'favorites']);
  assert.deepEqual(HR.arrangeRows([], ['continue'], []), [], 'nichts vorhanden');
  assert.deepEqual(HR.arrangeRows(present, ['continue', 'continue'], []).filter((x) => x === 'continue').length, 1, 'doppelte Eintraege erzeugen keine doppelte Reihe');
  assert.equal(HR.arrangeRows(present, [], present).length, 0, 'alles ausgeblendet');
});

test('arrangeAll zeigt auch ausgeblendete Reihen (fuer die Einstellungsliste)', () => {
  const present = HR.defaultOrder(['a']);
  assert.deepEqual(HR.arrangeAll(present, ['nextUp']), ['nextUp', 'continue', 'latest:a', 'favorites', 'trending']);
});

test('moveRow: um einen Platz verschieben, am Rand bleibt es stehen, Unbekanntes aendert nichts', () => {
  const l = ['a', 'b', 'c'];
  assert.deepEqual(HR.moveRow(l, 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(HR.moveRow(l, 'b', 1), ['a', 'c', 'b']);
  assert.deepEqual(HR.moveRow(l, 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(HR.moveRow(l, 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(HR.moveRow(l, 'z', 1), ['a', 'b', 'c']);
  assert.deepEqual(HR.moveRow(l, 'a', 5), ['b', 'c', 'a'], 'weiter als das Ende: ans Ende');
  assert.deepEqual(l, ['a', 'b', 'c'], 'die Eingabe bleibt unveraendert');
});

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-home-'));
  return { dir, s: new ConfigStore(dir, null) };
}

test('Einstellungen: home hat Standardwerte, updateSettings bereinigt und speichert, ein Neustart liest es zurueck', () => {
  const { dir, s } = store();
  assert.deepEqual(s.settings.home, HR.DEFAULTS);
  s.updateSettings({ home: { heroSlides: 8, order: ['favorites', 'continue'], hidden: ['nextUp'], hero: false } });
  assert.equal(s.settings.home.heroSlides, 8);
  assert.equal(s.settings.home.hero, false);
  assert.deepEqual(s.settings.home.order, ['favorites', 'continue']);
  s.updateSettings({ home: { heroSlides: 500, hidden: ['a', 'a', 5] } });
  assert.equal(s.settings.home.heroSlides, 10, 'ungueltiger Wert wird auf die Grenze gesetzt');
  assert.deepEqual(s.settings.home.hidden, ['a'], 'doppelte und fremde Eintraege fallen weg');
  assert.deepEqual(s.settings.home.order, ['favorites', 'continue'], 'nicht genannte Teile bleiben');
  const again = new ConfigStore(dir, null);
  assert.equal(again.settings.home.heroSlides, 10);
  assert.deepEqual(again.settings.home.order, ['favorites', 'continue']);
});

test('Einstellungen: eine von Hand zerlegte Datei wirft nichts und ergibt gueltige Werte', () => {
  const { dir } = store();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ version: 9, settings: { home: { hero: 'ja', heroSlides: 'viele', heroTrend: 77, order: { a: 1 }, hidden: [1, 'x', 'x'] } } }));
  const s = new ConfigStore(dir, null);
  assert.deepEqual(s.settings.home, { hero: true, heroSlides: 6, heroTrend: 4, order: [], hidden: ['x'] });
  fs.writeFileSync(file, JSON.stringify({ version: 9, settings: { appearance: { homeTrending: false } } }));
  assert.deepEqual(new ConfigStore(dir, null).settings.home, HR.DEFAULTS, 'alte Datei ohne home: Standardwerte');
});

test('Einstellungen zuruecksetzen: die Startseite kehrt zu den Standardwerten zurueck', () => {
  const { s } = store();
  s.updateSettings({ home: { hero: false, order: ['favorites'] } });
  s.resetSettings();
  assert.deepEqual(s.settings.home, HR.DEFAULTS);
});
