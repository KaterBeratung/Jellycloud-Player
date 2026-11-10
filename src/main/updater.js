'use strict';

/**
 * Selbst-Aktualisierung ohne Fremdpakete.
 *
 * Die Quelle ist eine Adresse (https://...) oder ein Ordner (auch eine Netzwerkfreigabe) mit zwei Dateien:
 *   latest.json                           { "version", "file", "size", "sha512", "date"?, "notes"? }
 *   Jellycloud-Player-Setup-<version>.exe der Installer
 * `tools/publish-update.ps1` schreibt beides. Geprüft wird vor dem Start des Installers: Dateiname und Version, Größe, SHA-512.
 * Der Installer ist nicht signiert; Vertrauen heisst hier: wer in die Quelle schreiben darf, bestimmt, was installiert wird. Deshalb nur https
 * (http nur für den eigenen Rechner), nur Dateien mit festem Namensmuster und nie ohne Bestätigung des Nutzers.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const MANIFEST_NAME = 'latest.json';
const INSTALLER_RE = /^Jellycloud-Player-Setup-(\d+\.\d+\.\d+)\.exe$/;
const STALE_RE = /^Jellycloud-Player-Setup-(\d+\.\d+\.\d+)\.exe(\.part)?$/;
const MANIFEST_MAX = 64 * 1024;
const INSTALLER_MAX = 1024 ** 3;
const NOTES_MAX = 2000;
const MANIFEST_TIMEOUT_MS = 15000;
const IDLE_TIMEOUT_MS = 30000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Fehler mit einer Meldung, die der Nutzer lesen soll. */
class UpdateError extends Error {}

function parseVersion(v) {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(v ?? '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/** -1, 0, 1 oder NaN, wenn eine der beiden keine Version ist. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * Macht aus der Eingabe eine Quelle.
 * @returns {{kind:'http', base:string, display:string}|{kind:'dir', dir:string, display:string}|null} null bei leerer Eingabe
 * @throws {UpdateError} bei einer Eingabe, die nicht erlaubt ist
 */
function normalizeSource(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  // Kurzform: github:NAME/REPO = die Dateien des neuesten Releases dieses Repos
  const short = /^github:\/?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s);
  if (short) s = `https://github.com/${short[1]}/${short[2]}/releases/latest/download/`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      throw new UpdateError('Die Adresse ist ungültig');
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) throw new UpdateError('Updates werden nur über https geladen (http nur für den eigenen Rechner)');
    if (u.username || u.password) throw new UpdateError('Die Adresse darf keine Zugangsdaten enthalten');
    u.hash = '';
    u.search = '';
    // Wer die Adresse von latest.json einfügt, meint den Ordner davor
    u.pathname = u.pathname.replace(/\/latest\.json$/i, '/');
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    // Die Seiten eines GitHub-Repos (Startseite, Releases, ein Release) liefern HTML. Gemeint sind die Dateien des Releases:
    // .../NAME/REPO, .../releases und .../releases/latest = neuestes Release, .../releases/tag/vX = genau dieses Release
    if (u.hostname.toLowerCase() === 'github.com') {
      const m = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/releases(?:\/latest|\/tag\/([^/]+))?)?\/$/.exec(u.pathname);
      if (m && !['orgs', 'users', 'settings', 'marketplace', 'sponsors', 'topics'].includes(m[1].toLowerCase())) {
        u.pathname = m[3] ? `/${m[1]}/${m[2]}/releases/download/${m[3]}/` : `/${m[1]}/${m[2]}/releases/latest/download/`;
      }
    }
    return { kind: 'http', base: u.href, display: u.href };
  }
  if (!path.isAbsolute(s)) throw new UpdateError('Bitte eine Adresse mit https:// oder den vollständigen Pfad eines Ordners angeben');
  const dir = path.normalize(/[\\/]latest\.json$/i.test(s) ? path.dirname(s) : s);
  return { kind: 'dir', dir, display: dir };
}

/** Die Quelle als Text für die Einstellungen (leer, wenn keine). */
const cleanSource = (input) => normalizeSource(input)?.display ?? '';

/** Prüft latest.json streng; unbekannte Felder werden verworfen. */
function parseManifest(text) {
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    throw new UpdateError('latest.json ist kein gültiges JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UpdateError('latest.json hat ein unerwartetes Format');
  const version = typeof raw.version === 'string' && parseVersion(raw.version) ? raw.version.trim() : null;
  const file = typeof raw.file === 'string' && INSTALLER_RE.test(raw.file) ? raw.file : null;
  const size = Number.isSafeInteger(raw.size) && raw.size > 0 && raw.size <= INSTALLER_MAX ? raw.size : null;
  const sha512 = typeof raw.sha512 === 'string' && /^[0-9a-f]{128}$/i.test(raw.sha512) ? raw.sha512.toLowerCase() : null;
  const bad = [!version && 'version', !file && 'file', !size && 'size', !sha512 && 'sha512'].filter(Boolean);
  if (bad.length) throw new UpdateError(`latest.json ist unvollständig oder ungültig (${bad.join(', ')})`);
  if (file !== `Jellycloud-Player-Setup-${version}.exe`) throw new UpdateError('Dateiname und Version in latest.json passen nicht zusammen');
  // eslint-disable-next-line no-control-regex
  const notes = typeof raw.notes === 'string' ? raw.notes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, NOTES_MAX) : '';
  const date = typeof raw.date === 'string' && !Number.isNaN(Date.parse(raw.date)) ? raw.date : '';
  return { version, file, size, sha512, notes, date };
}

/** Liest einen Body (Web-Stream aus fetch oder Node-Stream) Stück für Stück. */
async function* iterate(body) {
  if (!body) return;
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } else {
    yield* body;
  }
}

async function hashFile(file) {
  const h = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) h.update(chunk);
  return h.digest('hex');
}

/** Stimmen Größe und Prüfsumme der Datei mit dem Manifest überein? */
async function verifyFile(file, m) {
  try {
    if ((await fs.promises.stat(file)).size !== m.size) return false;
    return (await hashFile(file)) === m.sha512;
  } catch {
    return false;
  }
}

function describe(e) {
  if (e instanceof UpdateError) return e.message;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'Zeitüberschreitung: die Update-Quelle antwortet nicht';
  // Node meldet ECONNREFUSED & Co. in cause.code, Electrons net.fetch den Fehler als "net::ERR_..." im Text
  const code = e?.cause?.code ?? e?.code ?? /net::(ERR_\w+)/.exec(e?.message ?? '')?.[1] ?? '';
  if (code === 'ENOENT') return 'Der Ordner oder die Datei der Update-Quelle wurde nicht gefunden';
  if (code === 'EACCES' || code === 'EPERM') return 'Kein Zugriff auf die Update-Quelle';
  return `Update-Quelle nicht erreichbar${code ? ` (${code})` : ''}`;
}

class Updater extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.currentVersion Version der laufenden App
   * @param {() => string} o.getSource liefert die eingestellte Quelle (Text)
   * @param {string} o.dir Ordner für heruntergeladene Installer (nur für diesen Zweck, Dateien nach dem Muster werden aufgeräumt)
   * @param {typeof fetch} [o.fetch]
   * @param {(file:string, args:string[]) => any} [o.launch] startet den Installer
   * @param {() => void} [o.quit] beendet die App
   * @param {() => boolean} [o.canInstall] false, solange etwas abgespielt wird
   * @param {boolean} [o.packaged] false in der Entwicklung: dort wird nichts installiert
   * @param {number} [o.installDelayMs] Wartezeit zwischen Start des Installers und Beenden
   */
  constructor({ currentVersion, getSource, dir, fetch: f = globalThis.fetch, launch, quit = () => {}, canInstall = () => true, packaged = true, installDelayMs = 400 }) {
    super();
    this.current = currentVersion;
    this.getSource = getSource;
    this.dir = dir;
    this.fetch = f;
    this.launch =
      launch ??
      ((file, args) => {
        const child = require('node:child_process').spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref(); // die App beendet sich gleich, der Installer läuft allein weiter
        return child;
      });
    this.quit = quit;
    this.canInstall = canInstall;
    this.packaged = packaged;
    this.installDelayMs = installDelayMs;
    this.checkedAt = 0;
    this._target = null; // { src, manifest } des zuletzt gefundenen Updates
    this._checkRun = null;
    this._downloadRun = null;
    this._abort = null;
    this._cancelled = false;
    this._timer = null;
    /** @type {{status:string, current:string, supported:boolean, checkedAt:number, version?:string, notes?:string, size?:number, date?:string, received?:number, error?:string}} */
    this.state = { status: 'idle', current: currentVersion, supported: packaged, checkedAt: 0 };
  }

  _publish(partial) {
    this.state = { status: 'idle', current: this.current, supported: this.packaged, checkedAt: this.checkedAt, ...partial };
    this.emit('state', this.state);
  }

  _found(extra = {}) {
    const m = this._target.manifest;
    return { version: m.version, notes: m.notes, size: m.size, date: m.date, ...extra };
  }

  // ---------- Prüfen ----------

  /**
   * Fragt die Quelle nach einer neueren Version. Automatische Prüfungen (manual=false) bleiben stumm, wenn keine Quelle eingestellt ist
   * und lassen ein bereits heruntergeladenes Update in Ruhe.
   */
  check({ manual = false } = {}) {
    if (this._downloadRun || this.state.status === 'installing') return Promise.resolve(this.state);
    if (this._checkRun) return this._checkRun;
    if (this.state.status === 'ready') return Promise.resolve(this.state);
    this._checkRun = this._check(manual).finally(() => {
      this._checkRun = null;
    });
    return this._checkRun;
  }

  async _check(manual) {
    let src;
    try {
      src = normalizeSource(this.getSource());
    } catch (e) {
      if (manual) this._publish({ status: 'error', error: e.message });
      return this.state;
    }
    if (!src) {
      if (manual) this._publish({ status: 'error', error: 'Es ist noch keine Update-Quelle eingestellt', noSource: true });
      return this.state;
    }
    this._publish({ status: 'checking' });
    try {
      const { chunks } = await this._open(src, MANIFEST_NAME, AbortSignal.timeout(MANIFEST_TIMEOUT_MS));
      let total = 0;
      const parts = [];
      for await (const c of chunks) {
        total += c.length;
        if (total > MANIFEST_MAX) throw new UpdateError('latest.json ist zu groß (das ist keine Manifest-Datei, vermutlich eine falsche Adresse)');
        parts.push(Buffer.from(c));
      }
      const manifest = parseManifest(Buffer.concat(parts).toString('utf8'));
      this.checkedAt = Date.now();
      if (compareVersions(manifest.version, this.current) > 0) {
        this._target = { src, manifest };
        this._publish(this._found({ status: 'available' }));
      } else {
        this._target = null;
        this._publish({ status: 'none' });
      }
    } catch (e) {
      this._publish({ status: 'error', error: describe(e) });
    }
    return this.state;
  }

  /** Öffnet eine Datei der Quelle. @returns {Promise<{total:number, chunks:AsyncIterable<Uint8Array>}>} */
  async _open(src, name, signal) {
    if (src.kind === 'http') {
      const res = await this.fetch(src.base + encodeURIComponent(name), { signal, cache: 'no-store' });
      if (!res.ok) throw new UpdateError(name === MANIFEST_NAME && res.status === 404 ? 'In der Update-Quelle liegt keine latest.json (Fehler 404)' : `Die Update-Quelle antwortet mit Fehler ${res.status}`);
      // Eine Webseite statt der Datei (falsche Adresse, Anmeldeseite, Sperrseite): das ist nie eine latest.json oder ein Installer
      if (/text\/html/i.test(res.headers.get('content-type') ?? '')) {
        await res.body?.cancel?.().catch(() => {});
        throw new UpdateError(`Die Adresse liefert eine Webseite statt ${name === MANIFEST_NAME ? 'der Datei latest.json' : 'des Installers'}. Gemeint ist die Adresse des Ordners mit den Dateien (bei GitHub: …/releases/latest/download/).`);
      }
      return { total: Number(res.headers.get('content-length')) || 0, chunks: iterate(res.body) };
    }
    const file = path.join(src.dir, name);
    let st;
    try {
      st = await fs.promises.stat(file);
    } catch (e) {
      if (e?.code === 'ENOENT') throw new UpdateError(name === MANIFEST_NAME ? 'Im Ordner der Update-Quelle liegt keine latest.json' : `Im Ordner der Update-Quelle fehlt ${name}`);
      throw e;
    }
    return { total: st.size, chunks: fs.createReadStream(file, { highWaterMark: 1 << 20 }) };
  }

  // ---------- Herunterladen ----------

  /** Lädt den Installer des gefundenen Updates und prüft ihn. */
  async download() {
    if (this._downloadRun) return this._downloadRun;
    if (!this._target || !['available', 'error'].includes(this.state.status)) throw new UpdateError('Es gibt kein Update zum Herunterladen');
    this._downloadRun = this._download().finally(() => {
      this._downloadRun = null;
    });
    return this._downloadRun;
  }

  /** Bricht einen laufenden Download ab (das Update bleibt "verfügbar"). */
  cancel() {
    if (!this._downloadRun) return this.state;
    this._cancelled = true;
    this._abort?.abort();
    return this._downloadRun;
  }

  async _download() {
    const { src, manifest: m } = this._target;
    const final = path.join(this.dir, m.file);
    const part = `${final}.part`;
    this._cancelled = false;
    const progress = (received) => this._publish(this._found({ status: 'downloading', received }));
    progress(0);
    let fh = null;
    let idle = null;
    const ac = new AbortController();
    this._abort = ac;
    try {
      await fs.promises.mkdir(this.dir, { recursive: true });
      this.purge(m.file);
      // Nach einem Neustart oder einem früheren Lauf liegt der Installer vielleicht schon vollständig da
      if (await verifyFile(final, m)) {
        this._publish(this._found({ status: 'ready' }));
        return this.state;
      }
      const bump = () => {
        clearTimeout(idle);
        idle = setTimeout(() => ac.abort(), IDLE_TIMEOUT_MS);
      };
      bump();
      const { chunks } = await this._open(src, m.file, ac.signal);
      fh = await fs.promises.open(part, 'w');
      const hash = crypto.createHash('sha512');
      let received = 0;
      let lastEmit = 0;
      for await (const chunk of chunks) {
        if (ac.signal.aborted) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' });
        bump();
        received += chunk.length;
        if (received > m.size) throw new UpdateError('Die Datei ist größer als in latest.json angegeben');
        hash.update(chunk);
        await fh.write(chunk);
        const now = Date.now();
        if (now - lastEmit >= 150) {
          lastEmit = now;
          progress(received);
        }
      }
      await fh.close();
      fh = null;
      if (received !== m.size) throw new UpdateError('Der Download ist unvollständig');
      if (hash.digest('hex') !== m.sha512) throw new UpdateError('Die Prüfsumme des Downloads stimmt nicht, die Datei wurde verworfen');
      await fs.promises.rename(part, final);
      this._publish(this._found({ status: 'ready' }));
    } catch (e) {
      await fh?.close().catch(() => {});
      fh = null;
      await fs.promises.rm(part, { force: true }).catch(() => {});
      if (this._cancelled) this._publish(this._found({ status: 'available' }));
      else this._publish(this._found({ status: 'error', error: e?.name === 'AbortError' ? 'Zeitüberschreitung: die Update-Quelle sendet nichts mehr' : describe(e) }));
    } finally {
      clearTimeout(idle);
      this._abort = null;
      this._cancelled = false;
    }
    return this.state;
  }

  // ---------- Installieren ----------

  /** Startet den heruntergeladenen Installer im Hintergrund und beendet die App; der Installer startet die neue Version. */
  async install() {
    if (this.state.status !== 'ready' || !this._target) throw new UpdateError('Es liegt kein heruntergeladenes Update bereit');
    if (!this.packaged) throw new UpdateError('Installieren geht nur in der installierten App');
    if (!this.canInstall()) throw new UpdateError('Die Installation ist erst nach der Wiedergabe möglich');
    const m = this._target.manifest;
    const file = path.join(this.dir, m.file);
    // Noch einmal prüfen: zwischen Download und Klick kann die Datei verändert worden sein
    if (!(await verifyFile(file, m))) {
      await fs.promises.rm(file, { force: true }).catch(() => {});
      this._publish(this._found({ status: 'error', error: 'Die heruntergeladene Datei ist beschädigt, bitte erneut herunterladen' }));
      throw new UpdateError('Die heruntergeladene Datei ist beschädigt, bitte erneut herunterladen');
    }
    this._publish(this._found({ status: 'installing' }));
    let failed = null;
    try {
      // /S: ohne Fenster, --force-run: danach die App wieder starten (ohne diese Angabe tut das ein stiller Installer nicht)
      const child = this.launch(file, ['--updated', '/S', '--force-run']);
      child?.on?.('error', (e) => {
        failed = e;
      });
    } catch (e) {
      failed = e;
    }
    await new Promise((r) => setTimeout(r, this.installDelayMs));
    if (failed) {
      this._publish(this._found({ status: 'error', error: `Der Installer konnte nicht gestartet werden (${failed.code ?? failed.message})` }));
      throw new UpdateError(this.state.error);
    }
    this.quit();
    return this.state;
  }

  // ---------- Pflege ----------

  /**
   * Löscht alte oder halbe Installer im Download-Ordner (außer `keep`).
   * Nur ein Versuch je Datei und nie ein Fehler nach außen: gleich nach einem Update läuft der Installer, der gerade fertig wird, noch aus genau
   * dieser Datei, Windows sperrt sie dann (EPERM/EBUSY), und das darf den Start der App nicht aufhalten. Sie wird beim nächsten Start entfernt.
   */
  purge(keep = '') {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const m = STALE_RE.exec(name);
      if (!m || name === keep) continue;
      if (!(m[2] || compareVersions(m[1], this.current) <= 0 || keep)) continue;
      try {
        fs.rmSync(path.join(this.dir, name), { force: true });
      } catch {
        /* gesperrt: beim nächsten Start noch einmal */
      }
    }
  }

  /** Eine andere Quelle wurde eingestellt: bisherige Ergebnisse gelten nicht mehr. */
  sourceChanged() {
    if (this._downloadRun || this.state.status === 'installing') return;
    this._target = null;
    this.checkedAt = 0;
    this._publish({ status: 'idle' });
  }

  /**
   * Prüft kurz nach dem Start und danach in festen Abständen, solange enabled() wahr ist.
   * @param {{enabled:() => boolean, firstMs?:number, everyMs?:number}} o
   */
  schedule({ enabled, firstMs = 20000, everyMs = 6 * 3600 * 1000 }) {
    this.stop();
    const tick = (wait) => {
      this._timer = setTimeout(() => {
        if (enabled()) this.check({ manual: false }).catch(() => {});
        tick(everyMs);
      }, wait);
      this._timer.unref?.();
    };
    tick(firstMs);
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
  }
}

module.exports = { Updater, UpdateError, normalizeSource, cleanSource, parseManifest, parseVersion, compareVersions, verifyFile, MANIFEST_NAME };
