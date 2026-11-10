'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscordIpc, DiscordError, FrameParser, encodeFrame, pipePath, isBadId, OP } = require('../src/main/discord-ipc');
const { startFakeDiscord, fakePipeBase } = require('./fake-discord');

const ID = '123456789012345678';

test('Pfade der Pipes: Windows benannte Pipe, sonst Socket im Laufzeitordner', () => {
  assert.equal(pipePath(0, 'win32'), '\\\\?\\pipe\\discord-ipc-0');
  assert.equal(pipePath(7, 'win32'), '\\\\?\\pipe\\discord-ipc-7');
  assert.equal(pipePath(1, 'linux', { XDG_RUNTIME_DIR: '/run/user/1000/' }), '/run/user/1000/discord-ipc-1');
  assert.equal(pipePath(0, 'darwin', {}), '/tmp/discord-ipc-0');
});

test('Pakete: Kopf aus Opcode und Laenge (Little Endian), Zerstueckelung und mehrere Pakete in einem Block', () => {
  const a = encodeFrame(OP.FRAME, { cmd: 'X', n: 1 });
  assert.equal(a.readUInt32LE(0), 1);
  assert.equal(a.readUInt32LE(4), a.length - 8);
  const b = encodeFrame(OP.PING, { t: 'ä' }); // Umlaut: Laenge zaehlt Bytes, nicht Zeichen
  assert.equal(b.readUInt32LE(4), Buffer.byteLength(JSON.stringify({ t: 'ä' })));
  const p = new FrameParser();
  const all = Buffer.concat([a, b]);
  const got = [];
  for (let i = 0; i < all.length; i += 3) got.push(...p.push(all.subarray(i, i + 3))); // in 3-Byte-Haeppchen
  assert.equal(got.length, 2);
  assert.deepEqual(got[0], { op: 1, data: { cmd: 'X', n: 1 } });
  assert.deepEqual(got[1], { op: 3, data: { t: 'ä' } });
  assert.equal(new FrameParser().push(all).length, 2, 'auch beide auf einmal');
});

test('Pakete: kaputtes JSON gibt data = null, ein riesiges Paket wird abgewiesen', () => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(1, 0);
  head.writeUInt32LE(3, 4);
  assert.deepEqual(new FrameParser().push(Buffer.concat([head, Buffer.from('{x}')])), [{ op: 1, data: null }]);
  const huge = Buffer.alloc(8);
  huge.writeUInt32LE(1, 0);
  huge.writeUInt32LE(50 * 1024 * 1024, 4);
  assert.throws(() => new FrameParser().push(huge), (e) => e instanceof DiscordError && e.kind === 'protocol');
});

test('Verbinden: Handshake mit der Application-ID, READY liefert das angemeldete Konto', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  const user = await ipc.open();
  assert.deepEqual(fake.handshakes, [{ v: 1, client_id: ID }]);
  assert.equal(user.username, 'testnutzer');
  assert.equal(user.globalName, 'Test Nutzer');
  assert.equal(ipc.connected, true);
  ipc.close();
  await fake.close();
});

test('Verbinden: fehlende Pipes werden uebersprungen (Discord belegt nicht immer Nummer 0)', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}3`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  assert.equal(fake.connections, 1);
  ipc.close();
  await fake.close();
});

test('Verbinden: ohne Discord (keine Pipe) kommt "no-discord"', async () => {
  const base = fakePipeBase();
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await assert.rejects(() => ipc.open(), (e) => e instanceof DiscordError && e.kind === 'no-discord');
  assert.equal(ipc.connected, false);
});

test('Verbinden: unbekannte Application-ID (CLOSE 4000) kommt als "bad-id", ohne alle Pipes durchzuprobieren', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`, { validIds: ['999999999999999999'] });
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await assert.rejects(() => ipc.open(), (e) => e.kind === 'bad-id' && e.code === 4000);
  await fake.close();
});

test('Verbinden: antwortet die Pipe nicht (kein READY), kommt eine Zeitueberschreitung statt ewigem Warten', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`, { silent: true });
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}`, timeoutMs: 150 });
  await assert.rejects(() => ipc.open(), (e) => e.kind === 'no-discord', 'danach sind alle Nummern durch: Discord laeuft nicht (richtig)');
  await fake.close();
});

test('Aktivitaet setzen und entfernen: SET_ACTIVITY mit pid und nonce, ohne Aktivitaet beim Entfernen', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}`, pid: 4242 });
  await ipc.open();
  const activity = { type: 3, details: 'Paper Moons', state: '2021', timestamps: { start: 1000, end: 2000 } };
  await ipc.setActivity(activity);
  assert.deepEqual(fake.activities, [activity]);
  const cmd = fake.commands[0];
  assert.equal(cmd.cmd, 'SET_ACTIVITY');
  assert.equal(cmd.args.pid, 4242);
  assert.match(cmd.nonce, /^[0-9a-f-]{36}$/);
  await ipc.clearActivity();
  assert.equal(fake.clears, 1);
  assert.equal('activity' in fake.commands[1].args, false, 'ohne Aktivitaet gesendet');
  assert.equal(fake.current(), null);
  ipc.close();
  await fake.close();
});

test('Mehrere Befehle gleichzeitig: jede Antwort geht an ihren Befehl (nonce)', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  const [a, b, c] = await Promise.all([ipc.setActivity({ details: 'AA' }), ipc.setActivity({ details: 'BB' }), ipc.clearActivity()]);
  assert.equal(a.details, 'AA');
  assert.equal(b.details, 'BB');
  assert.equal(c, null);
  ipc.close();
  await fake.close();
});

test('Fehlerantwort von Discord: der Befehl scheitert mit Meldung und Code, die Verbindung bleibt', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`, { rejectActivity: { code: 4000, message: 'Invalid payload' } });
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  await assert.rejects(() => ipc.setActivity({ details: 'x' }), (e) => e instanceof DiscordError && /Invalid payload/.test(e.message));
  assert.equal(ipc.connected, true);
  ipc.close();
  await fake.close();
});

test('PING von Discord wird mit PONG und denselben Daten beantwortet', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  fake.ping({ n: 7 });
  const end = Date.now() + 2000;
  while (!fake.pongs.length && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(fake.pongs, [{ n: 7 }]);
  ipc.close();
  await fake.close();
});

test('Discord wird beendet: "close" wird gemeldet, offene Befehle scheitern, weitere Befehle auch', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  const closed = new Promise((resolve) => ipc.once('close', resolve));
  fake.dropAll();
  const err = await closed;
  assert.ok(err instanceof DiscordError && err.kind === 'closed');
  assert.equal(ipc.connected, false);
  await assert.rejects(() => ipc.setActivity({ details: 'x' }), (e) => e.kind === 'closed');
  await fake.close();
});

test('Selbst beendet: close() schickt CLOSE, meldet kein "close" (kein Fehler) und laesst sich wiederholen', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`);
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  let closedEvents = 0;
  ipc.on('close', () => closedEvents++);
  ipc.close();
  ipc.close();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(closedEvents, 0);
  assert.equal(ipc.connected, false);
  await fake.close();
});


test('Falsche ID erkennen: "Invalid Client ID" und Code 4006/4007, beim Schliessen auch 4000; ein Fehler 4000 ist nur "Invalid payload"', () => {
  assert.equal(isBadId(4000, 'Invalid Client ID', { closeFrame: true }), true);
  assert.equal(isBadId(4000, 'irgendwas', { closeFrame: true }), true, 'CLOSE 4000 = ungueltige ID');
  assert.equal(isBadId(4000, 'Invalid payload'), false, 'als Fehlerantwort ist 4000 eine ungueltige Aktivitaet');
  assert.equal(isBadId(4006, ''), true);
  assert.equal(isBadId(4007, ''), true);
  assert.equal(isBadId(0, 'invalid client id'), true, 'auch ohne Code, Gross-/Kleinschreibung egal');
  assert.equal(isBadId(5000, 'OAuth2 error'), false);
});

test('Fehlerart bei Befehlen: ungueltige Aktivitaet (4000) ist "rejected", eine abgelehnte ID (4006) "bad-id"', async () => {
  const base = fakePipeBase();
  const fake = await startFakeDiscord(`${base}0`, { rejectActivity: { code: 4000, message: 'Invalid payload' } });
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `${base}${i}` });
  await ipc.open();
  await assert.rejects(() => ipc.setActivity({ details: 'x' }), (e) => e.kind === 'rejected' && e.code === 4000);
  fake.rejectActivity = { code: 4006, message: 'Invalid Client ID' };
  await assert.rejects(() => ipc.setActivity({ details: 'x' }), (e) => e.kind === 'bad-id');
  ipc.close();
  await fake.close();
});

test('Windows: die Pipe unter dem Namen "\\\\?\\pipe\\discord-ipc-N" (so heisst sie bei Discord) laesst sich mit node:net erreichen', { skip: process.platform !== 'win32' }, async () => {
  const name = `jc-fake-discord-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`;
  const fake = await startFakeDiscord(`\\\\.\\pipe\\${name}2`); // lauschen: \\.\pipe\...
  const ipc = new DiscordIpc({ clientId: ID, pathFor: (i) => `\\\\?\\pipe\\${name}${i}` }); // verbinden wie bei Discord: \\?\pipe\...
  await ipc.open();
  assert.equal(ipc.connected, true);
  ipc.close();
  await fake.close();
});