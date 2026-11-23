'use strict';
// Heimnetz und Grenze des Servers gegen den Testserver (Plan P21). Der Testserver laeuft unter 127.0.0.1, also unter einer privaten Adresse: dort entscheidet
// die Einstufung des Servers (state.limits.local), ohne Antwort bleibt es beim Heimnetz. Die Regeln selbst prueft test/bitrate.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JellyfinClient } = require('../src/main/jellyfin');
const { buildDeviceProfile, resolvePlayback } = require('../src/main/profile');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { server, state, items } = require('../tools/mock-server');

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  Object.assign(state.limits, { local: true, user: 0, server: 0, serverForbidden: false, endpointMissing: false, meMissing: false });
  state.log.length = 0;
});

const login = async () => {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'dev-limits' });
  await c.authenticateByName('demo', 'demo');
  return c;
};
const calls = () => state.log.map((l) => l.at).filter((a) => ['/System/Endpoint', '/Users/Me', '/System/Configuration'].includes(a));

test('Heimnetz: genau eine kleine Anfrage, keine Grenzen gelesen, auch wenn welche eingetragen sind', async () => {
  const c = await login();
  state.log.length = 0;
  state.limits.user = 8_000_000;
  const l = await c.getStreamingLimits();
  assert.deepEqual(calls(), ['/System/Endpoint']);
  assert.deepEqual([l.home, l.remote, l.serverView, l.limitBps, l.user, l.server], [true, false, true, 0, 0, 0]);
});

test('Internet: Konto vor Server (wie Jellyfin), sonst die des Servers, sonst keine', async () => {
  const c = await login();
  Object.assign(state.limits, { local: false, user: 8_000_000, server: 20_000_000 });
  state.log.length = 0;
  const l = await c.getStreamingLimits();
  assert.deepEqual([...new Set(calls())].sort(), ['/System/Configuration', '/System/Endpoint', '/Users/Me']);
  assert.deepEqual([l.home, l.remote, l.user, l.server, l.limitBps, l.serverKnown], [false, true, 8_000_000, 20_000_000, 8_000_000, true]);
  Object.assign(state.limits, { user: 30_000_000, server: 20_000_000 });
  assert.equal((await c.getStreamingLimits()).limitBps, 30_000_000, 'die des Kontos gilt, auch wenn sie hoeher ist');
  state.limits.user = 0;
  assert.equal((await c.getStreamingLimits()).limitBps, 20_000_000, 'nur serverweit');
  state.limits.server = 0;
  const none = await c.getStreamingLimits();
  assert.deepEqual([none.limitBps, none.limitRead, none.remote], [0, null, true], 'Internet ohne Grenze');
});

test('Server-Einstellung nur fuer Administratoren: die Grenze des Kontos genuegt; ohne sie ist die Grenze nicht lesbar', async () => {
  const c = await login();
  Object.assign(state.limits, { local: false, user: 6_000_000, server: 20_000_000, serverForbidden: true });
  const l = await c.getStreamingLimits();
  assert.deepEqual([l.serverKnown, l.server, l.user, l.limitBps], [false, 0, 6_000_000, 6_000_000]);
  state.limits.user = 0;
  const unknown = await c.getStreamingLimits();
  assert.deepEqual([unknown.limitRead, unknown.limitBps], [undefined, 0], 'nicht lesbar heisst nicht "keine Grenze" (die Rueckseite nimmt dann die zuletzt bekannte)');
});

test('Server nennt die Verbindungsart nicht (aelterer Server) unter privater Adresse: Heimnetz, nicht gemerkt', async () => {
  const c = await login();
  Object.assign(state.limits, { local: false, user: 8_000_000, endpointMissing: true });
  const l = await c.getStreamingLimits();
  assert.deepEqual([l.home, l.serverView, l.settled, l.limitBps], [true, null, false, 0]);
});

test('Wirkung beim Server: im Heimnetz Direct Play; im Internet ueber der Grenze ein Transcode, auch wenn der Client "keine Grenze" nennt', async () => {
  const c = await login();
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol'); // 52 Mbit/s
  const play = async () => {
    const info = await c.getPlaybackInfo(movie.Id, { deviceProfile: buildDeviceProfile(), startTicks: 0, maxBitrate: 400_000_000 });
    return resolvePlayback({ info, base, itemId: movie.Id, deviceId: 'dev-limits' });
  };
  assert.equal((await play()).method, 'DirectPlay');
  Object.assign(state.limits, { local: false, user: 0, server: 8_000_000 });
  assert.equal((await play()).method, 'Transcode', 'der Client verlangt 400 Mbit/s, die Grenze des Servers gilt trotzdem');
  Object.assign(state.limits, { local: false, server: 80_000_000 });
  assert.equal((await play()).method, 'DirectPlay', 'Datei unter der Grenze: weiter Direct Play');
  Object.assign(state.limits, { local: true, server: 8_000_000 });
  assert.equal((await play()).method, 'DirectPlay', 'im Heimnetz gilt die Grenze nicht');
});

// ---------- Rueckseite: Speicher, zuletzt bekannte Grenze, Netzwechsel ----------

function memoryConfig() {
  const store = { text: null };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => Buffer.from(t).toString('hex').slice(-12) };
  return new ConfigCore({ read: () => store.text, write: (t) => (store.text = t), backupCorrupt: () => {} }, codec, env);
}

test('Rueckseite: Grenze nicht lesbar -> die zuletzt gelesene gilt weiter; gemerkt je Netz, ein anderes Netz fragt neu', async () => {
  const net = { signature: 'wlan-a' };
  const backend = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1', locale: () => 'de', connection: () => ({ signature: net.signature }) });
  Object.assign(state.limits, { local: false, user: 15_000_000 });
  await backend.login({ url: base, username: 'demo', password: 'demo' });
  const first = await backend.refreshLimits(true);
  assert.deepEqual([first.home, first.limitBps, !!first.limitStale], [false, 15_000_000, false]);
  state.limits.meMissing = true;
  const stale = await backend.refreshLimits(true);
  assert.deepEqual([stale.limitBps, stale.limitStale], [15_000_000, true], 'zuletzt bekannte Grenze');
  state.limits.meMissing = false;
  state.limits.user = 0;
  assert.equal((await backend.refreshLimits(true)).limitBps, 0, 'der Server sagt ausdruecklich "keine": das gilt');
  state.log.length = 0;
  await backend.refreshLimits(false);
  assert.deepEqual(calls(), [], 'gemerkt (zehn Minuten, gleiches Netz)');
  net.signature = 'mobil';
  await backend.refreshLimits(false);
  assert.ok(calls().includes('/System/Endpoint'), 'anderes Netz: neu gefragt');
  await backend.logout();
  assert.equal(backend.limits, null);
});

test('Rueckseite: Bandbreite ueber /Playback/BitrateTest, eine Messung fuer mehrere Fragen, gemerkt', async () => {
  const backend = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1', locale: () => 'de' });
  await backend.login({ url: base, username: 'demo', password: 'demo' });
  state.log.length = 0;
  const [a, b] = await Promise.all([backend.measureBandwidth({ quick: true }), backend.measureBandwidth()]);
  assert.ok(a > 0 && a === b, `${a} / ${b}`);
  const tests = state.log.filter((l) => l.at === 'BitrateTest');
  assert.equal(tests[0]?.size, 1_000_000, '1 MB zuerst');
  const n = tests.length;
  await backend.measureBandwidth();
  assert.equal(state.log.filter((l) => l.at === 'BitrateTest').length, n, 'gemerkt');
  await backend.logout();
});
