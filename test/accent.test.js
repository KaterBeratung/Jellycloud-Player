'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_ACCENT, hexToRgb, luminance, contrast, resolveAccent } = require('../src/shared/accent');

const DARK = '#08080a';
const LIGHT = '#f2f3f7';

test('Standard-Akzent ist ein neutrales Silberweiss', () => {
  assert.equal(DEFAULT_ACCENT, '#f5f5f7');
  const [r, g, b] = hexToRgb(DEFAULT_ACCENT);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 16, 'neutral (kaum Farbanteil)');
});

test('Silberweiss auf dunklem Theme: helle Flaeche, dunkle Schrift, abgedunkelte Tonung', () => {
  const c = resolveAccent(DEFAULT_ACCENT, { bg: DARK });
  assert.deepEqual(c.accent, [245, 245, 247]);
  assert.equal(c.ink, '#12131a', 'dunkle Schrift auf heller Flaeche');
  assert.ok(luminance(c.tint) < 0.4 && luminance(c.tint) > 0.1, 'Tonung mittelgrau, damit weisse Schrift darauf lesbar bleibt');
  assert.ok(contrast(luminance(c.fg), luminance(hexToRgb(DARK))) >= 4.5, 'Text in Akzentfarbe lesbar');
});

test('Neutraler Akzent passt sich dem Theme an (Weiss auf hellem Theme wird dunkel)', () => {
  const day = resolveAccent('#ffffff', { bg: LIGHT });
  assert.deepEqual(day.accent, [29, 29, 31]);
  assert.equal(day.ink, '#ffffff');
  assert.ok(contrast(luminance(day.fg), luminance(hexToRgb(LIGHT))) >= 4.5);
  const night = resolveAccent('#000000', { bg: DARK });
  assert.deepEqual(night.accent, [245, 245, 247], 'Schwarz auf dunklem Theme wird hell');
});

test('Farbige Akzente bleiben unveraendert, Text in Akzentfarbe wird bei Bedarf aufgehellt', () => {
  const blue = resolveAccent('#0b2dbf', { bg: DARK });
  assert.deepEqual(blue.accent, [11, 45, 191]);
  assert.deepEqual(blue.tint, [11, 45, 191]);
  assert.equal(blue.ink, '#ffffff');
  assert.ok(contrast(luminance(blue.fg), luminance(hexToRgb(DARK))) >= 4.5);
  assert.ok(luminance(blue.fg) > luminance(blue.accent), 'dunkles Blau wird fuer Text aufgehellt');
});

test('Helle farbige Akzente (Gelb): dunkle Schrift und abgedunkelte Tonung', () => {
  const y = resolveAccent('#f5c518', { bg: DARK });
  assert.equal(y.ink, '#12131a');
  assert.ok(luminance(y.tint) < luminance(y.accent));
});

test('Ungueltige Eingaben ergeben den Standard', () => {
  assert.deepEqual(resolveAccent('kein-hex', { bg: DARK }).accent, [245, 245, 247]);
  assert.deepEqual(resolveAccent(undefined).accent, [245, 245, 247]);
  assert.equal(hexToRgb('#12'), null);
});
