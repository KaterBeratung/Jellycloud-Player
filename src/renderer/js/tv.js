/**
 * TV-Ansicht (Android TV, Google TV; seit 1.2.28): gilt, wenn die Huelle <html data-form="tv"> setzt (mobile/host-capacitor.js, JellycloudPlayerPlugin.device).
 * Bedient wird mit der Fernbedienung wie bei Apple TV:
 *  - Pfeiltasten bewegen den Fokus raeumlich (naechstes Element in der Richtung, in Reihen zuerst innerhalb derselben Zeile); offene Menues, Fenster und
 *    Masken halten den Fokus bei sich. Textfelder: links/rechts im Text, bis an den Rand; Regler: links/rechts aendern den Wert.
 *  - OK oeffnet bzw. drueckt; lang gedrueckt (oder die Menue-Taste) oeffnet das Kontextmenue einer Karte oder Folge.
 *  - Zurueck schliesst zuerst ein Menue oder Fenster; auf einer Startseite eines Reiters springt der Fokus erst in die Reiterleiste, dann geht die App weg.
 *  - Der Fokus wird sichtbar (Karten heben sich, Knoepfe werden hell; app.css "TV-Ansicht") und immer ins Bild geholt: Reihen scrollen seitlich, die Seite so,
 *    dass die Reihe mit Titel oben steht. Die Kopfleiste gleitet weg, sobald der Fokus im Inhalt liegt und die Seite gescrollt ist.
 *  - Nach einem Seitenwechsel bekommt die Seite den Fokus (Hauptknopf, sonst erstes Element); zurueck auf einer gemerkten Seite steht er, wo er war.
 * Auf allen anderen Geraeten tut das Modul nichts.
 */
const root = document.documentElement;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** Elemente mit Kontextmenue (langes Druecken von OK). */
const MENU_TARGETS = '.card, .ep, .t10-card, [data-item-menu]';
const LONG_PRESS_MS = 550;
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

let installed = false;
/** Gemerkter Fokus je Seite (die Seite selbst ist der Schluessel: gemerkte Ansichten des Routers kommen als dieselbe zurueck). */
const lastFocus = new WeakMap();
let lastRect = null;
let focusedPage = null; // Seite des zuletzt fokussierten Elements (beim Entfernen ist es nicht mehr im Dokument)
let press = null; // laufendes Druecken von OK auf einem Element mit Kontextmenue
let lastKeyAt = 0; // letzte Taste der Fernbedienung (ein vorlaeufiger Fokus nach dem Seitenwechsel wird danach nicht mehr verschoben)

export const isTv = () => root.dataset.form === 'tv';

const reduced = () => root.dataset.anim === 'reduced';
const view = () => document.getElementById('view');
const topbar = () => document.querySelector('.topbar');

/** Die oberste Ebene, in der sich der Fokus bewegen darf: Menue, Fenster, Maske, sonst die ganze Seite. */
function layer() {
  const menu = [...document.querySelectorAll('.menu')].filter((m) => !m.classList.contains('closing')).pop();
  if (menu) return menu;
  const modal = [...document.querySelectorAll('[aria-modal="true"]')].filter((m) => !m.closest('.closing') && m.isConnected).pop();
  return modal ?? document.body;
}

function visible(el) {
  if (!el.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  // Deckkraft zaehlt nicht: Karten blenden beim Erscheinen ein und sind trotzdem schon erreichbar
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** Ziele, die selbst ein Ganzes sind (Folge, Mitteilung): Links darin (Titel der Folge) erreicht die Fernbedienung nicht einzeln, OK wirkt auf das Ganze. */
const WHOLE = '.ep, .notice-card, .issue-row';

function candidates(scope) {
  return [...scope.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('.drag-strip, .titlebar, .tabbar') && !el.parentElement?.closest(WHOLE) && visible(el));
}

/** Seite (oberstes Kind von #view), zu der ein Element gehoert. */
const pageOf = (el) => (el instanceof Element ? el.closest('#view > *') : null);

/**
 * Naechstes Element in der Richtung: zuerst die naechste "Linie" (kleinster Abstand in Bewegungsrichtung, mit etwas Spielraum), darin das, was quer
 * dazu am naechsten liegt. Seitwaerts haben Elemente in derselben Zeile Vorrang (Reihen bleiben Reihen).
 */
function pick(from, dir, list) {
  const a = from.getBoundingClientRect();
  const horizontal = dir === 'left' || dir === 'right';
  const items = [];
  const fromRow = from.closest('.row');
  for (const el of list) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    // Titel einer Reihe ("Alle ..."): nur von ihren eigenen Karten nach oben, sonst landet der Fokus beim Runtergehen auf dem Titel statt auf einer Karte
    if (el.matches('.row-title') && !(dir === 'up' && fromRow && el.closest('.row') === fromRow)) continue;
    const b = el.getBoundingClientRect();
    let gap;
    if (dir === 'right') gap = b.left - a.right;
    else if (dir === 'left') gap = a.left - b.right;
    else if (dir === 'down') gap = b.top - a.bottom;
    else gap = a.top - b.bottom;
    // In Richtung muss es wirklich weitergehen (Ueberlappung bis zur Haelfte erlaubt)
    const ahead = dir === 'right' ? b.left + b.width / 2 > a.left + a.width / 2 + 1 && b.right > a.right - 1
      : dir === 'left' ? b.left + b.width / 2 < a.left + a.width / 2 - 1 && b.left < a.left + 1
      : dir === 'down' ? b.top + b.height / 2 > a.top + a.height / 2 + 1 && b.bottom > a.bottom - 1
      : b.top + b.height / 2 < a.top + a.height / 2 - 1 && b.top < a.top + 1;
    if (!ahead) continue;
    const overlap = horizontal ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const cross = horizontal ? Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) : Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
    items.push({ el, gap: Math.max(0, gap), overlap, cross });
  }
  if (!items.length) return null;
  let pool = items;
  if (horizontal) {
    // Seitwaerts nur in derselben Zeile: am Ende einer Reihe bleibt der Fokus stehen (wie Apple TV), statt in eine andere Reihe zu springen
    pool = items.filter((i) => i.overlap > Math.min(8, a.height / 4));
    if (!pool.length) return null;
  }
  const nearest = Math.min(...pool.map((i) => i.gap));
  const line = pool.filter((i) => i.gap <= nearest + 24);
  line.sort((x, y) => x.cross - y.cross || x.gap - y.gap);
  return line[0].el;
}

/** Bewegt den Fokus; die Kopfleiste zaehlt nur, wenn im Inhalt nichts mehr in der Richtung liegt (oben ueber der ersten Reihe). */
function move(dir) {
  const scope = layer();
  const active = document.activeElement;
  const all = candidates(scope);
  if (!active || active === document.body || !scope.contains(active) || !visible(active)) {
    // Fokus verloren (Element neu gebaut, Ebene gewechselt): das naechstgelegene Element bzw. das erste Ziel der Ebene
    if (scope === document.body) recover(null, true);
    else focusInitial(scope);
    return true;
  }
  const bar = topbar();
  let target = null;
  if (scope === document.body && bar && !bar.contains(active)) target = pick(active, dir, all.filter((el) => !bar.contains(el)));
  if (!target) target = pick(active, dir, all);
  if (!target) return false;
  focusEl(target);
  return true;
}

/** Fokus setzen und ins Bild holen. */
function focusEl(el, { scroll = true } = {}) {
  el.focus({ preventScroll: true });
  if (scroll) reveal(el);
}

/** Holt ein Element ins Bild: seitlich in seiner Reihe, senkrecht so, dass seine Reihe (mit Titel) oben unter der Kopfleiste steht. */
function reveal(el) {
  const behavior = reduced() ? 'auto' : 'smooth';
  // seitlich: der naechste waagerecht scrollende Behaelter
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (p.scrollWidth > p.clientWidth + 2 && /(auto|scroll)/.test(cs.overflowX)) {
      const pr = p.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const pad = parseFloat(cs.scrollPaddingLeft) || parseFloat(cs.paddingLeft) || 0;
      if (er.left < pr.left + pad) p.scrollBy({ left: er.left - pr.left - pad, behavior });
      else if (er.right > pr.right - pad) p.scrollBy({ left: er.right - pr.right + pad, behavior });
      break;
    }
  }
  // senkrecht: Seite (oder das scrollende Fenster, in dem das Element liegt)
  const bar = topbar();
  if (bar?.contains(el)) return;
  let scroller = null;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (p.scrollHeight > p.clientHeight + 2 && /(auto|scroll)/.test(cs.overflowY)) {
      scroller = p;
      break;
    }
  }
  if (!scroller) return;
  const sr = scroller.getBoundingClientRect();
  const isView = scroller === view();
  // Was oben stehen soll: die Reihe mit ihrem Titel, sonst das Element; ganz oben auf der Seite (Banner, Kopf der Detailseite): an den Anfang
  const block = el.closest('.row, .info-block, .settings-group, .ep') ?? el;
  const br = block.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const topSpace = isView ? (bar?.offsetHeight ?? 0) * 0.5 + 16 : 16;
  const bottomSpace = 24;
  const posInPage = br.top - sr.top + scroller.scrollTop;
  if (isView && el.closest('.hero, .detail-hero, .d-hero, .person-head') && posInPage < sr.height * 0.6) {
    if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior });
    return;
  }
  if (br.top < sr.top + topSpace || er.bottom > sr.bottom - bottomSpace) {
    const top = Math.max(0, posInPage - topSpace);
    // Passt das Element mit dieser Lage nicht ganz ins Bild (hohe Bloecke), dann so, dass es unten buendig steht
    const fits = er.bottom - br.top + topSpace + bottomSpace <= sr.height;
    scroller.scrollTo({ top: fits ? top : scroller.scrollTop + (er.bottom - (sr.bottom - bottomSpace)), behavior });
  }
}

/** Erstes sinnvolles Ziel einer Ebene: Hauptknopf der Seite, gewaehlter Eintrag eines Menues, erstes Element. */
function focusInitial(scope = layer()) {
  const all = candidates(scope);
  if (!all.length) return false;
  const prefer = scope === document.body
    ? scope.querySelector('#view [data-tv-autofocus], #view .hero-actions .btn.primary, #view .btn.xl.primary, #view .btn.primary') ?? all.find((el) => view()?.contains(el))
    : scope.querySelector('.selected, [aria-checked="true"]');
  const target = prefer && visible(prefer) && all.includes(prefer) ? prefer : all[0];
  focusEl(target);
  return true;
}

/**
 * Ist der Fokus verloren, geht er an das naechstgelegene Element. Von selbst (focusout) nur, wenn das verlorene Element zur noch sichtbaren Seite gehoerte
 * (eine Karte wurde an ihrem Platz neu gebaut); bei einem Seitenwechsel entscheidet onRoute (gemerkter Fokus oder Hauptknopf), nach Menues und Fenstern
 * geben diese den Fokus selbst zurueck. force: eine Taste wurde gedrueckt und nichts hat den Fokus.
 */
function recover(lostPage, force = false) {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected && visible(active)) return;
  if (!force && (!lostPage || lostPage !== view()?.firstElementChild)) return;
  const scope = layer();
  const all = candidates(scope);
  if (!all.length) return;
  if (lastRect && scope === document.body) {
    const cx = (lastRect.left + lastRect.right) / 2;
    const cy = (lastRect.top + lastRect.bottom) / 2;
    let best = null;
    let bestD = Infinity;
    for (const el of all) {
      if (topbar()?.contains(el)) continue;
      const r = el.getBoundingClientRect();
      const d = Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    if (best) return focusEl(best);
  }
  focusInitial(scope);
}

// ---------- Tasten ----------

function isTextField(el) {
  return (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|color|file)$/i.test(el.type)) || el.tagName === 'TEXTAREA';
}

function nativeActivation(el) {
  return el.matches('a[href], button, input, select, textarea, summary');
}

function onKeyDown(e) {
  if (e.__tvSynthetic) return;
  lastKeyAt = Date.now();
  const dir = ARROWS[e.key];
  const active = document.activeElement;
  // Waehrend der Startanimation gehoert jede Taste ihr (splash.js ueberspringt damit), der Fokus dahinter bleibt, wo er ist
  if (document.getElementById('splash')) return;
  if (dir) {
    // Menues gehen mit hoch/runter selbst durch ihre Eintraege (ui.js openMenu); seitlich zwischen Spalten hilft die raeumliche Suche
    const scope = layer();
    if (scope.classList?.contains('menu') && (dir === 'up' || dir === 'down') && scope.contains(active)) return;
    if (active && isTextField(active)) {
      const value = active.value ?? '';
      if (dir === 'left' || dir === 'right') {
        const atStart = active.selectionStart === 0 && active.selectionEnd === 0;
        const atEnd = active.selectionStart === value.length;
        if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return;
      } else if (active.tagName === 'TEXTAREA') {
        // Mehrzeilig: hoch/runter bewegen den Cursor zwischen den Zeilen; erst aus der ersten bzw. letzten Zeile heraus geht der Fokus weiter
        const before = value.slice(0, active.selectionStart);
        const after = value.slice(active.selectionEnd);
        if ((dir === 'up' && before.includes('\n')) || (dir === 'down' && after.includes('\n'))) return;
      }
    }
    if (active?.matches?.('input[type="range"]') && (dir === 'left' || dir === 'right')) return;
    if (move(dir)) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  if (e.key === 'ContextMenu' && active && active !== document.body) {
    if (openContextMenu(active)) e.preventDefault();
    return;
  }
  if (e.key === 'Enter' && active?.matches?.(MENU_TARGETS)) {
    // Kurz: wie sonst OK; lang: Kontextmenue. Erst beim Loslassen ist klar, was gemeint war.
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || press) return;
    const el = active;
    press = { el, timer: setTimeout(() => {
      press = { el, done: true };
      openContextMenu(el);
    }, LONG_PRESS_MS) };
  }
}

/** Ein Druecken von OK, dessen Loslassen nie ankommt (Fenster verliert den Fokus, App im Hintergrund, Seitenwechsel), darf OK nicht sperren. */
function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press = null;
}

function onKeyUp(e) {
  if (e.key !== 'Enter' || !press) return;
  const { el, timer, done } = press;
  press = null;
  clearTimeout(timer);
  e.preventDefault();
  if (done || !el.isConnected) return;
  // Kurzes Druecken: dieselbe Taste noch einmal fuer die eigenen Zuhoerer des Elements (Folge: abspielen), sonst wie ein Klick
  const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  ev.__tvSynthetic = true;
  el.dispatchEvent(ev);
  if (!ev.defaultPrevented && nativeActivation(el)) el.click();
}

/** OK auf einem Element ohne eigene Aktivierung (Zeilen mit tabindex, role="button"): wie ein Klick, wenn es niemand selbst behandelt hat. */
function onKeyDownLate(e) {
  if (e.__tvSynthetic || e.key !== 'Enter' || e.defaultPrevented) return;
  const el = document.activeElement;
  if (!el || el === document.body || nativeActivation(el) || el.matches(MENU_TARGETS)) return;
  if (el.matches('[role="button"], [role="tab"], [role="switch"], [role="option"], [role="menuitem"], [tabindex]')) {
    e.preventDefault();
    el.click();
  }
}

function openContextMenu(el) {
  const key = new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true });
  key.__tvSynthetic = true;
  el.dispatchEvent(key);
  if (key.defaultPrevented) return true;
  return !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 }));
}

/**
 * Zurueck-Taste (jc-back der Huelle, vor der Behandlung in app.js): auf der Startseite eines Reiters mit dem Fokus im Inhalt springt er zuerst in die
 * Reiterleiste (wie Apple TV), erst das naechste Zurueck verlaesst die App. Menues und Fenster schliesst app.js wie gewohnt.
 */
function onBack(e) {
  if (layer() !== document.body) return;
  const path = location.hash.slice(1).split('?')[0];
  const tabRoot = (window.JCNav?.TABS ?? []).some((tab) => tab.path === path);
  const bar = topbar();
  if (!tabRoot || !bar || bar.contains(document.activeElement)) return;
  const link = bar.querySelector('.nav-link.on') ?? bar.querySelector('.nav-link');
  if (!link) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  view()?.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  focusEl(link, { scroll: false });
}

// ---------- Kopfleiste und Seitenwechsel ----------

function syncBar() {
  const bar = topbar();
  const v = view();
  if (!bar || !v) return;
  const inBar = bar.contains(document.activeElement);
  root.classList.toggle('tv-bar-hidden', !inBar && v.scrollTop > 8);
}

function onFocusIn(e) {
  const el = e.target;
  if (!(el instanceof Element)) return;
  lastRect = el.getBoundingClientRect();
  focusedPage = pageOf(el);
  if (focusedPage) lastFocus.set(focusedPage, el);
  syncBar();
}

let settleObserver = null;
/** Nach einem Seitenwechsel: gemerkten Fokus wiederherstellen oder auf den Hauptknopf, sobald die Seite ihn hat (sie laedt oft nach). */
function onRoute() {
  settleObserver?.disconnect();
  settleObserver = null;
  if (layer() !== document.body) return;
  const v = view();
  const page = v?.firstElementChild;
  if (!page) return;
  const saved = lastFocus.get(page);
  if (saved?.isConnected && visible(saved)) {
    requestAnimationFrame(() => focusEl(saved));
    return;
  }
  // Zuerst nur die eigentlichen Ziele der Seite (Hauptknopf des Banners bzw. der Detailseite, erste Karte oder Folge); Hinweise wie "Seerr verbinden"
  // laden oft schneller und bekaemen sonst den Fokus. Erst wenn nach einem Moment keins da ist, das naechstbeste.
  const started = Date.now();
  const STRONG = ['[data-tv-autofocus]', '.hero-actions .btn.primary', '.btn.xl.primary', '.card', '.ep'];
  let provisional = null; // vorlaeufiges Ziel, solange die eigentlichen noch laden
  /** true, wenn das eigentliche Ziel den Fokus hat (dann ist die Suche zu Ende). */
  const tryFocus = (final = false) => {
    const active = document.activeElement;
    const own = active && active !== document.body && active !== v && page.contains(active);
    if (own && active !== provisional) return true; // schon fokussiert (auch vom Nutzer bewegt)
    if (provisional && lastKeyAt > started) return true; // der Nutzer hat das vorlaeufige Ziel schon verlassen oder benutzt
    const all = candidates(page).filter((el) => !el.closest('.seerr-tip'));
    const strong = STRONG.map((s) => all.find((el) => el.matches(s))).find(Boolean);
    if (strong) {
      focusEl(strong);
      return true;
    }
    // Laedt die Seite noch (Platzhalter), wird auf die eigentlichen Ziele gewartet; sonst gleich das naechstbeste (Einstellungen, Suche, Hinweise)
    const loading = !!page.querySelector('.skeleton, .sk-card, .hero-skeleton, .sk');
    if ((final || !loading) && !own) {
      provisional = all.find((el) => el.matches('.btn.primary')) ?? all[0] ?? candidates(page)[0] ?? null;
      if (provisional) focusEl(provisional);
    }
    return false;
  };
  if (tryFocus()) return;
  settleObserver = new MutationObserver(() => {
    if (tryFocus()) {
      settleObserver?.disconnect();
      settleObserver = null;
    }
  });
  settleObserver.observe(page, { childList: true, subtree: true });
  const mine = settleObserver;
  // Hat die Seite nach einem Moment keins der eigentlichen Ziele, bekommt das naechstbeste den Fokus; kommt das eigentliche noch, wechselt er dorthin,
  // solange der Nutzer nichts gedrueckt hat. Nach 6 s ist Schluss.
  setTimeout(() => {
    if (settleObserver === mine && view()?.firstElementChild === page && layer() === document.body) tryFocus(true);
  }, 1500);
  setTimeout(() => {
    if (settleObserver !== mine) return;
    settleObserver.disconnect();
    settleObserver = null;
  }, 6000);
}

export function installTv() {
  if (!isTv() || installed) return;
  installed = true;
  root.dataset.compact = 'off'; // der Fernseher ist kein Handy, auch wenn sein Bild in CSS-Pixeln klein ist
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('keydown', onKeyDownLate);
  window.addEventListener('jc-back', onBack, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', () => {
    const lost = focusedPage;
    setTimeout(() => recover(lost), 0);
  });
  document.addEventListener('route', () => {
    cancelPress();
    requestAnimationFrame(onRoute);
  });
  window.addEventListener('blur', cancelPress);
  document.addEventListener('visibilitychange', cancelPress);
  document.addEventListener('scroll', syncBar, { capture: true, passive: true });
}
