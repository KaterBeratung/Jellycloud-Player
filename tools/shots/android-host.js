// Huelle der Android-App (mobile/host-capacitor.js) ohne Handy: Die Oberflaeche laeuft ohne Electron-Vorlade-Datei, ein Ersatz fuer Capacitor (window.Capacitor mit den Plugins
// CapacitorHttp und JellycloudPlayer) wird vor allen Seitenskripten eingeschleust (Debug-Protokoll, Page.addScriptToEvaluateOnNewDocument). Der Ersatz fuer CapacitorHttp ruft den Mock-Server auf,
// der Ersatz-Player merkt sich, was die Huelle ihm uebergibt, und antwortet mit vorgegebenen Ergebnissen.
// Geprueft: Huelle meldet sich (Plattform, Version, Geraetename), Anmeldung ueber die "native" HTTP-Schicht, Wiedergabe-Plan (Direct Play, Token nur im Header, Startstelle, Dauer, Titel,
// Geraeteprofil mit konservativem Ton), Rueckfall auf Transcode bei Decoder-Fehler ab der erreichten Stelle, Fehlermeldung bei Serverfehler, Ereignisse, Links, Folgen-Titel, Neustart von vorn,
// Mitteilungen des Systems (P18: Erlaubnis, Zeigen, Zuruecknehmen, Antippen bei kaltem Start und bei laufender App; ohne Seerr, das hier keine Sitzung bekommt).
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { BrowserWindow } = require('electron');
const { server, items, state } = require('../mock-server');

module.exports = async (ctx) => {
  const root = path.join(__dirname, '..', '..');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(300);

  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const www = path.join(os.tmpdir(), `jc-android-www-${process.pid}`);
  require('../build-web').buildWeb(www, { host: path.join(root, 'mobile', 'host-capacitor.js') });
  check('Web-Bau mit Huellen-Datei: web/host.js liegt vor jc-web.js, Version eingesetzt', (() => {
    const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
    const host = fs.readFileSync(path.join(www, 'web', 'host.js'), 'utf8');
    return html.indexOf('web/host.js') > 0 && html.indexOf('web/host.js') < html.indexOf('web/jc-web.js') && host.includes(`version: '${version}'`) && !host.includes('__APP_VERSION__');
  })());

  // Nachbildung dessen, was die echte Android-Bruecke (native-bridge.js) in der Seite bereitstellt: isNativePlatform, getPlatform, nativePromise, PluginHeaders (von Java eingefuegt)
  // und androidBridge. Es gibt hier absichtlich KEIN registerPlugin: das liefert erst die JavaScript-Laufzeit von @capacitor/core, die die App nicht laedt (in 1.1.5 brach die Huelle daran ab).
  // Ersatz fuer den sicheren Speicher (SecureStorePlugin.java): die "native Datei" liegt in sessionStorage und ueberlebt so ein Neuladen der Seite.
  // Beim ersten Laden liegt eine Konfiguration wie bei 1.1.6 im localStorage (Uebernahme). __secureFail = 'load' | 'save' laesst das Plugin scheitern.
  const OLD_CONFIG = JSON.stringify({ version: 9, deviceId: 'seed-device-0001', servers: [], settings: {} });
  const FAKE = `(() => {
    window.__calls = { play: [], openExternal: [], secureSave: 0, notify: [], takeTap: 0 };
    // Mitteilungen des Systems (NotificationPlugin.java): Erlaubnis, gezeigte und zurueckgenommene, eine angetippte (auch schon beim Start: kalter Start durch Antippen)
    window.__notifyPerm = 'prompt';
    window.__notifyTap = sessionStorage.getItem('__notifyTapOnStart');
    sessionStorage.removeItem('__notifyTapOnStart');
    const secure = JSON.parse(sessionStorage.getItem('__secure') || '{}');
    window.__secureStore = secure;
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.setItem('jellycloud.config', ${JSON.stringify(OLD_CONFIG)});
      sessionStorage.setItem('__seeded', '1');
    }
    window.__playResults = [];
    window.androidBridge = { postMessage: () => {} };
    const http = async (o) => {
      const init = { method: o.method, headers: o.headers };
      if (o.data !== undefined) init.body = typeof o.data === 'string' ? o.data : JSON.stringify(o.data);
      const r = await fetch(o.url, init);
      const text = await r.text();
      let data = text;
      try { data = JSON.parse(text); } catch {}
      const headers = {};
      r.headers.forEach((v, k) => { headers[k] = v; });
      return { status: r.status, headers, data, url: o.url };
    };
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      PluginHeaders: [
        { name: 'CapacitorHttp', methods: [{ name: 'request', rtype: 'promise' }] },
        { name: 'JellycloudPlayer', methods: [{ name: 'play', rtype: 'promise' }, { name: 'openExternal', rtype: 'promise' }] },
        { name: 'JellycloudSecureStore', methods: [{ name: 'load', rtype: 'promise' }, { name: 'save', rtype: 'promise' }] },
        { name: 'JellycloudNotifications', methods: ['status', 'request', 'openSettings', 'show', 'withdraw', 'withdrawProfile', 'takeTap'].map((name) => ({ name, rtype: 'promise' })) }
      ],
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'CapacitorHttp' && method === 'request') return http(options);
        if (plugin === 'JellycloudPlayer' && method === 'play') {
          window.__calls.play.push(options);
          return window.__playResults.shift() ?? { positionMs: 0, durationMs: options.durationMs, ended: false, error: null, errorKind: null };
        }
        if (plugin === 'JellycloudSecureStore' && method === 'load') {
          if (window.__secureFail === 'load') throw { message: 'Keystore nicht verfuegbar' };
          return { value: secure[options.key] ?? null, unreadable: false };
        }
        if (plugin === 'JellycloudSecureStore' && method === 'save') {
          if (window.__secureFail === 'save') throw { message: 'Speicher voll' };
          await new Promise((r) => setTimeout(r, 20)); // wie die echte Bruecke: asynchron
          secure[options.key] = options.value;
          sessionStorage.setItem('__secure', JSON.stringify(secure));
          window.__calls.secureSave++;
          return {};
        }
        if (plugin === 'JellycloudPlayer' && method === 'openExternal') {
          window.__calls.openExternal.push(options);
          return {};
        }
        if (plugin === 'JellycloudNotifications') {
          const status = () => ({ supported: true, permission: window.__notifyPerm, settings: true });
          if (method === 'takeTap') {
            window.__calls.takeTap++;
            const target = window.__notifyTap ?? null;
            window.__notifyTap = null;
            return { target };
          }
          window.__calls.notify.push({ method, options });
          if (method === 'request' && window.__notifyPerm === 'prompt') window.__notifyPerm = 'granted';
          return method === 'status' || method === 'request' ? status() : {};
        }
        throw { message: plugin + '.' + method + ' is not implemented' };
      }
    };
  })();`;

  const errors = [];
  const win = new BrowserWindow({ width: 390, height: 844, show: false, backgroundColor: '#0a0b10', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  // Die Sicherheitswarnung von Electron betrifft die leere Startseite (about:blank, ohne Content-Security-Policy), nicht die App
  // Ausgenommen: die Sicherheitswarnung von Electron fuer about:blank, und die Warnung der Capacitor-Laufzeit, wenn der Test sie nachtraeglich laedt und die Huelle ein zweites Mal startet
  win.webContents.on('console-message', (e) => (e.level === 'error' || e.level === 'warning' || e.level >= 2) && !/Electron Security Warning|already registered/.test(e.message) && errors.push(`[${e.level}] ${e.message}`));
  // Das Debug-Protokoll antwortet erst, wenn die Seite einmal geladen wurde: erst eine leere Seite, dann den Ersatz fuer Capacitor einschleusen, dann die echte Seite
  await win.loadURL('about:blank');
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
  const ev = (js) => win.webContents.executeJavaScript(js);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ev(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  await win.loadFile(path.join(www, 'index.html'));
  await ctx.wait(500);

  // ---------- Huelle ----------
  const host = await ev(`({ platform: window.JCHost?.platform, version: window.JCHost?.version, name: window.JCHost?.deviceName, web: window.jc?.web, registerPlugin: typeof window.Capacitor.registerPlugin, error: window.JCHostError ?? null })`);
  check('Huelle meldet sich: Plattform android, Version aus package.json, Geraetename', host.platform === 'android' && host.version === version && /Jellycloud/.test(host.name) && host.web === true, JSON.stringify(host));
  check('Auch ohne registerPlugin (wie in der echten Bruecke) startet die Huelle ohne Fehler (es geht allein ueber nativePromise)', host.registerPlugin === 'undefined' && host.error === null, JSON.stringify({ registerPlugin: host.registerPlugin, error: host.error }));

  // ---------- Sicherer Speicher: Uebernahme aus dem localStorage von 1.1.6 ----------
  await waitFor(`window.__calls.secureSave > 0`, 4000);
  const moved = await ev(`({ old: localStorage.getItem('jellycloud.config'), stored: window.__secureStore['jellycloud.config'] ?? null, n: window.__calls.secureSave })`);
  // Die Oberflaeche schreibt die uebernommene Konfiguration gleich in ihrer eigenen Form zurueck (eingerueckt, mit allen Standardwerten): verglichen wird der Inhalt
  const movedCfg = (() => {
    try {
      return JSON.parse(moved.stored ?? 'null');
    } catch {
      return null;
    }
  })();
  check('Uebernahme: die alte Konfiguration steht verschluesselt im nativen Speicher und ist aus dem localStorage entfernt', moved.old === null && movedCfg?.deviceId === 'seed-device-0001' && moved.n >= 1, JSON.stringify({ old: moved.old, deviceId: movedCfg?.deviceId, n: moved.n }));

  // ---------- Anmeldung ueber die "native" HTTP-Schicht ----------
  const probe = await ev(`window.jc.probeServer('127.0.0.1:8097').catch((e) => ({ err: e.message }))`);
  check('Server pruefen ueber die native HTTP-Schicht (Antwort mit ok, status, json)', probe?.name === 'Mock Jellyfin', JSON.stringify(probe));
  const bad = await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'falsch' }).then(() => null, (e) => ({ status: e.status }))`);
  check('Falsches Passwort: Fehler 401 auch ueber die native Schicht', bad?.status === 401, JSON.stringify(bad));
  const login = await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'demo' }).then((s) => ({ ok: s.loggedIn, platform: s.platform }), (e) => ({ err: e.message }))`);
  check('Anmeldung gelingt, Zustand meldet Plattform android', login.ok === true && login.platform === 'android', JSON.stringify(login));
  await ctx.wait(200); // Zurueckschreiben laeuft im Hintergrund
  const saved = await ev(`({ ls: Object.keys(localStorage).filter((k) => k !== '__seeded'), cfg: JSON.parse(window.__secureStore['jellycloud.config'] ?? '{}') })`);
  check('Nach der Anmeldung: Server und Zugangsdaten nur im nativen Speicher, nichts davon im localStorage, Geraetekennung uebernommen', saved.ls.length === 0 && saved.cfg.servers?.length === 1 && !!saved.cfg.servers[0].token && saved.cfg.deviceId === 'seed-device-0001', JSON.stringify({ ls: saved.ls, servers: saved.cfg.servers?.length, device: saved.cfg.deviceId }));

  // ---------- Wiedergabe ----------
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const ep = [...items.values()].find((i) => i.Type === 'Episode');
  const closed = await ev(`(() => { window.__events = []; window.jc.onPlayerActive((on) => window.__events.push('active:' + on)); window.jc.onPlayerClosed((i) => window.__events.push('closed:' + (i?.itemId ?? ''))); return true; })()`);
  state.log.length = 0;
  await ev(`window.__calls.play.length = 0`);
  const r1 = await ev(`window.jc.play({ itemId: '${movie.Id}', resume: true }).then(() => 'ok', (e) => e.message)`);
  const c1 = await ev(`window.__calls.play.map((o) => o)`);
  const o1 = c1[0] ?? {};
  check('Wiedergabe: genau ein Aufruf des nativen Players, Antwort ok', r1 === 'ok' && c1.length === 1, `${r1}, ${c1.length} Aufrufe`);
  check('Direct Play: Adresse /Videos/<Id>/stream, Token nur im Header (nicht in der Adresse)', o1.method === 'DirectPlay' && o1.url?.startsWith(`http://127.0.0.1:8097/Videos/${movie.Id}/stream?`) && !/token|api_key/i.test(o1.url) && /Token="/.test(o1.authorization ?? ''), `${o1.method} ${o1.url?.slice(0, 90)}`);
  // Was der Server fuer diesen Eintrag liefert (Fortschritt steht im Benutzer-Teil der Antwort, nicht im statischen Eintrag des Mock-Servers)
  const served = await ev(`window.jc.api('getItem', '${movie.Id}')`);
  const resumeMs = Math.round((served.UserData?.PlaybackPositionTicks ?? 0) / 10000);
  check('Startstelle (weiterschauen), Dauer und Titel kommen vom Eintrag', resumeMs > 0 && o1.startMs === resumeMs && o1.durationMs === Math.round(movie.RunTimeTicks / 10000) && o1.title === 'Aurora Protocol', `start=${o1.startMs} (erwartet ${resumeMs}) dauer=${o1.durationMs}`);
  check('Server, Sitzung und Quelle gehen mit (fuer die Meldungen an Jellyfin)', o1.baseUrl === 'http://127.0.0.1:8097' && o1.playSessionId === 'mock-session' && !!o1.mediaSourceId && !!o1.deviceId && o1.itemId === movie.Id);
  const log1 = state.log.filter((l) => l.at === 'PlaybackInfo');
  const dp = log1[0]?.directPlayProfiles?.[0] ?? {};
  check('Geraeteprofil: mp4/mkv, H.264/HEVC, Ton nur AAC, MP3, Opus, FLAC, Vorbis (kein AC3/DTS), Start 0', log1.length === 1 && /mkv/.test(dp.Container) && /hevc/.test(dp.VideoCodec) && /aac/.test(dp.AudioCodec) && !/ac3|dts|truehd/i.test(dp.AudioCodec) && log1[0].startTicks === 0, JSON.stringify({ n: log1.length, dp, start: log1[0]?.startTicks }));
  const ev1 = await ev(`window.__events`);
  check('Ereignisse: Player aktiv, dann nicht mehr aktiv, dann geschlossen (Weiterschauen laedt neu)', JSON.stringify(ev1) === JSON.stringify(['active:true', 'active:false', `closed:${movie.Id}`]), JSON.stringify(ev1));

  // ---------- von vorn ----------
  await ev(`window.__calls.play.length = 0`);
  await ev(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  const o2 = (await ev(`window.__calls.play`))[0] ?? {};
  check('"Von vorn": Startstelle 0', o2.startMs === 0, `start=${o2.startMs}`);

  // ---------- Rueckfall: Decoder-Fehler -> Transcode ab der erreichten Stelle ----------
  state.log.length = 0;
  await ev(`window.__calls.play.length = 0; window.__playResults.push({ positionMs: 123456, durationMs: 0, ended: false, error: 'Die Wiedergabe ist fehlgeschlagen (ERROR_CODE_DECODING_FAILED)', errorKind: 'decoder' })`);
  const r3 = await ev(`window.jc.play({ itemId: '${movie.Id}', resume: true }).then(() => 'ok', (e) => e.message)`);
  const c3 = await ev(`window.__calls.play`);
  const log3 = state.log.filter((l) => l.at === 'PlaybackInfo');
  check('Decoder-Fehler: zweiter Versuch als Transcode (HLS), ab der erreichten Stelle', r3 === 'ok' && c3.length === 2 && c3[0].method === 'DirectPlay' && c3[1].method === 'Transcode' && /master\.m3u8/.test(c3[1].url) && c3[1].startMs === 123456, JSON.stringify({ r3, methods: c3.map((c) => c.method), start2: c3[1]?.startMs }));
  check('Zweite Anfrage an den Server verbietet Direct Play', log3.length === 2 && log3[0].enableDirectPlay === true && log3[1].enableDirectPlay === false, JSON.stringify(log3.map((l) => l.enableDirectPlay)));

  // ---------- Fehler vom Server ----------
  await ev(`window.__calls.play.length = 0; window.__events.length = 0; window.__playResults.push({ positionMs: 0, durationMs: 0, ended: false, error: 'Der Server ist nicht erreichbar', errorKind: 'source' })`);
  const r4 = await ev(`window.jc.play({ itemId: '${movie.Id}', resume: true }).then(() => 'ok', (e) => e.message)`);
  const ev4 = await ev(`window.__events`);
  check('Fehler "source": die Meldung des Players erreicht die Oberflaeche, es gibt keinen zweiten Versuch', r4 === 'Der Server ist nicht erreichbar' && (await ev(`window.__calls.play.length`)) === 1, String(r4));
  check('Auch nach einem Fehler: Player nicht mehr aktiv und geschlossen gemeldet', JSON.stringify(ev4) === JSON.stringify(['active:true', 'active:false', `closed:${movie.Id}`]), JSON.stringify(ev4));

  // ---------- Folge ----------
  await ev(`window.__calls.play.length = 0`);
  await ev(`window.jc.play({ itemId: '${ep.Id}', resume: false })`);
  const o5 = (await ev(`window.__calls.play`))[0] ?? {};
  check('Folge: Titel = Folgenname, Untertitel = Serie und "S<Staffel>:E<Folge>"', o5.title === ep.Name && /\S+ · S\d+:E\d+$/.test(o5.subtitle ?? '') && (o5.subtitle ?? '').startsWith(ep.SeriesName ?? '?'), `${o5.title} | ${o5.subtitle}`);

  // ---------- Wie der Server liefern wuerde (Wiedergabe-Tag der Detailseite), ohne abzuspielen ----------
  await ev(`window.__calls.play.length = 0`);
  const ol = await ev(`window.jc.playbackOutlook({ itemId: '${movie.Id}' }).then((r) => r, (e) => ({ err: e.message }))`);
  check('Ausblick: derselbe Plan wie beim Start (Direct Play), der Player wird dabei nicht aufgerufen', ol?.method === 'DirectPlay' && (await ev(`window.__calls.play.length`)) === 0, JSON.stringify(ol));

  // ---------- Links ----------
  await ev(`window.__calls.openExternal.length = 0; window.jc.openExternal('https://example.com/trailer')`);
  await ctx.wait(100);
  const ext = await ev(`window.__calls.openExternal`);
  check('Link wird an das native Plugin uebergeben', ext.length === 1 && ext[0].url === 'https://example.com/trailer', JSON.stringify(ext));
  const badExt = await ev(`window.jc.openExternal('file:///C:/x').then(() => 'ok', (e) => e.message)`);
  check('Nur http(s)-Links werden uebergeben', /http/.test(String(badExt)) && (await ev(`window.__calls.openExternal.length`)) === 1, String(badExt));

  // ---------- mit der echten JavaScript-Laufzeit von @capacitor/core (registerPlugin ueber PluginHeaders und nativePromise) ----------
  const coreJs = fs.readFileSync(path.join(root, 'mobile', 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), 'utf8');
  const hostJs = fs.readFileSync(path.join(www, 'web', 'host.js'), 'utf8');
  await ev(coreJs);
  const reg = await ev(`typeof window.Capacitor.registerPlugin`);
  await ev(`window.JCHost = undefined; window.JCHostError = undefined; window.__calls.play.length = 0;`);
  await ev(hostJs);
  const r7 = await ev(`window.jc.play({ itemId: '${movie.Id}', resume: false }).then(() => 'ok', (e) => e.message)`);
  const n7 = await ev(`window.__calls.play.length`);
  check('Mit der echten Capacitor-Laufzeit (registerPlugin) laeuft die Wiedergabe genauso', reg === 'function' && r7 === 'ok' && n7 === 1, JSON.stringify({ reg, r7, n7 }));

  // ---------- Diagnose unter Einstellungen > Info ----------
  // Die Oberflaeche zeigt noch die Anmeldeseite (der Test hat sich ueber die Schnittstelle angemeldet): neu aufbauen lassen, dann die Info-Seite oeffnen
  await ev(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.home .rows .row')`, 15000);
  await ev(`location.hash = '#/settings/about'`);
  const diag = await waitFor(`/Diagnose: Plattform android/.test(document.body.innerText)`);
  const diagText = await ev(`(document.body.innerText.match(/Diagnose: [^\\n]+/) ?? [''])[0]`);
  const cardText = (await ev(`(document.querySelector('.about-card')?.innerText ?? '').replace(/\\s+/g, ' ')`)) || `[Info-Karte fehlt; Adresse ${await ev('location.hash')}, Ansicht: ${(await ev(`(document.querySelector('#view')?.innerText ?? document.body.innerText).replace(/\\s+/g, ' ').slice(0, 120)`))}]`;
  check('Einstellungen > Info zeigt Diagnose: Plattform, Huelle ok, Engine-Version; keine Windows/mpv-Texte', diag && /Hülle ok/.test(diagText) && /Chrome \d+/.test(diagText) && !/mpv|FFmpeg/.test(cardText), `${diagText} | ${cardText.slice(0, 160)}`);

  // ---------- Auf diesem Geraet fortsetzen (P19): auf dem Handy ueber der Reiterleiste ----------
  await fetch('http://127.0.0.1:8097/__debug/session?device=Wohnzimmer%20Apple%20TV&at=120', { method: 'POST' });
  await ev(`location.hash = '#/home'`);
  const capsuleOk = await waitFor(`(() => { const e = document.querySelector('.handoff.in'); return !!e && !e.hidden; })()`, 10000);
  await ctx.wait(500);
  // Lage ohne die Einblende-Bewegung (im unsichtbaren Fenster laufen Uebergaenge nicht weiter): Kasten der Anordnung, zentriert ueber translate(-50%)
  const geo = capsuleOk ? await ev(`(() => { const e = document.querySelector('.handoff'); const t = document.querySelector('.tabbar'); const left = e.offsetLeft - e.offsetWidth / 2; return { gap: Math.round(t.offsetTop - (e.offsetTop + e.offsetHeight)), left: Math.round(left), right: Math.round(innerWidth - left - e.offsetWidth), h: e.offsetHeight, detail: document.querySelector('.handoff-detail')?.textContent }; })()`) : null;
  check('Auf diesem Geraet fortsetzen auf dem Handy: Kapsel ueber der Reiterleiste (Abstand 10), mit dem Seitenrand links und rechts', capsuleOk && geo.gap >= 8 && geo.gap <= 12 && geo.left === 16 && geo.right === 16 && geo.h >= 56 && /Wohnzimmer Apple TV/.test(geo.detail ?? ''), JSON.stringify(geo));
  // Aufnahme: das Fenster zeigen (ohne Fokus), damit die Kapsel fertig eingeblendet ist. Es bleibt danach sichtbar: ein wieder verborgenes Fenster gilt als
  // "hidden", und die Oberflaeche ruht dann (requestAnimationFrame, Abfragen)
  win.showInactive();
  await ctx.wait(900);
  const shotDir = process.env.SHOT_DIR || path.join(root, 'shots');
  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, 'AH-handoff.png'), (await win.webContents.capturePage()).toPNG());
  await fetch('http://127.0.0.1:8097/__debug/session?clear=1', { method: 'POST' });

  // ---------- Zurueck-Taste (MainActivity fragt window.JCWeb.back) ----------
  await ev(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.home .rows .row')`, 8000);
  check('Zurueck auf der Startseite: unbehandelt (die App geht in den Hintergrund)', (await ev(`window.JCWeb.back()`)) === false);
  await ev(`location.hash = '#/item/'`);
  await waitFor(`location.hash.includes('/item/') && !!document.querySelector('.detail')`, 8000);
  const backDetail = await ev(`window.JCWeb.back()`);
  const leftDetail = await waitFor(`!location.hash.includes('/item/')`, 4000);
  check('Zurueck auf einer Detailseite: behandelt, eine Seite zurueck', backDetail === true && leftDetail, await ev('location.hash'));
  // Ein echtes Menue der Oberflaeche: "Sortieren" in einer Bibliothek (Reiter unten, kompakte Ansicht)
  const libHref = await ev(`[...document.querySelectorAll('.tabbar-item')].map((a) => a.getAttribute('href')).find((h) => h === '#/movies') ?? null`);
  await ev(`location.hash = ${JSON.stringify(libHref ?? '#/home')}`);
  await waitFor(`[...document.querySelectorAll('.lib-controls .btn')].some((x) => /Sortier/.test(x.textContent))`, 8000);
  await ev(`[...document.querySelectorAll('.lib-controls .btn')].find((x) => /Sortier/.test(x.textContent))?.click()`);
  const hadMenu = await waitFor(`!!document.querySelector('.menu.open')`, 3000);
  const backMenu = await ev(`window.JCWeb.back()`);
  await ctx.wait(300);
  const afterMenu = await ev(`({ menu: !!document.querySelector('.menu.open'), hash: location.hash })`);
  check('Zurueck bei offenem Menue: behandelt, schliesst nur das Menue (die Seite bleibt)', !!libHref && hadMenu && backMenu === true && !afterMenu.menu && afterMenu.hash === libHref, JSON.stringify({ libHref, hadMenu, backMenu, afterMenu }));

  // ---------- Neustart: angemeldet aus dem nativen Speicher ----------
  const savesBefore = await ev(`window.__calls.secureSave`);
  // Die App startet durch das Antippen einer Mitteilung (das Plugin haelt ihr Ziel bereit): eine eines anderen Profils, sie darf nichts oeffnen
  const foreignTap = { id: 'seerr-2-available', mediaType: 'movie', tmdbId: 90002, title: 'Anfrage 90002', profile: 'abcdef123456', state: 'available' };
  await ev(`sessionStorage.setItem('__notifyTapOnStart', ${JSON.stringify(JSON.stringify(foreignTap))})`);
  await win.webContents.reload();
  await waitFor(`!!window.jc`, 8000);
  const restarted = await ev(`window.jc.getState().then((s) => ({ in: s.loggedIn, ls: localStorage.getItem('jellycloud.config'), err: window.JCHostError ?? null }))`);
  check('Nach einem Neustart angemeldet (aus dem nativen Speicher), localStorage bleibt leer, Huelle ohne Fehler', restarted.in === true && restarted.ls === null && restarted.err === null, JSON.stringify({ ...restarted, savesBefore }));

  // ---------- Mitteilungen des Systems (NotificationPlugin.java, Plan P18) ----------
  const coldTaken = await waitFor(`window.__calls.takeTap > 0 && window.__notifyTap === null && !!document.querySelector('#view')`, 10000);
  await ctx.wait(600);
  check('Kalter Start durch Antippen: steht die Oberflaeche, holt sie das Ziel einmal ab; eine Mitteilung eines anderen Profils oeffnet nichts', coldTaken && !/#\/seerr\//.test(await ev('location.hash')), JSON.stringify({ coldTaken, takes: await ev('window.__calls.takeTap'), hash: await ev('location.hash') }));
  const st0 = await ev(`window.jc.notificationSystemStatus()`);
  const st1 = await ev(`window.jc.notificationSystemRequest()`);
  const asked = await ev(`window.__calls.notify.filter((c) => c.method === 'request').length`);
  check('Erlaubnis: der Stand kommt vom Plugin, gefragt wird erst auf Wunsch (einmal)', st0?.supported === true && st0.permission === 'prompt' && st1?.permission === 'granted' && asked === 1, JSON.stringify({ st0, st1, asked }));
  const msg = { id: 'abcdef123456.seerr-2-available', title: 'Dein angefragter Film ist jetzt verfügbar', body: '„Anfrage 90002“ wurde deiner Mediathek hinzugefügt und kann jetzt abgespielt werden.', preview: 'Neuigkeit zu einer Anfrage', target: foreignTap };
  await ev(`window.__calls.notify.length = 0; window.JCHost.systemNotify.show([${JSON.stringify(msg)}])`);
  await ev(`window.JCHost.systemNotify.withdraw(['abcdef123456.seerr-2-available'])`);
  await ev(`window.JCHost.systemNotify.withdrawProfile('abcdef123456')`);
  const sent = await ev(`window.__calls.notify`);
  const shown = sent.find((c) => c.method === 'show')?.options;
  const it = shown?.items?.[0];
  check('Zeigen: Kennung, Titel, Text und verborgener Inhalt gehen an das Plugin, das Ziel als Text (kommt beim Antippen unveraendert zurueck)', !!it && it.id === msg.id && it.title === msg.title && it.body === msg.body && it.preview === msg.preview && typeof it.target === 'string' && JSON.stringify(JSON.parse(it.target)) === JSON.stringify(foreignTap) && typeof shown.silent === 'boolean', JSON.stringify(shown));
  check('Zuruecknehmen einzeln und je Profil gehen an das Plugin', JSON.stringify(sent.filter((c) => c.method !== 'show').map((c) => [c.method, c.options])) === JSON.stringify([['withdraw', { ids: ['abcdef123456.seerr-2-available'] }], ['withdrawProfile', { key: 'abcdef123456' }]]), JSON.stringify(sent.map((c) => c.method)));
  // Antippen bei laufender App: das Plugin meldet sich mit einem Fensterereignis, die Oberflaeche holt das Ziel ab
  const takesBefore = await ev(`window.__calls.takeTap`);
  await ev(`window.__notifyTap = ${JSON.stringify(JSON.stringify(foreignTap))}; window.dispatchEvent(new Event('jellycloudnotificationtap'))`);
  const warmTaken = await waitFor(`window.__calls.takeTap > ${takesBefore} && window.__notifyTap === null`, 4000);
  await ctx.wait(400);
  check('Antippen bei laufender App: das Ereignis des Plugins laesst die Oberflaeche das Ziel abholen; fremdes Profil: nichts oeffnet sich', warmTaken && !/#\/seerr\//.test(await ev('location.hash')), JSON.stringify({ warmTaken, hash: await ev('location.hash') }));
  await ev(`window.jc.notificationSystemSettings()`);
  check('Weg in die Einstellungen des Systems geht an das Plugin', (await ev(`window.__calls.notify.filter((c) => c.method === 'openSettings').length`)) === 1);

  // ---------- Schreibfehler des nativen Speichers ----------
  await ev(`window.__secureFail = 'save'; window.jc.setSettings({ player: { volume: 77 } })`).catch(() => null);
  const failed = await waitFor(`/Speichern fehlgeschlagen/.test(window.JCHostError ?? '')`, 3000);
  const leak = await ev(`localStorage.getItem('jellycloud.config')`);
  check('Scheitert das sichere Speichern: Grund unter window.JCHostError (Diagnose), kein Rueckfall in den localStorage', failed && leak === null, JSON.stringify({ err: await ev('window.JCHostError ?? null'), leak }));
  errors.splice(0, errors.length, ...errors.filter((e) => !/Sicherer Speicher: Speichern fehlgeschlagen/.test(e))); // erwartete Meldung dieses Falls

  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
  win.destroy();
  fs.rmSync(www, { recursive: true, force: true });
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
