import { h, icon } from './dom.js';
import { t, getLocale } from './i18n.js';
import { openModal } from './ui.js';
import { feed, subscribe, controllable, pausedOf, isSending, togglePause } from './sessions-feed.js';
import { positionOf, streamThumb } from './handoff.js';

/**
 * "Laeuft gerade" (Build 98 der Apple-App, Regeln 19 bis 21): wer gerade was schaut.
 * - Knopf in der Kapsel oben rechts, links neben dem Profil, gleich gross wie die anderen; nur solange mindestens ein Stream laeuft und die Startseite
 *   vorne ist (nur dann wird abgefragt, handoff.js). Ohne Zahl und ohne Punkt (Entscheidung des Nutzers bei der Apple-App); die Zahl nennt die
 *   Bezeichnung fuer Bildschirmleser ("Laeuft gerade, 2 Streams"). Nicht auf dem Fernseher (wie Apple TV).
 * - Ein Klick oeffnet ein Blatt: je Stream kleines Bild (bei Folgen das Standbild), "Name · Programm · Geraet", Titel, Folge, "Pausiert", Balken mit
 *   "14:51 / 23:42" (laufende Streams zaehlen jede Sekunde weiter, hoechstens 12 s ueber die gemeldete Stelle). Einem Administrator nennt der Server alle
 *   Konten, sonst nur die eigenen. Pause/Abspielen nur bei eigenen Streams, die sich steuern lassen; fremde nur ansehen. Leer: "Gerade laeuft nichts".
 */
const Handoff = window.JCHandoff;
const isTv = () => document.documentElement.dataset.form === 'tv';
const streamCount = (n) => t(n === 1 ? 'np.oneStream' : 'np.streams', { n });

/**
 * Der Knopf fuer die Kopfleiste (app.js buildShell); destroy beim Neubau des Rahmens. Er haengt nur in der Kapsel, solange er zu sehen ist (vor dem
 * Profilsymbol `before`): ein verborgener Knopf darin zaehlte fuer Fokus, Bildschirmleser und Masse der Kapsel mit.
 */
export function nowPlayingButton(before) {
  const btn = h('button', { class: 'tool now-playing', type: 'button', 'aria-haspopup': 'dialog' }, icon('play-circle', 21));
  btn.addEventListener('click', () => openNowPlaying());
  const paint = () => {
    const n = feed.streams.length;
    const show = n > 0 && !isTv() && !!before.parentNode;
    if (!show) {
      if (document.activeElement === btn) before.focus({ preventScroll: true });
      btn.remove();
      return;
    }
    if (btn.nextSibling !== before) before.before(btn);
    const label = `${t('np.title')}, ${streamCount(n)}`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  const off = subscribe(paint);
  return { paint, destroy: off };
}

/** Das Blatt "Laeuft gerade"; zeichnet sich bei jeder Abfrage und jede Sekunde neu, solange es offen ist. */
export function openNowPlaying() {
  const list = h('div', { class: 'np-list', role: 'list' });
  const empty = h('p', { class: 'np-empty', hidden: true }, t('np.empty'));
  const dialog = openModal({
    title: t('np.title'),
    body: h('div', { class: 'np-body' }, list, empty),
    wide: true,
    actions: [{ label: t('action.close'), focus: true, onclick: (close) => close() }]
  });
  const rows = new Map();

  function row(s) {
    let r = rows.get(s.id);
    if (!r) {
      const thumb = h('span', { class: 'np-thumb-slot' });
      const meta = h('span', { class: 'np-meta' });
      const title = h('span', { class: 'np-title' });
      const episode = h('span', { class: 'np-sub' });
      const state = h('span', { class: 'np-paused', hidden: true }, t('np.paused'));
      const fill = h('span', { class: 'handoff-bar-fill' });
      const time = h('span', { class: 'np-time' });
      const toggle = h('button', { type: 'button', class: 'handoff-toggle np-toggle', hidden: true });
      toggle.addEventListener('click', () => togglePause(r.s));
      const el = h(
        'div',
        { class: 'np-row', role: 'listitem' },
        thumb,
        h('div', { class: 'np-text' }, meta, title, episode, h('div', { class: 'np-pos' }, state, h('span', { class: 'handoff-bar' }, fill), time)),
        toggle
      );
      r = { el, thumb, meta, title, episode, state, fill, time, toggle, s, art: '' };
      rows.set(s.id, r);
    }
    r.s = s;
    if (r.art !== (s.nowPlaying?.id ?? '')) {
      r.art = s.nowPlaying?.id ?? '';
      r.thumb.replaceChildren(streamThumb(s, 'np-thumb'));
    }
    r.meta.textContent = [s.userName, s.client, s.deviceName].filter(Boolean).join(' · ');
    const lines = Handoff.itemLines(s, getLocale());
    r.title.textContent = lines.title;
    r.episode.textContent = lines.episode ?? '';
    r.episode.hidden = !lines.episode;
    const mine = controllable(s);
    r.toggle.hidden = !mine;
    if (mine) {
      const paused = pausedOf(s);
      const device = s.deviceName || t('handoff.unnamed');
      r.toggle.replaceChildren(icon(paused ? 'play' : 'pause', 18));
      r.toggle.setAttribute('aria-label', t(paused ? 'remote.play' : 'remote.pause', { device }));
      r.toggle.title = r.toggle.getAttribute('aria-label');
      r.toggle.classList.toggle('busy', isSending(s));
      r.toggle.setAttribute('aria-disabled', String(isSending(s)));
    }
    time(r);
    return r.el;
  }

  function time(r) {
    const paused = controllable(r.s) ? pausedOf(r.s) : r.s.isPaused;
    const p = positionOf(r.s, paused);
    r.state.hidden = !paused;
    r.time.textContent = p.text;
    r.fill.style.transform = `scaleX(${p.share})`;
  }

  function paint() {
    if (!dialog.el.isConnected) return cleanup();
    const ids = new Set(feed.streams.map((s) => s.id));
    for (const [id, r] of rows) {
      if (!ids.has(id)) {
        r.el.remove();
        rows.delete(id);
      }
    }
    feed.streams.forEach((s, i) => {
      const el = row(s);
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] ?? null);
    });
    empty.hidden = feed.streams.length > 0;
    list.hidden = feed.streams.length === 0;
  }

  const off = subscribe(paint);
  const timer = setInterval(() => {
    if (!dialog.el.isConnected) return cleanup();
    rows.forEach(time);
  }, 1000);
  function cleanup() {
    off();
    clearInterval(timer);
  }
  paint();
  return dialog;
}
