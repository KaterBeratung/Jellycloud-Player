// Huelle der Android-App (mobile/host-capacitor.js) ohne Handy: Die Oberflaeche laeuft ohne Electron-Vorlade-Datei, ein Ersatz fuer Capacitor (window.Capacitor mit den Plugins
// CapacitorHttp und JellycloudPlayer) wird vor allen Seitenskripten eingeschleust (Debug-Protokoll, Page.addScriptToEvaluateOnNewDocument). Der Ersatz fuer CapacitorHttp ruft den Mock-Server auf,
// der Ersatz-Player merkt sich, was die Huelle ihm uebergibt, und antwortet mit vorgegebenen Ergebnissen.
// Geprueft: Huelle meldet sich (Plattform, Version, Geraetename), Anmeldung ueber die "native" HTTP-Schicht, Wiedergabe-Plan (Direct Play, Token nur im Header, Startstelle, Dauer, Titel,
// Geraeteprofil mit konservativem Ton), Rueckfall auf Transcode bei Decoder-Fehler ab der erreichten Stelle, Fehlermeldung bei Serverfehler, Ereignisse, Links, Folgen-Titel, Neustart von vorn.
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
  const FAKE = `(() => {
    window.__calls = { play: [], openExternal: [] };
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
        { name: 'JellycloudPlayer', methods: [{ name: 'play', rtype: 'promise' }, { name: 'openExternal', rtype: 'promise' }] }
      ],
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'CapacitorHttp' && method === 'request') return http(options);
        if (plugin === 'JellycloudPlayer' && method === 'play') {
          window.__calls.play.push(options);
          return window.__playResults.shift() ?? { positionMs: 0, durationMs: options.durationMs, ended: false, error: null, errorKind: null };
        }
        if (plugin === 'JellycloudPlayer' && method === 'openExternal') {
          window.__calls.openExternal.push(options);
          return {};
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

  // ---------- Anmeldung ueber die "native" HTTP-Schicht ----------
  const probe = await ev(`window.jc.probeServer('127.0.0.1:8097').catch((e) => ({ err: e.message }))`);
  check('Server pruefen ueber die native HTTP-Schicht (Antwort mit ok, status, json)', probe?.name === 'Mock Jellyfin', JSON.stringify(probe));
  const bad = await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'falsch' }).then(() => null, (e) => ({ status: e.status }))`);
  check('Falsches Passwort: Fehler 401 auch ueber die native Schicht', bad?.status === 401, JSON.stringify(bad));
  const login = await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'demo' }).then((s) => ({ ok: s.loggedIn, platform: s.platform }), (e) => ({ err: e.message }))`);
  check('Anmeldung gelingt, Zustand meldet Plattform android', login.ok === true && login.platform === 'android', JSON.stringify(login));

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

  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
  win.destroy();
  fs.rmSync(www, { recursive: true, force: true });
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
