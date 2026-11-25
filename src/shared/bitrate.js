/* Gemeinsames Modul: Bitratensteuerung wie in der Apple-App (Plan P21; dort PlaybackPlanner.bitrateCeiling, HomeNetwork, Bandwidth und
   Notizen/bitratensteuerung.md). Reine Regeln und kleine Zwischenspeicher ohne eigenes Netz: die Anfragen stellt der JellyfinClient
   (src/shared/jellyfin.js), den Zustand haelt die Rueckseite (src/shared/backend.js), angewandt wird es beim Planen der Wiedergabe unter Windows
   (src/main/player.js) und unter Android (mobile/host-capacitor.js).
   Grundsatz (Auftrag an die Apple-App, gemessen an Jellyfin 12.4): im Heimnetz keine eigene Grenze der App; ueber das Internet hat die Grenze des
   Servers immer Vorrang, gleich was in der App gewaehlt ist.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCBitrate). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCBitrate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MBIT = 1_000_000;
  /**
   * "Keine Grenze" ist eine Zahl: ohne Angabe nimmt Jellyfin die Grenze seines Standard-Geraeteprofils (8 Mbit/s, DeviceProfile.MaxStreamingBitrate)
   * und kodiert alles darueber neu. Mindestens 400 Mbit/s, bei schnelleren Dateien das Doppelte ihrer Datenrate (Jellyfin nennt den Mittelwert).
   */
  const UNLIMITED_FLOOR = 400 * MBIT;
  /** Hoechstens die Haelfte des groessten 32-Bit-Werts: der Server rechnet mit der Zahl weiter. */
  const SERVER_MAX = Math.floor(2147483647 / 2);
  /** "Automatisch" ueber das Internet: 75 % der gemessenen Bandbreite (HLS braucht Luft, die Leitung schwankt), mindestens 1, hoechstens 120 Mbit/s. */
  const AUTO_SHARE = 0.75;
  const AUTO_MAX_MBPS = 120;
  /** Ergebnis der Heimnetz-Pruefung: zehn Minuten oder bis sich das Netz des Geraets aendert. */
  const HOME_TTL_MS = 10 * 60 * 1000;
  /** Gemessene Bandbreite: 30 Minuten. */
  const BANDWIDTH_TTL_MS = 30 * 60 * 1000;
  /** Beim Start der Wiedergabe wartet die Planung hoechstens so lange auf die Messung (sie laeuft danach weiter). */
  const QUICK_WAIT_MS = 4000;

  /** Stufen der Einstellung "Bitratengrenze" in Mbit/s (wie die Apple-App, Einstellungen > Player > Qualitaet); 0 = Automatisch. */
  const SETTING_STEPS = [0, 40, 20, 10, 5, 2];
  /** Stufen im Qualitaetsmenue des Players (wie PlayerModel.qualityChoices der Apple-App); die Namen uebersetzt der Player. */
  const PLAYER_STEPS = [
    { mbps: 40, name: '4k' },
    { mbps: 20, name: '1080high' },
    { mbps: 8, name: '1080' },
    { mbps: 4, name: '720' },
    { mbps: 2, name: '480' }
  ];

  const positive = (n) => (n !== null && n !== '' && Number.isFinite(+n) && +n > 0 ? +n : 0);
  const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

  /** "Keine Grenze" als Zahl fuer den Server (bit/s); nie unter der Datenrate der Datei. */
  function unlimitedBitrate(sourceBps) {
    return Math.max(UNLIMITED_FLOOR, Math.min(Math.round(positive(sourceBps)) * 2, SERVER_MAX));
  }

  /**
   * Die Obergrenze, die eine Anfrage nennt (bit/s). Vorrang, von oben nach unten:
   * 1. die Grenze des Servers fuer Wiedergabe ueber das Internet (serverLimit; null im Heimnetz und ohne Grenze): nie mehr;
   * 2. die Wahl in der App (chosenMbps): eine feste Stufe oder die aus der Messung abgeleitete; darunter gilt sie, wie sie ist;
   * 3. sonst (0) keine Grenze: unlimitedBitrate.
   */
  function bitrateCeiling({ chosenMbps = 0, serverLimit = null, sourceBitrate = null } = {}) {
    const chosen = positive(chosenMbps);
    const wanted = chosen > 0 ? Math.round(chosen * MBIT) : unlimitedBitrate(sourceBitrate);
    const limit = Math.round(positive(serverLimit));
    return limit > 0 ? Math.min(wanted, limit) : wanted;
  }

  /** Aus der gemessenen Bandbreite (Mbit/s) die Stufe fuer "Automatisch". */
  function autoBitrateMbps(measured) {
    return Math.max(1, Math.min(AUTO_MAX_MBPS, Math.floor(measured * AUTO_SHARE)));
  }

  /** Die Wahl, wie sie gilt: eine feste Stufe bleibt; bei "Automatisch" (0) mit einer Messung die daraus abgeleitete. { mbps, autoMbps } */
  function effectiveQuality(quality, measured) {
    const q = positive(quality);
    if (q > 0 || !isNumber(measured) || measured < 0) return { mbps: q, autoMbps: null };
    const auto = autoBitrateMbps(measured);
    return { mbps: auto, autoMbps: auto };
  }

  /** Hostname einer Adresse, klein, ohne eckige Klammern bei IPv6; '' bei einer ungueltigen Adresse. */
  function hostOf(baseUrl) {
    try {
      return new URL(String(baseUrl)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    } catch {
      return '';
    }
  }

  const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  /** Ist der Text eine IP-Adresse (v4 oder v6)? Dann gibt es nichts aufzuloesen. */
  const isIpLiteral = (host) => IPV4.test(host) || host.includes(':');

  /**
   * Ist das eine Adresse im Heimnetz: privat (10/8, 172.16/12, 192.168/16), link-lokal (169.254/16, fe80::/10), eigener Rechner (127/8, ::1) oder
   * privat nach IPv6 (fc00::/7), auch als IPv4 in IPv6 ("::ffff:192.168.1.2"). Eine Zone ("fe80::1%eth0") zaehlt nicht mit.
   */
  function ipIsPrivate(address) {
    let ip = String(address ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
    if (mapped) ip = mapped[1];
    const v4 = IPV4.exec(ip);
    if (v4) {
      const a = +v4[1];
      const b = +v4[2];
      return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31);
    }
    if (!ip.includes(':')) return false;
    return ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd');
  }

  /** Zeigt schon der Name der eingetragenen Adresse aufs Heimnetz (private IP, ".local", einfacher Rechnername)? Ohne Netzwerkzugriff. */
  function addressLooksLocal(baseUrl) {
    const host = hostOf(baseUrl);
    if (!host) return false;
    if (host === 'localhost' || /\.(local|lan|home\.arpa|internal)$/.test(host)) return true;
    if (!host.includes('.') && !host.includes(':')) return true; // "nas", "jellyfin"
    // Nur Adressen selbst: ein Name wie "fdserver.example.com" ist kein Heimnetz
    return isIpLiteral(host) && ipIsPrivate(host);
  }

  /**
   * Zeigt der Name der eingetragenen Adresse laut DNS ins Heimnetz? Fuer Namen, die nicht schon dem Namen nach lokal sind: eigene Endungen fuer das
   * Heimnetz (".int", ".home", ".fritz.box") oder eine eigene Domain, die der Router oder ein DNS im Heimnetz auf eine private Adresse aufloest (Split-DNS).
   * Von unterwegs loest derselbe Name oeffentlich oder gar nicht auf. resolve(host) -> Promise<string[]> (die Adressen des Namens); hoechstens
   * timeoutMs warten. false ohne Aufloesung, bei einem Fehler oder einer Adresse, die schon dem Namen nach entschieden ist.
   */
  async function hostResolvesLocal(baseUrl, resolve, { timeoutMs = 2000 } = {}) {
    const host = hostOf(baseUrl);
    if (typeof resolve !== 'function' || !host || isIpLiteral(host) || addressLooksLocal(baseUrl)) return false;
    let timer = null;
    try {
      const list = await Promise.race([
        Promise.resolve().then(() => resolve(host)),
        new Promise((r) => (timer = setTimeout(() => r(null), timeoutMs)))
      ]);
      return Array.isArray(list) && list.some(ipIsPrivate);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Gilt die Verbindung als Heimnetz (dort ohne Grenze)? Wie HomeNetwork.isHome der Apple-App:
   * - serverInNetwork: Einstufung des Servers (/System/Endpoint, IsInNetwork); null, wenn er sie nicht nennt.
   * - addressLooksLocal: die eingetragene Adresse ist dem Namen nach privat, oder ihr Name loest im DNS auf eine private Adresse auf (hostResolvesLocal).
   * - viaLocalInterface: die Verbindung laeuft ueber das Netz vor Ort; false ueber Mobilfunk, null unbekannt (Windows kann die Schnittstelle einer
   *   Verbindung nicht ohne Weiteres bestimmen, ein VPN ins Heimnetz zaehlt dort darum als Heimnetz).
   * - homeAddressAnswers: unter der Heimadresse, die der Server nennt, antwortet derselbe Server.
   * Sagt der Server "nicht im Heimnetz", gilt das immer. Sonst braucht es einen eigenen Beleg: hinter einem Reverse Proxy haelt der Server jede
   * Verbindung fuer lokal, darum reicht seine Einstufung bei einer oeffentlichen Adresse nicht.
   */
  function isHome({ serverInNetwork = null, addressLooksLocal: looksLocal = false, viaLocalInterface = null, homeAddressAnswers = false } = {}) {
    if (serverInNetwork === false) return false;
    if (looksLocal) return viaLocalInterface ?? true;
    return homeAddressAnswers === true;
  }

  /**
   * Die Grenze des Servers fuer Wiedergabe ueber das Internet, wie Jellyfin sie anwendet (MediaInfoHelper.GetMaxBitrate): die des Kontos, ohne sie
   * die des Servers. me/config null: die Abfrage ist gescheitert. Ergebnis: bit/s, null = keine Grenze, undefined = nicht lesbar (das ist nicht
   * "keine Grenze"; dann gilt die zuletzt bekannte, resolveLimit).
   */
  function readServerLimit({ me = null, config = null } = {}) {
    if (!me) return undefined;
    const user = Math.round(positive(me.Policy?.RemoteClientBitrateLimit));
    if (user > 0) return user;
    if (!config) return undefined;
    const server = Math.round(positive(config.RemoteClientBitrateLimit));
    return server > 0 ? server : null;
  }

  /** Die Grenze, die gilt: die eben gelesene (null: der Server hat keine), sonst die zuletzt bekannte. Eine Grenze wird nie erfunden. */
  function resolveLimit(read, lastKnown) {
    return read !== undefined ? read : lastKnown ?? null;
  }

  /**
   * Ergebnis der Pruefung fuer Einstellungen und Planung: home, remote (= nicht Heimnetz), serverView (Einstufung des Servers, null: nicht genannt),
   * settled (das Ergebnis steht fest und darf gemerkt werden), user/server (gelesene Grenzen in bit/s, 0 = keine oder nicht gelesen),
   * serverKnown (Server-Einstellung lesbar), limitRead (readServerLimit) und limitBps (die geltende Grenze des Servers, 0 = keine; im Heimnetz 0).
   */
  function summarizeLimits({ home, serverView = null, settled = true, me = null, config = null }) {
    if (home) return { home: true, remote: false, serverView, settled, user: 0, server: 0, serverKnown: false, limitRead: null, limitBps: 0 };
    const limitRead = readServerLimit({ me, config });
    return {
      home: false,
      remote: true,
      serverView,
      settled,
      user: Math.round(positive(me?.Policy?.RemoteClientBitrateLimit)),
      server: Math.round(positive(config?.RemoteClientBitrateLimit)),
      serverKnown: config != null,
      limitRead,
      limitBps: limitRead ?? 0
    };
  }

  /** Die Grenze des Servers als Stufe in ganzen Mbit/s (aufgerundet: angefragt wird trotzdem nie mehr als die Grenze selbst); null ohne Grenze. */
  function serverLimitMbps(limit) {
    const l = positive(limit);
    return l > 0 ? Math.max(1, Math.ceil(l / MBIT)) : null;
  }

  /** Braucht die Planung eine Messung der Bandbreite? Nur bei "Automatisch" ausserhalb des Heimnetzes und wenn die App selbst begrenzen darf. */
  function needsMeasurement({ quality = 0, allowTranscode = true, network = null } = {}) {
    return positive(quality) === 0 && allowTranscode !== false && !!network && network.home === false;
  }

  /**
   * Die Obergrenze einer Anfrage aus Wahl, Netz und Messung: { ceiling, chosenMbps, autoMbps, serverLimit }.
   * - quality: Wahl in Mbit/s, 0 = Automatisch; allowTranscode false: die App setzt keine eigene Grenze (sie verbietet ja das Umsetzen), die des
   *   Servers gilt trotzdem.
   * - network: Ergebnis der Pruefung (summarizeLimits, von der Rueckseite um die zuletzt bekannte Grenze ergaenzt); null: unbekannt, keine eigene Grenze.
   * - autoMbps: was "Automatisch" gerade bedeutet (fuer das Menue), nie ueber der Grenze des Servers; null im Heimnetz und ohne Messung.
   */
  function planBitrate({ quality = 0, allowTranscode = true, network = null, measured = null, sourceBitrate = null } = {}) {
    const remote = !!network && network.home === false;
    const serverLimit = remote && positive(network.limitBps) > 0 ? Math.round(network.limitBps) : null;
    const own = allowTranscode === false ? 0 : positive(quality);
    const chosen = effectiveQuality(own, needsMeasurement({ quality: own, allowTranscode, network }) ? measured : null);
    const ceiling = bitrateCeiling({ chosenMbps: chosen.mbps, serverLimit, sourceBitrate });
    let autoMbps = chosen.autoMbps;
    if (own === 0 && serverLimit) autoMbps = Math.min(autoMbps ?? Infinity, Math.max(1, Math.floor(serverLimit / MBIT)));
    return { ceiling, chosenMbps: chosen.mbps, autoMbps, serverLimit };
  }

  /**
   * Auswahl im Qualitaetsmenue des Players: [{ mbps, name, detailMbps }], name 'auto' | '4k' | '1080high' | '1080' | '720' | '480' | 'server' | 'setting'.
   * Hat der Server eine Grenze, endet die Liste dort, die Grenze selbst ist die hoechste Stufe; eine Einstellung ausserhalb der Liste kommt dazu.
   */
  function qualityChoices({ qualityMbps = 0, autoMbps = null, serverLimit = null } = {}) {
    const out = [{ mbps: 0, name: 'auto', detailMbps: autoMbps ?? null }, ...PLAYER_STEPS.map((s) => ({ mbps: s.mbps, name: s.name, detailMbps: s.mbps }))];
    const cap = serverLimitMbps(serverLimit);
    if (cap) {
      for (let i = out.length - 1; i >= 0; i--) if (out[i].mbps > cap) out.splice(i, 1);
      if (!out.some((c) => c.mbps === cap)) out.splice(1, 0, { mbps: cap, name: 'server', detailMbps: Math.round(positive(serverLimit) / (MBIT / 10)) / 10 });
    }
    const q = positive(qualityMbps);
    if (!out.some((c) => c.mbps === q)) out.splice(1, 0, { mbps: q, name: 'setting', detailMbps: q });
    return out;
  }

  /** Stufen der Einstellung; ein frueher gewaehlter Wert ausserhalb der Liste (80, 12, 8 ...) bleibt waehlbar, absteigend einsortiert. */
  function settingChoices(saved) {
    const list = SETTING_STEPS.slice();
    const s = positive(saved);
    if (s > 0 && !list.includes(s)) {
      list.push(s);
      list.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a));
    }
    return list;
  }

  /**
   * So viele Kanaele darf der Server beim Umwandeln des Tons liefern (Android; wie PlaybackPlanner.outputChannelLimit der Apple-App): 8, wenn die
   * Tonausgabe mindestens acht meldet, sonst 6, nie weniger (Kopfhoerer mit raeumlichem Ton melden 2 und brauchen trotzdem die Mehrkanalspur).
   */
  function outputChannelLimit(outputChannels) {
    return positive(outputChannels) >= 8 ? 8 : 6;
  }

  /**
   * Kanaele fuer die Wahl der Tonspur (media.js pickStreams; 2 bevorzugt eine Stereo-Spur derselben Sprache). "Mehrkanalton behalten" behaelt die
   * Mehrkanalspur immer; ohne die Einstellung nur an einer Ausgabe mit mindestens sechs Kanaelen (HDMI an einem Receiver). Die Apple-App waehlt ohne
   * die Einstellung immer die Stereo-Spur, auch an einer Mehrkanal-Ausgabe (dort als Mangel W6 vermerkt); hier zaehlt die Ausgabe mit.
   */
  function trackChannels({ keepSurround = false, outputChannels = 2 } = {}) {
    const out = positive(outputChannels);
    return keepSurround === true || out >= 6 ? Math.max(6, out) : 2;
  }

  /** Wartet hoechstens ms auf promise (dann null); die Arbeit selbst laeuft weiter. */
  function within(promise, ms) {
    let timer = null;
    return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(() => resolve(null), ms)))]).finally(() => clearTimeout(timer));
  }

  /**
   * Misst die Bandbreite zum Server wie die Apple-App: erst 1 MB; liegt das Ergebnis zwischen 6 und 60 Mbit/s, misst danach ein zweiter Test mit 3 MB
   * genauer (im Hintergrund, gewichtet 1:2). Das Ergebnis gilt 30 Minuten; fragen mehrere Stellen zugleich, teilen sie eine Messung.
   * test(bytes, timeoutMs) -> Promise<Mbit/s | null>. measure({ quick }): quick (Start der Wiedergabe) wartet hoechstens 4 s.
   */
  function createBandwidthMeter({ test, now = () => Date.now(), quickMs = QUICK_WAIT_MS } = {}) {
    let value = null;
    let at = 0;
    let running = null;
    let epoch = 0;
    const fresh = () => (value !== null && now() - at < BANDWIDTH_TTL_MS ? value : null);
    const store = (mine, v) => {
      if (mine !== epoch || !isNumber(v)) return;
      value = v;
      at = now();
    };
    function start(quick) {
      const mine = epoch;
      const run = Promise.resolve()
        .then(() => test(1_000_000, quick ? quickMs : 12000))
        .then((first) => {
          if (!isNumber(first) || first <= 0) return null;
          store(mine, first);
          if (first >= 6 && first < 60) {
            Promise.resolve()
              .then(() => test(3_000_000, 12000))
              .then((second) => isNumber(second) && second > 0 && store(mine, (first + second * 2) / 3))
              .catch(() => {});
          }
          return first;
        })
        .catch(() => null);
      running = run;
      run.then(() => {
        if (running === run) running = null;
      });
      return run;
    }
    async function measure({ quick = false } = {}) {
      const hit = fresh();
      if (hit !== null) return hit;
      const run = running ?? start(quick);
      const first = quick ? await within(run, quickMs) : await run;
      if (first === null) return null;
      return fresh() ?? first;
    }
    return {
      measure,
      /** Neuer Server oder neues Konto: nichts Gemerktes und keine laufende Messung zaehlt mehr. */
      reset() {
        epoch++;
        value = null;
        at = 0;
        running = null;
      },
      get value() {
        return fresh();
      }
    };
  }

  /**
   * Merkt sich das Ergebnis einer Pruefung (hier: antwortet die Heimadresse des Servers?) je Netz fuer zehn Minuten; gleichzeitige Fragen teilen eine
   * Pruefung. Wechselt das Netz des Geraets (signature), gilt nichts Gemerktes mehr. run() -> Promise<Wert>.
   */
  function createNetworkMemo({ now = () => Date.now(), ttlMs = HOME_TTL_MS } = {}) {
    let entry = null;
    let running = null;
    return {
      get(signature, run) {
        const sig = String(signature ?? '');
        if (entry && entry.sig === sig && now() - entry.at < ttlMs) return Promise.resolve(entry.value);
        if (running && running.sig === sig) return running.p;
        const p = Promise.resolve()
          .then(run)
          .then(
            (value) => {
              if (running?.p === p) {
                entry = { sig, value, at: now() };
                running = null;
              }
              return value;
            },
            (e) => {
              if (running?.p === p) running = null;
              throw e;
            }
          );
        running = { sig, p };
        return p;
      },
      reset() {
        entry = null;
        running = null;
      }
    };
  }

  return {
    MBIT,
    UNLIMITED_FLOOR,
    SERVER_MAX,
    AUTO_MAX_MBPS,
    HOME_TTL_MS,
    BANDWIDTH_TTL_MS,
    QUICK_WAIT_MS,
    SETTING_STEPS,
    PLAYER_STEPS,
    unlimitedBitrate,
    bitrateCeiling,
    autoBitrateMbps,
    effectiveQuality,
    ipIsPrivate,
    addressLooksLocal,
    hostResolvesLocal,
    isHome,
    readServerLimit,
    resolveLimit,
    summarizeLimits,
    serverLimitMbps,
    needsMeasurement,
    planBitrate,
    qualityChoices,
    settingChoices,
    outputChannelLimit,
    trackChannels,
    createBandwidthMeter,
    createNetworkMemo
  };
});
