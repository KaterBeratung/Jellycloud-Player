// Web-/Handy-Fassung (JC_DEV=1): dieselbe Oberflaeche ohne Electron-Vorlade-Datei, wie in einem Browser oder einer Capacitor-WebView.
// window.jc kommt aus src/web/jc-web.js, die Rueckseite laeuft in der Seite (src/shared/backend.js) und spricht direkt mit dem (Mock-)Server (CORS).
// Geprueft: Anmeldung, Zugangsdaten nur kodiert gespeichert, Neustart bleibt angemeldet, Startseite/Detail/Serie/Suche/Einstellungen, Bilder ueber die Server-Adresse,
// Wiedergabe-Haken fuer das Gehaeuse, keine Konsolenfehler; dazu Aufnahmen im Handy-Format.
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { server, items } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const root = path.join(__dirname, '..', '..');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(300);

  const errors = [];
  const win = new BrowserWindow({ width: 1280, height: 800, show: true, backgroundColor: '#0a0b10', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.on('console-message', (e) => (e.level === 'error' || e.level === 'warning' || e.level >= 2) && errors.push(`[${e.level}] ${e.message}`));
  // In der VM gilt ein Fenster hinter einem anderen als verdeckt (document.visibilityState 'hidden'): Bilder mit loading=lazy laden dann nicht, Aufnahmen bleiben leer.
  // Darum den Platz freimachen und das Fenster nach vorn holen.
  ctx.win.hide();
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  const ev = (js) => win.webContents.executeJavaScript(js);
  /** Aufnahmen sind nur zum Ansehen: scheitert eine (Fenster verdeckt), ist das kein Fehler der Pruefung. */
  const shot = async (name) => {
    try {
      // Ueber das Debug-Protokoll: funktioniert auch, wenn das Fenster verdeckt ist (capturePage meldet dann UnknownVizError)
      if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
      const r = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
      require('node:fs').mkdirSync(out, { recursive: true });
      require('node:fs').writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64'));
    } catch (e) {
      console.log(`  (Aufnahme ${name} nicht moeglich: ${e?.message ?? e})`);
    }
  };
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ev(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const load = async () => {
    await win.loadFile(path.join(root, 'src', 'web', 'index.html'));
    // Sichtbarkeit erzwingen (siehe oben): Debug-Protokoll, Seite in den Vordergrund und als aktiv/fokussiert ausgeben
    try {
      if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
      const dbg = (m, p) => win.webContents.debugger.sendCommand(m, p).catch(() => null);
      await dbg('Page.bringToFront');
      await dbg('Emulation.setFocusEmulationEnabled', { enabled: true });
      await dbg('Page.setWebLifecycleState', { state: 'active' });
    } catch {
      /* ohne Debug-Protokoll geht es auch, nur ggf. ohne geladene Lazy-Bilder */
    }
    await ctx.wait(600);
  };
  const page = async (hash, ready, ms = 8000) => {
    await ev(`location.hash = ${JSON.stringify(hash)}`);
    return waitFor(ready, ms);
  };

  await load();
  check('Ohne Electron: window.jc stammt aus jc-web.js, es gibt kein require', (await ev(`window.jc?.web === true && typeof window.require === 'undefined' && typeof window.process === 'undefined'`)) === true);
  check('Die gemeinsamen Module sind als Skripte geladen', (await ev(`['JCJellyfin','JCSeerr','JCConfig','JCBackend','JCHomeRows','JCMedia','JCAccent'].every((k) => !!window[k])`)) === true);
  check('Anmeldeseite erscheint (noch kein Konto)', await waitFor(`!!document.querySelector('input[type=password]') || !!document.querySelector('.login')`));
  await shot('W-01-anmeldung.png');

  // ---------- Anmeldung ----------
  const probe = await ev(`window.jc.probeServer('127.0.0.1:8097').catch((e) => ({ err: e.message }))`);
  check('Server pruefen laeuft direkt aus der Seite (CORS)', probe?.name === 'Mock Jellyfin', JSON.stringify(probe));
  const bad = await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'falsch' }).then(() => null, (e) => ({ status: e.status, name: e.name }))`);
  check('Falsches Passwort: Fehler mit status 401 (wie im Desktop-Programm)', bad?.status === 401 && bad?.name === 'JellycloudError', JSON.stringify(bad));
  await ev(`window.jc.login({ url: 'http://127.0.0.1:8097', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  check('Startseite: Banner und Reihen erscheinen', await waitFor(`!!document.querySelector('.home .hero .hero-slide') && document.querySelectorAll('.home .rows .row').length >= 3`, 15000));
  await ctx.wait(1500);

  const imgs = await ev(`(() => { const a = [...document.querySelectorAll('img')].filter((i) => i.src && i.getBoundingClientRect().top < innerHeight); return { n: a.length, ok: a.filter((i) => i.complete && i.naturalWidth > 0).length, bad: a.filter((i) => !/^http:\\/\\/127\\.0\\.0\\.1:8097\\/Items\\//.test(i.src)).map((i) => i.src).slice(0, 3) }; })()`);
  check('Bilder (im sichtbaren Bereich) kommen direkt vom Server (/Items/<Id>/Images/...) und sind geladen', imgs.n > 3 && imgs.bad.length === 0 && imgs.ok >= imgs.n * 0.8, JSON.stringify(imgs));

  // ---------- Ablage ----------
  const stored = JSON.parse(await ev(`localStorage.getItem('jellycloud.config')`));
  const srv = stored.servers[0];
  check('Konfiguration liegt in localStorage, das Konto ist drin, das Token nur kodiert', !!srv && srv.token.startsWith('plain:') && !srv.token.includes('mock') && stored.activeServerId === srv.id && /^[0-9a-f]{12}$/.test(srv.id), srv?.token.slice(0, 12));
  check('Standardeinstellungen sind vollstaendig', stored.settings?.player?.skipCountdown === 6 && stored.settings?.home?.heroSlides >= 3 && stored.settings?.appearance?.theme !== undefined);
  const info = await ev(`window.jc.getState()`);
  check('Zustand: angemeldet, Plattform "web", keine Desktop-Funktionen', info.loggedIn === true && info.platform === 'web' && info.mpv === null && info.autostartSupported === false && info.update === null && info.servers.length === 1 && info.servers[0].token === undefined, JSON.stringify({ p: info.platform, l: info.loggedIn }));

  // Neustart der Seite: weiter angemeldet, ohne neue Eingabe
  await load();
  check('Nach dem Neuladen der Seite bleibt das Konto angemeldet (Startseite ohne Anmeldung)', await waitFor(`!!document.querySelector('.home .rows .row')`, 15000));

  // ---------- Seiten ----------
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const show = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'The Winter Archive');
  check('Filmseite: Titel und Knoepfe', await page(`#/item/${movie.Id}`, `!!document.querySelector('.detail .detail-actions .btn') && /Aurora/.test(document.body.innerText)`));
  check('Serienseite: Staffel-Reiter und Folgen', await page(`#/item/${show.Id}`, `document.querySelectorAll('.season-tabs .tab').length >= 2 && document.querySelectorAll('.episodes .ep').length >= 3`));
  check('Suche findet Titel', await page('#/search?q=Aurora', `document.querySelectorAll('.card').length >= 1`));
  check('Einstellungen: Erscheinungsbild', await page('#/settings/appearance', `!!document.querySelector('.settings') || !!document.querySelector('.settings-stack')`));
  const snavs = await ev(`[...document.querySelectorAll('.snav')].map((a) => a.getAttribute('href'))`);
  check('Einstellungen ohne Desktop-Bereiche (mpv-Bild, Audio-Ausgabe, Discord), Rest bleibt', snavs.includes('#/settings/appearance') && snavs.includes('#/settings/about') && snavs.includes('#/settings/network') && !snavs.some((h) => /\/(video|audio|discord)$/.test(h)), snavs.join(' '));
  check('Desktop-Bereich per Adresse aufgerufen: faellt auf Erscheinungsbild zurueck', await page('#/settings/discord', `document.querySelector('.snav.on')?.getAttribute('href') === '#/settings/appearance'`));
  await page('#/settings/general', `!!document.querySelector('.settings-panel .setting')`);
  const gen = await ev(`document.querySelector('.settings-panel').innerText`);
  check('Allgemein ohne Autostart, Fensterwahl und Selbst-Aktualisierung', !/Mit Windows starten|Minimiert starten|Fenster merken|Updates/i.test(gen) && /Spoiler/i.test(gen), gen.replace(/\s+/g, ' ').slice(0, 120));
  await page('#/settings/about', `!!document.querySelector('.about-card')`);
  const about = await ev(`document.querySelector('.settings-panel').innerText`);
  check('Info im Browser: keine Update-Verwaltung', !/Updates/i.test(about) && /Jellycloud Player/.test(about), about.replace(/\s+/g, ' ').slice(0, 100));
  await page('#/settings/appearance', `!!document.querySelector('.settings') || !!document.querySelector('.settings-stack')`);
  check('Einstellung wirkt und wird gespeichert (Animationen aus)', (await ev(`window.jc.setSettings({ appearance: { animations: 'off' } }).then((s) => s.appearance.animations)`)) === 'off' && JSON.parse(await ev(`localStorage.getItem('jellycloud.config')`)).settings.appearance.animations === 'off');
  await ev(`window.jc.setSettings({ appearance: { animations: 'full' } })`);

  // ---------- Haken fuer das Gehaeuse ----------
  const noPlay = await ev(`window.jc.play({ itemId: '${movie.Id}' }).then(() => null, (e) => e.message)`);
  check('Wiedergabe ohne Gehaeuse: verstaendliche Meldung statt Absturz', typeof noPlay === 'string' && /Wiedergabe/.test(noPlay), String(noPlay));
  const played = await ev(`(async () => { let got = null; window.JCHost = { play: async (req, ctx) => { got = { id: req.itemId, base: ctx.client.baseUrl, auth: ctx.client.authHeader().includes('Token=') }; } }; await window.jc.play({ itemId: '${movie.Id}', resume: true }); return got; })()`);
  check('Wiedergabe mit Gehaeuse: es bekommt den Eintrag und den Zugang (Server, Token im Header)', played?.id === movie.Id && played?.base === 'http://127.0.0.1:8097' && played?.auth === true, JSON.stringify(played));
  const bogus = await ev(`window.jc.play({ itemId: 'nicht-gueltig' }).then(() => null, (e) => e.message)`);
  check('Ungueltige Kennung wird abgelehnt', /Ungültig/.test(String(bogus)), String(bogus));
  const ev2 = await ev(`(() => { const seen = []; const off = window.jc.onPlayerActive((on) => seen.push(on)); window.JCWeb.playerActive(true); off(); window.JCWeb.playerActive(false); return seen; })()`);
  check('Ereignisse des Gehaeuses erreichen die Oberflaeche (und lassen sich abbestellen)', JSON.stringify(ev2) === '[true]', JSON.stringify(ev2));
  const ext = await ev(`window.jc.openExternal('file:///C:/x').then(() => 'ok', (e) => e.message)`);
  check('Nur http(s)-Links werden geoeffnet', /http/.test(String(ext)), String(ext));

  // ---------- Breites Fenster: Desktop-Layout, keine Tab-Leiste ----------
  const wide = await ev(`(() => ({ compact: document.documentElement.dataset.compact, tabbar: getComputedStyle(document.querySelector('.tabbar')).display, pill: getComputedStyle(document.querySelector('.navpill')).display, sb: getComputedStyle(document.querySelector('#view')).scrollbarWidth }))()`);
  check('Breites Fenster (1280): keine kompakte Ansicht, Navigationskapsel statt Tab-Leiste, auch hier kein Scrollbalken', wide.compact === 'off' && wide.tabbar === 'none' && wide.pill !== 'none' && wide.sb === 'none', JSON.stringify(wide));

  // ---------- Handy-Format (kompakte Ansicht) ----------
  const metrics = `(() => {
    const view = document.querySelector('#view');
    return Math.max(document.documentElement.scrollWidth - innerWidth, view.scrollWidth - view.clientWidth);
  })()`;
  win.setSize(390, 844);
  await ctx.wait(600);
  await page('#/home', `!!document.querySelector('.home .rows .row')`);
  await ctx.wait(1400);
  await shot('W-02-handy-start.png');
  const mob = await ev(`(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const view = document.querySelector('#view');
    const bar = r('.tabbar'), brand = r('.brand'), tools = r('.tools'), hero = r('.hero-slide.active .hero-content');
    const items = [...document.querySelectorAll('.tabbar-item')];
    return {
      compact: document.documentElement.dataset.compact, w: innerWidth, h: innerHeight,
      bar: bar ? { bottom: Math.round(bar.bottom), display: getComputedStyle(document.querySelector('.tabbar')).display } : null,
      tabs: items.map((a) => a.textContent.trim()), on: items.filter((a) => a.classList.contains('on')).map((a) => a.textContent.trim()),
      pill: getComputedStyle(document.querySelector('.navpill')).display,
      overlap: brand && tools ? brand.right > tools.left : null,
      gutter: view.offsetWidth - view.clientWidth, sbw: getComputedStyle(view).scrollbarWidth,
      heroRight: hero ? Math.round(hero.right) : null,
      overflow: ${metrics}
    };
  })()`);
  check('Schmales Fenster (390): kompakte Ansicht ist an', mob.compact === 'on' && mob.w <= 400, JSON.stringify({ c: mob.compact, w: mob.w }));
  check('Tab-Leiste sitzt unten (Start, Bibliotheken, Suche, Einstellungen), "Start" ist markiert', mob.bar?.display === 'flex' && Math.abs(mob.bar.bottom - mob.h) <= 1 && mob.tabs.length >= 4 && mob.on.length === 1 && mob.on[0] === mob.tabs[0], JSON.stringify({ bar: mob.bar, tabs: mob.tabs, on: mob.on }));
  check('Navigationskapsel weg, Marke und Werkzeuge ueberlappen nicht', mob.pill === 'none' && mob.overlap === false, `pill=${mob.pill} overlap=${mob.overlap}`);
  check('Kein Scrollbalken am Rand (kein reservierter Streifen, scrollbar-width none)', mob.gutter === 0 && mob.sbw === 'none', `gutter=${mob.gutter} sbw=${mob.sbw}`);
  check('Startseite: Banner-Text passt in die Breite, nichts ragt seitlich hinaus', mob.heroRight !== null && mob.heroRight <= mob.w && mob.overflow <= 1, `heroRight=${mob.heroRight} overflow=${mob.overflow}`);

  await page(`#/item/${show.Id}`, `document.querySelectorAll('.episodes .ep').length >= 3`);
  await ctx.wait(1300);
  await shot('W-03-handy-serie.png');
  const det = await ev(`(() => {
    const p = document.querySelector('.detail-poster').getBoundingClientRect();
    const title = document.querySelector('.detail-title, .detail-logo').getBoundingClientRect();
    const acts = [...document.querySelectorAll('.detail-actions .btn')].map((b) => b.getBoundingClientRect());
    return { posterBottom: Math.round(p.bottom), titleTop: Math.round(title.top), maxRight: Math.round(Math.max(...acts.map((a) => a.right))), w: innerWidth, thumb: Math.round(document.querySelector('.ep-thumb').getBoundingClientRect().width), overflow: ${metrics} };
  })()`);
  check('Serienseite: Poster steht ueber dem Titel, Knoepfe bleiben im Bild', det.posterBottom <= det.titleTop + 2 && det.maxRight <= det.w && det.overflow <= 1, JSON.stringify(det));
  check('Serienseite: Folgen-Vorschaubilder sind schmal genug fuer den Text daneben', det.thumb >= 100 && det.thumb <= 160, `thumb=${det.thumb}`);

  await page(`#/item/${movie.Id}`, `!!document.querySelector('.detail .detail-actions .btn')`);
  await ctx.wait(1300);
  await shot('W-04-handy-film.png');
  const libHref = await ev(`document.querySelector('.tabbar-item[href^="#/library/"]')?.getAttribute('href')`);
  check('Tab-Leiste fuehrt zu einer Bibliothek', typeof libHref === 'string' && libHref.length > 3, String(libHref));
  await page(libHref, `document.querySelectorAll('.library .card').length >= 3`);
  await ctx.wait(900);
  await shot('W-05-handy-bibliothek.png');
  const lib = await ev(`(() => {
    const cs = [...document.querySelectorAll('.library .card')];
    const top = cs[0].getBoundingClientRect().top;
    return { n: cs.length, perRow: cs.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 4).length, overflow: ${metrics} };
  })()`);
  check('Bibliothek: drei Spalten, kein seitlicher Ueberlauf', lib.perRow === Math.min(3, lib.n) && lib.overflow <= 1, JSON.stringify(lib));

  await page('#/search?q=Aurora', `document.querySelectorAll('.card').length >= 1`);
  await ctx.wait(700);
  await shot('W-06-handy-suche.png');
  // Einstellungen auf dem Handy: Liste nach Themen, ein Bereich mit "Zurueck" (keine Chip-Zeile oben)
  await page('#/settings', `!!document.querySelector('.settings-list .slist-row')`);
  await ctx.wait(700);
  await shot('W-07-handy-einstellungen.png');
  const list = await ev(`(() => ({ rows: [...document.querySelectorAll('.slist-row')].map((a) => a.getAttribute('href')), groups: [...document.querySelectorAll('.slist-group > h3')].map((x) => x.textContent), panel: !!document.querySelector('.settings-panel'), nav: !!document.querySelector('.settings-nav'), title: document.querySelector('.page-title')?.textContent, tab: document.querySelector('.tabbar-item.on')?.getAttribute('href'), overflow: ${metrics} }))()`);
  check('Einstellungen auf dem Handy: Liste nach Themen (4 Gruppen), jede Zeile fuehrt zu einem Bereich, keine Chip-Zeile, kein Bereich daneben, Tab markiert', list.groups.length === 4 && list.rows.length >= 7 && list.rows.includes('#/settings/account') && list.rows.includes('#/settings/about') && !list.rows.some((x) => /\/(video|audio|discord)$/.test(x)) && !list.panel && !list.nav && list.title === 'Einstellungen' && list.tab === '#/settings' && list.overflow <= 1, JSON.stringify(list));
  await page('#/settings/appearance', `!!document.querySelector('.settings-back')`);
  await ctx.wait(700);
  const area = await ev(`(() => ({ back: document.querySelector('.settings-back')?.getAttribute('href'), title: document.querySelector('.page-title')?.textContent, panel: !!document.querySelector('.settings-panel .settings-stack'), list: !!document.querySelector('.settings-list'), nav: !!document.querySelector('.settings-nav'), tab: document.querySelector('.tabbar-item.on')?.getAttribute('href'), overflow: ${metrics} }))()`);
  check('Bereich auf dem Handy: "Zurueck" zur Liste, Titel = Bereich, nur der Bereich, Tab markiert, kein Ueberlauf', area.back === '#/settings' && area.title === 'Erscheinungsbild' && area.panel && !area.list && !area.nav && area.tab === '#/settings' && area.overflow <= 1, JSON.stringify(area));
  check('Desktop-Bereich per Adresse (Discord) auf dem Handy: es erscheint die Liste', (await page('#/settings/discord', `!!document.querySelector('.settings-list .slist-row')`)) && (await ev(`!document.querySelector('.settings-panel')`)) === true);

  // Wieder breit: alles wie vorher
  win.setSize(1280, 800);
  await ctx.wait(700);
  const back = await ev(`(() => ({ compact: document.documentElement.dataset.compact, tabbar: getComputedStyle(document.querySelector('.tabbar')).display, pill: getComputedStyle(document.querySelector('.navpill')).display, sb: getComputedStyle(document.querySelector('#view')).scrollbarWidth }))()`);
  check('Wieder auf 1280: Desktop-Layout (Kapsel statt Tab-Leiste), weiterhin kein Scrollbalken', back.compact === 'off' && back.tabbar === 'none' && back.pill !== 'none' && back.sb === 'none', JSON.stringify(back));
  win.setSize(390, 844);
  await ctx.wait(600);

  // ---------- Abmelden ----------
  const out1 = await ev(`window.jc.logout().then((s) => ({ loggedIn: s.loggedIn, servers: s.servers.length }))`);
  check('Abmelden: kein Konto mehr', out1.loggedIn === false && out1.servers === 0, JSON.stringify(out1));
  await ev(`document.dispatchEvent(new CustomEvent('relogin'))`);
  check('Anmeldeseite im schmalen Fenster: Karte liegt ganz im Bild', await waitFor(`(() => { const c = document.querySelector('.login-card')?.getBoundingClientRect(); return !!c && c.left >= 0 && c.right <= innerWidth && c.width > 250; })()`, 6000));
  await ctx.wait(900);
  await shot('W-08-handy-anmeldung.png');

  // ---------- gebauter Ordner (www): das, was eine Handy-Huelle einbindet ----------
  const www = path.join(require('node:os').tmpdir(), `jc-www-${process.pid}`);
  require('../build-web').buildWeb(www);
  await win.loadFile(path.join(www, 'index.html'));
  await ctx.wait(800);
  check('Gebaute Fassung (www): startet ohne Electron, Anmeldeseite erscheint', (await ev(`window.jc?.web === true`)) === true && (await waitFor(`!!document.querySelector('input[type=password]') || !!document.querySelector('.login')`)));
  check('Gebaute Fassung enthaelt nichts vom Desktop-Programm (kein main, preload, player)', !require('node:fs').existsSync(path.join(www, 'main')) && !require('node:fs').existsSync(path.join(www, 'player')) && !require('node:fs').existsSync(path.join(www, 'preload')));
  require('node:fs').rmSync(www, { recursive: true, force: true });

  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
  win.destroy();
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
