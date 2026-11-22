'use strict';

// Konto, Profile, Verbindungspruefung und Quick Connect fuer andere Geraete (Plan P8, K3 bis K8): die Faelle der Apple-App
// (JellycloudTests/ProfileLimitAndCheckTests.swift, 3 Tests) und die Regeln der Rueckseite (src/shared/backend.js) gegen einen kleinen Ersatzserver.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, withDeadline, CHECK_TIMEOUT_MS } = require('../src/shared/backend');
const { ConfigCore, MAX_PROFILES } = require('../src/shared/config-core');

function memoryConfig(initial = null) {
  const store = { text: initial };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  const io = { read: () => store.text, write: (t) => (store.text = t) };
  return { config: new ConfigCore(io, codec, env), store };
}

const json = (status, body, extra = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => ({ 'content-type': 'application/json', ...extra })[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const text = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'text/plain' }, json: async () => body, text: async () => body });
const aborted = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

/**
 * Ersatzserver hinter fetch. Hosts: jf.test (Server "srv"), jf2.test (DERSELBE Server unter anderer Adresse), other.test (ein anderer Server).
 * Tokens gelten auf dem Server, der sie ausgegeben hat. Schalter: down (Hosts ohne Netz), hangMe (/Users/Me antwortet nie), qc (Quick Connect).
 */
function fakeNet() {
  // proxy.test: meldet sich als derselbe Server, ordnet das Token aber einem anderen Benutzer zu (ein falsch eingerichteter Proxy davor)
  const servers = { 'jf.test': 'srv', 'jf2.test': 'srv', 'proxy.test': 'srv', 'other.test': 'srv-other' };
  const tokens = { srv: new Set(), 'srv-other': new Set() };
  const net = { log: [], down: new Set(), hangMe: false, admin: false, qc: { enabled: true, answer: () => json(200, true) }, seerr: { up: true, session: true } };
  net.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const tok = /Token="([^"]+)"/.exec(init.headers?.Authorization ?? '')?.[1] ?? null;
    net.log.push({ method: init.method ?? 'GET', host: u.host, path: u.pathname, query: u.search, token: tok });
    if (net.down.has(u.hostname)) throw new TypeError('fetch failed');
    if (u.pathname.startsWith('/api/v1/')) {
      if (!net.seerr.up) throw new TypeError('fetch failed');
      if (u.pathname === '/api/v1/status') return json(200, { version: '2.0.0' });
      if (u.pathname === '/api/v1/auth/jellyfin') {
        const b = JSON.parse(init.body);
        return json(200, { id: 7, displayName: `Seerr-${b.username}`, jellyfinUserId: `jf-${b.username}` }, { 'set-cookie': `connect.sid=SID-${b.username}; Path=/` });
      }
      if (u.pathname === '/api/v1/auth/me') {
        const who = /connect\.sid=SID-(\w+)/.exec(init.headers?.Cookie ?? '')?.[1];
        return net.seerr.session && who ? json(200, { id: 7, displayName: `Seerr-${who}`, jellyfinUserId: `jf-${who}`, permissions: 32 }) : json(403, { message: 'no' });
      }
      return json(404, {});
    }
    const sid = servers[u.hostname];
    if (u.pathname === '/System/Info/Public') return json(200, { Id: sid, ServerName: sid === 'srv' ? 'Testserver' : 'Fremd', Version: '10.10.3' });
    if (u.pathname === '/Users/AuthenticateByName') {
      const b = JSON.parse(init.body);
      const t = `tok-${b.Username}-${sid}`;
      tokens[sid].add(t);
      return json(200, { AccessToken: t, User: { Id: `u-${b.Username}`, Name: b.Username }, ServerId: sid });
    }
    if (u.pathname === '/QuickConnect/Enabled') return json(200, net.qc.enabled);
    const authed = tok && tokens[sid]?.has(tok);
    if (u.pathname === '/Sessions/Logout') return json(204, null);
    if (u.pathname === '/Sessions/Capabilities/Full') return json(204, null);
    if (u.pathname === '/System/Endpoint') return json(200, { IsInNetwork: true });
    if (!authed) return json(401, { Message: 'Unauthorized' });
    if (u.pathname === '/Users/Me') {
      if (net.hangMe) return aborted(init.signal);
      if (u.hostname === 'proxy.test') return json(200, { Id: 'u-jemand-anderes' });
      return json(200, { Id: /tok-(\w+)-/.exec(tok)[1].replace(/^/, 'u-'), Policy: { IsAdministrator: net.admin } });
    }
    if (u.pathname === '/QuickConnect/Authorize') return net.qc.answer(u);
    return json(404, {});
  };
  return net;
}

function make({ checkTimeoutMs } = {}) {
  const mem = memoryConfig();
  const net = fakeNet();
  const backend = createBackend({ config: mem.config, fetch: net.fetch, appVersion: () => '1.2.7', locale: () => 'de-DE', deviceName: 'Test', ...(checkTimeoutMs ? { checkTimeoutMs } : {}) });
  return { backend, mem, net, config: mem.config };
}
const login = (b, user, host = 'jf.test') => b.login({ url: `http://${host}`, username: user, password: 'pw' });
const calls = (net, path) => net.log.filter((l) => l.path === path);

// ---------- Apple: ProfileLimitAndCheckTests ----------

test('Bis drei Profile kommt ein viertes dazu; ab vier keines mehr, ueber alle Server zusammen', async () => {
  const { backend, config } = make();
  assert.equal(MAX_PROFILES, 4);
  for (const u of ['a', 'b', 'c']) await login(backend, u, u === 'b' ? 'other.test' : 'jf.test');
  assert.ok(config.mayAddProfile(config.profileId('http://neu.test', 'x')));
  await login(backend, 'd');
  assert.ok(!config.mayAddProfile(config.profileId('http://neu.test', 'x')));
  assert.ok(!config.mayAddProfile(config.profileId('http://jf.test', 'u-neu')), 'gleicher Server, neuer Benutzer');
});

test('Ein schon gemerktes Profil darf sich immer neu anmelden; Profile ueber dem Limit bleiben, es kommt nur keines dazu', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, url: `http://s${i % 2}.test`, name: 'S', userId: `u${i}`, userName: `u${i}`, token: 'plain:dA==' }));
  const { config } = memoryConfig(JSON.stringify({ version: 10, deviceId: 'd', activeServerId: 'p0', servers: six, settings: {} }));
  assert.equal(config.data.servers.length, 6, 'nichts geloescht');
  assert.ok(config.mayAddProfile('p5'));
  assert.ok(!config.mayAddProfile('neu'));
  for (const id of ['p3', 'p4', 'p5']) config.removeServer(id);
  assert.ok(config.mayAddProfile('neu'), 'nach dem Entfernen wieder moeglich');
});

test('Verbindungspruefung: schnelle Antwort sofort, haengende Pruefung nach der Frist abgebrochen, ohne Wiederholung', async () => {
  assert.equal(CHECK_TIMEOUT_MS, 30000);
  const start = Date.now();
  assert.equal(await withDeadline(2000, async () => 42), 42);
  assert.ok(Date.now() - start < 500);
  let n = 0;
  let signal = null;
  await assert.rejects(
    () =>
      withDeadline(200, (s) => {
        n++;
        signal = s;
        return new Promise(() => {});
      }),
    (e) => e.code === 'TIMEOUT'
  );
  assert.ok(Date.now() - start < 3000);
  assert.equal(n, 1, 'kein zweiter Versuch');
  assert.ok(signal.aborted, 'die haengende Anfrage wird abgebrochen');
});

// ---------- Verbindungspruefung (K8) ----------

test('Pruefung: Jellyfin /Users/Me und Seerr /status + /auth/me nebeneinander; Administrator kommt mit', async () => {
  const { backend, net } = make();
  assert.deepEqual(await backend.checkConnection(), { profileId: null, jellyfin: { state: 'none' }, seerr: { state: 'none' } }, 'ohne Profil nichts zu pruefen');
  await login(backend, 'anna');
  net.admin = true;
  let r = await backend.checkConnection();
  assert.deepEqual(r.jellyfin, { state: 'connected', isAdmin: true });
  assert.deepEqual(r.seerr, { state: 'none' }, 'ohne Seerr nicht eingerichtet');
  await backend.seerrConnect({ url: 'http://seerr.test', username: 'anna', password: 'pw' });
  r = await backend.checkConnection();
  assert.deepEqual(r.seerr, { state: 'connected', user: { id: 7, displayName: 'Seerr-anna', permissions: 32 } }, 'mit dem Seerr-Benutzer und seinen Rechten');
  assert.ok(calls(net, '/api/v1/status').length >= 2 && calls(net, '/api/v1/auth/me').length === 2, 'einmal bei der Anmeldung, einmal in der Pruefung');
  // Seerr aus: Jellyfin bleibt verbunden, die Seerr-Sitzung bleibt gespeichert
  net.seerr.up = false;
  r = await backend.checkConnection();
  assert.equal(r.jellyfin.state, 'connected');
  assert.equal(r.seerr.state, 'unreachable');
  assert.ok(backend.publicState().seerr, 'ein Ausfall loescht keine Einrichtung');
  net.seerr.up = true;
  net.seerr.session = false;
  assert.equal((await backend.checkConnection()).seerr.state, 'unauthorized');
});

test('Pruefung bei Netzfehler: "nicht erreichbar", nichts wird geloescht; abgelehnte Anmeldung: "unauthorized", auch dann bleibt alles', async () => {
  const { backend, net, mem } = make();
  await login(backend, 'anna');
  const before = mem.store.text;
  net.down.add('jf.test');
  const r = await backend.checkConnection();
  assert.equal(r.jellyfin.state, 'unreachable');
  assert.equal(mem.store.text, before, 'Konfiguration unveraendert (Anmeldung und Profil bleiben)');
  assert.equal(backend.publicState().loggedIn, true);
  net.down.clear();
  backend.client.token = 'abgelaufen';
  assert.equal((await backend.checkConnection()).jellyfin.state, 'unauthorized');
  assert.equal(mem.store.text, before, 'auch ein 401 loescht nichts (die Oberflaeche zeigt die Anmeldung)');
});

test('Pruefung: haengender Server nach der Frist "nicht erreichbar", eine einzige Anfrage; ein zweiter Anlass bekommt dieselbe Pruefung', async () => {
  const { backend, net } = make({ checkTimeoutMs: 150 });
  await login(backend, 'anna');
  net.hangMe = true;
  const t0 = Date.now();
  const [a, b] = await Promise.all([backend.checkConnection(), backend.checkConnection({ seerr: false })]);
  assert.deepEqual(a.jellyfin, b.jellyfin, 'dieselbe Pruefung');
  assert.ok(!('seerr' in b), 'ohne Seerr: nur Jellyfin (darauf wartet der Start)');
  assert.equal(a.jellyfin.state, 'unreachable');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(calls(net, '/Users/Me').length, 1, 'keine Doppelanfrage, kein Wiederholen');
});

// ---------- Profile (K6, K7) ----------

test('Profil umbenennen: eigener Name nur auf dem Geraet, leer heisst wieder der Benutzername', async () => {
  const { backend } = make();
  await login(backend, 'anna');
  const id = backend.publicState().activeServerId;
  const r = await backend.updateProfile({ id, label: '  Wohnzimmer ', url: 'http://jf.test' });
  assert.equal(r.id, id, 'gleiche Adresse: gleiche Kennung');
  assert.equal(r.state.servers[0].label, 'Wohnzimmer');
  assert.equal((await backend.updateProfile({ id, label: '' })).state.servers[0].label, '');
});

test('Neue Adresse fuer denselben Server: das Profil bleibt angemeldet, Name, Seerr und Reihen ziehen mit, es bleibt aktiv', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  const id = backend.publicState().activeServerId;
  await backend.updateProfile({ id, label: 'Anna' });
  await backend.seerrConnect({ url: 'http://seerr.test', username: 'anna', password: 'pw' });
  config.setHomeRows({ order: ['latest', 'resume'], hidden: ['nextUp'] }, id);
  // Der Server ist unter der neuen Adresse derselbe; sein Token gilt dort (gleicher Server)
  net.log.length = 0;
  const r = await backend.updateProfile({ id, label: 'Anna', url: 'jf2.test' });
  assert.notEqual(r.id, id, 'die Kennung haengt an der Adresse');
  const s = r.state.servers.find((x) => x.id === r.id);
  assert.equal(s.url, 'https://jf2.test');
  assert.equal(s.label, 'Anna');
  assert.equal(r.state.activeServerId, r.id, 'bleibt aktiv');
  assert.equal(r.state.servers.length, 1, 'kein zweites Profil');
  assert.ok(r.state.seerr, 'Seerr zieht mit');
  assert.deepEqual(config.homeRows(r.id).hidden, ['nextUp'], 'die Reihen der Startseite ziehen mit');
  assert.ok(!calls(net, '/Users/AuthenticateByName').length, 'keine neue Anmeldung');
  assert.equal(backend.client.baseUrl, 'https://jf2.test', 'die Verbindung geht an die neue Adresse');
  assert.equal((await backend.checkConnection()).jellyfin.state, 'connected');
});

test('Neue Adresse eines anderen Servers oder ohne gueltige Anmeldung dort: abgelehnt, nichts aendert sich', async () => {
  const { backend, mem, net } = make();
  await login(backend, 'anna');
  const id = backend.publicState().activeServerId;
  const before = mem.store.text;
  await assert.rejects(() => backend.updateProfile({ id, url: 'http://other.test' }), (e) => e.code === 'OTHER_SERVER');
  assert.equal(mem.store.text, before);
  assert.ok(!net.log.some((l) => l.host === 'other.test' && l.token), 'die Anmeldung des Profils geht nie an einen fremden Server (die Kennung verraet ihn vorher)');
  // Derselbe Server laut Kennung, aber das Token gehoert dort einem anderen Benutzer: abgelehnt
  await assert.rejects(() => backend.updateProfile({ id, url: 'http://proxy.test' }), (e) => e.code === 'OTHER_SERVER');
  assert.equal(mem.store.text, before);
  // Ein altes Profil ohne gemerkte Server-Kennung: dann entscheidet die Anmeldung dort (der fremde Server kennt das Token nicht)
  const raw = JSON.parse(mem.store.text);
  delete raw.servers[0].serverId;
  const old = memoryConfig(JSON.stringify(raw));
  const b2 = createBackend({ config: old.config, fetch: net.fetch, appVersion: () => '1', locale: () => 'de' });
  b2.activateServer(id);
  await assert.rejects(() => b2.updateProfile({ id, url: 'http://other.test' }), (e) => e.code === 'OTHER_SERVER');
  assert.equal(old.config.getServer(id).url, 'http://jf.test');
  // Nicht erreichbar: der Fehler der Pruefung, das Profil bleibt
  net.down.add('jf2.test');
  await assert.rejects(() => backend.updateProfile({ id, url: 'http://jf2.test' }), (e) => e.code === 'OFFLINE');
  assert.equal(mem.store.text, before);
});

test('Dasselbe Konto unter der neuen Adresse schon gemerkt: PROFILE_EXISTS statt stillem Zusammenlegen', async () => {
  const { backend } = make();
  await login(backend, 'anna', 'jf2.test');
  await login(backend, 'anna');
  const id = backend.publicState().activeServerId;
  await assert.rejects(() => backend.updateProfile({ id, url: 'http://jf2.test' }), (e) => e.code === 'PROFILE_EXISTS');
  assert.equal(backend.publicState().servers.length, 2);
});

test('Profil entfernen: ein anderes wird mit SEINER Anmeldung am Server abgemeldet, das aktive bleibt; das aktive entfernen heisst abmelden', async () => {
  const { backend, net } = make();
  await login(backend, 'anna');
  const anna = backend.publicState().activeServerId;
  await login(backend, 'bert');
  const bert = backend.publicState().activeServerId;
  net.log.length = 0;
  const s = await backend.removeProfile(anna);
  assert.deepEqual(calls(net, '/Sessions/Logout').map((l) => l.token), ['tok-anna-srv'], 'mit dem Token von anna, nicht dem aktiven');
  assert.deepEqual(s.servers.map((x) => x.id), [bert]);
  assert.equal(s.activeServerId, bert);
  assert.equal(backend.client.userId, 'u-bert', 'die Verbindung des aktiven bleibt');
  const out = await backend.removeProfile(bert);
  assert.equal(out.loggedIn, false);
  assert.deepEqual(out.servers, []);
});

// ---------- Quick Connect fuer andere Geraete (K3) ----------

test('Quick Connect bestaetigen: POST /QuickConnect/Authorize mit Code und Benutzer des Profils; der Code steht nirgends sonst', async () => {
  const { backend, net, mem } = make();
  await login(backend, 'anna');
  const id = backend.publicState().activeServerId;
  assert.equal(await backend.quickConnectAvailable(id), true);
  assert.equal(await backend.quickConnectAuthorize({ id, code: '428 193' }), true);
  const a = calls(net, '/QuickConnect/Authorize');
  assert.equal(a.length, 1);
  assert.equal(a[0].method, 'POST');
  assert.equal(new URLSearchParams(a[0].query).get('code'), '428193');
  assert.equal(new URLSearchParams(a[0].query).get('userId'), 'u-anna');
  assert.ok(!mem.store.text.includes('428193'), 'nicht in der Konfiguration');
  // Unvollstaendig: gar keine Anfrage
  await assert.rejects(() => backend.quickConnectAuthorize({ id, code: '4281' }), (e) => e.status === 400);
  assert.equal(calls(net, '/QuickConnect/Authorize').length, 1);
});

test('Quick Connect: Antworten des Servers kommen mit Status und Hinweis an (der Text der Antwort geht nicht ueber die IPC-Grenze)', async () => {
  const { backend, net } = make();
  await login(backend, 'anna');
  const id = backend.publicState().activeServerId;
  const answer = (status, body) => (net.qc.answer = () => text(status, body));
  answer(404, 'Unable to find request');
  await assert.rejects(() => backend.quickConnectAuthorize({ id, code: '111111' }), (e) => e.status === 404 && !e.code);
  answer(500, 'Request is already authorized');
  await assert.rejects(() => backend.quickConnectAuthorize({ id, code: '111111' }), (e) => e.status === 500 && e.code === 'QC_ALREADY');
  answer(401, 'Quick connect is disabled');
  await assert.rejects(() => backend.quickConnectAuthorize({ id, code: '111111' }), (e) => e.status === 401 && e.code === 'QC_DISABLED');
  answer(401, '');
  await assert.rejects(() => backend.quickConnectAuthorize({ id, code: '111111' }), (e) => e.status === 401 && !e.code);
  net.down.add('jf.test');
  await assert.rejects(() => backend.quickConnectAuthorize({ id, code: '111111' }), (e) => e.status === 0 && e.code === 'OFFLINE');
  await assert.rejects(() => backend.quickConnectAvailable(id), (e) => e.code === 'OFFLINE', 'nicht erreichbar heisst nicht "ausgeschaltet"');
  net.down.clear();
  net.qc.enabled = false;
  assert.equal(await backend.quickConnectAvailable(id), false);
});

test('Quick Connect gilt fuer das Profil der offenen Maske, auch wenn inzwischen ein anderes aktiv ist', async () => {
  const { backend, net } = make();
  await login(backend, 'anna');
  const anna = backend.publicState().activeServerId;
  await login(backend, 'bert');
  net.log.length = 0;
  await backend.quickConnectAuthorize({ id: anna, code: '428193' });
  const [a] = calls(net, '/QuickConnect/Authorize');
  assert.equal(a.token, 'tok-anna-srv');
  assert.equal(new URLSearchParams(a.query).get('userId'), 'u-anna');
  assert.equal(backend.client.userId, 'u-bert', 'das aktive Profil bleibt');
  await assert.rejects(() => backend.quickConnectAuthorize({ id: 'gibtsnicht', code: '428193' }), (e) => e.code === 'NO_PROFILE');
});
