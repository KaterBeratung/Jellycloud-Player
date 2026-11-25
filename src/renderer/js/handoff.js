import { h, icon, $ } from './dom.js';
import { t, getLocale } from './i18n.js';
import { state } from './state.js';
import { openModal } from './ui.js';
import { playItem } from './actions.js';
import { landscapeOf } from './api.js';
import { feed, publish, subscribe, pausedOf, isSending, togglePause } from './sessions-feed.js';

/**
 * "Auf diesem Geraet fortsetzen" auf der Startseite (Plan P19; seit 1.2.32 wie Build 98 der Apple-App: Fernbedienung und aufklappbare Kapsel, Regeln 13 bis
 * 18 in Notizen/wiedergabe-uebernahme-architektur.md). Laeuft auf einem anderen Geraet desselben Kontos gerade ein Film oder eine Folge, erscheint unten eine
 * Kapsel.
 * - Zu: Symbol des Geraets, "Laeuft auf <Geraet>" bzw. "Pausiert auf <Geraet>" (mehrere: "Laeuft auf <n> Geraeten"), darunter der Titel, rechts ein Pfeil.
 * - Ein Druck laesst dieselbe Glasflaeche nach oben zur Steuerkarte wachsen: je Geraet (hoechstens drei) kleines Bild, Titel, Folge, Geraet, Stelle mit Zeit,
 *   ein runder Knopf Pause/Abspielen (steuert das andere Geraet, ohne zu uebernehmen) und "Hier fortsetzen" (holt die Wiedergabe hierher, klappt zu und
 *   zeigt den Kreisel in der Kapsel). Zu mit dem Pfeil, einem Klick daneben (die Flaeche gibt es nur, solange sie offen ist) oder Escape. Die Karte waechst
 *   aus der Kapsel nach oben, ohne Sprung (der Rahmen bleibt unten verankert).
 * - Ein Bedienelement ueber dem Inhalt (Glas), kein Teil der Seite: es schiebt nichts; solange es zu sehen ist, bekommt das Ende der Startseite Platz.
 * - Abfrage alle 5 s (eine fuer die Angebote und "Laeuft gerade", sessions-feed.js), nur solange die Startseite vorne ist: nicht im Hintergrund, nicht
 *   waehrend hier gespielt wird. Die Kapsel erscheint nur mit eingeschalteter Einstellung; "Laeuft gerade" gilt unabhaengig davon.
 * Regeln und Ablauf: src/shared/handoff.js. Die Rueckseite steuert nur Sitzungen des eigenen Kontos.
 */
const Handoff = window.JCHandoff;
const KIND_ICON = { phone: 'phone', tablet: 'tablet', computer: 'laptop', tv: 'tv', unknown: 'tv' };
const FAIL_TEXT = { notAvailable: 'handoff.fail.notAvailable', offline: 'handoff.fail.offline', notPlayable: 'handoff.fail.notPlayable', otherItem: 'handoff.fail.otherItem', notStoppable: 'handoff.fail.notStoppable', stopFailed: 'handoff.fail.stopFailed' };
const MAX_ROWS = 3;

const playing = () => {
  const c = document.documentElement.classList;
  return c.contains('playing') || c.contains('is-starting');
};

/** Stelle und Laenge, "14:51 / 23:42"; ohne Laenge nur die Stelle. Dazu der Anteil fuer den Balken (0 bis 1). */
export function positionOf(s, paused, now = Date.now()) {
  const pos = Handoff.livePositionTicks(s, { paused, now });
  const run = s.nowPlaying?.runTimeTicks || 0;
  return { text: run > 0 ? `${Handoff.clock(pos)} / ${Handoff.clock(run)}` : Handoff.clock(pos), share: run > 0 ? Math.min(1, pos / run) : 0 };
}

/** Kleines 16:9-Bild eines laufenden Eintrags (bei Folgen das Standbild); ohne Bild ein ruhiges Feld mit dem Symbol. */
export function streamThumb(s, cls) {
  const art = s.nowPlaying?.art;
  const img = art?.Id ? landscapeOf(art, 240) : null;
  const box = h('span', { class: cls, 'aria-hidden': 'true' });
  if (img) {
    const el = h('img', { src: img.url, alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
    el.addEventListener('error', () => el.replaceWith(icon('film', 20)), { once: true });
    box.append(el);
  } else box.append(icon('film', 20));
  return box;
}

/** Die Anzeige fuer eine Startseite (homeView): activate/deactivate mit der Seite, destroy beim Abbau. page: das Element der Seite (Platz am Ende). */
export function handoffOffer(page) {
  const profile = state.activeServerId;
  const bar = h('button', { type: 'button', class: 'handoff-btn', 'aria-expanded': 'false' });
  const listBox = h('div', { class: 'handoff-list' });
  const card = h('div', { class: 'handoff-card', inert: true }, h('div', { class: 'handoff-card-inner' }, h('div', { class: 'handoff-card-title' }, t('handoff.title')), listBox));
  const el = h('div', { class: 'handoff', hidden: true, role: 'region', 'aria-label': t('handoff.title') }, card, bar);
  // Klick daneben klappt zu: die Flaeche gibt es nur, solange die Karte offen ist
  const scrim = h('div', { class: 'handoff-scrim', hidden: true });
  let shown = false;
  let open = false;
  let painted = ''; // was die Kapsel gerade zeigt
  let active = false;
  let destroyed = false;
  let running = false;
  let generation = 0; // jedes Starten und Beenden des Abfragens: eine aeltere Antwort zaehlt nicht mehr
  let timer = null;
  let clockTimer = null;
  let takingOver = false;
  let takeSeq = 0;
  const rows = new Map(); // Sitzung -> Zeile der Karte (bleibt stehen, damit der Fokus nicht verloren geht)

  const allowed = () => active && !destroyed && state.loggedIn && state.activeServerId === profile && document.visibilityState === 'visible' && !playing();
  const enabled = () => state.settings?.player?.showHandoff !== false;
  const offers = () => (enabled() ? feed.offers : []);

  function lines() {
    const items = offers();
    const first = items[0];
    const device = first.deviceName || t('handoff.otherDevice');
    const head = items.length > 1 ? t('handoff.onDevices', { n: items.length }) : t(pausedOf(first) ? 'handoff.pausedOn' : 'handoff.playingOn', { device });
    return { head, title: Handoff.titleLine(first, getLocale()) };
  }

  function paintRow(s) {
    let r = rows.get(s.id);
    if (!r) {
      const toggle = h('button', { type: 'button', class: 'handoff-toggle' });
      toggle.addEventListener('click', () => {
        if (!takingOver) togglePause(r.s);
      });
      const here = h('button', { type: 'button', class: 'btn primary handoff-here' }, icon('play', 15), h('span', null, t('handoff.here')));
      here.addEventListener('click', () => takeOver(r.s));
      const title = h('span', { class: 'handoff-row-title' });
      const episode = h('span', { class: 'handoff-row-sub' });
      const device = h('span', { class: 'handoff-row-device' });
      const fill = h('span', { class: 'handoff-bar-fill' });
      const time = h('span', { class: 'handoff-row-time' });
      const thumb = h('span', { class: 'handoff-thumb-slot' });
      const elRow = h(
        'div',
        { class: 'handoff-row' },
        h('div', { class: 'handoff-row-main' }, thumb, h('div', { class: 'handoff-row-text' }, title, episode, device, h('div', { class: 'handoff-row-pos' }, h('span', { class: 'handoff-bar' }, fill), time)), toggle),
        here
      );
      r = { el: elRow, toggle, here, title, episode, device, fill, time, thumb, s, art: '' };
      rows.set(s.id, r);
    }
    r.s = s;
    const { title, episode } = Handoff.itemLines(s, getLocale());
    r.title.textContent = title;
    r.episode.textContent = episode ?? '';
    r.episode.hidden = !episode;
    r.device.replaceChildren(icon(KIND_ICON[Handoff.deviceKind(s)] ?? 'tv', 13), h('span', null, s.deviceName || t('handoff.unnamed')));
    const artKey = s.nowPlaying?.id ?? '';
    if (r.art !== artKey) {
      r.art = artKey;
      r.thumb.replaceChildren(streamThumb(s, 'handoff-thumb'));
    }
    const paused = pausedOf(s);
    const busy = isSending(s);
    const device = s.deviceName || t('handoff.unnamed');
    r.toggle.replaceChildren(icon(paused ? 'play' : 'pause', 18));
    r.toggle.setAttribute('aria-label', t(paused ? 'remote.play' : 'remote.pause', { device }));
    r.toggle.title = r.toggle.getAttribute('aria-label');
    r.toggle.classList.toggle('busy', busy);
    r.toggle.setAttribute('aria-disabled', String(busy || takingOver));
    r.here.disabled = takingOver;
    paintTime(r);
    return r.el;
  }

  function paintTime(r) {
    const p = positionOf(r.s, pausedOf(r.s));
    r.time.textContent = p.text;
    r.fill.style.transform = `scaleX(${p.share})`;
  }

  function paint() {
    const items = offers();
    const first = items[0];
    // Nur mit der Startseite vorne (die Kapsel haengt am Rahmen der App, nicht an der Seite); eine laufende Uebernahme behaelt ihr Angebot, auch wenn das
    // Abfragen ruht
    const visible = !!first && !destroyed && active && (running || takingOver) && !playing() && !document.documentElement.classList.contains('covered');
    page.classList.toggle('has-handoff', visible);
    if (!visible) {
      setOpen(false);
      if (shown) {
        shown = false;
        el.classList.remove('in');
        el.inert = true;
        setTimeout(() => {
          if (!shown) el.hidden = true;
        }, 260);
      }
      return;
    }
    // Zeile der Kapsel: nur neu bauen, was sich sichtbar aendert (jede Abfrage alle 5 s ruft paint auf)
    const kind = Handoff.deviceKind(first);
    const { head, title } = lines();
    const sig = JSON.stringify([kind, head, title, takingOver, open]);
    if (sig !== painted) {
      painted = sig;
      bar.replaceChildren(
        h('span', { class: 'handoff-device', 'aria-hidden': 'true' }, icon(KIND_ICON[kind] ?? 'tv', 20)),
        h('span', { class: 'handoff-text' }, h('span', { class: 'handoff-title' }, head), h('span', { class: 'handoff-detail' }, title)),
        h('span', { class: 'handoff-chevron', 'aria-hidden': 'true' }, takingOver ? h('span', { class: 'spinner' }) : icon('chevron-up', 18))
      );
      bar.disabled = takingOver;
      bar.setAttribute('aria-label', `${head}: ${title}. ${t(open ? 'handoff.collapse' : 'handoff.expand')}`);
      bar.setAttribute('aria-busy', String(takingOver));
    }
    // Karte: Zeilen je Geraet (hoechstens drei), an ihrem Platz aktualisiert
    const shownIds = new Set();
    const els = items.slice(0, MAX_ROWS).map((s) => {
      shownIds.add(s.id);
      return paintRow(s);
    });
    for (const [id, r] of rows) {
      if (!shownIds.has(id)) {
        r.el.remove();
        rows.delete(id);
      }
    }
    // Reihenfolge herstellen, ohne stehende Zeilen neu einzuhaengen (das naehme ihnen den Fokus)
    els.forEach((rowEl, i) => {
      if (listBox.children[i] !== rowEl) listBox.insertBefore(rowEl, listBox.children[i] ?? null);
    });
    if (!shown) {
      shown = true;
      el.hidden = false;
      el.inert = false;
      if (!el.isConnected) $('#app')?.append(scrim, el);
      requestAnimationFrame(() => shown && el.classList.add('in'));
    }
  }
  function setOpen(next) {
    next = !!next && !takingOver;
    if (next === open) return;
    open = next;
    el.classList.toggle('open', open);
    card.inert = !open;
    bar.setAttribute('aria-expanded', String(open));
    scrim.hidden = !open;
    painted = '';
    if (open) {
      document.addEventListener('keydown', onKey, true);
      clearInterval(clockTimer);
      // Die Zeit laufender Streams zaehlt jede Sekunde weiter (hoechstens 12 s ueber die gemeldete Stelle, src/shared/handoff.js)
      clockTimer = setInterval(() => rows.forEach(paintTime), 1000);
    } else {
      document.removeEventListener('keydown', onKey, true);
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (shown) paint();
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    bar.focus();
  }

  async function tick() {
    const mine = generation;
    try {
      const r = await window.jc.handoffOverview();
      if (mine !== generation) return;
      const now = Date.now();
      publish({ own: r.own, streams: r.streams, offers: Handoff.offers(r.sessions, { ...r.own, now }) });
    } catch {
      if (mine !== generation) return;
      // Das letzte Angebot bleibt nur, solange es selbst noch frisch ist; "Laeuft gerade" ebenso
      const fresh = (s) => s.lastActivity !== null && Date.now() - s.lastActivity <= Handoff.IDLE_S * 1000;
      publish({ own: feed.own, streams: feed.streams.filter(fresh), offers: feed.offers.filter(fresh) });
    }
  }

  function loop(mine) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (mine !== generation) return;
      await tick();
      if (mine === generation) loop(mine);
    }, Handoff.POLL_MS);
  }

  function start() {
    if (running) return;
    running = true;
    const mine = ++generation;
    tick().then(() => mine === generation && loop(mine));
  }

  function stop() {
    if (!running) return paint();
    running = false;
    generation++;
    clearTimeout(timer);
    // Laeuft gerade eine Uebernahme, braucht sie das Angebot noch (sie raeumt mit dem Start des Players selbst auf); "Laeuft gerade" ruht mit der Abfrage
    publish({ own: feed.own, streams: [], offers: takingOver ? feed.offers : [] });
  }

  /** Abfragen, wenn alles stimmt, sonst nicht (Startseite vorne, App vorne, keine Wiedergabe hier). */
  const sync = () => (allowed() ? start() : stop());

  function fail(result) {
    const key = FAIL_TEXT[result.reason] ?? 'handoff.fail.offline';
    openModal({
      title: t('handoff.failTitle'),
      body: h('p', { class: 'mdl-text' }, t(key, { device: result.device || t('handoff.unnamed') })),
      actions: [{ label: t('action.ok'), primary: true, focus: true, onclick: (close) => close() }]
    });
  }

  async function takeOver(s) {
    if (takingOver || !feed.own) return;
    setOpen(false);
    takingOver = true;
    const mine = ++takeSeq;
    paint();
    bar.focus();
    const own = feed.own;
    const stillWanted = () => mine === takeSeq && !destroyed && state.loggedIn && state.activeServerId === profile && document.visibilityState === 'visible' && !playing();
    let result;
    try {
      result = await Handoff.takeOver({
        offered: s,
        own,
        item: (id, timeout) => window.jc.handoffItem({ id, timeout }),
        sessions: () => window.jc.handoffSessions().then((r) => r.sessions),
        stop: (id) => window.jc.handoffStop(id),
        stillWanted
      });
    } catch {
      result = { action: 'fail', reason: 'offline', device: s.deviceName };
    }
    if (result.action === 'play' && stillWanted()) {
      takingOver = false;
      publish({ own: feed.own, streams: feed.streams, offers: [] });
      // Der normale Weg der Wiedergabe: dieses Geraet plant nach seinen eigenen Regeln (Spuren, Qualitaet) und wird selbst steuerbar
      await playItem(result.startTicks === null ? { itemId: result.itemId, resume: true } : { itemId: result.itemId, startTicks: result.startTicks });
    } else {
      takingOver = false;
      if (result.action === 'fail' && !destroyed) fail(result);
      paint();
    }
    sync();
  }

  bar.addEventListener('click', () => {
    if (takingOver || !offers().length) return;
    setOpen(!open);
  });
  scrim.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setOpen(false);
  });

  const offFeed = subscribe(() => paint());
  const onVisibility = () => sync();
  document.addEventListener('visibilitychange', onVisibility);
  const offPlayer = window.jc.onPlayerActive?.(() => setTimeout(sync, 0)) ?? (() => {});
  const onCovered = new MutationObserver(() => paint());
  onCovered.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  return {
    activate() {
      active = true;
      sync();
    },
    // Eine laufende Uebernahme gilt weiter, wenn die Startseite nach hinten geht (wie bei Apple zaehlen nur Profil, Vordergrund und ein eigener Player)
    deactivate() {
      active = false;
      setOpen(false);
      sync();
    },
    /** Einstellung "Auf diesem Geraet fortsetzen" geaendert: neu zeichnen (die Abfrage laeuft fuer "Laeuft gerade" ohnehin) */
    refresh: () => paint(),
    destroy() {
      destroyed = true;
      active = false;
      takeSeq++;
      setOpen(false);
      stop();
      offFeed();
      document.removeEventListener('visibilitychange', onVisibility);
      offPlayer();
      onCovered.disconnect();
      el.remove();
      scrim.remove();
      page.classList.remove('has-handoff');
    }
  };
}
