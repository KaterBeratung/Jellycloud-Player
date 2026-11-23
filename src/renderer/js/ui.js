import { h, icon, $ } from './dom.js';
import { t } from './i18n.js';
import { blurhashUrl } from './blurhash.js';
import { api, posterOf, landscapeOf, itemHref } from './api.js';
import { fmtDuration, ticksToSec } from './utils.js';
import { markSharedElement } from './router.js';
import { cardTags } from './tags.js';
import { attachItemMenu } from './actions.js';


// ---------- Bilder mit Blurhash-Platzhalter ----------

/** Box mit weichem Platzhalter; das echte Bild blendet ein, sobald es geladen ist. */
export function lazyImage(img, { alt = '', cls = '', fit = 'cover', eager = false, fallback = '' } = {}) {
  const box = h('div', { class: `imgbox ${cls}`.trim() });
  // Mit "fallback" steht der Titel auf der Flaeche, wenn es kein Bild gibt oder es nicht ladbar ist.
  const showFallback = () => { if (fallback && !box.querySelector('.fallback-title')) box.append(h('span', { class: 'fallback-title' }, fallback)); };
  if (!img) {
    box.classList.add('noimg');
    showFallback();
    return box;
  }
  const ph = blurhashUrl(img.hash);
  if (ph) box.style.backgroundImage = `url(${ph})`;
  const el = h('img', { alt, decoding: 'async', draggable: 'false' });
  if (!eager) el.loading = 'lazy';
  el.style.objectFit = fit;
  el.addEventListener('load', () => el.classList.add('loaded'), { once: true });
  el.addEventListener('error', () => { box.classList.add('failed'); showFallback(); }, { once: true });
  el.src = img.url;
  box.append(el);
  return box;
}

/** Bis zu zwei Initialen aus einem Namen ("Antonio González Guerrero" -> "AG"). */
export function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

// ---------- Karten ----------

function progressOf(item) {
  const u = item.UserData;
  if (!u) return 0;
  if (u.PlayedPercentage > 0 && u.PlayedPercentage < 100) return u.PlayedPercentage;
  if (u.PlaybackPositionTicks > 0 && item.RunTimeTicks) return Math.min(99, (u.PlaybackPositionTicks / item.RunTimeTicks) * 100);
  return 0;
}

/** "S1 · E3" einer Folge (src/shared/format.js), sonst leer. */
const episodeLabel = (item) => (item.Type === 'Episode' ? window.JCFormat.episodeNumbers(item) : '');

export function titleOf(item) {
  return item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name;
}

const TILT_MAX = 7; // Grad

/**
 * Fokuseffekt wie bei tvOS: Die Karte neigt sich zum Mauszeiger und bekommt einen Glanzpunkt (CSS-Variablen --rx/--ry/--gx/--gy).
 * Nur mit der Maus und nur, wenn Animationen nicht ausgeschaltet sind. Gibt eine Funktion zurueck, die die Neigung zuruecksetzt.
 */
export function attachTilt(card, thumb) {
  let frame = 0;
  const reset = () => {
    cancelAnimationFrame(frame);
    for (const k of ['--rx', '--ry', '--gx', '--gy']) thumb.style.removeProperty(k);
  };
  card.addEventListener('pointermove', (e) => {
    const mode = document.documentElement.dataset.anim;
    if (e.pointerType !== 'mouse') return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Die Karte selbst wird nicht transformiert, ihr Rahmen bleibt daher ein stabiler Bezug (anders als das geneigte Bild).
      const r = card.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (clientX - r.left) / (thumb.offsetWidth || 1)));
      const py = Math.min(1, Math.max(0, (clientY - r.top) / (thumb.offsetHeight || 1)));
      const max = mode === 'reduced' ? TILT_MAX / 2 : TILT_MAX;
      thumb.style.setProperty('--ry', `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
      thumb.style.setProperty('--rx', `${(-(py - 0.5) * 2 * max).toFixed(2)}deg`);
      thumb.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      thumb.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    });
  });
  card.addEventListener('pointerleave', reset);
  return reset;
}

const cardOptions = new WeakMap(); // Karte -> ihre Optionen, um sie mit dem frischen Stand des Servers an ihrem Platz neu zu bauen (refreshCards)

/**
 * Poster- oder Landscape-Karte.
 * Tags (4K, HDR, Premium-Ton, HD) stehen unten links auf dem Poster, hoechstens zwei; es gibt keinen Schalter dafuer (wie in der Apple-App).
 * Rechtsklick, langes Druecken und die Menue-Taste oeffnen das Kontextmenue des Eintrags (actions.js attachItemMenu, wie ItemActions der Apple-App).
 * @param {{variant?:'poster'|'landscape', index?:number, onPlay?:(item:any)=>void}} opts
 */
export function card(item, { variant = 'poster', index = 0, onPlay } = {}) {
  const landscape = variant === 'landscape';
  const img = landscape ? landscapeOf(item, 640) : posterOf(item, 380) ?? landscapeOf(item, 380);
  const a = h('a', { class: `card ${variant}`, href: itemHref(item), draggable: 'false', title: titleOf(item), 'data-item-id': item.Id });
  a.style.setProperty('--i', Math.min(index, 18));
  cardOptions.set(a, { variant, index, onPlay });

  const thumb = h('div', { class: 'thumb' });
  const image = lazyImage(img, { alt: '', fallback: titleOf(item) });
  thumb.append(image);

  const u = item.UserData ?? {};
  if (u.Played && item.Type !== 'Series') thumb.append(h('span', { class: 'corner played' }, icon('check', 14)));
  else if (u.UnplayedItemCount > 0 && ['Series', 'Season', 'BoxSet'].includes(item.Type)) thumb.append(h('span', { class: 'corner count' }, String(u.UnplayedItemCount)));

  if (!landscape) {
    const tags = cardTags(item, { max: 2 });
    if (tags) thumb.append(tags);
  }
  const p = progressOf(item);
  if (p > 0) {
    const bar = h('div', { class: 'progress' }, h('i'));
    bar.firstChild.style.width = `${p}%`;
    thumb.append(bar);
  }
  if (item.Type !== 'Series' && item.Type !== 'BoxSet' && item.Type !== 'Folder' && item.Type !== 'CollectionFolder') {
    const fab = h(
      'button',
      {
        class: 'play-fab',
        type: 'button',
        'aria-label': t('action.play'),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          onPlay?.(item);
        }
      },
      icon('play', 22)
    );
    thumb.append(fab);
  }
  a.append(thumb);
  attachItemMenu(a, () => item, { anchor: thumb });
  const resetTilt = attachTilt(a, thumb);
  // Vor dem Seitenwechsel die Neigung loesen, damit die geteilte Poster-Animation von einer geraden Karte startet
  if (!landscape) a.addEventListener('click', () => { resetTilt(); markSharedElement(thumb); });

  let line1 = titleOf(item);
  let line2 = '';
  if (landscape) {
    if (item.Type === 'Episode') line2 = `${episodeLabel(item)} · ${item.Name}`;
    else line2 = [item.ProductionYear, u.PlaybackPositionTicks && item.RunTimeTicks ? t('card.remaining', { time: fmtDuration(ticksToSec(item.RunTimeTicks - u.PlaybackPositionTicks)) }) : ''].filter(Boolean).join(' · ');
  } else if (item.Type === 'Episode') {
    line2 = `${episodeLabel(item)} · ${item.Name}`;
  } else {
    line2 = item.Type === 'Series' && item.Status === 'Continuing' && item.ProductionYear ? `${item.ProductionYear} –` : item.ProductionYear ?? '';
  }
  a.append(h('div', { class: 'meta' }, h('div', { class: 'l1' }, line1), line2 ? h('div', { class: 'l2' }, String(line2)) : null));
  return a;
}

/**
 * Baut die Karten eines Eintrags in den Ansichten unter roots (auch solchen im Speicher des Routers, ausserhalb des Dokuments) mit dem Stand des Servers
 * neu, an ihrem Platz: ohne Einblenden (nichts flackert), der Fokus bleibt auf der Karte. Der Eintrag wird nur einmal geholt; ist er nicht zu holen,
 * bleibt alles, wie es war.
 */
export async function refreshCards(id, roots) {
  const found = (roots ?? []).flatMap((root) => [...root.querySelectorAll('.card[data-item-id]')].filter((el) => el.dataset.itemId === id && cardOptions.has(el)));
  if (!found.length) return;
  let fresh;
  try {
    fresh = await api.getItem(id);
  } catch {
    return;
  }
  for (const old of found) {
    if (!old.parentNode) continue; // inzwischen weg (Reihe neu aufgebaut)
    const next = card(fresh, cardOptions.get(old));
    next.classList.add('settled');
    const focused = document.activeElement === old;
    old.replaceWith(next);
    if (focused) next.focus({ preventScroll: true });
  }
}

export function skeletonRow(variant = 'poster', n = 9) {
  return h(
    'section',
    { class: 'row skeleton' },
    h('div', { class: 'row-head' }, h('div', { class: 'sk sk-title' })),
    h('div', { class: 'scroller' }, Array.from({ length: n }, () => h('div', { class: `card ${variant}` }, h('div', { class: 'thumb sk' }), h('div', { class: 'meta' }, h('div', { class: 'sk sk-line' })))))
  );
}

// ---------- Zustaende einer Seite ----------

/**
 * Leer-, Fehler- und Aktionszustand (wie PageStatus der Apple-App): ein Baustein fuer alle Seiten, keine Seite baut ihn selbst. Laden zeigen die Seiten weiter mit
 * Platzhaltern in der Form ihres Inhalts (skeletonRow, Platzhalter-Karten).
 * - kind 'empty': Symbol, Ueberschrift, Text. 'failed': Warnsymbol, Ueberschrift (sonst "Das konnte nicht geladen werden"), Meldung und mit `retry` der Knopf
 *   "Erneut versuchen" (zweiter Knopf; waehrend der Versuch laeuft, ist er gesperrt, ein zweiter Klick bleibt ohne Wirkung). 'action': Hinweis mit Hauptaktion
 *   (`action`: { label, href } oder { label, run }). 'loading': ein Zustand, der erst geklaert wird (etwa die Pruefung von Seerr), mit Kreisel statt Symbol;
 *   er erscheint erst nach einem Augenblick, so dass eine schnelle Antwort nichts aufblitzen laesst.
 * - Als ganze Seite (Standard) liegt der Hinweis in der Mitte des Inhaltsbereichs, der Knopf haengt darunter und verschiebt ihn nicht. Er gehoert dann in die Seite
 *   selbst (showPageStatus) oder in einen Behaelter ohne eigene Lage (position: static, etwa das Raster der Mediathek). `inline`: im Inhalt, der Knopf in der Folge.
 * - `more`: weitere, leisere Wege unter dem Knopf (etwa "Anderes Profil waehlen" beim Start ohne Verbindung).
 */
export function pageStatus({ kind = 'empty', symbol, title, text = '', retry = null, action = null, inline = false, more = [] } = {}) {
  const mark = kind === 'loading' ? h('span', { class: 'spinner lg', 'aria-hidden': 'true' }) : icon(symbol ?? (kind === 'failed' ? 'warning' : 'info'), 40);
  const notice = h('div', { class: 'ps-notice' }, mark, h('h3', null, title ?? t('error.loadFailed')), text ? h('p', null, text) : null);
  let button = null;
  if (kind === 'failed' && retry) {
    button = h('button', { class: 'btn glass', type: 'button' }, t('action.retry'));
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await retry();
      } finally {
        button.disabled = false;
      }
    });
  } else if (kind === 'action' && action) {
    button = action.href ? h('a', { class: 'btn primary', href: action.href }, action.label) : h('button', { class: 'btn primary', type: 'button', onclick: action.run }, action.label);
  }
  if (button || more.length) notice.append(h('div', { class: 'ps-action' }, button, ...more));
  return h('div', { class: `page-status${inline ? ' inline' : ''}`, 'data-kind': kind, role: kind === 'failed' ? 'alert' : 'status' }, notice);
}

/** Setzt den Hinweis fuer die ganze Seite (pageStatus) direkt in die Seite oder nimmt ihn mit null weg; je Seite hoechstens einer. */
export function showPageStatus(page, status) {
  page.querySelector(':scope > .page-status')?.remove();
  if (status) page.append(status);
  return status;
}

/**
 * "Informationen" am Ende einer Detailseite, in Spalten wie in der Apple-TV-App (InformationBlock der Apple-App): je Gruppe eine Ueberschrift und Zeilen aus
 * Bezeichnung und Wert; ein Wert mit Zeilenumbruechen (Tonspuren) steht in mehreren Zeilen. Gemeinsam fuer die Mediathek (detail-facts.js) und Seerr-Titel (seerr-facts.js).
 * @param {string} title @param {{title:string, rows:{label:string, value:string}[]}[]} groups
 */
export function infoBlock(title, groups) {
  return h(
    'section',
    { class: 'info-block' },
    h('h2', null, title),
    h('div', { class: 'info-groups' }, groups.map((g) => h('div', { class: 'info-group' }, h('h3', null, g.title), h('dl', null, g.rows.flatMap((r) => [h('dt', null, r.label), h('dd', null, r.value)])))))
  );
}

/** Horizontale Reihe mit Pfeilen. Mit `render` baut die Reihe ihre Karten selbst (zum Beispiel die Anfrage-Karten von Seerr), sonst sind es Karten der Bibliothek. */
export function row(title, items, { variant = 'poster', href = null, onPlay, sub = '', render = null } = {}) {
  const scroller = h('div', { class: 'scroller' });
  items.forEach((it, i) => scroller.append(render ? render(it, i) : card(it, { variant, index: i, onPlay })));
  const left = h('button', { class: 'arrow left', type: 'button', 'aria-label': 'Zurück' }, icon('chevron-left', 22));
  const right = h('button', { class: 'arrow right', type: 'button', 'aria-label': 'Weiter' }, icon('chevron-right', 22));
  const sec = h(
    'section',
    { class: 'row' },
    // Mit Ziel: der Titel selbst ist der Link, gefolgt von einem Pfeil (wie bei Apple TV)
    h('div', { class: 'row-head' }, href ? h('a', { class: 'row-title', href, 'aria-label': `${title} – ${t('action.all')}` }, h('h2', null, title), icon('chevron-right', 22)) : h('h2', null, title), sub ? h('span', { class: 'sub' }, sub) : null),
    h('div', { class: 'row-body' }, left, scroller, right)
  );
  const update = () => {
    const max = scroller.scrollWidth - scroller.clientWidth - 2;
    left.classList.toggle('off', scroller.scrollLeft <= 2);
    right.classList.toggle('off', scroller.scrollLeft >= max);
  };
  const page = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.86, behavior: 'smooth' });
  left.addEventListener('click', () => page(-1));
  right.addEventListener('click', () => page(1));
  scroller.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
  new ResizeObserver(update).observe(scroller);
  return sec;
}

// ---------- Menues ----------

let openMenuState = null;
document.addEventListener('route', () => closeMenu()); // ein Menue gehoert zu seiner Seite

export function closeMenu() {
  if (!openMenuState) return;
  const { el, off, anchor } = openMenuState;
  openMenuState = null;
  off();
  // Wie ein Menue des Systems: lag der Fokus im Menue, geht er an den Knopf zurueck, der es geoeffnet hat (Tastatur, Bildschirmleser; eine danach
  // geoeffnete Maske kehrt beim Schliessen dorthin zurueck)
  if (el.contains(document.activeElement) && anchor?.isConnected) anchor.focus({ preventScroll: true });
  el.classList.add('closing');
  setTimeout(() => el.remove(), 140);
}

/**
 * Popover-Menue unter einem Anker-Element.
 * Haken und Symbole teilen sich eine Spalte (wie die Menues der Apple-App): ein gewaehlter Eintrag zeigt den Haken, sonst sein Symbol (icon);
 * Eintraege ohne beides bleiben buendig. separator: Trennlinie zwischen Abschnitten; danger: Eintrag in der Farbe der Gefahr (Abmelden).
 * columns: false haelt das Menue in einer Spalte (Profilmenue), sonst verteilen sich lange Listen auf mehrere.
 * at: { x, y } legt das Menue an den Mauszeiger wie ein Kontextmenue des Systems (rechts unterhalb, sonst links bzw. oberhalb); ein Klick daneben
 * schliesst es dann auch auf dem Anker. Ein Seitenwechsel und das Mausrad ausserhalb des Menues schliessen jedes Menue (es bliebe sonst ohne seinen Anker stehen).
 * @param {{id?:any,label?:string,sub?:string,selected?:boolean,header?:boolean,separator?:boolean,disabled?:boolean,icon?:string,danger?:boolean}[]} entries
 */
export function openMenu(anchor, entries, { onPick, align = 'left', minWidth = 200, maxHeight = 360, columns = true, at = null } = {}) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' });
  let active = -1;
  const buttons = [];
  for (const e of entries) {
    if (e.header) {
      el.append(h('div', { class: 'menu-head' }, e.label));
      continue;
    }
    if (e.separator) {
      el.append(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    const b = h(
      'button',
      {
        class: `menu-item${e.selected ? ' selected' : ''}${e.danger ? ' danger' : ''}`,
        type: 'button',
        role: 'menuitem',
        disabled: e.disabled,
        onclick: () => {
          closeMenu();
          onPick?.(e);
        }
      },
      h('span', { class: `check${!e.selected && e.icon ? ' sym' : ''}` }, e.selected ? icon('check', 16) : e.icon ? icon(e.icon, 16) : null),
      h('span', { class: 'txt' }, h('span', { class: 'lbl' }, e.label), e.sub ? h('span', { class: 'sub' }, e.sub) : null)
    );
    buttons.push(b);
    el.append(b);
  }
  // Lange Listen (z. B. Genres) verteilen sich auf mehrere Spalten, statt zu scrollen.
  const perColumn = Math.max(6, Math.min(12, Math.floor((innerHeight - 140) / 46)));
  if (columns && entries.length > perColumn) {
    el.classList.add('multi');
    el.style.setProperty('--rows', String(Math.ceil(entries.length / Math.ceil(entries.length / perColumn))));
  }
  document.body.append(el);
  el.style.minWidth = `${Math.max(minWidth, at ? 0 : anchor.getBoundingClientRect().width)}px`;
  el.style.maxHeight = `${Math.min(maxHeight, innerHeight - 40)}px`;
  const place = () => {
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    if (at) {
      const left = at.x + mw > innerWidth - 10 ? at.x - mw : at.x;
      const top = at.y + mh > innerHeight - 10 ? at.y - mh : at.y;
      el.style.left = `${Math.max(10, Math.min(left, innerWidth - mw - 10))}px`;
      el.style.top = `${Math.max(10, Math.min(top, innerHeight - mh - 10))}px`;
      return;
    }
    const r = anchor.getBoundingClientRect();
    let left = align === 'right' ? r.right - mw : r.left;
    left = Math.max(10, Math.min(left, innerWidth - mw - 10));
    let top = r.bottom + 8;
    if (top + mh > innerHeight - 10) top = Math.max(10, r.top - mh - 8);
    top = Math.max(10, Math.min(top, innerHeight - 10 - mh)); // passt es weder unter noch ueber den Anker, ganz an den Rand ruecken (nie unten aus dem Bild)
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place); // nach dem ersten Zeichnen noch einmal: Hoehe (umbrechende Eintraege) und Lage des Ankers (einblendende Seite) koennen sich dann geaendert haben
  const selectedIdx = buttons.findIndex((b) => b.classList.contains('selected'));
  const focusAt = (i) => {
    if (!buttons.length) return;
    active = (i + buttons.length) % buttons.length;
    buttons[active].focus();
    buttons[active].scrollIntoView({ block: 'nearest' });
  };
  // Maus und Tastatur teilen sich eine Hervorhebung: faehrt die Maus auf einen Eintrag, wandert der Fokus dorthin (sonst waere der zuerst fokussierte Eintrag weiter hervorgehoben
  // und zwei Eintraege leuchten zugleich); die Pfeiltasten gehen danach von diesem Eintrag aus
  buttons.forEach((b, i) =>
    b.addEventListener('pointermove', () => {
      if (active === i) return;
      active = i;
      b.focus({ preventScroll: true });
    })
  );
  const onDown = (ev) => {
    if (!el.contains(ev.target) && (at || !anchor.contains(ev.target))) closeMenu();
  };
  // Scrollt der Nutzer ausserhalb des Menues (Mausrad, Touchpad), schliesst es; nicht bei jedem "scroll" (auch eine Reihe, die sich von selbst an ihre Stelle
  // schiebt, oder ein Fokus, der etwas ins Bild holt, meldet eines, und das Menue ginge gleich nach dem Oeffnen wieder zu). Finger: pointerdown oben.
  const onWheel = (ev) => {
    if (!el.contains(ev.target)) closeMenu();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      focusAt(active + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      focusAt(active - 1);
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: true });
  window.addEventListener('resize', closeMenu);
  openMenuState = {
    el,
    anchor,
    off: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('resize', closeMenu);
    }
  };
  requestAnimationFrame(() => {
    el.classList.add('open');
    focusAt(selectedIdx >= 0 ? selectedIdx : 0);
  });
  return el;
}

// ---------- Toasts ----------

export function toast(message, { type = 'info', action = null, duration = 4200 } = {}) {
  let host = $('#toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast ${type}` }, h('span', { class: 'msg' }, message));
  if (action) {
    el.append(
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onclick: () => {
            action.run();
            dismiss();
          }
        },
        action.label
      )
    );
  }
  const dismiss = () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 260);
  };
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(dismiss, duration);
  return dismiss;
}

// ---------- Dialoge ----------

let openModalState = null;

/**
 * Modales Fenster ueber der Seite (Titel, Inhalt, Knoepfe). Escape und Klick neben das Fenster schliessen es (onCancel). Der Fokus bleibt darin (Tab springt im Kreis),
 * danach kehrt er zum vorherigen Element zurueck. actions: [{ label, variant, onclick(close), primary, disabled }]; gibt { close, el, buttons } zurueck.
 */
export function openModal({ title, body, actions = [], wide = false, onCancel = null, labelledBy = 'mdl-title' } = {}) {
  openModalState?.close();
  const previous = document.activeElement;
  const btns = actions.map((a) =>
    h('button', { type: 'button', class: `btn ${a.variant ?? 'glass'}${a.primary ? ' primary' : ''}`, disabled: a.disabled }, a.label)
  );
  const box = h(
    'div',
    { class: `mdl${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy },
    h('h2', { class: 'mdl-title', id: labelledBy }, title),
    h('div', { class: 'mdl-body' }, body),
    actions.length ? h('div', { class: 'mdl-actions' }, btns) : null
  );
  const scrim = h('div', { class: 'mdl-scrim' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), 160);
    if (openModalState?.el === scrim) openModalState = null;
    try {
      previous?.focus?.();
    } catch {
      /* Element schon weg */
    }
  };
  const cancel = () => {
    close();
    onCancel?.();
  };
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Tab') {
      const items = [...box.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  actions.forEach((a, i) => btns[i].addEventListener('click', () => a.onclick?.(close)));
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) cancel();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  openModalState = { el: scrim, close };
  // Fokus: das erste Eingabefeld, sonst der vorgesehene Knopf (bei gefaehrlichen Aktionen der Abbrechen-Knopf)
  requestAnimationFrame(() => (box.querySelector('input, textarea, select') ?? btns.find((_, i) => actions[i].focus) ?? btns.at(-1))?.focus());
  return { close, el: box, buttons: btns };
}

/**
 * Rueckfrage mit Ja/Nein. danger: roter Bestaetigen-Knopf, der Fokus liegt auf "Abbrechen". Antwortet mit true (bestaetigt) oder false (abgebrochen, Escape, Klick daneben).
 */
export function confirmDialog({ title, text, confirmLabel, cancelLabel = t('action.cancel'), danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    const body = h('div', { class: 'mdl-text' }, ...(Array.isArray(text) ? text : [text]).map((p) => (typeof p === 'string' ? h('p', null, p) : p)));
    openModal({
      title,
      body,
      onCancel: () => answer(false),
      actions: [
        { label: cancelLabel, variant: 'glass', focus: danger, onclick: (close) => (close(), answer(false)) },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', primary: !danger, focus: !danger, onclick: (close) => (close(), answer(true)) }
      ]
    });
  });
}

// ---------- Kleine Bedienelemente ----------

export function button(label, { variant = 'ghost', iconName = null, onclick, cls = '', title } = {}) {
  return h('button', { type: 'button', class: `btn ${variant} ${cls}`.trim(), onclick, title }, iconName ? icon(iconName, 18) : null, label ? h('span', null, label) : null);
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  const thumb = h('span', { class: 'seg-thumb' });
  wrap.append(thumb);
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', class: `seg${o.value === value ? ' on' : ''}`, role: 'radio', 'aria-checked': o.value === value, onclick: () => select(o.value) }, o.label);
    wrap.append(b);
    return b;
  });
  const place = () => {
    const on = btns.find((b) => b.classList.contains('on'));
    if (!on) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  function select(v) {
    btns.forEach((b, i) => {
      const on = options[i].value === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    });
    place();
    onChange(v);
  }
  requestAnimationFrame(() => {
    place();
    wrap.classList.add('ready');
  });
  new ResizeObserver(place).observe(wrap);
  return wrap;
}

export function toggle(value, onChange, label = '') {
  const b = h('button', { type: 'button', class: `switch${value ? ' on' : ''}`, role: 'switch', 'aria-checked': String(!!value), 'aria-label': label }, h('i'));
  b.addEventListener('click', () => {
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
    onChange(on);
  });
  return b;
}

export function slider({ min, max, step = 1, value, onInput, format = (v) => v }) {
  const out = h('output', null, String(format(value)));
  const input = h('input', { type: 'range', min, max, step, value });
  const paint = () => input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => {
    out.textContent = String(format(+input.value));
    paint();
    onInput(+input.value);
  });
  paint();
  return h('div', { class: 'slider' }, input, out);
}
