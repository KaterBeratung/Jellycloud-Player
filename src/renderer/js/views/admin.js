import { h, icon } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { api } from '../api.js';
import { state, activeServer } from '../state.js';
import { toast, confirmDialog, openModal, openMenu } from '../ui.js';
import { ticksToSec } from '../utils.js';

/**
 * Verwaltung fuer Jellyfin-Administratoren: Server (Info, Bibliotheken durchsuchen, Neustart, Herunterfahren), Aufgaben, Aktivitaet (Sitzungen und Protokoll), Benutzer.
 * Die Seite erscheint nur, wenn das Konto Administrator ist (state.isAdmin, aus der Richtlinie des Benutzers); der Server prueft es zusaetzlich und lehnt andere mit 403 ab.
 * Gefaehrliche Aktionen (Neustart, Herunterfahren, Loeschen) fragen vorher nach.
 */

const SECTIONS = [
  ['server', 'server'],
  ['tasks', 'refresh'],
  ['sessions', 'monitor'],
  ['users', 'user']
];
const POLL_MS = 5000;

const setting = (label, desc, control) =>
  h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), desc ? h('div', { class: 'setting-desc' }, desc) : null), h('div', { class: 'setting-control' }, control));
const group = (title, ...rows) => h('div', { class: 'settings-block' }, title ? h('h3', { class: 'group-title' }, title) : null, h('div', { class: 'settings-group' }, rows));
const note = (text, cls = '') => h('p', { class: `admin-note ${cls}`.trim() }, text);

/** "vor 3 Stunden", "gerade eben"; null bei fehlendem oder ungueltigem Datum. */
export function ago(dateStr, now = Date.now()) {
  const ms = Date.parse(dateStr ?? '');
  if (!Number.isFinite(ms)) return null;
  const sec = Math.round((ms - now) / 1000);
  if (Math.abs(sec) < 45) return t('admin.justNow');
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(sec) >= size || unit === 'minute') return rtf.format(Math.round(sec / size), unit);
  }
  return null;
}

const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${Math.floor((sec % 3600) / 60)}:${ss}`;
};

export function adminView({ section = 'server' }) {
  const el = h('div', { class: 'page settings admin' });
  const nav = h('nav', { class: 'settings-nav' });
  const panel = h('div', { class: 'settings-panel' });
  el.append(h('h1', { class: 'page-title' }, t('admin.title')), h('div', { class: 'settings-layout' }, nav, panel));

  let destroyed = false;
  let timer = null;
  const active = SECTIONS.some(([id]) => id === section) ? section : 'server';
  SECTIONS.forEach(([id, ic]) => nav.append(h('a', { class: `snav${id === active ? ' on' : ''}`, href: `#/admin/${id}` }, icon(ic, 18), h('span', null, t(`admin.sec.${id}`)))));

  const failure = (e, retry) => {
    if (e?.status === 403) return h('div', { class: 'empty error' }, icon('shield', 40), h('h3', null, t('admin.only')), h('p', null, t('admin.onlyText')));
    return h('div', { class: 'empty error' }, icon('info', 40), h('h3', null, t('error.loadFailed')), h('p', null, e?.message ?? ''), retry ? h('button', { class: 'btn primary', type: 'button', onclick: retry }, t('action.retry')) : null);
  };
  const guard = async (what, fn) => {
    try {
      return await fn();
    } catch (e) {
      toast(e?.status === 403 ? t('admin.onlyText') : `${what}: ${e?.message ?? e}`, { type: 'error' });
      return undefined;
    }
  };
  /** Zeichnet den Bereich neu, ohne die Seite zu verlieren; bei wiederholten Abfragen bleibt die alte Ansicht bis die neue da ist. */
  const show = (node) => {
    if (!destroyed) panel.replaceChildren(node);
  };

  // ---------- Server ----------
  async function serverPanel() {
    panel.replaceChildren(note(t('admin.loading')));
    let info;
    try {
      info = await api.getSystemInfo();
    } catch (e) {
      return show(failure(e, serverPanel));
    }
    if (destroyed) return;
    const yes = (v) => (v ? t('admin.yes') : t('admin.no'));
    const scan = h('button', { class: 'btn glass sm', type: 'button' }, icon('refresh', 16), h('span', null, t('admin.scanNow')));
    scan.addEventListener('click', async () => {
      scan.disabled = true;
      const ok = await guard(t('admin.scan'), () => api.refreshLibrary().then(() => true));
      scan.disabled = false;
      if (ok) toast(t('admin.scanStarted'));
    });
    const name = info.ServerName || 'Jellyfin';
    const restart = h('button', { class: 'btn danger sm', type: 'button' }, icon('power', 16), h('span', null, t('admin.restartBtn')));
    restart.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: t('admin.restartTitle'), text: t('admin.restartText'), confirmLabel: t('admin.restartConfirm'), danger: true }))) return;
      if (!(await confirmDialog({ title: t('admin.lastAsk'), text: t('admin.restartLast', { name }), confirmLabel: t('admin.restartConfirm'), danger: true }))) return;
      if (await guard(t('admin.restart'), () => api.restartServer().then(() => true))) toast(t('admin.restartSent'));
    });
    const shutdown = h('button', { class: 'btn danger sm', type: 'button' }, icon('power', 16), h('span', null, t('admin.shutdownBtn')));
    shutdown.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: t('admin.shutdownTitle'), text: t('admin.shutdownText'), confirmLabel: t('admin.shutdownConfirm'), danger: true }))) return;
      if (!(await confirmDialog({ title: t('admin.lastAsk'), text: t('admin.shutdownLast', { name }), confirmLabel: t('admin.shutdownConfirm'), danger: true }))) return;
      if (await guard(t('admin.shutdown'), () => api.shutdownServer().then(() => true))) toast(t('admin.shutdownSent'));
    });
    show(
      h(
        'div',
        { class: 'settings-stack' },
        group(
          t('admin.grp.server'),
          setting(t('admin.server.name'), null, name),
          setting(t('admin.server.version'), null, [info.ProductName, info.Version].filter(Boolean).join(' ')),
          setting(t('admin.server.os'), null, info.OperatingSystemDisplayName || info.OperatingSystem || '–'),
          setting(t('admin.server.address'), null, info.LocalAddress || '–'),
          setting(t('admin.server.pending'), null, yes(info.HasPendingRestart))
        ),
        group(t('admin.grp.library'), setting(t('admin.scan'), t('admin.scanDesc'), scan)),
        group(t('admin.grp.danger'), setting(t('admin.restart'), t('admin.restartDesc'), restart), setting(t('admin.shutdown'), t('admin.shutdownDesc'), shutdown))
      )
    );
  }

  // ---------- Aufgaben ----------
  async function tasksPanel(first = true) {
    if (first) panel.replaceChildren(note(t('admin.loading')));
    let tasks;
    try {
      tasks = await api.getScheduledTasks();
    } catch (e) {
      return first ? show(failure(e, () => tasksPanel())) : undefined;
    }
    if (destroyed) return;
    if (!tasks.length) return show(note(t('admin.tasks.empty')));
    const byCategory = new Map();
    for (const task of tasks) {
      const key = task.Category || '';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(task);
    }
    const statusText = (task) => {
      if (task.State === 'Running' || task.State === 'Cancelling') return t('admin.tasks.running', { p: Math.round(task.CurrentProgressPercentage ?? 0) });
      const r = task.LastExecutionResult;
      if (!r) return t('admin.tasks.never');
      return t('admin.tasks.last', { when: ago(r.EndTimeUtc ?? r.StartTimeUtc) ?? '–', status: t(`admin.tasks.status.${r.Status}`) });
    };
    const rows = [];
    for (const [category, list] of byCategory) {
      rows.push(
        group(
          category,
          ...list.map((task) => {
            const running = task.State === 'Running';
            const failed = !running && task.LastExecutionResult?.Status === 'Failed';
            const b = h('button', { class: `btn ${running ? 'danger' : 'glass'} sm`, type: 'button', 'data-task': task.Id }, icon(running ? 'stop' : 'play', 14), h('span', null, running ? t('admin.tasks.stop') : t('admin.tasks.start')));
            b.disabled = task.State === 'Cancelling';
            b.addEventListener('click', async () => {
              b.disabled = true;
              const ok = await guard(task.Name, () => (running ? api.stopTask(task.Id) : api.startTask(task.Id)).then(() => true));
              if (ok) toast(t(running ? 'admin.tasks.stopped' : 'admin.tasks.started', { name: task.Name }));
              tasksPanel(false);
            });
            const bar = running ? h('div', { class: 'admin-bar', role: 'progressbar', 'aria-valuenow': String(Math.round(task.CurrentProgressPercentage ?? 0)) }, h('i', { style: { width: `${Math.min(100, Math.max(2, task.CurrentProgressPercentage ?? 0))}%` } })) : null;
            return h(
              'div',
              { class: `setting admin-task${failed ? ' failed' : ''}` },
              h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, task.Name), task.Description ? h('div', { class: 'setting-desc' }, task.Description) : null, h('div', { class: `admin-status${running ? ' run' : failed ? ' bad' : ''}` }, statusText(task)), bar),
              h('div', { class: 'setting-control' }, b)
            );
          })
        )
      );
    }
    show(h('div', { class: 'settings-stack' }, rows));
  }

  // ---------- Aktivitaet: Sitzungen und Protokoll ----------
  async function sessionsPanel(first = true) {
    if (first) panel.replaceChildren(note(t('admin.loading')));
    let sessions;
    let log;
    try {
      [sessions, log] = await Promise.all([api.getSessions(), api.getActivity(60)]);
    } catch (e) {
      return first ? show(failure(e, () => sessionsPanel())) : undefined;
    }
    if (destroyed) return;
    const sessionRows = sessions.length
      ? sessions.map((s) => {
          const np = s.NowPlayingItem;
          let line = t('admin.sessions.idle');
          if (np) {
            const pos = ticksToSec(s.PlayState?.PositionTicks ?? 0);
            const total = ticksToSec(np.RunTimeTicks ?? 0);
            line = `${np.SeriesName ? `${np.SeriesName} · ` : ''}${np.Name}${total ? ` (${clock(pos)} / ${clock(total)})` : ''}${s.PlayState?.IsPaused ? ` · ${t('admin.sessions.paused')}` : ''}`;
          }
          return h(
            'div',
            { class: `setting admin-session${np ? ' playing' : ''}` },
            h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, s.UserName || '–'), h('div', { class: 'setting-desc' }, [s.Client, s.DeviceName].filter(Boolean).join(' · ')), h('div', { class: `admin-status${np ? ' run' : ''}` }, line)),
            h('div', { class: 'setting-control admin-when' }, ago(s.LastActivityDate) ?? '')
          );
        })
      : [h('div', { class: 'setting' }, h('div', { class: 'setting-desc' }, t('admin.sessions.empty')))];
    const logRows = log.length
      ? log.map((e) =>
          h(
            'div',
            { class: `setting admin-log sev-${String(e.Severity ?? 'Info').toLowerCase()}` },
            h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, e.Name), e.ShortOverview ? h('div', { class: 'setting-desc' }, e.ShortOverview) : null),
            h('div', { class: 'setting-control admin-when', title: e.Date ? new Date(e.Date).toLocaleString(getLocale()) : '' }, ago(e.Date) ?? '')
          )
        )
      : [h('div', { class: 'setting' }, h('div', { class: 'setting-desc' }, t('admin.activity.empty')))];
    show(h('div', { class: 'settings-stack' }, group(t('admin.sessions'), ...sessionRows), group(t('admin.activity'), ...logRows)));
  }

  // ---------- Benutzer ----------
  async function usersPanel() {
    panel.replaceChildren(note(t('admin.loading')));
    let users;
    try {
      users = await api.getUsers();
    } catch (e) {
      return show(failure(e, usersPanel));
    }
    if (destroyed) return;
    const norm = (id) => String(id ?? '').replace(/-/g, '').toLowerCase();
    const me = norm(activeServer()?.userId);
    const create = h('button', { class: 'btn primary sm', type: 'button' }, icon('plus', 16), h('span', null, t('admin.users.new')));
    create.addEventListener('click', () => createUserDialog(usersPanel));
    const rows = users
      .sort((a, b) => String(a.Name).localeCompare(String(b.Name), getLocale()))
      .map((u) => {
        const isMe = !!me && norm(u.Id) === me;
        const chips = [
          u.Policy?.IsAdministrator ? h('span', { class: 'admin-chip' }, t('admin.users.admin')) : null,
          u.Policy?.IsDisabled ? h('span', { class: 'admin-chip bad' }, t('admin.users.disabled')) : null,
          u.HasPassword === false ? h('span', { class: 'admin-chip warn' }, t('admin.users.noPw')) : null,
          isMe ? h('span', { class: 'admin-chip' }, t('admin.users.you')) : null
        ];
        const last = ago(u.LastActivityDate ?? u.LastLoginDate);
        const more = h('button', { class: 'btn glass sm icon-only', type: 'button', title: t('action.more'), 'aria-label': t('action.more') }, icon('more', 18));
        more.disabled = isMe;
        more.addEventListener('click', () => {
          const entries = [
            ...(u.Policy?.IsAdministrator ? [] : [{ id: 'toggle', label: t(u.Policy?.IsDisabled ? 'admin.users.enable' : 'admin.users.disable') }]),
            { id: 'reset', label: t('admin.users.resetPw') },
            { id: 'setpw', label: t('admin.users.setPw') },
            { id: 'delete', label: t('admin.users.delete') }
          ];
          openMenu(more, entries, { align: 'right', onPick: (e) => userAction(e.id, u) });
        });
        return h(
          'div',
          { class: `setting admin-user${u.Policy?.IsDisabled ? ' off' : ''}`, 'data-user': u.Name },
          h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, u.Name, ' ', chips), h('div', { class: 'setting-desc' }, last ? t('admin.users.last', { when: last }) : t('admin.users.never'))),
          h('div', { class: 'setting-control' }, isMe ? null : more)
        );
      });
    show(h('div', { class: 'settings-stack' }, h('div', { class: 'btn-row' }, create), group(t('admin.sec.users'), ...rows)));
  }

  async function userAction(id, u) {
    if (id === 'toggle') {
      const disable = !u.Policy?.IsDisabled;
      if (await guard(u.Name, () => api.setUserDisabled(u.Id, disable).then(() => true))) toast(t(disable ? 'admin.users.disabledDone' : 'admin.users.enabledDone', { name: u.Name }));
    } else if (id === 'reset') {
      if (!(await confirmDialog({ title: t('admin.users.resetTitle', { name: u.Name }), text: t('admin.users.resetText'), confirmLabel: t('admin.users.resetConfirm'), danger: true }))) return;
      if (await guard(u.Name, () => api.resetUserPassword(u.Id).then(() => true))) toast(t('admin.users.resetDone', { name: u.Name }));
    } else if (id === 'setpw') {
      await passwordDialog(u);
    } else if (id === 'delete') {
      if (!(await confirmDialog({ title: t('admin.users.deleteTitle', { name: u.Name }), text: t('admin.users.deleteText'), confirmLabel: t('admin.users.deleteConfirm'), danger: true }))) return;
      if (await guard(u.Name, () => api.deleteUser(u.Id).then(() => true))) toast(t('admin.users.deleted', { name: u.Name }));
    }
    if (!destroyed && active === 'users') usersPanel();
  }

  function createUserDialog(done) {
    const name = h('input', { class: 'field', type: 'text', maxlength: 64, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('admin.users.name'), placeholder: t('admin.users.name') });
    const pw = h('input', { class: 'field', type: 'password', maxlength: 200, autocomplete: 'new-password', 'aria-label': t('admin.users.password'), placeholder: t('admin.users.password') });
    const err = h('p', { class: 'mdl-error', hidden: true });
    const submit = async (close) => {
      err.hidden = true;
      if (!name.value.trim()) {
        err.textContent = t('admin.users.nameMissing');
        err.hidden = false;
        return name.focus();
      }
      try {
        const u = await api.createUser(name.value, pw.value);
        close();
        toast(t('admin.users.created', { name: u?.Name ?? name.value.trim() }));
        done();
      } catch (e) {
        err.textContent = e?.message ?? String(e);
        err.hidden = false;
      }
    };
    const dlg = openModal({
      title: t('admin.users.new'),
      body: h('div', { class: 'mdl-form' }, h('label', { class: 'mdl-field' }, h('span', null, t('admin.users.name')), name), h('label', { class: 'mdl-field' }, h('span', null, t('admin.users.password')), pw), err),
      actions: [
        { label: t('action.cancel'), onclick: (close) => close() },
        { label: t('admin.users.create'), primary: true, onclick: submit }
      ]
    });
    for (const input of [name, pw]) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit(dlg.close));
  }

  function passwordDialog(u) {
    return new Promise((resolve) => {
      const pw = h('input', { class: 'field', type: 'password', maxlength: 200, autocomplete: 'new-password', 'aria-label': t('admin.users.password') });
      const err = h('p', { class: 'mdl-error', hidden: true });
      const submit = async (close) => {
        err.hidden = true;
        if (!pw.value) {
          err.textContent = t('admin.users.pwMissing');
          err.hidden = false;
          return pw.focus();
        }
        try {
          await api.setUserPassword(u.Id, pw.value);
          close();
          toast(t('admin.users.setDone', { name: u.Name }));
          resolve();
        } catch (e) {
          err.textContent = e?.message ?? String(e);
          err.hidden = false;
        }
      };
      const dlg = openModal({
        title: t('admin.users.setTitle', { name: u.Name }),
        body: h('div', { class: 'mdl-form' }, h('label', { class: 'mdl-field' }, h('span', null, t('admin.users.password')), pw), err),
        onCancel: resolve,
        actions: [
          { label: t('action.cancel'), onclick: (close) => (close(), resolve()) },
          { label: t('admin.users.setConfirm'), primary: true, onclick: submit }
        ]
      });
      pw.addEventListener('keydown', (e) => e.key === 'Enter' && submit(dlg.close));
    });
  }

  // ---------- Aufbau ----------
  if (!state.isAdmin) {
    panel.append(failure({ status: 403 }));
  } else {
    const panels = { server: serverPanel, tasks: () => tasksPanel(true), sessions: () => sessionsPanel(true), users: usersPanel };
    panels[active]();
    // Aufgaben und Aktivitaet aktualisieren sich von selbst (Fortschritt, wer gerade schaut), solange die Seite offen und im Blick ist
    if (active === 'tasks' || active === 'sessions') {
      timer = setInterval(() => {
        if (destroyed || document.hidden || document.documentElement.classList.contains('playing') || document.querySelector('.mdl-scrim, .menu')) return;
        (active === 'tasks' ? tasksPanel : sessionsPanel)(false);
      }, POLL_MS);
    }
  }

  return {
    el,
    destroy() {
      destroyed = true;
      clearInterval(timer);
    }
  };
}
