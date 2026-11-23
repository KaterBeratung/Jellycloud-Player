/* Gemeinsames Modul: "Auf diesem Geraet fortsetzen" (Plan P19, Ziel-Seite). Laeuft auf einem anderen Geraet desselben Kontos gerade ein Film oder eine Folge,
   bietet die Startseite an, hier an derselben Stelle weiterzuschauen; dort haelt die Wiedergabe an. Hier stehen die Regeln: welche Sitzung angeboten wird
   (fuenf Bedingungen), wie die Uebernahme ablaeuft (Eintrag pruefen, frisch lesen, entscheiden, Stopp, Stelle, Start) und wo es weitergeht.
   Vorlage: Core/Handoff.swift, Notizen/wiedergabe-uebernahme-architektur.md (Regeln 7 bis 12) und HandoffRulesTests der Apple-App; nach dieser Referenz gebaut,
   kein Quelltext von Swiftly Player uebernommen. Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCHandoff). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCHandoff = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** So oft fragt die Startseite die Sitzungen ab, solange sie vorne ist. */
  const POLL_MS = 5000;
  /** Nach so viel Stille gilt eine Sitzung als vergessen (Jellyfin raeumt abgestuerzte Programme erst nach Minuten ab). */
  const IDLE_S = 90;
  /** Zeitgrenze der Anfragen der Uebernahme (Sitzungen, Eintrag, Stopp). */
  const TIMEOUT_MS = 8000;
  /** So lange wartet die Uebernahme nach dem Stopp auf die genaue Stelle des anderen Geraets, in diesem Takt. */
  const POSITION_WAIT_MS = 1500;
  const POSITION_STEP_MS = 150;
  const TICKS_PER_SECOND = 10000000;
  const VIDEO_TYPES = Object.freeze(['Movie', 'Episode', 'Video', 'MusicVideo']);

  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max = 200) => (typeof v === 'string' && v ? v.slice(0, max) : null);
  const int = (v) => (Number.isInteger(v) ? v : null);
  /** Kennungen von Konten vergleicht Jellyfin ohne Bindestriche und ohne Gross- und Kleinschreibung. */
  const sameId = (a, b) => !!a && !!b && String(a).replace(/-/g, '').toLowerCase() === String(b).replace(/-/g, '').toLowerCase();

  /** Zeitangabe des Servers ("2026-11-14T20:45:04.425658Z", Bruchteil in wechselnder Laenge) in Millisekunden, auf ganze Sekunden; null, wenn unlesbar. */
  function date(value) {
    if (typeof value !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
    if (!m) return null;
    const ms = Date.parse(`${m[1]}${m[2] ? (m[2] === 'Z' ? 'Z' : m[2].length === 5 ? `${m[2].slice(0, 3)}:${m[2].slice(3)}` : m[2]) : 'Z'}`);
    return Number.isNaN(ms) ? null : ms;
  }

  /**
   * Eine Sitzung aus GET /Sessions, auf die gelesenen Felder reduziert; null, wenn sie keine Kennung hat (eine einzelne unlesbare Sitzung kostet nicht die
   * ganze Antwort). nowPlaying nur, wenn der Eintrag eine Kennung hat.
   */
  function normalizeSession(raw) {
    if (!isObject(raw) || typeof raw.Id !== 'string' || !raw.Id) return null;
    const it = isObject(raw.NowPlayingItem) && typeof raw.NowPlayingItem.Id === 'string' && raw.NowPlayingItem.Id ? raw.NowPlayingItem : null;
    const ps = isObject(raw.PlayState) ? raw.PlayState : {};
    return {
      id: raw.Id.slice(0, 120),
      userId: text(raw.UserId, 64),
      deviceId: text(raw.DeviceId, 200),
      deviceName: text(raw.DeviceName, 120),
      client: text(raw.Client, 120),
      supportsRemoteControl: raw.SupportsRemoteControl === true,
      nowPlaying: it ? { id: it.Id.slice(0, 64), type: text(it.Type, 40), name: text(it.Name, 300), seriesName: text(it.SeriesName, 300), season: int(it.ParentIndexNumber), episode: int(it.IndexNumber) } : null,
      positionTicks: Number.isFinite(ps.PositionTicks) && ps.PositionTicks > 0 ? Math.round(ps.PositionTicks) : 0,
      isPaused: ps.IsPaused === true,
      lastActivity: date(raw.LastActivityDate)
    };
  }

  /** Alle lesbaren Sitzungen einer Antwort. */
  const sessionsOf = (list) => (Array.isArray(list) ? list.map(normalizeSession).filter(Boolean) : []);

  /**
   * Warum eine Sitzung nicht angeboten wird (null: sie wird angeboten). Fuenf Bedingungen; fehlt eine, bietet sich ein Geraet selbst an, erscheint, was jemand
   * anderes schaut (auch einem Administrator nennt der Server alle Sitzungen), oder ein Knopf fuehrt ins Leere.
   * @param {{ownDeviceId:string, ownUserId:string, now?:number}} own
   */
  function whyNot(s, { ownDeviceId, ownUserId, now = Date.now() } = {}) {
    if (s.deviceId && s.deviceId === ownDeviceId) return 'thisDevice';
    if (!s.userId) return 'noAccount';
    if (!sameId(s.userId, ownUserId)) return 'otherAccount';
    if (!s.nowPlaying || !s.nowPlaying.id) return 'nothingPlaying';
    if (!VIDEO_TYPES.includes(s.nowPlaying.type)) return 'notVideo';
    if (s.supportsRemoteControl !== true) return 'notControllable'; // der Stopp muss ankommen, sonst liefe dasselbe auf zwei Geraeten
    if (s.lastActivity !== null && now - s.lastActivity > IDLE_S * 1000) return 'idle';
    return null;
  }

  /** Was sich uebernehmen laesst, die juengste Meldung zuerst. */
  function offers(sessions, own) {
    const at = (s) => (s.lastActivity === null ? -Infinity : s.lastActivity);
    return (Array.isArray(sessions) ? sessions : []).filter((s) => whyNot(s, own) === null).sort((a, b) => at(b) - at(a));
  }

  /** Nur die Sitzungen des eigenen Kontos (die Rueckseite gibt der Oberflaeche nie fremde weiter). */
  const ownAccount = (sessions, ownUserId) => (Array.isArray(sessions) ? sessions : []).filter((s) => sameId(s.userId, ownUserId));

  /**
   * Wo hier weitergespielt wird (Ticks). Die Stelle aus der Sitzung hinkt nach; beim Stopp meldet das andere Geraet seine genaue Stelle, und der Server merkt sie
   * sich am Eintrag. Sie gilt, sobald sie sich geaendert hat und nicht mehr als eine Sekunde hinter der Sitzung liegt (nahe Anfang und Ende setzt Jellyfin sie
   * auf null: dann ist die Stelle der Sitzung die bessere).
   */
  function startTicks({ session, savedBefore = null, savedAfter = null }) {
    if (savedAfter === null || savedAfter === undefined || savedAfter === savedBefore) return session;
    return savedAfter >= session - TICKS_PER_SECOND ? savedAfter : session;
  }

  /**
   * Was die Uebernahme tut, nachdem die Sitzungen frisch gelesen sind: { step: 'stop', session } (das andere Geraet spielt den Titel noch und nimmt den Stopp an),
   * { step: 'playLocally' } (dort laeuft nichts mehr: hier an der gemerkten Stelle weiter) oder { step: 'refuse', reason: 'otherItem' | 'notStoppable', device }
   * (dort laeuft noch etwas, das sich gerade nicht uebernehmen laesst: hier startet nichts, sonst liefe es auf zwei Geraeten).
   */
  function takeoverStep(offered, fresh, own) {
    const current = (Array.isArray(fresh) ? fresh : []).find((s) => s.id === offered.id);
    if (!current || !current.nowPlaying) return { step: 'playLocally' };
    const device = current.deviceName || offered.deviceName || null;
    if (!offered.nowPlaying || current.nowPlaying.id !== offered.nowPlaying.id) return { step: 'refuse', reason: 'otherItem', device };
    if (whyNot(current, own) !== null) return { step: 'refuse', reason: 'notStoppable', device };
    return { step: 'stop', session: current };
  }

  /**
   * Ablauf der Uebernahme (Regeln 9 bis 12): Eintrag pruefen -> Sitzungen frisch lesen -> entscheiden -> Stopp -> auf die genaue Stelle warten -> Startstelle.
   * Erst wird geprueft, dass hier etwas anlaufen kann, dann die Quelle angehalten. Bei jedem Fehler vor dem Stopp laeuft die Quelle weiter. Nach jedem Warten
   * auf den Server prueft stillWanted, ob die Uebernahme noch gilt (Profil, Vordergrund, kein eigener Player); sonst endet sie ohne Start.
   * @param {object} d
   * @param {object} d.offered die angebotene Sitzung (normalizeSession)
   * @param {{ownDeviceId:string, ownUserId:string}} d.own
   * @param {(id:string, timeoutMs:number) => Promise<{positionTicks:number|null, playable:boolean}>} d.item Eintrag mit dem eigenen Konto
   * @param {() => Promise<object[]>} d.sessions die Sitzungen des eigenen Kontos, frisch
   * @param {(sessionId:string) => Promise<void>} d.stop
   * @param {() => boolean} d.stillWanted
   * @returns {Promise<{action:'play', itemId:string, startTicks:number|null} | {action:'abort'} | {action:'fail', reason:string, device:string|null}>}
   *   startTicks null: an der gemerkten Stelle (die Sitzung war fort).
   */
  async function takeOver({ offered, own, item, sessions, stop, stillWanted, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
    const abort = { action: 'abort' };
    const fail = (reason, device = null) => ({ action: 'fail', reason, device });
    const offline = (e) => !e || e.code === 'OFFLINE' || e.code === 'TIMEOUT' || !e.status;
    if (!offered || !offered.nowPlaying) return fail('notAvailable');
    const itemId = offered.nowPlaying.id;
    // 1. Eintrag pruefen: kann er hier ueberhaupt laufen? Die gemerkte Stelle wird festgehalten.
    let before;
    try {
      const it = await item(itemId, TIMEOUT_MS);
      if (!it || !it.playable) return fail('notPlayable');
      before = Number.isFinite(it.positionTicks) ? it.positionTicks : null;
    } catch (e) {
      return fail(offline(e) ? 'offline' : 'notAvailable');
    }
    if (!stillWanted()) return abort;
    // 2. Sitzungen frisch lesen (das Angebot kann fuenf Sekunden alt sein)
    let fresh;
    try {
      fresh = await sessions();
    } catch {
      return fail('offline');
    }
    if (!stillWanted()) return abort;
    // 3. Entscheiden
    const step = takeoverStep(offered, fresh, own);
    if (step.step === 'refuse') return fail(step.reason, step.device);
    if (step.step === 'playLocally') return { action: 'play', itemId, startTicks: null };
    // 4. Stopp: scheitert er, startet hier nichts, und dort laeuft alles weiter
    const device = step.session.deviceName || null;
    try {
      await stop(step.session.id);
    } catch {
      return fail('stopFailed', device);
    }
    // 5. Genaue Stelle: hoechstens 1,5 s, bis sich die gemerkte Stelle gegenueber vorher geaendert hat. Gilt die Uebernahme nicht mehr (die Schleife prueft
    // nach jedem Warten), startet hier nichts: die Stelle ist am Server gemerkt, der Titel steht unter "Weiterschauen"
    let after = null;
    const end = now() + POSITION_WAIT_MS;
    while (now() < end) {
      await sleep(POSITION_STEP_MS);
      if (!stillWanted()) return abort;
      try {
        const it = await item(itemId, Math.max(1, Math.min(POSITION_WAIT_MS, end - now())));
        if (!stillWanted()) return abort;
        const p = it && Number.isFinite(it.positionTicks) ? it.positionTicks : null;
        if (p !== before) {
          after = p;
          break;
        }
      } catch {
        /* weiter warten; danach gilt die Stelle der Sitzung */
      }
    }
    if (!stillWanted()) return abort;
    // 6. Startstelle
    return { action: 'play', itemId, startTicks: startTicks({ session: step.session.positionTicks, savedBefore: before, savedAfter: after }) };
  }

  // ---------- Anzeige ----------

  /** "Harbor Lights · S1 · F2" (englisch "S1 · E2") oder der Filmtitel; ohne Wiedergabe der Name des Geraets. */
  function titleLine(s, lang) {
    const it = s && s.nowPlaying;
    if (!it) return (s && s.deviceName) || '';
    if (it.type !== 'Episode' || !it.seriesName) return it.name || '';
    const parts = [it.seriesName];
    const en = String(lang || '').slice(0, 2).toLowerCase() === 'en';
    if (it.season !== null && it.episode !== null) parts.push(`S${it.season} · ${en ? 'E' : 'F'}${it.episode}`);
    return parts.join(' · ');
  }

  /** Art des Geraets, aus Namen und Programm geraten (mehr nennt der Server nicht): phone, tablet, computer, tv, unknown. */
  function deviceKind(s) {
    const name = String((s && s.deviceName) || '').toLowerCase();
    const app = String((s && s.client) || '').toLowerCase();
    if (app.includes('android tv') || name.includes('apple tv') || name.includes('appletv')) return 'tv';
    if (name.includes('ipad')) return 'tablet';
    if (name.includes('iphone') || name.includes('phone') || app.includes('android')) return 'phone';
    if (name.includes('mac') || name.includes('pc') || name.includes('windows') || name.includes('linux') || app.includes('web')) return 'computer';
    if (name.includes('tv')) return 'tv';
    return 'unknown';
  }

  return {
    POLL_MS,
    IDLE_S,
    TIMEOUT_MS,
    POSITION_WAIT_MS,
    POSITION_STEP_MS,
    TICKS_PER_SECOND,
    VIDEO_TYPES,
    sameId,
    date,
    normalizeSession,
    sessionsOf,
    whyNot,
    offers,
    ownAccount,
    startTicks,
    takeoverStep,
    takeOver,
    titleLine,
    deviceKind
  };
});
