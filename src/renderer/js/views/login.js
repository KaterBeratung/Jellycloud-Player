import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { connectBrand, qcHeader, qcDigits, rise } from './connect-parts.js';

/**
 * Anmeldung (Server, Benutzer und Passwort, oder Quick Connect), gestaltet wie die Apple-App (Features/Connect/ConnectView.swift): Marke oben, darunter
 * drei Kapselfelder, "Anmelden" und als zweiter Knopf "Mit Quick Connect anmelden". Quick Connect ersetzt die Maske ganz: dann stehen nur Marke und
 * Karte mit dem Code in Ziffernkacheln da; "Zurueck" bringt die Maske mit allen Eingaben wieder. Beim Hinzufuegen steht "Abbrechen" oben links.
 * @param {{onDone:()=>void, onCancel?:()=>void}} o
 */
export function loginView({ onDone, onCancel }) {
  // Hintergrund: der Ambient Glow des Bereichs Anmeldung (glow.js)
  const el = h('div', { class: 'login page-enter', 'data-glow': 'signIn' });
  const col = h('div', { class: 'connect-col' });
  el.append(col);
  let stopQc = null;

  const err = h('div', { class: 'form-error', role: 'alert' });
  const url = h('input', { class: 'field', type: 'text', placeholder: t('login.serverPlaceholder'), autocomplete: 'url', spellcheck: 'false', autocapitalize: 'off', inputmode: 'url', 'aria-label': t('login.server') });
  const user = h('input', { class: 'field', type: 'text', placeholder: t('login.user'), autocomplete: 'username', spellcheck: 'false', autocapitalize: 'off', 'aria-label': t('login.user') });
  const pass = h('input', { class: 'field', type: 'password', placeholder: t('login.password'), autocomplete: 'current-password', 'aria-label': t('login.password') });
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, h('span', null, t('login.signIn')));
  const qcBtn = h('button', { class: 'btn glass lg block', type: 'button' }, icon('qc', 18), h('span', null, t('login.quickConnect')));
  const form = h(
    'form',
    { class: 'login-form', novalidate: true },
    rise(h('div', { class: 'login-fields' }, url, user, pass), 3),
    err,
    rise(submit, 4),
    rise(qcBtn, 5)
  );

  const saved = state.servers;
  if (saved.length) url.value = saved[saved.length - 1].url;
  // Gemerkte Profile: ein Tipp wechselt zu ihnen (etwa nachdem die Anmeldung des aktiven abgelaufen ist)
  const recent = saved.length
    ? rise(
        h(
          'div',
          { class: 'recent' },
          h('span', { class: 'sub' }, t('login.saved')),
          saved.map((s) =>
            h(
              'button',
              {
                class: 'chip-btn',
                type: 'button',
                onclick: async () => {
                  try {
                    await window.jc.switchServer(s.id);
                    onDone();
                  } catch (e) {
                    showError(e.message);
                    url.value = s.url;
                    user.value = s.userName ?? '';
                    sync();
                    pass.focus();
                  }
                }
              },
              icon('person-circle', 18),
              h('span', null, `${s.label || s.userName} · ${s.name || s.url}`)
            )
          )
        ),
        6
      )
    : null;

  col.append(connectBrand(onCancel ? t('login.subtitleAdd') : t('login.subtitle')), form);
  if (recent) col.append(recent);
  const cancel = onCancel ? h('button', { class: 'btn glass connect-cancel', type: 'button', onclick: onCancel }, icon('chevron-left', 18), h('span', null, t('action.cancel'))) : null;
  if (cancel) el.append(cancel);

  let busyNow = false;
  /** "Anmelden" erst mit Adresse und Benutzer, Quick Connect erst mit Adresse (wie die Apple-App); waehrend einer Anfrage keines von beiden. */
  function sync() {
    submit.disabled = busyNow || !url.value.trim() || !user.value.trim();
    qcBtn.disabled = busyNow || !url.value.trim();
  }
  for (const f of [url, user, pass]) {
    f.addEventListener('input', () => {
      f.removeAttribute('aria-invalid');
      if (f !== url) (f === user ? pass : user).removeAttribute('aria-invalid'); // Benutzer und Passwort gehoeren zusammen
      sync();
    });
  }
  url.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), user.focus()));
  user.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), pass.focus()));

  /** Fehler der Anmeldung als Satz: falsches Passwort, Grenze von vier Profilen (der Server hat die neue Sitzung schon wieder abgemeldet), sonst die Meldung. */
  const loginError = (e) => (e.code === 'PROFILE_LIMIT' ? t('login.profileLimit', { n: state.maxProfiles ?? 4 }) : e.status === 401 ? t('login.badCredentials') : e.message);
  /** Welches Feld der Fehler betrifft: die Adresse (kein Server unter ihr) oder Benutzer und Passwort (abgelehnt). */
  function markInvalid(e) {
    if (e.status === 401) {
      user.setAttribute('aria-invalid', 'true');
      pass.setAttribute('aria-invalid', 'true');
    } else if (e.code === 'OFFLINE' || e.code === 'TIMEOUT' || /nicht erreichbar|kein Jellyfin|Server-Adresse/i.test(e.message ?? '')) {
      url.setAttribute('aria-invalid', 'true');
    }
  }
  function showError(msg) {
    err.textContent = msg;
    col.classList.remove('shake');
    void col.offsetWidth;
    col.classList.add('shake');
  }
  function busy(on) {
    busyNow = on;
    submit.classList.toggle('loading', on);
    sync();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busyNow) return; // Eingabetaste waehrend einer laufenden Anmeldung: nicht doppelt anmelden
    err.textContent = '';
    if (!url.value.trim()) return showError(t('login.needServer'));
    busy(true);
    try {
      await window.jc.login({ url: url.value, username: user.value, password: pass.value });
      onDone();
    } catch (e) {
      markInvalid(e);
      showError(loginError(e));
    } finally {
      busy(false);
    }
  });

  let qcBox = null;
  /** Zurueck zur Maske: der Code und das Warten sind weg, die Eingaben stehen wieder da. */
  function closeQc() {
    stopQc?.();
    stopQc = null;
    qcBox?.remove();
    qcBox = null;
    form.hidden = false;
    recent?.removeAttribute('hidden');
  }

  qcBtn.addEventListener('click', async () => {
    if (busyNow) return;
    err.textContent = '';
    if (!url.value.trim()) return showError(t('login.needServer'));
    busy(true);
    try {
      const qc = await window.jc.quickConnectStart(url.value);
      const digits = qcDigits({ code: qc.code });
      const back = h('button', { class: 'btn glass', type: 'button', onclick: () => closeQc() }, t('login.qcBack'));
      qcBox = h(
        'div',
        { class: 'connect-card qc-panel' },
        qcHeader(),
        h('p', { class: 'qc-text' }, t('login.qcHint')),
        digits.el,
        h('div', { class: 'qc-wait' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, t('login.qcWaiting'))),
        back
      );
      form.hidden = true;
      recent?.setAttribute('hidden', '');
      col.insertBefore(qcBox, form.nextSibling);
      requestAnimationFrame(() => back.focus());
      let alive = true;
      stopQc = () => {
        alive = false;
      };
      busy(false);
      while (alive) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive) break;
        const r = await window.jc.quickConnectPoll({ url: qc.url, name: qc.name, secret: qc.secret });
        if (!alive) break;
        if (r.done) {
          alive = false;
          onDone();
        }
      }
    } catch (e) {
      closeQc(); // abgelehnt (z. B. Profilgrenze) oder Fehler beim Abfragen: zurueck zur Maske, sonst bliebe der Code stehen
      markInvalid(e);
      showError(loginError(e));
    } finally {
      busy(false);
    }
  });

  // Escape: erst Quick Connect verlassen, sonst (beim Hinzufuegen) abbrechen. Offene Fenster und Menues behandeln Escape selbst vorher.
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (qcBox) {
      e.preventDefault();
      closeQc();
    } else if (onCancel) {
      e.preventDefault();
      onCancel();
    }
  };
  document.addEventListener('keydown', onKey);

  sync();
  requestAnimationFrame(() => (url.value ? user.focus() : url.focus()));
  return {
    el,
    destroy: () => {
      stopQc?.();
      document.removeEventListener('keydown', onKey);
    }
  };
}
