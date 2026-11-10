'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ConfigCore, DEFAULT_SETTINGS, DEFAULT_UPDATE_SOURCE, deepMerge, skipCountdownSec } = require('../shared/config-core');

/**
 * Konfiguration des Hauptprozesses: die Regeln und der Aufbau stehen in src/shared/config-core.js (sie gelten auch fuer die Web-/Handy-Fassung),
 * hier kommen nur die Datei (config.json in userData) und die Verschluesselung der Zugangsdaten mit Windows-DPAPI (Electron safeStorage) dazu.
 */

/** config.json lesen/schreiben: erst in eine .tmp-Datei und dann umbenennen, damit ein Absturz nie eine halbe Datei hinterlaesst. */
function fileIo(dir) {
  const file = path.join(dir, 'config.json');
  return {
    read: () => fs.readFileSync(file, 'utf8'),
    write(text) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      try {
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, file);
      } catch {
        // Unter Windows halten Virenscanner oder der Suchindex eine Datei kurz offen: das Umbenennen scheitert dann (EPERM, EBUSY). Lieber direkt schreiben, als die Einstellung zu verlieren.
        fs.writeFileSync(file, text, 'utf8');
        fs.rmSync(tmp, { force: true });
      }
    },
    backupCorrupt: () => fs.copyFileSync(file, `${file}.corrupt`)
  };
}

/** Zugangsdaten: "dpapi:<base64>" mit Windows-Schluesselspeicher, sonst "plain:<base64>" (nur Kodierung, keine Verschluesselung). */
function nodeCodec(safe) {
  return {
    encode(token) {
      if (safe && safe.isEncryptionAvailable()) return `dpapi:${safe.encryptString(token).toString('base64')}`;
      return `plain:${Buffer.from(token, 'utf8').toString('base64')}`;
    },
    decode(stored) {
      if (stored.startsWith('dpapi:') && safe) return safe.decryptString(Buffer.from(stored.slice(6), 'base64'));
      if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
      return null;
    }
  };
}

class ConfigStore extends ConfigCore {
  /**
   * @param {string} dir Verzeichnis fuer config.json (userData)
   * @param {{isEncryptionAvailable():boolean, encryptString(s:string):Buffer, decryptString(b:Buffer):string}|null} safeStorage
   */
  constructor(dir, safeStorage = null) {
    super(fileIo(dir), nodeCodec(safeStorage), {
      uuid: () => crypto.randomUUID(),
      hashId: (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)
    });
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.safe = safeStorage;
  }
}

module.exports = { ConfigStore, DEFAULT_SETTINGS, DEFAULT_UPDATE_SOURCE, deepMerge, skipCountdownSec };
