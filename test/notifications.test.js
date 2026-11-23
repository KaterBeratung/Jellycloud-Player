'use strict';
/**
 * Mitteilungen der App (src/shared/notifications.js): Erkennung, Wortlaut, Ablage und Abgleich. Faelle aus JellycloudTests/NotificationRulesTests.swift (14) und
 * NotificationCenterTests.swift der Apple-App; deren Faelle zu den Mitteilungen des Systems (Zustellung, Zuruecknehmen) und SystemNotificationTests.swift (6)
 * stehen am Ende (Plan P18). Die Zahl am App-Symbol ist zurueckgestellt (Entscheidung E15), ihre Faelle fehlen.
 * Der gestellte Seerr nennt den Stand der Anfragen wie der StubServer der Apple-App; ein Fall laeuft durch den echten SeerrClient.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/shared/notifications');
const { SeerrClient } = require('../src/shared/seerr');

const me = 7;
const then = 1_800_000_000_000; // ms
const now = then + 600_000;
const iso = (ms) => new Date(ms).toISOString();
const S = { pending: 1, approved: 2, declined: 3, failed: 4, completed: 5 };

/** Eine Anfrage wie seerr.js normalizeRequest. ready: so viele der angefragten Staffeln fuehrt Seerr als geliefert; modifiedBy: wer zuletzt entschieden hat. */
function request(id, status, { media, by = null, created = null, tv = [], ready = 0, modifiedBy = null } = {}) {
  return { id, status: S[status], is4k: false, created: iso(created ?? then - 3_600_000), mediaType: tv.length ? 'tv' : 'movie', tmdbId: 1000 + id, mediaStatus: media, seasons: tv, readySeasons: ready, requesterId: by ?? me, requesterName: by === null ? 'ich' : 'Anna', modifierId: modifiedBy };
}
/** Erkennung von einem Stand zum naechsten (old null: erster Abgleich). */
function detect(old, next, { manages = false, quiet = [] } = {}) {
  const before = old ? N.detect({ previous: null, current: old, userId: me, manages, lastSync: null }).snapshot : null;
  return N.detect({ previous: before, current: next, userId: me, manages, lastSync: old ? then : null, quiet }).changes;
}
const kinds = (changes) => changes.map((c) => c.kind);

// ---------- Erkennung (NotificationRulesTests) ----------

test('Erstes Verbinden: vorhandene und abgeschlossene Anfragen ergeben keine Mitteilung', () => {
  const all = [request(1, 'completed', { media: 5 }), request(2, 'approved', { media: 3 }), request(3, 'declined', { media: 1 }), request(4, 'pending', { media: 2, by: 9 })];
  assert.deepEqual(detect(null, all, { manages: true }), []);
});

test('Verfügbar: nur, wenn der Titel wirklich da ist; genehmigt allein heißt „genehmigt“', () => {
  assert.deepEqual(kinds(detect([request(1, 'pending', { media: 2 })], [request(1, 'approved', { media: 3 })])), ['approved']);
  assert.deepEqual(detect([request(1, 'approved', { media: 3 })], [request(1, 'approved', { media: 3 })]), []);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 3 })], [request(1, 'completed', { media: 5 })])), ['available']);
  assert.deepEqual(kinds(detect([request(1, 'pending', { media: 2 })], [request(1, 'completed', { media: 5 })])), ['available'], 'zwischen zwei Abgleichen genehmigt und geliefert: eine Mitteilung, die wichtigere');
});

test('Abgelehnt, fehlgeschlagen, teilweise verfügbar (Serie)', () => {
  assert.deepEqual(kinds(detect([request(1, 'pending', { media: 2 })], [request(1, 'declined', { media: 1 })])), ['declined']);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 3 })], [request(1, 'failed', { media: 3 })])), ['failed']);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 3, tv: [1, 2] })], [request(1, 'approved', { media: 4, tv: [1, 2] })])), ['partiallyAvailable']);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 4, tv: [1, 2] })], [request(1, 'completed', { media: 5, tv: [1, 2] })])), ['available']);
  assert.deepEqual(detect([request(1, 'failed', { media: 3 })], [request(1, 'approved', { media: 3 })]), [], 'erneut versucht: wieder in Arbeit ist keine Nachricht');
});

test('Mehrere Titel zugleich: je Anfrage eine Mitteilung, die Staffeln der Anfrage dabei', () => {
  const old = [request(1, 'approved', { media: 3 }), request(2, 'approved', { media: 3, tv: [2, 3] }), request(3, 'approved', { media: 3 })];
  const next = [request(1, 'completed', { media: 5 }), request(2, 'completed', { media: 5, tv: [2, 3] }), request(3, 'approved', { media: 3 })];
  const changes = detect(old, next);
  assert.deepEqual(kinds(changes), ['available', 'available']);
  assert.deepEqual(changes.map((c) => c.request.id), [1, 2]);
  assert.deepEqual(changes.at(-1).request.seasons, [2, 3]);
});

test('Neue Anfragen anderer: nur für Verwalter, nur wartende, nur seit dem letzten Abgleich gestellte', () => {
  const old = [request(1, 'approved', { media: 3 })];
  const fresh = request(2, 'pending', { media: 2, by: 9, created: then + 120_000 });
  assert.deepEqual(kinds(detect(old, [fresh, ...old], { manages: true })), ['newRequest']);
  assert.deepEqual(detect(old, [fresh, ...old], { manages: false }), []);
  assert.deepEqual(detect(old, [request(3, 'pending', { media: 2, by: 9 }), ...old], { manages: true }), [], 'aelter als der letzte Abgleich');
  assert.deepEqual(detect(old, [request(4, 'approved', { media: 3, by: 9, created: then + 120_000 }), ...old], { manages: true }), [], 'schon entschieden');
  assert.deepEqual(detect([request(5, 'pending', { media: 2, by: 9 })], [request(5, 'completed', { media: 5, by: 9 })], { manages: true }), [], 'Aenderungen an fremden Anfragen');
});

test('Eigene Anfrage, die die App noch nie gesehen hat: seit dem letzten Abgleich gestellt zählt sie wie eine wartende, deren Stand sich geändert hat', () => {
  const old = [request(1, 'approved', { media: 3 })];
  const fresh = then + 60_000;
  assert.deepEqual(kinds(detect(old, [request(2, 'completed', { media: 5, created: fresh }), ...old])), ['available']);
  assert.deepEqual(kinds(detect(old, [request(3, 'approved', { media: 3, created: fresh, modifiedBy: 9 }), ...old])), ['approved']);
  assert.deepEqual(kinds(detect(old, [request(4, 'declined', { media: 1, created: fresh, modifiedBy: 9 }), ...old])), ['declined']);
  assert.deepEqual(kinds(detect(old, [request(5, 'failed', { media: 3, created: fresh }), ...old])), ['failed']);
  assert.deepEqual(detect(old, [request(6, 'pending', { media: 2, created: fresh }), ...old]), [], 'wartet noch: das weiss, wer sie gestellt hat');
  assert.deepEqual(detect(old, [request(7, 'completed', { media: 5 }), ...old]), [], 'alte Anfrage, die nur wieder in die Liste rutscht');
  assert.deepEqual(detect(old, [request(8, 'approved', { media: 3, modifiedBy: 9 }), ...old]), []);
});

test('Was der Nutzer selbst entschieden hat (auch die automatische Genehmigung), ist keine Nachricht; geliefert schon', () => {
  const old = [request(1, 'approved', { media: 3 })];
  const fresh = then + 60_000;
  assert.deepEqual(detect(old, [request(2, 'approved', { media: 3, created: fresh, modifiedBy: me }), ...old]), [], 'beim Anfragen automatisch genehmigt');
  assert.deepEqual(detect([request(1, 'pending', { media: 2 })], [request(1, 'approved', { media: 3, modifiedBy: me })]), []);
  assert.deepEqual(detect([request(1, 'pending', { media: 2 })], [request(1, 'declined', { media: 1, modifiedBy: me })]), []);
  assert.deepEqual(kinds(detect([request(1, 'pending', { media: 2 })], [request(1, 'approved', { media: 3, modifiedBy: 9 })])), ['approved'], 'ein anderer hat entschieden');
  assert.deepEqual(kinds(detect([request(1, 'pending', { media: 2 })], [request(1, 'completed', { media: 5, modifiedBy: me })])), ['available']);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 3, modifiedBy: me })], [request(1, 'failed', { media: 3, modifiedBy: me })])), ['failed']);
});

test('Folgestaffel einer Serie, von der schon Staffeln da sind: genehmigt heißt genehmigt, geliefert heißt verfügbar', () => {
  assert.deepEqual(kinds(detect([request(1, 'pending', { media: 4, tv: [3] })], [request(1, 'approved', { media: 4, tv: [3], modifiedBy: 9 })])), ['approved']);
  assert.deepEqual(detect([request(1, 'approved', { media: 4, tv: [3] })], [request(1, 'approved', { media: 4, tv: [3] })]), []);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 4, tv: [3] })], [request(1, 'completed', { media: 4, tv: [3], ready: 1 })])), ['available'], 'die Staffel ist da, die Serie bleibt teilweise');
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 4, tv: [3, 4] })], [request(1, 'approved', { media: 4, tv: [3, 4], ready: 1 })])), ['partiallyAvailable']);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 4, tv: [3, 4], ready: 1 })], [request(1, 'completed', { media: 4, tv: [3, 4], ready: 2 })])), ['available']);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 3, tv: [1] })], [request(1, 'approved', { media: 4, tv: [1] })])), ['partiallyAvailable'], 'neue Serie: vorher nichts da');
  assert.deepEqual(kinds(detect([], [request(2, 'approved', { media: 4, created: then + 60_000, tv: [2], modifiedBy: 9 })])), ['approved'], 'noch nie gesehen, schon genehmigt, Serie teilweise da: genehmigt');
});

test('Was der Nutzer in der App selbst ausgelöst hat (genehmigen, ablehnen), meldet sie ihm nicht', () => {
  assert.deepEqual(detect([request(1, 'pending', { media: 2 })], [request(1, 'approved', { media: 3 })], { quiet: [1] }), []);
  assert.deepEqual(kinds(detect([request(1, 'approved', { media: 3 })], [request(1, 'completed', { media: 5 })])), ['available'], 'danach wieder normal');
});

test('Verschwundene Anfragen (entfernt, zurückgezogen) ergeben nichts und werden vergessen', () => {
  const before = N.detect({ previous: null, current: [request(1, 'pending', { media: 2 }), request(2, 'approved', { media: 3 })], userId: me }).snapshot;
  const after = N.detect({ previous: before, current: [request(2, 'approved', { media: 3 })], userId: me, lastSync: then });
  assert.deepEqual(after.changes, []);
  assert.deepEqual(Object.keys(after.snapshot), ['2']);
});

test('Texte: „jetzt verfügbar“ mit Titel, Staffeln genannt, neue Anfrage mit Namen; Englisch', () => {
  const note = (kind, r, title) => N.notificationOf({ kind, request: r }, { title, date: now });
  const film = note('available', request(1, 'completed', { media: 5 }), 'Interstellar');
  assert.equal(N.headline(film), 'Dein angefragter Film ist jetzt verfügbar');
  assert.equal(N.message(film), '„Interstellar“ wurde deiner Mediathek hinzugefügt und kann jetzt abgespielt werden.');
  const serie = note('available', request(2, 'completed', { media: 5, tv: [2, 3] }), 'Winter Signals');
  assert.equal(N.headline(serie), 'Deine angefragten Staffeln sind jetzt verfügbar');
  assert.equal(N.message(serie), 'Staffeln 2, 3 von „Winter Signals“ wurden deiner Mediathek hinzugefügt.');
  assert.equal(N.message(note('available', request(2, 'completed', { media: 5, tv: [1, 2, 3, 5] }), 'X')), 'Staffeln 1–3, 5 von „X“ wurden deiner Mediathek hinzugefügt.', 'ab drei als Bereich');
  assert.equal(N.headline(note('available', request(2, 'completed', { media: 5, tv: [4] }), 'X')), 'Deine angefragte Staffel ist jetzt verfügbar');
  assert.equal(N.message(note('available', request(2, 'completed', { media: 5, tv: [4] }), 'X')), 'Staffel 4 von „X“ wurde deiner Mediathek hinzugefügt.');
  const teil = note('partiallyAvailable', request(2, 'approved', { media: 4, tv: [1] }), 'Winter Signals');
  assert.equal(N.headline(teil), 'Erste Folgen sind verfügbar');
  const neu = note('newRequest', request(4, 'pending', { media: 2, by: 9 }), 'Dune');
  assert.equal(N.headline(neu), 'Neue Anfrage');
  assert.equal(N.message(neu), 'Anna hat „Dune“ angefragt.');
  assert.equal(N.systemMessage(neu), '„Dune“ wurde angefragt.', 'in der Mitteilung des Systems nie der Name eines anderen');
  const genehmigt = note('approved', request(1, 'approved', { media: 3 }), 'Dune');
  assert.ok(!N.headline(genehmigt).includes('verfügbar') && !N.message(genehmigt).includes('verfügbar'), '„jetzt verfügbar“ nur bei wirklich Verfügbarem');
  assert.equal(film.id, 'seerr-1-available', 'Kennung je Anfrage und Art');
  assert.equal(N.stateOf(neu), 'requested');
  assert.equal(N.headline(film, 'en'), 'Your requested movie is now available');
  assert.equal(N.message(serie, 'en'), 'Seasons 2, 3 of “Winter Signals” were added to your library.');
  assert.equal(N.message(neu, 'en'), 'Anna requested “Dune”.');
});

test('Ablage: nichts doppelt, gelesen bleibt gelesen, entfernt bleibt entfernt, höchstens 100, alle entfernen; ein Neustart liest denselben Stand', () => {
  const note = (id, kind) => N.notificationOf({ kind, request: request(id, 'completed', { media: 5 }) }, { title: `Titel ${id}`, date: now + id });
  const a = N.createStore(null);
  assert.equal(a.add([note(1, 'available'), note(2, 'approved')]).length, 2);
  assert.deepEqual(a.add([note(1, 'available')]), [], 'derselbe Eintrag noch einmal: nichts Neues');
  assert.equal(a.unread, 2);
  a.markRead('seerr-1-available');
  a.remove('seerr-2-approved');
  assert.deepEqual(a.add([note(2, 'approved')]), [], 'entfernt bleibt entfernt');
  const again = N.createStore(a.serialize());
  assert.deepEqual(again.items.map((x) => x.id), ['seerr-1-available']);
  assert.equal(again.unread, 0);
  assert.deepEqual(again.add([note(1, 'available')]), []);
  again.add(Array.from({ length: 150 }, (_, i) => note(10 + i, 'available')));
  assert.equal(again.items.length, 100);
  assert.equal(again.items[0].id, 'seerr-159-available', 'neueste zuerst');
  again.removeAll();
  assert.ok(again.items.length === 0 && again.unread === 0);
  assert.deepEqual(again.add([note(159, 'available'), note(60, 'available')]), [], 'keiner taucht wieder auf');
  assert.equal(again.add([note(500, 'available')]).length, 1, 'Neues kommt weiter an');
  assert.deepEqual(N.createStore(again.serialize()).items.map((x) => x.id), ['seerr-500-available']);
});

test('Ablage tolerant: unbekannte Art fällt allein weg, Stand ohne Zeit gilt als nie abgeglichen, kaputte Datei als leer', () => {
  const good = N.notificationOf({ kind: 'available', request: request(1, 'completed', { media: 5 }) }, { title: 'A', date: now });
  const text = JSON.stringify({ items: [good, { ...good, id: 'seerr-2-zukunft', kind: 'zukunft' }], snapshot: { 1: { state: 'available', own: true, media: 5 } }, lastSync: null, preferences: { enabled: true, kinds: ['available', 'zukunft'] }, removed: [] });
  const s = N.createStore(text);
  assert.deepEqual(s.items.map((x) => x.id), ['seerr-1-available']);
  assert.equal(s.snapshot, null);
  assert.deepEqual(s.preferences.kinds, ['available']);
  assert.equal(N.createStore('{kaputt').items.length, 0);
  assert.equal(N.createStore(JSON.stringify({ lastSync: then, snapshot: { abc: 1 } })).snapshot, null);
});

test('Einstellungen je Profil: aus heißt keine Mitteilung; einzelne Arten abwählbar', () => {
  const prefs = N.defaultPreferences();
  assert.ok(prefs.enabled && !prefs.system, 'in der App an, Mitteilungen des Systems erst auf Wunsch');
  assert.ok(N.allows(prefs, 'available') && N.allows(prefs, 'newRequest'));
  prefs.kinds = prefs.kinds.filter((k) => k !== 'approved');
  assert.ok(!N.allows(prefs, 'approved') && N.allows(prefs, 'declined'));
  prefs.enabled = false;
  assert.deepEqual(N.KINDS.filter((k) => N.allows(prefs, k)), []);
});

test('Ausgeschaltet: Punkt und Zahl null, die Liste bleibt; wieder eingeschaltet gilt der gemerkte Stand nicht mehr', () => {
  const store = N.createStore(null);
  store.add([N.notificationOf({ kind: 'available', request: request(1, 'completed', { media: 5 }) }, { title: 'Dune', date: now })]);
  store.snapshot = { 1: { state: 'available', own: true, media: 5 } };
  store.lastSync = then;
  assert.ok(store.unread === 1 && store.notice === 1);
  store.setPreferences({ ...store.preferences, enabled: false });
  assert.ok(store.notice === 0 && store.unread === 1 && store.items.length === 1);
  assert.ok(store.snapshot !== null && store.lastSync === then, 'beim Ausschalten bleibt alles');
  store.setPreferences({ ...store.preferences, system: true });
  assert.ok(store.snapshot !== null);
  store.setPreferences({ ...store.preferences, enabled: true });
  assert.ok(store.snapshot === null && store.lastSync === null && store.notice === 1 && store.preferences.system, 'wieder an: wie beim ersten Verbinden');
  store.snapshot = { 1: { state: 'available', own: true, media: 5 } };
  store.setPreferences({ ...store.preferences, kinds: store.preferences.kinds.filter((k) => k !== 'approved') });
  assert.ok(store.snapshot !== null, 'eingeschaltet geaenderte Arten lassen den Stand stehen');
});

// ---------- Abgleich (NotificationCenterTests) ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (t) => require('node:crypto').createHash('sha1').update(t).digest('hex').slice(0, 12);

/** Gestellter Seerr: Nummer -> [Stand der Anfrage, Stand des Titels]; Anfragen eines anderen Benutzers (9), eben erst gestellt. Zaehlt die Abrufe. */
function fakeSeerr() {
  const requests = new Map();
  const foreign = new Set();
  const s = {
    calls: [],
    failTitles: false,
    titleDelay: 0,
    listDelay: 0,
    foreignCreated: '2099-01-01T10:00:00.000Z',
    set: (id, req, media) => requests.set(id, [req, media]),
    setForeign(id) {
      requests.set(id, [1, 2]);
      foreign.add(id);
    },
    async requestPage({ userId = null } = {}) {
      s.calls.push(`request${userId ? '?requestedBy' : ''}`);
      const list = [...requests.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([id, [st, media]]) => {
          const other = foreign.has(id);
          return { id, status: st, is4k: false, created: other ? s.foreignCreated : '2026-11-01T10:00:00.000Z', mediaType: 'movie', tmdbId: 1000 + id, mediaStatus: media, seasons: [], readySeasons: 0, requesterId: other ? 9 : 7, requesterName: other ? 'ben' : 'anna', modifierId: null };
        })
        .filter((r) => !userId || r.requesterId === userId);
      await wait(s.listDelay);
      return { requests: list };
    },
    async media(type, tmdbId) {
      s.calls.push('movie');
      const fail = s.failTitles;
      await wait(s.titleDelay);
      if (fail) throw new Error('500');
      return { title: `Film ${tmdbId}`, posterPath: '/abcdefgh.jpg' };
    }
  };
  return s;
}
const user = { id: 7, permissions: 32, displayName: 'anna' };
const manager = { id: 7, permissions: 48, displayName: 'anna' }; // anfragen und Anfragen verwalten
function setup({ clock } = {}) {
  const io = N.memoryIo();
  const changes = [];
  const delivered = []; // je Zustellung an das System die Kennungen
  const withdrawn = []; // je Ruecknahme die Kennungen (sortiert), null fuer alle des Profils
  const profiles = []; // das Profil jeder Zustellung und Ruecknahme
  const center = N.createCenter({
    io,
    hash,
    now: clock ?? (() => Date.now()),
    onChange: (s) => changes.push(s),
    onDeliver: (items, profile) => (delivered.push(items.map((x) => x.id)), profiles.push(profile)),
    onWithdraw: (list, profile) => (withdrawn.push(list === null ? null : [...list].sort()), profiles.push(profile))
  });
  center.activate({ profile: 'server|anna', seerr: 'https://melden.seerr.test' });
  return { center, seerr: fakeSeerr(), io, changes, delivered, withdrawn, profiles };
}
const ids = (center) => center.list().items.map((x) => x.id);

test('Erster Abgleich still; danach ergibt eine Änderung genau einen Eintrag, ein weiterer Abgleich keinen zweiten', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 1, 2);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), []);
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), ['seerr-1-available']);
  assert.equal(center.list().items[0].title, 'Film 1001');
  assert.equal(center.summary().unread, 1);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.list().items.length, 1);
});

test('Ohne ausdrücklichen Wunsch liegen zwischen zwei Abgleichen mindestens zwei Minuten (kein dauerndes Abfragen)', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 1, 2);
  await center.sync({ seerr, user });
  const first = seerr.calls.length;
  await center.sync({ seerr, user });
  await center.sync({ seerr, user });
  assert.equal(seerr.calls.length, first);
  await center.sync({ seerr, user, force: true });
  assert.ok(seerr.calls.length > first);
});

test('Lädt der Reiter Anfragen seine Liste neu, gleicht er damit nur nach zwei Minuten ab; nach einer eigenen Aktion sofort, die eigene Liste wird mitverwendet', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 1, 2);
  await center.sync({ seerr, user: manager });
  assert.deepEqual(seerr.calls, ['request?requestedBy', 'request'], 'Verwalter: die eigenen und alle');
  const own = (await seerr.requestPage({ userId: 7 })).requests; // der Abruf des Reiters
  const before = seerr.calls.length;
  await center.sync({ seerr, user: manager, own });
  await center.sync({ seerr, user: manager, own });
  assert.equal(seerr.calls.length, before);
  await center.sync({ seerr, user: manager, force: true, own });
  assert.deepEqual(seerr.calls.slice(before), ['request'], 'ein Abruf der Liste aller, die eigene kommt vom Reiter');
});

test('Was der Nutzer in der App selbst auslöst, wird nicht gemeldet; ausgeschaltete Arten auch nicht; wieder eingeschaltet kommt Vergangenes nicht nach', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 1, 2);
  seerr.set(2, 1, 2);
  await center.sync({ seerr, user, force: true });
  center.willChange(1);
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), []);
  center.setPreferences({ kinds: N.KINDS.filter((k) => k !== 'declined') });
  seerr.set(2, 3, 1);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), []);
  center.setPreferences({ kinds: [...N.KINDS] });
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), []);
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), ['seerr-1-available']);
});

test('Lässt sich der Titel nicht holen, geht die Nachricht nicht verloren: der nächste Abgleich bringt sie', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  seerr.failTitles = true;
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), []);
  seerr.failTitles = false;
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), ['seerr-1-available']);
});

test('Profilwechsel: das andere Profil sieht nichts; zurück ist alles wieder da; Profil entfernt, Bestand gelöscht; andere Adresse von Seerr eigener Bestand', async () => {
  const { center, seerr, io } = setup();
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.summary().unread, 1);
  center.activate({ profile: 'server|ben', seerr: 'https://melden.seerr.test' });
  assert.ok(center.list().items.length === 0 && center.summary().unread === 0);
  center.activate({ profile: 'server|anna', seerr: 'https://anderer.seerr.test' });
  assert.equal(center.list().items.length, 0, 'anderer Seerr-Server: eigener, leerer Bestand');
  center.activate(null);
  assert.ok(!center.active && center.list().items.length === 0);
  center.activate({ profile: 'server|anna', seerr: 'https://melden.seerr.test' });
  assert.deepEqual(ids(center), ['seerr-1-available']);
  assert.ok(io.names().every((n) => /^[0-9a-f]{12}-[0-9a-f]{12}$/.test(n)), 'Namen der Ablage ohne Adresse und Kennung im Klartext');
  center.forget('server|anna');
  assert.deepEqual(ids(center), [], 'das aktive Profil vergessen: sofort leer');
  center.activate(null);
  center.activate({ profile: 'server|anna', seerr: 'https://melden.seerr.test' });
  assert.deepEqual(ids(center), []);
  assert.equal(io.names().length, 0);
});

test('Neue Kennung des Profils (andere Adresse des Servers): der Bestand zieht mit; Seerr getrennt nimmt nur diesen Bestand', async () => {
  const { center, seerr, io } = setup();
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  center.move('server|anna', 'neu|anna');
  center.activate({ profile: 'neu|anna', seerr: 'https://melden.seerr.test' });
  assert.deepEqual(ids(center), ['seerr-1-available'], 'nach dem Umzug derselbe Stand, ohne neu zu laden');
  center.activate(null);
  center.activate({ profile: 'neu|anna', seerr: 'https://melden.seerr.test' });
  assert.deepEqual(ids(center), ['seerr-1-available'], 'auch aus der Ablage');
  center.activate({ profile: 'neu|anna', seerr: 'https://anderer.seerr.test' });
  center.setPreferences({ system: true }); // legt den zweiten Bestand an
  center.forget('neu|anna', 'https://melden.seerr.test');
  assert.equal(io.names().length, 1, 'nur der Bestand am getrennten Seerr ist weg');
});

test('Alle entfernen: die Liste ist leer, nichts kommt wieder; ohne Einträge geschieht nichts', async () => {
  const { center, seerr, changes } = setup();
  for (const id of [1, 2, 3]) seerr.set(id, 2, 3);
  await center.sync({ seerr, user, force: true });
  for (const id of [1, 2, 3]) seerr.set(id, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.list().items.length, 3);
  center.removeAll();
  assert.ok(center.list().items.length === 0 && center.summary().unread === 0 && center.summary().notice === 0);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.list().items.length, 0);
  const before = changes.length;
  center.removeAll();
  assert.equal(changes.length, before, 'keine Meldung ohne Aenderung');
});

test('Was der Nutzer während eines Abgleichs tut (gelesen, entfernt, Einstellung), bleibt, auch nach einem Neustart', async () => {
  const { center, seerr, io } = setup();
  for (const id of [1, 2, 3]) seerr.set(id, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  seerr.set(2, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.list().items.length, 2);
  seerr.set(3, 5, 5);
  seerr.titleDelay = 200;
  const running = center.sync({ seerr, user, force: true });
  await wait(80);
  center.markRead('seerr-1-available');
  center.remove('seerr-2-available');
  center.setPreferences({ system: true });
  await running;
  assert.deepEqual(ids(center).sort(), ['seerr-1-available', 'seerr-3-available']);
  assert.equal(center.list().items.find((x) => x.id === 'seerr-1-available').read, true);
  assert.ok(center.preferences.system);
  seerr.titleDelay = 0;
  const again = N.createCenter({ io, hash });
  again.activate({ profile: 'server|anna', seerr: 'https://melden.seerr.test' });
  assert.deepEqual(ids(again).sort(), ['seerr-1-available', 'seerr-3-available']);
  assert.ok(again.preferences.system);
  await again.sync({ seerr, user, force: true });
  assert.equal(again.list().items.length, 2, 'das Entfernte kommt beim naechsten Abgleich nicht wieder');
});

test('Zwei Abgleiche laufen nie zugleich: eine Änderung wird einmal bearbeitet, ihr Titel einmal geholt', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.listDelay = 150;
  const first = center.sync({ seerr, user, force: true });
  await wait(40);
  seerr.listDelay = 0;
  seerr.titleDelay = 60;
  seerr.set(1, 5, 5);
  const second = center.sync({ seerr, user, force: true });
  const third = center.sync({ seerr, user, force: true });
  const fresh = (await Promise.all([first, second, third])).map((list) => list.map((x) => x.id));
  assert.deepEqual(fresh.flat(), ['seerr-1-available'], 'genau einmal neu');
  assert.equal(center.list().items.length, 1);
  assert.equal(seerr.calls.filter((c) => c === 'movie').length, 1);
});

test('Neue Anfrage, deren Titel sich nicht holen lässt: die Nachricht kommt beim nächsten Abgleich', async () => {
  const noon = Date.parse('2026-11-19T12:00:00Z');
  let time = noon;
  const { center, seerr } = setup({ clock: () => time });
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user: manager, force: true });
  seerr.foreignCreated = '2026-11-19T12:10:00.000Z';
  seerr.setForeign(2);
  seerr.failTitles = true;
  time = noon + 20 * 60_000;
  await center.sync({ seerr, user: manager, force: true });
  assert.deepEqual(ids(center), []);
  seerr.failTitles = false;
  time = noon + 30 * 60_000;
  await center.sync({ seerr, user: manager, force: true });
  assert.deepEqual(ids(center), ['seerr-2-newRequest']);
  time = noon + 40 * 60_000;
  await center.sync({ seerr, user: manager, force: true });
  assert.equal(center.list().items.length, 1);
});

test('Zeit des Abgleichs mit zwei Minuten Spielraum: eine Anfrage, die kurz vor dem Abgleich gestellt wurde (abweichende Uhr), zählt beim nächsten', async () => {
  const noon = Date.parse('2026-11-19T12:00:00Z');
  let time = noon;
  const { center, seerr } = setup({ clock: () => time });
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user: manager, force: true });
  seerr.foreignCreated = '2026-11-19T11:59:00.000Z'; // eine Minute vor dem Abgleich (die Uhr von Seerr geht nach), war aber noch nicht in der Liste
  seerr.setForeign(2);
  time = noon + 5 * 60_000;
  await center.sync({ seerr, user: manager, force: true });
  assert.deepEqual(ids(center), ['seerr-2-newRequest']);
});

test('Profilwechsel während eines Abgleichs: der erste Abgleich des neuen Profils findet statt, das neue Profil sieht nichts vom alten', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  seerr.titleDelay = 150;
  const old = center.sync({ seerr, user, force: true });
  await wait(40);
  center.activate({ profile: 'server|ben', seerr: 'https://melden.seerr.test' });
  seerr.titleDelay = 0;
  const before = seerr.calls.length;
  await center.sync({ seerr, user }); // ohne ausdruecklichen Wunsch, wie nach der Verbindungspruefung
  assert.ok(seerr.calls.length > before);
  await old;
  assert.deepEqual(ids(center), []);
});

test('Ausgeschaltet: kein Abgleich (auch nicht ausdrücklich gewünscht), kein Punkt; die Liste bleibt, Lesen geht weiter', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 2, 3);
  seerr.set(2, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.ok(center.summary().unread === 1 && center.summary().notice === 1);
  center.setPreferences({ enabled: false });
  assert.equal(center.summary().notice, 0);
  assert.ok(ids(center).join() === 'seerr-1-available' && center.summary().unread === 1);
  const before = seerr.calls.length;
  seerr.set(2, 5, 5);
  await center.sync({ seerr, user });
  await center.sync({ seerr, user, force: true });
  await center.sync({ seerr, user, force: true, own: [] });
  assert.equal(seerr.calls.length, before);
  assert.equal(center.list().items.length, 1);
  center.markRead('seerr-1-available');
  assert.ok(center.summary().unread === 0 && center.summary().notice === 0);
});

test('Wieder eingeschaltet: der erste Abgleich ist still wie beim ersten Verbinden (auch ohne ausdrücklichen Wunsch), danach kommt Neues wie gewohnt', async () => {
  const { center, seerr, io } = setup();
  const fresh = [];
  const sync = async (o) => fresh.push(...(await center.sync({ seerr, user, ...o })).map((x) => x.id));
  seerr.set(1, 1, 2);
  seerr.set(2, 2, 3);
  await sync({ force: true });
  center.setPreferences({ enabled: false });
  seerr.set(1, 3, 1);
  seerr.set(2, 5, 5);
  await sync({ force: true });
  center.setPreferences({ enabled: true });
  await sync({}); // der Mindestabstand gilt nach dem Einschalten nicht
  assert.ok(ids(center).length === 0 && fresh.length === 0);
  seerr.set(3, 1, 2);
  await sync({ force: true });
  seerr.set(3, 2, 3);
  await sync({ force: true });
  assert.deepEqual(ids(center), ['seerr-3-approved']);
  assert.deepEqual(fresh, ['seerr-3-approved']);
  center.setPreferences({ enabled: false });
  const again = N.createCenter({ io, hash });
  again.activate({ profile: 'server|anna', seerr: 'https://melden.seerr.test' });
  assert.ok(!again.preferences.enabled && again.summary().unread === 1 && again.summary().notice === 0, 'ausgeschaltet gemerkt, kein Punkt');
});

test('Ein Abgleich, der beim Aus- und Wiedereinschalten noch läuft, trägt nichts mehr ein; danach beginnt es still', async () => {
  const { center, seerr } = setup();
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  seerr.titleDelay = 200;
  const running = center.sync({ seerr, user, force: true });
  await wait(80);
  center.setPreferences({ enabled: false });
  center.setPreferences({ enabled: true });
  await running;
  seerr.titleDelay = 0;
  assert.ok(ids(center).length === 0 && center.summary().notice === 0);
  seerr.set(1, 3, 1);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(ids(center), []);
});

test('Gegen einen Seerr wie in der Apple-App (SeerrClient): die eigenen mit requestedBy, der Titel aus /movie/<nummer>', async () => {
  const seen = [];
  const state = new Map([[1, [2, 3]]]);
  const fetch = async (url) => {
    const u = new URL(url);
    seen.push(`${u.pathname}${u.searchParams.has('requestedBy') ? `?requestedBy=${u.searchParams.get('requestedBy')}&take=${u.searchParams.get('take')}` : ''}`);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/api/v1/request')) {
      return json({ results: [...state].map(([id, [st, media]]) => ({ id, status: st, is4k: false, createdAt: '2026-11-01T10:00:00.000Z', type: 'movie', media: { tmdbId: 1000 + id, mediaType: 'movie', status: media }, seasons: [], requestedBy: { id: 7, displayName: 'anna' } })) });
    }
    if (u.pathname.includes('/api/v1/movie/')) return json({ id: Number(u.pathname.split('/').pop()), title: `Film ${u.pathname.split('/').pop()}`, posterPath: '/abcdefgh.jpg' });
    return new Response('', { status: 404 });
  };
  const client = new SeerrClient({ baseUrl: 'https://eins.melden.seerr.test', cookie: 'connect.sid=s', fetch });
  const center = N.createCenter({ hash });
  center.activate({ profile: 'server|anna', seerr: client.baseUrl });
  await center.sync({ seerr: client, user, force: true });
  state.set(1, [5, 5]);
  await center.sync({ seerr: client, user, force: true });
  assert.deepEqual(ids(center), ['seerr-1-available']);
  assert.equal(center.list().items[0].title, 'Film 1001');
  assert.deepEqual(seen, ['/api/v1/request?requestedBy=7&take=50', '/api/v1/request?requestedBy=7&take=50', '/api/v1/movie/1001']);
});

// ---------- Mitteilungen des Systems: Zustellen und Zuruecknehmen (NotificationCenterTests, Plan P18) ----------

test('An das System geht nur, was neu ist, und nur, wenn der Nutzer Mitteilungen des Systems eingeschaltet hat', async () => {
  const { center, seerr, delivered, profiles } = setup();
  seerr.set(1, 2, 3);
  seerr.set(2, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(delivered, [], 'in der App ja, als Mitteilung des Systems nicht');
  assert.equal(center.list().items.length, 1);
  center.setPreferences({ system: true });
  seerr.set(2, 5, 5);
  await center.sync({ seerr, user, force: true });
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(delivered, [['seerr-2-available']]);
  assert.deepEqual(profiles, ['server|anna'], 'mit dem Profil, zu dem sie gehoert');
});

test('Gelesen oder entfernt: die Mitteilung des Systems dazu wird zurückgenommen; wieder ungelesen holt keine zurück', async () => {
  const { center, seerr, withdrawn, delivered } = setup();
  for (const id of [1, 2, 3]) seerr.set(id, 2, 3);
  await center.sync({ seerr, user, force: true });
  for (const id of [1, 2, 3]) seerr.set(id, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.list().items.length, 3);
  center.markRead('seerr-1-available');
  center.markRead('seerr-1-available', false);
  center.markRead('seerr-1-available', false); // unveraendert: nichts
  center.remove('seerr-2-available');
  center.markAllRead();
  center.markAllRead(); // alles schon gelesen: keine leere Ruecknahme
  assert.deepEqual(withdrawn, [['seerr-1-available'], ['seerr-2-available'], ['seerr-1-available', 'seerr-3-available']]);
  assert.deepEqual(delivered, [], 'wieder ungelesen holt keine zurueck');
});

test('Alle entfernen: Mitteilungen des Systems zurückgenommen, nichts kommt wieder; ohne Einträge keine leere Rücknahme', async () => {
  const { center, seerr, withdrawn, delivered } = setup();
  center.setPreferences({ system: true });
  for (const id of [1, 2, 3]) seerr.set(id, 2, 3);
  await center.sync({ seerr, user, force: true });
  for (const id of [1, 2, 3]) seerr.set(id, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.equal(delivered.length, 1, 'eine Zustellung fuer den Abgleich');
  assert.deepEqual([...delivered[0]].sort(), ['seerr-1-available', 'seerr-2-available', 'seerr-3-available']);
  center.removeAll();
  assert.deepEqual(withdrawn.at(-1), ['seerr-1-available', 'seerr-2-available', 'seerr-3-available']);
  await center.sync({ seerr, user, force: true });
  assert.equal(center.list().items.length, 0);
  assert.equal(delivered.length, 1, 'das Entfernte kommt auch beim System nicht wieder');
  const before = withdrawn.length;
  center.removeAll();
  assert.equal(withdrawn.length, before);
});

test('Zwei Abgleiche laufen nie zugleich: eine Änderung geht einmal an das System', async () => {
  const { center, seerr, delivered } = setup();
  center.setPreferences({ system: true });
  seerr.set(1, 2, 3);
  await center.sync({ seerr, user, force: true });
  seerr.listDelay = 150;
  const first = center.sync({ seerr, user, force: true });
  await wait(40);
  seerr.listDelay = 0;
  seerr.titleDelay = 60;
  seerr.set(1, 5, 5);
  await Promise.all([first, center.sync({ seerr, user, force: true }), center.sync({ seerr, user, force: true })]);
  assert.deepEqual(delivered, [['seerr-1-available']]);
});

test('Ausgeschaltet: auch keine Mitteilungen des Systems; wieder eingeschaltet still, danach genau eine', async () => {
  const { center, seerr, delivered } = setup();
  center.setPreferences({ system: true });
  seerr.set(1, 2, 3);
  seerr.set(2, 1, 2);
  await center.sync({ seerr, user, force: true });
  seerr.set(1, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(delivered, [['seerr-1-available']]);
  center.setPreferences({ enabled: false });
  seerr.set(2, 3, 1); // in der ausgeschalteten Zeit abgelehnt
  await center.sync({ seerr, user, force: true });
  center.setPreferences({ enabled: true });
  await center.sync({ seerr, user });
  assert.deepEqual(delivered, [['seerr-1-available']], 'nichts aus der ausgeschalteten Zeit');
  seerr.set(3, 1, 2);
  await center.sync({ seerr, user, force: true });
  seerr.set(3, 2, 3);
  await center.sync({ seerr, user, force: true });
  assert.deepEqual(delivered, [['seerr-1-available'], ['seerr-3-approved']]);
  center.setPreferences({ system: false });
  seerr.set(3, 5, 5);
  await center.sync({ seerr, user, force: true });
  assert.equal(delivered.length, 2, 'Mitteilungen des Systems aus: nur in der App');
  assert.ok(ids(center).includes('seerr-3-available'));
});

test('Profil entfernt, abgemeldet oder Seerr getrennt: alle Mitteilungen des Systems dieses Profils gehen mit', async () => {
  const { center, withdrawn, profiles } = setup();
  center.forget('server|ben');
  center.forget('server|anna', 'https://melden.seerr.test');
  assert.deepEqual(withdrawn, [null, null]);
  assert.deepEqual(profiles, ['server|ben', 'server|anna']);
});

// ---------- Mitteilungen des Systems: Inhalt und Ziel (SystemNotificationTests, Plan P18) ----------

const SeerrState = require('../src/shared/seerr-state');
const systemProfile = 'https://jellyfin.example.net|4f1c2e9a8b7d4c6f';
function systemNote(kind = 'available', seasons = []) {
  const r = { id: 12, status: 5, is4k: false, created: null, mediaType: seasons.length ? 'tv' : 'movie', tmdbId: 1002, mediaStatus: 5, seasons, requesterId: 7, requesterName: 'anna' };
  return N.notificationOf({ kind, request: r }, { title: 'The Silent Tide', posterPath: '/abcdefgh.jpg', date: 1_800_000_000_000 });
}
const message = (n = systemNote(), profile = systemProfile, lang = 'de') => N.systemNotificationOf(n, { profile, hash, lang });

test('Inhalt: Wortlaut der App; Kennung je Profil und Eintrag (dieselbe Nachricht ersetzt sich, die eines anderen Profils bleibt)', () => {
  const m = message();
  assert.equal(m.id, N.systemId('seerr-12-available', systemProfile, hash));
  assert.ok(m.id.endsWith('.seerr-12-available'));
  assert.equal(m.id, message().id);
  assert.notEqual(m.id, message(systemNote(), 'https://jellyfin.example.net|anderer').id);
  assert.ok(!m.id.includes('jellyfin.example.net'));
  assert.equal(m.title, 'Dein angefragter Film ist jetzt verfügbar');
  assert.equal(m.body, '„The Silent Tide“ wurde deiner Mediathek hinzugefügt und kann jetzt abgespielt werden.');
  assert.equal(m.preview, 'Neuigkeit zu einer Anfrage', 'verborgene Inhalte: nur die Art der Nachricht');
  const en = message(systemNote(), systemProfile, 'en-US');
  assert.equal(en.title, 'Your requested movie is now available');
  assert.equal(en.preview, 'News about a request');
});

test('Das Ziel steht in der Mitteilung und kommt beim Antippen unverändert zurück (auch als Text durch die Hülle)', () => {
  const t = N.targetOf(JSON.parse(JSON.stringify(message().target)));
  assert.deepEqual([t.id, t.mediaType, t.tmdbId, t.title, t.posterPath, t.state], ['seerr-12-available', 'movie', 1002, 'The Silent Tide', '/abcdefgh.jpg', 'available']);
  assert.equal(N.targetOf(message(systemNote('approved')).target).state, 'approved');
});

test('In der Mitteilung stehen weder die Adresse des Servers noch die Kennung des Benutzers, nur ein Kennwert des Profils', () => {
  const text = JSON.stringify(message());
  assert.ok(!text.includes('jellyfin.example.net'));
  assert.ok(!text.includes('4f1c2e9a8b7d4c6f'));
  assert.ok(!text.toLowerCase().includes('connect.sid'));
});

test('Antippen gilt nur im Profil der Mitteilung: ein anderes Profil, kein Profil oder ein unlesbares Ziel führen nirgendwohin', () => {
  const t = N.targetOf(message().target);
  assert.equal(N.belongs(t, systemProfile, hash), true);
  assert.equal(N.belongs(t, 'https://jellyfin.example.net|anderer', hash), false);
  assert.equal(N.belongs(t, null, hash), false);
  assert.equal(N.targetOf({}), null);
  assert.equal(N.targetOf(null), null);
  assert.equal(N.targetOf({ id: 'seerr-1-available', mediaType: 'person', tmdbId: 1, title: 't', profile: 'abcdef12' }), null);
  assert.equal(N.targetOf({ id: 'seerr-1-available', mediaType: 'movie', tmdbId: 'keine Zahl', title: 't', profile: 'abcdef12' }), null);
  assert.equal(N.targetOf({ id: 'x', mediaType: 'movie', tmdbId: 1, title: 't', profile: 'abcdef12' }), null, 'fremde Kennung');
  assert.equal(N.targetOf({ id: 'seerr-1-available', mediaType: 'movie', tmdbId: 1, title: 't', profile: 'https://server' }), null, 'eine Adresse ist kein Kennwert');
});

test('Neue Anfrage: die Mitteilung des Systems nennt keinen Benutzer', () => {
  const r = { id: 4, status: 1, is4k: false, created: null, mediaType: 'movie', tmdbId: 1004, mediaStatus: 2, seasons: [], requesterId: 9, requesterName: 'Anna Beispiel' };
  const n = N.notificationOf({ kind: 'newRequest', request: r }, { title: 'Glass Orchard', posterPath: null, date: 1_800_000_000_000 });
  assert.equal(N.message(n, 'de'), 'Anna Beispiel hat „Glass Orchard“ angefragt.');
  const m = message(n);
  assert.equal(m.title, 'Neue Anfrage');
  assert.equal(m.body, '„Glass Orchard“ wurde angefragt.');
  assert.ok(!JSON.stringify(m).includes('Anna'));
});

test('Der Stand der Nachricht reist mit: die Seite beginnt nicht mit „anfragen“', () => {
  for (const [kind, requestable] of [['approved', false], ['failed', false], ['partiallyAvailable', false], ['available', false], ['newRequest', false], ['declined', true]]) {
    const t = N.targetOf(JSON.parse(JSON.stringify(message(systemNote(kind)).target)));
    assert.equal(t.state, N.stateOf(systemNote(kind)), kind);
    assert.equal(SeerrState.isRequestable(N.knownTitle(t).status), requestable, kind);
    assert.equal(SeerrState.isRequestable(N.knownTitle(systemNote(kind)).status), requestable, kind);
  }
  assert.equal(N.knownTitle(systemNote()).status, SeerrState.SEERR_MEDIA.AVAILABLE);
  assert.equal(N.knownTitle(systemNote()).title, 'The Silent Tide');
});
