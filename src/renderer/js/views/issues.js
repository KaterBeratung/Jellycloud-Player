// Gemeldete Probleme bei Seerr (wie IssuesView und IssueView der Apple-App, Build 94): eine Seite unter "Anfragen" mit den Meldungen (Offen/Gelöst),
// je Meldung eine Zeile wie eine Mitteilung (Plakat, Titel, Art mit Staffel und Folge, Stand als Tag, wer wann gemeldet hat); die Seite einer Meldung
// mit dem Verlauf als Gespraech (eigene Beitraege rechts), Antwortfeld fest unten, "Als gelöst markieren"/"Wieder öffnen" und "Meldung löschen" im Menue.
// Rechte wie Seerr (SeerrIssueRules): antworten und den Stand aendern darf, wer Probleme verwaltet, und der Meldende; loeschen der Verwalter, der
// Meldende nur, solange niemand geantwortet hat. Seerr entscheidet; eine abgelehnte Aktion erscheint als Hinweis.
import { h, icon } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { state } from '../state.js';
import { mapImage } from '../api.js';
import { lazyImage, openMenu, pageStatus, segmented, showPageStatus, toast, confirmDialog } from '../ui.js';
import { mediaTag } from '../tags.js';
import { navigate } from '../router.js';
import { seerrState, runSeerrCheck } from '../connection.js';
import { openSeerrTitle } from '../seerr-open.js';

const R = window.JCSeerrRequests;
const Issues = R.issues;
const Tags = window.JCMediaTags;
const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;

const user = () => (seerrState() === 'connected' ? state.connection?.seerr?.user ?? null : null);
const perms = () => user()?.permissions ?? 0;
const viewer = () => user()?.id ?? null;

/** Titel und Plakate der Meldungen, je Titel einmal (gemerkt, solange die App laeuft; ein Wechsel von Seerr leert sie). */
const titles = new Map();
document.addEventListener('seerr-changed', () => titles.clear());
function titleOf(issue) {
  const key = `${issue.mediaType}-${issue.tmdbId}`;
  if (!titles.has(key)) titles.set(key, window.jc.seerrMedia({ mediaType: issue.mediaType, tmdbId: issue.tmdbId }).catch(() => null));
  return titles.get(key);
}

const dateText = (iso) => (iso ? new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');
const timeText = (iso) => (iso ? new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
/** "Gemeldet von dir am 21. Nov. 2026" bzw. mit dem Namen des Meldenden. */
function origin(issue) {
  const who = viewer() !== null && issue.creatorId === viewer() ? t('req.detail.you') : issue.creatorName;
  const day = dateText(issue.created);
  return t(who ? (day ? 'issues.byOn' : 'issues.by') : day ? 'issues.on' : 'issues.reported', { who, date: day });
}
function stateTag(issue) {
  const tag = Tags.seerr(Issues.stateKind(issue), getLocale());
  return tag ? mediaTag({ ...tag, text: t(issue.open ? 'issues.open' : 'issues.resolved'), short: t(issue.open ? 'issues.open' : 'issues.resolved') }, { size: 'compact', surface: 'page' }) : null;
}
const failure = (e) => {
  if (e.code === 'SEERR_AUTH') return runSeerrCheck();
  toast(e.code === 'SEERR_DENIED' ? t('issues.denied') : e.code === 'SEERR_GONE' ? t('issues.gone') : t('seerr.error', { msg: e.message }), { type: 'error' });
};

/** Eine Zeile (wie eine Mitteilung): Plakat, Titel, Art, Stand und Herkunft. Das Plakat kommt nach. */
function issueRow(issue, { onOpen, head = false } = {}) {
  const poster = h('div', { class: 'notice-poster-host' }, lazyImage(null, { cls: 'notice-poster' }));
  const name = h('span', null, '…');
  const row = h(
    head ? 'div' : 'a',
    { class: `notice-card issue-row${head ? ' head' : ''}`, ...(head ? { role: 'button', tabindex: '0' } : { href: `#/issues/${issue.id}` }), 'data-id': issue.id },
    poster,
    h('div', { class: 'notice-text' }, h('div', { class: 'notice-title' }, name), h('p', { class: 'notice-message' }, Issues.subject(issue, t)), h('div', { class: 'notice-meta' }, stateTag(issue), h('span', null, origin(issue))))
  );
  titleOf(issue).then((m) => {
    name.textContent = m?.title ?? t(`seerr.${issue.mediaType}`);
    poster.replaceChildren(lazyImage(m?.posterPath && TMDB_PATH.test(m.posterPath) ? { url: mapImage(`jellycloud://tmdb/w185${m.posterPath}`), hash: null } : null, { cls: 'notice-poster', fallback: m?.title ?? '' }));
  });
  if (onOpen) {
    row.addEventListener('click', onOpen);
    row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && e.target === row && (e.preventDefault(), onOpen()));
  }
  return row;
}

const backLink = () => h('a', { class: 'settings-back sub', href: '#/requests' }, icon('chevron-left', 20), h('span', null, t('nav.requests')));

/** Die Liste: offen oder geloest, die zuletzt geaenderten zuerst (50; die Seite sagt, wenn es mehr sind). */
export function issuesView() {
  const el = h('div', { class: 'page notices-page issues-page', 'data-glow': 'requests' });
  const list = h('div', { class: 'notices-list' });
  const foot = h('p', { class: 'notices-foot', hidden: true });
  const seg = h('div', { class: 'issues-filter' });
  el.append(h('div', { class: 'notices-head' }, h('div', null, backLink(), h('h1', { class: 'page-title' }, t('issues.title')))), seg, list, foot);
  let open = true;
  let destroyed = false;
  let generation = 0;

  async function load() {
    const gen = ++generation;
    showPageStatus(el, null);
    list.replaceChildren(...Array.from({ length: 4 }, () => h('div', { class: 'notice-card sk-card' }, h('div', { class: 'notice-poster sk' }), h('div', { class: 'notice-text' }, h('div', { class: 'sk sk-line' })))));
    foot.hidden = true;
    try {
      const r = await window.jc.seerrIssues({ open });
      if (gen !== generation || destroyed) return;
      list.replaceChildren(...r.issues.map((x) => issueRow(x)));
      if (!r.issues.length) showPageStatus(el, pageStatus({ symbol: 'check-circle', title: t(open ? 'issues.emptyOpen' : 'issues.emptyResolved'), text: t('issues.emptyText') }));
      foot.textContent = r.total > r.issues.length ? t('issues.more', { n: r.issues.length, total: r.total }) : '';
      foot.hidden = !foot.textContent;
    } catch (e) {
      if (gen !== generation || destroyed || e.code === 'SEERR_STALE') return;
      list.replaceChildren();
      showPageStatus(el, pageStatus({ kind: 'failed', text: e.message, retry: load }));
    }
  }
  seg.append(segmented([{ value: 'open', label: t('issues.open') }, { value: 'resolved', label: t('issues.resolved') }], 'open', (v) => {
    open = v === 'open';
    load();
  }));
  if (!Issues.shows(perms())) showPageStatus(el, pageStatus({ symbol: 'warning', title: t('issues.title'), text: t('issues.noRight') }));
  else load();
  return { el, destroy: () => (destroyed = true) };
}

/** Eine Meldung: Kopf (oeffnet den Titel), Verlauf, Antwortfeld, Menue mit Stand und Loeschen. */
export function issueView({ id }) {
  const el = h('div', { class: 'page notices-page issue-page', 'data-glow': 'requests' });
  const moreBtn = h('button', { class: 'btn icon glass notices-more', type: 'button', title: t('action.more'), 'aria-label': t('action.more'), 'aria-haspopup': 'menu', hidden: true }, icon('more', 22));
  const headHost = h('div', { class: 'issue-head' });
  const thread = h('div', { class: 'issue-thread', role: 'log', 'aria-live': 'polite' });
  const field = h('textarea', { class: 'field issue-reply-field', rows: '1', maxlength: '2000', placeholder: t('issues.replyPh'), 'aria-label': t('issues.replyPh') });
  const send = h('button', { class: 'btn primary icon issue-send', type: 'button', title: t('issues.send'), 'aria-label': t('issues.send'), disabled: true }, icon('chevron-up', 20));
  const composer = h('div', { class: 'issue-reply', hidden: true }, field, send);
  el.append(h('div', { class: 'notices-head' }, h('div', null, h('a', { class: 'settings-back sub', href: '#/issues' }, icon('chevron-left', 20), h('span', null, t('issues.title')))), moreBtn), headHost, thread, composer);
  let issue = null;
  let busy = false;
  let destroyed = false;

  const paintSend = () => (send.disabled = busy || !Issues.comment(field.value));
  field.addEventListener('input', () => {
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
    paintSend();
  });
  field.addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), reply()));
  send.addEventListener('click', () => reply());

  function paint() {
    const own = (c) => viewer() !== null && c.authorId === viewer();
    headHost.replaceChildren(issueRow(issue, { head: true, onOpen: () => openSeerrTitle({ mediaType: issue.mediaType, tmdbId: issue.tmdbId }) }));
    const note = Issues.statusNote(issue);
    thread.replaceChildren(
      ...issue.comments.map((c, i) =>
        h(
          'div',
          { class: `issue-msg${own(c) ? ' own' : ''}${i === 0 ? ' first' : ''}` },
          h('div', { class: 'issue-bubble' }, c.message),
          h('div', { class: 'issue-msg-meta' }, [own(c) ? t('req.detail.you') : c.author || t('issues.someone'), timeText(c.created)].filter(Boolean).join(' · '))
        )
      ),
      ...(note ? [h('div', { class: 'issue-note' }, `${t(note.key)} · ${timeText(note.date)}`)] : [])
    );
    composer.hidden = !Issues.canAnswer(issue, viewer(), perms());
    moreBtn.hidden = !(Issues.canAnswer(issue, viewer(), perms()) || Issues.canDelete(issue, viewer(), perms()));
    paintSend();
  }

  async function load() {
    try {
      const next = await window.jc.seerrIssueGet(Number(id));
      if (destroyed) return;
      if (!next) return showPageStatus(el, pageStatus({ symbol: 'warning', title: t('issues.gone') }));
      issue = next;
      showPageStatus(el, null);
      paint();
    } catch (e) {
      if (destroyed || e.code === 'SEERR_STALE') return;
      showPageStatus(el, pageStatus({ kind: 'failed', text: e.code === 'SEERR_GONE' || e.status === 404 ? t('issues.gone') : e.message, retry: load }));
    }
  }

  async function run(fn, { reload = true } = {}) {
    if (busy) return false;
    busy = true;
    paintSend();
    try {
      await fn();
      if (reload) await load();
      return true;
    } catch (e) {
      failure(e);
      return false;
    } finally {
      busy = false;
      if (!destroyed) paintSend();
    }
  }

  async function reply() {
    const message = Issues.comment(field.value);
    if (!message || !issue) return;
    if (await run(() => window.jc.seerrIssueComment({ id: issue.id, message }))) {
      field.value = '';
      field.style.height = 'auto';
      paintSend();
    }
  }

  moreBtn.addEventListener('click', () => {
    if (!issue) return;
    const entries = [];
    if (Issues.canAnswer(issue, viewer(), perms())) entries.push({ id: 'state', label: t(issue.open ? 'issues.markResolved' : 'issues.reopen'), icon: issue.open ? 'check-circle' : 'refresh' });
    if (Issues.canDelete(issue, viewer(), perms())) entries.push(...(entries.length ? [{ separator: true }] : []), { id: 'delete', label: t('issues.delete'), icon: 'trash', danger: true });
    openMenu(moreBtn, entries, {
      align: 'right',
      columns: false,
      onPick: async (e) => {
        if (e.id === 'state') return run(() => window.jc.seerrIssueResolve({ id: issue.id, resolved: issue.open }));
        if (e.id === 'delete' && (await confirmDialog({ title: t('issues.deleteTitle'), text: t('issues.deleteText'), confirmLabel: t('issues.deleteConfirm'), danger: true }))) {
          if (await run(() => window.jc.seerrIssueDelete(issue.id), { reload: false })) {
            toast(t('issues.deleted'));
            navigate('/issues');
          }
        }
      }
    });
  });

  load();
  return { el, destroy: () => (destroyed = true) };
}
