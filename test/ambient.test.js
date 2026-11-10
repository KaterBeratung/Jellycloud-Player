'use strict';
// Farblogik des Hintergrundtons (Renderer-Module sind ES-Module, daher dynamischer Import)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', name)).href);
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const encode83 = (n, len) => {
  let s = '';
  for (let i = 0; i < len; i++) {
    s = DIGITS[n % 83] + s;
    n = Math.floor(n / 83);
  }
  return s;
};

test('blurhashColor: Durchschnittsfarbe steckt im DC-Anteil', async () => {
  const { blurhashColor } = await load('blurhash.js');
  const hash = `LE${encode83((200 << 16) | (100 << 8) | 50, 4)}abcdefghijklmnopqr`;
  assert.deepEqual(blurhashColor(hash), [200, 100, 50]);
  assert.deepEqual(blurhashColor('LEHV6nWB2yk8pyo0adR*.7kCMdnj'), [151, 150, 149], 'Beispiel-Hash aus der Blurhash-Dokumentation, erwartete Farbe nach der DC-Formel von Hand gerechnet');
});

test('blurhashColor: ungueltige Eingaben ergeben null', async () => {
  const { blurhashColor } = await load('blurhash.js');
  assert.equal(blurhashColor(null), null);
  assert.equal(blurhashColor(undefined), null);
  assert.equal(blurhashColor('LEHV'), null, 'zu kurz');
  assert.equal(blurhashColor('LE  !!abc'), null, 'Zeichen ausserhalb des Alphabets');
});

test('rgbToHsl und hslToRgb sind zueinander invers', async () => {
  const { rgbToHsl, hslToRgb } = await load('color.js');
  for (const c of [[200, 100, 50], [10, 200, 120], [90, 60, 220], [255, 0, 0], [128, 128, 128], [0, 0, 0]]) {
    const back = hslToRgb(rgbToHsl(c));
    c.forEach((v, i) => assert.ok(Math.abs(v - back[i]) <= 1, `${c} -> ${back}`));
  }
});

test('vivid: dunkle farbige Durchschnittswerte werden tragfaehig, Grau bleibt neutral', async () => {
  const { vivid, rgbToHsl } = await load('color.js');
  const [h0] = rgbToHsl([40, 12, 30]);
  const [h, s, l] = rgbToHsl(vivid([40, 12, 30]));
  assert.ok(Math.abs(h - h0) < 0.01, 'Farbton bleibt');
  assert.ok(s >= 0.4 && s <= 0.71, `Saettigung ${s}`);
  assert.ok(Math.abs(l - 0.5) < 0.02, `Helligkeit ${l}`);
  const [, sg] = rgbToHsl(vivid([120, 120, 120]));
  assert.ok(sg < 0.02, 'Grau wird nicht kuenstlich eingefaerbt');
});
