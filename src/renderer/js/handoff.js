import { h, icon, $ } from './dom.js';
import { t, getLocale } from './i18n.js';
import { state } from './state.js';
import { openModal } from './ui.js';
import { playItem } from './actions.js';

/**
 * "Auf diesem Geraet fortsetzen" auf der Startseite (Plan P19, wie HandoffOffer und HandoffPolling der Apple-App). Laeuft auf einem anderen Geraet desselben
 * Kontos gerade ein Film oder eine Folge, erscheint unten eine Kapsel: ein Druck haelt die Wiedergabe dort an und setzt sie hier an derselben Stelle fort.
 * - Ein Bedienelement ueber dem Inhalt (Glas), kein Teil der Seite: es schiebt nichts; solange es zu sehen ist, bekommt das Ende der Startseite Platz.
 *   Desktop: unten mittig, hoechstens 460 px breit; Handy: so breit wie die Reiterleiste, darueber.
 * - Abfrage alle 5 s, nur solange die Startseite vorne ist: nicht im Hintergrund, nicht waehrend hier gespielt wird, nicht bei ausgeschalteter Einstellung.
 *   Endet das Abfragen, verfaellt das Angebot; scheitert eine Abfrage, bleibt es nur, solange es selbst frisch ist (90 s).
 * - Mehrere Geraete: die Anzeige fragt, welches gemeint ist. Scheitert die Uebernahme, sagt eine Meldung warum; dort laeuft die Wiedergabe dann weiter.
 * Regeln und Ablauf: src/shared/handoff.js. Die Rueckseite gibt nur Sitzungen des eigenen Kontos heraus.
 */
const Handoff = window.JCHandoff;
const KIND_ICON = { phone: 'phone', tablet: 'tablet', computer: 'laptop', tv: 'tv', unknown: 'tv' };
const FAIL_TEXT = { notAvailable: 'handoff.fail.notAvailable', offline: 'handoff.fail.offline', notPlayable: 'handoff.fail.notPlayable', otherItem: 'handoff.fail.otherItem', notStoppable: 'handoff.fail.notStoppable', stopFailed: 'handoff.fail.stopFailed' };

const playing = () => {
  const c = document.documentElement.classList;
  return c.contains('playing') || c.contains('is-starting');
};

/** Die Anzeige fuer eine Startseite (homeView): activate/deactivate mit der Seite, destroy beim Abbau. page: das Element der Seite (Platz am Ende). */
export function handoffOffer(page) {
  const profile = state.activeServerId;
  const btn = h('button', { type: 'button', class: 'handoff-btn' });
  const el = h('div', { class: 'handoff', hidden: true, role: 'region', 'aria-label': t('handoff.title') }, btn);
  let shown = false;
  let painted = ''; // was die Kapsel gerade zeigt
  let active = false;
  let destroyed = false;
  let running = false;
  let generation = 0; // jedes Starten und Beenden des Abfragens: eine aeltere Antwort zaehlt nicht mehr
  let timer = null;
  let offers = [];
  let own = null;
  let takingOver = false;
  let takeSeq = 0;

  const allowed = () =>
    active && !destroyed && state.loggedIn && state.activeServerId === profile && state.settings?.player?.showHandoff !== false && document.visibilityState === 'visible' && !playing();

  function detail(s, more) {
    const line = Handoff.titleLine(s, getLocale());
    if (more > 0) return t('handoff.more', { title: line, n: more });
    return s.deviceName ? `${line} · ${s.deviceName}` : line;
  }

  function paint() {
    const first = offers[0];
    // Nur mit der Startseite vorne (die Kapsel haengt am Rahmen der App, nicht an der Seite); eine laufende Uebernahme behaelt ihr Angebot, auch wenn das
    // Abfragen ruht
    const visible = !!first && !destroyed && active && (running || takingOver) && !playing() && !document.documentElement.classList.contains('covered');
    page.classList.toggle('has-handoff', visible);
    if (!visible) {
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
    // Nur neu bauen, was sich sichtbar aendert (jede Abfrage alle 5 s ruft paint auf)
    const kind = Handoff.deviceKind(first);
    const text = detail(first, offers.length - 1);
    const sig = JSON.stringify([kind, text, takingOver, first.deviceName]);
    if (sig !== painted) {
      painted = sig;
      btn.replaceChildren(
        h('span', { class: 'handoff-device', 'aria-hidden': 'true' }, icon(KIND_ICON[kind] ?? 'tv', 20)),
        h('span', { class: 'handoff-text' }, h('span', { class: 'handoff-title' }, t('handoff.title')), h('span', { class: 'handoff-detail' }, text)),
        h('span', { class: 'handoff-go', 'aria-hidden': 'true' }, takingOver ? h('span', { class: 'spinner' }) : icon('play', 15))
      );
      btn.disabled = takingOver;
      btn.setAttribute('aria-label', t('handoff.aria', { title: Handoff.titleLine(first, getLocale()), device: first.deviceName || t('handoff.otherDevice') }));
      btn.setAttribute('aria-busy', String(takingOver));
    }
    if (!shown) {
      shown = true;
      el.hidden = false;
      el.inert = false;
      if (!el.isConnected) $('#app')?.append(el);
      requestAnimationFrame(() => shown && el.classList.add('in'));
    }
  }

  async function tick() {
    const mine = generation;
    try {
      const r = await window.jc.handoffSessions();
      if (mine !== generation) return;
      own = r.own;
      offers = Handoff.offers(r.sessions, { ...r.own, now: Date.now() });
    } catch {
      if (mine !== generation) return;
      // Das letzte Angebot bleibt nur, solange es selbst noch frisch ist
      offers = offers.filter((s) => s.lastActivity !== null && Date.now() - s.lastActivity <= Handoff.IDLE_S * 1000);
    }
    paint();
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
    // Laeuft gerade eine Uebernahme, braucht sie das Angebot noch (sie raeumt mit dem Start des Players selbst auf)
    if (!takingOver) offers = [];
    paint();
  }

  /** Abfragen, wenn alles stimmt, sonst nicht (Startseite vorne, App vorne, keine Wiedergabe hier, Einstellung an). */
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
    if (takingOver || !own) return;
    takingOver = true;
    const mine = ++takeSeq;
    paint();
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
      offers = [];
      takingOver = false;
      paint();
      // Der normale Weg der Wiedergabe: dieses Geraet plant nach seinen eigenen Regeln (Spuren, Qualitaet) und wird selbst steuerbar
      await playItem(result.startTicks === null ? { itemId: result.itemId, resume: true } : { itemId: result.itemId, startTicks: result.startTicks });
    } else {
      takingOver = false;
      if (result.action === 'fail' && !destroyed) fail(result);
      paint();
    }
    sync();
  }

  function choose() {
    const list = [...offers];
    let dialog = null;
    const rows = list.map((s) => {
      const b = h(
        'button',
        { type: 'button', class: 'handoff-choice' },
        h('span', { class: 'handoff-device', 'aria-hidden': 'true' }, icon(KIND_ICON[Handoff.deviceKind(s)] ?? 'tv', 18)),
        h('span', { class: 'handoff-text' }, h('span', { class: 'handoff-title' }, s.deviceName || t('handoff.unnamed')), h('span', { class: 'handoff-detail' }, Handoff.titleLine(s, getLocale())))
      );
      b.addEventListener('click', () => {
        dialog?.close();
        takeOver(s);
      });
      return b;
    });
    dialog = openModal({ title: t('handoff.choose'), body: h('div', { class: 'handoff-choices' }, ...rows), actions: [{ label: t('action.cancel'), onclick: (close) => close() }] });
  }

  btn.addEventListener('click', () => {
    if (takingOver || !offers.length) return;
    if (offers.length > 1) choose();
    else takeOver(offers[0]);
  });

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
      sync();
    },
    destroy() {
      destroyed = true;
      active = false;
      takeSeq++;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      offPlayer();
      onCovered.disconnect();
      el.remove();
      page.classList.remove('has-handoff');
    }
  };
}
