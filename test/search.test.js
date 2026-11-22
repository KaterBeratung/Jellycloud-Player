'use strict';

// Suche (Plan P14): die Faelle der Apple-App (JellycloudTests/SearchStatusTests.swift, 6) und der Abgleich der Treffer von Seerr mit der Mediathek
// (Notizen/seerr-integration.md "Suche": ueber TMDB-Nummer und Art, nie ueber den Titel; teilweise vorhandene Serien bleiben anfragbar).
const test = require('node:test');
const assert = require('node:assert/strict');
const Search = require('../src/shared/search-status');
const { JellyfinClient } = require('../src/shared/jellyfin');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { server, state, resetSeerr } = require('../tools/mock-server');

const resolve = (term, answered, searching, error) => Search.resolve({ term, answered, searching, error });

// ---------- Apple: SearchStatusTests ----------

test('Leeres Suchfeld: Hinweis, was sich finden laesst', () => {
  assert.deepEqual(resolve('', null, false, null), { kind: 'prompt' });
  assert.deepEqual(resolve('', 'orbit', true, 'HTTP 500'), { kind: 'prompt' }, 'auch wenn noch eine Antwort zum vorigen Text dasteht oder eine Suche auslaeuft');
});

test('Eingabe, die Suche hat noch nicht begonnen: Laden, nicht "Keine Ergebnisse"', () => {
  assert.deepEqual(resolve('zzqq', null, false, null), { kind: 'loading' });
});

test('Die Suche laeuft: Laden', () => {
  assert.deepEqual(resolve('zzqq', null, true, null), { kind: 'loading' });
  assert.deepEqual(resolve('zzqq', 'zzqq', true, null), { kind: 'loading' }, 'erneute Suche nach demselben Text');
});

test('Beantwortet ohne Treffer: "Keine Ergebnisse" fuer genau diesen Text', () => {
  assert.deepEqual(resolve('zzqq', 'zzqq', false, null), { kind: 'noResults', term: 'zzqq' });
});

test('Beantwortet mit Fehler: der Fehler', () => {
  assert.deepEqual(resolve('zzqq', 'zzqq', false, 'HTTP 500'), { kind: 'failed', message: 'HTTP 500' });
});

test('Weitergetippt nach einer Antwort: Laden, weder "Keine Ergebnisse" noch der alte Fehler fuer den neuen Text', () => {
  assert.deepEqual(resolve('zzqqx', 'zzqq', false, null), { kind: 'loading' });
  assert.deepEqual(resolve('zzqqx', 'zzqq', false, 'HTTP 500'), { kind: 'loading' });
});

// ---------- Abgleich mit der Mediathek ----------

const movie = (tmdb, extra = {}) => ({ Type: 'Movie', Name: 'x', ProviderIds: tmdb == null ? {} : { Tmdb: String(tmdb) }, ...extra });
const series = (tmdb) => ({ Type: 'Series', Name: 'x', ProviderIds: { Tmdb: String(tmdb) } });
const seerr = (mediaType, id, status = 0, title = 'x') => ({ mediaType, id, status, title });

test('Abgleich: vorhandener Titel nicht doppelt, auch wenn Seerr ihn (noch) nicht als vorhanden kennt', () => {
  assert.deepEqual(Search.requestable([seerr('movie', 5501, 0)], [movie(5501)]), []);
  assert.deepEqual(Search.requestable([seerr('movie', 5501, 0)], []).map((r) => r.id), [5501], 'ohne Treffer der Mediathek: anfragbar');
  assert.deepEqual(Search.requestable([seerr('tv', 1399, 0)], [series(1399)]), [], 'ebenso eine vorhandene Serie');
});

test('Abgleich ueber Nummer und Art: eine Serie mit der Nummer eines Films der Mediathek bleibt', () => {
  assert.deepEqual(Search.requestable([seerr('movie', 5501), seerr('tv', 5501)], [movie(5501)]).map((r) => `${r.mediaType}-${r.id}`), ['tv-5501']);
});

test('Abgleich nie ueber den Titel: gleicher Titel, andere oder keine Nummer -> bleibt', () => {
  assert.deepEqual(Search.requestable([seerr('movie', 7, 0, 'Paper Moons')], [movie(8, { Name: 'Paper Moons' }), movie(null, { Name: 'Paper Moons' })]).map((r) => r.id), [7]);
});

test('Teilweise vorhandene Serie bleibt anfragbar, auch wenn sie unter den Treffern der Mediathek steht', () => {
  assert.deepEqual(Search.requestable([seerr('tv', 5502, 4)], [series(5502)]).map((r) => r.id), [5502]);
});

test('Bei Seerr vorhanden: nicht unter "Nicht in der Bibliothek", auch ohne Treffer der Mediathek; angefragte bleiben (mit Stand)', () => {
  assert.deepEqual(Search.requestable([seerr('movie', 4242, 5), seerr('movie', 5151, 2), seerr('movie', 7004, 6)], []).map((r) => r.id), [5151, 7004]);
});

test('Nur Filme und Serien der Mediathek gleichen ab (Folgen und Sammlungen nicht); Schreibweise des Anbieters egal; Unbrauchbares stoert nicht', () => {
  const episode = { Type: 'Episode', ProviderIds: { Tmdb: '9' } };
  const boxset = { Type: 'BoxSet', ProviderIds: { Tmdb: '10' } };
  assert.deepEqual(Search.requestable([seerr('tv', 9), seerr('movie', 10)], [episode, boxset]).map((r) => r.id), [9, 10]);
  assert.deepEqual(Search.requestable([seerr('movie', 11)], [{ Type: 'Movie', ProviderIds: { tmdb: '11' } }]), [], 'tmdb klein geschrieben');
  assert.equal(Search.libraryKey({ Type: 'Movie', ProviderIds: { Tmdb: 'tt123' } }), null);
  assert.deepEqual(Search.requestable(null, null), []);
  assert.deepEqual(Search.requestable([null, seerr('movie', 1)], [null]).map((r) => r.id), [1]);
});

test('Ruhe vor der Suche wie die Apple-App: 350 ms', () => {
  assert.equal(Search.QUIET_MS, 350);
});

test('Die Suche der Mediathek fragt die TMDB-Nummern mit ab (sonst gaebe es keinen Abgleich)', async () => {
  const seen = [];
  const fetch = async (url) => {
    seen.push(new URL(url));
    return new Response(JSON.stringify({ Items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const c = new JellyfinClient({ baseUrl: 'http://jf.test', deviceId: 'dev-search', fetch });
  c.token = 't';
  c.userId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  await c.search('glass', 60);
  const fields = seen[0].searchParams.get('fields').split(',');
  assert.ok(fields.includes('ProviderIds'), fields.join(','));
  assert.ok(fields.includes('PrimaryImageAspectRatio'), 'die uebrigen Felder der Listen bleiben');
});

// ---------- Gegen den Test-Server ----------

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  resetSeerr();
  state.log.length = 0;
});

function memoryConfig() {
  const store = { text: null };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  return new ConfigCore({ read: () => store.text, write: (t) => (store.text = t) }, codec, env);
}
async function signedIn() {
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.13', locale: () => 'de-DE' });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  await b.checkConnection();
  return b;
}

test('Test-Server: vorhandener Film fehlt bei Seerr, die Serie mit derselben Nummer steht da; teilweise vorhandene Serie bleibt', async () => {
  const b = await signedIn();
  const lib = await b.api('search', ['glass', 60]);
  assert.deepEqual(lib.map((i) => i.Name), ['The Glass Garden']);
  const found = await b.seerrSearch('glass', 1);
  assert.deepEqual(found.map((r) => `${r.mediaType}-${r.id}-${r.status}`).sort(), ['movie-5501-0', 'tv-5501-0'], 'Seerr kennt den Film der Mediathek nicht als vorhanden');
  assert.deepEqual(Search.requestable(found, lib).map((r) => r.title), ['The Glass Garden: Die Serie']);
  const wildLib = await b.api('search', ['wild', 60]);
  const wild = await b.seerrSearch('wild', 1);
  assert.deepEqual(Search.requestable(wild, wildLib).map((r) => [r.title, r.status]), [['Code of the Wild', 4]]);
  assert.ok(state.log.filter((l) => l.at === '/Items search').every((l) => l.fields.split(',').includes('ProviderIds')));
});
