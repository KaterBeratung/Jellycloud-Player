'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JellyfinClient, describeStreamingLimits } = require('../src/main/jellyfin');
const { buildDeviceProfile, resolvePlayback } = require('../src/main/profile');
const { server, state, items } = require('../tools/mock-server');

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  Object.assign(state.limits, { local: true, user: 0, server: 0, serverForbidden: false, endpointMissing: false });
  state.log.length = 0;
});

const login = async () => {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'dev-limits' });
  await c.authenticateByName('demo', 'demo');
  return c;
};
const calls = () => state.log.map((l) => l.at).filter((a) => ['/System/Endpoint', '/Users/Me', '/System/Configuration'].includes(a));

test('Auswertung: lokal oder Internet, die kleinere Grenze gilt, 0 und Unsinn bedeuten keine Grenze', () => {
  assert.equal(describeStreamingLimits({ endpoint: { IsInNetwork: true } }).remote, false);
  assert.equal(describeStreamingLimits({ endpoint: { IsLocal: true, IsInNetwork: false } }).remote, false, 'Loopback zaehlt als lokal');
  assert.equal(describeStreamingLimits({ endpoint: { IsLocal: false, IsInNetwork: false } }).remote, true);
  assert.equal(describeStreamingLimits({}).remote, null, 'ohne Antwort: unbekannt');
  const both = describeStreamingLimits({ endpoint: { IsInNetwork: false }, me: { Policy: { RemoteClientBitrateLimit: 8_000_000 } }, config: { RemoteClientBitrateLimit: 20_000_000 } });
  assert.deepEqual([both.user, both.server, both.limitBps, both.serverKnown], [8_000_000, 20_000_000, 8_000_000, true]);
  assert.equal(describeStreamingLimits({ endpoint: { IsInNetwork: false }, config: { RemoteClientBitrateLimit: 12_000_000 } }).limitBps, 12_000_000, 'nur serverweit');
  for (const bad of [0, -5, null, undefined, 'x', NaN]) {
    const r = describeStreamingLimits({ endpoint: { IsInNetwork: false }, me: { Policy: { RemoteClientBitrateLimit: bad } }, config: { RemoteClientBitrateLimit: bad } });
    assert.equal(r.limitBps, 0, `Wert ${bad}`);
  }
  assert.equal(describeStreamingLimits({ endpoint: { IsInNetwork: false }, me: {}, config: null }).serverKnown, false);
});

test('Lokales Netz: genau eine kleine Anfrage, keine weiteren Abfragen', async () => {
  const c = await login();
  state.log.length = 0;
  state.limits.user = 8_000_000; // selbst eine eingetragene Grenze ist im LAN ohne Bedeutung
  const l = await c.getStreamingLimits();
  assert.deepEqual(calls(), ['/System/Endpoint']);
  assert.deepEqual([l.remote, l.limitBps, l.user, l.server], [false, 0, 0, 0]);
});

test('Internet: Benutzer-Richtlinie und Server-Einstellung werden gelesen, die kleinere gilt', async () => {
  const c = await login();
  state.limits.local = false;
  state.limits.user = 8_000_000;
  state.limits.server = 20_000_000;
  state.log.length = 0;
  const l = await c.getStreamingLimits();
  assert.deepEqual([...new Set(calls())].sort(), ['/System/Configuration', '/System/Endpoint', '/Users/Me']);
  assert.deepEqual([l.remote, l.user, l.server, l.limitBps, l.serverKnown], [true, 8_000_000, 20_000_000, 8_000_000, true]);
  state.limits.user = 0;
  assert.equal((await c.getStreamingLimits()).limitBps, 20_000_000, 'nur serverweit');
  state.limits.server = 0;
  assert.deepEqual([(await c.getStreamingLimits()).limitBps, (await c.getStreamingLimits()).remote], [0, true], 'Internet ohne Limit');
});

test('Server-Einstellung nur fuer Administratoren: die Grenze des Benutzers wird trotzdem erkannt', async () => {
  const c = await login();
  Object.assign(state.limits, { local: false, user: 6_000_000, server: 20_000_000, serverForbidden: true });
  const l = await c.getStreamingLimits();
  assert.deepEqual([l.serverKnown, l.server, l.user, l.limitBps], [false, 0, 6_000_000, 6_000_000]);
});

test('Verbindungsart nicht erkennbar (aelterer Server): die Grenzen werden trotzdem gelesen, remote ist unbekannt', async () => {
  const c = await login();
  Object.assign(state.limits, { local: false, user: 8_000_000, endpointMissing: true });
  const l = await c.getStreamingLimits();
  assert.equal(l.remote, null);
  assert.equal(l.limitBps, 8_000_000);
});

test('Wirkung beim Server: im LAN Direct Play, im Internet ueber der Grenze ein Transcode, auch wenn der Client "alles" meldet', async () => {
  const c = await login();
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol'); // 52 Mbit/s
  const play = async () => {
    const info = await c.getPlaybackInfo(movie.Id, { deviceProfile: buildDeviceProfile(), startTicks: 0 });
    return resolvePlayback({ info, base, itemId: movie.Id, deviceId: 'dev-limits' });
  };
  assert.equal((await play()).method, 'DirectPlay');
  Object.assign(state.limits, { local: false, user: 0, server: 8_000_000 });
  const limited = await play();
  assert.equal(limited.method, 'Transcode', 'der Client verlangt 1 Gbit/s, die Grenze des Servers gilt trotzdem');
  Object.assign(state.limits, { local: false, server: 80_000_000 });
  assert.equal((await play()).method, 'DirectPlay', 'Datei unter der Grenze: weiter Direct Play');
  Object.assign(state.limits, { local: true, server: 8_000_000 });
  assert.equal((await play()).method, 'DirectPlay', 'im LAN gilt die Grenze nicht');
});
