/* Gemeinsames Modul: die "Rueckseite" der Oberflaeche, also alles, was hinter window.jc steckt und nicht an Electron haengt:
   Anmeldung (Passwort, Quick Connect), Jellyfin-Aufrufe, Seerr, Bitratengrenze des Servers, Einstellungen und der Zustand fuer die Oberflaeche.
   Der Hauptprozess (src/main/main.js) und die Web-/Handy-Fassung (src/web/jc-web.js) benutzen DASSELBE Modul, so verhalten sich beide gleich.
   Die Rueckgaben sind die Werte der IPC-Handler (ohne { ok, data }-Huelle); Fehler sind JellyfinError/SeerrError mit status und code.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCBackend). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jellyfin'), require('./seerr'), require('./quick-connect'), require('./rankings'), require('./notifications'), require('./seerr-state'), require('./handoff'), require('./bitrate'));
  else root.JCBackend = factory(root.JCJellyfin, root.JCSeerr, root.JCQuickConnect, root.JCRankings, root.JCNotifications, root.JCSeerrState, root.JCHandoff, root.JCBitrate);
})(typeof self !== 'undefined' ? self : this, function (Jelly, Seerr, QuickConnect, Rankings, Notifications, SeerrState, Handoff, Bitrate) {
  'use strict';

  const { JellyfinClient, JellyfinError, probeServer, CALLABLE_METHODS } = Jelly;
  const { SeerrClient, SeerrError, probeSeerr, loginWithJellyfin, seerrLanguage } = Seerr;

  /** Heimnetz und Bitratengrenze des Servers fuer diese Verbindung (Plan P21): zehn Minuten gemerkt, beim Wechsel des Servers oder Kontos verworfen. */
  const LIMITS_TTL_MS = Bitrate.HOME_TTL_MS;
  /** Verbindungspruefung (wie die Apple-App, ConnectionCheck): EINE Frist je Dienst fuer die ganze Pruefung, danach Abbruch, keine Wiederholung. */
  const CHECK_TIMEOUT_MS = 30 * 1000;

  /**
   * Fuehrt work(signal) mit einer Frist aus: kommt die Antwort rechtzeitig, zaehlt sie sofort; sonst wird abgebrochen (signal) und ein Fehler mit
   * code TIMEOUT geworfen. Es gibt keinen zweiten Versuch.
   */
  async function withDeadline(ms, work) {
    const ctrl = new AbortController();
    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(Object.assign(new Error('Keine Antwort in der Frist'), { code: 'TIMEOUT', status: 0 }));
      }, ms);
    });
    try {
      return await Promise.race([work(ctrl.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stand eines Dienstes nach der Pruefung: connected, unauthorized (Anmeldung abgelehnt), unreachable (keine Antwort, kein Netz, Frist, Proxy 502-504), failed. */
  function serviceState(e) {
    const status = Number(e?.status) || 0;
    if (status === 401 || status === 403) return { state: 'unauthorized' };
    if (!status || (status >= 502 && status <= 504)) return { state: 'unreachable', detail: String(e?.message ?? '') };
    return { state: 'failed', detail: String(e?.message ?? '') };
  }

  const sameUser = (a, b) => String(a ?? '').replace(/-/g, '').toLowerCase() === String(b ?? '').replace(/-/g, '').toLowerCase();

  /**
   * Gehoert der Seerr-Benutzer, den Seerr unter der gespeicherten Sitzung meldet, zu dem Jellyfin-Konto, mit dem sich das Profil bei Seerr angemeldet
   * hat (wie die Apple-App, SeerrAccount.accepts)? Gemerkt ist die Kennung seit Version 10 (jellyfinUserId aus /auth/me); fuer Eintraege ohne sie gilt
   * das Jellyfin-Konto des Profils. Ein Seerr-Benutzer ohne Jellyfin-Konto gehoert nie dazu.
   */
  function acceptsSeerrUser(user, account, profileUserId) {
    const mine = String(user?.jellyfinUserId ?? '');
    const expected = String(account?.jellyfinUserId || profileUserId || '');
    return !!mine && !!expected && sameUser(mine, expected);
  }

  /** Ein Fehler von Seerr mit Code SEERR_AUTH (Anmeldung abgelaufen oder verworfen): die Oberflaeche bietet "Erneut anmelden" an, Jellyfin bleibt angemeldet. */
  const seerrAuthError = (message = 'Seerr-Anmeldung abgelaufen') => Object.assign(new SeerrError(message), { status: 0, code: 'SEERR_AUTH' });

  /**
   * @param {object} deps
   * @param {import('./config-core').ConfigCore} deps.config Konfiguration (Server, Einstellungen, Seerr)
   * @param {typeof fetch} deps.fetch Abruffunktion (Hauptprozess: net.fetch, Handy: native HTTP-Schicht, Browser: fetch)
   * @param {() => string} deps.appVersion Version der App (fuer die Anmeldung beim Server und den Zustand)
   * @param {() => string} deps.locale Sprache des Systems ("de-DE" ...)
   * @param {string} [deps.deviceName] Geraetename fuer den Server (sonst der Rechnername bzw. "Web")
   * @param {() => object} [deps.extraState] weitere Felder fuer den Zustand der Oberflaeche (mpv, Updates, Plattform ...)
   * @param {(patch: object, settings: object) => void} [deps.onSettings] nach jeder Aenderung der Einstellungen (Autostart, Discord ...)
   * @param {number} [deps.checkTimeoutMs] Frist der Verbindungspruefung je Dienst (nur in Tests kuerzer)
   * @param {{read(name:string):string|null, write(name:string, text:string):void, remove(name:string):void, names():string[]}} [deps.notifyIo] Ablage der
   *   Mitteilungen je Profil und Seerr-Server (Windows: Dateien im Datenordner; Web und Handy: Schluessel im Speicher); ohne: nur im Speicher
   * @param {(summary: {active:boolean, enabled:boolean, unread:number, notice:number}) => void} [deps.onNotifications] nach jeder Aenderung der Mitteilungen
   * @param {{show(list:object[]):void, withdraw(ids:string[]):void, withdrawProfile(key:string):void}} [deps.systemNotify] Mitteilungen des Systems (Plan P18):
   *   zeigt fertige Mitteilungen (src/shared/notifications.js systemNotificationOf) und nimmt sie zurueck; ohne: keine
   * @param {() => {signature?: string, viaLocalInterface?: boolean|null}} [deps.connection] Netz des Geraets fuer die Heimnetz-Pruefung (Plan P21): signature
   *   aendert sich, wenn das Netz wechselt (dann gilt nichts Gemerktes mehr), viaLocalInterface false = Mobilfunk; ohne: unbekannt
   * @param {(host: string) => Promise<string[]>} [deps.resolveHost] DNS des Geraets fuer die Heimnetz-Pruefung: die Adressen eines Namens (Windows: Node,
   *   Android: InetAddress); ein Name mit privater Adresse gilt wie eine private Adresse (".int", Split-DNS); ohne: nur der Name zaehlt (Browser)
   */
  function createBackend({ config, fetch, appVersion, locale, deviceName, extraState = () => ({}), onSettings = () => {}, checkTimeoutMs = CHECK_TIMEOUT_MS, notifyIo = null, onNotifications = () => {}, systemNotify = null, connection = () => ({}), resolveHost = null }) {
    /** @type {InstanceType<typeof JellyfinClient>|null} */
    let client = null;
    /** @type {InstanceType<typeof SeerrClient>|null} Seerr des aktiven Profils, nur mit gueltiger Sitzung */
    let seerr = null;
    let seerrAccount = null; // eingerichtetes Seerr des aktiven Profils { url, userName, jellyfinUserId } (auch ohne Sitzung), sonst null
    let seerrUser = null; // der angemeldete Seerr-Benutzer mit Rechten aus der letzten Pruefung (/auth/me); nur im Speicher
    let seerrEpoch = 0; // zaehlt jeden Wechsel der Seerr-Sitzung (Profil, Verbinden, Trennen): aeltere Pruefungen und Abfragen verfallen
    let seerrCheckRun = null; // laufende Pruefung von Seerr { epoch, run } (Verbindungspruefung und Einstellungen teilen sie)
    const foreignDropped = new Set(); // Profile, deren Sitzung als fremde verworfen wurde: der Grund bleibt bis zur neuen Anmeldung sichtbar
    let limits = null;
    let limitsAt = 0;
    let limitsRun = null;
    let limitsNet = ''; // Netz, in dem `limits` entstand
    let lastLimit = null; // zuletzt gelesene Grenze des Servers (bit/s, null = keine): gilt weiter, wenn das Lesen scheitert
    const homeProbe = Bitrate.createNetworkMemo(); // antwortet die Heimadresse des Servers? je Netz zehn Minuten
    const bandwidth = Bitrate.createBandwidthMeter({ test: (bytes, ms) => (client ? client.bitrateTest(bytes, ms) : Promise.resolve(null)) });
    let check = null; // laufende Verbindungspruefung { client, run }: ein zweiter Anlass waehrenddessen bekommt dieselbe (keine Doppelanfragen)
    const callable = new Set(CALLABLE_METHODS);
    const rankings = Rankings.createStore(); // Top 10: Rangfolge je Server, Profil, Seerr und Zeitraum fuer 30 min (src/shared/rankings.js)
    // Mitteilungen je Profil und Seerr-Server (src/shared/notifications.js); die Namen der Ablage sind Pruefsummen, keine Adressen
    const hash = (t) => config.env.hashId(t);
    /** Ein Aufruf an die Mitteilungen des Systems der Huelle: ein Fehler dort aendert an den Mitteilungen der App nichts. */
    const toSystem = (fn) => {
      if (!systemNotify) return;
      try {
        Promise.resolve(fn(systemNotify)).catch(() => {});
      } catch {
        /* Huelle ohne diese Faehigkeit */
      }
    };
    /** Sprache der Mitteilungen des Systems: die der App (Einstellung), bei "automatisch" die des Systems. */
    const noticeLanguage = () => {
      const l = config.data.settings?.language;
      return l && l !== 'auto' ? l : locale();
    };
    const notices = Notifications.createCenter({
      io: notifyIo ?? Notifications.memoryIo(),
      hash,
      onChange: (s) => onNotifications(s),
      onDeliver: (items, profile) => toSystem((sys) => sys.show(items.map((n) => Notifications.systemNotificationOf(n, { profile, hash, lang: noticeLanguage() })))),
      onWithdraw: (ids, profile) => toSystem((sys) => (ids ? sys.withdraw(ids.map((id) => Notifications.systemId(id, profile, hash))) : sys.withdrawProfile(Notifications.profileKey(profile, hash))))
    });

    /** Schluessel der Top 10 fuer das aktive Profil; null ohne Jellyfin-Anmeldung oder ohne Seerr mit Sitzung (dann keine Quelle, keine Anfrage). */
    const rankingKey = (window) => (client && seerr ? Rankings.cacheKey({ server: client.baseUrl, user: client.userId ?? '', seerrAddress: seerr.baseUrl, window }) : null);

    const newClient = (o = {}) => new JellyfinClient({ deviceId: config.deviceId, clientVersion: appVersion(), ...(deviceName ? { deviceName } : {}), fetch, ...o });

    /** Verbindung fuer ein bestimmtes Profil (aktiv oder nicht), ohne das aktive zu wechseln; ohne gueltige Anmeldung 401. */
    function profileClient(id) {
      const s = config.getServer(id);
      if (!s) throw Object.assign(new JellyfinError('Unbekanntes Profil', { status: 404 }), { code: 'NO_PROFILE' });
      if (!s.token) throw new JellyfinError('Nicht angemeldet', { status: 401 });
      if (client && s.id === config.data.activeServerId) return client;
      return newClient({ baseUrl: s.url, token: s.token, userId: s.userId });
    }

    // ---------- Seerr ----------
    /** Sprache der Seerr-Texte: die der App (Einstellung), bei "automatisch" die des Systems. */
    const contentLanguage = () => {
      const l = config.data.settings?.language;
      return seerrLanguage(l && l !== 'auto' ? l : locale());
    };
    const seerrClient = (url, cookie) => new SeerrClient({ baseUrl: url, cookie, fetch, language: contentLanguage });

    /**
     * Seerr des aktiven Profils (seit Version 10 je Profil, nur mit der Sitzung des Jellyfin-Kontos). Jeder Aufbau verwirft Sitzung, Rechte und laufende
     * Pruefungen des vorigen Stands (wie die Apple-App beim Profilwechsel); ohne gueltige Sitzung bleibt Seerr eingerichtet, aber ohne Client.
     */
    function buildSeerr() {
      const s = config.getSeerr();
      seerrEpoch++;
      seerrUser = null;
      seerrCheckRun = null;
      rankings.reset(); // die Top 10 des vorigen Profils oder Seerr gelten nicht mehr
      seerrAccount = s ? { url: s.url, userName: s.userName, jellyfinUserId: s.jellyfinUserId } : null;
      seerr = s?.secret ? seerrClient(s.url, s.secret) : null;
      // Mitteilungen gelten je Profil und Seerr-Server; dasselbe bleibt beim erneuten Anmelden bestehen, ein anderes Seerr beginnt still
      const owner = config.data.activeServerId;
      notices.activate(owner && seerrAccount ? { profile: owner, seerr: seerrAccount.url } : null);
      return !!seerr;
    }

    /**
     * Gleicht die Mitteilungen des aktiven Profils ab (Anlaesse: bestaetigte Verbindung, Reiter Anfragen, Uebersicht, Takt der offenen App, eigene Aktion).
     * Ohne Seerr-Sitzung nichts; ohne bekannten Benutzer erst die Pruefung. Scheitert nie.
     */
    async function syncNotices({ force = false, own = null } = {}) {
      const s = seerr;
      if (!s || !notices.active || !notices.preferences.enabled) return [];
      if (!seerrUser) {
        const r = await checkSeerr().catch(() => null);
        if (r?.state !== 'connected' || s !== seerr) return [];
      }
      return notices.sync({ seerr: s, user: seerrUser, force, own });
    }
    // offered: die einmalige Frage "Mitteilungen aktivieren?" nach dem Verbinden von Seerr ist auf diesem Geraet schon gestellt (ConfigCore.noticesOffered)
    const noticesState = () => ({ ...notices.list(), manages: !!seerrUser && SeerrState.canViewAllRequests(seerrUser.permissions), offered: config.noticesOffered === true });

    // ---------- Auf diesem Geraet fortsetzen (Plan P19) ----------
    // Die Sitzungen der letzten Abfrage, die dem eigenen Konto gehoeren und nicht dieses Geraet sind: nur sie darf die Oberflaeche anhalten lassen
    let handoffOwn = { client: null, ids: new Set() };
    let controlOwn = { client: null, ids: new Set() }; // Angebote der letzten Uebersicht: nur sie nimmt die Fernbedienung an (handoffPlaystate)
    const requireClient = () => {
      if (!client) throw new JellyfinError('Nicht angemeldet', { status: 401 });
      return client;
    };

    function requireSeerr() {
      if (seerr) return seerr;
      // Eingerichtet, aber ohne Sitzung (verworfen oder nicht lesbar): wie eine abgelaufene Anmeldung, nicht wie "nicht verbunden"
      if (seerrAccount) throw seerrAuthError();
      throw new SeerrError('Seerr ist nicht verbunden');
    }

    /**
     * Ein 401 von Seerr (Sitzung abgelaufen) darf nicht wie ein abgelaufenes Jellyfin-Konto aussehen, die Oberflaeche wuerde sonst zur Jellyfin-Anmeldung wechseln.
     * Es kommt als Code SEERR_AUTH an.
     */
    async function seerrCall(fn) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof SeerrError && e.status === 401) throw seerrAuthError(e.message);
        throw e;
      }
    }

    /**
     * Lesende Abfrage an das Seerr des aktiven Profils. Wechselt waehrenddessen die Sitzung (Profilwechsel, Trennen, neu angemeldet), kommt weder die
     * Antwort noch ihr Fehler an (Code SEERR_STALE): sie gehoeren zum vorigen Profil. Schreibende Aufrufe laufen dagegen mit ihrer Sitzung zu Ende.
     */
    async function seerrRead(fn) {
      const epoch = seerrEpoch;
      const stale = () => Object.assign(new SeerrError('Das Profil wurde inzwischen gewechselt'), { status: 0, code: 'SEERR_STALE' });
      let r;
      try {
        r = await seerrCall(() => fn(requireSeerr()));
      } catch (e) {
        throw epoch === seerrEpoch ? e : stale();
      }
      if (epoch !== seerrEpoch) throw stale();
      return r;
    }

    /** Meldet eine Sitzung bei Seerr ab, ohne darauf zu warten oder an Fehlern zu scheitern (Trennen, Abmelden, Entfernen, fremde Sitzung). */
    const seerrLogout = (url, cookie) => (cookie ? seerrClient(url, cookie).logout() : Promise.resolve());

    /**
     * Eine verwaltende Aktion an einer Anfrage. Seerr lehnt eine Aktion ohne Recht auch mit 401 ab (am echten Seerr 3.5.1 gemessen): das ist keine
     * abgelaufene Anmeldung, daher Code SEERR_DENIED (die Oberflaeche prueft dann still, ob die Sitzung noch gilt); 404 heisst, die Anfrage gibt es nicht
     * mehr (SEERR_GONE); 409, sie ist nicht mehr ausstehend (SEERR_CHANGED).
     */
    async function requestManage(fn, { issue = false } = {}) {
      try {
        return await fn();
      } catch (e) {
        // issue: Meldungen zu einem gemeldeten Problem statt zu einer Anfrage (gleiche Codes, eigener Wortlaut)
        const what = issue ? 'das Problem' : 'die Anfrage';
        if (e instanceof SeerrError && (e.status === 401 || e.status === 403)) throw Object.assign(new SeerrError(`Das ist mit deinem Seerr-Konto nicht möglich, oder ${what} hat sich inzwischen geändert.`), { status: e.status, code: 'SEERR_DENIED' });
        if (e instanceof SeerrError && e.status === 404) throw Object.assign(new SeerrError(issue ? 'Dieses Problem gibt es nicht mehr.' : 'Diese Anfrage gibt es nicht mehr.'), { status: 404, code: 'SEERR_GONE' });
        if (e instanceof SeerrError && e.status === 409) throw Object.assign(new SeerrError(issue ? 'Das Problem hat sich inzwischen geändert.' : 'Die Anfrage wartet nicht mehr auf eine Entscheidung und lässt sich nicht mehr ändern.'), { status: 409, code: 'SEERR_CHANGED' });
        throw e;
      }
    }

    /**
     * Uebernimmt eine eben erhaltene Seerr-Sitzung fuer das Profil, fuer das sie angelegt wurde (beide Anmeldewege). Gespeichert werden nur die Sitzung
     * und das Jellyfin-Konto, das Seerr dazu nennt (/auth/me); eine Anmeldung ohne Jellyfin-Konto gilt nicht. mustBelongTo: ohne Passwort hat das Profil
     * sich selbst bestaetigt, die Sitzung muss also seinem Jellyfin-Konto gehoeren. Eine vorige Sitzung des Profils wird bei Seerr abgemeldet.
     */
    async function adoptSeerrSession({ owner, url, cookie, userName, mustBelongTo = null }) {
      const fresh = seerrClient(url, cookie);
      let me;
      try {
        me = await fresh.me();
      } catch (e) {
        fresh.logout();
        throw e;
      }
      if (!me.jellyfinUserId) {
        fresh.logout();
        throw new SeerrError('Seerr nennt zu dieser Anmeldung kein Jellyfin-Konto');
      }
      if (mustBelongTo !== null && !sameUser(me.jellyfinUserId, mustBelongTo)) {
        fresh.logout();
        throw new SeerrError(Seerr.QC_PROBLEMS.foreignAccount, { code: 'QC_foreignAccount' });
      }
      // Wurde waehrend der Anmeldung das Profil gewechselt, gehoert die Sitzung keinem: sonst landete sie beim falschen Profil
      if (config.data.activeServerId !== owner) {
        fresh.logout();
        throw new SeerrError('Das Profil wurde inzwischen gewechselt. Bitte noch einmal verbinden.');
      }
      const before = config.getSeerr(owner);
      config.saveSeerr({ url, userName: userName || me.displayName || '', jellyfinUserId: me.jellyfinUserId, secret: cookie });
      if (before?.secret && before.secret !== cookie) seerrLogout(before.url, before.secret);
      foreignDropped.delete(owner);
      buildSeerr();
      seerrUser = { id: me.id, displayName: me.displayName, permissions: me.permissions };
      return publicState();
    }

    /**
     * Prueft das Seerr des aktiven Profils: /status (erreichbar?) und /auth/me (Sitzung gueltig, welches Konto, welche Rechte?) unter EINER Frist.
     * Meldet Seerr ein anderes Jellyfin-Konto als das, mit dem sich das Profil angemeldet hat (fremde Sitzung), wird die Sitzung bei Seerr abgemeldet und
     * verworfen; Adresse und Konto bleiben fuer "Erneut anmelden". Netzfehler und eine abgelaufene Anmeldung loeschen nichts.
     * @returns {Promise<{state:'none'|'connected'|'unauthorized'|'unreachable'|'failed', detail?:string, reason?:string, user?:object}>}
     */
    function checkSeerr() {
      const epoch = seerrEpoch;
      if (seerrCheckRun?.epoch === epoch) return seerrCheckRun.run;
      const s = seerr;
      const account = seerrAccount;
      const owner = config.data.activeServerId;
      const profileUserId = config.getServer(owner)?.userId ?? '';
      const run = (async () => {
        if (!account) return { state: 'none' };
        if (!s) return { state: 'unauthorized', reason: foreignDropped.has(owner) ? 'foreign' : 'noSession' };
        let me;
        try {
          me = await withDeadline(checkTimeoutMs, async (signal) => {
            await s.request('GET', '/status', { signal, timeout: checkTimeoutMs });
            return s.me({ signal, timeout: checkTimeoutMs });
          });
        } catch (e) {
          return serviceState(e);
        }
        if (epoch !== seerrEpoch) return checkSeerr(); // inzwischen andere Sitzung: deren Stand zaehlt
        if (!acceptsSeerrUser(me, account, profileUserId)) {
          s.logout();
          foreignDropped.add(owner);
          config.dropSeerrSession(owner);
          buildSeerr();
          return { state: 'unauthorized', reason: 'foreign' };
        }
        seerrUser = { id: me.id, displayName: me.displayName, permissions: me.permissions };
        return { state: 'connected', user: { ...seerrUser } };
      })();
      const mine = { epoch, run };
      seerrCheckRun = mine;
      run
        .finally(() => {
          if (seerrCheckRun === mine) seerrCheckRun = null;
        })
        .catch(() => {}); // der Fehler geht an den Aufrufer, nicht noch einmal ins Leere
      return run;
    }

    // ---------- Heimnetz und Bitratengrenze (Plan P21) ----------
    const netNow = () => {
      try {
        const c = connection() ?? {};
        return { signature: String(c.signature ?? ''), viaLocalInterface: typeof c.viaLocalInterface === 'boolean' ? c.viaLocalInterface : null };
      } catch {
        return { signature: '', viaLocalInterface: null };
      }
    };

    /**
     * Heimnetz oder Internet und die Grenze des Servers (JellyfinClient.getStreamingLimits). Gemerkt zehn Minuten, solange das Netz dasselbe ist und
     * das Ergebnis feststand; force (Start der Wiedergabe, "Pruefen") fragt neu, die Probe der Heimadresse bleibt je Netz gemerkt. Scheitert das Lesen
     * der Grenze, gilt die zuletzt gelesene weiter (limitStale), ohne jede fruehere Antwort keine.
     */
    function refreshLimits(force = false) {
      if (!client) return Promise.resolve(null);
      const net = netNow();
      if (limitsRun && limitsRun.net === net.signature) return limitsRun.p;
      if (!force && limits && limits.settled && limitsNet === net.signature && Date.now() - limitsAt < LIMITS_TTL_MS) return Promise.resolve(limits);
      const mine = client;
      const p = mine
        .getStreamingLimits({ viaLocalInterface: net.viaLocalInterface, probeHome: (run) => homeProbe.get(net.signature, run), resolveHost })
        .then((l) => {
          if (client !== mine) return l;
          const out = { ...l };
          if (!out.home) {
            if (out.limitRead === undefined) {
              out.limitBps = lastLimit ?? 0;
              out.limitStale = true;
            } else lastLimit = out.limitRead;
          }
          delete out.limitRead;
          limits = out;
          limitsAt = Date.now();
          limitsNet = net.signature;
          return out;
        })
        .catch(() => limits)
        .finally(() => {
          if (limitsRun?.p === p) limitsRun = null;
        });
      limitsRun = { net: net.signature, p };
      return p;
    }

    function resetLimits() {
      limits = null;
      limitsAt = 0;
      limitsRun = null;
      lastLimit = null;
      homeProbe.reset();
      bandwidth.reset();
    }

    /** Bandbreite zum Server in Mbit/s fuer "Automatisch" ausserhalb des Heimnetzes (30 min gemerkt); quick: hoechstens 4 s warten. null: nicht messbar. */
    function measureBandwidth({ quick = false } = {}) {
      if (!client) return Promise.resolve(null);
      return bandwidth.measure({ quick: !!quick });
    }

    // ---------- Server und Konto ----------
    function activateServer(id) {
      const server = config.getServer(id);
      client = server?.token ? newClient({ baseUrl: server.url, token: server.token, userId: server.userId }) : null;
      resetLimits();
      if (client) refreshLimits().catch(() => {});
      buildSeerr(); // jedes Profil hat sein eigenes Seerr
      return !!client;
    }

    function publicState() {
      return {
        ...config.publicState(),
        loggedIn: !!client,
        appVersion: appVersion(),
        locale: locale(),
        ...extraState()
      };
    }

    /**
     * Nach erfolgreicher Anmeldung: Konto merken, Faehigkeiten melden, Bitratengrenze holen. Hoechstens vier Profile (wie in der Apple-App): ein neues
     * ueber der Grenze wird abgelehnt und seine eben erhaltene Sitzung am Server wieder abgemeldet (sonst bliebe sie dort verwaist); ein gemerktes darf immer.
     */
    async function adopt(c, probed, auth) {
      if (!config.mayAddProfile(config.profileId(probed.url, auth.userId))) {
        await c.logout().catch(() => {});
        throw Object.assign(new JellyfinError(`Höchstens ${config.maxProfiles} Profile`), { code: 'PROFILE_LIMIT' });
      }
      config.saveServer({ url: probed.url, name: probed.name, serverId: auth.serverId || probed.id || '', userId: auth.userId, userName: auth.userName, token: auth.token });
      client = c;
      buildSeerr();
      client.postCapabilities();
      resetLimits();
      refreshLimits().catch(() => {});
    }

    async function probe(url) {
      const r = await probeServer(url, fetch);
      return { url: r.url, name: r.info.ServerName, version: r.info.Version, id: typeof r.info.Id === 'string' ? r.info.Id : '' };
    }

    /** Meldet das aktive Profil ab (am Jellyfin-Server und bei Seerr) und entfernt nur dieses Profil samt seiner Seerr-Sitzung; das naechste gemerkte wird aktiv. */
    async function logout() {
      const id = config.data.activeServerId;
      const z = id ? config.getSeerr(id) : null;
      await Promise.all([client?.logout(), z ? seerrLogout(z.url, z.secret) : null]);
      if (id) notices.forget(id); // abgemeldet: die Mitteilungen des Profils gehen mit
      if (id) config.removeServer(id);
      client = null;
      check = null;
      resetLimits();
      if (config.data.activeServerId) activateServer(config.data.activeServerId);
      else buildSeerr(); // ohne Profil auch kein Seerr
      return publicState();
    }

    /** Jellyfin des aktiven Profils: /Users/Me (verlangt eine gueltige Anmeldung). Liefert dazu, ob das Konto Administrator ist (die Oberflaeche braucht es beim Start). */
    async function checkJellyfin(c) {
      try {
        const me = await withDeadline(checkTimeoutMs, (signal) => c.request('GET', '/Users/Me', { signal, timeout: checkTimeoutMs }));
        return { state: 'connected', isAdmin: !!me?.Policy?.IsAdministrator };
      } catch (e) {
        return serviceState(e);
      }
    }

    return {
      get client() {
        return client;
      },
      get seerr() {
        return seerr;
      },
      /** Der angemeldete Seerr-Benutzer des aktiven Profils aus der letzten Pruefung ({ id, displayName, permissions }), sonst null. */
      get seerrUser() {
        return seerrUser ? { ...seerrUser } : null;
      },
      get limits() {
        return limits;
      },
      buildSeerr,
      activateServer,
      refreshLimits,
      resetLimits,
      measureBandwidth,
      publicState,

      probeServer: probe,

      async login({ url, username, password }) {
        const probed = await probe(url);
        const c = newClient({ baseUrl: probed.url });
        const auth = await c.authenticateByName(String(username ?? ''), String(password ?? ''));
        await adopt(c, probed, auth);
        return publicState();
      },

      async quickConnectStart(url) {
        const probed = await probe(url);
        const c = newClient({ baseUrl: probed.url });
        if (!(await c.quickConnectEnabled())) throw new JellyfinError('Quick Connect ist auf diesem Server nicht aktiviert');
        const r = await c.quickConnectInitiate();
        return { url: probed.url, name: probed.name, secret: r.Secret, code: r.Code };
      },

      async quickConnectPoll({ url, name, secret }) {
        const c = newClient({ baseUrl: url });
        const r = await c.quickConnectCheck(secret);
        if (!r?.Authenticated) return { done: false };
        const auth = await c.authenticateWithQuickConnect(secret);
        await adopt(c, { url, name }, auth);
        return { done: true, state: publicState() };
      },

      logout,

      switchServer(id) {
        if (!config.setActive(id)) throw new Error('Unbekannter Server');
        if (!activateServer(id)) throw new Error('Anmeldung abgelaufen, bitte erneut anmelden');
        return publicState();
      },

      // ---------- Profile (wie die Apple-App, ProfileEditor) ----------
      /**
       * Eigener Name (nur auf diesem Geraet; leer: der Name des Benutzers) und Serveradresse eines Profils. Eine neue Adresse muss zu DEMSELBEN Server
       * fuehren (gleiche Kennung, und die Anmeldung des Profils gilt dort): dann bleibt das Profil angemeldet und behaelt eigenen Namen, Seerr und Reihen.
       * Scheitert die Pruefung, aendert sich nichts. Gibt die (bei neuer Adresse neue) Kennung des Profils und den Zustand zurueck.
       */
      async updateProfile({ id, label, url } = {}) {
        const server = config.getServer(id);
        if (!server) throw Object.assign(new JellyfinError('Unbekanntes Profil', { status: 404 }), { code: 'NO_PROFILE' });
        let next = id;
        const input = typeof url === 'string' ? url.trim() : '';
        if (input && input !== server.url) {
          const probed = await probe(input);
          if (probed.url !== server.url) {
            if (server.serverId && probed.id && probed.id !== server.serverId) throw Object.assign(new JellyfinError('Unter dieser Adresse antwortet ein anderer Server'), { code: 'OTHER_SERVER' });
            if (!server.token) throw new JellyfinError('Nicht angemeldet', { status: 401 });
            let me;
            try {
              me = await newClient({ baseUrl: probed.url, token: server.token, userId: server.userId }).getMe();
            } catch (e) {
              // Die Anmeldung gilt dort nicht: ein anderer Server (oder ein anderes Konto); das Profil bleibt, wie es war
              if (e.status === 401) throw Object.assign(new JellyfinError('Unter dieser Adresse ist das Profil nicht angemeldet'), { code: 'OTHER_SERVER' });
              throw e;
            }
            if (!sameUser(me?.Id, server.userId)) throw Object.assign(new JellyfinError('Unter dieser Adresse antwortet ein anderer Server'), { code: 'OTHER_SERVER' });
            // Waehrend der Pruefung entfernt oder schon umgezogen: nichts mehr zu tun
            if (!config.getServer(id)) throw Object.assign(new JellyfinError('Unbekanntes Profil', { status: 404 }), { code: 'NO_PROFILE' });
            next = config.moveProfile(id, { url: probed.url, name: probed.name, serverId: probed.id });
            notices.move(id, next); // die Mitteilungen ziehen mit (vor dem Aufbau: dort gilt schon die neue Kennung)
            if (config.data.activeServerId === next) activateServer(next); // die Verbindung des aktiven Profils geht jetzt an die neue Adresse
          }
        }
        if (typeof label === 'string') config.setProfileLabel(next, label);
        return { id: next, state: publicState() };
      },

      /**
       * Entfernt ein Profil von diesem Geraet und meldet es am Server ab (das Konto auf dem Server bleibt). Das aktive Profil entfernen heisst abmelden:
       * dann wird das naechste gemerkte aktiv (sonst erscheint die Anmeldung).
       */
      async removeProfile(id) {
        if (id && id === config.data.activeServerId) return logout();
        const server = config.getServer(id);
        if (!server) return publicState();
        const z = config.getSeerr(id);
        await Promise.all([server.token ? newClient({ baseUrl: server.url, token: server.token, userId: server.userId }).logout() : null, z ? seerrLogout(z.url, z.secret) : null]);
        notices.forget(id);
        config.removeServer(id);
        return publicState();
      },

      // ---------- Verbindungspruefung (Start, Profilwechsel, Rueckkehr in die App) ----------
      /**
       * Prueft Jellyfin und Seerr des aktiven Profils nebeneinander, je Dienst mit EINER Frist (30 s) und ohne Wiederholung. Bei Netzfehlern wird nichts
       * geloescht; eine abgelehnte Anmeldung meldet "unauthorized" (die Oberflaeche zeigt dann die Anmeldung, wie bei jedem 401).
       * Laeuft fuer dasselbe Profil schon eine Pruefung, kommt deren Ergebnis (keine Doppelanfragen).
       */
      checkConnection({ seerr: withSeerr = true } = {}) {
        const id = config.data.activeServerId;
        if (!client || !id) return Promise.resolve({ profileId: id, jellyfin: { state: 'none' }, seerr: { state: 'none' } });
        // Mit seerr: false nur Jellyfin: die Oberflaeche wartet beim Start nur darauf, Seerr meldet sich ueber seerrCheck nach (ein haengendes Seerr haelt
        // den Start nicht bis zum Ende seiner Frist auf)
        if (check?.client !== client) {
          const mine = { client };
          mine.run = checkJellyfin(client).finally(() => {
            if (check === mine) check = null;
          });
          check = mine;
        }
        return Promise.all([check.run, withSeerr ? checkSeerr() : null]).then(([jellyfin, seerrState]) => ({ profileId: id, jellyfin, ...(seerrState ? { seerr: seerrState } : {}) }));
      },

      // ---------- Quick Connect fuer andere Geraete ----------
      /** Bietet der Server des Profils Quick Connect an? Wirft bei Netz- und Serverfehlern (die Maske bleibt dann zur Eingabe offen). */
      quickConnectAvailable: (id) => profileClient(id).quickConnectEnabled({ strict: true }),

      /**
       * Bestaetigt den Code eines anderen Geraets mit dem Konto des Profils id (fest fuer die offene Maske, auch wenn das aktive Profil inzwischen wechselt).
       * Fehler tragen den Hinweis aus der Antwort als code (QuickConnect.HINT), denn der Text der Antwort geht nicht ueber die IPC-Grenze.
       */
      async quickConnectAuthorize({ id, code } = {}) {
        const c = profileClient(id);
        const clean = QuickConnect.clean(code);
        if (!QuickConnect.isComplete(clean)) throw new JellyfinError('Der Code hat sechs Ziffern', { status: 400 });
        try {
          await c.quickConnectAuthorize(clean);
          return true;
        } catch (e) {
          const hint = e instanceof JellyfinError ? QuickConnect.hintOf(e) : null;
          throw new JellyfinError(e?.message ?? String(e), { status: e?.status ?? 0, code: hint ?? e?.code ?? null });
        }
      },

      /** Jellyfin-Aufruf der Oberflaeche: nur freigegebene Methoden (CALLABLE_METHODS), nur mit Anmeldung. */
      async api(method, args) {
        if (!callable.has(method)) throw new Error('Unbekannte Methode');
        if (!client) throw new JellyfinError('Nicht angemeldet', { status: 401 });
        return client[method](...(Array.isArray(args) ? args : []));
      },

      streamingLimits: (force) => refreshLimits(!!force),

      // ---------- Einstellungen ----------
      setSettings(patch) {
        // Die Update-Quelle ist fest eingebaut: ein Versuch, sie ueber die Oberflaeche zu setzen, wird verworfen (sie kommt nie aus den Einstellungen)
        if (patch?.general && typeof patch.general === 'object') {
          delete patch.general.updateSource;
          delete patch.general.updateCustom;
        }
        // Discord: die Application-ID besteht nur aus Ziffern (hoechstens 20), der Name hoechstens 128 Zeichen
        if (patch?.discord && typeof patch.discord === 'object') {
          if ('clientId' in patch.discord) patch.discord.clientId = typeof patch.discord.clientId === 'string' ? patch.discord.clientId.replace(/\D/g, '').slice(0, 20) : '';
          if ('name' in patch.discord) patch.discord.name = typeof patch.discord.name === 'string' ? patch.discord.name.slice(0, 128) : '';
        }
        const s = config.updateSettings(patch);
        onSettings(patch, s);
        return s;
      },

      resetSettings() {
        const s = config.resetSettings();
        onSettings(null, s);
        return s;
      },

      // ---------- Seerr (Anfragen) ----------
      /**
       * Seerr fuer das aktive Profil anmelden: nur mit einem Jellyfin-Konto (vorbelegt mit dem des Profils, aenderbar; kein API-Schluessel, Entscheidung
       * E12). Gespeichert werden nur die Sitzung und das Jellyfin-Konto, das Seerr dazu nennt (/auth/me); eine Anmeldung ohne Jellyfin-Konto gilt nicht.
       * Eine vorige Sitzung des Profils (erneutes Anmelden) wird bei Seerr abgemeldet.
       */
      seerrConnect: ({ url, username, password }) =>
        seerrCall(async () => {
          const owner = config.data.activeServerId;
          if (!owner) throw new SeerrError('Zuerst bei Jellyfin anmelden');
          const name = String(username ?? '').trim().slice(0, 200);
          if (!name) throw new SeerrError('Jellyfin-Konto fehlt');
          const probed = await probeSeerr(url, fetch);
          const r = await loginWithJellyfin(probed.url, name, String(password ?? ''), fetch);
          return adoptSeerrSession({ owner, url: probed.url, cookie: r.cookie, userName: name });
        }),
      /**
       * Seerr ohne Passwort (wie connectSeerrWithQuickConnect der Apple-App): Seerr holt einen Quick-Connect-Code, die App bestaetigt ihn mit der
       * Sitzung dieses Profils bei Jellyfin, Seerr liefert die Sitzung. Nur ueber https oder im Heimnetz (die Seerr-Adresse oder der Jellyfin-Server
       * gilt als Heimnetz), genau ein Code, sofort, nie wiederholt; die Sitzung muss dem Jellyfin-Konto dieses Profils gehoeren.
       */
      seerrConnectQuick: ({ url } = {}) =>
        seerrCall(async () => {
          const owner = config.data.activeServerId;
          if (!owner || !client) throw new SeerrError('Zuerst bei Jellyfin anmelden');
          const server = config.data.servers.find((s) => s.id === owner);
          const probed = await probeSeerr(url, fetch);
          // Heimnetz: die Seerr-Adresse ist privat (dem Namen oder dem DNS nach), oder die Verbindung zu Jellyfin gilt als Heimnetz (dieselbe Pruefung
          // wie die Bitratensteuerung)
          const home =
            Bitrate.addressLooksLocal(probed.url) || (await Bitrate.hostResolvesLocal(probed.url, resolveHost)) || (await refreshLimits().catch(() => null))?.home === true;
          if (!Seerr.quickConnectAllowed(probed.url, home)) throw new SeerrError(Seerr.QC_PROBLEMS.notAllowed, { code: 'QC_notAllowed' });
          const { code, secret } = await Seerr.quickConnectInitiate(probed.url, fetch);
          let authorized = false;
          try {
            authorized = (await client.quickConnectAuthorize(code)) !== false;
          } catch {
            authorized = false;
          }
          if (!authorized) throw new SeerrError(Seerr.QC_PROBLEMS.unavailable, { code: 'QC_unavailable' });
          const cookie = await Seerr.quickConnectAuthenticate(probed.url, secret, fetch);
          return adoptSeerrSession({ owner, url: probed.url, cookie, userName: server?.userName ?? '', mustBelongTo: client.userId });
        }),
      /** Trennt Seerr vom aktiven Profil: die Sitzung wird bei Seerr abgemeldet und entfernt; die Adresse bleibt zum erneuten Verbinden vorbelegt. */
      seerrDisconnect: () =>
        seerrCall(() => {
          const z = config.getSeerr();
          // Mitteilungen und ihre Einstellungen gelten fuer dieses Seerr: sie gehen mit (wie die Apple-App, forgetSeerrSession)
          if (z && config.data.activeServerId) notices.forget(config.data.activeServerId, z.url);
          config.clearSeerr();
          foreignDropped.delete(config.data.activeServerId);
          buildSeerr();
          if (z) seerrLogout(z.url, z.secret);
          return publicState();
        }),
      /** Prueft nur Seerr (Einstellungen > Seerr: beim Oeffnen und alle 20 s); dasselbe Ergebnis wie in checkConnection. */
      async seerrCheck() {
        const profileId = config.data.activeServerId;
        return { profileId, seerr: await checkSeerr() };
      },
      seerrSearch: (query, page) => seerrRead((s) => s.search(String(query ?? '').slice(0, 200), Number(page) || 1)),
      seerrTrending: () => seerrRead((s) => s.trending()),
      /**
       * Top 10 Filme und Top 10 Serien des aktiven Profils ({ available, window, honors, movies, series, failure? }); ohne Seerr { available: false } ohne
       * jede Anfrage. Die Startseite wartet nicht darauf. force: auch die Rangfolge neu (Neu laden). Wechselt waehrenddessen Profil oder Seerr, kommt die
       * Antwort nicht an (Code RANKINGS_STALE).
       */
      topTen(o) {
        const window = Rankings.normWindow(o?.window);
        if (!client) return Promise.reject(new JellyfinError('Nicht angemeldet', { status: 401 }));
        const c = client;
        const s = seerr;
        const key = rankingKey(window);
        return rankings.get(key, {
          force: o?.force === true,
          full: () => seerrCall(() => Rankings.load({ jellyfin: c, seerr: { rankingPage: (kind, w, page) => s.trendingPage({ mediaType: Rankings.KINDS[kind].mediaType, timeWindow: w, page }).then((r) => Rankings.parsePage(r, kind, page)) }, window })),
          items: (ids) => c.itemsInOrder(ids)
        });
      },
      /** Stand der Top 10 fuer die Einstellungen (ohne zu laden): Quelle da, befolgt Seerr den Zeitraum, laedt, Fehler, Zahl der Titel. */
      topTenStatus: (o) => rankings.status(rankingKey(Rankings.normWindow(o?.window))),
      seerrDetails: (req) => seerrRead((s) => s.details(req?.mediaType, req?.mediaId)),
      // Anfrage: ein Film oder die gewaehlten Staffeln einer Serie (ohne Wahl alle); nie 4K. Ein Schreibvorgang: laeuft mit seiner Sitzung zu Ende.
      seerrRequest: (req) => seerrCall(() => requireSeerr().requestMedia({ mediaType: req?.mediaType, mediaId: req?.mediaId, seasons: Array.isArray(req?.seasons) ? req.seasons.slice(0, 200) : null })),
      /** Empfohlene oder aehnliche Titel (kind "recommendations" | "similar"), die Filme einer Filmreihe, die Bewertung von IMDb (Seite eines Titels). */
      seerrRelated: (req) => seerrRead((s) => s.related(req?.mediaType, Number(req?.tmdbId), req?.kind)),
      seerrCollection: (id) => seerrRead((s) => s.collection(Number(id))),
      seerrImdb: (tmdbId) => seerrRead((s) => s.imdbRating(Number(tmdbId))),
      /** Eine Person und ihre Filmografie (Seite einer Person); verbunden mit der Mediathek wird nur ueber die TMDB-Nummer. */
      seerrPerson: (id) => seerrRead((s) => s.person(Number(id))),
      seerrFilmography: (id) => seerrRead((s) => s.filmography(Number(id))),
      /** Kontingent des angemeldeten Seerr-Benutzers (Nummer aus /auth/me; ohne bekannten Benutzer erst die Pruefung); null, wenn er nicht feststeht. */
      async seerrQuota() {
        if (!seerrUser && seerr) await checkSeerr();
        return seerrRead((s) => (seerrUser ? s.quota(seerrUser.id) : null));
      },

      /**
       * Eine Seite der Anfragen (Reiter Anfragen): scope "mine" nur die eigenen (requestedBy, die Nummer aus /auth/me; ohne bekannten Benutzer
       * erst die Pruefung, sonst liefe die Abfrage ohne Filter und zeigte Verwaltern alle), "manage" alle, soweit Seerr sie dem Benutzer zeigt.
       */
      /**
       * Zahl der wartenden Anfragen fuer den Reiter "Anfragen" (Build 98 der Apple-App): nur fuer ein Seerr-Konto, das Anfragen verwalten darf (sonst null,
       * dann keine Zahl). Erst nach einer bestaetigten Verbindung (seerrUser), wie bei den Mitteilungen.
       */
      async seerrPendingCount() {
        if (!seerr || !seerrUser || !SeerrState.canManageRequests(seerrUser.permissions)) return null;
        return seerrRead((s) => s.pendingRequestCount());
      },
      async seerrRequests({ scope = 'mine', skip = 0, take = 50 } = {}) {
        const mine = scope !== 'manage';
        let checked = null;
        if (mine && !seerrUser && seerr) checked = await checkSeerr();
        const page = await seerrRead((s) => {
          if (mine && !seerrUser) {
            if (checked?.state === 'unauthorized') throw seerrAuthError();
            throw new SeerrError(checked?.detail || 'Seerr hat keinen Benutzer gemeldet');
          }
          return s.requestPage({ userId: mine ? seerrUser.id : null, skip, take });
        });
        // Die eigenen Anfragen, eben geladen: der Abgleich der Mitteilungen nimmt sie mit (mit Mindestabstand, im Hintergrund)
        if (mine && !skip) syncNotices({ own: page.requests }).catch(() => {});
        return page;
      },
      /** Titel, Jahr, Bild und Stand eines Titels fuer ein Plakat der Anfragen. */
      seerrMedia: (req) => seerrRead((s) => s.media(req?.mediaType, Number(req?.tmdbId))),
      /** Eine Seite einer Entdecken-Liste (Reihen der Startseite und Seite "Beliebte Filme/Serien"); row: Kennung aus HomeRows.DISCOVER. */
      seerrDiscover: ({ path, page = 1, genre = null } = {}) => seerrRead((s) => s.discover(String(path ?? ''), { page, genre })),
      seerrGenres: (mediaType) => seerrRead((s) => s.genres(mediaType)),
      /** Merkliste: die juengsten gemerkten Titel; merken bzw. entfernen (Seite eines Seerr-Titels). */
      seerrWatchlist: () => seerrRead((s) => s.watchlist()),
      seerrSetWatchlist: ({ on, mediaType, tmdbId, title } = {}) => seerrCall(() => requireSeerr().setWatchlisted(on === true, { mediaType, tmdbId: Number(tmdbId), title })),
      /**
       * Aendert eine Anfrage (approve, decline, retry, withdraw, remove) mit der Sitzung des Benutzers; Seerr entscheidet. Seerr lehnt eine
       * Aktion ohne Recht auch mit 401 ab (am echten Seerr 3.5.1 gemessen): das ist keine abgelaufene Anmeldung, daher Code SEERR_DENIED (die
       * Oberflaeche prueft dann still, ob die Sitzung noch gilt); 404 heisst, die Anfrage gibt es nicht mehr (SEERR_GONE).
       */
      async seerrRequestAction({ id, action } = {}) {
        const s = requireSeerr();
        notices.willChange(Number(id)); // was der Nutzer selbst ausloest, meldet die App ihm nicht
        await requestManage(() => s.requestAction(Number(id), String(action ?? '')));
        syncNotices({ force: true }).catch(() => {}); // nach einer eigenen Aktion sofort: ihr neuer Stand wird gemerkt
        return true;
      },
      /**
       * Anfragen verwalten (Apple-App Build 94/95): Staffeln oder Ziel einer ausstehenden Anfrage aendern (body: ganzer Stand, JCSeerrRequests.editBody),
       * einen Titel als verfuegbar markieren. Fehler wie bei seerrRequestAction (SEERR_DENIED, SEERR_GONE; 409: nicht mehr ausstehend).
       */
      async seerrRequestUpdate({ id, body } = {}) {
        notices.willChange(Number(id));
        await requestManage(() => requireSeerr().updateRequest(Number(id), body));
        syncNotices({ force: true }).catch(() => {});
        return true;
      },
      async seerrMarkAvailable({ id, seerrMediaId, is4k = false } = {}) {
        if (id) notices.willChange(Number(id));
        await requestManage(() => requireSeerr().markAvailable(Number(seerrMediaId), { is4k: is4k === true }));
        syncNotices({ force: true }).catch(() => {});
        return true;
      },
      // Gemeldete Probleme (Apple-App Build 94): lesen, antworten, Stand aendern, loeschen; Fehler wie bei den Anfragen
      seerrIssues: ({ open = true } = {}) => seerrRead((s) => s.issues({ open: open !== false, take: 50 })),
      seerrIssueGet: (id) => seerrRead((s) => s.issue(Number(id))), // (seerrIssue ist das Melden, weiter unten)
      seerrIssueComment: ({ id, message } = {}) => requestManage(() => requireSeerr().commentIssue(Number(id), message), { issue: true }).then(() => true),
      seerrIssueResolve: ({ id, resolved } = {}) => requestManage(() => requireSeerr().setIssueResolved(Number(id), resolved === true), { issue: true }).then(() => true),
      seerrIssueDelete: (id) => requestManage(() => requireSeerr().deleteIssue(Number(id)), { issue: true }).then(() => true),
      seerrServices: (movie) => seerrRead((s) => s.services(movie === true)),
      seerrServiceChoices: ({ movie, serverId } = {}) => seerrRead((s) => s.serviceChoices(movie === true, Number(serverId))),
      seerrRequesters: () => seerrRead((s) => s.requesters()),

      // ---------- Mitteilungen (Plan P17) ----------
      /** Liste, Einstellungen und Zahl des aktiven Profils; manages: das Konto sieht alle Anfragen (nur dann gibt es "Neue Anfrage"). */
      notifications: noticesState,
      /** Abgleich auf Wunsch der Oberflaeche: force beim Oeffnen der Uebersicht, sonst mit Mindestabstand (Verbindung bestaetigt, Takt der offenen App). */
      async notificationsSync({ force = false } = {}) {
        await syncNotices({ force: force === true });
        return noticesState();
      },
      notificationRead({ id, read = true } = {}) {
        notices.markRead(String(id ?? ''), read !== false);
        return noticesState();
      },
      notificationsReadAll() {
        notices.markAllRead();
        return noticesState();
      },
      notificationRemove(id) {
        notices.remove(String(id ?? ''));
        return noticesState();
      },
      notificationsRemoveAll() {
        notices.removeAll();
        return noticesState();
      },
      /** Einstellungen der Mitteilungen (an/aus, je Art); nur bekannte Felder mit dem richtigen Typ. */
      notificationPrefs(p) {
        const next = {};
        if (typeof p?.enabled === 'boolean') next.enabled = p.enabled;
        if (typeof p?.system === 'boolean') next.system = p.system;
        if (p?.offered === true) config.markNoticesOffered?.();
        if (Array.isArray(p?.kinds)) next.kinds = p.kinds.filter((k) => Notifications.KINDS.includes(k));
        notices.setPreferences(next);
        return noticesState();
      },
      // ---------- Auf diesem Geraet fortsetzen (Plan P19) ----------
      /**
       * Sitzungen des eigenen Kontos (src/shared/handoff.js normalizeSession) und die eigenen Kennungen fuer die Regeln. Fremde Sitzungen, die der Server einem
       * Administrator nennt, verlassen die Rueckseite nie.
       */
      async handoffSessions() {
        const c = requireClient();
        const raw = await c.remoteSessions();
        const own = { ownDeviceId: c.deviceId, ownUserId: c.userId };
        const sessions = Handoff.ownAccount(Handoff.sessionsOf(raw), c.userId);
        if (client === c) handoffOwn = { client: c, ids: new Set(sessions.filter((s) => s.deviceId !== c.deviceId).map((s) => s.id)) };
        return { own, sessions };
      },
      /**
       * "Laeuft gerade" und die Angebote aus einer Abfrage (Regel 18): streams = was laeuft (src/shared/handoff.js streams; einem Administrator nennt der
       * Server alle Konten, nur zur Anzeige), sessions = die Sitzungen des eigenen Kontos (daraus die Angebote). Nur die Angebote darf die Fernbedienung
       * steuern (handoffPlaystate), Sitzungen anderer Konten nie.
       */
      async sessionsOverview() {
        const c = requireClient();
        const all = Handoff.sessionsOf(await c.sessionsOverview());
        const own = { ownDeviceId: c.deviceId, ownUserId: c.userId };
        const sessions = Handoff.ownAccount(all, c.userId);
        if (client === c) controlOwn = { client: c, ids: new Set(Handoff.offers(sessions, own).map((s) => s.id)) };
        return { own, sessions, streams: Handoff.streams(all, { ownDeviceId: c.deviceId }) };
      },
      /** Pause oder Abspielen auf einem anderen Geraet des eigenen Kontos (Fernbedienung, Regeln 13 bis 16): nur fuer ein Angebot der letzten Abfrage. */
      async handoffPlaystate({ sessionId, command } = {}) {
        const c = requireClient();
        const id = String(sessionId ?? '');
        if (command !== 'Pause' && command !== 'Unpause') throw new JellyfinError('Unbekannter Befehl', { status: 400 });
        if (controlOwn.client !== c || !controlOwn.ids.has(id)) throw new JellyfinError('Diese Sitzung lässt sich nicht steuern', { status: 403, code: 'HANDOFF_FOREIGN' });
        await c.sendPlaystate(id, command);
        return true;
      },
      /** Eintrag fuer die Uebernahme (gemerkte Stelle, abspielbar); timeout in ms, 1 bis 8000. */
      async handoffItem({ id, timeout } = {}) {
        if (typeof id !== 'string' || !/^[0-9a-fA-F-]{32,36}$/.test(id)) throw new JellyfinError('Ungültiger Eintrag', { status: 400 });
        const ms = Math.min(Handoff.TIMEOUT_MS, Math.max(1, Number(timeout) || Handoff.TIMEOUT_MS));
        return requireClient().handoffItem(id, ms);
      },
      /** Haelt die Wiedergabe einer Sitzung an, aber nur einer des eigenen Kontos auf einem anderen Geraet aus der letzten Abfrage. */
      async handoffStop(sessionId) {
        const c = requireClient();
        const id = String(sessionId ?? '');
        if (handoffOwn.client !== c || !handoffOwn.ids.has(id)) throw new JellyfinError('Diese Sitzung lässt sich nicht anhalten', { status: 403, code: 'HANDOFF_FOREIGN' });
        await c.stopRemotePlayback(id);
        return true;
      },

      /**
       * Eine Mitteilung des Systems wurde angetippt (raw: ihr Ziel, wie die Huelle es zurueckgibt). Gehoert sie zum aktiven Profil, gilt der Eintrag als gelesen
       * und das gepruefte Ziel kommt zurueck (die Oberflaeche oeffnet den Titel); sonst null: die App oeffnet sich nur, sie wechselt das Profil nicht von selbst.
       */
      systemNotificationTapped(raw) {
        const target = Notifications.targetOf(raw);
        if (!target || !notices.active || notices.profile !== config.data.activeServerId || !Notifications.belongs(target, config.data.activeServerId, hash)) return null;
        notices.markRead(target.id);
        return target;
      },
      // Problem zu einem Titel melden (Video, Ton, Untertitel, Sonstiges; Kommentar freiwillig). Die Werte werden hier einzeln gepruft und gekuerzt, nichts wird als Ganzes durchgereicht.
      seerrIssue: (req) =>
        seerrCall(() =>
          requireSeerr().reportIssue({
            mediaType: req?.mediaType,
            tmdbId: Number(req?.tmdbId),
            issueType: Number(req?.issueType),
            message: typeof req?.message === 'string' ? req.message.slice(0, 2000) : '',
            fallbackMessage: typeof req?.fallbackMessage === 'string' ? req.fallbackMessage.slice(0, 300) : '',
            season: Number(req?.season) || 0,
            episode: Number(req?.episode) || 0
          })
        )
    };
  }

  return { createBackend, LIMITS_TTL_MS, CHECK_TIMEOUT_MS, withDeadline, acceptsSeerrUser };
});
