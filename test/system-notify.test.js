'use strict';

// Mitteilungen des Systems unter Windows (src/main/system-notify.js, Plan P18) mit einer Attrappe statt der Notification von Electron: Zeigen ohne Ton bei
// vorderem Fenster, dieselbe Kennung ersetzt, Zuruecknehmen einzeln und je Profil, Antippen liefert das Ziel, ungueltiges faellt weg.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SystemNotifier, KEEP } = require('../src/main/system-notify');

function fakeElectron() {
  const made = [];
  const create = (options) => {
    const handlers = {};
    const n = {
      options,
      shown: false,
      closed: false,
      on: (ev, cb) => (handlers[ev] = cb),
      show: () => (n.shown = true),
      close: () => (n.closed = true),
      emit: (ev) => handlers[ev]?.()
    };
    made.push(n);
    return n;
  };
  return { made, create };
}
const msg = (key, id, extra = {}) => ({ id: `${key}.${id}`, title: 'Anfrage genehmigt', body: '„Film“ wurde genehmigt und wird jetzt beschafft.', preview: 'Neuigkeit zu einer Anfrage', target: { id, mediaType: 'movie', tmdbId: 5, title: 'Film', profile: key }, ...extra });

test('Zeigen: Titel und Text der App; ohne Ton, wenn das Fenster vorn ist; dieselbe Kennung ersetzt die alte', () => {
  const e = fakeElectron();
  let front = false;
  const n = new SystemNotifier({ create: e.create, isForeground: () => front });
  n.show([msg('aaaaaaaaaaaa', 'seerr-1-approved')]);
  assert.equal(e.made.length, 1);
  assert.deepEqual(e.made[0].options, { title: 'Anfrage genehmigt', body: '„Film“ wurde genehmigt und wird jetzt beschafft.', silent: false });
  assert.ok(e.made[0].shown);
  front = true;
  n.show([msg('aaaaaaaaaaaa', 'seerr-1-approved')]);
  assert.ok(e.made[0].closed, 'die alte ist weg');
  assert.equal(e.made[1].options.silent, true, 'App vorn: ohne Ton');
  assert.equal(n.shown.size, 1);
});

test('Zuruecknehmen: einzeln (gelesen, entfernt) und alle eines Profils; unbekannte Kennungen aendern nichts', () => {
  const e = fakeElectron();
  const n = new SystemNotifier({ create: e.create });
  n.show([msg('aaaaaaaaaaaa', 'seerr-1-approved'), msg('aaaaaaaaaaaa', 'seerr-2-available'), msg('bbbbbbbbbbbb', 'seerr-1-approved')]);
  n.withdraw(['aaaaaaaaaaaa.seerr-1-approved', 'aaaaaaaaaaaa.seerr-9-failed']);
  assert.deepEqual(e.made.map((x) => x.closed), [true, false, false]);
  n.withdrawProfile('aaaaaaaaaaaa');
  assert.deepEqual(e.made.map((x) => x.closed), [true, true, false], 'die des anderen Profils bleibt');
  assert.deepEqual([...n.shown.keys()], ['bbbbbbbbbbbb.seerr-1-approved']);
});

test('Antippen liefert das Ziel (ungeprueft: ob es zum aktiven Profil gehoert, entscheidet die Rueckseite)', () => {
  const e = fakeElectron();
  const clicks = [];
  const n = new SystemNotifier({ create: e.create, onClick: (t) => clicks.push(t) });
  n.show([msg('aaaaaaaaaaaa', 'seerr-1-approved')]);
  e.made[0].emit('click');
  assert.deepEqual(clicks, [{ id: 'seerr-1-approved', mediaType: 'movie', tmdbId: 5, title: 'Film', profile: 'aaaaaaaaaaaa' }]);
});

test('Ungueltige Mitteilungen fallen weg; ohne Mitteilungen im System nichts; hoechstens so viele, wie die App Eintraege hat', () => {
  const e = fakeElectron();
  const n = new SystemNotifier({ create: e.create });
  n.show([{ id: 'https://server|nutzer.seerr-1-approved', title: 'x', body: 'y' }, { id: 'aaaaaaaaaaaa.seerr-1-approved', title: 5, body: 'y' }, null]);
  assert.equal(e.made.length, 0);
  const off = new SystemNotifier({ create: e.create, isSupported: () => false });
  off.show([msg('aaaaaaaaaaaa', 'seerr-1-approved')]);
  assert.equal(e.made.length, 0);
  assert.deepEqual(off.status(), { supported: false, permission: 'unsupported', settings: false });
  assert.deepEqual(n.status(), { supported: true, permission: 'unknown', settings: true }, 'Windows sagt nicht, ob es sie zeigt');
  assert.deepEqual(n.request(), n.status(), 'und fragt nicht nach einer Erlaubnis');
  n.show(Array.from({ length: KEEP + 5 }, (_, i) => msg('aaaaaaaaaaaa', `seerr-${i + 1}-approved`)));
  assert.equal(n.shown.size, KEEP);
  assert.ok(e.made[0].closed && !e.made.at(-1).closed, 'die aeltesten gehen zuerst');
});

test('Ein Fehler des Systems beim Zeigen haelt die uebrigen nicht auf', () => {
  let i = 0;
  const e = fakeElectron();
  const n = new SystemNotifier({ create: (o) => (++i === 1 ? (() => { throw new Error('kaputt'); })() : e.create(o)) });
  n.show([msg('aaaaaaaaaaaa', 'seerr-1-approved'), msg('aaaaaaaaaaaa', 'seerr-2-approved')]);
  assert.equal(e.made.length, 1);
  assert.deepEqual([...n.shown.keys()], ['aaaaaaaaaaaa.seerr-2-approved']);
});
