import { h, icon, $ } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { syncGlow } from '../glow.js';
import { syncAmbient } from '../ambient.js';
import { closeMenu } from '../ui.js';
import { connectBrand, qcHeader, qcDigits } from './connect-parts.js';

/*
 * Maske "Quick Connect" fuer andere Geraete (wie die Apple-App, Features/Connect/QuickConnectAuthorizeView.swift): den sechsstelligen Code eingeben,
 * den ein anderes Geraet unter "Mit Quick Connect anmelden" zeigt, und bestaetigen. Das andere Geraet ist danach mit dem Konto dieses Profils
 * angemeldet, ohne Passwort. Aussehen wie die Anmeldung mit Quick Connect: Marke, Glaskarte, Ziffernkacheln, Ambient Glow der Anmeldung, "Abbrechen"
 * oben links. Sie liegt ueber dem ganzen Bild; die App darunter ist so lange verdeckt und nimmt keine Eingaben an (html.covered, inert).
 * Zustand und Regeln: src/shared/quick-connect.js (createAuthorizer). Der Code wird nirgends gespeichert oder protokolliert und ist beim Schliessen weg.
 */

const QC = window.JCQuickConnect;
let open = null; // { close } der offenen Maske

const errorText = (reason) => t(`qc.err.${reason.kind}`, { status: reason.status ?? '' });

/** Schliesst eine offene Maske sofort (Neuaufbau der Oberflaeche, Anmeldung). */
export function closeQuickConnect() {
  open?.close({ instant: true });
}

/**
 * Oeffnet die Maske fuer das aktive Profil. Das Profil und sein Zugang stehen fest, solange sie offen ist (auch wenn das aktive Profil inzwischen wechselt).
 * @param {{ onSignedOut?: () => void }} [o] onSignedOut: die Anmeldung des Profils ist abgelaufen (die App zeigt dann die Anmeldung)
 */
export function openQuickConnect({ onSignedOut } = {}) {
  const account = state.servers.find((s) => s.id === state.activeServerId);
  const root = $('#app');
  if (!account || !root || open) return;
  closeMenu();

  const digits = qcDigits({ entry: true });
  // Das Eingabefeld liegt unsichtbar ueber den Kacheln (Text und Einfuegemarke durchsichtig) und nimmt selbst keine Klicks an: ein Klick auf die
  // Kacheln gibt ihm den Fokus mit der Einfuegemarke am Ende (ein Klick ins Feld setzte sie irgendwo in den unsichtbaren Text, wie in der Apple-App)
  const input = h('input', { class: 'qc-input', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', spellcheck: 'false', 'aria-label': t('qc.codeLabel'), 'aria-describedby': 'qc-hint' });
  const hint = h('span', { class: 'sr-only', id: 'qc-hint' });
  const tiles = h('div', { class: 'qc-entry' }, digits.el, input, hint);
  const errBox = h('p', { class: 'qc-error', role: 'alert' });
  const confirm = h('button', { class: 'btn primary lg block', type: 'button' }, h('span', null, t('qc.confirm')));
  const who = h(
    'div',
    { class: 'qc-who' },
    h('span', { class: 'qc-who-label' }, t('qc.as')),
    h('strong', null, account.userName),
    h('span', { class: 'qc-who-where' }, `${account.name || account.url} · ${account.url}`)
  );
  const body = h('div', { class: 'qc-body' });
  const card = h('div', { class: 'connect-card qc-panel', role: 'group', 'aria-labelledby': 'qc-title' }, qcHeader('qc-title'), body);
  const cancel = h('button', { class: 'btn glass connect-cancel', type: 'button' }, icon('chevron-left', 18), h('span', null, t('action.cancel')));
  // Die Ziehflaeche oben gehoert sonst zur verdeckten Kopfzeile: die Maske bringt ihre eigene mit (das Fenster bleibt verschiebbar)
  const el = h('div', { class: 'connect-overlay page-enter', 'data-glow': 'signIn', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qc-title' }, h('div', { class: 'drag-strip' }), h('div', { class: 'connect-col' }, connectBrand(t('qc.subtitle')), card), cancel);

  const previous = document.activeElement;
  const covered = [...root.children];
  for (const c of covered) c.inert = true;
  root.append(el);
  document.documentElement.classList.add('covered'); // der Trailer der Startseite haelt an, die Tastenkuerzel der App ruhen
  syncAmbient(null);
  syncGlow(el);

  let shown = null; // zuletzt gezeigte Phase: der Inhalt der Karte wird nur bei einem Wechsel neu aufgebaut (das Eingabefeld behaelt den Fokus)
  let shownError = null; // zuletzt gezeigte Meldung (eine neue Meldung zum Code holt den Fokus ins Feld)
  const auth = QC.createAuthorizer({
    isEnabled: () => window.jc.quickConnectAvailable(account.id),
    authorize: (code) => window.jc.quickConnectAuthorize({ id: account.id, code }),
    onChange: (v) => paint(v)
  });

  function outcome(sym, tone, title, text) {
    return h('div', { class: `qc-outcome ${tone}` }, icon(sym, 44), h('strong', null, title), h('p', null, text));
  }

  function paint(v) {
    const entry = v.phase === 'ready' || v.phase === 'working';
    if (v.phase !== shown && !(entry && (shown === 'ready' || shown === 'working'))) {
      shown = v.phase;
      if (v.phase === 'checking') body.replaceChildren(h('div', { class: 'qc-wait' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, t('qc.checking'))));
      else if (entry) body.replaceChildren(h('p', { class: 'qc-text' }, t('qc.prompt')), tiles, who, errBox, confirm);
      else if (v.phase === 'done') {
        const done = h('button', { class: 'btn primary lg block', type: 'button', onclick: () => close() }, t('qc.done'));
        body.replaceChildren(outcome('check-circle-fill', 'ok', t('qc.doneTitle'), t('qc.doneText', { user: account.userName })), done);
        requestAnimationFrame(() => done.focus());
      } else if (v.phase === 'disabled') {
        const again = h('button', { class: 'btn glass', type: 'button', onclick: () => auth.prepare() }, t('qc.recheck'));
        body.replaceChildren(outcome('warning', 'warn', t('qc.disabledTitle'), t('qc.err.disabled')), again);
        requestAnimationFrame(() => again.focus());
      }
      if (entry) requestAnimationFrame(() => !QC.isComplete(v.code) && focusInput());
    }
    // Nach der Bestaetigung gibt es nichts mehr abzubrechen: dann steht nur "Fertig" in der Karte
    cancel.hidden = v.phase === 'done';
    if (!entry) {
      input.value = ''; // ohne Eingabe (bestaetigt, ausgeschaltet) bleibt der Code auch im ausgehaengten Feld nicht stehen
      return;
    }
    const invalid = QC.concernsCode(v.error);
    if (input.value !== v.code) input.value = v.code;
    // Waehrend der Bestaetigung nur lesen (nicht gesperrt): so bleibt der Fokus im Feld, und nach einer Meldung laesst sich der Code gleich korrigieren
    input.readOnly = v.phase === 'working';
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    hint.textContent = invalid ? t('qc.codeInvalid') : t('qc.codeHint');
    digits.set({ code: v.code, focused: document.activeElement === input, invalid });
    errBox.textContent = v.error ? errorText(v.error) : '';
    errBox.hidden = !v.error;
    // Eine neue Meldung zum Code: am Rechner steht die Einfuegemarke gleich wieder im Feld (auch nach einem Klick auf "Bestaetigen"); auf dem Handy nicht, sonst ginge die Tastatur auf
    if (invalid && v.error !== shownError && document.documentElement.dataset.compact !== 'on') requestAnimationFrame(focusInput);
    shownError = v.error;
    confirm.disabled = !v.canSubmit;
    confirm.classList.toggle('loading', v.phase === 'working');
    // Sechs Ziffern auf dem Handy: die Tastatur geht weg und gibt "Bestaetigen" frei (sie laege sonst darueber); am Rechner bleibt der Fokus, Eingabe bestaetigt
    if (QC.isComplete(v.code) && v.phase === 'ready' && document.documentElement.dataset.compact === 'on' && document.activeElement === input) input.blur();
    // Das Token des Profils gilt nicht mehr: derselbe Weg wie ueberall in der App (Anmeldung), die Maske schliesst dabei
    if (v.error?.kind === 'signedOut' && account.id === state.activeServerId) {
      close({ instant: true });
      onSignedOut?.();
    }
  }

  function focusInput() {
    if (!input.isConnected || !el.isConnected) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  // Was getippt oder eingefuegt wird, geht bereinigt in den Zustand und so zurueck ins Feld (nie mehr im Feld, als die Kacheln zeigen)
  input.addEventListener('input', () => {
    auth.enter(input.value);
    if (input.value !== auth.code) input.value = auth.code;
  });
  input.addEventListener('focus', () => digits.set({ code: auth.code, focused: true, invalid: QC.concernsCode(auth.error) }));
  input.addEventListener('blur', () => digits.set({ code: auth.code, focused: false, invalid: QC.concernsCode(auth.error) }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      auth.submit();
    }
  });
  tiles.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // der Fokus geht ans Feld, nicht an die Kacheln
    focusInput();
  });
  confirm.addEventListener('click', () => auth.submit());
  cancel.addEventListener('click', () => close());

  // Escape (auch die Zurueck-Taste des Handys, app.js: jc-back) schliesst; Tab bleibt in der Maske
  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (!cancel.hidden || auth.phase === 'done') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === 'Tab') {
      const items = [...el.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled])')].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);

  let closed = false;
  function close({ instant = false } = {}) {
    if (closed) return;
    closed = true;
    auth.cancel(); // ein spaetes Ergebnis aendert nichts mehr; was die Maske zeigt, bleibt stehen, bis sie aus dem Bild ist
    document.removeEventListener('keydown', onKey, true);
    if (open?.el === el) open = null;
    const finish = () => {
      auth.close(); // der Code ist weg
      input.value = '';
      el.remove();
      for (const c of covered) if (c.isConnected) c.inert = false;
      document.documentElement.classList.remove('covered');
      const view = $('#view')?.firstElementChild ?? null;
      syncAmbient(view);
      syncGlow(view ?? $('#app > .login'));
      try {
        if (previous?.isConnected) previous.focus();
      } catch {
        /* Element schon weg */
      }
    };
    if (instant || document.documentElement.dataset.anim === 'reduced') return finish();
    el.classList.add('closing');
    el.inert = true; // waehrend des Ausblendens nimmt die Maske nichts mehr an
    setTimeout(finish, 220);
  }

  open = { el, close };
  auth.prepare();
  return open;
}
