'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { JellyfinClient, JellyfinError, checkId, checkText, checkList } = require('../src/main/jellyfin');
const { server, USER, state, items, setAdmin } = require('../tools/mock-server');

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
test.after(() => {
  setAdmin(false);
  server.close();
});

async function login() {
  const c = new JellyfinClient({ baseUrl: base, deviceId: 'dev-admin-test' });
  await c.authenticateByName('demo', 'demo');
  return c;
}
const id32 = (s) => crypto.createHash('md5').update(s).digest('hex');
const LENA = id32('user-lena');
const MAX = id32('user-max');
const movieId = () => [...items.values()].find((i) => i.Name === 'Paper Moons').Id;
const lastLog = (prefix) => state.log.filter((x) => String(x.at).startsWith(prefix)).at(-1);

test('Pruefungen: Kennungen und Texte (kein Pfad-Trick, Laengen, Steuerzeichen, Listen)', () => {
  assert.equal(checkId(USER.Id), USER.Id);
  assert.equal(checkId('a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90'), 'a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90');
  for (const bad of ['', '../System/Restart', 'abc', 'zzzzzzzz', '12345678/../x', null, undefined, 'a'.repeat(41)]) assert.throws(() => checkId(bad), (e) => e instanceof JellyfinError && e.status === 400, String(bad));
  assert.equal(checkText('  Hallo  ', 'Name', 1, 10), 'Hallo');
  assert.equal(checkText('a\u0000b\u0007c', 'Name', 1, 10), 'abc', 'Steuerzeichen fallen weg');
  assert.equal(checkText('Zeile 1\nZeile 2', 'Text', 0, 50), 'Zeile 1\nZeile 2', 'Zeilenumbruch bleibt');
  assert.throws(() => checkText('', 'Name', 1, 10), /Name fehlt/);
  assert.throws(() => checkText('x'.repeat(11), 'Name', 1, 10), /zu lang/);
  assert.deepEqual(checkList(['Drama', ' Drama ', '', 'Action'], 'Genres', 5, 20), ['Drama', 'Action'], 'leere und doppelte fallen weg');
  assert.throws(() => checkList('Drama', 'Genres', 5, 20), /Liste erwartet/);
  assert.throws(() => checkList(['a', 'b', 'c'], 'Genres', 2, 20), /hoechstens 2/);
});

test('Ohne Administratorrechte antwortet der Server mit 403 auf jede Verwaltungsaktion, nichts wird veraendert', async () => {
  setAdmin(false);
  const c = await login();
  state.log.length = 0;
  const calls = [
    () => c.getSystemInfo(),
    () => c.refreshLibrary(),
    () => c.getScheduledTasks(),
    () => c.startTask(id32('task-scan')),
    () => c.getSessions(),
    () => c.getActivity(),
    () => c.getUsers(),
    () => c.createUser('neu', 'pw'),
    () => c.deleteUser(LENA),
    () => c.updateItem(movieId(), { Name: 'Gehackt' }),
    () => c.deleteItem(movieId()),
    () => c.searchRemote(movieId(), 'Movie', { name: 'x' }),
    () => c.restartServer(),
    () => c.shutdownServer()
  ];
  for (const call of calls) await assert.rejects(call, (e) => e.status === 403);
  assert.ok(items.get(movieId()), 'der Eintrag ist noch da');
  assert.equal(items.get(movieId()).Name, 'Paper Moons');
  const me = await c.getMe();
  assert.equal(me.Policy.IsAdministrator, false, 'die Oberflaeche erkennt Nicht-Administratoren an der Richtlinie');
});

test('Administrator: Server-Info, Bibliothek durchsuchen, Aufgaben ansehen, starten und stoppen', async () => {
  setAdmin(true);
  const c = await login();
  assert.equal((await c.getMe()).Policy.IsAdministrator, true);
  const info = await c.getSystemInfo();
  assert.equal(info.ServerName, 'Mock Jellyfin');
  assert.equal(info.Version, '10.10.3');
  await c.refreshLibrary();
  assert.equal(state.adminData.refreshes, 1);
  const tasks = await c.getScheduledTasks();
  assert.equal(tasks.length, 4);
  const scan = tasks.find((x) => /durchsuchen/i.test(x.Name));
  assert.equal(scan.State, 'Idle');
  await c.startTask(scan.Id);
  assert.equal((await c.getScheduledTasks()).find((x) => x.Id === scan.Id).State, 'Running');
  await c.stopTask(scan.Id);
  assert.equal((await c.getScheduledTasks()).find((x) => x.Id === scan.Id).State, 'Idle');
  await assert.rejects(() => c.startTask('../../System/Shutdown'), (e) => e.status === 400, 'ungueltige Kennung wird gar nicht erst gesendet');
  assert.equal(state.adminData.shutdowns, 0);
});

test('Administrator: Sitzungen und Aktivitaetsprotokoll', async () => {
  setAdmin(true);
  const c = await login();
  const sessions = await c.getSessions();
  assert.deepEqual(sessions.map((s) => s.UserName), ['demo', 'lena', 'max']);
  assert.equal(sessions[1].NowPlayingItem.Name, 'Neon Harbor');
  const log = await c.getActivity(3);
  assert.equal(log.length, 3, 'die Menge wird begrenzt');
  assert.equal(log[1].Severity, 'Error');
  assert.equal((await c.getActivity(0)).length, 4, 'ungueltige Menge: Standard');
});

test('Benutzer: anlegen, sperren und entsperren (Richtlinie bleibt ganz), Passwort, loeschen; das eigene Konto und Administratoren sind geschuetzt', async () => {
  setAdmin(true);
  const c = await login();
  assert.equal((await c.getUsers()).length, 3);
  await assert.rejects(() => c.createUser('', 'x'), /Name fehlt/);
  await assert.rejects(() => c.createUser('lena', 'x'), (e) => e.status === 400, 'doppelter Name: der Server lehnt ab');
  const created = await c.createUser('  neuer  ', 'geheim');
  assert.equal(created.Name, 'neuer');
  assert.equal(lastLog('admin POST /Users/New').hasPassword, true);
  assert.equal((await c.getUsers()).length, 4);

  state.log.length = 0;
  await c.setUserDisabled(LENA, true);
  assert.equal((await c.getUsers()).find((u) => u.Id === LENA).Policy.IsDisabled, true);
  const pol = lastLog('admin POST /Users/');
  assert.equal(pol.isDisabled, true);
  assert.equal(pol.keepsOtherFields, true, 'die uebrigen Felder der Richtlinie gehen mit (der Server verlangt sie komplett)');
  await c.setUserDisabled(LENA, false);
  assert.equal((await c.getUsers()).find((u) => u.Id === LENA).Policy.IsDisabled, false);
  await c.setUserDisabled(MAX, false);
  assert.equal((await c.getUsers()).find((u) => u.Id === MAX).Policy.IsDisabled, false, 'entsperren');

  await assert.rejects(() => c.setUserDisabled(USER.Id, true), /eigene Konto/);
  await assert.rejects(() => c.deleteUser(USER.Id), /eigene Konto/);
  await c.createUser('boss', '');
  const bossId = (await c.getUsers()).find((u) => u.Name === 'boss').Id;
  state.adminData.users.find((u) => u.Id === bossId).Policy.IsAdministrator = true;
  await assert.rejects(() => c.setUserDisabled(bossId, true), /Administratoren/, 'andere Administratoren lassen sich nicht sperren');

  await c.resetUserPassword(LENA);
  assert.equal((await c.getUsers()).find((u) => u.Id === LENA).HasPassword, false);
  assert.equal(lastLog('admin POST /Users/').reset, true);
  await c.setUserPassword(LENA, 'neues-passwort');
  assert.equal((await c.getUsers()).find((u) => u.Id === LENA).HasPassword, true);
  assert.equal(JSON.stringify(state.log).includes('neues-passwort'), false, 'das Passwort steht nicht im Protokoll des Servers');
  await assert.rejects(() => c.setUserPassword(LENA, ''), /Passwort fehlt/);

  await c.deleteUser(MAX);
  assert.equal((await c.getUsers()).some((u) => u.Id === MAX), false);
  await assert.rejects(() => c.deleteUser('nicht-hex'), (e) => e.status === 400);
});

test('Eintrag bearbeiten: nur die genannten Felder aendern sich, der Server bekommt den ganzen Eintrag, Pruefungen greifen', async () => {
  setAdmin(true);
  const c = await login();
  const id = movieId();
  const before = await c.getItemForEdit(id);
  assert.deepEqual(Object.keys(before).sort(), ['Genres', 'Id', 'Name', 'OfficialRating', 'OriginalTitle', 'Overview', 'ProductionYear', 'Taglines', 'Tags', 'Type']);
  assert.equal(before.Name, 'Paper Moons');
  state.log.length = 0;
  const saved = await c.updateItem(id, { Name: '  Papiermonde ', Overview: 'Neue Beschreibung', ProductionYear: '2020', Genres: ['Drama', 'Drama', 'Romanze'], Tags: ['neu'], Taglines: ['Ein Slogan'] });
  assert.equal(saved.Name, 'Papiermonde');
  const it = items.get(id);
  assert.equal(it.Name, 'Papiermonde');
  assert.equal(it.Overview, 'Neue Beschreibung');
  assert.equal(it.ProductionYear, 2020);
  assert.deepEqual(it.Genres, ['Drama', 'Romanze']);
  assert.deepEqual(it.Tags, ['neu']);
  const sent = lastLog('admin POST /Items/');
  assert.equal(sent.keepsPeople, true, 'der ganze Eintrag geht zurueck (mit Besetzung), nichts geht verloren');
  assert.ok(sent.fields > 20, `ganzer Eintrag, nicht nur die Aenderung: ${sent.fields} Felder`);
  await assert.rejects(() => c.updateItem(id, { Name: '' }), /Titel fehlt/);
  await assert.rejects(() => c.updateItem(id, { ProductionYear: 1500 }), /Jahr ungueltig/);
  await assert.rejects(() => c.updateItem(id, { Genres: 'Drama' }), /Liste erwartet/);
  await assert.rejects(() => c.updateItem('../x', { Name: 'x' }), (e) => e.status === 400);
  assert.equal(items.get(id).Name, 'Papiermonde', 'abgelehnte Aenderungen aendern nichts');
  const cleared = await c.updateItem(id, { ProductionYear: null, OfficialRating: '' });
  assert.equal(cleared.ProductionYear, null);
  await c.updateItem(id, { Name: 'Paper Moons', ProductionYear: 2021, Overview: before.Overview, Genres: before.Genres, Tags: [] });
});

test('Identifizieren: Online-Suche mit Name und Jahr, Treffer uebernehmen; nur Filme und Serien', async () => {
  setAdmin(true);
  const c = await login();
  const id = movieId();
  await assert.rejects(() => c.searchRemote(id, 'Episode', { name: 'x' }), /Nur Filme und Serien/);
  await assert.rejects(() => c.searchRemote(id, 'Movie', { name: '' }), /Name fehlt/);
  const results = await c.searchRemote(id, 'Movie', { name: 'Paper Moon', year: '2021' });
  assert.equal(results.length, 2);
  const s = lastLog('admin POST /Items/RemoteSearch/Movie');
  assert.deepEqual([s.name, s.year, s.itemId], ['Paper Moon', 2021, id]);
  await c.applyRemoteMatch(id, results[1]);
  const a = lastLog('admin POST /Items/RemoteSearch/Apply/');
  assert.equal(a.name, 'Mock Treffer Zwei');
  assert.equal(a.query.replaceAllImages, 'true');
  assert.equal(items.get(id).Name, 'Mock Treffer Zwei');
  items.get(id).Name = 'Paper Moons';
  items.get(id).ProductionYear = 2021;
});

test('Eintrag loeschen und Server neu starten/herunterfahren: genau eine Anfrage, nur mit gueltiger Kennung', async () => {
  setAdmin(true);
  const c = await login();
  const victim = [...items.values()].find((i) => i.Name === 'Crimson Tide Rising');
  const parent = victim.ParentId;
  await assert.rejects(() => c.deleteItem('..%2f..%2fSystem'), (e) => e.status === 400);
  assert.ok(items.has(victim.Id));
  await c.deleteItem(victim.Id);
  assert.equal(items.has(victim.Id), false);
  assert.deepEqual(state.adminData.deleted, [victim.Id]);
  items.set(victim.Id, victim); // fuer die anderen Tests wieder herstellen
  assert.ok(parent);
  await c.restartServer();
  await c.shutdownServer();
  assert.equal(state.adminData.restarts, 1);
  assert.equal(state.adminData.shutdowns, 1);
});
