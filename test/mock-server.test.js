'use strict';
/**
 * Testserver (tools/mock-server.js): die Steuerung /__debug/... mit den Namen des Apple-Testservers und die Endpunkte, die die
 * Angleichung an die Apple-App braucht (Seerr-Anfragen mit Blaettern und Verwalten, Kontingent, Personen, Trends je Art, Quick Connect
 * fuer andere Geraete, gestellte Sitzungen, Bandbreitenmessung). Jeder Schalter mit Gegenprobe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { server, TOKEN, SEERR, state, items, resetSeerr } = require('../tools/mock-server');

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const AUTH = { authorization: `MediaBrowser Client="Test", Device="Test", DeviceId="t", Version="1", Token="${TOKEN}"` };
const get = (p, headers = AUTH) => fetch(base + p, { headers });
const post = (p, body, headers = AUTH) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
const debug = async (p) => (await post(`/__debug/${p}`, null, {})).json();
const firstMovie = () => [...items.values()].find((i) => i.Type === 'Movie');

async function seerrLogin() {
  const r = await post('/api/v1/auth/jellyfin', { username: 'demo', password: 'demo' }, {});
  assert.equal(r.status, 200);
  const cookie = /connect\.sid=[^;]+/.exec(r.headers.get('set-cookie'))[0];
  return { cookie };
}
const sget = (p, s) => fetch(`${base}/api/v1${p}`, { headers: { cookie: s.cookie } });
const spost = (p, body, s, extra = {}) => fetch(`${base}/api/v1${p}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: s.cookie, ...extra }, body: body ? JSON.stringify(body) : undefined });
const sdel = (p, s) => fetch(`${base}/api/v1${p}`, { method: 'DELETE', headers: { cookie: s.cookie } });

test('Steuerung: state nennt Protokoll, Stoerungen und Seerr-Zaehler', async () => {
  await debug('reset?seerr=1');
  const s = await (await get('/__debug/state', {})).json();
  assert.ok(Array.isArray(s.log));
  assert.equal(s.expired, false);
  assert.equal(s.listsHeld, false);
  assert.equal(s.seerr.mode, 'ok');
  assert.equal(s.seerr.tmdbRequests, 0);
  assert.equal(s.seerr.permissions, 1072);
  const bad = await post('/__debug/unbekannt', null, {});
  assert.equal(bad.status, 404);
});

test('delay?lists=hold haelt Listen fest, bis der Test sie freigibt; Gegenprobe ohne hold sofort', async () => {
  await debug('delay?lists=hold');
  let done = false;
  const pending = get('/Items?limit=1').then((r) => {
    done = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(done, false, 'Liste darf noch nicht antworten');
  const st = await (await get('/__debug/state', {})).json();
  assert.equal(st.listsHeld, true);
  await debug('delay?lists=0');
  assert.equal((await pending).status, 200);
  const t0 = Date.now();
  assert.equal((await get('/Items?limit=1')).status, 200);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal((await post('/__debug/delay?lists=abc', null, {})).status, 400);
});

test('delay?lists=<s> bremst alle Listen, fault?clear=1 schaltet es ab', async () => {
  await debug('delay?lists=0.3');
  for (const p of ['/Items?limit=1', '/UserItems/Resume', '/Shows/NextUp']) {
    const t0 = Date.now();
    assert.equal((await get(p)).status, 200);
    assert.ok(Date.now() - t0 >= 280, `${p} verzoegert`);
  }
  await debug('fault?clear=1');
  const t0 = Date.now();
  await get('/Shows/NextUp');
  assert.ok(Date.now() - t0 < 250);
});

test('fault?lists=500&count=1 laesst genau eine Liste scheitern; invalid, empty, drop; Bilder getrennt', async () => {
  await debug('fault?lists=500&count=1');
  assert.equal((await get('/Items?limit=1')).status, 500);
  assert.equal((await get('/Items?limit=1')).status, 200, 'die zweite Antwort ist wieder gut');
  await debug('fault?lists=invalid');
  const inv = await get('/Items?limit=1');
  await assert.rejects(inv.json());
  await debug('fault?lists=empty');
  assert.equal(await (await get('/Items?limit=1')).text(), '');
  await debug('fault?lists=drop&count=1');
  await assert.rejects(get('/Items?limit=1'));
  await debug('fault?lists=off');
  assert.equal((await get('/Items?limit=1')).status, 200);
  await debug('fault?images=503&count=1');
  const img = `/Items/${firstMovie().Id}/Images/Primary`;
  assert.equal((await get(img, {})).status, 503);
  assert.equal((await get(img, {})).status, 200);
  assert.equal((await post('/__debug/fault?lists=teapot', null, {})).status, 400);
  await debug('fault?clear=1');
});

test('expire: Sitzung abgelaufen bis zur naechsten Anmeldung', async () => {
  assert.equal((await get('/Users/Me')).status, 200);
  await debug('expire');
  assert.equal((await get('/Users/Me')).status, 401);
  assert.equal((await post('/Users/AuthenticateByName', { Username: 'demo', Pw: 'demo' }, {})).status, 200);
  assert.equal((await get('/Users/Me')).status, 200);
});

test('delay?auth=<s> bremst die Anmeldung mit Passwort', async () => {
  await debug('delay?auth=0.3');
  const t0 = Date.now();
  await post('/Users/AuthenticateByName', { Username: 'demo', Pw: 'demo' }, {});
  assert.ok(Date.now() - t0 >= 280);
  await debug('fault?clear=1');
});

test('Quick Connect: hold haelt zurueck, Authorize eines anderen Geraets bestaetigt, Code nie im Protokoll', async () => {
  await debug('reset');
  await debug('quickconnect?hold=1');
  await post('/QuickConnect/Initiate', null, {});
  for (let i = 0; i < 3; i++) assert.equal((await (await get('/QuickConnect/Connect?secret=mock-secret', {})).json()).Authenticated, false);
  assert.equal((await post('/QuickConnect/Authorize?code=482913&userId=x', null, {})).status, 401, 'nur angemeldet');
  assert.equal((await post('/QuickConnect/Authorize?code=000000&userId=x')).status, 404, 'falscher Code');
  const ok = await post('/QuickConnect/Authorize?code=482913&userId=x');
  assert.equal(ok.status, 200);
  assert.equal(await ok.json(), true);
  assert.equal((await (await get('/QuickConnect/Connect?secret=mock-secret', {})).json()).Authenticated, true);
  assert.equal((await post('/QuickConnect/Authorize?code=482913&userId=x')).status, 500, 'schon bestaetigt');
  assert.ok(!JSON.stringify(state.log).includes('482913'), 'Code steht nicht im Protokoll');
  await debug('quickconnect?gone=1');
  assert.equal((await get('/QuickConnect/Connect?secret=mock-secret', {})).status, 404);
  await debug('quickconnect?gone=0&disabled=1&hold=0');
  assert.equal(await (await get('/QuickConnect/Enabled', {})).json(), false);
  assert.equal((await post('/QuickConnect/Initiate', null, {})).status, 401);
  assert.equal((await post('/QuickConnect/Authorize?code=482913&userId=x')).status, 401);
  await debug('fault?clear=1');
  assert.equal(await (await get('/QuickConnect/Enabled', {})).json(), true);
  // Gegenprobe: ohne hold bestaetigt der Server wie bisher bei der zweiten Abfrage
  await post('/QuickConnect/Initiate', null, {});
  assert.equal((await (await get('/QuickConnect/Connect', {})).json()).Authenticated, false);
  assert.equal((await (await get('/QuickConnect/Connect', {})).json()).Authenticated, true);
});

test('session: gestellte Wiedergabe eines anderen Geraets, Stopp merkt sich die Stelle', async () => {
  await debug('session?clear=1');
  const movie = firstMovie();
  const made = await debug(`session?device=Wohnzimmer%20TV&item=${movie.Id}&at=120&client=Jellycloud`);
  assert.equal(made.sessions, 1);
  const list = await (await get('/Sessions')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].DeviceName, 'Wohnzimmer TV');
  assert.equal(list[0].Client, 'Jellycloud');
  assert.equal(list[0].NowPlayingItem.Id, movie.Id);
  assert.ok(list[0].PlayState.PositionTicks >= 120 * 10_000_000);
  const stop = await post(`/Sessions/${list[0].Id}/Playing/Stop`);
  assert.equal(stop.status, 204);
  assert.ok(state.progress.get(movie.Id) >= 120 * 10_000_000);
  assert.ok(state.log.some((l) => l.at === 'RemoteStop'));
  await debug('session?clear=1');
  // Gegenprobe: ohne gestellte Sitzung bleibt /Sessions wie bisher der Verwaltung vorbehalten
  assert.equal((await get('/Sessions')).status, 403);
  assert.equal((await post('/__debug/session?item=unbekannt', null, {})).status, 400);
});

test('Playback/BitrateTest liefert genau Size Bytes', async () => {
  const r = await get('/Playback/BitrateTest?Size=12345');
  assert.equal(r.status, 200);
  assert.equal((await r.arrayBuffer()).byteLength, 12345);
  assert.equal((await get('/Playback/BitrateTest?Size=10', {})).status, 401, 'nur angemeldet');
});

test('Seerr /auth/me: Rechte (Standard 1072) und Jellyfin-Kennung, zur Laufzeit stellbar', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  let me = await (await sget('/auth/me', s)).json();
  assert.equal(me.permissions, 1072);
  assert.equal(me.jellyfinUsername, 'demo');
  assert.match(me.jellyfinUserId, /^[0-9a-f]{32}$/);
  await debug('permissions?set=32');
  await debug('identity?jellyfin=ffffffffffffffffffffffffffffffff');
  me = await (await sget('/auth/me', s)).json();
  assert.equal(me.permissions, 32);
  assert.equal(me.jellyfinUserId, 'ffffffffffffffffffffffffffffffff');
  await debug('permissions');
  await debug('identity');
  me = await (await sget('/auth/me', s)).json();
  assert.equal(me.permissions, 1072);
});

test('Seerr-Anfragen: anlegen, Liste mit take/skip/pageInfo, Filter, Genehmigen, Ablehnen, Erneut, Entfernen', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  const created = await (await spost('/request', { mediaType: 'movie', mediaId: 603 }, s)).json();
  assert.equal(created.status, 1);
  assert.equal(created.media.status, 2, 'Titel wartet');
  assert.equal((await spost('/request', { mediaType: 'movie', mediaId: 603 }, s)).status, 409, 'doppelt');
  await spost('/request', { mediaType: 'tv', mediaId: 1399, seasons: [1, 2] }, s);
  let list = await (await sget('/request?take=1&skip=0', s)).json();
  assert.equal(list.pageInfo.results, 2);
  assert.equal(list.pageInfo.pages, 2);
  assert.equal(list.results.length, 1);
  assert.equal(list.results[0].type, 'tv', 'neueste zuerst');
  assert.deepEqual(list.results[0].seasons.map((x) => x.seasonNumber), [1, 2]);
  list = await (await sget('/request?take=1&skip=1', s)).json();
  assert.equal(list.results[0].media.tmdbId, 603);
  assert.equal(list.pageInfo.page, 2);
  // Genehmigen: Stand 2, Titel in Bearbeitung (3), wer entschieden hat
  const ok = await (await spost(`/request/${created.id}/approve`, null, s, { 'x-mock-actor': '2' })).json();
  assert.equal(ok.status, 2);
  assert.equal(ok.media.status, 3);
  assert.equal(ok.modifiedBy.id, 2);
  assert.equal((await (await sget('/request?filter=pending', s)).json()).pageInfo.results, 1, 'nur noch die Serie wartet');
  assert.equal((await (await sget('/request?filter=processing', s)).json()).pageInfo.results, 1);
  // Ablehnen nimmt den Stand des Titels zurueck
  const no = await (await spost(`/request/${created.id}/decline`, null, s)).json();
  assert.equal(no.status, 3);
  assert.equal(no.media.status, 1);
  const again = await (await spost(`/request/${created.id}/retry`, null, s)).json();
  assert.equal(again.status, 2);
  // ohne Verwaltungsrecht: 403; Entfernen der eigenen wartenden Anfrage geht, einer genehmigten nicht
  await debug('permissions?set=32');
  assert.equal((await spost(`/request/${created.id}/approve`, null, s)).status, 403);
  assert.equal((await sdel(`/request/${created.id}`, s)).status, 401);
  assert.equal((await sdel('/request/2', s)).status, 204);
  await debug('permissions');
  assert.equal((await sdel(`/request/${created.id}`, s)).status, 204);
  assert.equal((await (await sget('/request', s)).json()).pageInfo.results, 0);
  assert.equal((await spost('/request/99/approve', null, s)).status, 404);
});

test('Seerr-Anfragen: viele stellen, Stand setzen, Staffel liefern, sortieren, requestedBy', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  await debug('requests?count=25&open=5');
  const page = await (await sget('/request?take=10&skip=20', s)).json();
  assert.equal(page.pageInfo.results, 25);
  assert.equal(page.pageInfo.pages, 3);
  assert.equal(page.results.length, 5);
  assert.equal((await (await sget('/request?filter=pending&take=50', s)).json()).pageInfo.results, 5);
  assert.equal((await (await sget('/request?filter=completed&take=50', s)).json()).pageInfo.results, 20);
  await debug('request?id=1&status=4');
  assert.equal((await (await sget('/request?filter=failed', s)).json()).results[0].id, 1);
  const byModified = await (await sget('/request?sort=modified&take=1', s)).json();
  assert.equal(byModified.results[0].id, 1, 'zuletzt geaendert zuerst');
  assert.equal((await (await sget('/request?requestedBy=2', s)).json()).pageInfo.results, 0);
  await spost('/request', { mediaType: 'tv', mediaId: 1399, seasons: [1, 2] }, s);
  await debug('season?id=26&season=1');
  let tv = (await (await sget('/request?take=1', s)).json()).results[0];
  assert.deepEqual(tv.seasons.map((x) => x.status), [5, 1]);
  await debug('season?id=26&season=2');
  tv = (await (await sget('/request?take=1', s)).json()).results[0];
  assert.equal(tv.status, 5, 'alle Staffeln da: abgeschlossen');
});

test('Seerr: delay?requests=hold haelt die Liste der Anfragen fest; listRequests zaehlt', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  await debug('delay?requests=hold');
  let done = false;
  const pending = sget('/request', s).then((r) => {
    done = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(done, false);
  await debug('delay?requests=0');
  assert.equal((await pending).status, 200);
  const st = await (await get('/__debug/state', {})).json();
  assert.equal(st.seerr.listRequests, 1);
});

test('Seerr-Kontingent: unbegrenzt, dann begrenzt und erschoepft', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  let quota = await (await sget('/user/1/quota', s)).json();
  assert.equal(quota.movie.restricted, false);
  SEERR.quota.movie.limit = 1;
  assert.equal((await spost('/request', { mediaType: 'movie', mediaId: 2468 }, s)).status, 201);
  quota = await (await sget('/user/1/quota', s)).json();
  assert.equal(quota.movie.restricted, true);
  assert.equal(quota.movie.remaining, 0);
  assert.equal((await spost('/request', { mediaType: 'movie', mediaId: 7001 }, s)).status, 403);
  assert.equal(quota.tv.restricted, false, 'Serien getrennt');
  resetSeerr();
  assert.equal(SEERR.quota.movie.limit, 0);
});

test('Seerr-Personen und ihre Rollen', async () => {
  const s = await seerrLogin();
  const p = await (await sget('/person/777', s)).json();
  assert.equal(p.name, 'Mock Person');
  assert.ok(p.biography);
  assert.equal(p.cast, undefined, 'Rollen nur unter combined_credits');
  const c = await (await sget('/person/777/combined_credits', s)).json();
  assert.ok(c.cast.some((x) => x.mediaType === 'tv' && x.id === 1399));
  assert.equal(c.cast.find((x) => x.id === 4242).mediaInfo.status, 5, 'Stand aus Seerr');
  assert.equal(c.crew[0].job, 'Producer');
  assert.equal((await sget('/person/1', s)).status, 404);
  const detail = await (await sget('/movie/603', s)).json();
  assert.ok(detail.credits.cast.every((x) => Number.isInteger(x.id)), 'Besetzung mit Nummern der Personen');
});

test('Seerr-Trends je Art und Zeitraum; aelteres Seerr gemischt', async () => {
  const s = await seerrLogin();
  const movies = await (await sget('/discover/trending?mediaType=movie&timeWindow=day&page=1', s)).json();
  assert.ok(movies.results.length >= 10);
  assert.ok(movies.results.every((r) => r.mediaType === 'movie'));
  assert.equal(movies.results[0].mediaInfo.status, 5, 'erster Platz ist in der Mediathek');
  const week = await (await sget('/discover/trending?mediaType=movie&timeWindow=week', s)).json();
  assert.notEqual(week.results[0].id, movies.results[0].id);
  const tv = await (await sget('/discover/trending?mediaType=tv', s)).json();
  assert.ok(tv.results.length >= 10 && tv.results.every((r) => r.mediaType === 'tv'));
  // Gegenprobe: ohne mediaType wie bisher gemischt, vier je Seite
  const mixed = await (await sget('/discover/trending?page=1', s)).json();
  assert.equal(mixed.results.length, 4);
  assert.ok(mixed.results.some((r) => r.mediaType === 'person'));
  SEERR.old = true;
  const old = await (await sget('/discover/trending?mediaType=movie&timeWindow=week', s)).json();
  assert.ok(old.results.some((r) => r.mediaType !== 'movie'), 'aelteres Seerr uebergeht mediaType');
  SEERR.old = false;
});

test('Seerr mode: down 503, expired macht alte Sitzungen ungueltig, neue Anmeldung gilt', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  await debug('mode?set=down');
  assert.equal((await sget('/auth/me', s)).status, 503);
  await debug('mode?set=ok');
  assert.equal((await sget('/auth/me', s)).status, 200);
  await debug('mode?set=expired');
  assert.equal((await sget('/auth/me', s)).status, 401);
  const fresh = await seerrLogin();
  assert.notEqual(fresh.cookie, s.cookie);
  assert.equal((await sget('/auth/me', fresh)).status, 200);
  await debug('reset?seerr=1');
  assert.equal((await sget('/auth/me', s)).status, 200, 'reset stellt die Sitzung der Tests her');
});

test('Seerr media: gestellter Stand; gesperrt nicht anfragbar, geloescht wieder anfragbar', async () => {
  await debug('reset?seerr=1');
  const s = await seerrLogin();
  await debug('media?tmdb=2468&status=6');
  assert.equal((await spost('/request', { mediaType: 'movie', mediaId: 2468 }, s)).status, 403);
  await debug('media?tmdb=2468&status=7');
  assert.equal((await spost('/request', { mediaType: 'movie', mediaId: 2468 }, s)).status, 201);
  await debug('media?tmdb=2468');
  assert.equal((await (await sget('/movie/2468', s)).json()).mediaInfo.status, 2, 'ohne gestellten Stand aus der Anfrage');
});

test('TMDB-API wird nie bedient und gezaehlt; logout zaehlt', async () => {
  await debug('reset?seerr=1');
  assert.equal((await get('/3/movie/603', {})).status, 410);
  const s = await seerrLogin();
  await spost('/auth/logout', null, s);
  const st = await (await get('/__debug/state', {})).json();
  assert.equal(st.seerr.tmdbRequests, 1);
  assert.equal(st.seerr.logouts, 1);
  await debug('reset?seerr=1');
  assert.equal((await (await get('/__debug/state', {})).json()).seerr.tmdbRequests, 0);
});

test('reset?all=1 stellt Gesehen und Positionen wie beim Start her', async () => {
  const movie = firstMovie();
  await debug('reset?all=1'); // fruehere Tests (Stopp einer gestellten Sitzung) haben die Position veraendert
  const before = state.progress.get(movie.Id);
  assert.ok(before > 0, 'der erste Film steht beim Start in Weiterschauen');
  state.progress.set(movie.Id, 1);
  state.played.add(movie.Id);
  await debug('reset?all=1');
  assert.equal(state.progress.get(movie.Id), before);
  assert.equal(state.played.has(movie.Id), false);
});
