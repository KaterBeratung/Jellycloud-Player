'use strict';
// Fake-Discord fuer Tests und Szenarien: lauscht auf einer benannten Pipe wie die Discord-App, antwortet auf den Handshake mit READY und auf SET_ACTIVITY wie Discord.
// Nutzung: const fake = await startFakeDiscord(pipeBase + '0'); ... fake.activities, fake.clears ...; await fake.close();
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { OP, FrameParser, encodeFrame } = require('../src/main/discord-ipc');

/** Pfadanfang einer Fake-Pipe (Nummer wird angehaengt, wie bei discord-ipc-N). */
function fakePipeBase(name = `jc-fake-discord-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name);
}

/**
 * @param {string} pipePath voller Pfad der einen Pipe, auf der gelauscht wird
 * @param {{user?:object, validIds?:string[]|null, rejectActivity?:{code:number,message:string}|null, silent?:boolean}} [o]
 *   validIds: nur diese Application-IDs kommen durch (sonst CLOSE 4000 wie bei Discord); rejectActivity: SET_ACTIVITY mit Fehler beantworten; silent: auf den Handshake nicht antworten
 */
async function startFakeDiscord(pipePath, { user = { id: '1234567890', username: 'testnutzer', global_name: 'Test Nutzer' }, validIds = null, rejectActivity = null, silent = false } = {}) {
  const fake = {
    pipePath,
    handshakes: [], // { v, client_id }
    commands: [], // alle FRAME-Befehle { cmd, args, nonce }
    activities: [], // gesetzte Aktivitaeten (args.activity)
    clears: 0, // SET_ACTIVITY ohne Aktivitaet
    pongs: [],
    connections: 0,
    rejectActivity,
    sockets: new Set()
  };
  const server = net.createServer((socket) => {
    fake.connections++;
    fake.sockets.add(socket);
    const parser = new FrameParser();
    socket.on('data', (chunk) => {
      for (const { op, data } of parser.push(chunk)) {
        if (op === OP.HANDSHAKE) {
          fake.handshakes.push(data);
          if (silent) continue;
          if (validIds && !validIds.includes(String(data?.client_id))) {
            socket.end(encodeFrame(OP.CLOSE, { code: 4000, message: 'Invalid Client ID' }));
            continue;
          }
          socket.write(encodeFrame(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1, config: {}, user }, nonce: null }));
        } else if (op === OP.FRAME) {
          fake.commands.push(data);
          if (data?.cmd === 'SET_ACTIVITY') {
            if (fake.rejectActivity) {
              socket.write(encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY', evt: 'ERROR', data: fake.rejectActivity, nonce: data.nonce }));
              continue;
            }
            const activity = data.args?.activity ?? null;
            if (activity) fake.activities.push(activity);
            else fake.clears++;
            socket.write(encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY', data: activity, evt: null, nonce: data.nonce }));
          }
        } else if (op === OP.PONG) fake.pongs.push(data);
        else if (op === OP.CLOSE) socket.end();
      }
    });
    socket.on('close', () => fake.sockets.delete(socket));
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, resolve);
  });
  /** Zuletzt gesetzte Aktivitaet, die noch gilt (null nach einem Entfernen). */
  fake.current = () => {
    const last = [...fake.commands].reverse().find((c) => c?.cmd === 'SET_ACTIVITY' && !fake.rejectActivity);
    return last?.args?.activity ?? null;
  };
  fake.ping = (payload = { n: 1 }) => {
    for (const s of fake.sockets) s.write(encodeFrame(OP.PING, payload));
  };
  /** Verbindungen kappen, als wuerde Discord beendet (die Pipe bleibt bestehen). */
  fake.dropAll = () => {
    for (const s of fake.sockets) s.destroy();
  };
  fake.close = () =>
    new Promise((resolve) => {
      for (const s of fake.sockets) s.destroy();
      server.close(() => resolve());
    });
  return fake;
}

module.exports = { startFakeDiscord, fakePipeBase };
