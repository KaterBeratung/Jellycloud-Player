'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ImageCache } = require('../src/main/image-cache');

const img = (n, type = 'image/jpeg') => ({ buf: Buffer.alloc(n), type });

test('Ablegen und Abrufen: Bild und Typ kommen unveraendert zurueck, die Summe stimmt', () => {
  const c = new ImageCache(1000);
  assert.equal(c.put('a', img(100, 'image/png')), true);
  assert.equal(c.get('a').type, 'image/png');
  assert.equal(c.get('a').buf.length, 100);
  assert.equal(c.get('fehlt'), undefined);
  assert.equal(c.size, 1);
  assert.equal(c.bytes, 100);
});

test('Dasselbe Bild zweimal abgelegt (zwei gleichzeitige Anfragen): es zaehlt einmal, die Summe driftet nicht', () => {
  const c = new ImageCache(1000);
  c.put('a', img(300));
  c.put('a', img(300));
  c.put('a', img(300));
  assert.equal(c.size, 1);
  assert.equal(c.bytes, 300, 'vorher wuchs die Summe mit jedem Ablegen, die Verdraengung setzte zu frueh ein');
  c.put('a', img(120));
  assert.equal(c.bytes, 120, 'ein kleineres Bild unter demselben Schluessel ersetzt das alte');
  c.clear();
  assert.equal(c.bytes, 0);
  assert.equal(c.size, 0);
});

test('Ueber der Obergrenze fliegt das aelteste Bild raus, das neue bleibt', () => {
  const c = new ImageCache(250);
  c.put('a', img(100));
  c.put('b', img(100));
  c.put('c', img(100)); // 300 > 250: a muss weichen
  assert.equal(c.get('a'), undefined);
  assert.ok(c.get('b') && c.get('c'));
  assert.equal(c.bytes, 200);
});

test('Wer benutzt wird, bleibt: ein Abruf rueckt das Bild ans Ende der Verdraengungsreihenfolge', () => {
  const c = new ImageCache(250);
  c.put('a', img(100));
  c.put('b', img(100));
  c.get('a'); // a ist jetzt das juengste
  c.put('c', img(100));
  assert.ok(c.get('a'), 'a wurde zuletzt benutzt und bleibt');
  assert.equal(c.get('b'), undefined, 'b war am laengsten unbenutzt');
});

test('Zu grosse Einzelbilder werden nicht abgelegt und verdraengen nichts; ein altes Bild gleichen Namens verschwindet', () => {
  const c = new ImageCache(10_000, 500);
  c.put('klein', img(100));
  assert.equal(c.put('gross', img(501)), false);
  assert.equal(c.get('gross'), undefined);
  assert.ok(c.get('klein'));
  c.put('x', img(100));
  assert.equal(c.put('x', img(900)), false);
  assert.equal(c.get('x'), undefined, 'das veraltete Bild unter diesem Schluessel wird nicht weiter ausgeliefert');
  assert.equal(c.bytes, 100);
});

test('Ein einzelnes Bild groesser als die Obergrenze bleibt als einziges stehen (kein Absturz, keine leere Schleife)', () => {
  const c = new ImageCache(50, 1000);
  c.put('a', img(40));
  c.put('b', img(200));
  assert.equal(c.size, 1);
  assert.ok(c.get('b'));
});
