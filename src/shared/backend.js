/* Gemeinsames Modul: die "Rueckseite" der Oberflaeche, also alles, was hinter window.jc steckt und nicht an Electron haengt:
   Anmeldung (Passwort, Quick Connect), Jellyfin-Aufrufe, Seerr, Bitratengrenze des Servers, Einstellungen und der Zustand fuer die Oberflaeche.
   Der Hauptprozess (src/main/main.js) und die Web-/Handy-Fassung (src/web/jc-web.js) benutzen DASSELBE Modul, so verhalten sich beide gleich.
   Die Rueckgaben sind die Werte der IPC-Handler (ohne { ok, data }-Huelle); Fehler sind JellyfinError/SeerrError mit status und code.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCBackend). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jellyfin'), require('./seerr'), require('./quick-connect'));
  else root.JCBackend = factory(root.JCJellyfin, root.JCSeerr, root.JCQuickConnect);
})(typeof self !== 'undefined' ? self : this, function (Jelly, Seerr, QuickConnect) {
  'use strict';

  const { JellyfinClient, JellyfinError, probeServer, CALLABLE_METHODS } = Jelly;
  const { SeerrClient, SeerrError, probeSeerr, loginWithJellyfin } = Seerr;

  /** Bitratengrenze des Servers fuer diese Verbindung: kurz zwischengespeichert, beim Wechsel des Servers oder Kontos verworfen. */
  const LIMITS_TTL_MS = 60 * 1000;
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
   * @param {object} deps
   * @param {import('./config-core').ConfigCore} deps.config Konfiguration (Server, Einstellungen, Seerr)
   * @param {typeof fetch} deps.fetch Abruffunktion (Hauptprozess: net.fetch, Handy: native HTTP-Schicht, Browser: fetch)
   * @param {() => string} deps.appVersion Version der App (fuer die Anmeldung beim Server und den Zustand)
   * @param {() => string} deps.locale Sprache des Systems ("de-DE" ...)
   * @param {string} [deps.deviceName] Geraetename fuer den Server (sonst der Rechnername bzw. "Web")
   * @param {() => object} [deps.extraState] weitere Felder fuer den Zustand der Oberflaeche (mpv, Updates, Plattform ...)
   * @param {(patch: object, settings: object) => void} [deps.onSettings] nach jeder Aenderung der Einstellungen (Autostart, Discord ...)
   * @param {number} [deps.checkTimeoutMs] Frist der Verbindungspruefung je Dienst (nur in Tests kuerzer)
   */
  function createBackend({ config, fetch, appVersion, locale, deviceName, extraState = () => ({}), onSettings = () => {}, checkTimeoutMs = CHECK_TIMEOUT_MS }) {
    /** @type {InstanceType<typeof JellyfinClient>|null} */
    let client = null;
    /** @type {InstanceType<typeof SeerrClient>|null} */
    let seerr = null;
    let limits = null;
    let limitsAt = 0;
    let limitsRun = null;
    let check = null; // laufende Verbindungspruefung { client, run }: ein zweiter Anlass waehrenddessen bekommt dieselbe (keine Doppelanfragen)
    const callable = new Set(CALLABLE_METHODS);

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
    /** Seerr des aktiven Profils (seit Version 10 je Profil, nur mit der Sitzung des Jellyfin-Kontos). */
    function buildSeerr() {
      const s = config.getSeerr();
      seerr = s ? new SeerrClient({ baseUrl: s.url, cookie: s.secret, fetch }) : null;
      return !!seerr;
    }

    function requireSeerr() {
      if (!seerr) throw new SeerrError('Seerr ist nicht verbunden');
      return seerr;
    }

    /**
     * Ein 401 von Seerr (Sitzung abgelaufen) darf nicht wie ein abgelaufenes Jellyfin-Konto aussehen, die Oberflaeche wuerde sonst zur Jellyfin-Anmeldung wechseln.
     * Es kommt als Code SEERR_AUTH an.
     */
    async function seerrCall(fn) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof SeerrError && e.status === 401) throw Object.assign(new SeerrError(e.message), { status: 0, code: 'SEERR_AUTH' });
        throw e;
      }
    }

    // ---------- Bitratengrenze ----------
    function refreshLimits(force = false) {
      if (!client) return Promise.resolve(null);
      if (limitsRun) return limitsRun;
      if (!force && limits && Date.now() - limitsAt < LIMITS_TTL_MS) return Promise.resolve(limits);
      const mine = client;
      limitsRun = mine
        .getStreamingLimits()
        .then((l) => {
          if (client === mine) {
            limits = l;
            limitsAt = Date.now();
          }
          return l;
        })
        .catch(() => limits)
        .finally(() => {
          limitsRun = null;
        });
      return limitsRun;
    }

    function resetLimits() {
      limits = null;
      limitsAt = 0;
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

    /** Meldet das aktive Profil ab (auch am Server) und entfernt nur dieses Profil samt seiner Seerr-Sitzung; das naechste gemerkte wird aktiv. */
    async function logout() {
      const id = config.data.activeServerId;
      await client?.logout();
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

    /** Seerr des aktiven Profils: /status (erreichbar?) und /auth/me (Sitzung gueltig?) unter EINER Frist. */
    async function checkSeerr(s) {
      if (!s) return { state: 'none' };
      try {
        await withDeadline(checkTimeoutMs, async (signal) => {
          await s.request('GET', '/status', { signal, timeout: checkTimeoutMs });
          await s.request('GET', '/auth/me', { signal, timeout: checkTimeoutMs });
        });
        return { state: 'connected' };
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
      get limits() {
        return limits;
      },
      buildSeerr,
      activateServer,
      refreshLimits,
      resetLimits,
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
        if (server.token) await newClient({ baseUrl: server.url, token: server.token, userId: server.userId }).logout();
        config.removeServer(id);
        return publicState();
      },

      // ---------- Verbindungspruefung (Start, Profilwechsel, Rueckkehr in die App) ----------
      /**
       * Prueft Jellyfin und Seerr des aktiven Profils nebeneinander, je Dienst mit EINER Frist (30 s) und ohne Wiederholung. Bei Netzfehlern wird nichts
       * geloescht; eine abgelehnte Anmeldung meldet "unauthorized" (die Oberflaeche zeigt dann die Anmeldung, wie bei jedem 401).
       * Laeuft fuer dasselbe Profil schon eine Pruefung, kommt deren Ergebnis (keine Doppelanfragen).
       */
      checkConnection() {
        const id = config.data.activeServerId;
        if (!client || !id) return Promise.resolve({ profileId: id, jellyfin: { state: 'none' }, seerr: { state: 'none' } });
        if (check?.client === client) return check.run;
        const mine = { client };
        mine.run = Promise.all([checkJellyfin(client), checkSeerr(seerr)])
          .then(([jellyfin, seerrState]) => ({ profileId: id, jellyfin, seerr: seerrState }))
          .finally(() => {
            if (check === mine) check = null;
          });
        check = mine;
        return mine.run;
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
      /** Seerr fuer das aktive Profil anmelden: nur mit dem Jellyfin-Konto (kein API-Schluessel, Entscheidung E12); gespeichert wird nur die Sitzung. */
      seerrConnect: ({ url, username, password }) =>
        seerrCall(async () => {
          const owner = config.data.activeServerId;
          if (!owner) throw new SeerrError('Zuerst bei Jellyfin anmelden');
          const probed = await probeSeerr(url, fetch);
          const r = await loginWithJellyfin(probed.url, String(username ?? ''), String(password ?? ''), fetch);
          // Wurde waehrend der Anmeldung das Profil gewechselt, gehoert die Sitzung keinem: sonst landete sie beim falschen Profil
          if (config.data.activeServerId !== owner) throw new SeerrError('Das Profil wurde inzwischen gewechselt. Bitte noch einmal verbinden.');
          const userName = r.user?.displayName ?? r.user?.jellyfinUsername ?? String(username ?? '');
          const jellyfinUserId = typeof r.user?.jellyfinUserId === 'string' ? r.user.jellyfinUserId : '';
          config.saveSeerr({ url: probed.url, userName, jellyfinUserId, secret: r.cookie });
          buildSeerr();
          return publicState();
        }),
      seerrDisconnect: () =>
        seerrCall(() => {
          config.clearSeerr();
          seerr = null;
          return publicState();
        }),
      seerrSearch: (query, page) => seerrCall(() => requireSeerr().search(String(query ?? '').slice(0, 200), Number(page) || 1)),
      seerrTrending: () => seerrCall(() => requireSeerr().trending()),
      seerrDetails: (req) => seerrCall(() => requireSeerr().details(req?.mediaType, req?.mediaId)),
      seerrRequest: (req) => seerrCall(() => requireSeerr().requestMedia({ mediaType: req?.mediaType, mediaId: req?.mediaId })),
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

  return { createBackend, LIMITS_TTL_MS, CHECK_TIMEOUT_MS, withDeadline };
});
