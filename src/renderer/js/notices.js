import { state } from './state.js';

/**
 * Mitteilungen in der Oberflaeche (Plan P17): die Zahl fuer den roten Punkt am Profilsymbol und den Eintrag im Profilmenue, und die Anlaesse des Abgleichs,
 * die nur die Seite kennt: bestaetigte Verbindung zu Seerr (Start, Profilwechsel, Rueckkehr in die App; Ereignis "seerr-confirmed" aus connection.js) und
 * der Takt der offenen App (hoechstens alle 15 min). Weitere Anlaesse liegen in der Rueckseite (Reiter Anfragen, eigene Aktion) und in der Uebersicht
 * (Oeffnen). Erkennung, Ablage und Abstand stehen in src/shared/notifications.js; jede Aenderung meldet das Ereignis "notices-changed".
 */
const Notifications = window.JCNotifications;

/** Stand fuer die Oberflaeche: active (Seerr eingerichtet), enabled (Mitteilungen an), unread, notice (Zahl fuer Punkt und Menue; aus: 0). */
export const notices = { active: false, enabled: false, unread: 0, notice: 0 };

function take(s) {
  if (!s || typeof s !== 'object') return;
  const next = { active: !!s.active, enabled: !!s.enabled, unread: Number(s.unread) || 0, notice: Number(s.notice) || 0 };
  if (Object.keys(next).every((k) => next[k] === notices[k])) return;
  Object.assign(notices, next);
  document.dispatchEvent(new CustomEvent('notices-changed'));
}

let installed = false;
/** Einmal beim Start der Seite: Meldungen der Rueckseite empfangen, die Anlaesse der Seite verbinden, den Takt stellen. */
export function installNotices() {
  if (installed || !window.jc.notifications) return;
  installed = true;
  window.jc.onNotifications?.((s) => take(s));
  document.addEventListener('seerr-confirmed', () => syncNotices());
  setInterval(() => {
    if (state.loggedIn && document.visibilityState === 'visible') syncNotices();
  }, Notifications.INTERVAL_MS);
}

/** Liste, Einstellungen und Zahl des aktiven Profils (die Zahl geht dabei an den Punkt); null, wenn es nicht geht. */
export function readNotices() {
  if (!window.jc.notifications) return Promise.resolve(null);
  return window.jc.notifications().then(
    (s) => (take(s), s),
    () => null
  );
}

/** Abgleich anstossen: ohne force mit dem Mindestabstand der Rueckseite. Liefert den neuen Stand (oder null). */
export function syncNotices({ force = false } = {}) {
  if (!window.jc.notificationsSync) return Promise.resolve(null);
  return window.jc.notificationsSync({ force }).then(
    (s) => (take(s), s),
    () => null
  );
}

/** Nach einer Aenderung in der Oberflaeche (gelesen, entfernt, Einstellung): den Stand uebernehmen, den die Rueckseite zurueckgibt. */
export const applyNotices = (s) => (take(s), s);
