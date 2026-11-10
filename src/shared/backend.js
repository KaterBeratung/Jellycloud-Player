/* Gemeinsames Modul: die "Rueckseite" der Oberflaeche, also alles, was hinter window.jc steckt und nicht an Electron haengt:
   Anmeldung (Passwort, Quick Connect), Jellyfin-Aufrufe, Seerr, Bitratengrenze des Servers, Einstellungen und der Zustand fuer die Oberflaeche.
   Der Hauptprozess (src/main/main.js) und die Web-/Handy-Fassung (src/web/jc-web.js) benutzen DASSELBE Modul, so verhalten sich beide gleich.
   Die Rueckgaben sind die Werte der IPC-Handler (ohne { ok, data }-Huelle); Fehler sind JellyfinError/SeerrError mit status und code.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCBackend). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jellyfin'), require('./seerr'));
  else root.JCBackend = factory(root.JCJellyfin, root.JCSeerr);
})(typeof self !== 'undefined' ? self : this, function (Jelly, Seerr) {
  'use strict';

  const { JellyfinClient, JellyfinError, probeServer, CALLABLE_METHODS } = Jelly;
  const { SeerrClient, SeerrError, probeSeerr, loginWithJellyfin } = Seerr;

  /** Bitratengrenze des Servers fuer diese Verbindung: kurz zwischengespeichert, beim Wechsel des Servers oder Kontos verworfen. */
  const LIMITS_TTL_MS = 60 * 1000;

  /**
   * @param {object} deps
   * @param {import('./config-core').ConfigCore} deps.config Konfiguration (Server, Einstellungen, Seerr)
   * @param {typeof fetch} deps.fetch Abruffunktion (Hauptprozess: net.fetch, Handy: native HTTP-Schicht, Browser: fetch)
   * @param {() => string} deps.appVersion Version der App (fuer die Anmeldung beim Server und den Zustand)
   * @param {() => string} deps.locale Sprache des Systems ("de-DE" ...)
   * @param {string} [deps.deviceName] Geraetename fuer den Server (sonst der Rechnername bzw. "Web")
   * @param {() => object} [deps.extraState] weitere Felder fuer den Zustand der Oberflaeche (mpv, Updates, Plattform ...)
   * @param {(patch: object, settings: object) => void} [deps.onSettings] nach jeder Aenderung der Einstellungen (Autostart, Discord ...)
   */
  function createBackend({ config, fetch, appVersion, locale, deviceName, extraState = () => ({}), onSettings = () => {} }) {
    /** @type {InstanceType<typeof JellyfinClient>|null} */
    let client = null;
    /** @type {InstanceType<typeof SeerrClient>|null} */
    let seerr = null;
    let limits = null;
    let limitsAt = 0;
    let limitsRun = null;
    const callable = new Set(CALLABLE_METHODS);

    const newClient = (o = {}) => new JellyfinClient({ deviceId: config.deviceId, clientVersion: appVersion(), ...(deviceName ? { deviceName } : {}), fetch, ...o });

    // ---------- Seerr ----------
    function buildSeerr() {
      const s = config.getSeerr();
      seerr = s ? new SeerrClient({ baseUrl: s.url, ...(s.mode === 'apikey' ? { apiKey: s.secret } : { cookie: s.secret }), fetch }) : null;
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

    /** Nach erfolgreicher Anmeldung: Konto merken, Faehigkeiten melden, Bitratengrenze holen. */
    function adopt(c, probed, auth) {
      config.saveServer({ url: probed.url, name: probed.name, userId: auth.userId, userName: auth.userName, token: auth.token });
      client = c;
      client.postCapabilities();
      resetLimits();
      refreshLimits().catch(() => {});
    }

    async function probe(url) {
      const r = await probeServer(url, fetch);
      return { url: r.url, name: r.info.ServerName, version: r.info.Version };
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
        adopt(c, probed, auth);
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
        adopt(c, { url, name }, auth);
        return { done: true, state: publicState() };
      },

      async logout() {
        const id = config.data.activeServerId;
        await client?.logout();
        if (id) config.removeServer(id);
        client = null;
        resetLimits();
        if (config.data.activeServerId) activateServer(config.data.activeServerId);
        return publicState();
      },

      switchServer(id) {
        if (!config.setActive(id)) throw new Error('Unbekannter Server');
        if (!activateServer(id)) throw new Error('Anmeldung abgelaufen, bitte erneut anmelden');
        return publicState();
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
      seerrConnect: ({ url, mode, username, password, apiKey }) =>
        seerrCall(async () => {
          const probed = await probeSeerr(url, fetch);
          let secret;
          let userName;
          if (mode === 'apikey') {
            const key = String(apiKey ?? '').trim();
            if (!key) throw new SeerrError('API-Schluessel fehlt');
            const me = await new SeerrClient({ baseUrl: probed.url, apiKey: key, fetch }).me().catch((e) => {
              throw e.status === 401 || e.status === 403 ? new SeerrError('Der API-Schluessel wurde abgelehnt', { status: 403 }) : e;
            });
            secret = key;
            userName = me?.displayName ?? me?.username ?? 'API';
          } else {
            const r = await loginWithJellyfin(probed.url, String(username ?? ''), String(password ?? ''), fetch);
            secret = r.cookie;
            userName = r.user?.displayName ?? r.user?.jellyfinUsername ?? String(username ?? '');
          }
          config.saveSeerr({ url: probed.url, mode: mode === 'apikey' ? 'apikey' : 'jellyfin', userName, secret });
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

  return { createBackend, LIMITS_TTL_MS };
});
