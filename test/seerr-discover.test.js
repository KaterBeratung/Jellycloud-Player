// Entdecken, Genres und Merkliste bei Seerr (wie SeerrDiscover und SeerrWatchlist der Apple-App, Build 94)
const test = require('node:test');
const assert = require('node:assert/strict');
const { SeerrClient, SeerrError, normalizeDetails } = require('../src/shared/seerr');

function client(routes) {
  const log = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    log.push({ method: init.method ?? 'GET', path: u.pathname.replace('/api/v1', ''), query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null });
    const key = `${init.method ?? 'GET'} ${u.pathname.replace('/api/v1', '')}`;
    const [status, body] = routes[key] ? routes[key](u, init) : [404, { message: 'no' }];
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => 'application/json' } };
  };
  return { c: new SeerrClient({ baseUrl: 'http://seerr.test', cookie: 'sid', fetch, language: 'de' }), log };
}

test('Entdecken: nur die Art der Liste, ohne gesperrte, jeder Titel einmal; Genre nur bei den beliebten; Sprache der App', async () => {
  const { c, log } = client({
    'GET /discover/movies': () => [200, { page: 1, totalPages: 3, results: [{ id: 1, title: 'A', mediaType: 'movie' }, { id: 1, title: 'A', mediaType: 'movie' }, { id: 2, name: 'Serie', mediaType: 'tv' }, { id: 3, title: 'Gesperrt', mediaType: 'movie', mediaInfo: { status: 6 } }, { id: 4, title: 'B' }] }],
    'GET /discover/tv/upcoming': () => [200, { page: 2, totalPages: 2, results: [{ id: 9, name: 'Neu' }] }]
  });
  const p = await c.discover('/discover/movies', { page: 1, genre: 28 });
  assert.deepEqual(p.titles.map((x) => x.id), [1, 4], 'ohne Doppelte, Serien und Gesperrte; ohne Angabe gilt die Art der Liste');
  assert.equal(p.hasMore, true);
  assert.deepEqual(log[0].query, { page: '1', genre: '28', language: 'de' });
  const u = await c.discover('/discover/tv/upcoming', { page: 2, genre: 28 });
  assert.deepEqual(u.titles.map((x) => [x.id, x.mediaType]), [[9, 'tv']]);
  assert.equal(u.hasMore, false, 'letzte Seite');
  assert.equal(log[1].query.genre, undefined, 'die kommenden kennen bei Seerr kein Genre');
  await assert.rejects(() => c.discover('/discover/trending'), /Unbekannte Liste/, 'nur die vier Listen');
});

test('Genres: ohne Nummer oder Namen fallen sie weg, nach Namen geordnet', async () => {
  const { c, log } = client({ 'GET /genres/movie': () => [200, [{ id: 18, name: 'Drama' }, { id: 28, name: 'Action' }, { id: 0, name: 'Leer' }, { id: 5, name: ' ' }]] });
  assert.deepEqual(await c.genres('movie'), [{ id: 28, name: 'Action' }, { id: 18, name: 'Drama' }]);
  assert.equal(log[0].query.language, 'de', 'Namen in der Sprache der App');
  await assert.rejects(() => c.genres('person'), SeerrError);
});

test('Merkliste: Eintraege mit tmdbId (nicht der Nummer des Eintrags), je Titel einmal, mit Stand; merken und entfernen, 409/404 gelten als erledigt', async () => {
  let posted = null;
  const { c, log } = client({
    'GET /discover/watchlist': () => [200, { results: [{ id: 500, tmdbId: 11, mediaType: 'movie', title: 'Eins' }, { id: 501, tmdbId: 11, mediaType: 'movie' }, { id: 502, tmdbId: 22, mediaType: 'tv' }, { id: 503, tmdbId: 33, mediaType: 'person' }, { id: 504, tmdbId: 44, mediaType: 'movie' }] }],
    'GET /movie/11': () => [200, { id: 11, title: 'Eins', mediaInfo: { status: 5 } }],
    'GET /tv/22': () => [200, { id: 22, name: 'Zwei' }],
    'GET /movie/44': () => [500, { message: 'kaputt' }],
    'POST /watchlist': (u, init) => ((posted = JSON.parse(init.body)), [409, { message: 'schon da' }]),
    'DELETE /watchlist/11': () => [404, { message: 'nicht da' }]
  });
  const list = await c.watchlist();
  assert.deepEqual(list.map((x) => [x.mediaType, x.id, x.title, x.status]), [['movie', 11, 'Eins', 5], ['tv', 22, 'Zwei', 0]], 'ein Titel, der sich nicht laden laesst, faellt weg');
  assert.equal(await c.setWatchlisted(true, { mediaType: 'movie', tmdbId: 11, title: 'Eins' }), true, 'schon gemerkt ist erledigt');
  assert.deepEqual(posted, { tmdbId: 11, mediaType: 'movie', title: 'Eins' });
  assert.equal(await c.setWatchlisted(false, { mediaType: 'movie', tmdbId: 11 }), false, 'nicht gemerkt ist erledigt');
  assert.equal(log.at(-1).query.mediaType, 'movie');
  await assert.rejects(() => c.setWatchlisted(true, { mediaType: 'tv', tmdbId: 0 }), SeerrError);
});

test('Person: leere Biografie in der Sprache der App -> die englische (Build 95); vorhandene bleibt, ein Fehler dabei schadet nicht', async () => {
  const { c, log } = client({
    'GET /person/5': (u) => [200, { id: 5, name: 'Anna', biography: u.searchParams.get('language') === 'en' ? 'English bio.' : '' }],
    'GET /person/6': () => [200, { id: 6, name: 'Ben', biography: 'Deutsche Biografie.' }],
    'GET /person/7': (u) => (u.searchParams.get('language') === 'en' ? [500, {}] : [200, { id: 7, name: 'Cem', biography: '' }])
  });
  assert.equal((await c.person(5)).biography, 'English bio.');
  assert.deepEqual(log.map((l) => l.query.language), ['de', 'en'], 'erst die Sprache der App, dann Englisch');
  assert.equal((await c.person(6)).biography, 'Deutsche Biografie.');
  assert.equal(log.length, 3, 'mit Biografie keine zweite Abfrage');
  assert.equal((await c.person(7)).biography, '', 'Englisch scheitert: die Seite bleibt, ohne Biografie');
});

test('Seite eines Titels: onWatchlist nur, wenn Seerr es nennt; Seerrs eigene Nummer des Titels', () => {
  assert.equal(normalizeDetails('movie', { id: 1, title: 'A', onUserWatchlist: true }).onWatchlist, true);
  assert.equal(normalizeDetails('movie', { id: 1, title: 'A' }).onWatchlist, null, 'aeltere Fassung: kein Merken anbieten');
  assert.equal(normalizeDetails('movie', { id: 1, title: 'A', mediaInfo: { id: 77, status: 3 } }).seerrMediaId, 77);
  assert.equal(normalizeDetails('movie', { id: 1, title: 'A' }).seerrMediaId, null);
});
