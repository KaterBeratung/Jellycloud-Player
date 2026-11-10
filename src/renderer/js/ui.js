import { h, icon, $ } from './dom.js';
import { t } from './i18n.js';
import { blurhashUrl } from './blurhash.js';
import { posterOf, landscapeOf, itemHref } from './api.js';
import { fmtDuration, ticksToSec } from './utils.js';
import { markSharedElement } from './router.js';

const Media = window.JCMedia;

// ---------- Bilder mit Blurhash-Platzhalter ----------

/** Box mit weichem Platzhalter; das echte Bild blendet ein, sobald es geladen ist. */
export function lazyImage(img, { alt = '', cls = '', fit = 'cover', eager = false, fallback = '' } = {}) {
  const box = h('div', { class: `imgbox ${cls}`.trim() });
  // Mit "fallback" steht der Titel auf der Flaeche, wenn es kein Bild gibt oder es nicht ladbar ist.
  const showFallback = () => { if (fallback && !box.querySelector('.fallback-title')) box.append(h('span', { class: 'fallback-title' }, fallback)); };
  if (!img) {
    // Nicht "empty": diese Klasse ist der Leerzustand einer ganzen Seite (grosser Innenabstand) und wuerde runde Avatare verzerren.
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

// ---------- Badges ----------

export function badges(media, { max = 3 } = {}) {
  if (!media?.badges?.length) return null;
  return h('div', { class: 'badges' }, media.badges.slice(0, max).map((b) => h('span', { class: `badge ${b.kind}` }, b.text)));
}

export function mediaBadges(item) {
  const src = item.MediaSources?.[0] ?? (item.MediaStreams ? { MediaStreams: item.MediaStreams, Container: item.Container } : null);
  return src ? Media.describeMedia(src) : null;
}

// ---------- Karten ----------

function progressOf(item) {
  const u = item.UserData;
  if (!u) return 0;
  if (u.PlayedPercentage > 0 && u.PlayedPercentage < 100) return u.PlayedPercentage;
  if (u.PlaybackPositionTicks > 0 && item.RunTimeTicks) return Math.min(99, (u.PlaybackPositionTicks / item.RunTimeTicks) * 100);
  return 0;
}

function episodeLabel(item) {
  if (item.Type !== 'Episode') return '';
  const s = item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}:` : '';
  return `${s}E${item.IndexNumber ?? '?'}`;
}

export function titleOf(item) {
  return item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name;
}

const TILT_MAX = 7; // Grad

/**
 * Fokuseffekt wie bei tvOS: Die Karte neigt sich zum Mauszeiger und bekommt einen Glanzpunkt (CSS-Variablen --rx/--ry/--gx/--gy).
 * Nur mit der Maus und nur, wenn Animationen nicht ausgeschaltet sind. Gibt eine Funktion zurueck, die die Neigung zuruecksetzt.
 */
function attachTilt(card, thumb) {
  let frame = 0;
  const reset = () => {
    cancelAnimationFrame(frame);
    for (const k of ['--rx', '--ry', '--gx', '--gy']) thumb.style.removeProperty(k);
  };
  card.addEventListener('pointermove', (e) => {
    const mode = document.documentElement.dataset.anim;
    if (e.pointerType !== 'mouse' || mode === 'off') return;
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

/**
 * Poster- oder Landscape-Karte.
 * @param {{variant?:'poster'|'landscape', index?:number, showBadges?:boolean, onPlay?:(item:any)=>void}} opts
 */
export function card(item, { variant = 'poster', index = 0, showBadges = true, onPlay } = {}) {
  const landscape = variant === 'landscape';
  const img = landscape ? landscapeOf(item, 640) : posterOf(item, 380) ?? landscapeOf(item, 380);
  const a = h('a', { class: `card ${variant}`, href: itemHref(item), draggable: 'false', title: titleOf(item) });
  a.style.setProperty('--i', Math.min(index, 18));

  const thumb = h('div', { class: 'thumb' });
  const image = lazyImage(img, { alt: '', fallback: titleOf(item) });
  thumb.append(image);

  const u = item.UserData ?? {};
  if (u.Played && item.Type !== 'Series') thumb.append(h('span', { class: 'corner played' }, icon('check', 14)));
  else if (u.UnplayedItemCount > 0 && ['Series', 'Season', 'BoxSet'].includes(item.Type)) thumb.append(h('span', { class: 'corner count' }, String(u.UnplayedItemCount)));

  if (showBadges && !landscape) {
    const b = badges(mediaBadges(item), { max: 2 });
    if (b) thumb.append(b);
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

export function skeletonRow(variant = 'poster', n = 9) {
  return h(
    'section',
    { class: 'row skeleton' },
    h('div', { class: 'row-head' }, h('div', { class: 'sk sk-title' })),
    h('div', { class: 'scroller' }, Array.from({ length: n }, () => h('div', { class: `card ${variant}` }, h('div', { class: 'thumb sk' }), h('div', { class: 'meta' }, h('div', { class: 'sk sk-line' })))))
  );
}

/** Horizontale Reihe mit Pfeilen. Mit `render` baut die Reihe ihre Karten selbst (zum Beispiel die Anfrage-Karten von Seerr), sonst sind es Karten der Bibliothek. */
export function row(title, items, { variant = 'poster', href = null, showBadges = true, onPlay, sub = '', render = null } = {}) {
  const scroller = h('div', { class: 'scroller' });
  items.forEach((it, i) => scroller.append(render ? render(it, i) : card(it, { variant, index: i, showBadges, onPlay })));
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

export function closeMenu() {
  if (!openMenuState) return;
  const { el, off } = openMenuState;
  openMenuState = null;
  off();
  el.classList.add('closing');
  setTimeout(() => el.remove(), 140);
}

/**
 * Popover-Menue unter einem Anker-Element.
 * @param {{id:any,label:string,sub?:string,selected?:boolean,header?:boolean,disabled?:boolean,icon?:string}[]} entries
 */
export function openMenu(anchor, entries, { onPick, align = 'left', minWidth = 200, maxHeight = 360 } = {}) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' });
  let active = -1;
  const buttons = [];
  for (const e of entries) {
    if (e.header) {
      el.append(h('div', { class: 'menu-head' }, e.label));
      continue;
    }
    const b = h(
      'button',
      {
        class: `menu-item${e.selected ? ' selected' : ''}`,
        type: 'button',
        role: 'menuitem',
        disabled: e.disabled,
        onclick: () => {
          closeMenu();
          onPick?.(e);
        }
      },
      h('span', { class: 'check' }, e.selected ? icon('check', 16) : null),
      h('span', { class: 'txt' }, h('span', { class: 'lbl' }, e.label), e.sub ? h('span', { class: 'sub' }, e.sub) : null)
    );
    buttons.push(b);
    el.append(b);
  }
  // Lange Listen (z. B. Genres) verteilen sich auf mehrere Spalten, statt zu scrollen.
  const perColumn = Math.max(6, Math.min(12, Math.floor((innerHeight - 140) / 46)));
  if (entries.length > perColumn) {
    el.classList.add('multi');
    el.style.setProperty('--rows', String(Math.ceil(entries.length / Math.ceil(entries.length / perColumn))));
  }
  document.body.append(el);
  el.style.minWidth = `${Math.max(minWidth, anchor.getBoundingClientRect().width)}px`;
  el.style.maxHeight = `${Math.min(maxHeight, innerHeight - 40)}px`;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
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
    if (!el.contains(ev.target) && !anchor.contains(ev.target)) closeMenu();
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
  window.addEventListener('resize', closeMenu);
  openMenuState = {
    el,
    off: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
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
