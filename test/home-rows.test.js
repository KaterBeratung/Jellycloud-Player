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

test('defaultOrder wie in der Apple-App: Weiterschauen und Als Naechstes ganz oben, dann die Top 10, dann Neu in ... je Bibliothek, Favoriten, Filme im Trend', () => {
  assert.deepEqual(HR.defaultOrder(['a', 'b']), ['continue', 'nextUp', 'top10Movies', 'top10Series', 'latest:a', 'latest:b', 'favorites', 'trending']);
  assert.deepEqual(HR.defaultOrder([]), ['continue', 'nextUp', 'top10Movies', 'top10Series', 'favorites', 'trending']);
  assert.deepEqual(HR.defaultOrder(undefined), HR.defaultOrder([]));
  assert.deepEqual(HR.TOP_ROWS, ['continue', 'nextUp'], 'die naechste Folge gehoert direkt unter Weiterschauen');
  assert.deepEqual(HR.RANKING_ROWS, ['top10Movies', 'top10Series']);
  assert.deepEqual([...HR.SEERR_ROWS].sort(), ['top10Movies', 'top10Series', 'trending'], 'nur diese gibt es allein mit Seerr');
  assert.equal(new Set(HR.defaultOrder(['a', 'b'])).size, 8, 'keine Reihe doppelt');
});

test('arrangeRows: eigene Reihenfolge zuerst; eine Reihe, die darin fehlt, steht hinter ihrem Vorgaenger der Standardfolge; Ausgeblendetes fehlt', () => {
  const present = HR.defaultOrder(['a', 'b']);
  assert.deepEqual(HR.arrangeRows(present, [], []), present, 'ohne Wuensche bleibt es die Standardreihenfolge');
  // Favoriten nach oben geschoben: alles andere bleibt in seiner Folge, hinter dem jeweiligen Vorgaenger
  assert.deepEqual(HR.arrangeRows(present, ['favorites', 'continue'], []), ['favorites', 'trending', 'continue', 'nextUp', 'top10Movies', 'top10Series', 'latest:a', 'latest:b']);
  assert.deepEqual(HR.arrangeRows(present, [], ['continue', 'trending']), ['nextUp', 'top10Movies', 'top10Series', 'latest:a', 'latest:b', 'favorites']);
  assert.deepEqual(HR.arrangeRows([], ['continue'], []), [], 'nichts vorhanden');
  assert.deepEqual(HR.arrangeRows(present, ['continue', 'continue'], []).filter((x) => x === 'continue').length, 1, 'doppelte Eintraege erzeugen keine doppelte Reihe');
  assert.equal(HR.arrangeRows(present, [], present).length, 0, 'alles ausgeblendet');
});

test('Eine neue Reihe (neue Bibliothek) steht hinter der Reihe, hinter der sie in der Standardfolge stuende, nicht am Ende (N7)', () => {
  // Der Nutzer hat geordnet: Neu in a ganz oben, dann Weiterschauen, Als Naechstes, Favoriten, Trend. Jetzt kommt Bibliothek c dazu.
  const order = ['latest:a', 'continue', 'nextUp', 'favorites', 'trending'];
  const present = ['continue', 'nextUp', 'latest:a', 'latest:c', 'favorites', 'trending'];
  assert.deepEqual(HR.arrangeAll(present, order), ['latest:a', 'latest:c', 'continue', 'nextUp', 'favorites', 'trending'], 'c steht gleich hinter a (bis 1.2.4: ganz unten)');
  // Ohne Vorgaenger mit Platz (die neue Reihe steht in der Standardfolge ganz vorn): ganz vorn
  assert.deepEqual(HR.arrangeAll(['continue', 'latest:a'], ['latest:a']), ['continue', 'latest:a']);
  // Geloeschte Bibliothek in der Liste: ohne Wirkung
  assert.deepEqual(HR.arrangeAll(['continue', 'latest:a'], ['latest:gone', 'latest:a', 'continue']), ['latest:a', 'continue']);
  // Gegenprobe zur Regel bis 1.2.4 ("Rest ans Ende"): sie ergibt hier etwas anderes
  const old = (p, o) => [...o.filter((id) => p.includes(id)), ...p.filter((id) => !o.includes(id))];
  assert.notDeepEqual(old(present, order), HR.arrangeAll(present, order));
});

test('arrangeAll zeigt auch ausgeblendete Reihen (fuer die Einstellungsliste)', () => {
  const present = ['continue', 'nextUp', 'latest:a', 'favorites', 'trending'];
  assert.deepEqual(HR.arrangeAll(present, ['nextUp']), ['continue', 'nextUp', 'latest:a', 'favorites', 'trending'], 'Weiterschauen hat keinen Vorgaenger: ganz vorn');
  assert.deepEqual(HR.arrangeAll(present, ['trending', 'continue']), ['trending', 'continue', 'nextUp', 'latest:a', 'favorites']);
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
