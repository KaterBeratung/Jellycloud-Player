'use strict';
/**
 * "Auf diesem Geraet fortsetzen" (Plan P19, src/shared/handoff.js und src/shared/remote-channel.js): die 24 Faelle aus JellycloudTests/HandoffRulesTests.swift
 * der Apple-App (welche Sitzungen angeboten werden, wo es weitergeht, Antworten des Servers, Anfragen, Steuerkanal, Einstellung), dazu der Ablauf der
 * Uebernahme (Regeln 9 bis 12 der Referenz) mit gestellten Antworten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/shared/handoff');
const Channel = require('../src/shared/remote-channel');
const { JellyfinClient } = require('../src/shared/jellyfin');
const { ConfigCore, DEFAULT_SETTINGS } = require('../src/shared/config-core');

const now = 1_800_000_000_000;
const stamp = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();
function session(id, { user = 'ich', device = 'tv', name = 'Wohnzimmer Apple TV', type = 'Movie', control = true, ago = 4, ticks = 6_000_000_000, itemId = null } = {}) {
  return H.normalizeSession({
    Id: id,
    UserId: user,
    DeviceId: device,
    DeviceName: name,
    Client: 'Jellycloud',
    SupportsRemoteControl: control,
    NowPlayingItem: type ? { Id: itemId ?? `film-${id}`, Name: `Film ${id}`, Type: type } : null,
    PlayState: { PositionTicks: ticks, IsPaused: false },
    LastActivityDate: stamp(ago)
  });
}
const own = { ownDeviceId: 'hier', ownUserId: 'ich', now };
const offers = (list) => H.offers(list, own).map((s) => s.id);

// ---------- Welche Sitzung wird angeboten ----------

test('Angeboten wird, was auf einem anderen Gerät des eigenen Kontos läuft', () => {
  assert.deepEqual(offers([session('a')]), ['a']);
});

test('Dieses Gerät bietet sich nicht selbst an', () => {
  assert.deepEqual(offers([session('a', { device: 'hier' })]), []);
  assert.equal(H.whyNot(session('a', { device: 'hier' }), own), 'thisDevice');
});

test('Was ein anderes Konto schaut, erscheint nie (auch nicht für Administratoren, denen der Server alle Sitzungen nennt)', () => {
  assert.deepEqual(offers([session('a', { user: 'jemand' })]), []);
  const nameless = session('b', { user: null });
  assert.equal(nameless.userId, null);
  assert.deepEqual(offers([nameless]), []);
  assert.equal(H.whyNot(nameless, own), 'noAccount', 'fehlt das Konto, gilt die Sitzung als fremd');
  assert.equal(H.whyNot(session('a', { user: 'jemand' }), own), 'otherAccount');
  assert.deepEqual(H.ownAccount([session('a', { user: 'jemand' }), session('b')], 'ich').map((s) => s.id), ['b'], 'die Rueckseite gibt fremde nie heraus');
});

test('Nur Sitzungen, die gerade ein Video spielen', () => {
  assert.deepEqual(offers([session('ruht', { type: null }), session('musik', { type: 'Audio' }), session('folge', { type: 'Episode' })]), ['folge']);
});

test('Nur Sitzungen, die den Stopp annehmen: sonst liefe dasselbe auf zwei Geräten', () => {
  assert.deepEqual(offers([session('a', { control: false })]), []);
});

test('Eine Sitzung, die seit über 90 Sekunden schweigt, gilt als vergessen', () => {
  assert.deepEqual(offers([session('frisch', { ago: 89 }), session('still', { ago: 91 })]), ['frisch']);
});

test('Mehrere Angebote: die jüngste Meldung zuerst', () => {
  assert.deepEqual(offers([session('alt', { device: 'pad', ago: 30 }), session('neu', { ago: 2 }), session('mittel', { device: 'mac', ago: 10 })]), ['neu', 'mittel', 'alt']);
});

// ---------- Uebernahme: Entscheidung nach dem frischen Lesen ----------

const step = (fresh, offered) => H.takeoverStep(offered, fresh, own);

test('Spielt das andere Gerät den Titel noch und nimmt den Stopp an, wird es angehalten', () => {
  const offered = session('a');
  assert.deepEqual(step([session('b', { device: 'pad' }), session('a')], offered), { step: 'stop', session: session('a') });
});

test('Ist die Sitzung fort oder spielt sie nichts mehr, geht es hier ohne Stopp an der gemerkten Stelle weiter', () => {
  const offered = session('a');
  assert.deepEqual(step([], offered), { step: 'playLocally' });
  assert.deepEqual(step([session('a', { type: null })], offered), { step: 'playLocally' });
});

test('Spielt das andere Gerät noch, lässt sich aber gerade nicht anhalten, startet hier nichts: sonst liefe es auf zwei Geräten', () => {
  const offered = session('a');
  for (const stuck of [session('a', { control: false }), session('a', { ago: 200 }), session('a', { user: 'jemand' })]) {
    const r = step([stuck], offered);
    assert.equal(r.step, 'refuse');
    assert.equal(r.reason, 'notStoppable');
    assert.equal(r.device, 'Wohnzimmer Apple TV');
  }
});

test('Läuft dort inzwischen ein anderer Titel, startet hier nichts', () => {
  const r = step([session('a', { type: 'Episode', itemId: 'naechste-folge' })], session('a'));
  assert.deepEqual([r.step, r.reason], ['refuse', 'otherItem']);
});

// ---------- Wo es weitergeht ----------

test('Meldet das andere Gerät beim Anhalten seine genaue Stelle, gilt sie', () => {
  assert.equal(H.startTicks({ session: 6_000_000_000, savedBefore: 5_900_000_000, savedAfter: 6_071_000_000 }), 6_071_000_000);
});

test('Kommt keine neue Stelle an, gilt die der Sitzung', () => {
  assert.equal(H.startTicks({ session: 6_000_000_000, savedBefore: 5_900_000_000, savedAfter: null }), 6_000_000_000);
  assert.equal(H.startTicks({ session: 6_000_000_000, savedBefore: 5_900_000_000, savedAfter: 5_900_000_000 }), 6_000_000_000);
  assert.equal(H.startTicks({ session: 6_000_000_000, savedBefore: 6_050_000_000, savedAfter: 6_050_000_000 }), 6_000_000_000, 'eine alte gemerkte Stelle gilt nicht, auch wenn sie vor der Sitzung liegt');
});

test('Nahe Anfang und Ende setzt Jellyfin die gemerkte Stelle auf null: dann gilt die der Sitzung', () => {
  assert.equal(H.startTicks({ session: 300_000_000, savedBefore: null, savedAfter: 0 }), 300_000_000);
  assert.equal(H.startTicks({ session: 6_000_000_000, savedBefore: 5_900_000_000, savedAfter: 0 }), 6_000_000_000);
});

// ---------- Antworten des Servers ----------

test('Zeitangaben des Servers mit Bruchteilen wechselnder Länge', () => {
  const whole = H.date('2026-11-14T20:45:04Z');
  assert.ok(Number.isFinite(whole));
  assert.equal(H.date('2026-11-14T20:45:04.425658Z'), whole);
  assert.equal(H.date('2026-11-14T20:45:04.3058Z'), whole);
  assert.equal(H.date('2026-11-14T20:45:04.1234567+00:00'), whole);
  assert.equal(H.date('2026-11-14T21:45:04+0100'), whole);
  assert.equal(H.date('kein Datum'), null);
  assert.equal(H.date(null), null);
});

test('Eine Sitzung in der Form des echten Servers wird gelesen', () => {
  const json = [
    { PlayState: { PositionTicks: 310000000, CanSeek: true, IsPaused: false, IsMuted: false, PlayMethod: 'DirectPlay', RepeatMode: 'RepeatNone' }, AdditionalUsers: [], Capabilities: { PlayableMediaTypes: ['Video'], SupportedCommands: [], SupportsMediaControl: true }, RemoteEndPoint: '127.0.0.1', PlayableMediaTypes: ['Video'], Id: 'abc123', UserId: 'd3344cfd', UserName: 'demo', Client: 'Jellycloud', LastActivityDate: '2026-11-14T20:45:04.425658Z', DeviceName: 'Alex iPhone', DeviceId: 'geraet-a', ApplicationVersion: '0.3.15', NowPlayingItem: { Name: 'Folge 2', Id: 'ep2', Type: 'Episode', SeriesName: 'Harbor Lights', IndexNumber: 2, ParentIndexNumber: 1, RunTimeTicks: 26000000000 }, IsActive: true, SupportsMediaControl: true, SupportsRemoteControl: true, HasCustomDeviceName: false, ServerId: 's1' },
    { Id: 'ohne', DeviceId: 'x', LastActivityDate: '2026-11-14T18:20:47.542712Z', SupportsRemoteControl: false }
  ];
  const sessions = H.sessionsOf(json);
  const first = sessions[0];
  assert.ok(first.id === 'abc123' && first.userId === 'd3344cfd' && first.deviceId === 'geraet-a');
  assert.equal(first.supportsRemoteControl, true);
  assert.equal(first.positionTicks / H.TICKS_PER_SECOND, 31);
  assert.equal(H.titleLine(first, 'de'), 'Harbor Lights · S1 · F2');
  assert.equal(H.titleLine(first, 'en'), 'Harbor Lights · S1 · E2');
  assert.equal(H.deviceKind(first), 'phone');
  assert.ok(first.lastActivity !== null);
  assert.equal(sessions[1].nowPlaying, null);
});

test('Die Art des Geräts aus Namen und Programm', () => {
  assert.equal(H.deviceKind(session('a', { name: 'Wohnzimmer Apple TV' })), 'tv');
  assert.equal(H.deviceKind(session('a', { name: 'iPad Air' })), 'tablet');
  assert.equal(H.deviceKind(session('a', { name: 'MacBook Pro' })), 'computer');
  assert.equal(H.deviceKind(session('a', { name: 'Schlafzimmer' })), 'unknown');
});

// ---------- Anfragen ----------

function stubFetch(answer) {
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push({ url: new URL(url), method: init.method ?? 'GET', headers: init.headers ?? {} });
    const { status = 200, body = null } = answer(new URL(url), init);
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, sent };
}

test('Die Abfrage nennt das eigene Konto; der Stopp geht an genau die gewählte Sitzung', async () => {
  const { fetch, sent } = stubFetch((u) => (u.pathname === '/Sessions' ? { body: [{ Id: 'abc', UserId: 'ich', DeviceId: 'tv' }] } : { status: 204 }));
  const client = new JellyfinClient({ baseUrl: 'https://handoff.jellyfin.test', token: 't', userId: 'ich', deviceId: 'hier', fetch });
  const sessions = H.sessionsOf(await client.remoteSessions());
  assert.deepEqual(sessions.map((s) => s.id), ['abc']);
  await client.stopRemotePlayback('abc');
  assert.equal(sent[0].url.searchParams.get('ControllableByUserId'), 'ich');
  assert.equal(sent[0].url.searchParams.get('ActiveWithinSeconds'), '90');
  assert.ok(sent.at(-1).method === 'POST' && sent.at(-1).url.pathname === '/Sessions/abc/Playing/Stop');
  assert.ok(sent.every((s) => /Client="Jellycloud"/.test(s.headers.Authorization)), 'Programmname wie bei allen Jellycloud-Apps (K10)');
});

test('Eine einzelne unlesbare Sitzung kostet nicht die ganze Antwort', async () => {
  const { fetch } = stubFetch(() => ({ body: [{ Id: 'gut', UserId: 'ich', DeviceId: 'tv' }, { UserId: 'ich' }, { Id: 7 }] }));
  const client = new JellyfinClient({ baseUrl: 'https://lossy.jellyfin.test', token: 't', userId: 'ich', deviceId: 'hier', fetch });
  assert.deepEqual(H.sessionsOf(await client.remoteSessions()).map((s) => s.id), ['gut']);
});

test('Ohne angemeldetes Konto wird nicht gefragt', async () => {
  const { fetch, sent } = stubFetch(() => ({ body: [] }));
  const client = new JellyfinClient({ baseUrl: 'https://anon.jellyfin.test', token: null, userId: null, deviceId: 'hier', fetch });
  assert.deepEqual(await client.remoteSessions(), []);
  assert.equal(sent.length, 0);
});

// ---------- Steuerkanal ----------

test('Der Steuerkanal: ws oder wss zur Adresse des Servers, nur die Gerätekennung in der Adresse (das Token im Kopf, nie in der Adresse)', () => {
  assert.equal(Channel.channelUrl('http://10.0.0.5:8096', 'hier'), 'ws://10.0.0.5:8096/socket?deviceId=hier');
  assert.equal(Channel.channelUrl('https://medien.example.test/jellyfin/', 'hier'), 'wss://medien.example.test/jellyfin/socket?deviceId=hier');
  assert.equal(Channel.channelUrl('kein Server', 'hier'), null);
  const client = new JellyfinClient({ baseUrl: 'http://10.0.0.5:8096', token: 'geheim-123', userId: 'ich', deviceId: 'hier' });
  assert.ok(!Channel.channelUrl(client.baseUrl, client.deviceId).includes('geheim'));
  assert.ok(client.authHeader().includes('Token="geheim-123"'));
});

test('Nachrichten des Servers: Stopp, Pause, Lebenszeichen; alles andere wird übergangen', () => {
  const stop = '{"MessageId":"1ec82cd9c15b481c8eb0d8557260ff77","Data":{"Command":"Stop","ControllingUserId":"d3344cfdac3e40b5a8b8446f64ef53a4"},"MessageType":"Playstate"}';
  assert.deepEqual(Channel.parse(stop), { type: 'command', command: 'Stop' });
  assert.deepEqual(Channel.parse('{"MessageType":"Playstate","Data":{"Command":"Pause"}}'), { type: 'command', command: 'Pause' });
  assert.deepEqual(Channel.parse('{"MessageType":"Playstate","Data":{"Command":"Seek","SeekPositionTicks":5}}'), { type: 'other' });
  assert.deepEqual(Channel.parse('{"MessageType":"ForceKeepAlive","Data":60}'), { type: 'keepAlive', seconds: 60 });
  assert.deepEqual(Channel.parse('{"MessageType":"ForceKeepAlive","Data":4}'), { type: 'keepAlive', seconds: 10 }, 'mindestens 10 s');
  assert.deepEqual(Channel.parse('{"MessageType":"Play","Data":{"ItemIds":["x"],"PlayCommand":"PlayNow"}}'), { type: 'other' });
  assert.deepEqual(Channel.parse('kein JSON'), { type: 'other' });
  assert.deepEqual(Channel.parse('[1,2]'), { type: 'other' });
});

test('Neue Verbindungsversuche des Steuerkanals werden seltener, höchstens einmal in der Minute', () => {
  const d = Channel.RETRY_DELAYS_MS;
  assert.ok(d[0] === 5000 && d.at(-1) === 60000);
  assert.ok(d.every((v, i) => i === 0 || v > d[i - 1]));
  assert.equal(Channel.retryDelay(0), 5000, 'stand eine Verbindung, beginnt die Folge von vorn');
  assert.equal(Channel.retryDelay(99), 60000);
});

// ---------- Einstellung ----------

test('Die Anzeige ist eingeschaltet, lässt sich ausschalten und bleibt gespeichert; ältere Einstellungen ohne den Schalter lesen sich als an', () => {
  assert.equal(DEFAULT_SETTINGS.player.showHandoff, true);
  const env = { uuid: () => 'dev-1', hashId: (t) => require('node:crypto').createHash('sha1').update(t).digest('hex').slice(0, 12) };
  const codec = { encode: (s) => `plain:${s}`, decode: (s) => s.slice(6) };
  const store = { text: null };
  const io = { read: () => store.text, write: (t) => (store.text = t) };
  const c = new ConfigCore(io, codec, env);
  assert.equal(c.settings.player.showHandoff, true);
  c.updateSettings({ player: { showHandoff: false } });
  assert.equal(new ConfigCore(io, codec, env).settings.player.showHandoff, false);
  const old = JSON.parse(store.text);
  delete old.settings.player.showHandoff;
  store.text = JSON.stringify(old);
  assert.equal(new ConfigCore(io, codec, env).settings.player.showHandoff, true);
  c.updateSettings({ player: { showHandoff: 'ja' } });
  assert.equal(typeof new ConfigCore(io, codec, env).settings.player.showHandoff, 'boolean', 'ein falscher Typ wird nicht gespeichert');
});

// ---------- Ablauf der Uebernahme (Regeln 9 bis 12) ----------

/** Gestellter Server fuer die Uebernahme: Eintrag (gemerkte Stelle vor/nach dem Stopp), frische Sitzungen, Stopp; schreibt die Reihenfolge mit. */
function stage({ before = 5_900_000_000, after = 6_071_000_000, afterDelayMs = 0, fresh = () => [session('a')], item = null, stopFails = false, wanted = () => true } = {}) {
  const calls = [];
  let stopped = 0;
  let clock = now;
  const d = {
    offered: session('a'),
    own,
    item: async (id, timeout) => {
      calls.push(`item ${timeout}`);
      if (item) return item(id);
      const saved = stopped && clock - stopped >= afterDelayMs ? after : before;
      return { positionTicks: saved, playable: true };
    },
    sessions: async () => {
      calls.push('sessions');
      return fresh();
    },
    stop: async (id) => {
      calls.push(`stop ${id}`);
      if (stopFails) throw Object.assign(new Error('HTTP 500'), { status: 500 });
      stopped = clock;
    },
    stillWanted: () => wanted(calls),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock
  };
  return { d, calls };
}

test('Ablauf: Eintrag prüfen, frisch lesen, Stopp, genaue Stelle; Start an der gemeldeten Stelle', async () => {
  const { d, calls } = stage();
  const r = await H.takeOver(d);
  assert.deepEqual(r, { action: 'play', itemId: 'film-a', startTicks: 6_071_000_000 });
  assert.deepEqual(calls.slice(0, 3), [`item ${H.TIMEOUT_MS}`, 'sessions', 'stop a'], 'erst pruefen, dass hier etwas anlaufen kann, dann anhalten');
  assert.ok(calls.slice(3).every((c) => c.startsWith('item ')) && calls.length === 4, 'die naechste Lesung bringt die neue Stelle');
});

test('Kommt nach dem Stopp keine neue Stelle (höchstens 1,5 s, alle 150 ms), gilt die der Sitzung', async () => {
  const { d, calls } = stage({ after: 5_900_000_000 });
  const r = await H.takeOver(d);
  assert.equal(r.startTicks, 6_000_000_000);
  const polls = calls.filter((c, i) => i > 2 && c.startsWith('item '));
  assert.equal(polls.length, H.POSITION_WAIT_MS / H.POSITION_STEP_MS);
  assert.ok(polls.every((c) => Number(c.split(' ')[1]) <= H.POSITION_WAIT_MS), 'Zeitgrenze je Anfrage hoechstens 1,5 s');
});

test('Fehler vor dem Stopp: die Quelle läuft weiter (kein Stopp), der Grund steht da', async () => {
  const cases = [
    [{ item: async () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); } }, 'notAvailable'],
    [{ item: async () => { throw Object.assign(new Error('Netzwerkfehler'), { code: 'OFFLINE', status: 0 }); } }, 'offline'],
    [{ item: async () => ({ positionTicks: null, playable: false }) }, 'notPlayable'],
    [{ fresh: () => { throw new Error('weg'); } }, 'offline'],
    [{ fresh: () => [session('a', { itemId: 'anderer-film' })] }, 'otherItem'],
    [{ fresh: () => [session('a', { control: false })] }, 'notStoppable']
  ];
  for (const [over, reason] of cases) {
    const { d, calls } = stage(over);
    const r = await H.takeOver(d);
    assert.deepEqual([r.action, r.reason], ['fail', reason], reason);
    assert.ok(!calls.some((c) => c.startsWith('stop')), `${reason}: kein Stopp`);
  }
});

test('Scheitert der Stopp, startet hier nichts', async () => {
  const { d } = stage({ stopFails: true });
  const r = await H.takeOver(d);
  assert.deepEqual([r.action, r.reason, r.device], ['fail', 'stopFailed', 'Wohnzimmer Apple TV']);
});

test('Ist die Sitzung inzwischen fort, geht es ohne Stopp an der gemerkten Stelle weiter', async () => {
  const { d, calls } = stage({ fresh: () => [] });
  assert.deepEqual(await H.takeOver(d), { action: 'play', itemId: 'film-a', startTicks: null });
  assert.ok(!calls.some((c) => c.startsWith('stop')));
});

test('Nach jedem Warten wird geprüft, ob die Übernahme noch gilt: vor dem Stopp nichts angehalten, danach nichts gestartet', async () => {
  // gilt nach dem Pruefen des Eintrags nicht mehr: kein Stopp
  let s = stage({ wanted: (calls) => calls.length < 1 });
  assert.deepEqual(await H.takeOver(s.d), { action: 'abort' });
  assert.deepEqual(s.calls, [`item ${H.TIMEOUT_MS}`], 'endet sofort: weder frisch gelesen noch angehalten');
  // gilt nach dem frischen Lesen nicht mehr: kein Stopp
  s = stage({ wanted: (calls) => !calls.includes('sessions') });
  assert.deepEqual(await H.takeOver(s.d), { action: 'abort' });
  assert.ok(!s.calls.some((c) => c.startsWith('stop')));
  // gilt nach dem Stopp nicht mehr: angehalten, aber hier startet nichts (der Titel steht unter "Weiterschauen")
  s = stage({ wanted: (calls) => !calls.some((c) => c.startsWith('stop')) });
  assert.deepEqual(await H.takeOver(s.d), { action: 'abort' });
  assert.equal(s.calls.at(-1), 'stop a', 'angehalten, danach nichts mehr gelesen');
});

// ---------- Build 98 der Apple-App: Laeuft gerade und Fernbedienung (Regeln 13 bis 21) ----------

test('Laeuft gerade: jede Sitzung mit Eintrag ausser diesem Geraet, hoechstens 16 Minuten still, die juengste zuerst; fremde Konten nennt der Server', () => {
  const list = [
    session('alt', { ago: 900 }),
    session('frisch', { ago: 2, user: 'lena', device: 'lena-tv', control: false }),
    session('hier', { device: 'mein-pc' }),
    session('leer', { type: null }),
    session('weg', { ago: 961 }),
    session('musik', { type: 'Audio', device: 'box' })
  ];
  const ids = H.streams(list, { ownDeviceId: 'mein-pc', now }).map((s) => s.id);
  assert.deepEqual(ids, ['frisch', 'musik', 'alt'], 'auch Musik (jede Sitzung mit Eintrag), die juengste Meldung zuerst');
  assert.ok(ids.includes('frisch') && ids.includes('alt'), 'fremdes Konto und 15 Minuten alt: dabei');
  assert.ok(!ids.includes('hier') && !ids.includes('leer') && !ids.includes('weg'), 'dieses Geraet, ohne Eintrag, zu alt: nicht');
  assert.equal(ids[0], 'frisch', 'die juengste zuerst');
});

test('Fernbedienung: Pause oder Unpause nach dem gezeigten Stand, nie PlayPause', () => {
  assert.equal(H.toggleCommand(false), 'Pause');
  assert.equal(H.toggleCommand(true), 'Unpause');
});

test('Fernbedienung: der erwartete Stand gilt hoechstens 12 s gegen die Abfrage, bis der Server ihn meldet', () => {
  const s = session('a');
  const exp = { sessionId: 'a', paused: true, at: now };
  assert.deepEqual(H.shownPaused(s, exp, now + 5000), { paused: true, expected: exp }, 'Server meldet noch "laeuft": der erwartete Stand');
  assert.deepEqual(H.shownPaused({ ...s, isPaused: true }, exp, now + 6000), { paused: true, expected: null }, 'eingetroffen: die Erwartung faellt weg');
  assert.deepEqual(H.shownPaused(s, exp, now + H.EXPECT_MS), { paused: false, expected: null }, 'nach 12 s gilt allein der Server');
  assert.deepEqual(H.shownPaused(s, { ...exp, sessionId: 'b' }, now), { paused: false, expected: { ...exp, sessionId: 'b' } }, 'eine andere Sitzung: unberuehrt');
  assert.deepEqual(H.shownPaused(s, null, now), { paused: false, expected: null });
});

test('Stelle in der Anzeige: laufend hoechstens 12 s ueber die Meldung, nie ueber die Laenge; pausiert steht sie', () => {
  const s = { ...session('a', { ticks: 600 * 1e7, ago: 0 }), nowPlaying: { ...session('a').nowPlaying, runTimeTicks: 610 * 1e7 } };
  assert.equal(H.livePositionTicks(s, { now: now + 5000 }), 605 * 1e7);
  assert.equal(H.livePositionTicks(s, { now: now + 60000 }), 610 * 1e7, 'nie ueber die Laenge');
  const long = { ...s, nowPlaying: { ...s.nowPlaying, runTimeTicks: 7200 * 1e7 } };
  assert.equal(H.livePositionTicks(long, { now: now + 60000 }), 612 * 1e7, 'hoechstens 12 s');
  assert.equal(H.livePositionTicks(long, { paused: true, now: now + 60000 }), 600 * 1e7, 'pausiert');
  assert.equal(H.clock(891 * 1e7), '14:51');
  assert.equal(H.clock(3725 * 1e7), '1:02:05');
});

test('Titel und Folge: "Serie" und "S1 · F3 · Name" (englisch E3), Film nur der Titel', () => {
  const ep = H.normalizeSession({ Id: 'x', NowPlayingItem: { Id: 'e', Type: 'Episode', Name: 'Pilot', SeriesName: 'Harbor', ParentIndexNumber: 1, IndexNumber: 3 } });
  assert.deepEqual(H.itemLines(ep, 'de'), { title: 'Harbor', episode: 'S1 · F3 · Pilot' });
  assert.deepEqual(H.itemLines(ep, 'en-US'), { title: 'Harbor', episode: 'S1 · E3 · Pilot' });
  assert.deepEqual(H.itemLines(session('f'), 'de'), { title: 'Film f', episode: null });
});

test('Bildfelder des laufenden Eintrags: nur Kennungen und Bildkennungen, Laenge und Kontoname gelesen', () => {
  const s = H.normalizeSession({
    Id: 'x',
    UserName: 'lena',
    NowPlayingItem: { Id: 'e1', Type: 'Episode', RunTimeTicks: 123, ImageTags: { Primary: 'abc', 'bö se': 'x' }, ParentBackdropItemId: 'ser', ParentBackdropImageTags: ['t1', '<script>'], Overview: 'lang' }
  });
  assert.equal(s.userName, 'lena');
  assert.equal(s.nowPlaying.runTimeTicks, 123);
  assert.deepEqual(s.nowPlaying.art.ImageTags, { Primary: 'abc' });
  assert.deepEqual(s.nowPlaying.art.ParentBackdropImageTags, ['t1']);
  assert.equal(s.nowPlaying.art.Id, 'e1');
  assert.equal(s.nowPlaying.art.Overview, undefined);
});
