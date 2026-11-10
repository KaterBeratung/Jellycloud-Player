'use strict';

const { EventEmitter } = require('node:events');
const net = require('node:net');
const { spawn } = require('node:child_process');

// Immer beobachtet: aendert sich selten oder wird dauernd gebraucht.
const OBSERVED = [
  'time-pos',
  'duration',
  'pause',
  'volume',
  'mute',
  'speed',
  'eof-reached',
  'core-idle',
  'paused-for-cache',
  'seekable',
  'track-list',
  'chapter-list',
  'chapter',
  'aid',
  'sid',
  'video-params',
  'video-aspect-override',
  'panscan',
  'sub-delay',
  'audio-delay',
  'sub-scale',
  'current-ao',
  'audio-out-params'
];

// Nur fuer die Technik-Info: aendern sich bei jedem Bild bzw. mehrmals pro Sekunde und werden daher nur beobachtet, solange die Info offen ist.
const STATS = [
  'hwdec-current',
  'current-vo',
  'audio-codec-name',
  'video-codec',
  'container-fps',
  'estimated-vf-fps',
  'frame-drop-count',
  'decoder-frame-drop-count',
  'demuxer-cache-time',
  'video-bitrate',
  'audio-bitrate',
  'file-format'
];
const STATS_ID_BASE = 1000;

/**
 * Steuert eine mpv-Instanz ueber die JSON-IPC-Schnittstelle (Named Pipe).
 * Ereignisse: 'property' (name, value), 'file-loaded', 'end-file' ({reason}), 'seek', 'exit' ({code, signal}), 'error'.
 */
class MpvPlayer extends EventEmitter {
  /**
   * @param {{exe:string, args:string[], pipe:string, spawnPrefix?:string[], connectTimeoutMs?:number}} o
   * `spawnPrefix` erlaubt Tests, ein Node-Skript statt mpv zu starten.
   */
  constructor({ exe, args, pipe, spawnPrefix = [], connectTimeoutMs = 10000, env = process.env }) {
    super();
    this.env = env;
    this.exe = exe;
    this.args = args;
    this.pipe = pipe;
    this.spawnPrefix = spawnPrefix;
    this.connectTimeoutMs = connectTimeoutMs;
    this.proc = null;
    this.sock = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.props = {};
    this.exited = false;
    this.closing = false;
    this.statsOn = false;
  }

  /** Schaltet die haeufig wechselnden Statistik-Eigenschaften (Technik-Info) ein oder aus. */
  observeStats(on) {
    on = !!on;
    if (on === this.statsOn) return;
    this.statsOn = on;
    for (const [i, name] of STATS.entries()) this._write(on ? ['observe_property', STATS_ID_BASE + i, name] : ['unobserve_property', STATS_ID_BASE + i]);
  }

  async start() {
    this.proc = spawn(this.exe, [...this.spawnPrefix, ...this.args], { stdio: ['ignore', 'ignore', 'pipe'], env: this.env });
    this.stderrTail = '';
    this.proc.stderr?.on('data', (d) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
    });
    this.proc.on('error', (e) => {
      this.exited = true;
      this.emit('error', e);
    });
    this.proc.on('exit', (code, signal) => {
      this.exited = true;
      this._failPending(new Error('mpv wurde beendet'));
      this.emit('exit', { code, signal, stderr: this.stderrTail });
    });
    await this._connect();
    for (const [i, name] of OBSERVED.entries()) this._write(['observe_property', i + 1, name]);
    return this;
  }

  _connect() {
    const deadline = Date.now() + this.connectTimeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (this.exited) return reject(new Error(`mpv ist sofort beendet: ${this.stderrTail.trim() || 'keine Ausgabe'}`));
        if (Date.now() > deadline) return reject(new Error('mpv-IPC nicht erreichbar (Zeitueberschreitung)'));
        const sock = net.connect(this.pipe);
        sock.once('connect', () => {
          this.sock = sock;
          sock.setEncoding('utf8');
          sock.on('data', (d) => this._onData(d));
          sock.on('close', () => this._failPending(new Error('mpv-IPC getrennt')));
          sock.on('error', () => {});
          resolve();
        });
        sock.once('error', () => {
          sock.destroy();
          setTimeout(attempt, 80);
        });
      };
      attempt();
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this._onMessage(msg);
    }
  }

  _onMessage(msg) {
    if (msg.request_id !== undefined && this.pending.has(msg.request_id)) {
      const { resolve, reject } = this.pending.get(msg.request_id);
      this.pending.delete(msg.request_id);
      if (msg.error === 'success') resolve(msg.data);
      else reject(new Error(`mpv: ${msg.error}`));
      return;
    }
    if (!msg.event) return;
    if (msg.event === 'property-change') {
      this.props[msg.name] = msg.data;
      this.emit('property', msg.name, msg.data);
    } else if (msg.event === 'end-file') {
      this.emit('end-file', { reason: msg.reason, error: msg.file_error });
    } else {
      this.emit(msg.event, msg);
    }
  }

  _write(command, requestId) {
    if (!this.sock || this.sock.destroyed) return false;
    const payload = requestId === undefined ? { command } : { command, request_id: requestId };
    this.sock.write(`${JSON.stringify(payload)}\n`);
    return true;
  }

  _failPending(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  /** Sendet einen Befehl, z.B. command('seek', 30, 'absolute'). */
  command(...command) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      if (!this._write(command, id)) {
        this.pending.delete(id);
        reject(new Error('mpv nicht verbunden'));
        return;
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`mpv: Zeitueberschreitung bei ${command[0]}`));
        }
      }, 15000).unref?.();
    });
  }

  setProperty(name, value) {
    return this.command('set_property', name, value);
  }

  getProperty(name) {
    return this.command('get_property', name);
  }

  /** Letzter bekannter Wert einer beobachteten Eigenschaft. */
  prop(name) {
    return this.props[name];
  }

  /**
   * Laedt eine Datei. Startposition, Header und Spuren werden vorher als Optionen gesetzt,
   * damit sie fuer genau diese Datei gelten (funktioniert ab mpv 0.33).
   */
  async load({ url, headers = [], start = 0, aid = null, sid = null, externalSubs = [], title = '' }) {
    // Die Pipe arbeitet in Reihenfolge: die Optionen muessen nicht einzeln abgewartet werden (spart fuenf Hin- und Rueckwege).
    this._pendingExternalSubs = externalSubs;
    await Promise.all([
      this.setProperty('http-header-fields', headers),
      this.setProperty('start', start > 0 ? String(start) : 'none'),
      this.setProperty('aid', aid ?? 'auto'),
      this.setProperty('sid', sid ?? 'no'),
      this.setProperty('force-media-title', title || ''),
      this.command('loadfile', url, 'replace')
    ]);
  }

  /** Nach `file-loaded` aufrufen: haengt externe Untertitel an und waehlt ggf. einen aus. */
  async attachExternalSubs(selectIndex = null) {
    const subs = this._pendingExternalSubs ?? [];
    this._pendingExternalSubs = [];
    for (const s of subs) {
      const flag = selectIndex !== null && s.index === selectIndex ? 'select' : 'auto';
      try {
        await this.command('sub-add', s.url, flag, s.title, s.lang || 'und');
      } catch {
        /* einzelne defekte Untertitel ignorieren */
      }
    }
  }

  _waitExit(ms) {
    return new Promise((resolve) => {
      if (this.exited || !this.proc) return resolve(true);
      const done = (ok) => {
        clearTimeout(t);
        this.proc?.off('exit', onExit);
        resolve(ok);
      };
      const onExit = () => done(true);
      const t = setTimeout(() => done(false), ms);
      this.proc.once('exit', onExit);
    });
  }

  /**
   * Beendet mpv schnell: "quit" ohne auf die Antwort zu warten (mpv antwortet beim Beenden oft nicht mehr),
   * nach kurzer Frist hart beenden. Mit dem Prozess verschwindet auch sein Videofenster.
   */
  async quit() {
    if (this.exited || this.closing) return;
    this.closing = true;
    this._write(['quit']);
    if (!(await this._waitExit(700))) {
      try {
        this.proc?.kill();
      } catch {
        /* ignorieren */
      }
      await this._waitExit(1500);
    }
    this.sock?.destroy();
  }
}

module.exports = { MpvPlayer, OBSERVED, STATS };
