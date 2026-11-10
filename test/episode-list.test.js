'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEpisodeList, nextEpisode, MAX_EPISODES } = require('../src/main/episode-list');
const { skipCountdownSec, DEFAULT_SETTINGS } = require('../src/main/config');

const ep = (n, o = {}) => ({ Id: `e${n}`, Name: `Folge ${n}`, IndexNumber: n, ParentIndexNumber: 1, SeasonName: 'Staffel 1', RunTimeTicks: 2700 * 1e7, ImageTags: { Primary: `t${n}` }, UserData: { Played: false, PlaybackPositionTicks: 0 }, ...o });

test('buildEpisodeList: behaelt nur, was die Liste braucht, in der Reihenfolge des Servers', () => {
  const list = buildEpisodeList([ep(1), ep(2, { ParentIndexNumber: 2, SeasonName: 'Buch Zwei' })]);
  assert.deepEqual(list[0], { id: 'e1', season: 1, seasonName: 'Staffel 1', index: 1, name: 'Folge 1', runSec: 2700, posSec: 0, played: false, tag: 't1', spoiler: false });
  assert.equal(list[1].season, 2);
  assert.equal(list[1].seasonName, 'Buch Zwei');
  assert.deepEqual(list.map((e) => e.id), ['e1', 'e2']);
  assert.equal(Object.keys(list[0]).length, 10, 'kein Feld mehr als noetig (Beschreibung, Medienangaben ... bleiben weg)');
});

test('buildEpisodeList: gesehen, angefangen, Specials (Staffel 0) und fehlende Angaben', () => {
  const list = buildEpisodeList([
    ep(1, { UserData: { Played: true, PlaybackPositionTicks: 0 } }),
    ep(2, { UserData: { Played: false, PlaybackPositionTicks: 600 * 1e7 } }),
    ep(3, { ParentIndexNumber: 0, SeasonName: 'Specials' }),
    { Id: 'x', Name: 'Ohne alles' }
  ]);
  assert.equal(list[0].played, true);
  assert.equal(list[1].posSec, 600);
  assert.equal(list[2].season, 0, 'Staffel 0 bleibt 0 (nicht null)');
  assert.deepEqual({ season: list[3].season, index: list[3].index, runSec: list[3].runSec, posSec: list[3].posSec, tag: list[3].tag, seasonName: list[3].seasonName }, { season: null, index: null, runSec: 0, posSec: 0, tag: null, seasonName: '' });
});

test('buildEpisodeList: Spoiler-Schutz verwischt nur ungesehene, nicht angefangene Folgen', () => {
  const eps = [ep(1, { UserData: { Played: true } }), ep(2, { UserData: { Played: false, PlaybackPositionTicks: 5 * 1e7 } }), ep(3)];
  assert.deepEqual(buildEpisodeList(eps, { spoilerProtection: true }).map((e) => e.spoiler), [false, false, true]);
  assert.deepEqual(buildEpisodeList(eps, { spoilerProtection: false }).map((e) => e.spoiler), [false, false, false]);
});

test('buildEpisodeList: kaputte Eingaben, lange Namen und Obergrenze', () => {
  assert.deepEqual(buildEpisodeList(null), []);
  assert.deepEqual(buildEpisodeList('x'), []);
  assert.deepEqual(buildEpisodeList([null, 5, {}, { Id: '' }, { Id: 7 }]), []);
  assert.equal(buildEpisodeList([ep(1, { Name: 'x'.repeat(500) })])[0].name.length, 140);
  assert.equal(buildEpisodeList([ep(1, { ImageTags: { Primary: 5 } })])[0].tag, null, 'Bild-Kennung nur als Text');
  const many = Array.from({ length: MAX_EPISODES + 50 }, (_, i) => ep(i + 1));
  assert.equal(buildEpisodeList(many).length, MAX_EPISODES);
});

test('nextEpisode: die Folge danach, auch ueber die Staffelgrenze, am Ende null', () => {
  const eps = [ep(1), ep(2), ep(3, { ParentIndexNumber: 2 })];
  assert.equal(nextEpisode(eps, 'e1').Id, 'e2');
  assert.equal(nextEpisode(eps, 'e2').Id, 'e3');
  assert.equal(nextEpisode(eps, 'e3'), null);
  assert.equal(nextEpisode(eps, 'unbekannt'), null);
  assert.equal(nextEpisode(null, 'e1'), null);
});

test('skipCountdownSec: Standard 6 s, 0 = aus, begrenzt auf 0..30, Unsinn faellt auf den Standard', () => {
  assert.equal(DEFAULT_SETTINGS.player.skipCountdown, 6);
  assert.equal(skipCountdownSec(6), 6);
  assert.equal(skipCountdownSec(0), 0);
  assert.equal(skipCountdownSec('10'), 10);
  assert.equal(skipCountdownSec(2.6), 3);
  assert.equal(skipCountdownSec(-4), 0);
  assert.equal(skipCountdownSec(999), 30);
  for (const bad of [undefined, null, '', 'abc', NaN, {}]) assert.equal(skipCountdownSec(bad), 6, String(bad));
});
