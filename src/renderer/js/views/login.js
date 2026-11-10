import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';

/**
 * Anmelde-Bildschirm (Server, Benutzer/Passwort oder Quick Connect).
 * @param {{onDone:()=>void, onCancel?:()=>void}} o
 */
export function loginView({ onDone, onCancel }) {
  const el = h('div', { class: 'login page-enter' });
  const aurora = h('div', { class: 'aurora' }, h('i'), h('i'), h('i'));
  const panel = h('div', { class: 'login-card' });
  el.append(aurora, panel);
  let stopQc = null;

  const mark = h('div', { class: 'brand-mark' }, icon('cloud-logo', 72));
  const title = h('h1', null, 'Jellycloud Player');
  const sub = h('p', { class: 'sub' }, t('login.subtitle'));
  const err = h('div', { class: 'form-error', role: 'alert' });

  const url = h('input', { class: 'field', type: 'text', placeholder: 'jellyfin.example.com', autocomplete: 'url', spellcheck: 'false', 'aria-label': t('login.server') });
  const user = h('input', { class: 'field', type: 'text', placeholder: t('login.user'), autocomplete: 'username', spellcheck: 'false', 'aria-label': t('login.user') });
  const pass = h('input', { class: 'field', type: 'password', placeholder: t('login.password'), autocomplete: 'current-password', 'aria-label': t('login.password') });
  const submit = h('button', { class: 'btn primary lg block', type: 'submit' }, h('span', null, t('login.signIn')));
  const qcBtn = h('button', { class: 'btn glass lg block', type: 'button' }, icon('link', 18), h('span', null, t('login.quickConnect')));
  const form = h('form', { class: 'login-form', novalidate: true }, h('label', null, h('span', null, t('login.server')), url), h('label', null, h('span', null, t('login.user')), user), h('label', null, h('span', null, t('login.password')), pass), err, submit, qcBtn);

  const saved = state.servers;
  if (saved.length) url.value = saved[saved.length - 1].url;
  const recent = saved.length
    ? h(
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
                  pass.focus();
                }
              }
            },
            icon('server', 16),
            h('span', null, `${s.name || s.url} · ${s.userName}`)
          )
        )
      )
    : null;

  panel.append(mark, title, sub, form);
  if (recent) panel.append(recent);
  if (onCancel) panel.append(h('button', { class: 'link-btn center', type: 'button', onclick: onCancel }, t('action.cancel')));

  function showError(msg) {
    err.textContent = msg;
    panel.classList.remove('shake');
    void panel.offsetWidth;
    panel.classList.add('shake');
  }
  function busy(on) {
    submit.disabled = on;
    qcBtn.disabled = on;
    submit.classList.toggle('loading', on);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    if (!url.value.trim()) return showError(t('login.needServer'));
    busy(true);
    try {
      await window.jc.login({ url: url.value, username: user.value, password: pass.value });
      onDone();
    } catch (e) {
      showError(e.status === 401 ? t('login.badCredentials') : e.message);
    } finally {
      busy(false);
    }
  });

  qcBtn.addEventListener('click', async () => {
    err.textContent = '';
    if (!url.value.trim()) return showError(t('login.needServer'));
    busy(true);
    try {
      const qc = await window.jc.quickConnectStart(url.value);
      const box = h(
        'div',
        { class: 'qc' },
        h('p', null, t('login.qcHint')),
        h('div', { class: 'qc-code' }, qc.code.split('').map((c) => h('span', null, c))),
        h('button', { class: 'link-btn center', type: 'button', onclick: () => cancelQc() }, t('action.cancel'))
      );
      form.hidden = true;
      recent?.setAttribute('hidden', '');
      panel.insertBefore(box, form.nextSibling);
      let alive = true;
      const cancelQc = () => {
        alive = false;
        box.remove();
        form.hidden = false;
        recent?.removeAttribute('hidden');
      };
      stopQc = () => {
        alive = false;
      };
      while (alive) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive) break;
        const r = await window.jc.quickConnectPoll({ url: qc.url, name: qc.name, secret: qc.secret });
        if (r.done) {
          alive = false;
          onDone();
        }
      }
    } catch (e) {
      showError(e.message);
    } finally {
      busy(false);
    }
  });

  requestAnimationFrame(() => (url.value ? user.focus() : url.focus()));
  return { el, destroy: () => stopQc?.() };
}
