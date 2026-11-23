import { h, icon } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { mapImage } from '../api.js';
import { lazyImage, openMenu, pageStatus, showPageStatus, toast } from '../ui.js';
import { mediaTag } from '../tags.js';
import { openSeerrTitle } from '../seerr-open.js';
import { applyNotices, readNotices, syncNotices } from '../notices.js';

const N = window.JCNotifications; // Wortlaut, Stand (src/shared/notifications.js)
const Tags = window.JCMediaTags;
const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;

/** "vor 3 Minuten", "gestern" in der Sprache der Oberflaeche. */
function relative(iso) {
  const sec = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const fmt = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const abs = Math.abs(sec);
  if (abs < 45) return fmt.format(0, 'second');
  if (abs < 45 * 60) return fmt.format(Math.round(sec / 60), 'minute');
  if (abs < 20 * 3600) return fmt.format(Math.round(sec / 3600), 'hour');
  if (abs < 6 * 86400) return fmt.format(Math.round(sec / 86400), 'day');
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

/**
 * Die Mitteilungen des aktiven Profils (NotificationsView der Apple-App): eine Seite, kein Reiter, geoeffnet aus dem Profilmenue. Neueste zuerst, je Mitteilung
 * eine Karte (Flaeche ohne Glas, Entscheidung E11) mit Plakat, Ueberschrift (ungelesen halbfett mit rotem Punkt), Text, Stand als Tag und Zeit in Worten.
 * Antippen oeffnet den Titel (Detailseite der Mediathek, sonst seine Seite bei Seerr; nie eine Wiedergabe) und merkt die Mitteilung als gelesen. Rechtsklick,
 * langes Druecken und die Menue-Taste: gelesen/ungelesen, entfernen (statt Wischen, E11). "Mehr": Alle gelesen, Alle entfernen (ohne Rueckfrage, wie die
 * Mitteilungszentrale). Beim Oeffnen einmal ausdruecklich abgleichen.
 */
export function notificationsView() {
  const el = h('div', { class: 'page notices-page', 'data-glow': 'settings' });
  const moreBtn = h('button', { class: 'btn icon glass notices-more', type: 'button', title: t('action.more'), 'aria-label': t('action.more'), 'aria-haspopup': 'menu' }, icon('more', 22));
  const list = h('div', { class: 'notices-list' });
  const foot = h('p', { class: 'notices-foot', hidden: true }, t('notify.footer'));
  el.append(h('div', { class: 'notices-head' }, h('h1', { class: 'page-title' }, t('notify.title')), moreBtn), list, foot);

  let data = null;
  let destroyed = false;
  const take = (d) => {
    if (destroyed || !d) return;
    data = d;
    applyNotices(d);
    paint();
  };

  function paint() {
    const items = data?.items ?? [];
    moreBtn.disabled = !items.length;
    foot.hidden = !items.length;
    if (!items.length) {
      list.replaceChildren();
      // Ohne Seerr, ausgeschaltet oder einfach noch nichts: die leere Seite sagt, was gilt
      const text = !data?.active ? t('notify.emptyNoSeerr') : data.preferences?.enabled ? t('notify.emptyText') : t('notify.emptyOff');
      showPageStatus(el, pageStatus({ symbol: 'bell', title: t('notify.emptyTitle'), text }));
      return;
    }
    showPageStatus(el, null);
    const focusedId = document.activeElement?.closest?.('.notice-card')?.dataset.id ?? null;
    list.replaceChildren(...items.map(card));
    if (focusedId) list.querySelector(`.notice-card[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

  const act = (fn) => fn().then(take, (e) => toast(e.message, { type: 'error' }));

  function card(n) {
    const lang = getLocale();
    const poster = lazyImage(TMDB_PATH.test(n.posterPath ?? '') ? { url: mapImage(`jellycloud://tmdb/w185${n.posterPath}`), hash: null } : null, { cls: 'notice-poster', fallback: n.title });
    const tag = Tags.seerr(N.stateOf(n), lang);
    const title = N.headline(n, lang);
    const text = N.message(n, lang);
    const c = h(
      'div',
      { class: `notice-card${n.read ? '' : ' unread'}`, role: 'button', tabindex: '0', 'data-id': n.id, 'aria-label': `${n.read ? '' : `${t('notify.unread')}. `}${title}. ${text}` },
      poster,
      h(
        'div',
        { class: 'notice-text' },
        h('div', { class: 'notice-title' }, n.read ? null : h('span', { class: 'unread-dot', 'aria-hidden': 'true' }), h('span', null, title)),
        h('p', { class: 'notice-message' }, text),
        h('div', { class: 'notice-meta' }, tag ? mediaTag(tag, { size: 'compact', surface: 'page' }) : null, h('time', { datetime: n.date, title: new Date(n.date).toLocaleString(lang) }, relative(n.date)))
      )
    );
    const open = () => {
      if (!n.read) act(() => window.jc.notificationRead({ id: n.id }));
      // Was die Mitteilung ueber den Titel weiss, zeigt seine Seite sofort, mit einem Stand, der zur Nachricht passt (kein "Anfragen" fuer einen Augenblick)
      openSeerrTitle({ mediaType: n.mediaType, tmdbId: n.tmdbId, known: N.knownTitle(n) });
    };
    c.addEventListener('click', open);
    c.addEventListener('keydown', (e) => {
      if (e.target !== c || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      open();
    });
    // Rechtsklick am Mauszeiger; langes Druecken und Tastatur unter der Karte
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const atPointer = e.pointerType === 'mouse' || e.pointerType === 'pen' || (e.pointerType === undefined && e.button === 2);
      openMenu(
        c,
        [
          { id: 'read', label: n.read ? t('notify.markUnread') : t('notify.markRead'), icon: n.read ? 'envelope' : 'envelope-open' },
          { separator: true },
          { id: 'remove', label: t('notify.remove'), icon: 'trash', danger: true }
        ],
        {
          at: atPointer ? { x: e.clientX, y: e.clientY } : null,
          columns: false,
          minWidth: 230,
          onPick: (x) => act(() => (x.id === 'remove' ? window.jc.notificationRemove(n.id) : window.jc.notificationRead({ id: n.id, read: !n.read })))
        }
      );
    });
    return c;
  }

  moreBtn.addEventListener('click', () => {
    const items = data?.items ?? [];
    if (!items.length) return;
    openMenu(
      moreBtn,
      [
        { id: 'readAll', label: t('notify.readAll'), icon: 'envelope-open', disabled: !items.some((n) => !n.read) },
        { id: 'removeAll', label: t('notify.removeAll'), icon: 'trash', danger: true }
      ],
      { align: 'right', columns: false, minWidth: 220, onPick: (x) => act(() => (x.id === 'removeAll' ? window.jc.notificationsRemoveAll() : window.jc.notificationsReadAll())) }
    );
  });

  // Eine Aenderung anderswo (Abgleich im Hintergrund, anderes Profil): die Liste neu lesen
  const onChange = () => readNotices().then(take);
  document.addEventListener('notices-changed', onChange);

  // Beim Oeffnen: sofort, was da ist; dann der Stand bei Seerr (hier erwartet der Nutzer ihn aktuell)
  readNotices().then((d) => {
    take(d);
    if (!destroyed && d?.active) syncNotices({ force: true }).then(take);
  });

  return {
    el,
    destroy() {
      destroyed = true;
      document.removeEventListener('notices-changed', onChange);
    }
  };
}
