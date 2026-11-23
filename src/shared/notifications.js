/* Gemeinsames Modul: Mitteilungen der App (Plan P17). Seerr meldet einer App keine Ereignisse; die App erkennt eine Aenderung, indem sie die Anfragen
   liest und mit dem zuletzt gesehenen Stand vergleicht (detect). Getrennt gehalten: Erkennung, Wortlaut, Ablage je Profil und Seerr-Server (createStore)
   und der Abgleich (createCenter: wann, wie oft, nie zwei zugleich, was der Nutzer waehrenddessen tut, bleibt). Die Oberflaeche zeichnet nur.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCNotifications; in der Web-/Handy-Fassung mit der Rueckseite in der Seite).
   Vorlage: Core/AppNotifications.swift, Features/Notifications/NotificationText.swift, die Tests NotificationRulesTests und NotificationCenterTests und
   Notizen/seerr-integration.md ("Mitteilungen") der Apple-App (Build 93). Keine Zugangsdaten in der Ablage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seerr-state'), require('./format'));
  else root.JCNotifications = factory(root.JCSeerrState, root.JCFormat);
})(typeof self !== 'undefined' ? self : this, function (SeerrState, Format) {
  'use strict';

  /** Arten einer Mitteilung, wichtigste zuerst. newRequest: jemand anders hat etwas angefragt (nur fuer Konten, die alle Anfragen sehen). */
  const KINDS = Object.freeze(['available', 'partiallyAvailable', 'approved', 'declined', 'failed', 'newRequest']);
  /** So viele Eintraege bleiben (die neuesten), so viele entfernte Kennungen werden gemerkt. */
  const LIMIT = 100;
  const REMOVED_LIMIT = 300;
  /** Ohne ausdruecklichen Wunsch liegen zwischen zwei Abgleichen mindestens zwei Minuten (kein dauerndes Abfragen). */
  const MIN_GAP_MS = 2 * 60 * 1000;
  /** Spielraum fuer Uhren, die voneinander abweichen: die Zeit des Abgleichs wird so viel frueher gemerkt. */
  const CLOCK_MARGIN_MS = 2 * 60 * 1000;
  /** Bei offener App hoechstens so oft von selbst (die Oberflaeche stellt den Takt). */
  const INTERVAL_MS = 15 * 60 * 1000;
  /** Der Abgleich liest die neuesten Anfragen jeder Liste. */
  const TAKE = 50;

  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  // ---------- Erkennung ----------

  /**
   * Stand einer Anfrage fuer die Erkennung: wie auf dem Plakat (SeerrState.requestOf), mit einer Ausnahme. "Teilweise verfuegbar" allein aus dem Stand der
   * Serie zaehlt nur, wenn die Serie beim letzten Abgleich noch nichts hatte (dann ist seither etwas angekommen). War schon vorher etwas von ihr da
   * (Folgestaffel angefragt), sagt der Stand der Serie nichts ueber diese Anfrage: sie gilt als genehmigt, bis eine ihrer Staffeln da ist.
   */
  function noticeState(request, before) {
    const shown = SeerrState.requestOf(request);
    const ready = Number(request.readySeasons) || 0;
    if (shown !== 'partiallyAvailable' || request.mediaType === 'movie' || ready !== 0 || request.status !== SeerrState.SEERR_REQUEST.APPROVED) return shown;
    if (before && before.state === 'partiallyAvailable') return shown; // schon so gemerkt: bleibt
    if (before && Number.isInteger(before.media) && !SeerrState.isPresent(before.media)) return shown; // vorher war nichts von der Serie da
    return 'approved';
  }

  /** Welche Mitteilung ein Wechsel des Stands ist. "Verfuegbar" nur, wenn der Titel wirklich da ist; "genehmigt" nur aus dem Warten heraus. */
  function transition(old, next) {
    switch (next) {
      case 'available':
      case 'partiallyAvailable':
      case 'declined':
      case 'failed':
        return next;
      case 'approved':
      case 'processing':
        return old === 'requested' ? 'approved' : null; // ein erneuter Versuch nach einem Fehlschlag ist keine Nachricht
      default:
        return null;
    }
  }

  /**
   * Vergleicht den Stand der Anfragen mit dem zuletzt gesehenen (SeerrChangeDetector der Apple-App).
   * - previous: zuletzt gesehener Stand je Anfrage ({ [id]: { state, own, media } }); null beim ersten Abgleich eines Profils mit einem Seerr-Server: dann
   *   entsteht nur der Ausgangsstand, nichts aus der Vergangenheit wird gemeldet.
   * - current: die Anfragen, wie Seerr sie jetzt nennt (seerr.js normalizeRequest: die eigenen, fuer Konten mit dem Recht dazu alle).
   * - manages: das Konto sieht alle Anfragen; nur dann zaehlen neue Anfragen anderer.
   * - lastSync: Zeit des letzten Abgleichs (ms). Eine Anfrage, die es damals nicht gab, zaehlt nur, wenn sie seitdem gestellt wurde.
   * - quiet: Anfragen, die der Nutzer gerade selbst in der App geaendert hat: ihr neuer Stand wird gemerkt, aber nicht gemeldet.
   * Eigene Entscheidungen sind keine Nachricht: nennt Seerr den Nutzer als Bearbeiter (auch bei der automatischen Genehmigung), entfallen "genehmigt" und
   * "abgelehnt"; "verfuegbar" und "fehlgeschlagen" kommen immer. Verschwundene Anfragen fallen aus dem Stand.
   * @returns {{changes: {kind: string, request: object}[], snapshot: Object<string, {state: string, own: boolean, media: number}>}}
   */
  function detect({ previous = null, current = [], userId, manages = false, lastSync = null, quiet = [] } = {}) {
    const silent = quiet instanceof Set ? quiet : new Set(quiet || []);
    const snapshot = {};
    const changes = [];
    for (const request of Array.isArray(current) ? current : []) {
      if (!request || !Number.isInteger(request.id)) continue;
      const before = hasOwn(previous, request.id) ? previous[request.id] : null;
      const state = noticeState(request, before);
      const own = request.requesterId === userId;
      snapshot[request.id] = { state: state || '', own, media: Number(request.mediaStatus) || 0 };
      if (!previous || silent.has(request.id)) continue;
      let kind = null;
      if (before) {
        // Bekannte Anfrage: nur die eigene, und nur ein anderer Stand
        if (own && before.state !== (state || '')) kind = transition(before.state || null, state);
      } else if (lastSync !== null && lastSync !== undefined && request.created && Date.parse(request.created) > lastSync) {
        // Seit dem letzten Abgleich gestellt und noch nie gesehen: die eigene zaehlt wie eine wartende, deren Stand sich geaendert hat (wartet sie noch, weiss
        // das, wer sie gestellt hat); die eines anderen, wenn das Konto alle Anfragen sieht und sie noch auf die Entscheidung wartet
        if (own) kind = transition('requested', state);
        else if (manages && request.status === SeerrState.SEERR_REQUEST.PENDING) kind = 'newRequest';
      }
      if ((kind === 'approved' || kind === 'declined') && request.modifierId === userId) continue;
      if (kind) changes.push({ kind, request });
    }
    return { changes, snapshot };
  }

  // ---------- Mitteilung und Wortlaut ----------

  /**
   * Eine Mitteilung: was geschehen ist und wohin sie fuehrt. Kennung je Anfrage und Art ("seerr-12-available"): dieselbe Aenderung ergibt nie zwei Eintraege,
   * auch nicht nach einem Neustart. Ziel ist der Titel bei Seerr (Art und TMDB-Nummer); requester nur bei newRequest.
   */
  function notificationOf(change, { title, posterPath = null, date = Date.now() } = {}) {
    const r = change.request;
    return {
      id: `seerr-${r.id}-${change.kind}`,
      kind: change.kind,
      date: new Date(date).toISOString(),
      read: false,
      mediaType: r.mediaType === 'tv' ? 'tv' : 'movie',
      tmdbId: Number(r.tmdbId),
      title: String(title ?? '').slice(0, 300),
      posterPath: typeof posterPath === 'string' ? posterPath.slice(0, 200) : null,
      seasons: Array.isArray(r.seasons) ? r.seasons.filter(Number.isInteger).slice(0, 200) : [],
      requester: change.kind === 'newRequest' && r.requesterName ? String(r.requesterName).slice(0, 120) : null
    };
  }

  const WORDS = {
    de: {
      q: (t) => `„${t}“`,
      headline: {
        availableMovie: 'Dein angefragter Film ist jetzt verfügbar',
        availableSeries: 'Deine angefragte Serie ist jetzt verfügbar',
        availableSeason: 'Deine angefragte Staffel ist jetzt verfügbar',
        availableSeasons: 'Deine angefragten Staffeln sind jetzt verfügbar',
        partiallyAvailable: 'Erste Folgen sind verfügbar',
        approved: 'Anfrage genehmigt',
        declined: 'Anfrage abgelehnt',
        failed: 'Anfrage fehlgeschlagen',
        newRequest: 'Neue Anfrage'
      },
      available: (n) => `${n} wurde deiner Mediathek hinzugefügt und kann jetzt abgespielt werden.`,
      availableSeasons: (list, n, one) => `${list} von ${n} ${one ? 'wurde' : 'wurden'} deiner Mediathek hinzugefügt.`,
      partiallyAvailable: (n) => `Von ${n} sind erste Folgen in deiner Mediathek.`,
      approved: (n) => `${n} wurde genehmigt und wird jetzt beschafft.`,
      declined: (n) => `Deine Anfrage für ${n} wurde abgelehnt.`,
      failed: (n) => `Seerr konnte die Anfrage für ${n} nicht weitergeben.`,
      newRequestBy: (who, n) => `${who} hat ${n} angefragt.`,
      newRequest: (n) => `${n} wurde angefragt.`
    },
    en: {
      q: (t) => `“${t}”`,
      headline: {
        availableMovie: 'Your requested movie is now available',
        availableSeries: 'Your requested show is now available',
        availableSeason: 'Your requested season is now available',
        availableSeasons: 'Your requested seasons are now available',
        partiallyAvailable: 'First episodes are available',
        approved: 'Request approved',
        declined: 'Request declined',
        failed: 'Request failed',
        newRequest: 'New request'
      },
      available: (n) => `${n} was added to your library and can be played now.`,
      availableSeasons: (list, n, one) => `${list} of ${n} ${one ? 'was' : 'were'} added to your library.`,
      partiallyAvailable: (n) => `First episodes of ${n} are in your library.`,
      approved: (n) => `${n} was approved and is being acquired now.`,
      declined: (n) => `Your request for ${n} was declined.`,
      failed: (n) => `Seerr couldn’t pass on the request for ${n}.`,
      newRequestBy: (who, n) => `${who} requested ${n}.`,
      newRequest: (n) => `${n} was requested.`
    }
  };
  const langOf = (lang) => (String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de');

  /** Ueberschrift ("Dein angefragter Film ist jetzt verfügbar"); "jetzt verfügbar" steht nur bei Titeln, die wirklich da sind. */
  function headline(n, lang) {
    const w = WORDS[langOf(lang)].headline;
    if (n.kind !== 'available') return w[n.kind] || '';
    if (n.mediaType === 'movie') return w.availableMovie;
    if (!n.seasons || !n.seasons.length) return w.availableSeries;
    return n.seasons.length === 1 ? w.availableSeason : w.availableSeasons;
  }

  /** Text der Mitteilung; Staffeln in der Schreibweise wie ueberall (Format.seasonList: "Staffeln 2, 3", ab drei als Bereich). */
  function message(n, lang) {
    const w = WORDS[langOf(lang)];
    const name = w.q(n.title);
    switch (n.kind) {
      case 'available':
        if (n.mediaType === 'movie' || !n.seasons || !n.seasons.length) return w.available(name);
        return w.availableSeasons(Format.seasonList(n.seasons, lang), name, n.seasons.length === 1);
      case 'newRequest':
        return n.requester ? w.newRequestBy(n.requester, name) : w.newRequest(name);
      default:
        return w[n.kind] ? w[n.kind](name) : '';
    }
  }

  /** Text fuer eine Mitteilung des Systems: wie in der App, aber nie mit dem Namen eines anderen Benutzers (sie steht auch auf dem Sperrbildschirm). */
  function systemMessage(n, lang) {
    return n.kind === 'newRequest' ? WORDS[langOf(lang)].newRequest(WORDS[langOf(lang)].q(n.title)) : message(n, lang);
  }

  /** Der Stand, den die Mitteilung meldet, in der gemeinsamen Darstellung der Seerr-Staende (fuer das Tag). */
  const STATE_OF = Object.freeze({ available: 'available', partiallyAvailable: 'partiallyAvailable', approved: 'approved', declined: 'declined', failed: 'failed', newRequest: 'requested' });
  const stateOf = (n) => STATE_OF[n && n.kind] || null;

  // ---------- Einstellungen ----------

  /** Je Profil und Seerr-Server: in der App an, Mitteilungen des Systems erst auf Wunsch, alle Arten. */
  const defaultPreferences = () => ({ enabled: true, system: false, kinds: [...KINDS] });

  /** Je Feld tolerant gelesen: ein unlesbares Feld faellt auf seinen Standard; eine unbekannte Art faellt aus der Auswahl, die uebrigen bleiben. */
  function readPreferences(raw) {
    const d = defaultPreferences();
    if (!isObject(raw)) return d;
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
      system: typeof raw.system === 'boolean' ? raw.system : d.system,
      kinds: Array.isArray(raw.kinds) ? KINDS.filter((k) => raw.kinds.includes(k)) : d.kinds
    };
  }

  /** Darf eine Mitteilung dieser Art entstehen? Aus heisst: keine. */
  const allows = (prefs, kind) => !!prefs && prefs.enabled === true && Array.isArray(prefs.kinds) && prefs.kinds.includes(kind);

  // ---------- Ablage ----------

  const ISO = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
  function readItem(x) {
    if (!isObject(x) || typeof x.id !== 'string' || !x.id || !KINDS.includes(x.kind)) return null;
    const date = ISO(x.date);
    if (!date || (x.mediaType !== 'movie' && x.mediaType !== 'tv') || !Number.isInteger(x.tmdbId)) return null;
    return {
      id: x.id.slice(0, 120),
      kind: x.kind,
      date,
      read: x.read === true,
      mediaType: x.mediaType,
      tmdbId: x.tmdbId,
      title: typeof x.title === 'string' ? x.title.slice(0, 300) : '',
      posterPath: typeof x.posterPath === 'string' ? x.posterPath.slice(0, 200) : null,
      seasons: Array.isArray(x.seasons) ? x.seasons.filter(Number.isInteger).slice(0, 200) : [],
      requester: typeof x.requester === 'string' && x.requester ? x.requester.slice(0, 120) : null
    };
  }
  /** Der gemerkte Stand je Anfrage; ein unlesbarer gilt als nie abgeglichen (der naechste Abgleich ist dann still und meldet nichts Falsches). */
  function readSnapshot(raw) {
    if (!isObject(raw)) return null;
    const out = {};
    for (const [id, s] of Object.entries(raw)) {
      if (!/^\d+$/.test(id) || !isObject(s) || typeof s.state !== 'string' || typeof s.own !== 'boolean') return null;
      out[id] = { state: s.state, own: s.own, ...(Number.isInteger(s.media) ? { media: s.media } : {}) };
    }
    return out;
  }
  const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  /**
   * Die Mitteilungen eines Profils an einem Seerr-Server, samt dem zuletzt gesehenen Stand der Anfragen und den Einstellungen (NotificationStore der
   * Apple-App). text: die gespeicherte Fassung (JSON) oder null. Je Feld tolerant: ein Eintrag mit unbekannter Art faellt weg, die uebrigen bleiben;
   * ein Stand ohne lesbare Zeit des Abgleichs gilt als nie abgeglichen.
   */
  function createStore(text = null) {
    let raw = null;
    try {
      raw = text ? JSON.parse(String(text)) : null;
    } catch {
      raw = null;
    }
    const data = { items: [], snapshot: null, lastSync: null, preferences: defaultPreferences(), removed: [] };
    if (isObject(raw)) {
      data.items = (Array.isArray(raw.items) ? raw.items : []).map(readItem).filter(Boolean);
      const seen = new Set();
      data.items = data.items.filter((x) => !seen.has(x.id) && seen.add(x.id)).sort(newestFirst).slice(0, LIMIT);
      data.lastSync = Number.isFinite(raw.lastSync) ? raw.lastSync : null;
      data.snapshot = data.lastSync === null ? null : readSnapshot(raw.snapshot);
      data.preferences = readPreferences(raw.preferences);
      data.removed = Array.isArray(raw.removed) ? raw.removed.filter((x) => typeof x === 'string').slice(-REMOVED_LIMIT) : [];
    }
    return {
      get items() {
        return data.items;
      },
      get snapshot() {
        return data.snapshot;
      },
      set snapshot(v) {
        data.snapshot = v;
      },
      get lastSync() {
        return data.lastSync;
      },
      set lastSync(v) {
        data.lastSync = v;
      },
      get preferences() {
        return data.preferences;
      },
      get unread() {
        return data.items.filter((x) => !x.read).length;
      },
      /** Zahl fuer den roten Punkt und den Eintrag im Profilmenue: die ungelesenen, 0 bei ausgeschalteten Mitteilungen (die Liste zeigt weiter alles). */
      get notice() {
        return data.preferences.enabled ? data.items.filter((x) => !x.read).length : 0;
      },
      /**
       * Neue Einstellungen. Werden die Mitteilungen wieder eingeschaltet, beginnt der Abgleich still wie beim ersten Verbinden: der gemerkte Stand gilt
       * nicht mehr (sonst kaemen alle Aenderungen aus der ausgeschalteten Zeit auf einmal nach).
       */
      setPreferences(next) {
        const p = readPreferences(next);
        if (!data.preferences.enabled && p.enabled) {
          data.snapshot = null;
          data.lastSync = null;
        }
        data.preferences = p;
      },
      /** Nimmt neue Eintraege auf; liefert die, die wirklich neu sind (nicht schon da, nicht vom Nutzer entfernt). Die neuesten LIMIT bleiben. */
      add(list) {
        const known = new Set([...data.items.map((x) => x.id), ...data.removed]);
        const fresh = (Array.isArray(list) ? list : []).map(readItem).filter((x) => x && !known.has(x.id) && known.add(x.id));
        if (!fresh.length) return [];
        data.items = [...data.items, ...fresh].sort(newestFirst).slice(0, LIMIT);
        return fresh;
      },
      markRead(id, read = true) {
        const x = data.items.find((n) => n.id === id);
        if (!x || x.read === !!read) return false;
        x.read = !!read;
        return true;
      },
      /** Alle als gelesen; liefert die Kennungen, die sich geaendert haben. */
      markAllRead() {
        const changed = data.items.filter((x) => !x.read).map((x) => x.id);
        for (const x of data.items) x.read = true;
        return changed;
      },
      /** Entfernt einen Eintrag; er taucht bei einem spaeteren Abgleich nicht wieder auf. */
      remove(id) {
        const i = data.items.findIndex((x) => x.id === id);
        if (i < 0) return false;
        data.items.splice(i, 1);
        data.removed = [...data.removed, id].slice(-REMOVED_LIMIT);
        return true;
      },
      /** Entfernt alle Eintraege; wie einzeln entfernte tauchen sie nicht wieder auf. Liefert ihre Kennungen. */
      removeAll() {
        const ids = data.items.map((x) => x.id);
        if (!ids.length) return [];
        data.removed = [...data.removed, ...ids].slice(-REMOVED_LIMIT);
        data.items = [];
        return ids;
      },
      serialize() {
        return JSON.stringify(data);
      }
    };
  }

  /** Ablage im Speicher (Tests, Fassungen ohne eigene Ablage): dieselbe Schnittstelle wie die Datei- bzw. Schluessel-Ablage der Huelle. */
  function memoryIo() {
    const files = new Map();
    return {
      read: (name) => (files.has(name) ? files.get(name) : null),
      write: (name, text) => void files.set(name, String(text)),
      remove: (name) => void files.delete(name),
      names: () => [...files.keys()]
    };
  }

  // ---------- Abgleich ----------

  /**
   * Abgleich der Mitteilungen fuer das aktive Profil (NotificationCenterModel der Apple-App; dort nicht im Schnappschuss, gebaut nach ihren Tests und
   * Notizen). io: { read(name), write(name, text), remove(name), names() } (Windows: Dateien im Datenordner; Web und Handy: Schluessel im Speicher);
   * hash(text): kurze Pruefsumme fuer die Namen der Ablage (Adresse des Servers und Kennung des Profils stehen nicht im Klartext darin); onChange(summary)
   * nach jeder Aenderung (roter Punkt, Profilmenue). Regeln:
   * - Anlaesse statt Dauerabfrage; ohne force mindestens zwei Minuten Abstand (nach dem Wechsel des Profils und dem Wiedereinschalten nicht).
   * - Nie zwei Abgleiche zugleich: ein gewuenschter wartet auf den laufenden.
   * - Das Ergebnis wird auf die Ablage angewendet, wie sie am Ende ist (was der Nutzer waehrenddessen liest, entfernt oder einstellt, bleibt).
   * - Laesst sich der Titel einer Aenderung nicht holen, bleibt ihr alter Stand gemerkt und die Zeit des Abgleichs rueckt nicht vor: der naechste bringt sie.
   * - Ein Wechsel des Profils oder das Aus- und Einschalten verwirft einen laufenden Abgleich (er traegt nichts mehr ein).
   * - Aus: kein Abgleich, kein Punkt; die Liste bleibt.
   */
  function createCenter({ io = memoryIo(), hash, now = () => Date.now(), onChange = () => {} } = {}) {
    if (typeof hash !== 'function') throw new Error('hash fehlt');
    let key = null; // { profile, seerr, name }
    let store = null;
    let generation = 0; // zaehlt jeden Wechsel (Profil, Seerr, an/aus): ein laufender Abgleich eines frueheren Stands traegt nichts ein
    let chain = Promise.resolve();
    let lastRun = 0; // Beginn des letzten Abgleichs (fuer den Mindestabstand); nur im Speicher
    let quiet = new Set();
    const titles = new Map(); // "movie:603" -> { title, posterPath }: je Titel nur einmal geholt

    const prefixOf = (profile) => `${hash(String(profile))}-`;
    const nameOf = (profile, seerr) => `${prefixOf(profile)}${hash(String(seerr))}`;
    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch {
        return fallback;
      }
    };
    const persist = () => {
      if (key && store) safe(() => io.write(key.name, store.serialize()));
    };
    const reset = () => {
      generation++;
      chain = Promise.resolve();
      lastRun = 0;
      quiet = new Set();
    };

    function summary() {
      return { active: !!store, enabled: store ? store.preferences.enabled : false, unread: store ? store.unread : 0, notice: store ? store.notice : 0 };
    }
    const publish = () => safe(() => onChange(summary()));

    /** Mitteilungen des Profils an diesem Seerr (next: { profile, seerr } oder null ohne Seerr). Derselbe Stand bleibt, wie er ist. */
    function activate(next) {
      const name = next && next.profile && next.seerr ? nameOf(next.profile, next.seerr) : null;
      if (name === (key ? key.name : null)) return;
      reset();
      titles.clear();
      key = name ? { profile: String(next.profile), seerr: String(next.seerr), name } : null;
      store = key ? createStore(safe(() => io.read(key.name), null)) : null;
      publish();
    }

    /** Entfernt, was zu einem Profil gespeichert ist (Profil entfernt oder abgemeldet), mit seerr nur das an diesem Seerr-Server (Seerr getrennt). */
    function forget(profile, seerr = null) {
      const prefix = prefixOf(profile);
      const only = seerr ? nameOf(profile, seerr) : null;
      for (const n of safe(() => io.names(), [])) if (only ? n === only : n.startsWith(prefix)) safe(() => io.remove(n));
      if (key && key.profile === String(profile) && (!only || key.name === only)) {
        reset();
        store = createStore(null);
        publish();
      }
    }

    /** Das Profil hat eine neue Kennung bekommen (Adresse des Servers geaendert): sein Bestand zieht mit, fuer jeden Seerr-Server. */
    function move(oldProfile, newProfile) {
      const from = prefixOf(oldProfile);
      const to = prefixOf(newProfile);
      if (from === to) return;
      for (const n of safe(() => io.names(), [])) {
        if (!n.startsWith(from)) continue;
        const text = safe(() => io.read(n), null);
        const target = to + n.slice(from.length);
        safe(() => io.remove(target));
        if (text !== null) safe(() => io.write(target, text));
        safe(() => io.remove(n));
      }
      if (key && key.profile === String(oldProfile)) key = { profile: String(newProfile), seerr: key.seerr, name: nameOf(newProfile, key.seerr) };
    }

    /** Die Anfrage aendert der Nutzer gleich selbst in der App (genehmigen, ablehnen, erneut versuchen, zurueckziehen): ihr neuer Stand wird nicht gemeldet. */
    function willChange(id) {
      if (Number.isInteger(+id) && +id > 0) quiet.add(Number(id));
    }

    async function titleOf(seerr, request) {
      const k = `${request.mediaType}:${request.tmdbId}`;
      if (titles.has(k)) return titles.get(k);
      const m = await seerr.media(request.mediaType, request.tmdbId);
      if (!m || !m.title) throw new Error('Titel fehlt');
      const t = { title: String(m.title), posterPath: typeof m.posterPath === 'string' ? m.posterPath : null };
      titles.set(k, t);
      return t;
    }

    async function run({ seerr, user, force, own }, mine) {
      if (mine !== generation || !store || !store.preferences.enabled) return [];
      if (!seerr || !user || !Number.isInteger(user.id)) return [];
      const started = now();
      if (!force && lastRun && started - lastRun < MIN_GAP_MS) return [];
      lastRun = started;
      const manages = SeerrState.canViewAllRequests(user.permissions);
      const page = (o) => seerr.requestPage({ ...o, take: TAKE }).then((r) => (Array.isArray(r && r.requests) ? r.requests : []));
      // Die eigenen (aus dem Reiter Anfragen mitgegeben, sonst abgerufen) und, mit dem Recht dazu, alle
      const [mineList, allList] = await Promise.all([Array.isArray(own) ? own : page({ userId: user.id }), manages ? page({}) : []]);
      if (mine !== generation || !store) return [];
      const byId = new Map();
      for (const r of [...mineList, ...allList]) if (r && Number.isInteger(r.id)) byId.set(r.id, r);
      const previous = store.snapshot;
      const silent = new Set(quiet);
      const { changes, snapshot } = detect({ previous, current: [...byId.values()], userId: user.id, manages, lastSync: store.lastSync, quiet: silent });
      const found = [];
      const failed = [];
      for (const change of changes) {
        try {
          const t = await titleOf(seerr, change.request);
          found.push(notificationOf(change, { ...t, date: now() }));
        } catch {
          failed.push(change);
        }
        if (mine !== generation || !store) return [];
      }
      // Auf die Ablage, wie sie jetzt ist: Gelesenes, Entferntes und Einstellungen von waehrenddessen bleiben
      for (const change of failed) {
        const id = change.request.id;
        if (hasOwn(previous, id)) snapshot[id] = previous[id];
        else delete snapshot[id];
      }
      store.snapshot = snapshot;
      if (!failed.length) store.lastSync = started - CLOCK_MARGIN_MS;
      for (const id of silent) quiet.delete(id);
      const fresh = store.add(found.filter((n) => allows(store.preferences, n.kind)));
      persist();
      publish();
      return fresh;
    }

    /**
     * Gleicht ab. seerr: { requestPage, media } (SeerrClient); user: { id, permissions } aus /auth/me; force: ausdruecklich gewuenscht (Uebersicht geoeffnet,
     * eigene Aktion), sonst mit Mindestabstand; own: die eigenen Anfragen, wenn der Reiter Anfragen sie gerade geladen hat. Liefert die neuen Eintraege;
     * scheitert nie (ein Fehler aendert nichts).
     */
    function sync({ seerr, user, force = false, own = null } = {}) {
      const mine = generation;
      const next = chain.then(() => run({ seerr, user, force, own }, mine));
      chain = next.catch(() => {});
      return next.catch(() => []);
    }

    const changed = () => {
      persist();
      publish();
    };

    return {
      activate,
      forget,
      move,
      willChange,
      sync,
      summary,
      get active() {
        return !!store;
      },
      /** Liste und Einstellungen fuer die Oberflaeche (Kopien). */
      list() {
        return { ...summary(), items: store ? store.items.map((x) => ({ ...x, seasons: [...x.seasons] })) : [], preferences: store ? { ...store.preferences, kinds: [...store.preferences.kinds] } : defaultPreferences() };
      },
      get preferences() {
        return store ? { ...store.preferences, kinds: [...store.preferences.kinds] } : defaultPreferences();
      },
      setPreferences(next) {
        if (!store) return;
        const p = readPreferences({ ...store.preferences, ...(isObject(next) ? next : {}) });
        const switched = p.enabled !== store.preferences.enabled;
        store.setPreferences(p);
        if (switched) reset(); // ein laufender Abgleich traegt nichts mehr ein; der naechste darf gleich laufen
        changed();
      },
      markRead(id, read = true) {
        if (store && store.markRead(String(id), read)) changed();
      },
      markAllRead() {
        if (store && store.markAllRead().length) changed();
      },
      remove(id) {
        if (store && store.remove(String(id))) changed();
      },
      removeAll() {
        if (store && store.removeAll().length) changed();
      }
    };
  }

  return {
    KINDS,
    LIMIT,
    REMOVED_LIMIT,
    MIN_GAP_MS,
    CLOCK_MARGIN_MS,
    INTERVAL_MS,
    TAKE,
    detect,
    notificationOf,
    headline,
    message,
    systemMessage,
    stateOf,
    defaultPreferences,
    readPreferences,
    allows,
    createStore,
    memoryIo,
    createCenter
  };
});
