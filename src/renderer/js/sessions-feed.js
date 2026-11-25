import { h } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { openModal } from './ui.js';

/**
 * Stand der letzten Abfrage der Sitzungen (Build 98 der Apple-App, Regel 18: eine Abfrage fuer "Auf diesem Geraet fortsetzen" und "Laeuft gerade") und die
 * Fernbedienung (Regeln 13 bis 16). Die Startseite fragt ab (handoff.js) und legt das Ergebnis hier ab; die Kapsel und "Laeuft gerade" (now-playing.js)
 * lesen es und zeichnen sich bei jeder Aenderung neu.
 * - streams: was gerade laeuft (src/shared/handoff.js streams), offers: was sich uebernehmen und steuern laesst (eigenes Konto, anderes Geraet, steuerbar,
 *   frisch). Ruht die Abfrage (Startseite hinten, Wiedergabe hier, App im Hintergrund), sind beide leer: nichts Veraltetes bleibt stehen.
 * - Fernbedienung: Pause oder Abspielen je nach gezeigtem Stand (nie PlayPause); waehrend ein Befehl unterwegs ist, nimmt der Knopf keinen zweiten an; nach
 *   Erfolg gilt der erwartete Stand hoechstens 12 s gegen die Abfrage (der Empfaenger meldet ihn erst mit seiner naechsten Fortschrittsmeldung).
 */
const Handoff = window.JCHandoff;

export const feed = { streams: [], offers: [], own: null };
const listeners = new Set();
const notify = () => listeners.forEach((cb) => cb());

/** Neuer Stand der Abfrage (oder leer, wenn sie ruht). */
export function publish({ streams = [], offers = [], own = null } = {}) {
  feed.streams = streams;
  feed.offers = offers;
  feed.own = own;
  // Erwartungen fuer Sitzungen, die es nicht mehr gibt, verfallen
  for (const id of expected.keys()) if (!streams.some((s) => s.id === id) && !offers.some((s) => s.id === id)) expected.delete(id);
  notify();
}

/** Bei jeder Aenderung (Abfrage, Befehl unterwegs, erwarteter Stand) aufgerufen; liefert die Abmeldung. */
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Laesst sich diese Sitzung von hier steuern (ein Angebot der letzten Abfrage)? */
export const controllable = (s) => !!s && feed.offers.some((o) => o.id === s.id);

// ---------- Fernbedienung ----------
const expected = new Map(); // Sitzung -> { sessionId, paused, at }
const sending = new Set();

/** Der gezeigte Stand einer Sitzung: der erwartete nach einem Befehl (hoechstens 12 s), sonst der des Servers. */
export function pausedOf(s) {
  const r = Handoff.shownPaused(s, expected.get(s?.id) ?? null);
  if (!r.expected) expected.delete(s?.id);
  return r.paused;
}

export const isSending = (s) => !!s && sending.has(s.id);

/** Pause oder Abspielen auf dem anderen Geraet, ohne die Wiedergabe zu uebernehmen. */
export async function togglePause(s) {
  if (!controllable(s) || sending.has(s.id)) return;
  const paused = pausedOf(s);
  const profile = state.activeServerId;
  sending.add(s.id);
  notify();
  try {
    await window.jc.handoffPlaystate({ sessionId: s.id, command: Handoff.toggleCommand(paused) });
    if (state.activeServerId === profile) expected.set(s.id, { sessionId: s.id, paused: !paused, at: Date.now() });
  } catch {
    // Nach einem Profil- oder Serverwechsel waehrend des Sendens wird nichts mehr angezeigt (Regel 16)
    if (state.activeServerId === profile) {
      openModal({
        title: t('remote.failTitle'),
        body: h('p', { class: 'mdl-text' }, t('remote.failText', { device: s.deviceName || t('handoff.unnamed') })),
        actions: [{ label: t('action.ok'), primary: true, focus: true, onclick: (close) => close() }]
      });
    }
  } finally {
    sending.delete(s.id);
    notify();
  }
}
