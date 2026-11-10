'use strict';

/**
 * Bildspeicher im Arbeitsspeicher des Hauptprozesses (Poster rund 40 KB, Hintergruende einige 100 KB).
 * Haelt Bilder bis zu einer Obergrenze in Bytes; ist sie erreicht, fliegt das am laengsten nicht benutzte Bild zuerst raus.
 * Ein Bild, das schon drin ist, wird beim erneuten Ablegen ersetzt, nicht doppelt gezaehlt (zwei gleichzeitige Anfragen nach demselben Poster legen es beide ab).
 */
class ImageCache {
  /**
   * @param {number} limitBytes Obergrenze der Summe aller Bilder
   * @param {number} maxEntryBytes groessere Einzelbilder werden gar nicht erst abgelegt
   */
  constructor(limitBytes, maxEntryBytes = 4 * 1024 * 1024) {
    this.limit = limitBytes;
    this.maxEntry = maxEntryBytes;
    /** @type {Map<string, {buf: Buffer, type: string}>} */
    this.map = new Map();
    this.bytes = 0;
  }

  get size() {
    return this.map.size;
  }

  /** Liefert das Bild und merkt es als zuletzt benutzt (es rueckt ans Ende der Verdraengungsreihenfolge). */
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  /** @returns {boolean} true, wenn das Bild abgelegt wurde */
  put(key, entry) {
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.buf.length;
      this.map.delete(key);
    }
    if (entry.buf.length > this.maxEntry) return false;
    this.map.set(key, entry);
    this.bytes += entry.buf.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.limit || this.map.size <= 1) break;
      this.map.delete(k);
      this.bytes -= v.buf.length;
    }
    return true;
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}

module.exports = { ImageCache };
