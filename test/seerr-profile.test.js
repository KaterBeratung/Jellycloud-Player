'use strict';

// Seerr je Profil und vier Zustaende (Plan P10; S1 bis S4, S10, S11): die Faelle der Apple-App (JellycloudTests/SeerrProfileTests.swift) und die
// plattformunabhaengigen Faelle aus Notizen/seerr-integration.md ("Plattformunabhaengige Testfaelle" 1, 2, 9 bis 11), gegen einen kleinen Ersatzserver.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, acceptsSeerrUser } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { SeerrClient, normalizeUser, seerrLanguage, CONTENT_PATHS } = require('../src/shared/seerr');

function memoryConfig(initial = null, codec = null) {
  const store = { text: initial };
  const plain = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  const io = { read: () => store.text, write: (t) => (store.text = t) };
  return { config: new ConfigCore(io, codec ?? plain, env), store };
}

const json = (status, body, extra = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => ({ 'content-type': 'application/json', ...extra })[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
const hang = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

/**
 * Jellyfin (jf.test) und Seerr (seerr.test) hinter einem fetch. Jellyfin-Benutzer heissen u-<name>; bei Seerr meldet sich jedes Jellyfin-Konto mit Passwort
 * "pw" an und bekommt die Sitzung SID-<name>. /auth/me nennt dazu das Jellyfin-Konto (identity[name] stellt ein anderes, '' keines) und die Rechte
 * (perms[name], sonst 32). Schalter: down (Seerr aus), hang (Seerr antwortet nie), expired (jede Sitzung abgelaufen).
 */
function fakeNet() {
  const net = { log: [], down: false, hang: false, expired: false, identity: {}, perms: {} };
  net.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const cookie = init.headers?.Cookie ?? null;
    net.log.push({ method: init.method ?? 'GET', host: u.host, path: u.pathname, query: u.searchParams, cookie, cache: init.cache, credentials: init.credentials });
    if (u.hostname === 'seerr.test') {
      if (net.down) throw new TypeError('fetch failed');
      if (net.hang) return hang(init.signal);
      if (u.pathname === '/api/v1/status') return json(200, { version: '3.5.1' });
      if (u.pathname === '/api/v1/auth/jellyfin') {
        const b = JSON.parse(init.body);
        if (b.password !== 'pw') return json(401, { message: 'no' });
        return json(200, { id: 1 }, { 'set-cookie': `connect.sid=SID-${b.username}; Path=/; HttpOnly` });
      }
      const who = /connect\.sid=SID-(\w+)/.exec(cookie ?? '')?.[1];
      if (!who) return json(403, { message: 'no' });
      if (net.expired) return json(401, { message: 'Unauthorized' });
      if (u.pathname === '/api/v1/auth/me') return json(200, { id: who.length, displayName: `Seerr ${who}`, jellyfinUserId: who in net.identity ? net.identity[who] : `u-${who}`, permissions: net.perms[who] ?? 32 });
      if (u.pathname === '/api/v1/auth/logout') return json(200, { status: 'ok' });
      if (u.pathname === '/api/v1/search') return json(200, { results: [{ mediaType: 'movie', id: 1, title: `Treffer fuer ${who}` }], totalPages: 1 });
      if (u.pathname === '/api/v1/discover/trending') return json(200, { results: [], totalPages: 1 });
      if (/^\/api\/v1\/(movie|tv)\/\d+$/.test(u.pathname)) return json(200, { id: 1, title: 'T' });
      return json(404, {});
    }
    if (u.pathname === '/System/Info/Public') return json(200, { Id: 'srv', ServerName: 'Testserver', Version: '10.10.3' });
    if (u.pathname === '/Users/AuthenticateByName') {
      const b = JSON.parse(init.body);
      return json(200, { AccessToken: `tok-${b.Username}`, User: { Id: `u-${b.Username}`, Name: b.Username }, ServerId: 'srv' });
    }
    if (u.pathname === '/Users/Me') return json(200, { Id: 'u-x', Policy: { IsAdministrator: false } });
    if (['/Sessions/Logout', '/Sessions/Capabilities/Full'].includes(u.pathname)) return json(204, null);
    if (u.pathname === '/System/Endpoint') return json(200, { IsInNetwork: true });
    return json(404, {});
  };
  return net;
}

function make({ codec, language, checkTimeoutMs } = {}) {
  const mem = memoryConfig(null, codec);
  const net = fakeNet();
  const backend = createBackend({ config: mem.config, fetch: (...a) => net.fetch(...a), appVersion: () => '1.2.9', locale: () => language ?? 'de-DE', deviceName: 'Test', ...(checkTimeoutMs ? { checkTimeoutMs } : {}) });
  return { backend, net, config: mem.config, mem };
}
const login = (b, user) => b.login({ url: 'http://jf.test', username: user, password: 'pw' });
const connect = (b, user, password = 'pw') => b.seerrConnect({ url: 'http://seerr.test', username: user, password });
const seerrCalls = (net, path = null) => net.log.filter((l) => l.host === 'seerr.test' && (!path || l.path === path));

// ---------- Apple: SeerrProfileTests ----------

test('Jedes Profil hat seine eigene Seerr-Sitzung (gleicher Name, anderer Server: eigenes Profil); nichts gilt fuer das ganze Geraet', async () => {
  const { backend, config, mem } = make();
  assert.notEqual(config.profileId('http://jf.test', 'u-anna'), config.profileId('http://jf.test', 'u-ben'));
  assert.notEqual(config.profileId('http://jf.test', 'u-anna'), config.profileId('http://anderer.test', 'u-anna'));
  await login(backend, 'anna');
  const anna = config.data.activeServerId;
  await connect(backend, 'anna');
  await login(backend, 'ben');
  assert.equal(config.getSeerr(), null, 'ben hat kein Seerr');
  assert.equal(config.getSeerr(anna).secret, 'SID-anna');
  assert.ok(!('seerr' in JSON.parse(mem.store.text)), 'kein Eintrag fuer das ganze Geraet');
});

test('Seerr-Sitzung gehoert dem angemeldeten Konto: ein anderes als das des Profils gilt, ein fremdes nicht; alte Eintraege wie bisher', () => {
  const profile = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const other = 'b2c3d4e5-f607-1829-3a4b-5c6d7e8f9001';
  const own = { id: 1, jellyfinUserId: 'A1B2C3D4-E5F6-0718-293A-4B5C6D7E8F90' };
  const guest = { id: 2, jellyfinUserId: 'b2c3d4e5f60718293a4b5c6d7e8f9001' };
  const local = { id: 3, jellyfinUserId: '' };
  // Angemeldet mit einem anderen Konto als dem des Profils: genau dieses Konto gilt (Schreibweise der Kennung egal)
  const asGuest = { url: 'https://seerr.test', userName: 'gast', jellyfinUserId: other };
  assert.ok(acceptsSeerrUser(guest, asGuest, profile));
  assert.ok(!acceptsSeerrUser(own, asGuest, profile), 'auch das Konto des Profils ist hier ein fremdes');
  assert.ok(!acceptsSeerrUser(local, asGuest, profile), 'ein Seerr-Benutzer ohne Jellyfin-Konto nie');
  // Angemeldet mit dem Konto des Profils
  const asOwn = { url: 'https://seerr.test', userName: 'anna', jellyfinUserId: profile };
  assert.ok(acceptsSeerrUser(own, asOwn, profile));
  assert.ok(!acceptsSeerrUser(guest, asOwn, profile));
  // Eintrag ohne gemerktes Konto (aus der Zeit vor Version 10 uebernommen): nur das Jellyfin-Konto des Profils
  const legacy = { url: 'https://seerr.test', userName: 'anna', jellyfinUserId: '' };
  assert.ok(acceptsSeerrUser(own, legacy, profile));
  assert.ok(!acceptsSeerrUser(guest, legacy, profile));
  assert.ok(!acceptsSeerrUser(own, legacy, ''), 'ohne erwartetes Konto nichts');
});

test('Gespeicherte Eintraege ohne gemerktes Konto bleiben lesbar; Konto und Sitzung ueberstehen Speichern und Lesen', () => {
  const raw = { version: 10, deviceId: 'd', activeServerId: 'p1', servers: [{ id: 'p1', url: 'http://jf.test', name: 'S', userId: 'u1', userName: 'anna', token: 'plain:dA==', seerr: { url: 'https://seerr.test', userName: 'anna', secret: `plain:${Buffer.from('s').toString('base64')}` } }], settings: {} };
  const { config, store } = memoryConfig(JSON.stringify(raw));
  assert.deepEqual(config.getSeerr(), { url: 'https://seerr.test', userName: 'anna', jellyfinUserId: '', secret: 's' });
  config.saveSeerr({ url: 'https://seerr.test', userName: 'gast', jellyfinUserId: 'jf-gast', secret: 't' });
  const again = memoryConfig(store.text).config;
  assert.deepEqual(again.getSeerr(), { url: 'https://seerr.test', userName: 'gast', jellyfinUserId: 'jf-gast', secret: 't' });
});

test('Eine Sitzung fuer alle Anfragen an Seerr: ohne Cookie-Speicher, ohne Zwischenspeicher der Antworten, Frist 20 s', async () => {
  const { backend, net } = make();
  await login(backend, 'anna');
  await connect(backend, 'anna');
  await backend.checkConnection();
  await backend.seerrSearch('x', 1);
  const all = seerrCalls(net);
  assert.ok(all.length >= 5);
  assert.ok(all.every((l) => l.credentials === 'omit' && l.cache === 'no-store'), JSON.stringify(all.map((l) => [l.path, l.credentials, l.cache])));
  // Die Frist: eine haengende Anfrage endet nach 20 s (hier verkuerzt nachgestellt ueber den Baustein selbst)
  const seen = [];
  const spy = async (url, init) => {
    seen.push(init);
    return json(200, { results: [] });
  };
  await new SeerrClient({ baseUrl: 'http://seerr.test', cookie: 'c', fetch: spy }).search('x');
  assert.ok(seen[0].signal instanceof AbortSignal, 'jede Anfrage hat ihre Frist');
});

// ---------- Rechte und Benutzer aus /auth/me ----------

test('Benutzer aus /auth/me: Nummer, Name, Rechte; unbekannte Rechte schalten nichts frei, ohne Nummer kein Benutzer', () => {
  assert.deepEqual(normalizeUser({ id: 4, displayName: 'Anna', permissions: 32, jellyfinUserId: 'jf-a', email: 'x@y' }), { id: 4, displayName: 'Anna', permissions: 32, jellyfinUserId: 'jf-a' });
  assert.equal(normalizeUser({ id: 4, permissions: 'alles' }).permissions, 0);
  assert.equal(normalizeUser({ id: 4, permissions: -1 }).permissions, 0);
  assert.equal(normalizeUser({ id: 4, jellyfinUsername: 'anna' }).displayName, 'anna');
  assert.equal(normalizeUser({ id: 4 }).jellyfinUserId, '');
  assert.equal(normalizeUser({ displayName: 'x' }), null);
  assert.equal(normalizeUser(null), null);
});

// ---------- Anmeldung ----------

test('Anmeldung mit einem anderen Jellyfin-Konto als dem des Profils: verbunden, gemerkt sind dieses Konto und seine Kennung; die Pruefung laesst es verbunden', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  const s = await connect(backend, 'gast');
  assert.deepEqual(s.seerr, { url: 'http://seerr.test', userName: 'gast' });
  assert.equal(config.getSeerr().jellyfinUserId, 'u-gast', 'die Kennung aus /auth/me');
  const r = await backend.checkConnection();
  assert.deepEqual(r.seerr, { state: 'connected', user: { id: 4, displayName: 'Seerr gast', permissions: 32 } });
  assert.equal(seerrCalls(net, '/api/v1/auth/logout').length, 0, 'keine fremde Sitzung');
});

test('Eine Anmeldung, zu der Seerr kein Jellyfin-Konto nennt, gilt nicht: nichts gespeichert, die Sitzung bei Seerr abgemeldet', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  net.identity.lokal = '';
  await assert.rejects(() => connect(backend, 'lokal'), /kein Jellyfin-Konto/);
  assert.equal(config.getSeerr(), null);
  assert.equal(backend.seerr, null);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seerrCalls(net, '/api/v1/auth/logout').map((l) => l.cookie), ['connect.sid=SID-lokal']);
});

test('Erneut anmelden ersetzt die Sitzung des Profils und meldet die alte bei Seerr ab; ein falsches Passwort aendert nichts', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  await connect(backend, 'anna');
  await assert.rejects(() => connect(backend, 'gast', 'falsch'), /abgelehnt/);
  assert.equal(config.getSeerr().secret, 'SID-anna', 'eine abgelehnte Anmeldung behaelt die alte Sitzung');
  await connect(backend, 'gast');
  await new Promise((r) => setImmediate(r));
  assert.equal(config.getSeerr().secret, 'SID-gast');
  assert.deepEqual(seerrCalls(net, '/api/v1/auth/logout').map((l) => l.cookie), ['connect.sid=SID-anna']);
});

// ---------- Fremde Sitzung (S2) ----------

test('Fremde Sitzung: meldet Seerr spaeter ein anderes Konto, wird die Sitzung abgemeldet und verworfen; Adresse und Konto bleiben fuer "Erneut anmelden"', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  await connect(backend, 'anna');
  net.identity.anna = 'u-jemand-drittes';
  const r = await backend.checkConnection();
  assert.deepEqual(r.seerr, { state: 'unauthorized', reason: 'foreign' });
  assert.deepEqual(seerrCalls(net, '/api/v1/auth/logout').map((l) => l.cookie), ['connect.sid=SID-anna'], 'bei Seerr abgemeldet');
  assert.deepEqual(config.getSeerr(), { url: 'http://seerr.test', userName: 'anna', jellyfinUserId: 'u-anna', secret: '' }, 'nur die Sitzung ist weg');
  assert.deepEqual(backend.publicState().seerr, { url: 'http://seerr.test', userName: 'anna' }, 'Seerr bleibt eingerichtet');
  assert.equal(backend.seerr, null);
  // Ohne Sitzung: keine Anfrage an Seerr, sondern gleich "Anmeldung abgelaufen"; die Pruefung bleibt dabei
  const before = seerrCalls(net).length;
  await assert.rejects(() => backend.seerrSearch('x', 1), (e) => e.code === 'SEERR_AUTH');
  assert.deepEqual((await backend.checkConnection()).seerr, { state: 'unauthorized', reason: 'foreign' }, 'der Grund bleibt bis zur neuen Anmeldung');
  assert.equal(seerrCalls(net).length, before, 'nichts ging an Seerr');
  // Erneut anmelden: wieder verbunden
  delete net.identity.anna;
  await connect(backend, 'anna');
  assert.equal((await backend.checkConnection()).seerr.state, 'connected');
});

test('Eine Sitzung, die sich nicht entschluesseln laesst, gilt als abgelaufen (Seerr bleibt eingerichtet), nicht als "nicht verbunden"', async () => {
  let broken = false; // nur die Seerr-Sitzung wird unlesbar (etwa nach einem Umzug auf einen anderen Rechner), das Jellyfin-Token nicht
  const codec = {
    encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`,
    decode: (s) => {
      const t = Buffer.from(s.slice(6), 'base64').toString('utf8');
      return broken && t.startsWith('SID-') ? null : t;
    }
  };
  const { backend, config } = make({ codec });
  await login(backend, 'anna');
  await connect(backend, 'anna');
  broken = true;
  backend.switchServer(config.data.activeServerId); // Neuaufbau wie nach einem Start
  assert.equal(config.getSeerr().secret, '');
  assert.deepEqual((await backend.checkConnection()).seerr, { state: 'unauthorized', reason: 'noSession' });
  await assert.rejects(() => backend.seerrTrending(), (e) => e.code === 'SEERR_AUTH');
});

// ---------- Plattformunabhaengige Faelle ----------

test('Fall 1: Profil A mit Seerr, Profil B ohne: bei B keine Anfrage an Seerr im Netz, Zustand "nicht eingerichtet"', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  const a = config.data.activeServerId;
  await connect(backend, 'anna');
  await login(backend, 'ben');
  const before = seerrCalls(net).length;
  assert.deepEqual((await backend.checkConnection()).seerr, { state: 'none' });
  await assert.rejects(() => backend.seerrTrending(), /nicht verbunden/);
  await assert.rejects(() => backend.seerrSearch('x', 1), /nicht verbunden/);
  assert.equal(seerrCalls(net).length, before, 'nichts ging an Seerr');
  backend.switchServer(a);
  assert.equal((await backend.checkConnection()).seerr.state, 'connected');
});

test('Fall 2: zwei Profile, zwei Seerr-Benutzer: der Wechsel stellt jeweils die eigene Sitzung her (Benutzer und Rechte)', async () => {
  const { backend, net, config } = make();
  net.perms.anna = 16 | 32;
  await login(backend, 'anna');
  const a = config.data.activeServerId;
  await connect(backend, 'anna');
  await login(backend, 'ben');
  const b = config.data.activeServerId;
  await connect(backend, 'ben');
  const user = async () => (await backend.checkConnection()).seerr.user;
  assert.deepEqual(await user(), { id: 3, displayName: 'Seerr ben', permissions: 32 });
  backend.switchServer(a);
  assert.equal(backend.seerrUser, null, 'Rechte des vorigen Profils gelten sofort nicht mehr');
  assert.deepEqual(await user(), { id: 4, displayName: 'Seerr anna', permissions: 48 });
  assert.equal(seerrCalls(net, '/api/v1/auth/me').at(-1).cookie, 'connect.sid=SID-anna');
  backend.switchServer(b);
  await backend.seerrSearch('x', 1);
  assert.equal(seerrCalls(net, '/api/v1/search').at(-1).cookie, 'connect.sid=SID-ben');
});

test('Fall 9: Seerr aus: Jellyfin verbunden, Seerr "nicht erreichbar", nichts geloescht; Seerr zurueck: wieder verbunden', async () => {
  const { backend, net, mem } = make();
  await login(backend, 'anna');
  await connect(backend, 'anna');
  const before = mem.store.text;
  net.down = true;
  const r = await backend.checkConnection();
  assert.equal(r.jellyfin.state, 'connected');
  assert.equal(r.seerr.state, 'unreachable');
  assert.equal(mem.store.text, before, 'ein Ausfall loescht keine Einrichtung');
  net.down = false;
  assert.equal((await backend.checkConnection()).seerr.state, 'connected');
});

test('Fall 9: ein haengendes Seerr haelt die Pruefung von Jellyfin nicht auf (der Start wartet nur darauf); Seerr endet nach seiner Frist', async () => {
  const { backend, net } = make({ checkTimeoutMs: 300 });
  await login(backend, 'anna');
  await connect(backend, 'anna');
  net.hang = true;
  const t0 = Date.now();
  const jf = await backend.checkConnection({ seerr: false });
  assert.equal(jf.jellyfin.state, 'connected');
  assert.ok(Date.now() - t0 < 200, `Jellyfin allein: ${Date.now() - t0} ms`);
  const s = await backend.seerrCheck();
  assert.equal(s.seerr.state, 'unreachable');
  assert.ok(Date.now() - t0 >= 280, 'Seerr erst nach seiner Frist');
});

test('Fall 10: Sitzung abgelaufen: "Anmeldung ungueltig", Jellyfin unberuehrt; erneute Anmeldung mit Passwort verbindet wieder', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  await connect(backend, 'anna');
  net.expired = true;
  const r = await backend.checkConnection();
  assert.deepEqual([r.jellyfin.state, r.seerr.state], ['connected', 'unauthorized']);
  assert.equal(config.getSeerr().secret, 'SID-anna', 'ein Ablauf loescht nichts');
  await assert.rejects(() => backend.seerrSearch('x', 1), (e) => e.code === 'SEERR_AUTH' && e.status === 0, 'nicht wie ein abgelaufenes Jellyfin-Konto');
  net.expired = false;
  await connect(backend, 'anna');
  assert.equal((await backend.checkConnection()).seerr.state, 'connected');
});

// ---------- Profilwechsel (S11) ----------

test('Profilwechsel waehrend einer Abfrage: ihre Antwort kommt nicht an (SEERR_STALE), eine laufende Pruefung verfaellt', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  const a = config.data.activeServerId;
  await connect(backend, 'anna');
  await login(backend, 'ben');
  const b = config.data.activeServerId;
  await connect(backend, 'ben');
  backend.switchServer(a);
  let release;
  const gate = new Promise((r) => (release = r));
  const inner = net.fetch;
  net.fetch = async (url, init) => {
    if (String(url).includes('/api/v1/search')) await gate;
    return inner(url, init);
  };
  const running = backend.seerrSearch('x', 1);
  await new Promise((r) => setTimeout(r, 10));
  backend.switchServer(b);
  release();
  await assert.rejects(() => running, (e) => e.code === 'SEERR_STALE');
  net.fetch = inner;
  assert.equal((await backend.seerrSearch('x', 1))[0].title, 'Treffer fuer ben');
});

test('Abmelden, Profil entfernen und Trennen melden die Seerr-Sitzung bei Seerr ab', async () => {
  const { backend, net, config } = make();
  await login(backend, 'anna');
  const a = config.data.activeServerId;
  await connect(backend, 'anna');
  await login(backend, 'ben');
  await connect(backend, 'ben');
  await login(backend, 'cara');
  await connect(backend, 'cara');
  const outs = () => seerrCalls(net, '/api/v1/auth/logout').map((l) => l.cookie);
  await backend.seerrDisconnect();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(outs(), ['connect.sid=SID-cara'], 'Trennen');
  assert.equal(config.data.seerrAddress, 'http://seerr.test', 'die Adresse bleibt vorbelegt');
  await backend.removeProfile(a);
  assert.deepEqual(outs(), ['connect.sid=SID-cara', 'connect.sid=SID-anna'], 'ein anderes Profil entfernen');
  backend.switchServer(config.data.servers.find((s) => s.userName === 'ben').id);
  await backend.logout();
  assert.deepEqual(outs(), ['connect.sid=SID-cara', 'connect.sid=SID-anna', 'connect.sid=SID-ben'], 'Abmelden');
});

// ---------- Sprache (S10) ----------

test('Sprache: Titel, Suche und Personen mit language=<Kurzform> der App; Anmeldung, Rechte und Anfragen ohne', async () => {
  assert.deepEqual([seerrLanguage('de-DE'), seerrLanguage('en'), seerrLanguage('pt_BR'), seerrLanguage(''), seerrLanguage('?')], ['de', 'en', 'pt', '', '']);
  assert.deepEqual(CONTENT_PATHS, ['/search', '/discover/', '/movie/', '/tv/', '/person/', '/collection/', '/genres/']);
  const { backend, net, config } = make({ language: 'de-AT' });
  await login(backend, 'anna');
  await connect(backend, 'anna');
  await backend.checkConnection();
  await backend.seerrSearch('x', 1);
  await backend.seerrTrending();
  await backend.seerrDetails({ mediaType: 'movie', mediaId: 1 });
  const lang = (path) => seerrCalls(net).filter((l) => l.path.startsWith(path)).map((l) => l.query.get('language'));
  assert.deepEqual([...new Set(lang('/api/v1/search')), ...new Set(lang('/api/v1/discover/')), ...new Set(lang('/api/v1/movie/'))], ['de', 'de', 'de']);
  assert.ok(lang('/api/v1/auth/').every((v) => v === null) && lang('/api/v1/status').every((v) => v === null), 'Anmeldung, Rechte und Status ohne Sprache');
  // Die Sprache der App gilt vor der des Systems und sofort, ohne neue Anmeldung
  config.updateSettings({ language: 'en' });
  await backend.seerrSearch('x', 1);
  assert.equal(lang('/api/v1/search').at(-1), 'en');
});
