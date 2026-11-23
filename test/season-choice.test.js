'use strict';
/**
 * Welche Staffel die Seite einer Serie zuerst zeigt und was "Abspielen" einer Serie startet (src/shared/season-choice.js). Faelle aus
 * JellycloudTests/SeasonChoiceTests.swift der Apple-App. Gegenprobe wie dort: mit der ersten Staffel der Liste als Rueckfall scheitert "die Extras".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/shared/season-choice');
const { JellyfinClient } = require('../src/shared/jellyfin');

const season = (number, id) => ({ Id: id, Name: number === 0 ? 'Extras' : 'Staffel', Type: 'Season', IndexNumber: number });
const episode = (seasonId, seasonNumber) => ({ Id: 'e', Name: 'Folge', Type: 'Episode', SeasonId: seasonId, ParentIndexNumber: seasonNumber });
const withSpecials = () => [season(0, 'extras'), season(1, 'one'), season(2, 'two')];

test('Ohne naechste Folge: die erste richtige Staffel, nicht die Extras', () => {
  assert.equal(SC.initial(withSpecials(), null)?.Id, 'one');
  assert.equal(SC.first(withSpecials())?.Id, 'one');
});

test('Nur Extras: die Extras; keine Staffeln: keine', () => {
  assert.equal(SC.initial([season(0, 'extras')], null)?.Id, 'extras');
  assert.equal(SC.initial([], null), null);
  assert.equal(SC.first(null), null, 'Unsinn: keine');
});

test('Eine Staffel ohne Nummer gilt als richtige Staffel', () => {
  assert.equal(SC.initial([season(0, 'extras'), season(null, 'plain')], null)?.Id, 'plain');
  assert.equal(SC.initial([season(0, 'extras'), { Id: 'ohne', Type: 'Season' }], null)?.Id, 'ohne', 'auch ganz ohne Feld');
});

test('Naechste Folge: ihre Staffel nach Id, sonst nach Nummer; auch die Extras, wenn sie dort liegt', () => {
  assert.equal(SC.initial(withSpecials(), episode('two', 2))?.Id, 'two');
  assert.equal(SC.initial(withSpecials(), episode('fremd', 2))?.Id, 'two');
  assert.equal(SC.initial(withSpecials(), episode('extras', 0))?.Id, 'extras');
  assert.equal(SC.initial(withSpecials(), episode('two', 1))?.Id, 'two', 'die Id geht vor der Nummer (Nummern der Folge und der Staffel koennen abweichen)');
});

test('Naechste Folge aus einer Staffel, die nicht zur Serie gehoert: die erste richtige Staffel', () => {
  assert.equal(SC.initial(withSpecials(), episode('fremd', 7))?.Id, 'one');
  assert.equal(SC.initial(withSpecials(), episode(null, null))?.Id, 'one');
  assert.equal(SC.initial([season(null, 'plain'), season(1, 'one')], episode(null, null))?.Id, 'plain', 'ohne Nummer an der Folge zaehlt keine Staffel ohne Nummer als ihre');
});

test('"Abspielen" ohne naechste Folge beginnt mit der ersten Folge der ersten richtigen Staffel (gegen einen Server wie in der Apple-App)', async () => {
  const seen = [];
  const fetch = async (url) => {
    const u = new URL(url);
    seen.push(u.pathname);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/Shows/NextUp')) return json({ Items: [] });
    if (u.pathname.endsWith('/Seasons')) return json({ Items: [{ Id: 'extras', Type: 'Season', IndexNumber: 0 }, { Id: 'one', Type: 'Season', IndexNumber: 1 }] });
    if (u.pathname.endsWith('/Episodes')) return json({ Items: [{ Id: `folge-${u.searchParams.get('seasonId') ?? 'alle'}`, Type: 'Episode' }] });
    return new Response('', { status: 404 });
  };
  const c = new JellyfinClient({ baseUrl: 'http://staffeln.jellyfin.test', deviceId: 'hier', fetch });
  c.token = 't';
  c.userId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const r = await SC.seriesTarget(c, 'serie');
  assert.equal(r.episode?.Id, 'folge-one');
  assert.equal(r.resume, false, 'die erste Folge beginnt vorn');
  assert.deepEqual(seen.map((p) => p.split('/').pop()), ['NextUp', 'Seasons', 'Episodes']);
});

test('"Abspielen" einer Serie: die naechste Folge an ihrer Stelle; Fehler zaehlen wie leere Antworten', async () => {
  const next = { Id: 'n', Type: 'Episode' };
  const calls = [];
  const client = (o) => ({
    getNextUp: async (...a) => (calls.push(['next', ...a]), o.next()),
    getSeasons: async (...a) => (calls.push(['seasons', ...a]), o.seasons()),
    getEpisodes: async (...a) => (calls.push(['episodes', ...a]), o.episodes())
  });
  assert.deepEqual(await SC.seriesTarget(client({ next: () => [next], seasons: () => [], episodes: () => [] }), 's'), { episode: next, resume: true });
  assert.deepEqual(calls[0], ['next', 1, 's'], 'eine Folge genuegt');
  const fail = () => {
    throw new Error('kein Netz');
  };
  assert.deepEqual(await SC.seriesTarget(client({ next: fail, seasons: () => [season(1, 'one')], episodes: () => [{ Id: 'x' }] }), 's'), { episode: { Id: 'x' }, resume: false }, 'ohne Antwort zur naechsten Folge: die erste Folge');
  assert.deepEqual(await SC.seriesTarget(client({ next: () => [], seasons: fail, episodes: () => [{ Id: 'x' }] }), 's'), { episode: null, resume: false }, 'ohne Staffeln nichts');
  assert.deepEqual(await SC.seriesTarget(client({ next: () => [], seasons: () => [season(1, 'one')], episodes: fail }), 's'), { episode: null, resume: false });
});
