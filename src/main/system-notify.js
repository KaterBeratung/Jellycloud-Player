'use strict';

/**
 * Mitteilungen des Systems unter Windows (Plan P18, wie Platform/iOS/SystemNotifications.swift der Apple-App): Benachrichtigungen von Windows aus dem
 * Hauptprozess (Notification von Electron), lokal erzeugt, wenn ein Abgleich Neues findet; kein Dienst im Netz. Was darin steht, legt
 * src/shared/notifications.js fest (systemNotificationOf); hier nur Zeigen, Zuruecknehmen und Antippen.
 * - Nur solange das Programm laeuft (Entscheidung E15: kein Dienst, kein Infobereich).
 * - Ist das Fenster der App vorn, ohne Ton (Apple: "bei offener App ein Banner ohne Ton").
 * - Dieselbe Kennung ersetzt die alte Mitteilung, statt sie doppelt zu zeigen; zurueckgenommen verschwindet sie auch aus dem Infocenter.
 * - Antippen: onClick(target); ob das Ziel zum aktiven Profil gehoert, entscheidet die Rueckseite.
 * Ob Windows Benachrichtigungen fuer die App zulaesst, laesst sich nicht abfragen: der Stand ist "unknown", die Einstellungen von Windows oeffnen sich auf Wunsch.
 */

/** So viele gezeigte Mitteilungen behaelt der Hauptprozess (zum Zuruecknehmen und fuer das Antippen aus dem Infocenter); so viele Eintraege hat die App hoechstens. */
const KEEP = 100;
const ID = /^[0-9a-f]{6,64}\.seerr-\d{1,12}-[A-Za-z]{1,40}$/;

class SystemNotifier {
  /**
   * @param {object} o
   * @param {(options: object) => {show(): void, close(): void, on(event: string, cb: Function): void}} o.create neue Mitteilung (Electron: new Notification)
   * @param {() => boolean} [o.isSupported] gibt es Mitteilungen auf diesem System
   * @param {() => boolean} [o.isForeground] ist das Fenster der App vorn (dann ohne Ton)
   * @param {(target: object) => void} [o.onClick] eine Mitteilung wurde angetippt (ihr Ziel, ungeprueft)
   */
  constructor({ create, isSupported = () => true, isForeground = () => false, onClick = () => {} }) {
    this.create = create;
    this.isSupported = isSupported;
    this.isForeground = isForeground;
    this.onClick = onClick;
    /** Kennung -> gezeigte Mitteilung (aelteste zuerst) */
    this.shown = new Map();
  }

  /** Stand fuer die Einstellungen: supported, permission ("unknown": Windows sagt der App nicht, ob es sie zeigt), settings (es gibt einen Weg dorthin). */
  status() {
    const supported = this.safe(() => !!this.isSupported(), false);
    return { supported, permission: supported ? 'unknown' : 'unsupported', settings: supported };
  }

  /** Erlaubnis anfragen: Windows fragt nicht (der Nutzer stellt es in seinen Einstellungen ein), es bleibt beim Stand. */
  request() {
    return this.status();
  }

  /** Zeigt fertige Mitteilungen ({ id, title, body, target }); ungueltige fallen weg. */
  show(list) {
    if (!Array.isArray(list) || !this.status().supported) return;
    for (const m of list) {
      if (!m || typeof m.id !== 'string' || !ID.test(m.id) || typeof m.title !== 'string' || typeof m.body !== 'string') continue;
      this.close(m.id); // dieselbe Kennung ersetzt die alte
      const target = m.target && typeof m.target === 'object' ? { ...m.target } : null;
      const n = this.safe(() => this.create({ title: m.title.slice(0, 200), body: m.body.slice(0, 500), silent: this.safe(() => !!this.isForeground(), false) }), null);
      if (!n) continue;
      n.on('click', () => {
        if (target) this.safe(() => this.onClick(target));
      });
      n.on('failed', () => this.shown.delete(m.id));
      this.shown.set(m.id, n);
      this.safe(() => n.show());
      while (this.shown.size > KEEP) this.close(this.shown.keys().next().value);
    }
  }

  /** Nimmt Mitteilungen zurueck (gelesen oder entfernt); unbekannte Kennungen aendern nichts. */
  withdraw(ids) {
    for (const id of Array.isArray(ids) ? ids : []) this.close(String(id));
  }

  /** Nimmt alle Mitteilungen eines Profils zurueck (key: sein Kennwert; Profil entfernt, abgemeldet, Seerr getrennt). */
  withdrawProfile(key) {
    const prefix = `${String(key)}.`;
    for (const id of [...this.shown.keys()]) if (id.startsWith(prefix)) this.close(id);
  }

  close(id) {
    const n = this.shown.get(id);
    if (!n) return;
    this.shown.delete(id);
    this.safe(() => n.close()); // unter Windows auch aus dem Infocenter
  }

  safe(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }
}

module.exports = { SystemNotifier, KEEP };
