'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_ACCENT, SWATCHES, hexToRgb, luminance, contrast, resolveAccent } = require('../src/shared/accent');

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

// Farbfelder wie in der Apple-App (Theme.swift, ResolvedAccent.swatches)
test('Farbfelder: dieselben acht wie in der Apple-App, Silber (der Standard) zuerst, unveraenderlich', () => {
  assert.deepEqual(SWATCHES.map((s) => s.hex), ['#f5f5f7', '#4169e1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6']);
  assert.deepEqual(SWATCHES.map((s) => s.id), ['silver', 'royalBlue', 'violet', 'pink', 'red', 'orange', 'green', 'teal']);
  assert.equal(SWATCHES[0].hex, DEFAULT_ACCENT);
  assert.ok(Object.isFrozen(SWATCHES) && SWATCHES.every((s) => Object.isFrozen(s)));
});

test('Jedes Farbfeld: Schrift in Akzentfarbe ist in allen vier Designs lesbar (mindestens 4,5:1)', () => {
  for (const bg of ['#08080a', '#131314', '#000000', '#0c1426']) {
    for (const s of SWATCHES) {
      const c = resolveAccent(s.hex, { bg });
      assert.ok(contrast(luminance(c.fg), luminance(hexToRgb(bg))) >= 4.5, `${s.id} auf ${bg}`);
    }
  }
});

test('Jedes Farbfeld hat einen Namen auf Deutsch und Englisch (i18n accent.<id>)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'i18n.js'), 'utf8');
  for (const s of SWATCHES) assert.equal(src.split(`'accent.${s.id}':`).length - 1, 2, s.id);
});

test('Ungueltige Eingaben ergeben den Standard', () => {
  assert.deepEqual(resolveAccent('kein-hex', { bg: DARK }).accent, [245, 245, 247]);
  assert.deepEqual(resolveAccent(undefined).accent, [245, 245, 247]);
  assert.equal(hexToRgb('#12'), null);
});
