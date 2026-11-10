'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JellyfinClient, JellyfinError, normalizeServerUrl, candidateUrls, probeServer } = require('../src/main/jellyfin');
const { server, TOKEN, state } = require('../tools/mock-server');
const { buildDeviceProfile, resolvePlayback } = require('../src/main/profile');

let base;
test.before(
  () =>
    new Promise((r) =>
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        r();
      })
    )
);
test.after(() => server.close());

test('Server-Adressen werden bereinigt', () => {
  assert.equal(normalizeServerUrl('http://srv:8096/'), 'http://srv:8096');
  assert.equal(normalizeServerUrl('https://example.com/web/index.html'), 'https://example.com');
  assert.equal(normalizeServerUrl('srv.local:8096'), 'http://srv.local:8096');
  assert.equal(normalizeServerUrl('https://example.com/jellyfin/'), 'https://example.com/jellyfin');
  assert.throws(() => normalizeServerUrl('  '), JellyfinError);
  assert.deepEqual(candidateUrls('media.example.com'), ['https://media.example.com', 'http://media.example.com', 'http://media.example.com:8096']);
  assert.deepEqual(candidateUrls('http://a:1'), ['http://a:1']);
});

test('Server wird gefunden, auch ohne Schema', async () => {
  const r = await probeServer(base.replace('http://', ''));
  assert.equal(r.info.ServerName, 'Mock Jellyfin');
  await assert.rejects(() => probeServer('127.0.0.1:1'), /nicht erreichbar|Zeitueberschreitung/);
});

test('Anmeldung: falsches Passwort -> 401, richtiges -> Token', async () => {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'dev-test' });
  await assert.rejects(() => c.authenticateByName('demo', 'falsch'), (e) => e.status === 401);
  const a = await c.authenticateByName('demo', 'demo');
  assert.equal(a.token, TOKEN);
  assert.ok(c.authHeader().includes(`Token="${TOKEN}"`) && c.authHeader().includes('DeviceId="dev-test"'));
});

test('Quick Connect: Code, Abfrage, Anmeldung', async () => {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'dev-test' });
  assert.equal(await c.quickConnectEnabled(), true);
  const qc = await c.quickConnectInitiate();
  assert.equal(qc.Code.length, 6);
  assert.equal((await c.quickConnectCheck(qc.Secret)).Authenticated, false);
  assert.equal((await c.quickConnectCheck(qc.Secret)).Authenticated, true);
  assert.equal((await c.authenticateWithQuickConnect(qc.Secret)).token, TOKEN);
});

async function login() {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'dev-test' });
  await c.authenticateByName('demo', 'demo');
  return c;
}

test('Metadaten aktualisieren: POST /Items/{id}/Refresh, ersetzt nur auf Wunsch, 403 fuer Nicht-Administratoren', async () => {
  const c = await login();
  const id = (await c.getItems({ includeItemTypes: 'Movie', recursive: true, limit: 1 })).Items[0].Id;
  state.log.length = 0;
  await c.refreshItem(id);
  let l = state.log.find((x) => x.at === 'Refresh');
  assert.equal(l.itemId, id);
  assert.deepEqual([l.query.metadataRefreshMode, l.query.imageRefreshMode, l.query.replaceAllMetadata, l.query.replaceAllImages], ['FullRefresh', 'FullRefresh', 'false', 'false'], 'ohne Ersetzen: nur Fehlendes ergaenzen');
  await c.refreshItem(id, { replaceAll: true });
  l = state.log.filter((x) => x.at === 'Refresh').at(-1);
  assert.deepEqual([l.query.replaceAllMetadata, l.query.replaceAllImages], ['true', 'true']);
  state.refreshForbidden = true;
  await assert.rejects(() => c.refreshItem(id), (e) => e.status === 403);
  state.refreshForbidden = false;
});

test('Startseite: Neuzugaenge, Weiterschauen und Als Naechstes fragen das Logo mit ab (das Banner zeigt es statt des Titels als Text)', async () => {
  const urls = [];
  const spy = new JellyfinClient({
    baseUrl: base,
    deviceId: 'dev-test',
    token: TOKEN,
    userId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    fetch: (url, init) => {
      urls.push(String(url));
      return fetch(url, init);
    }
  });
  const views = await spy.getViews();
  await spy.getLatest(views.find((v) => v.CollectionType === 'movies').Id, 5);
  await spy.getResume(3);
  await spy.getNextUp(3);
  for (const part of ['/Items/Latest', '/Resume', '/Shows/NextUp']) {
    const u = urls.find((x) => x.includes(part));
    assert.ok(u, `Anfrage ${part} gesendet`);
    assert.ok(/enableImageTypes=[^&]*Logo/.test(decodeURIComponent(u)), `${part}: enableImageTypes enthaelt Logo (${decodeURIComponent(u).match(/enableImageTypes=[^&]*/)?.[0]})`);
  }
});

test('Bibliothek, Detail, Serien, Suche, Weiterschauen', async () => {
  const c = await login();
  const views = await c.getViews();
  assert.deepEqual(views.map((v) => v.CollectionType).sort(), ['movies', 'tvshows']);
  const movies = await c.getItems({ parentId: views.find((v) => v.CollectionType === 'movies').Id, includeItemTypes: 'Movie', recursive: true, limit: 5, sortBy: 'SortName' });
  assert.equal(movies.Items.length, 5);
  assert.ok(movies.TotalRecordCount > 10);
  const detail = await c.getItem(movies.Items[0].Id);
  assert.ok(detail.MediaSources.length && detail.People.length);
  const resume = await c.getResume();
  assert.ok(resume.length >= 2, 'Weiterschauen enthaelt die vorbelegten Titel');
  const series = (await c.getItems({ includeItemTypes: 'Series', recursive: true })).Items;
  const seasons = await c.getSeasons(series[0].Id);
  assert.ok(seasons.length > 0);
  const eps = await c.getEpisodes(series[0].Id, seasons[0].Id);
  assert.ok(eps.length > 0);
  const found = await c.search('aurora');
  assert.ok(found.some((i) => i.Name === 'Aurora Protocol'));
  const nextUp = await c.getNextUp(5);
  assert.ok(nextUp.length > 0);
  assert.ok((await c.getGenres()).includes('Drama'));
});

test('Gesehen / Favorit', async () => {
  const c = await login();
  const id = (await c.getItems({ includeItemTypes: 'Movie', recursive: true, limit: 1, sortBy: 'SortName', sortOrder: 'Descending' })).Items[0].Id;
  await c.setFavorite(id, true);
  assert.equal((await c.getItem(id)).UserData.IsFavorite, true);
  await c.setFavorite(id, false);
  await c.setPlayed(id, true);
  assert.equal((await c.getItem(id)).UserData.Played, true);
  await c.setPlayed(id, false);
  assert.equal((await c.getItem(id)).UserData.Played, false);
});

test('Ohne Token: 401', async () => {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'd' });
  await assert.rejects(() => c.getViews(), (e) => e.status === 401);
});

test('PlaybackInfo -> Direct Play; mit Bitratenlimit -> Transcode', async () => {
  const c = await login();
  const movie = (await c.getItems({ includeItemTypes: 'Movie', recursive: true, sortBy: 'SortName' })).Items.find((m) => m.Name === 'Aurora Protocol');
  const direct = await c.getPlaybackInfo(movie.Id, { deviceProfile: buildDeviceProfile(), startTicks: 1000 });
  const r = resolvePlayback({ info: direct, base: c.baseUrl, itemId: movie.Id, deviceId: c.deviceId });
  assert.equal(r.method, 'DirectPlay');
  assert.ok(r.url.startsWith(`${base}/Videos/${movie.Id}/stream?`));

  const limited = await c.getPlaybackInfo(movie.Id, { deviceProfile: buildDeviceProfile({ maxBitrateMbps: 8 }), maxBitrate: 8_000_000 });
  const t = resolvePlayback({ info: limited, base: c.baseUrl, itemId: movie.Id, deviceId: c.deviceId });
  assert.equal(t.method, 'Transcode');
  assert.match(t.url, /master\.m3u8/);

  const log = await (await fetch(`${base}/__log`)).json();
  const pb = log.filter((l) => l.at === 'PlaybackInfo');
  assert.deepEqual(pb[0].directPlayProfiles, [{ Type: 'Video' }, { Type: 'Audio' }]);
});

test('Fortschritt melden und Segmente laden', async () => {
  const c = await login();
  const ep = (await c.getItems({ includeItemTypes: 'Episode', recursive: true, limit: 1 })).Items[0];
  const segs = await c.getMediaSegments(ep.Id);
  assert.equal(segs[0].Type, 'Intro');
  await c.reportStart({ ItemId: ep.Id, PositionTicks: 0 });
  await c.reportProgress({ ItemId: ep.Id, PositionTicks: 50_000_000, EventName: 'TimeUpdate' });
  await c.reportStopped({ ItemId: ep.Id, PositionTicks: 90_000_000 });
  const log = await (await fetch(`${base}/__log`)).json();
  const paths = log.map((l) => l.at);
  for (const p of ['/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped']) assert.ok(paths.includes(p), p);
});


test('Abmelden: ein nicht erreichbarer Server haelt das Abmelden nur kurz auf (eigene kurze Zeitgrenze, kein Fehler)', async () => {
  let aborted = false;
  const fetchStub = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(Object.assign(new Error('abgebrochen'), { name: 'AbortError' }));
      });
    });
  const c = new JellyfinClient({ baseUrl: 'http://127.0.0.1:9', token: 't', deviceId: 'd', fetch: fetchStub });
  assert.ok(c.logoutTimeoutMs > 0 && c.logoutTimeoutMs <= 5000, 'die Zeitgrenze fuer das Abmelden ist kurz (vorher galten 20 s wie bei jeder Anfrage)');
  c.logoutTimeoutMs = 60;
  const t0 = Date.now();
  await c.logout();
  assert.equal(aborted, true, 'die Anfrage wurde wegen der Zeitgrenze abgebrochen');
  assert.ok(Date.now() - t0 < 2000);
});