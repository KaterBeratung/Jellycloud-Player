'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { JellyfinError } = require('../src/shared/jellyfin');
const { SeerrError } = require('../src/shared/seerr');

/** Konfiguration im Speicher mit "plain:"-Kodierung, wie in der Web-Fassung ohne sicheren Speicher. */
function memoryConfig(initial = null) {
  const store = { text: initial };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => Buffer.from(t).toString('hex').slice(-12) };
  const io = { read: () => store.text, write: (t) => (store.text = t), backupCorrupt: () => (store.corrupt = store.text) };
  return { config: new ConfigCore(io, codec, env), store, make: (text) => new ConfigCore({ ...io, read: () => text }, codec, env) };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => body, text: async () => JSON.stringify(body) });

/** Kleiner Jellyfin-Ersatz hinter fetch; `log` hat alle Aufrufe. */
function fakeFetch({ qc = true, endpoint = { IsLocal: false, IsInNetwork: false } } = {}) {
  const log = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    log.push(`${init.method ?? 'GET'} ${u.pathname}`);
    if (u.pathname === '/System/Info/Public') return json(200, { Id: 'srv', ServerName: 'Testserver', Version: '10.10.3' });
    if (u.pathname === '/Users/AuthenticateByName') {
      const b = JSON.parse(init.body);
      return b.Pw === 'geheim' ? json(200, { AccessToken: 'tok-1', User: { Id: `u-${b.Username}`, Name: b.Username }, ServerId: 'srv' }) : json(401, { Message: 'no' });
    }
    if (u.pathname === '/QuickConnect/Enabled') return json(200, qc);
    if (u.pathname === '/QuickConnect/Initiate') return json(200, { Secret: 's3', Code: '123456' });
    if (u.pathname === '/QuickConnect/Connect') return json(200, { Authenticated: true });
    if (u.pathname === '/Users/AuthenticateWithQuickConnect') return json(200, { AccessToken: 'tok-qc', User: { Id: 'u2', Name: 'Handy' }, ServerId: 'srv' });
    if (u.pathname === '/System/Endpoint') return json(200, endpoint);
    if (u.pathname === '/Sessions/Capabilities/Full' || u.pathname === '/Sessions/Logout') return json(204, null);
    if (u.pathname === '/Users/Me') return json(200, { Id: 'u1', Policy: { IsAdministrator: false } });
    if (u.pathname === '/System/Configuration') return json(200, {});
    return json(404, {});
  };
  return { fetch, log };
}

function make(opts = {}) {
  const mem = memoryConfig();
  const calls = { settings: [] };
  const net = fakeFetch(opts);
  const backend = createBackend({
    config: mem.config,
    fetch: net.fetch,
    appVersion: () => '9.9.9',
    locale: () => 'de-DE',
    deviceName: 'Testgeraet',
    extraState: () => ({ platform: 'web', mpv: null }),
    onSettings: (patch, s) => calls.settings.push({ patch, s })
  });
  return { backend, mem, net, calls };
}

test('Zustand vor der Anmeldung: nicht angemeldet, Version, Sprache, Zusatzfelder, keine Tokens', () => {
  const { backend } = make();
  const s = backend.publicState();
  assert.equal(s.loggedIn, false);
  assert.equal(s.appVersion, '9.9.9');
  assert.equal(s.locale, 'de-DE');
  assert.equal(s.platform, 'web');
  assert.deepEqual(s.servers, []);
  assert.equal(s.settings.player.skipCountdown, 6, 'Standardeinstellungen sind da');
});

test('Anmeldung mit Passwort: Konto wird gemerkt, Token nur kodiert abgelegt, Zustand zeigt keine Tokens', async () => {
  const { backend, mem, net } = make();
  const s = await backend.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  assert.equal(s.loggedIn, true);
  assert.equal(s.servers.length, 1);
  assert.equal(s.servers[0].name, 'Testserver');
  assert.equal(s.servers[0].token, undefined, 'die Oberflaeche bekommt nie ein Token');
  const saved = JSON.parse(mem.store.text);
  assert.ok(saved.servers[0].token.startsWith('plain:') && !saved.servers[0].token.includes('tok-1'), 'kodiert, nicht im Klartext');
  assert.equal(saved.activeServerId, saved.servers[0].id);
  assert.ok(net.log.includes('POST /Sessions/Capabilities/Full'), 'meldet seine Faehigkeiten');
  assert.equal(backend.client.userId, 'u-anna');
  assert.match(backend.client.authHeader(), /Device="Testgeraet".*Version="9.9.9".*Token="tok-1"/);
});

test('Falsches Passwort: Fehler mit status 401, nichts wird gespeichert', async () => {
  const { backend, mem } = make();
  await assert.rejects(() => backend.login({ url: 'http://jf.test:8096', username: 'anna', password: 'falsch' }), (e) => e instanceof JellyfinError && e.status === 401);
  assert.equal(backend.publicState().loggedIn, false);
  assert.equal(JSON.parse(mem.store.text).servers.length, 0);
});

test('Quick Connect: Start liefert Code, Abfrage meldet an; ohne Quick Connect gibt es eine verstaendliche Meldung', async () => {
  const a = make();
  const st = await a.backend.quickConnectStart('http://jf.test:8096');
  assert.deepEqual({ code: st.code, secret: st.secret, name: st.name }, { code: '123456', secret: 's3', name: 'Testserver' });
  const done = await a.backend.quickConnectPoll({ url: st.url, name: st.name, secret: st.secret });
  assert.equal(done.done, true);
  assert.equal(done.state.loggedIn, true);
  assert.equal(done.state.servers[0].userName, 'Handy');
  const b = make({ qc: false });
  await assert.rejects(() => b.backend.quickConnectStart('http://jf.test:8096'), /Quick Connect/);
});

test('api(): nur freigegebene Methoden, nur mit Anmeldung', async () => {
  const { backend } = make();
  await assert.rejects(() => backend.api('getMe', []), (e) => e.status === 401, 'ohne Anmeldung: 401');
  await assert.rejects(() => backend.api('request', ['GET', '/x']), /Unbekannte Methode/, 'interne Methoden sind gesperrt');
  await assert.rejects(() => backend.api('constructor', []), /Unbekannte Methode/);
  await backend.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  assert.equal((await backend.api('getMe', [])).Id, 'u1', 'der Aufruf geht durch');
});

test('Abmelden und Serverwechsel', async () => {
  const { backend, mem } = make();
  await backend.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  const id1 = JSON.parse(mem.store.text).activeServerId;
  await backend.login({ url: 'http://jf.test:8096', username: 'bert', password: 'geheim' });
  assert.equal(backend.publicState().servers.length, 2);
  const s = backend.switchServer(id1);
  assert.equal(s.loggedIn, true);
  assert.equal(s.activeServerId, id1);
  assert.throws(() => backend.switchServer('gibtsnicht'), /Unbekannter Server/);
  const out = await backend.logout();
  assert.equal(out.servers.length, 1, 'das aktive Konto ist weg, das andere bleibt');
  assert.equal(out.loggedIn, true, 'und ist jetzt aktiv');
  const out2 = await backend.logout();
  assert.equal(out2.loggedIn, false);
  assert.equal(out2.servers.length, 0);
});

test('Ein neuer Start mit gespeicherter Konfiguration ist sofort angemeldet', async () => {
  const first = make();
  await first.backend.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  const text = first.mem.store.text;
  const again = createBackend({ config: first.mem.make(text), fetch: fakeFetch().fetch, appVersion: () => '1', locale: () => 'de' });
  again.activateServer(JSON.parse(text).activeServerId);
  assert.equal(again.publicState().loggedIn, true);
  assert.equal(again.client.token, 'tok-1', 'das Token wird wieder entschluesselt');
});

test('Einstellungen: Update-Quelle und Discord-Werte werden bereinigt, der Haken meldet jede Aenderung', () => {
  const { backend, calls } = make();
  const s = backend.setSettings({ general: { updateSource: 'https://boese.example', updateCustom: true, autostart: true }, discord: { clientId: 'ab12c3', name: 'x'.repeat(300) } });
  assert.equal(s.general.updateSource, undefined);
  assert.equal(s.general.autostart, true);
  assert.equal(s.discord.clientId, '123');
  assert.equal(s.discord.name.length, 128);
  assert.equal(calls.settings.length, 1);
  backend.resetSettings();
  assert.equal(calls.settings.at(-1).patch, null, 'Zuruecksetzen meldet patch = null');
  assert.equal(backend.publicState().settings.general.autostart, false);
});

test('Bitratengrenze: kurz zwischengespeichert, "force" holt neu, Abmelden verwirft sie', async () => {
  const { backend, net } = make({ endpoint: { IsLocal: false, IsInNetwork: false } });
  assert.equal(await backend.streamingLimits(), null, 'ohne Anmeldung nichts');
  await backend.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  await backend.refreshLimits(true);
  const n1 = net.log.filter((l) => l.endsWith('/System/Endpoint')).length;
  await backend.streamingLimits(false);
  await backend.streamingLimits(false);
  assert.equal(net.log.filter((l) => l.endsWith('/System/Endpoint')).length, n1, 'zwischengespeichert');
  await backend.streamingLimits(true);
  assert.ok(net.log.filter((l) => l.endsWith('/System/Endpoint')).length > n1, 'force holt neu');
  await backend.logout();
  assert.equal(backend.limits, null);
});

/** Jellyfin- und Seerr-Ersatz hinter einem fetch: Seerr meldet mit dem Jellyfin-Konto an (Passwort "geheim") und liefert das Cookie connect.sid. */
function seerrFetch(state = { expired: false }) {
  const jf = fakeFetch();
  const log = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (!u.pathname.startsWith('/api/v1/')) return jf.fetch(url, init);
    log.push({ path: u.pathname, cookie: init.headers?.Cookie ?? null, key: init.headers?.['X-Api-Key'] ?? null });
    if (u.pathname === '/api/v1/status') return json(200, { version: '2.0.0' });
    if (u.pathname === '/api/v1/auth/jellyfin') {
      if (state.hold) await state.hold; // langsame Anmeldung (Wettlauf mit einem Profilwechsel)
      const b = JSON.parse(init.body);
      if (b.password !== 'geheim') return json(401, { message: 'no' });
      const r = json(200, { id: 7, displayName: `Seerr-${b.username}`, jellyfinUserId: `jf-${b.username}` });
      r.headers = { get: (k) => (k.toLowerCase() === 'set-cookie' ? `connect.sid=SID-${b.username}; Path=/; HttpOnly` : k.toLowerCase() === 'content-type' ? 'application/json' : null) };
      return r;
    }
    if (state.expired) return json(401, { message: 'no' });
    if (u.pathname === '/api/v1/search') return json(200, { results: [], totalPages: 1 });
    return json(404, {});
  };
  return { fetch, log, jf };
}

test('Seerr je Profil: nur mit dem Jellyfin-Konto, ohne Profil keine Verbindung, Profilwechsel nimmt das eigene Seerr; ein 401 wird SEERR_AUTH', async () => {
  const state = { expired: false };
  const net = seerrFetch(state);
  const mem = memoryConfig();
  const b = createBackend({ config: mem.config, fetch: net.fetch, appVersion: () => '1', locale: () => 'de' });
  await assert.rejects(() => b.seerrSearch('x', 1), (e) => e instanceof SeerrError && /nicht verbunden/.test(e.message));
  await assert.rejects(() => b.seerrConnect({ url: 'http://seerr.test:5055', username: 'anna', password: 'geheim' }), /Zuerst bei Jellyfin anmelden/, 'ohne Profil');
  await b.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  const anna = mem.config.data.activeServerId;
  const s = await b.seerrConnect({ url: 'http://seerr.test:5055', username: 'anna', password: 'geheim' });
  assert.deepEqual(s.seerr, { url: 'http://seerr.test:5055', userName: 'Seerr-anna' }, 'kein Zugangsdatum in der Oberflaeche');
  const saved = JSON.parse(mem.store.text);
  assert.ok(!('seerr' in saved), 'nicht mehr fuer das ganze Geraet');
  assert.equal(saved.servers[0].seerr.jellyfinUserId, 'jf-anna', 'die Jellyfin-Kennung von Seerr ist gemerkt');
  assert.ok(saved.servers[0].seerr.secret.startsWith('plain:') && !mem.store.text.includes('SID-anna'), 'die Sitzung nur kodiert');
  assert.ok(await b.seerrSearch('matrix', 1));
  assert.equal(net.log.at(-1).cookie, 'connect.sid=SID-anna');
  assert.equal(net.log.at(-1).key, null, 'nie ein API-Schluessel');
  // Ein zweites Profil hat kein Seerr; zurueck zum ersten: wieder verbunden
  await b.login({ url: 'http://jf.test:8096', username: 'bert', password: 'geheim' });
  assert.equal(b.publicState().seerr, null);
  assert.equal(b.publicState().seerrAddress, null);
  assert.equal(b.seerr, null);
  await assert.rejects(() => b.seerrSearch('x', 1), /nicht verbunden/);
  b.switchServer(anna);
  assert.equal(b.publicState().seerr.userName, 'Seerr-anna');
  await b.seerrSearch('matrix', 1);
  assert.equal(net.log.at(-1).cookie, 'connect.sid=SID-anna');
  // Sitzung abgelaufen: SEERR_AUTH, nicht die Jellyfin-Anmeldung
  state.expired = true;
  await assert.rejects(() => b.seerrSearch('matrix', 1), (e) => e.code === 'SEERR_AUTH' && e.status === 0);
  const off = await b.seerrDisconnect();
  assert.equal(off.seerr, null);
  assert.equal(off.seerrAddress, 'http://seerr.test:5055', 'die Adresse bleibt vorbelegt');
  await assert.rejects(() => b.seerrConnect({ url: 'http://seerr.test:5055', username: 'anna', password: 'falsch' }), /Anmeldung bei Seerr abgelehnt/);
  assert.equal(b.publicState().seerr, null, 'eine abgelehnte Anmeldung verbindet nicht');
  // Abmelden: das naechste Profil bringt sein eigenes (keines) mit; nach dem letzten gibt es kein Seerr mehr
  state.expired = false;
  await b.seerrConnect({ url: 'http://seerr.test:5055', username: 'anna', password: 'geheim' });
  await b.logout();
  assert.equal(b.seerr, null, 'bert hat kein Seerr');
  await b.seerrConnect({ url: 'http://seerr.test:5055', username: 'bert', password: 'geheim' });
  assert.ok(b.seerr);
  await b.logout();
  assert.equal(b.seerr, null, 'ohne Profil auch kein Seerr');
  await assert.rejects(() => b.seerrSearch('x', 1), /nicht verbunden/);
});

test('Seerr: wird waehrend der Anmeldung das Profil gewechselt, bekommt keines die Sitzung (kein Seerr beim falschen Profil)', async () => {
  let release;
  const state = { expired: false, hold: new Promise((r) => (release = r)) };
  const mem = memoryConfig();
  const b = createBackend({ config: mem.config, fetch: seerrFetch(state).fetch, appVersion: () => '1', locale: () => 'de' });
  await b.login({ url: 'http://jf.test:8096', username: 'anna', password: 'geheim' });
  const anna = mem.config.data.activeServerId;
  await b.login({ url: 'http://jf.test:8096', username: 'bert', password: 'geheim' });
  const bert = mem.config.data.activeServerId;
  const running = b.seerrConnect({ url: 'http://seerr.test:5055', username: 'bert', password: 'geheim' });
  await new Promise((r) => setTimeout(r, 10));
  b.switchServer(anna);
  release();
  await assert.rejects(() => running, /Profil wurde inzwischen gewechselt/);
  assert.equal(mem.config.getSeerr(anna), null, 'anna hat nichts bekommen');
  assert.equal(mem.config.getSeerr(bert), null, 'bert auch nicht');
  assert.equal(b.seerr, null);
});

test('Profilgrenze: ein fuenftes Profil wird nach der Anmeldung abgelehnt (PROFILE_LIMIT), die neue Sitzung am Server wieder abgemeldet; ein gemerktes darf', async () => {
  const { backend, mem, net } = make();
  for (const u of ['a', 'b', 'c', 'd']) await backend.login({ url: 'http://jf.test:8096', username: u, password: 'geheim' });
  const active = mem.config.data.activeServerId;
  const logouts = net.log.filter((l) => l === 'POST /Sessions/Logout').length;
  await assert.rejects(() => backend.login({ url: 'http://jf.test:8096', username: 'e', password: 'geheim' }), (e) => e.code === 'PROFILE_LIMIT');
  assert.equal(net.log.filter((l) => l === 'POST /Sessions/Logout').length, logouts + 1, 'die eben erhaltene Sitzung ist am Server abgemeldet');
  assert.equal(JSON.parse(mem.store.text).servers.length, 4, 'nichts gespeichert');
  assert.equal(mem.config.data.activeServerId, active, 'das aktive Profil bleibt');
  assert.equal(backend.client.userId, 'u-d', 'und seine Verbindung auch');
  await assert.rejects(async () => {
    const qc = await backend.quickConnectStart('http://jf.test:8096');
    await backend.quickConnectPoll({ url: qc.url, name: qc.name, secret: qc.secret });
  }, (e) => e.code === 'PROFILE_LIMIT', 'auch ueber Quick Connect');
  await backend.login({ url: 'http://jf.test:8096', username: 'a', password: 'geheim' });
  assert.equal(backend.client.userId, 'u-a', 'ein gemerktes Profil meldet sich neu an');
});
test('ConfigCore: defekte Konfiguration wird gesichert statt stumm ueberschrieben, BOM stoert nicht, Neues ergaenzt sich', () => {
  const m = memoryConfig('{kaputt');
  assert.equal(m.store.corrupt, '{kaputt', 'die alte Datei ist gesichert');
  assert.equal(m.config.settings.player.skipCountdown, 6);
  const bom = memoryConfig('﻿' + JSON.stringify({ version: 9, deviceId: 'abc', servers: [], settings: { player: { skipIntro: 'auto' } } }));
  assert.equal(bom.config.deviceId, 'abc');
  assert.equal(bom.config.settings.player.skipIntro, 'auto', 'eigene Werte bleiben');
  assert.equal(bom.config.settings.player.skipCountdown, 6, 'fehlende Schluessel kommen aus den Standardwerten');
});
