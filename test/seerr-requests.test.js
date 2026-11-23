'use strict';

// Reiter "Anfragen" (Plan P11): die Faelle der Apple-App (JellycloudTests/SeerrRequestPagingTests.swift, 6), das Lesen der Anfragen wie Seerr 3.5.1,
// die Aktionen nach Rechten (plattformunabhaengige Faelle 3 und 4 aus Notizen/seerr-integration.md) und die Rueckseite gegen den Test-Seerr.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SeerrClient, normalizeRequest, REQUEST_ACTIONS } = require('../src/shared/seerr');
const Requests = require('../src/shared/seerr-requests');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { server, state, SEERR, resetSeerr } = require('../tools/mock-server');

const req = (id, status = 5) => ({ id, status, is4k: false, created: null, mediaType: 'movie', tmdbId: 2000 + id, mediaStatus: status === 5 ? 5 : 2, seasons: [], readySeasons: 0, requesterId: 7, requesterName: 'anna', modifierId: null });
const page = (ids, total, asked = Requests.PAGE_SIZE, received = null) => ({ requests: ids.map((i) => req(i)), received: received ?? ids.length, asked, total });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => b - i); // b, b-1, ..., a (neueste zuerst)

// ---------- Apple: SeerrRequestPagingTests ----------

test('Abruf: take und skip gehen an Seerr, die Gesamtzahl kommt aus pageInfo.results; auch ein unlesbarer Eintrag zaehlt fuer die naechste Stelle', async () => {
  const seen = [];
  const fetch = async (url) => {
    const u = new URL(url);
    seen.push(u.searchParams);
    const skip = Number(u.searchParams.get('skip'));
    const take = Number(u.searchParams.get('take'));
    const list = Array.from({ length: take }, (_, i) => ({ id: 130 - skip - i, status: 5, is4k: false, type: 'movie', media: { tmdbId: 2000 + i, mediaType: 'movie', status: 5 }, seasons: [], requestedBy: { id: 7, displayName: 'anna' } }));
    return new Response(JSON.stringify({ pageInfo: { results: 130 }, results: [...list, { unlesbar: true }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const c = new SeerrClient({ baseUrl: 'https://seiten.seerr.test', cookie: 's', fetch });
  const second = await c.requestPage({ userId: 7, skip: 50 });
  assert.equal(second.requests[0].id, 80);
  assert.equal(second.requests.length, 50);
  assert.equal(second.received, 51, 'der unlesbare Eintrag zaehlt fuer die Stelle der naechsten Seite');
  assert.equal(second.total, 130);
  assert.equal(second.asked, 50);
  const newest = await c.requestPage({ userId: 7 });
  assert.equal(newest.requests[0].id, 130);
  assert.deepEqual(seen.map((q) => q.get('skip')), ['50', '0']);
  assert.ok(seen.every((q) => q.get('requestedBy') === '7' && q.get('filter') === 'all' && q.get('sort') === 'added' && q.get('take') === '50'));
  assert.ok(seen.every((q) => !q.has('language')), 'Anfragen ohne Sprache');
  await c.requestPage({ userId: null });
  assert.ok(!seen.at(-1).has('requestedBy'), 'Verwalten: ohne Filter auf den Benutzer');
});

test('Blaettern: Seite um Seite, bis alles da ist; die naechste Seite beginnt hinter dem Abgeholten', () => {
  const p = Requests.createPaging();
  assert.equal(p.hasMore, false);
  p.start(page(range(81, 130), 130));
  assert.equal(p.requests.length, 50);
  assert.equal(p.received, 50);
  assert.equal(p.hasMore, true);
  p.append(page(range(31, 80), 130));
  assert.equal(p.received, 100);
  assert.equal(p.hasMore, true);
  p.append(page(range(1, 30), 130));
  assert.deepEqual(p.requests.map((r) => r.id), range(1, 130));
  assert.equal(p.hasMore, false);
});

test('Kam inzwischen eine Anfrage dazu, steht keine doppelt da', () => {
  const p = Requests.createPaging();
  p.start(page([5, 4, 3], 6, 3));
  p.append(page([3, 2, 1], 7, 3)); // bei Seerr kam Anfrage 7 dazu: die zweite Seite beginnt eine Stelle frueher
  assert.deepEqual(p.requests.map((r) => r.id), [5, 4, 3, 2, 1]);
  assert.equal(p.received, 6);
  assert.equal(p.hasMore, true, 'Seerr nennt 7, abgeholt sind 6 Stellen');
  p.append(page([0], 7, 3));
  assert.equal(p.hasMore, false);
});

test('Ohne Gesamtzahl (aeltere Server): weiter, solange die Seite voll war; eine leere Seite beendet es immer', () => {
  const p = Requests.createPaging();
  p.start(page([6, 5, 4], null, 3));
  assert.equal(p.hasMore, true);
  p.append(page([3, 2], null, 3));
  assert.equal(p.hasMore, false);
  const wrong = Requests.createPaging();
  wrong.start(page([2, 1], 99, 2));
  assert.equal(wrong.hasMore, true);
  wrong.append(page([], 99, 2));
  assert.equal(wrong.hasMore, false, 'falsche Gesamtzahl: eine leere Seite beendet das Blaettern trotzdem');
});

test('Neuladen holt in einem Abruf so viel, wie schon geladen war (mindestens eine Seite); die erste Seite ersetzt den Bestand', () => {
  const p = Requests.createPaging();
  assert.equal(p.reloadSize, 50);
  p.start(page(range(81, 130), 130));
  p.append(page(range(31, 80), 130));
  assert.equal(p.reloadSize, 100);
  p.start(page(range(32, 131), 131, 100));
  assert.equal(p.requests.length, 100);
  assert.equal(p.requests[0].id, 131);
  assert.equal(p.received, 100);
  assert.equal(p.hasMore, true);
});

test('Eine Seite, die nichts Neues bringt, beendet das Blaettern (Server, der skip nicht beachtet)', () => {
  const p = Requests.createPaging();
  p.start(page([3, 2, 1], null, 3));
  assert.equal(p.hasMore, true);
  p.append(page([3, 2, 1], null, 3));
  assert.equal(p.hasMore, false);
  assert.deepEqual(p.requests.map((r) => r.id), [3, 2, 1]);
});

// ---------- Lesen einer Anfrage ----------

test('Anfrage lesen: Stand, Art, 4K-Stand bei 4K-Anfragen, Staffeln sortiert, gelieferte Staffeln, Anfragender, Entscheider; Unvollstaendiges ergibt null', () => {
  const r = normalizeRequest({
    id: 12, status: 2, is4k: false, createdAt: '2026-11-16T12:00:00.000Z', type: 'tv',
    media: { tmdbId: 1399, mediaType: 'tv', status: 4, status4k: 1 },
    seasons: [{ seasonNumber: 3, status: 5 }, { seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 2 }, { x: 1 }],
    requestedBy: { id: 3, displayName: 'Ben', email: 'geheim@example.com' }, modifiedBy: { id: 1 }
  });
  assert.deepEqual(r, { id: 12, status: 2, is4k: false, created: '2026-11-16T12:00:00.000Z', mediaType: 'tv', tmdbId: 1399, mediaStatus: 4, seasons: [1, 2, 3], readySeasons: 2, requesterId: 3, requesterName: 'Ben', modifierId: 1 });
  assert.equal(normalizeRequest({ id: 1, is4k: true, media: { tmdbId: 5, mediaType: 'movie', status: 5, status4k: 3 } }).mediaStatus, 3, 'bei einer 4K-Anfrage der Stand der 4K-Fassung');
  assert.equal(normalizeRequest({ id: 1, status: 9, media: { tmdbId: 5, mediaType: 'movie' } }).status, null, 'unbekannter Stand');
  assert.equal(normalizeRequest({ id: 1, media: { tmdbId: 5, mediaType: 'movie' }, requestedBy: { jellyfinUsername: 'anna' } }).requesterName, 'anna');
  for (const bad of [null, {}, { id: 0, media: { tmdbId: 1, mediaType: 'movie' } }, { id: 1 }, { id: 1, media: { mediaType: 'movie' } }, { id: 1, media: { tmdbId: 1, mediaType: 'person' } }]) assert.equal(normalizeRequest(bad), null, JSON.stringify(bad));
});

test('Offen und abgeschlossen: offen sind ausstehend, gescheitert und genehmigt, solange nicht da; alles andere abgeschlossen', () => {
  const r = (status, mediaStatus, extra = {}) => ({ ...req(1, status), mediaStatus, ...extra });
  assert.ok(Requests.matches(r(1, 2), 'open'));
  assert.ok(Requests.matches(r(4, 3), 'open'));
  assert.ok(Requests.matches(r(2, 3), 'open'));
  assert.ok(Requests.matches(r(2, 5), 'closed'), 'genehmigt und da');
  assert.ok(Requests.matches(r(3, 1), 'closed'), 'abgelehnt');
  assert.ok(Requests.matches(r(5, 5), 'closed'));
  assert.ok(Requests.matches(r(2, 4, { mediaType: 'tv', seasons: [1, 2], readySeasons: 2 }), 'closed'), 'Staffel-Anfrage: alle angefragten Staffeln da');
  assert.ok(Requests.matches(r(2, 4, { mediaType: 'tv', seasons: [1, 2], readySeasons: 1 }), 'open'));
});

// ---------- Aktionen nach Rechten (Faelle 3 und 4) ----------

test('Fall 3: normaler Benutzer: nur "Zurueckziehen", nur fuer eigene wartende; sonst nichts', () => {
  const who = { permissions: 32, userId: 7 };
  assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 7 }, who), ['withdraw']);
  assert.deepEqual(Requests.actionsFor({ status: 2, requesterId: 7 }, who), [], 'genehmigt: nicht mehr zurueckziehen');
  assert.deepEqual(Requests.actionsFor({ status: 4, requesterId: 7 }, who), [], 'erneut versuchen nur mit "verwalten"');
  assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 8 }, who), [], 'fremde nie');
  assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 7 }, { permissions: 32, userId: null }), [], 'ohne bekannten Benutzer nichts');
  assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 7 }, { permissions: 'x', userId: 7 }), ['withdraw'], 'unbekannte Rechte schalten nichts frei');
});

test('Fall 4: mit "Anfragen verwalten" (oder Administrator): Genehmigen und Ablehnen wartender, Erneut versuchen gescheiterter, Entfernen jeder', () => {
  for (const permissions of [16, 2, 16 | 32]) {
    const who = { permissions, userId: 1 };
    assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 3 }, who), ['approve', 'decline', 'remove'], `Rechte ${permissions}`);
    assert.deepEqual(Requests.actionsFor({ status: 4, requesterId: 3 }, who), ['retry', 'remove']);
    assert.deepEqual(Requests.actionsFor({ status: 2, requesterId: 3 }, who), ['remove']);
    assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 1 }, who), ['approve', 'decline', 'remove'], 'eigene wartende: verwalten statt zurueckziehen');
  }
  assert.deepEqual(Requests.actionsFor({ status: 1, requesterId: 3 }, { permissions: 16384, userId: 1 }), [], '"Anfragen ansehen" allein: sehen, nicht aendern');
  assert.deepEqual([...Requests.DESTRUCTIVE].sort(), ['decline', 'remove', 'withdraw']);
  assert.deepEqual(Object.keys(REQUEST_ACTIONS).sort(), ['approve', 'decline', 'remove', 'retry', 'withdraw']);
});

test('Angabe unter dem Plakat: Jahr, Staffeln oder Art, 4K, im Verwalten der Anfragende', () => {
  const o = { kinds: { movie: 'Film', tv: 'Serie' }, by: (n) => `von ${n}` };
  assert.equal(Requests.detailLine({ mediaType: 'movie', seasons: [], is4k: false, requesterName: 'Ben' }, { ...o, year: 2021 }), '2021 · Film');
  assert.equal(Requests.detailLine({ mediaType: 'tv', seasons: [1, 2, 3, 5], is4k: true, requesterName: 'Ben' }, { ...o, year: 2011, manage: true }), '2011 · Staffeln 1–3, 5 · 4K · von Ben');
  assert.equal(Requests.detailLine({ mediaType: 'tv', seasons: [], is4k: false, requesterName: '' }, { ...o, manage: true, lang: 'en' }), 'Serie');
  assert.equal(Requests.detailLine({ mediaType: 'tv', seasons: [2], is4k: false }, { ...o, lang: 'en' }), 'Season 2');
});

// ---------- Rueckseite gegen den Test-Seerr ----------

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  resetSeerr();
  state.log.length = 0;
});

function memoryConfig() {
  const store = { text: null };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  return new ConfigCore({ read: () => store.text, write: (t) => (store.text = t) }, codec, env);
}

async function signedIn(permissions) {
  SEERR.permissions = permissions;
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.10', locale: () => 'de-DE' });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  return b;
}
const seed = (query) => fetch(`${base}/__debug/requests?${query}`, { method: 'POST' });
const ids = (p) => p.requests.map((r) => r.id);

test('Meine Anfragen mit der Nummer aus /auth/me (requestedBy), Verwalten ohne; Seiten zu je 50 mit Gesamtzahl', async () => {
  const b = await signedIn(16 | 32);
  b.notificationPrefs({ enabled: false }); // hier zaehlen nur die Abrufe des Reiters (sonst gleicht die App mit der eigenen Liste auch die Mitteilungen ab)
  await seed('count=60&open=10&by=1');
  await seed('count=3&open=3&by=3');
  const mine = await b.seerrRequests({ scope: 'mine', take: 50 });
  assert.equal(mine.total, 60);
  assert.equal(mine.requests.length, 50);
  assert.ok(mine.requests.every((r) => r.requesterId === 1));
  assert.deepEqual(ids(mine).slice(0, 2), [60, 59], 'neueste zuerst');
  const rest = await b.seerrRequests({ scope: 'mine', skip: 50, take: 50 });
  assert.equal(rest.requests.length, 10);
  const all = await b.seerrRequests({ scope: 'manage', take: 50 });
  assert.equal(all.total, 63);
  assert.ok(all.requests.some((r) => r.requesterId === 3 && r.requesterName === 'ben'));
  const lists = state.log.filter((l) => l.at === 'seerr:GET /request');
  assert.equal(lists.length, 3);
});

test('Meine Anfragen ohne bekannten Benutzer: erst die Pruefung, nie eine Abfrage ohne Filter (sonst saehe ein Verwalter alle)', async () => {
  const b = await signedIn(16 | 32);
  await seed('count=2&open=2&by=3');
  b.buildSeerr(); // Neuaufbau: Benutzer und Rechte verworfen
  assert.equal(b.seerrUser, null);
  const mine = await b.seerrRequests({ scope: 'mine' });
  assert.deepEqual(ids(mine), [], 'die Anfragen eines anderen erscheinen nicht unter "Meine"');
  assert.equal(b.seerrUser?.id, 1, 'die Pruefung hat den Benutzer geholt');
});

test('Fall 3: normaler Benutzer: Seerr liefert nur die eigenen; Genehmigen lehnt Seerr ab (SEERR_DENIED, keine abgelaufene Anmeldung); eigene wartende zurueckziehen geht', async () => {
  const b = await signedIn(32);
  await seed('count=2&open=2&by=1');
  await seed('count=2&open=2&by=3');
  const all = await b.seerrRequests({ scope: 'manage' });
  assert.deepEqual(all.requests.map((r) => r.requesterId), [1, 1], 'ohne das Recht, alle zu sehen, nur die eigenen');
  await assert.rejects(() => b.seerrRequestAction({ id: 3, action: 'approve' }), (e) => e.code === 'SEERR_DENIED' && e.status === 403);
  await assert.rejects(() => b.seerrRequestAction({ id: 3, action: 'withdraw' }), (e) => e.code === 'SEERR_DENIED' && e.status === 401, 'fremde zurueckziehen: Seerr antwortet 401, das ist keine abgelaufene Anmeldung');
  assert.equal((await b.checkConnection()).seerr.state, 'connected', 'die Sitzung gilt weiter');
  assert.equal(await b.seerrRequestAction({ id: 2, action: 'withdraw' }), true);
  assert.deepEqual(ids(await b.seerrRequests({ scope: 'mine' })), [1]);
});

test('Fall 4: mit "Anfragen verwalten": Genehmigen, Ablehnen, Erneut versuchen, Entfernen; eine entfernte Anfrage gibt es danach nicht mehr (SEERR_GONE)', async () => {
  const b = await signedIn(16 | 32);
  await seed('count=4&open=4&by=3');
  await b.seerrRequestAction({ id: 1, action: 'approve' });
  await b.seerrRequestAction({ id: 2, action: 'decline' });
  await b.seerrRequestAction({ id: 3, action: 'remove' });
  const all = await b.seerrRequests({ scope: 'manage' });
  const by = Object.fromEntries(all.requests.map((r) => [r.id, r]));
  assert.equal(by[1].status, 2);
  assert.equal(by[1].modifierId, 1, 'entschieden hat der angemeldete Benutzer');
  assert.equal(by[2].status, 3);
  assert.ok(!by[3], 'entfernt');
  await fetch(`${base}/__debug/request?id=4&status=4`, { method: 'POST' });
  await b.seerrRequestAction({ id: 4, action: 'retry' });
  assert.equal((await b.seerrRequests({ scope: 'manage' })).requests.find((r) => r.id === 4).status, 2);
  await assert.rejects(() => b.seerrRequestAction({ id: 3, action: 'remove' }), (e) => e.code === 'SEERR_GONE');
  const calls = state.log.filter((l) => /^seerr:(POST|DELETE) \/request\/\d/.test(l.at)).map((l) => l.at);
  assert.deepEqual(calls, ['seerr:POST /request/1/approve', 'seerr:POST /request/2/decline', 'seerr:DELETE /request/3', 'seerr:POST /request/4/retry', 'seerr:DELETE /request/3']);
  await assert.rejects(() => b.seerrRequestAction({ id: 4, action: 'loeschen' }), /Unbekannte Aktion/);
  await assert.rejects(() => b.seerrRequestAction({ id: -1, action: 'remove' }), /Ungueltige Anfrage/);
});

test('Titel eines Plakats: Name, Jahr, Bild und Stand, in der Sprache der App', async () => {
  const b = await signedIn(32);
  const m = await b.seerrMedia({ mediaType: 'movie', tmdbId: 603 });
  assert.deepEqual([m.title, m.year, m.posterPath, m.mediaType, m.id], ['Mock Matrix Resurrection', 2021, '/mockposter0001.jpg', 'movie', 603]);
  assert.equal(state.log.find((l) => l.at === 'seerr:GET /movie/603')?.language, 'de');
  const made = await b.seerrMedia({ mediaType: 'movie', tmdbId: 90005 });
  assert.equal(made.title, 'Anfrage 90005', 'Testserver: Titel der gestellten Anfragen');
});

// ---------- Mitteilungen (P17) mit der Rueckseite gegen den Test-Seerr ----------

test('Mitteilungen: erster Abgleich still, danach eine Aenderung genau ein Eintrag mit Titel; der Punkt folgt; Trennen nimmt sie mit', async () => {
  SEERR.permissions = 32;
  const seen = [];
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.16', locale: () => 'de-DE', onNotifications: (s) => seen.push(s) });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  await seed('count=2&open=2&by=1');
  assert.deepEqual((await b.notificationsSync({ force: true })).items, [], 'erster Abgleich: nur merken');
  await fetch(`${base}/__debug/request?id=1&status=2`, { method: 'POST' }); // ein Verwalter genehmigt
  const after = await b.notificationsSync({ force: true });
  assert.deepEqual(after.items.map((x) => x.id), ['seerr-1-approved']);
  assert.equal(after.items[0].title, 'Anfrage 90001');
  assert.ok(after.notice === 1 && seen.at(-1).notice === 1, 'die Zahl fuer den Punkt geht an die Oberflaeche');
  assert.equal(after.manages, false, 'ohne das Recht, alle zu sehen: keine "Neue Anfrage"');
  b.notificationRead({ id: 'seerr-1-approved' });
  assert.equal(seen.at(-1).notice, 0);
  await b.seerrDisconnect();
  assert.ok(!b.notifications().active, 'ohne Seerr keine Mitteilungen');
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  assert.deepEqual(b.notifications().items, [], 'getrennt: Mitteilungen und Einstellungen sind mitgegangen');
});

test('Mitteilungen: der Reiter Anfragen gibt seine Liste an den Abgleich (keine weitere Abfrage); eine eigene Aktion meldet die App nicht', async () => {
  const b = await signedIn(16 | 32); // Verwalter
  await seed('count=2&open=2&by=1');
  await b.notificationsSync({ force: true }); // Ausgangsstand
  const lists = () => state.log.filter((l) => l.at === 'seerr:GET /request').length;
  const before = lists();
  await b.seerrRequests({ scope: 'mine', take: 50 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(lists(), before + 1, 'nur der Abruf des Reiters: der Abgleich wartet zwei Minuten und nimmt dann dessen Liste');
  await b.seerrRequestAction({ id: 1, action: 'approve' }); // selbst genehmigt (Bearbeiter: der Nutzer)
  await new Promise((r) => setTimeout(r, 300));
  await b.notificationsSync({ force: true });
  assert.deepEqual(b.notifications().items, [], 'selbst genehmigt: keine Mitteilung');
  assert.equal(b.notifications().manages, true);
});

// ---------- Mitteilungen des Systems (P18) mit der Rueckseite gegen den Test-Seerr ----------

test('Mitteilungen des Systems: nur eingeschaltet und nur Neues, Wortlaut der App ohne Adresse; Antippen nur im eigenen Profil, dann gelesen und zurückgenommen; Trennen nimmt alle', async () => {
  SEERR.permissions = 32;
  const shown = [];
  const withdrawn = [];
  const profiles = [];
  const systemNotify = { show: (list) => shown.push(...list), withdraw: (list) => withdrawn.push(...list), withdrawProfile: (key) => profiles.push(key) };
  const config = memoryConfig();
  const b = createBackend({ config, fetch: globalThis.fetch, appVersion: () => '1.2.17', locale: () => 'de-DE', systemNotify });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  await seed('count=2&open=2&by=1');
  await b.notificationsSync({ force: true });
  await fetch(`${base}/__debug/request?id=1&status=2`, { method: 'POST' });
  await b.notificationsSync({ force: true });
  assert.equal(b.notifications().items.length, 1);
  assert.deepEqual(shown, [], 'Standard aus: keine Mitteilung des Systems');
  assert.equal(b.notificationPrefs({ system: true }).preferences.system, true);
  await fetch(`${base}/__debug/request?id=2&status=5`, { method: 'POST' });
  await b.notificationsSync({ force: true });
  assert.equal(shown.length, 1);
  const m = shown[0];
  assert.ok(m.id.endsWith('.seerr-2-available'));
  assert.equal(m.title, 'Dein angefragter Film ist jetzt verfügbar');
  assert.equal(m.body, '„Anfrage 90002“ wurde deiner Mediathek hinzugefügt und kann jetzt abgespielt werden.');
  const text = JSON.stringify(m);
  const server = config.getServer(config.data.activeServerId);
  assert.ok(!text.includes('127.0.0.1') && !text.includes(server.userId) && !text.includes(server.token) && !text.includes(config.data.activeServerId), 'weder Adresse noch Benutzer, Zugang oder Kennung des Profils');
  // Antippen: ein anderes Profil oder ein unlesbares Ziel fuehren nirgendwohin und aendern nichts
  assert.equal(b.systemNotificationTapped({ ...m.target, profile: 'abcdef123456' }), null);
  assert.equal(b.systemNotificationTapped({ id: 'seerr-2-available' }), null);
  assert.equal(b.notifications().items.find((x) => x.id === 'seerr-2-available').read, false);
  const t = b.systemNotificationTapped(JSON.parse(JSON.stringify(m.target)));
  assert.deepEqual([t.mediaType, t.tmdbId, t.title, t.state], ['movie', 90002, 'Anfrage 90002', 'available']);
  assert.equal(b.notifications().items.find((x) => x.id === 'seerr-2-available').read, true, 'angetippt heisst gelesen');
  assert.deepEqual(withdrawn, [m.id], 'und ihre Mitteilung des Systems ist zurueckgenommen');
  await b.seerrDisconnect();
  assert.deepEqual(profiles, [m.target.profile], 'Seerr getrennt: alle Mitteilungen des Systems dieses Profils gehen mit');
  assert.equal(b.systemNotificationTapped(t), null, 'ohne Seerr fuehrt auch eine alte Mitteilung nirgendwohin');
});