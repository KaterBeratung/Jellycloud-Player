'use strict';

// Hauptnavigation und Bibliotheken je Reiter (Plan P9, N1 und M1; wie MainTab.navigation und LibraryTab.own der Apple-App): src/shared/nav.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Nav = require('../src/shared/nav');

const lib = (Id, CollectionType) => ({ Id, CollectionType, Name: Id });

test('Immer fuenf Reiter in fester Reihenfolge: Start, Filme, Serien, Anfragen, Suche (keine Einstellungen)', () => {
  assert.deepEqual(Nav.TABS.map((x) => x.key), ['home', 'movies', 'shows', 'requests', 'search']);
  assert.deepEqual(Nav.TABS.map((x) => x.path), ['/home', '/movies', '/shows', '/requests', '/search']);
  assert.deepEqual(Nav.TABS.map((x) => x.glow), ['home', 'movies', 'series', 'requests', 'search'], 'jeder Reiter mit dem Bereich des Ambient Glow der Apple-App');
  assert.ok(Object.isFrozen(Nav.TABS) && Nav.TABS.every(Object.isFrozen), 'unveraenderlich: eine Seite kann die Leiste nicht verbiegen');
  // Jede Beschriftung gibt es auf Deutsch und Englisch
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'i18n.js'), 'utf8');
  for (const tab of Nav.TABS) assert.equal(i18n.split(`'${tab.label}':`).length - 1, 2, `${tab.label} fehlt in einer Sprache`);
});

test('Strg+1 bis Strg+5 waehlen die Reiter, andere Tasten nichts', () => {
  assert.deepEqual(['1', '2', '3', '4', '5'].map((d) => Nav.tabForDigit(d).key), ['home', 'movies', 'shows', 'requests', 'search']);
  for (const k of ['0', '6', '9', 'k', '', undefined]) assert.equal(Nav.tabForDigit(k), null, String(k));
});

test('Filme: Bibliotheken der Art, ohne Art und gemischte; Heim- und Musikvideos (Windows/Android); Kollektionen zuletzt', () => {
  const views = [lib('kol', 'boxsets'), lib('f1', 'movies'), lib('s1', 'tvshows'), lib('mix', 'mixed'), lib('ohne', null), lib('heim', 'homevideos'), lib('musik', 'music'), lib('f2', 'movies'), lib('mv', 'musicvideos'), lib('buch', 'books'), lib('leer', '')];
  assert.deepEqual(Nav.ownLibraries(views, 'movies').map((v) => v.Id), ['f1', 'mix', 'ohne', 'f2', 'leer', 'heim', 'mv', 'kol']);
  assert.deepEqual(Nav.ownLibraries(views, 'shows').map((v) => v.Id), ['s1', 'mix']);
  assert.deepEqual(Nav.ownLibraries(views, 'requests'), [], 'nur Filme und Serien haben Bibliotheken');
});

test('Ohne passende Bibliothek oder mit kaputter Liste: leer, nichts wirft', () => {
  assert.deepEqual(Nav.ownLibraries([lib('s1', 'tvshows')], 'movies'), []);
  assert.deepEqual(Nav.ownLibraries(null, 'movies'), []);
  assert.deepEqual(Nav.ownLibraries([null, { Name: 'ohne Id' }, lib('f1', 'movies')], 'movies').map((v) => v.Id), ['f1']);
});

test('Gewaehlte Bibliothek: die gemerkte, wenn es sie noch gibt, sonst die erste', () => {
  const own = [lib('f1', 'movies'), lib('f2', 'movies'), lib('kol', 'boxsets')];
  assert.equal(Nav.pickLibrary(own, 'f2').Id, 'f2');
  assert.equal(Nav.pickLibrary(own, 'weg').Id, 'f1', 'entfernte Bibliothek: die erste');
  assert.equal(Nav.pickLibrary(own, null).Id, 'f1');
  assert.equal(Nav.pickLibrary([], 'f1'), null);
});
