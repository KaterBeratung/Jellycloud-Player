import { $ } from './dom.js';
import { state } from './state.js';

/**
 * Verbindungspruefung (wie die Apple-App, ConnectionCheck): Jellyfin und Seerr des aktiven Profils nebeneinander, je Dienst 30 s, ohne Wiederholung, und
 * nie wird dabei etwas geloescht. Der Stand liegt in state.connection ({ profileId, jellyfin, seerr }); jede Aenderung meldet das Ereignis
 * "connection-state". Anlaesse: Start und Profilwechsel (boot), Rueckkehr in die App, Einstellungen > Seerr (beim Oeffnen und alle 20 s).
 */

const emit = () => document.dispatchEvent(new CustomEvent('connection-state'));

/** Stand von Seerr fuer das aktive Profil: none (nicht eingerichtet), checking, connected, unreachable, unauthorized (Anmeldung abgelaufen) oder failed. */
export function seerrState() {
  if (!state.seerr) return 'none';
  const c = state.connection;
  const s = c && c.profileId === state.activeServerId ? c.seerr?.state : null;
  return ['connected', 'unreachable', 'unauthorized', 'failed'].includes(s) ? s : 'checking';
}

function setSeerr(id, seerr) {
  const c = state.connection?.profileId === id ? state.connection : { profileId: id, jellyfin: { state: 'checking' } };
  state.connection = { ...c, seerr };
  emit();
}

let seerrSeq = 0;
/**
 * Prueft nur Seerr. quiet: der bisherige Stand bleibt stehen, bis das Ergebnis da ist (stille Pruefung im Hintergrund); sonst steht zuerst "Wird geprueft".
 * Ein ueberholtes Ergebnis (neuere Pruefung, anderes Profil) zaehlt nicht.
 */
export async function runSeerrCheck({ quiet = false } = {}) {
  const seq = ++seerrSeq;
  const id = state.activeServerId;
  if (!state.seerr) {
    setSeerr(id, { state: 'none' });
    return state.connection.seerr;
  }
  if (!quiet) setSeerr(id, { state: 'checking' });
  let r;
  try {
    r = await window.jc.seerrCheck();
  } catch (e) {
    r = { profileId: id, seerr: { state: 'failed', detail: e.message } };
  }
  if (seq !== seerrSeq || r.profileId !== id || id !== state.activeServerId) return r.seerr;
  setSeerr(id, r.seerr);
  return r.seerr;
}

let checkSeq = 0;
/**
 * Prueft Jellyfin und Seerr des aktiven Profils. Das Versprechen wartet nur auf Jellyfin (der Start haengt davon ab); Seerr laeuft daneben und meldet
 * sich, wenn es so weit ist. quiet: eine abgelehnte Jellyfin-Anmeldung nicht selbst melden (boot entscheidet dann).
 */
export async function runConnectionCheck({ quiet = false } = {}) {
  const seq = ++checkSeq;
  const id = state.activeServerId;
  state.connection = { profileId: id, jellyfin: { state: 'checking' }, seerr: { state: state.seerr ? 'checking' : 'none' } };
  emit();
  runSeerrCheck({ quiet: true });
  let r;
  try {
    r = await window.jc.checkConnection({ seerr: false });
  } catch (e) {
    r = { profileId: id, jellyfin: { state: 'failed', detail: e.message } };
  }
  if (seq !== checkSeq || r.profileId !== state.activeServerId) return r; // von einer neueren Pruefung oder einem Profilwechsel ueberholt
  state.connection = { ...state.connection, profileId: id, jellyfin: r.jellyfin };
  emit();
  if (!quiet && r.jellyfin.state === 'unauthorized' && state.loggedIn && $('#view')) document.dispatchEvent(new CustomEvent('session-expired'));
  return r;
}
