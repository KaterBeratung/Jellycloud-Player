'use strict';
/**
 * Staende bei Seerr (src/shared/seerr-state.js), Werte nach Seerr 3.5.1: 6 gesperrt, 7 geloescht. Faelle aus
 * JellycloudTests/SeerrMediaStateTests.swift der Apple-App (Teil "anfragbar, vorhanden, vergeben").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SEERR_MEDIA, isRequestable, isPresent, isTaken, isBlocklisted } = require('../src/shared/seerr-state');

test('Werte wie bei Seerr 3.5.1: 6 gesperrt, 7 geloescht', () => {
  assert.equal(SEERR_MEDIA.BLOCKLISTED, 6);
  assert.equal(SEERR_MEDIA.DELETED, 7);
  assert.ok(Object.isFrozen(SEERR_MEDIA));
});

test('Anfragbar nur ohne Stand und nach dem Loeschen; nie gesperrt, nie ein unbekannter Wert', () => {
  for (const s of [0, 1, 7, null, undefined, '7']) assert.equal(isRequestable(s), true, `anfragbar: ${s}`);
  for (const s of [2, 3, 4, 5, 6, 8, 99, -1, 'x']) assert.equal(isRequestable(s), false, `nicht anfragbar: ${s}`);
});

test('Gegenprobe zum Fehler bis 1.1.6: gesperrt (6) nicht anfragbar, geloescht (7) anfragbar', () => {
  const old = (s) => s <= 1 || s === 6; // die alte Regel der Ansichten
  assert.notEqual(old(6), isRequestable(6));
  assert.notEqual(old(7), isRequestable(7));
});

test('Vorhanden (4, 5), vergeben (2 bis 5), gesperrt (6)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(isPresent), [4, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(isTaken), [2, 3, 4, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].filter(isBlocklisted), [6]);
});
