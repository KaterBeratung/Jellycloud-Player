'use strict';
/**
 * Steuerkanal unter Windows (src/main/remote-channel.js, Plan P19) gegen den WebSocket des Testservers: Steuerung wird vor dem Verbinden angemeldet und beim
 * Schliessen abgemeldet, das Token steht nur im Kopf, Lebenszeichen in der halben Frist, nur vier Befehle, Unlesbares wird uebergangen, Wiederaufbau nach
 * einem Abbruch, nach dem Schliessen nichts mehr.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteChannel } = require('../src/main/remote-channel');
const { JellyfinClient } = require('../src/shared/jellyfin');
const { server, state, TOKEN, USER } = require('../tools/mock-server');

let base;
const channels = new Set(); // jeder Kanal der Tests: nach dem Lauf geschlossen, auch wenn eine Pruefung scheitert (sonst haelt ein offener WebSocket den Server)
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  for (const ch of channels) ch.close();
  await fetch(`${base}/__debug/socket?drop=1&refuse=0`, { method: 'POST' }).catch(() => {});
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});
const track = (ch) => (channels.add(ch), ch);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}
const debug = (q) => fetch(`${base}/__debug/socket?${q}`, { method: 'POST' }).then((r) => r.json());
const client = () => new JellyfinClient({ baseUrl: base, token: TOKEN, userId: USER.Id, deviceId: 'geraet-hier', deviceName: 'Testrechner', fetch: globalThis.fetch });
const logAt = (prefix) => state.log.filter((l) => l.at.startsWith(prefix));

test('Öffnen: erst Steuerung anmelden, dann verbinden; das Token nur im Kopf; Lebenszeichen in der halben Frist; die Sitzung ist steuerbar', async () => {
  state.log.length = 0;
  const ch = track(new RemoteChannel({ keepAliveScale: 0.01 })); // 10 s Frist -> alle 50 ms
  const c = client();
  ch.open(c);
  assert.ok(await until(() => logAt('socket:upgrade').length === 1), 'verbunden');
  const order = state.log.map((l) => l.at).filter((a) => a === '/Sessions/Capabilities/Full' || a === 'socket:upgrade');
  assert.deepEqual(order, ['/Sessions/Capabilities/Full', 'socket:upgrade'], 'Steuerung vor dem Verbinden angemeldet');
  assert.equal(logAt('/Sessions/Capabilities/Full')[0].SupportsMediaControl, true);
  const up = logAt('socket:upgrade')[0];
  assert.deepEqual([up.path, up.deviceId, up.authHeader, up.tokenInUrl], ['/socket', 'geraet-hier', true, false]);
  await debug('keepalive=10');
  assert.ok(await until(() => logAt('socket:KeepAlive').length >= 3, 2000), 'Lebenszeichen wiederholt');
  const sessions = await c.remoteSessions();
  const self = sessions.find((s) => s.DeviceId === 'geraet-hier');
  assert.ok(self && self.SupportsRemoteControl === true && self.Client === 'Jellycloud' && self.DeviceName === 'Testrechner', JSON.stringify(self));
  ch.close();
  assert.ok(await until(() => logAt('socket:close').length === 1));
  assert.ok(await until(() => logAt('/Sessions/Capabilities/Full').length === 2));
  assert.equal(logAt('/Sessions/Capabilities/Full')[1].SupportsMediaControl, false, 'beim Schliessen abgemeldet');
});

test('Befehle: nur Stop, Pause, Unpause, PlayPause kommen an; Unlesbares und andere Befehle werden übergangen; Stopp von einem anderen Gerät', async () => {
  state.log.length = 0;
  const ch = track(new RemoteChannel());
  const got = [];
  ch.on('command', (c) => got.push(c));
  const c = client();
  ch.open(c);
  assert.ok(await until(() => logAt('socket:upgrade').length === 1));
  await wait(50);
  for (const cmd of ['Pause', 'Unpause', 'PlayPause', 'Seek', 'NextTrack']) await debug(`command=${cmd}`);
  await debug(`send=${encodeURIComponent('kein JSON')}`);
  await debug(`send=${encodeURIComponent('{"MessageType":"Play","Data":{"ItemIds":["x"],"PlayCommand":"PlayNow"}}')}`);
  await debug(`send=${encodeURIComponent('{"MessageType":"GeneralCommand","Data":{"Name":"SetVolume"}}')}`);
  assert.ok(await until(() => got.length >= 3));
  await wait(150);
  assert.deepEqual(got, ['Pause', 'Unpause', 'PlayPause']);
  // Ein anderes Geraet desselben Kontos haelt diese Sitzung an (wie POST /Sessions/<Id>/Playing/Stop am Server)
  const self = (await c.remoteSessions()).find((s) => s.DeviceId === 'geraet-hier');
  const r = await fetch(`${base}/Sessions/${self.Id}/Playing/Stop`, { method: 'POST', headers: { Authorization: c.authHeader() } });
  assert.equal(r.status, 204);
  assert.ok(await until(() => got.at(-1) === 'Stop'));
  ch.close();
  assert.ok(await until(() => logAt('socket:close').length === 1));
});

test('Abbruch: neuer Versuch, stand eine Verbindung, beginnt die Folge von vorn; nach dem Schliessen kein Versuch mehr', async () => {
  state.log.length = 0;
  const delays = [];
  const ch = track(new RemoteChannel({ retryDelay: (f) => (delays.push(f), 30) }));
  ch.open(client());
  assert.ok(await until(() => logAt('socket:upgrade').length === 1));
  await debug('drop=1');
  assert.ok(await until(() => logAt('socket:upgrade').length === 2), 'neu verbunden');
  assert.equal(delays[0], 0, 'die Verbindung stand: wieder vorn in der Folge');
  // Der Server lehnt ab (etwa ein Proxy ohne WebSocket): die Versuche zaehlen hoch
  await debug('refuse=1');
  await debug('drop=1');
  assert.ok(await until(() => delays.length >= 4, 3000));
  assert.deepEqual(delays.slice(1, 4), [0, 1, 2], 'nach dem Abbruch einer stehenden Verbindung 0, dann bei jedem Scheitern einer mehr');
  ch.close();
  const n = logAt('socket:upgrade').length;
  await wait(200);
  assert.equal(logAt('socket:upgrade').length, n, 'geschlossen: keine Versuche mehr');
  await debug('refuse=0');
});

test('Ohne Anmeldung oder Adresse wird nichts geöffnet', async () => {
  state.log.length = 0;
  const ch = track(new RemoteChannel());
  ch.open(new JellyfinClient({ baseUrl: base, token: null, userId: null, deviceId: 'x', fetch: globalThis.fetch }));
  await wait(100);
  assert.equal(state.log.length, 0);
  assert.equal(ch.wanted, false);
});
