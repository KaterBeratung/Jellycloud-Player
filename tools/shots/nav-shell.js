// Navigation und Huelle (P9, nach MainTab, LibraryTab und dem Profilmenue der Apple-App), mit dem Mock-Server auf Port 8994:
//  - immer fuenf Reiter (Start, Filme, Serien, Anfragen, Suche), gleich breit mit und ohne Seerr; rechts Neu laden, Verwaltung, Einstellungen, Profilsymbol
//  - Strg+1 bis Strg+5; der gewaehlte Reiter bleibt auf einer Detailseite gewaehlt; ein Klick auf den gewaehlten Reiter fuehrt an den Anfang
//  - Filme/Serien ueber alle Bibliotheken der Art mit Bibliothekswahl (Kollektionen unter Filme), Ambient Glow je Reiter
//  - Anfragen ohne Seerr: Hinweis mit "Seerr verbinden"; mit Seerr kein Hinweis zum Verbinden
//  - Profilmenue: Profile mit Haken und "Aktiv · Adresse", Quick Connect, Hinzufuegen, Einstellungen, Abmelden (rot, mit Rueckfrage)
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/nav-shell.js
const path = require('node:path');
const crypto = require('node:crypto');
const { server, state, add, MOVIES_VIEW } = require('../mock-server');

module.exports = async (ctx) => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) consoleErrors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const PORT = 8994;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  // Eine zweite Film-Bibliothek und Kollektionen: die Wahl der Bibliothek im Reiter Filme
  const hex = (s) => crypto.createHash('md5').update(s).digest('hex');
  const SHORTS = add({ Id: hex('view-shorts'), Name: 'Kurzfilme', Type: 'CollectionFolder', CollectionType: 'movies', ImageTags: {} });
  const BOXES = add({ Id: hex('view-boxsets'), Name: 'Sammlungen', Type: 'CollectionFolder', CollectionType: 'boxsets', ImageTags: {} });
  for (let i = 1; i <= 4; i++) add({ Id: hex(`short:${i}`), Name: `Kurzfilm ${i}`, Type: 'Movie', ParentId: SHORTS.Id, ProductionYear: 2020 + i, DateCreated: new Date().toISOString(), ImageTags: {}, Genres: ['Drama'], RunTimeTicks: 6e9 }, SHORTS.Id);
  for (let i = 1; i <= 2; i++) add({ Id: hex(`box:${i}`), Name: `Reihe ${i}`, Type: 'BoxSet', ParentId: BOXES.Id, ImageTags: {}, DateCreated: new Date().toISOString() }, BOXES.Id);
  state.extraViews.push(SHORTS, BOXES);

  ctx.win.setContentSize(1280, 860);
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 9000);
    await ctx.wait(400);
  };
  const key = (k, mods = { ctrlKey: true }) => ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} }))`);
  const SHELL = `(() => {
    const links = [...document.querySelectorAll('.navpill .nav-link')];
    const pill = document.querySelector('.navpill').getBoundingClientRect();
    return { tabs: links.map((a) => a.textContent), hrefs: links.map((a) => a.getAttribute('href')), on: links.filter((a) => a.classList.contains('on')).map((a) => a.textContent),
      pillW: Math.round(pill.width), tools: [...document.querySelectorAll('.toolpill > *')].map((x) => x.getAttribute('href') || x.getAttribute('aria-label')),
      sizes: [...document.querySelectorAll('.toolpill > *')].map((x) => Math.round(x.getBoundingClientRect().width)), glow: document.querySelector('#glow')?.dataset.scope, hash: location.hash };
  })()`;

  // ---------- Kopfzeile ----------
  await waitFor(`document.querySelectorAll('.navpill .nav-link').length === 5`, 8000);
  const s0 = await ctx.run(SHELL);
  check('Fuenf Reiter in fester Reihenfolge: Start, Filme, Serien, Anfragen, Suche; Start gewaehlt', JSON.stringify(s0.tabs) === JSON.stringify(['Start', 'Filme', 'Serien', 'Anfragen', 'Suche']) && JSON.stringify(s0.hrefs) === JSON.stringify(['#/home', '#/movies', '#/shows', '#/requests', '#/search']) && JSON.stringify(s0.on) === '["Start"]', JSON.stringify(s0));
  check('Rechts (E9): Neu laden, Einstellungen, Profilsymbol, gleich grosse Scheiben; keine Bibliotheken und keine Lupe mehr', JSON.stringify(s0.tools) === JSON.stringify(['Neu laden', '#/settings', 'Profil']) && new Set(s0.sizes).size === 1, JSON.stringify(s0));
  await ctx.capture(path.join(out, 'NAV-01-kopfzeile.png'));

  // ---------- Strg+1 bis Strg+5 ----------
  const keyed = [];
  for (const [k, hash] of [['2', '#/movies'], ['3', '#/shows'], ['4', '#/requests'], ['5', '#/search'], ['1', '#/home']]) {
    await key(k);
    keyed.push((await waitFor(`location.hash.startsWith(${JSON.stringify(hash)}) && document.querySelector('.navpill .nav-link.on')?.getAttribute('href') === ${JSON.stringify(hash)}`, 4000)) ? 'ok' : `${k}: ${await ctx.run('location.hash')}`);
  }
  check('Strg+1 bis Strg+5 waehlen die Reiter und markieren sie', keyed.every((x) => x === 'ok'), keyed.join(', '));

  // ---------- Filme: Bibliothekswahl, Kollektionen, Glow ----------
  await go('#/movies', `document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 0`);
  const movies = await ctx.run(`(() => ({ title: document.querySelector('.library .lib-title h1')?.textContent, sw: document.querySelector('.library .lib-switch-btn')?.textContent.trim(), glow: document.querySelector('#glow')?.dataset.scope, cards: document.querySelectorAll('.library .grid .card:not(.sk-card)').length }))()`);
  check('Reiter Filme: Titel "Filme", Wahl der Bibliothek neben dem Titel (die erste gewaehlt), Ambient Glow Filme', movies.title === 'Filme' && movies.sw === MOVIES_VIEW.Name && movies.glow === 'movies' && movies.cards > 4, JSON.stringify(movies));
  await ctx.run(`document.querySelector('.library .lib-switch-btn').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  const libMenu = await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].map((b) => (b.classList.contains('selected') ? '*' : '') + b.textContent.trim())`);
  check('Die Wahl zeigt alle Film-Bibliotheken, Kollektionen zuletzt, die gewaehlte mit Haken', JSON.stringify(libMenu) === JSON.stringify([`*${MOVIES_VIEW.Name}`, 'Kurzfilme', 'Kollektionen']), JSON.stringify(libMenu));
  await ctx.capture(path.join(out, 'NAV-02-bibliothekswahl.png'));
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Kurzfilme')).click()`);
  const shorts = await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 4 && [...document.querySelectorAll('.library .grid .card')].every((c) => /Kurzfilm/.test(c.textContent))`, 6000);
  check('Kurzfilme gewaehlt: das Raster zeigt nur sie, der Knopf nennt sie, Titel bleibt "Filme"', shorts && (await ctx.run(`document.querySelector('.library .lib-switch-btn').textContent.trim() === 'Kurzfilme' && document.querySelector('.library .lib-title h1').textContent === 'Filme'`)));
  await ctx.run(`document.querySelector('.library .lib-switch-btn').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Kollektionen')).click()`);
  const boxes = await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 2`, 6000);
  check('Kollektionen unter Filme: Titel "Kollektionen", Glow bleibt Filme', boxes && (await ctx.run(`document.querySelector('.library .lib-title h1').textContent === 'Kollektionen' && document.querySelector('#glow').dataset.scope === 'movies'`)));
  // Die Wahl gilt beim naechsten Oeffnen weiter
  await go('#/home', `!!document.querySelector('.home')`);
  await go('#/movies', `document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 0`);
  await ctx.run(`document.querySelector('.library .lib-switch-btn').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes(${JSON.stringify(MOVIES_VIEW.Name)})).click()`);
  await waitFor(`document.querySelector('.library .lib-switch-btn')?.textContent.trim() === ${JSON.stringify(MOVIES_VIEW.Name)} && document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 4`, 6000);

  // Detailseite: der Reiter Filme bleibt gewaehlt; ein Klick auf ihn fuehrt zurueck zum Raster
  const cardHref = await ctx.run(`document.querySelector('.library .grid a.card, .library .grid .card a')?.getAttribute('href')`);
  await go(cardHref, `!!document.querySelector('.detail')`);
  check('Detailseite aus Filme: der Reiter Filme bleibt gewaehlt', (await ctx.run(SHELL)).on.join() === 'Filme', JSON.stringify((await ctx.run(SHELL)).on));
  // ---------- Serien ----------
  await go('#/shows', `document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 0`);
  const shows = await ctx.run(`(() => ({ title: document.querySelector('.library .lib-title h1')?.textContent, sw: !!document.querySelector('.library .lib-switch-btn'), glow: document.querySelector('#glow')?.dataset.scope, on: document.querySelector('.navpill .nav-link.on')?.textContent }))()`);
  check('Reiter Serien: Titel "Serien", eine Bibliothek ohne Wahl, Glow Serien, Serien gewaehlt', shows.title === 'Serien' && !shows.sw && shows.glow === 'series' && shows.on === 'Serien', JSON.stringify(shows));
  // Klick auf den gewaehlten Reiter: an den Anfang der Seite
  await ctx.run(`document.querySelector('#view').scrollTo({ top: 600 })`);
  await ctx.wait(300);
  await ctx.run(`document.querySelector('.navpill .nav-link.on').click()`);
  check('Klick auf den gewaehlten Reiter fuehrt an den Anfang der Seite', await waitFor(`document.querySelector('#view').scrollTop === 0`, 3000), String(await ctx.run(`document.querySelector('#view').scrollTop`)));
  // Mediathek von der Startseite ("Neu in ..."): eigener Name, Glow Mediatheken
  await go(`#/library/${MOVIES_VIEW.Id}`, `document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 0`);
  check('Mediathek von der Startseite geoeffnet: ihr Name, keine Wahl, Ambient Glow der Mediatheken', await ctx.run(`document.querySelector('.library .lib-title h1').textContent === ${JSON.stringify(MOVIES_VIEW.Name)} && !document.querySelector('.library .lib-switch-btn') && document.querySelector('#glow').dataset.scope === 'libraries'`));

  // ---------- Anfragen ohne und mit Seerr ----------
  const pillBefore = (await ctx.run(SHELL)).pillW;
  await go('#/requests', `!!document.querySelector('.requests .page-status')`);
  const req = await ctx.run(`(() => { const st = document.querySelector('.requests .page-status'); return { title: st?.querySelector('h3')?.textContent, btn: st?.querySelector('.ps-action .btn')?.textContent, href: st?.querySelector('.ps-action .btn')?.getAttribute('href'), glow: document.querySelector('#glow')?.dataset.scope, head: document.querySelector('.requests .lib-title h1')?.textContent, headTop: Math.round(document.querySelector('.requests .lib-title h1').getBoundingClientRect().top), barBottom: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom), libTop: null }; })()`);
  check('Anfragen ohne Seerr: "Seerr nicht verbunden" mit "Seerr verbinden" (fuehrt in die Einstellungen), Glow Anfragen', req.title === 'Seerr nicht verbunden' && req.btn === 'Seerr verbinden' && req.href === '#/settings/seerr' && req.glow === 'requests' && req.head === 'Anfragen', JSON.stringify(req));
  check('...die Ueberschrift steht unter der Kopfzeile (wie bei Filme und Serien)', req.headTop >= req.barBottom, `${req.headTop} / ${req.barBottom}`);
  await ctx.capture(path.join(out, 'NAV-03-anfragen-ohne-seerr.png'));
  await ctx.run(`window.jc.seerrConnect({ url: 'http://127.0.0.1:${PORT}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`document.querySelectorAll('.navpill .nav-link').length === 5 && !!document.querySelector('.requests .page-status')`, 8000);
  await ctx.wait(600);
  const withSeerr = await ctx.run(`({ title: document.querySelector('.requests .page-status h3')?.textContent, pill: Math.round(document.querySelector('.navpill').getBoundingClientRect().width), tabs: document.querySelectorAll('.navpill .nav-link').length })`);
  check('Mit Seerr: kein Hinweis zum Verbinden; die Leiste bleibt bei fuenf Reitern und aendert ihre Breite nicht', withSeerr.title !== 'Seerr nicht verbunden' && withSeerr.tabs === 5 && withSeerr.pill === pillBefore, JSON.stringify({ ...withSeerr, pillBefore }));

  // ---------- Profilmenue ----------
  await go('#/home', `!!document.querySelector('.home')`);
  await ctx.run(`document.querySelector('.toolpill .who').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.wait(250);
  const menu = await ctx.run(`(() => { const m = document.querySelector('.menu'); return { head: m.querySelector('.menu-head')?.textContent, items: [...m.querySelectorAll('.menu-item')].map((b) => ({ t: b.querySelector('.lbl').textContent, sub: b.querySelector('.sub')?.textContent ?? '', sel: b.classList.contains('selected'), danger: b.classList.contains('danger'), ico: !!b.querySelector('.check .ico') })), seps: m.querySelectorAll('.menu-sep').length, right: Math.round(m.getBoundingClientRect().right), whoRight: Math.round(document.querySelector('.toolpill .who').getBoundingClientRect().right), multi: m.classList.contains('multi') }; })()`);
  const labels = menu.items.map((i) => i.t);
  check('Profilmenue: Abschnitt Profile, das aktive mit Haken und "Aktiv · Adresse"', menu.head === 'Profile' && menu.items[0].sel && /^Aktiv · http:\/\/127\.0\.0\.1:8994$/.test(menu.items[0].sub), JSON.stringify(menu.items[0]));
  check('...dann Quick Connect, Server oder Profil hinzufuegen, Einstellungen, zuletzt Abmelden in Rot; Symbole in der Spalte des Hakens, eine Spalte', JSON.stringify(labels.slice(1)) === JSON.stringify(['Quick Connect', 'Server oder Profil hinzufügen', 'Einstellungen', 'Abmelden']) && menu.items.slice(1).every((i) => i.ico) && menu.items.at(-1).danger && menu.seps === 2 && !menu.multi, JSON.stringify(menu));
  check('...rechtsbuendig am Profilsymbol', Math.abs(menu.right - menu.whoRight) <= 2, `${menu.right} / ${menu.whoRight}`);
  await ctx.capture(path.join(out, 'NAV-04-profilmenue.png'));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  check('Escape schliesst das Menue', await waitFor(`!document.querySelector('.menu')`, 2000));
  // Einstellungen
  await ctx.run(`document.querySelector('.toolpill .who').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Einstellungen/.test(b.textContent)).click()`);
  check('"Einstellungen" oeffnet die Einstellungen; der Reiter Start bleibt gewaehlt', await waitFor(`location.hash.startsWith('#/settings') && !!document.querySelector('.settings')`, 4000) && (await ctx.run(`document.querySelector('.navpill .nav-link.on')?.textContent === 'Start'`)));
  // Quick Connect
  await ctx.run(`document.querySelector('.toolpill .who').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Quick Connect/.test(b.textContent)).click()`);
  check('"Quick Connect" oeffnet die Maske fuer andere Geraete', await waitFor(`!!document.querySelector('.connect-overlay .qc-input')`, 5000));
  await ctx.run(`document.querySelector('.connect-overlay .connect-cancel').click()`);
  await waitFor(`!document.querySelector('.connect-overlay')`, 3000);
  // Abmelden fragt nach; Abbrechen laesst alles
  await ctx.run(`document.querySelector('.toolpill .who').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].find((b) => /Abmelden/.test(b.textContent)).click()`);
  check('"Abmelden" fragt nach', await waitFor(`/Abmelden\\?/.test(document.querySelector('.mdl')?.textContent ?? '')`, 3000));
  await ctx.run(`[...document.querySelectorAll('.mdl .btn')].find((b) => b.textContent === 'Abbrechen').click()`);
  await ctx.wait(400);
  check('...Abbrechen: weiter angemeldet', await ctx.run(`!document.querySelector('.login') && !!document.querySelector('.navpill')`));
  // Zweites Profil (dieselbe Anmeldung unter localhost) und Wechsel ueber das Menue
  await ctx.run(`window.jc.login({ url: 'http://localhost:${PORT}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`document.querySelectorAll('.navpill .nav-link').length === 5`, 8000);
  await ctx.wait(800);
  await ctx.run(`document.querySelector('.toolpill .who').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 2000);
  const two = await ctx.run(`[...document.querySelectorAll('.menu .menu-item')].slice(0, 2).map((b) => ({ sel: b.classList.contains('selected'), sub: b.querySelector('.sub')?.textContent }))`);
  check('Zwei Profile: das aktive (localhost) mit Haken, das andere mit seiner Adresse', two.length === 2 && two[1].sel && /^Aktiv · http:\/\/localhost/.test(two[1].sub) && !two[0].sel && two[0].sub === 'http://127.0.0.1:8994', JSON.stringify(two));
  await ctx.run(`document.querySelectorAll('.menu .menu-item')[0].click()`);
  check('Ein Tipp auf das andere Profil wechselt zu ihm', await waitFor(`!!document.querySelector('.navpill')`, 6000) && (await (async () => { const end = Date.now() + 6000; while (Date.now() < end) { if (ctx.config.data.servers.find((s) => s.id === ctx.config.data.activeServerId)?.url === 'http://127.0.0.1:8994') return true; await ctx.wait(80); } return false; })()));

  console.log('Konsolenfehler:', consoleErrors.length ? `\n${consoleErrors.join('\n')}` : 'keine');
  console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`);
  if (fail) process.exitCode = 1;
  state.extraViews.length = 0;
  server.close();
};
