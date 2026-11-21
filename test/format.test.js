'use strict';
/**
 * Schreibweisen der Angabenzeilen (src/shared/format.js). Faelle aus JellycloudTests/FormatTests.swift der Apple-App, dazu die angefragten
 * Staffeln als Bereiche (Format.seasons(_ numbers:)), Uhrzeit und Englisch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/shared/format');

test('Laufzeit: unter einer Stunde in Minuten, sonst Stunden und Minuten; ohne Laufzeit nichts', () => {
  assert.equal(F.runtime(45 * 60), '45 Min.');
  assert.equal(F.runtime(130 * 60), '2 Std. 10 Min.');
  assert.equal(F.runtime(148 * 60), '2 Std. 28 Min.', 'das Seerr-Fenster zeigte hier "148 Min."');
  assert.equal(F.runtime(0), null);
  assert.equal(F.runtime(null), null);
  assert.equal(F.runtime(undefined), null);
  assert.equal(F.runtime('x'), null);
  assert.equal(F.runtime(-60), null);
  assert.equal(F.runtime(120 * 60), '2 Std.', 'volle Stunden ohne "0 Min."');
  assert.equal(F.runtime(20), '1 Min.', 'unter einer Minute: 1 Min. (nicht 0)');
  assert.equal(F.runtime(59.6 * 60), '1 Std.', 'gerundet');
  assert.equal(F.runtime(130 * 60, 'en'), '2 h 10 min');
  assert.equal(F.runtime(45 * 60, 'en-US'), '45 min');
});

test('Staffeln und Bewertung', () => {
  assert.equal(F.seasonCount(1), '1 Staffel');
  assert.equal(F.seasonCount(4), '4 Staffeln');
  assert.equal(F.seasonCount(1, 'en'), '1 season');
  assert.equal(F.seasonCount(8, 'en'), '8 seasons');
  assert.equal(F.seasonCount(0), '');
  assert.equal(F.seasonCount(null), '');
  assert.equal(F.rating(8.06), '★ 8.1');
  assert.equal(F.rating(7), '★ 7.0');
  assert.equal(F.rating(0), '', 'ohne Bewertung nichts');
  assert.equal(F.rating(null), '');
  assert.equal(F.score(7.25), '7.3');
  assert.equal(F.score('x'), '');
});

test('Folge: Staffel, Nummer und Name; was fehlt, entfaellt samt Trennzeichen', () => {
  const episode = { Name: 'Der Anfang', Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 5 };
  assert.equal(F.episodeNumbers(episode), 'S2 · E5');
  assert.equal(F.episodeLabel(episode), 'S2 · E5 · Der Anfang');
  assert.equal(F.episodeLabel({ ...episode, Name: null }), 'S2 · E5');
  assert.equal(F.episodeLabel({ Name: 'Hinter den Kulissen', Type: 'Episode', IndexNumber: 1 }), 'E1 · Hinter den Kulissen');
  assert.equal(F.episodeLabel({ Name: 'Nur Name', Type: 'Episode' }), 'Nur Name');
  assert.equal(F.episodeNumbers({ ParentIndexNumber: 0, IndexNumber: 3 }), 'S0 · E3', 'Specials (Staffel 0) bleiben');
  assert.equal(F.episodeLabel(null), '');
});

test('Angefragte Staffeln: einzeln, als Liste, drei und mehr aufeinanderfolgende als Bereich; Doppelte und Unsinn fallen weg', () => {
  assert.equal(F.seasonList([3]), 'Staffel 3');
  assert.equal(F.seasonList([2, 1]), 'Staffeln 1, 2');
  assert.equal(F.seasonList(Array.from({ length: 20 }, (_, i) => i + 1)), 'Staffeln 1–20', 'bei 20 Staffeln war der Rest abgeschnitten');
  assert.equal(F.seasonList([9, 1, 2, 3, 5, 7, 8, 3]), 'Staffeln 1–3, 5, 7–9');
  assert.equal(F.seasonList([1, 2, 4, 5]), 'Staffeln 1, 2, 4, 5', 'zwei aufeinanderfolgende bleiben einzeln');
  assert.equal(F.seasonList([]), '');
  assert.equal(F.seasonList('kaputt'), '');
  assert.equal(F.seasonList([1, 'x', null, -2]), 'Staffel 1');
  assert.equal(F.seasonList([1, 2, 3], 'en'), 'Seasons 1–3');
});

test('Uhrzeit: Minuten und Sekunden, ab einer Stunde mit Stunden', () => {
  assert.equal(F.clock(65), '1:05');
  assert.equal(F.clock(3725), '1:02:05');
  assert.equal(F.clock(0), '0:00');
  assert.equal(F.clock(-5), '0:00');
  assert.equal(F.clock(undefined), '0:00');
  assert.equal(F.clock(59.9), '0:59');
});

test('Art eines Eintrags in einem Wort; Unbekanntes heisst Film', () => {
  assert.deepEqual(['Movie', 'Series', 'Episode', 'Season', 'BoxSet', 'Video'].map((k) => F.kindName(k)), ['Film', 'Serie', 'Folge', 'Staffel', 'Kollektion', 'Film']);
  assert.equal(F.kindName('Series', 'en'), 'Show');
});
