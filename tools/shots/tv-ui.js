// TV-Ansicht (src/renderer/js/tv.js, Android TV): die Web-Fassung mit der Huelle der Android-App (mobile/host-capacitor.js) und einem Ersatz fuer Capacitor, der
// sich als Fernseher meldet (JellycloudPlayerPlugin.device -> tv: true), in einem Fenster von 960 x 540 (so viele CSS-Pixel hat ein 1080p-Fernseher bei
// Android TV). Bedient wird nur mit Tasten ueber das Debug-Protokoll (echte, vertrauenswuerdige Ereignisse wie von der Fernbedienung).
// Geprueft: TV-Form ohne Handy-Ansicht, Fokus nach dem Start, Pfeiltasten (Reihe runter, seitwaerts in der Reihe, hoch in die Kopfleiste, dort seitwaerts),
// Kopfleiste gleitet weg und kommt wieder, OK oeffnet die Detailseite mit Fokus auf "Abspielen", Zurueck stellt den Fokus wieder her, langes OK oeffnet das
// Kontextmenue (Fokus bleibt darin, Zurueck schliesst es), Zurueck auf der Startseite: erst in die Reiterleiste, dann verlaesst es die App; Fokus sichtbar.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { BrowserWindow } = require('electron');
const { server, items } = require('../mock-server');

module.exports = async (ctx) => {
  const root = path.join(__dirname, '..', '..');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const PORT = 8097;
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  await ctx.wait(300);
  const shotDir = process.env.SHOT_DIR || path.join(os.tmpdir(), 'jc-tv-shots');
  fs.mkdirSync(shotDir, { recursive: true });

  const www = path.join(os.tmpdir(), `jc-tv-www-${process.pid}`);
  require('../build-web').buildWeb(www, { host: path.join(root, 'mobile', 'host-capacitor.js') });

  // Ersatz fuer die Android-Bruecke (wie android-host.js), hier als Fernseher
  const FAKE = `(() => {
    window.__calls = { play: [] };
    const secure = JSON.parse(sessionStorage.getItem('__secure') || '{}');
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
      PluginHeaders: [],
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'CapacitorHttp' && method === 'request') return http(options);
        if (plugin === 'JellycloudPlayer' && method === 'device') return { tv: true };
        if (plugin === 'JellycloudPlayer' && method === 'play') { window.__calls.play.push(options); return { positionMs: 0, durationMs: 0, ended: false, error: null, errorKind: null }; }
        if (plugin === 'JellycloudPlayer' && method === 'audioOutput') return { channels: 2 };
        if (plugin === 'JellycloudPlayer' && method === 'screen') return { hdr: false };
        if (plugin === 'JellycloudPlayer' && method === 'codecs') return null;
        if (plugin === 'JellycloudSecureStore' && method === 'load') return { value: secure[options.key] ?? null, unreadable: false };
        if (plugin === 'JellycloudSecureStore' && method === 'save') { secure[options.key] = options.value; sessionStorage.setItem('__secure', JSON.stringify(secure)); return {}; }
        if (plugin === 'JellycloudNotifications') return method === 'takeTap' ? { target: null } : { supported: true, permission: 'denied', settings: true };
        throw { message: plugin + '.' + method + ' is not implemented' };
      }
    };
  })();`;

  const errors = [];
  const win = new BrowserWindow({ width: 960, height: 540, useContentSize: true, show: false, backgroundColor: '#0a0b10', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } }); // ohne sichtbares Fenster, aber mit laufend gezeichneten Bildern: weiches Scrollen und Animationen wie auf dem Geraet
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message', (e) => (e.level === 'error' || e.level >= 3) && !/Electron Security Warning/.test(e.message) && errors.push(e.message));
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
  const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13 };
  const key = async (k, { hold = 0 } = {}) => {
    const base = { key: k, code: k, windowsVirtualKeyCode: VK[k], nativeVirtualKeyCode: VK[k] };
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    if (hold) {
      const end = Date.now() + hold;
      while (Date.now() < end) {
        await ctx.wait(80);
        await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', autoRepeat: true, ...base });
      }
    }
    await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await ctx.wait(420); // weiches Scrollen und Fokuswechsel
  };
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, `${name}.png`), img.toPNG());
  };
  const focusInfo = () => ev(`(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { tag: 'BODY' };
    const r = a.getBoundingClientRect();
    return {
      tag: a.tagName, cls: String(a.className), text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40), href: a.getAttribute('href'),
      inBar: !!a.closest('.topbar'), inRow: !!a.closest('.row'), scroller: a.closest('.scroller') ? [...document.querySelectorAll('.scroller')].indexOf(a.closest('.scroller')) : -1,
      inMenu: !!a.closest('.menu'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      onScreen: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
      ring: getComputedStyle(a.querySelector('.thumb') ?? a).boxShadow !== 'none' || getComputedStyle(a).outlineStyle !== 'none' || getComputedStyle(a).backgroundColor !== 'rgba(0, 0, 0, 0)'
    };
  })()`);

  await win.loadFile(path.join(www, 'index.html'));
  await waitFor(`document.documentElement.dataset.form === 'tv' && !!window.jc`);
  const form = await ev(`({ form: document.documentElement.dataset.form, compact: document.documentElement.dataset.compact })`);
  check('Fernseher: <html data-form="tv">, keine Handy-Ansicht bei 960 x 540', form.form === 'tv' && form.compact === 'off', JSON.stringify(form));

  // Anmeldung: ohne gespeichertes Profil startet die App dort; der Fokus steht im ersten Feld, runter geht weiter
  await waitFor(`!document.getElementById('splash') && !!document.querySelector('input')`, 10000);
  await ctx.wait(600);
  const l0 = await focusInfo();
  await key('ArrowDown');
  const l1 = await focusInfo();
  await shot('00-login');
  check('Anmeldung: der Fokus steht auf der Seite, Pfeil runter geht weiter', l0.tag !== 'BODY' && l1.tag !== 'BODY' && (l1.y > l0.y || l1.text !== l0.text), JSON.stringify({ l0, l1 }));

  // Anmelden (das Ausfuellen per Bildschirmtastatur ist hier nicht Gegenstand), dann baut die App die Startseite auf
  await ev(`window.jc.login({ url: 'http://127.0.0.1:${PORT}', username: 'demo', password: 'demo' })`);
  await ev(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`document.querySelectorAll('#view .row .card').length > 3`, 15000);
  await waitFor(`!document.getElementById('splash')`, 8000); // Startanimation vorbei
  await ctx.wait(900);
  await shot('01-start');
  let f = await focusInfo();
  check('Nach dem Start hat der Hauptknopf des Banners den Fokus (nicht der Hinweis "Seerr verbinden"), sichtbar', /primary/.test(f.cls) && !/sm/.test(f.cls) && !f.inBar && f.onScreen && f.ring, JSON.stringify(f));

  // Runter in die erste Reihe
  let guard = 0;
  while (!(f = await focusInfo()).inRow && guard++ < 6) await key('ArrowDown');
  await shot('02-row');
  check('Pfeil runter: Fokus auf einer Karte der ersten Reihe, ganz im Bild', f.inRow && f.onScreen, JSON.stringify(f));
  const row1 = f.scroller;
  await key('ArrowRight');
  const f2 = await focusInfo();
  check('Pfeil rechts: naechste Karte in derselben Reihe', f2.inRow && f2.scroller === row1 && f2.x > f.x - 2 && f2.href !== f.href, JSON.stringify({ from: f.href, to: f2.href, x: [f.x, f2.x] }));
  for (let i = 0; i < 6; i++) await key('ArrowRight');
  const f3 = await focusInfo();
  check('Weiter rechts: die Reihe scrollt mit, die Karte bleibt im Bild', f3.scroller === row1 && f3.onScreen, JSON.stringify(f3));
  await key('ArrowDown');
  const f4 = await focusInfo();
  check('Pfeil runter: naechste Reihe, Karte im Bild', f4.inRow && f4.scroller !== row1 && f4.onScreen, JSON.stringify(f4));
  await key('ArrowDown');
  const hidden = await ev(`document.documentElement.classList.contains('tv-bar-hidden')`);
  await shot('03-deeper');
  check('Im Inhalt und gescrollt: die Kopfleiste gleitet weg', hidden === true);

  // Hoch bis in die Kopfleiste
  guard = 0;
  while (!(f = await focusInfo()).inBar && guard++ < 10) await key('ArrowUp');
  const shown = await ev(`!document.documentElement.classList.contains('tv-bar-hidden')`);
  await shot('04-bar');
  check('Pfeil hoch bis oben: Fokus in der Kopfleiste, die wieder zu sehen ist', f.inBar && shown, JSON.stringify(f));
  const barFrom = f.text;
  await key('ArrowLeft');
  f = await focusInfo();
  check('In der Kopfleiste: links zum naechsten Eintrag', f.inBar && f.text !== barFrom && f.onScreen, `${barFrom} -> ${f.text}`);

  // Zurueck in den Inhalt und eine Karte oeffnen
  guard = 0;
  while (!(f = await focusInfo()).inRow && guard++ < 6) await key('ArrowDown');
  const cardHref = f.href;
  await key('Enter');
  const opened = await waitFor(`location.hash.startsWith('#/item/')`, 6000);
  await waitFor(`!!document.querySelector('#view .btn.primary')`, 6000);
  await ctx.wait(900);
  f = await focusInfo();
  await shot('05-detail');
  check('OK auf einer Karte: Detailseite, der Fokus steht auf dem Hauptknopf', opened && /primary/.test(f.cls) && f.onScreen, JSON.stringify({ hash: await ev('location.hash'), f }));
  await key('ArrowDown');
  const fd = await focusInfo();
  check('Detailseite: Pfeil runter fuehrt weiter in die Seite', fd.tag !== 'BODY' && fd.onScreen && fd.y > f.y - 2, JSON.stringify(fd));

  const back1 = await ev(`window.JCWeb.back()`);
  await waitFor(`location.hash === '#/home'`, 4000);
  await ctx.wait(700);
  f = await focusInfo();
  check('Zurueck: wieder die Startseite, der Fokus steht auf derselben Karte', back1 === true && f.href === cardHref && f.onScreen, JSON.stringify({ back1, f, cardHref }));

  // Langes OK: Kontextmenue
  await key('Enter', { hold: 750 });
  const menuOpen = await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  f = await focusInfo();
  await shot('06-menu');
  check('Langes OK auf einer Karte: Kontextmenue, der Fokus liegt darin', menuOpen && f.inMenu, JSON.stringify(f));
  check('Langes OK oeffnet nur das Menue, nicht die Karte', (await ev('location.hash')) === '#/home');
  await key('ArrowDown');
  const fm = await focusInfo();
  check('Im Menue: Pfeil runter bleibt im Menue', fm.inMenu, JSON.stringify(fm));
  const back2 = await ev(`window.JCWeb.back()`);
  await ctx.wait(400);
  f = await focusInfo();
  check('Zurueck schliesst das Menue, der Fokus geht an die Karte zurueck', back2 === true && !(await ev(`!!document.querySelector('.menu:not(.closing)')`)) && f.href === cardHref, JSON.stringify({ back2, f }));

  // Zurueck auf der Startseite: erst in die Reiterleiste, dann raus
  const back3 = await ev(`window.JCWeb.back()`);
  await ctx.wait(500);
  f = await focusInfo();
  check('Zurueck auf der Startseite (Fokus im Inhalt): Fokus in die Reiterleiste', back3 === true && f.inBar && /nav-link/.test(f.cls), JSON.stringify({ back3, f }));
  const back4 = await ev(`window.JCWeb.back()`);
  check('Noch einmal Zurueck: die Oberflaeche hat nichts mehr zu tun (die App geht in den Hintergrund)', back4 === false, String(back4));

  // Filme-Reiter: Raster der Mediathek
  await key('ArrowRight');
  await key('Enter');
  await waitFor(`location.hash === '#/movies' && document.querySelectorAll('#view .card').length > 2`, 6000);
  await ctx.wait(800);
  await key('ArrowDown');
  f = await focusInfo();
  await key('ArrowDown');
  const g2 = await focusInfo();
  await shot('07-movies');
  check('Mediathek: runter in das Raster und darin weiter, Karte im Bild', /card/.test(g2.cls) && g2.onScreen && g2.y >= f.y, JSON.stringify({ f, g2 }));

  // Suche: Reiter "Suche", der Fokus steht im Suchfeld; runter verlaesst es
  await ev(`location.hash = '#/search'`);
  await waitFor(`!!document.querySelector('#view input')`, 5000);
  await ctx.wait(700);
  f = await focusInfo();
  await shot('08-search');
  check('Suche: der Fokus steht im Suchfeld', f.tag === 'INPUT', JSON.stringify(f));

  // Einstellungen: Liste der Bereiche, mit den Pfeilen durchgehen
  await ev(`location.hash = '#/settings'`);
  await waitFor(`location.hash === '#/settings' && document.querySelectorAll('#view a, #view button').length > 3`, 5000);
  await waitFor(`document.activeElement && document.activeElement !== document.body`, 3000);
  await ctx.wait(300);
  const s0 = await focusInfo();
  await key('ArrowDown');
  await key('ArrowDown');
  const s1 = await focusInfo();
  await shot('09-settings');
  check('Einstellungen: Fokus auf der Seite, Pfeil runter geht weiter, alles im Bild', s0.tag !== 'BODY' && s1.tag !== 'BODY' && s1.onScreen && (s1.y > s0.y || s1.text !== s0.text), JSON.stringify({ s0, s1 }));

  // Anfragen (ohne Seerr: Hinweis mit Knopf), Seite einer Serie mit Staffeln und Folgen
  await ev(`location.hash = '#/requests'`);
  await ctx.wait(1500);
  const r0 = await focusInfo();
  await shot('10-requests');
  check('Anfragen: der Fokus steht auf der Seite (Knopf des Hinweises)', r0.tag !== 'BODY' && !r0.inBar && r0.onScreen, JSON.stringify(r0));
  const series = [...items.values()].find((i) => i.Type === 'Series');
  await ev(`location.hash = '#/item/${series.Id}'`);
  await waitFor(`!!document.querySelector('#view .ep')`, 6000);
  await ctx.wait(800);
  guard = 0;
  while (!/(^|\s)ep(\s|$)/.test((f = await focusInfo()).cls) && guard++ < 8) await key('ArrowDown');
  await shot('11-episodes');
  check('Serie: runter bis zu den Folgen, die Folge im Fokus ist im Bild', /(^|\s)ep(\s|$)/.test(f.cls) && f.onScreen, JSON.stringify(f));
  await key('ArrowDown');
  const e2 = await focusInfo();
  check('Folgen: Pfeil runter zur naechsten Folge', /(^|\s)ep(\s|$)/.test(e2.cls) && e2.onScreen && e2.y > f.y - 2, JSON.stringify(e2));
  // Die Seite einer Folge: ueber das Kontextmenue (der Titel-Link in der Folge ist auf dem Fernseher kein eigenes Ziel)
  await key('Enter', { hold: 750 });
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  const entries = await ev(`[...document.querySelectorAll('.menu.open .menu-item .lbl')].map((x) => x.textContent)`);
  check('Langes OK auf einer Folge: das Menue hat "Details"', entries.includes('Details'), JSON.stringify(entries));
  await ev(`[...document.querySelectorAll('.menu.open .menu-item')].find((b) => b.textContent.includes('Details'))?.focus()`);
  await key('Enter');
  check('"Details" oeffnet die Seite der Folge', await waitFor(`location.hash.startsWith('#/item/') && location.hash !== '#/item/${series.Id}'`, 4000), await ev('location.hash'));

  check('Keine Fehler in der Konsole', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`Aufnahmen: ${shotDir}`);
  win.destroy();
  fs.rmSync(www, { recursive: true, force: true });
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
