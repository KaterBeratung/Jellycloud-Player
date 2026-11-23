'use strict';
/**
 * "Auf diesem Geraet fortsetzen" in der Rueckseite (src/shared/backend.js, Plan P19) gegen den Testserver: die Oberflaeche bekommt nur Sitzungen des eigenen
 * Kontos (auch wenn der Server einem Administrator alle nennt), angehalten wird nur eine eben gelesene eigene Sitzung eines anderen Geraets, der Eintrag
 * nennt die gemerkte Stelle.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/shared/handoff');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { server, state, items, setAdmin, USER } = require('../tools/mock-server');

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => new Promise((r) => server.close(r)));

function memoryConfig() {
  const store = { text: null };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  return new ConfigCore({ read: () => store.text, write: (t) => (store.text = t) }, codec, env);
}
const stage = (q) => fetch(`${base}/__debug/session?${q}`, { method: 'POST' }).then((r) => r.json());

test('Nur Sitzungen des eigenen Kontos verlassen die Rückseite, auch für einen Administrator; angeboten wird das andere Gerät', async () => {
  await stage('clear=1');
  setAdmin(true);
  try {
    const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.18', locale: () => 'de-DE' });
    await b.login({ url: base, username: 'demo', password: 'demo' });
    await stage('device=Wohnzimmer%20Apple%20TV&at=120');
    await stage('device=Fremdes%20Tablet&user=other&at=300');
    const r = await b.handoffSessions();
    assert.equal(r.own.ownUserId, USER.Id);
    assert.ok(r.own.ownDeviceId);
    assert.ok(r.sessions.every((s) => H.sameId(s.userId, USER.Id)), 'keine fremden Sitzungen (lena, max, das fremde Tablet)');
    assert.ok(!JSON.stringify(r).includes('lena') && !JSON.stringify(r).includes('Fremdes Tablet'));
    const offers = H.offers(r.sessions, { ...r.own, now: Date.now() });
    assert.deepEqual(offers.map((s) => s.deviceName), ['Wohnzimmer Apple TV']);
    assert.equal(state.log.find((l) => l.at === 'GET /Sessions')?.active, '90');
  } finally {
    setAdmin(false);
  }
});

test('Angehalten wird nur eine eben gelesene eigene Sitzung; der Eintrag nennt danach die gemerkte Stelle', async () => {
  await stage('clear=1');
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.18', locale: () => 'de-DE' });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  const { item } = await stage('device=Wohnzimmer%20Apple%20TV&at=120');
  await assert.rejects(() => b.handoffStop('remote1'), (e) => e.code === 'HANDOFF_FOREIGN', 'ohne vorherige Abfrage nicht');
  const { sessions } = await b.handoffSessions();
  const s = sessions.find((x) => x.deviceName === 'Wohnzimmer Apple TV');
  await assert.rejects(() => b.handoffStop('sess-2'), (e) => e.code === 'HANDOFF_FOREIGN', 'eine nicht gelesene Kennung nicht');
  const before = await b.handoffItem({ id: item, timeout: 8000 });
  assert.equal(before.playable, true);
  assert.equal(await b.handoffStop(s.id), true);
  assert.ok(state.log.some((l) => l.at === 'RemoteStop' && l.SessionId === s.id));
  const after = await b.handoffItem({ id: item, timeout: 1500 });
  assert.ok(after.positionTicks >= 120 * H.TICKS_PER_SECOND && after.positionTicks !== before.positionTicks, `gemerkte Stelle ${after.positionTicks}`);
  await assert.rejects(() => b.handoffItem({ id: 'kein-eintrag' }), (e) => e.status === 400);
  assert.ok(items.has(item));
});

test('Ohne Anmeldung keine Abfrage', async () => {
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.18', locale: () => 'de-DE' });
  await assert.rejects(() => b.handoffSessions(), (e) => e.status === 401);
});
