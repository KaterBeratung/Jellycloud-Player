'use strict';

const net = require('node:net');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

/**
 * Minimaler Client fuer die lokale Schnittstelle des Discord-Programms (IPC, "Rich Presence"): Discord legt unter Windows benannte Pipes
 * `\\?\pipe\discord-ipc-0` bis `-9` an. Jedes Paket besteht aus einem Kopf mit zwei 32-Bit-Zahlen (Little Endian: Opcode, Laenge des JSON-Texts) und dem JSON-Text.
 * Ablauf: verbinden, HANDSHAKE mit der Application-ID senden, READY abwarten, dann SET_ACTIVITY. Ohne Abhaengigkeiten (nur node:net), damit er sich
 * ohne Discord mit einer Fake-Pipe testen laesst (test/fake-discord.js).
 */

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MAX_PAYLOAD = 1024 * 1024; // ein vernuenftiges Paket ist weit kleiner; wer mehr schickt, ist kein Discord
const PIPE_COUNT = 10;

/**
 * Fehler mit Art, damit die Oberflaeche den Grund benennen kann:
 *   no-discord  keine Pipe erreichbar (Discord laeuft nicht)
 *   bad-id      Discord kennt die Application-ID nicht
 *   rejected    Discord hat den Befehl mit einer Fehlermeldung abgelehnt
 *   closed      Verbindung beendet (Discord geschlossen oder neu gestartet)
 *   timeout     keine Antwort
 *   protocol    unerwartete Daten
 */
class DiscordError extends Error {
  constructor(message, { kind = 'error', code = 0 } = {}) {
    super(message);
    this.name = 'DiscordError';
    this.kind = kind;
    this.code = code;
  }
}

/**
 * Meldet Discord eine unbekannte Application-ID? Beim Verbinden kommt das als CLOSE mit Code 4000 und "Invalid Client ID"; als Fehlerantwort (ERROR) heisst der Code 4006 bzw. 4007.
 * Ein ERROR mit Code 4000 ist dagegen "Invalid payload" (die Aktivitaet ist ungueltig), keine falsche ID.
 */
function isBadId(code, message, { closeFrame = false } = {}) {
  return /invalid client/i.test(String(message ?? '')) || code === 4006 || code === 4007 || (closeFrame && code === 4000);
}

/** Pfad der Pipe bzw. des Sockets Nummer i (0 bis 9). */
function pipePath(i, platform = process.platform, env = process.env) {
  if (platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  return `${dir.replace(/\/+$/, '')}/discord-ipc-${i}`;
}

function encodeFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? {}), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Setzt Pakete aus beliebig zerstueckelten Datenbloecken zusammen. */
class FrameParser {
  constructor() {
    this.buf = Buffer.alloc(0);
  }

  /** @returns {{op:number, data:any}[]} die vollstaendigen Pakete (data = null, wenn der Text kein JSON war) */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(4);
      if (len > MAX_PAYLOAD) throw new DiscordError('Unerwartet grosses Paket von Discord', { kind: 'protocol' });
      if (this.buf.length < 8 + len) break;
      const text = this.buf.subarray(8, 8 + len).toString('utf8');
      this.buf = this.buf.subarray(8 + len);
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* kein JSON: data bleibt null */
      }
      out.push({ op, data });
    }
    return out;
  }
}

class DiscordIpc extends EventEmitter {
  /**
   * @param {{clientId:string, pathFor?:(i:number)=>string, connect?:(path:string)=>net.Socket, pid?:number, timeoutMs?:number, dialTimeoutMs?:number}} o
   */
  constructor({ clientId, pathFor = pipePath, connect = (p) => net.connect(p), pid = process.pid, timeoutMs = 5000, dialTimeoutMs = 1500 }) {
    super();
    this.clientId = String(clientId);
    this.pathFor = pathFor;
    this.connectFn = connect;
    this.pid = pid;
    this.timeoutMs = timeoutMs;
    this.dialTimeoutMs = dialTimeoutMs;
    this.socket = null;
    this.parser = null;
    this.user = null; // Konto, mit dem Discord angemeldet ist (aus READY)
    this.ready = false;
    this.pending = new Map(); // nonce -> { resolve, reject, timer }
    this._handshake = null; // { resolve, reject, timer } waehrend des Verbindens
    this._closing = false;
  }

  get connected() {
    return this.ready && !!this.socket && !this.socket.destroyed;
  }

  /** Verbindet mit dem ersten Discord, das antwortet (Pipe 0 bis 9). @returns {Promise<{id?:string, username?:string, globalName?:string}|null>} das angemeldete Konto */
  async open() {
    for (let i = 0; i < PIPE_COUNT; i++) {
      let socket;
      try {
        socket = await this._dial(this.pathFor(i));
      } catch {
        continue; // diese Nummer gibt es nicht (oder gehoert niemandem): die naechste
      }
      try {
        return await this._start(socket);
      } catch (e) {
        socket.destroy();
        this.socket = null;
        // Eine falsche Application-ID gilt fuer jede Pipe, hier hilft kein Weitersuchen; sonst (Pipe ohne Antwort, abgebrochen) die naechste Nummer
        if (e.kind === 'bad-id' || e.kind === 'rejected') throw e;
      }
    }
    throw new DiscordError('Discord ist nicht erreichbar. Laeuft die Discord-App auf diesem Rechner?', { kind: 'no-discord' });
  }

  _dial(path) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => {
        socket?.destroy();
        done(reject, new DiscordError('Zeitueberschreitung beim Verbinden', { kind: 'timeout' }));
      }, this.dialTimeoutMs);
      try {
        socket = this.connectFn(path);
      } catch (e) {
        return done(reject, e);
      }
      socket.once('error', (e) => done(reject, e));
      socket.once('connect', () => {
        socket.removeAllListeners('error');
        done(resolve, socket);
      });
    });
  }

  _start(socket) {
    this.socket = socket;
    this.parser = new FrameParser();
    this.ready = false;
    this._closing = false;
    socket.on('data', (chunk) => {
      let frames;
      try {
        frames = this.parser.push(chunk);
      } catch (e) {
        this._fail(e);
        return;
      }
      for (const f of frames) this._onFrame(f);
    });
    socket.on('error', (e) => this._fail(new DiscordError(`Verbindung zu Discord gestoert: ${e.message}`, { kind: 'closed' })));
    socket.on('close', () => this._fail(new DiscordError('Die Verbindung zu Discord wurde beendet', { kind: 'closed' })));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this._fail(new DiscordError('Discord antwortet nicht', { kind: 'timeout' })), this.timeoutMs);
      this._handshake = { resolve, reject, timer };
      socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
  }

  _onFrame({ op, data }) {
    if (op === OP.PING) {
      this.socket?.write(encodeFrame(OP.PONG, data));
      return;
    }
    if (op === OP.PONG) return;
    if (op === OP.CLOSE) {
      const code = Number(data?.code) || 0;
      const message = String(data?.message ?? 'Discord hat die Verbindung beendet');
      this._fail(new DiscordError(message, { kind: isBadId(code, message, { closeFrame: true }) ? 'bad-id' : 'closed', code }));
      return;
    }
    if (!data || typeof data !== 'object') return;
    // Antwort auf das Verbinden
    if (this._handshake) {
      if (data.evt === 'READY') {
        const h = this._handshake;
        this._handshake = null;
        clearTimeout(h.timer);
        this.ready = true;
        const u = data.data?.user;
        this.user = u && typeof u === 'object' ? { id: String(u.id ?? ''), username: String(u.username ?? ''), globalName: u.global_name ? String(u.global_name) : '' } : null;
        h.resolve(this.user);
      } else if (data.evt === 'ERROR') {
        const code = Number(data.data?.code) || 0;
        const message = String(data.data?.message ?? 'Discord lehnt die Verbindung ab');
        this._fail(new DiscordError(message, { kind: isBadId(code, message) ? 'bad-id' : 'rejected', code }));
      }
      return;
    }
    // Antwort auf einen Befehl (gleiche nonce)
    const p = data.nonce ? this.pending.get(data.nonce) : null;
    if (!p) return;
    this.pending.delete(data.nonce);
    clearTimeout(p.timer);
    if (data.evt === 'ERROR') {
      const code = Number(data.data?.code) || 0;
      const message = String(data.data?.message ?? 'Discord hat den Befehl abgelehnt');
      p.reject(new DiscordError(message, { kind: isBadId(code, message) ? 'bad-id' : 'rejected', code }));
    } else p.resolve(data.data ?? null);
  }

  /** Beendet alles Wartende mit dem Fehler und meldet das Ende der Verbindung (einmal). */
  _fail(err) {
    const wasReady = this.ready;
    const h = this._handshake;
    this._handshake = null;
    if (h) {
      clearTimeout(h.timer);
      h.reject(err);
    }
    for (const [nonce, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(nonce);
    }
    this.ready = false;
    const s = this.socket;
    this.socket = null;
    if (s && !s.destroyed) s.destroy();
    if (wasReady && !this._closing) this.emit('close', err);
  }

  _request(cmd, args) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new DiscordError('Nicht mit Discord verbunden', { kind: 'closed' }));
      const nonce = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new DiscordError('Discord antwortet nicht', { kind: 'timeout' }));
      }, this.timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      try {
        this.socket.write(encodeFrame(OP.FRAME, { cmd, args, nonce }));
      } catch (e) {
        this.pending.delete(nonce);
        clearTimeout(timer);
        reject(new DiscordError(`Senden an Discord fehlgeschlagen: ${e.message}`, { kind: 'closed' }));
      }
    });
  }

  /** Setzt die Aktivitaet ("Rich Presence"). Ohne Aktivitaet (null) wird sie entfernt. */
  setActivity(activity) {
    return this._request('SET_ACTIVITY', activity ? { pid: this.pid, activity } : { pid: this.pid });
  }

  clearActivity() {
    return this.setActivity(null);
  }

  /** Beendet die Verbindung geordnet (Discord entfernt die Aktivitaet damit von selbst). */
  close() {
    this._closing = true;
    const s = this.socket;
    this.socket = null; // _fail soll die Pipe nicht sofort zerstoeren: das CLOSE-Paket muss noch hinaus
    this._fail(new DiscordError('Verbindung beendet', { kind: 'closed' }));
    if (s && !s.destroyed) {
      try {
        s.end(encodeFrame(OP.CLOSE, {}));
      } catch {
        s.destroy();
      }
      setTimeout(() => s.destroy(), 300).unref?.();
    }
  }
}

module.exports = { OP, DiscordError, DiscordIpc, FrameParser, encodeFrame, pipePath, isBadId, PIPE_COUNT };
