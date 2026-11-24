// "Anfrage ändern" (wie RequestTargetEditor der Apple-App, Build 95): Zielserver, Qualitaetsprofil, Stammordner und "Anfragen als" einer ausstehenden
// Anfrage, als Blatt aus Zeilen der Einstellungen. Zur Wahl steht nur, was Seerr anbietet (GET /service/radarr|sonarr, /service/.../<n>, /user); ein
// Serverwechsel nimmt Profil und Ordner des neuen Servers, bis man waehlt. "Anfragen als" nur mit den Rechten fuer Anfragen und Benutzer. Speichern erst,
// wenn sich etwas geaendert hat. Antwortet mit dem ganzen Stand fuer PUT /request (JCSeerrRequests.editBody) oder null (abgebrochen).
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { openModal, openMenu } from '../ui.js';

const Requests = window.JCSeerrRequests;

function choiceButton(read, options, onPick, label) {
  const text = h('span');
  const b = h('button', { class: 'btn glass sm select', type: 'button', 'aria-label': label }, text, icon('chevron-down', 14));
  const paint = () => {
    const list = options();
    text.textContent = list.find((o) => o.value === read())?.label ?? t('req.edit.default');
    b.disabled = list.length === 0;
  };
  b.addEventListener('click', () => openMenu(b, options().map((o) => ({ id: o.value, label: o.label, selected: o.value === read() })), { align: 'right', columns: false, maxHeight: 360, onPick: (e) => onPick(e.id) }));
  paint();
  return { el: b, paint };
}

/**
 * @param {object} r Anfrage (normalizeRequest)
 * @param {{permissions:number, title:string}} o
 * @returns {Promise<object|null>}
 */
export async function editRequestTarget(r, { permissions, title }) {
  const movie = r.mediaType === 'movie';
  const withUsers = Requests.canChangeRequester(permissions);
  const [allServers, users] = await Promise.all([window.jc.seerrServices(movie), withUsers ? window.jc.seerrRequesters().catch(() => []) : Promise.resolve([])]);
  const servers = Requests.serversFor(allServers, r);
  const start = { serverId: r.serverId, profileId: r.profileId, rootFolder: r.rootFolder, userId: r.requesterId };
  const target = { ...start };
  let choices = { profiles: [], folders: [] };
  const changed = () => JSON.stringify(target) !== JSON.stringify(start);

  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    let modal = null;
    const controls = [];
    const paint = () => {
      controls.forEach((c) => c.paint());
      if (modal) modal.buttons[1].disabled = !changed();
    };
    const loadChoices = async () => {
      const id = target.serverId ?? servers.find((s) => s.isDefault)?.id ?? null;
      choices = id === null ? { profiles: [], folders: [] } : await window.jc.seerrServiceChoices({ movie, serverId: id }).catch(() => ({ profiles: [], folders: [] }));
      paint();
    };
    const row = (label, control) => h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label)), h('div', { class: 'setting-control' }, control.el));
    const server = choiceButton(() => target.serverId, () => servers.map((s) => ({ value: s.id, label: s.isDefault ? t('req.edit.defaultServer', { name: s.name }) : s.name })), (id) => {
      const s = servers.find((x) => x.id === id);
      if (!s || s.id === target.serverId) return;
      target.serverId = s.id;
      target.profileId = s.activeProfileId;
      target.rootFolder = s.activeDirectory;
      paint();
      loadChoices();
    }, t('req.edit.server'));
    const profile = choiceButton(() => target.profileId, () => choices.profiles.map((p) => ({ value: p.id, label: p.name })), (id) => {
      target.profileId = id;
      paint();
    }, t('req.edit.profile'));
    const folder = choiceButton(() => target.rootFolder, () => choices.folders.map((f) => ({ value: f, label: f })), (f) => {
      target.rootFolder = f;
      paint();
    }, t('req.edit.folder'));
    controls.push(server, profile, folder);
    const rows = [row(t('req.edit.server'), server), row(t('req.edit.profile'), profile), row(t('req.edit.folder'), folder)];
    if (withUsers && users.length) {
      const user = choiceButton(() => target.userId, () => users.map((u) => ({ value: u.id, label: u.name })), (id) => {
        target.userId = id;
        paint();
      }, t('req.edit.user'));
      controls.push(user);
      rows.push(row(t('req.edit.user'), user));
    }
    const body = h('div', { class: 'season-chooser request-editor' }, h('p', { class: 'season-chooser-sub' }, title), h('div', { class: 'settings-group' }, rows), h('p', { class: 'group-foot' }, t(servers.length ? 'req.edit.note' : 'req.edit.noServers')));
    modal = openModal({
      title: t('req.edit.title'),
      body,
      onCancel: () => answer(null),
      actions: [
        { label: t('action.cancel'), variant: 'glass', onclick: (close) => (close(), answer(null)) },
        { label: t('req.edit.save'), variant: 'primary', onclick: (close) => {
          if (!changed()) return;
          close();
          answer(Requests.editBody(r, target));
        } }
      ]
    });
    paint();
    loadChoices();
  });
}
