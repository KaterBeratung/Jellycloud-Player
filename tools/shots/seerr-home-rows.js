// Neue Seerr-Reihen der Startseite (Apple-App Build 94/95), mit dem Mock-Server auf eigenem Port:
//  - "Meine Anfragen" (mit Stand als Tag), "Merkliste", "Beliebte Filme/Serien", "Demnächst: Filme/Serien" in der Standardreihenfolge der Apple-App
//  - eine ausgeblendete Reihe fragt Seerr nicht ab; ohne Seerr keine dieser Reihen
//  - Titel "Beliebte Filme" -> ganze Liste mit Genre-Wahl (Genre schraenkt ein, Nachladen beim Scrollen)
//  - Seite eines Seerr-Titels: "Merken"/"Gemerkt" (Merkliste bei Seerr), ohne Feld von Seerr kein Knopf; "Mediathek" bei vorhandenen Titeln
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/seerr-home-rows.js
const path = require('node:path');
const { server, SEERR } = require('../mock-server');

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
  const PORT = 8961;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const debug = (q) => fetch(`${BASE}/__debug/${q}`, { method: 'POST' }).then((r) => r.json());
  const waitFor = async (js, ms = 9000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const relogin = async () => {
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await waitFor(`!!document.querySelector('.topbar')`);
    await ctx.wait(800);
  };
  ctx.win.setContentSize(1280, 860);
  await debug('requests?count=3&open=1'); // drei eigene Anfragen, eine wartet
  SEERR.watchlist = [{ tmdbId: 1399, mediaType: 'tv', title: 'Mock Thrones' }];
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' }))`);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
  await relogin();

  const ROWS = ['Meine Anfragen', 'Merkliste', 'Beliebte Filme', 'Beliebte Serien', 'Demnächst: Filme', 'Demnächst: Serien'];
  const titles = () => ctx.run(`[...document.querySelectorAll('.rows > section.row')].map((s) => s.querySelector('.row-head h2')?.textContent)`);
  await waitFor(`${JSON.stringify(ROWS)}.every((n) => [...document.querySelectorAll('.rows .row-head h2')].some((h) => h.textContent === n))`, 12000);
  const shown = await titles();
  check('Alle neuen Reihen da', ROWS.every((n) => shown.includes(n)), JSON.stringify(shown));
  const at = (n) => shown.indexOf(n);
  check('Reihenfolge wie die Apple-App: Anfragen und Merkliste vor den Neuzugaengen, Entdecken ganz unten', at('Meine Anfragen') < at('Merkliste') && shown.findIndex((x) => /^Neu in/.test(x ?? '')) > at('Merkliste') && at('Beliebte Filme') > shown.findIndex((x) => /^Neu in/.test(x ?? '')) && at('Demnächst: Serien') === shown.length - 1, JSON.stringify(shown));
  const mine = await ctx.run(`(() => { const s = [...document.querySelectorAll('.rows > section.row')].find((x) => x.querySelector('h2')?.textContent === 'Meine Anfragen'); return [...s.querySelectorAll('.card')].map((c) => ({ tag: c.querySelector('.req-status .tag')?.textContent ?? '', title: c.querySelector('.l1')?.textContent })); })()`);
  check('Meine Anfragen: je Anfrage ein Plakat mit Stand als Tag', mine.length === 3 && mine.every((c) => c.tag && c.title), JSON.stringify(mine));
  const watch = await ctx.run(`(() => { const s = [...document.querySelectorAll('.rows > section.row')].find((x) => x.querySelector('h2')?.textContent === 'Merkliste'); return [...s.querySelectorAll('.card .l1')].map((c) => c.textContent); })()`);
  check('Merkliste: der gemerkte Titel', JSON.stringify(watch) === JSON.stringify(['Mock Thrones']), JSON.stringify(watch));
  const links = await ctx.run(`[...document.querySelectorAll('.rows .row-head a.row-title')].map((a) => [a.querySelector('h2').textContent, a.getAttribute('href')])`);
  check('Titel von "Beliebte Filme/Serien" fuehren zur ganzen Liste, die kommenden nicht', links.some(([n, href]) => n === 'Beliebte Filme' && href === '#/discover/movie') && links.some(([n, href]) => n === 'Beliebte Serien' && href === '#/discover/tv') && !links.some(([n]) => /^Demnächst/.test(n)), JSON.stringify(links));
  await ctx.capture(path.join(out, 'SH-home.png'));
  await ctx.run(`(() => { const s = [...document.querySelectorAll('.rows > section.row')].find((x) => x.querySelector('h2')?.textContent === 'Meine Anfragen'); s.scrollIntoView({ block: 'center' }); })()`);
  await ctx.wait(600);
  await ctx.capture(path.join(out, 'SH-my-requests.png'));

  // ---------- Ausgeblendet: keine Abfrage ----------
  await ctx.run(`window.jc.setSettings({ home: { hidden: ['seerrUpcomingSeries'] } })`);
  SEERR.discoverLog = [];
  await ctx.run(`document.dispatchEvent(new CustomEvent('seerr-changed'))`); // Zwischenspeicher der Reihen leeren
  await relogin();
  await waitFor(`[...document.querySelectorAll('.rows .row-head h2')].some((h) => h.textContent === 'Beliebte Filme')`, 10000);
  await ctx.wait(800);
  const asked = SEERR.discoverLog.map((d) => d.path);
  check('Ausgeblendete Reihe fragt Seerr nicht ab', !asked.includes('/discover/tv/upcoming') && asked.includes('/discover/movies'), JSON.stringify(asked));
  await ctx.run(`window.jc.setSettings({ home: { hidden: [] } })`);

  // ---------- Ganze Liste mit Genre ----------
  SEERR.discoverExtra = 45; // genug fuer mehrere Seiten
  SEERR.discoverLog = [];
  await ctx.run(`document.querySelector('.rows a.row-title[href="#/discover/movie"]').click()`);
  const grid = await waitFor(`location.hash === '#/discover/movie' && document.querySelectorAll('.discover .grid .card').length > 0`, 9000);
  const first = await ctx.run(`({ title: document.querySelector('.discover h1')?.textContent, cards: document.querySelectorAll('.discover .grid .card').length })`);
  check('Seite "Beliebte Filme": Raster mit Titeln', grid && first.title === 'Beliebte Filme' && first.cards >= 15, JSON.stringify(first)); // Seite 1: 20 Titel, gesperrte fallen weg
  // Wie ein Nutzer: ans Ende scrollen, bis die naechste Seite da ist (unter Last kommt das erste Scrollen manchmal vor dem Ende der ersten Seite)
  let more = false;
  for (let i = 0; i < 6 && !more; i++) {
    await ctx.run(`document.getElementById('view').scrollTo({ top: 1e6 })`);
    more = await waitFor(`document.querySelectorAll('.discover .grid .card').length > ${first.cards}`, 1500);
  }
  check('Nachladen beim Scrollen (Seite 2)', more && SEERR.discoverLog.some((d) => d.page === 2), JSON.stringify(SEERR.discoverLog));
  await ctx.run(`document.querySelector('.discover [data-action="genre"]').click()`);
  await waitFor(`!!document.querySelector('.menu.open')`, 4000);
  const menu = await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].map((x) => x.textContent.trim())`);
  check('Genre-Menue: "Alle Genres", dann Action und Drama (leere Namen fallen weg)', menu.length === 3 && /Action/.test(menu[1]) && /Drama/.test(menu[2]), JSON.stringify(menu));
  await ctx.run(`[...document.querySelectorAll('.menu.open .menu-item')].find((x) => /Action/.test(x.textContent)).click()`);
  await waitFor(`document.querySelector('.discover [data-action="genre"]')?.textContent.includes('Action')`, 4000);
  await ctx.wait(1200);
  const action = SEERR.discoverLog.at(-1);
  const ids = await ctx.run(`[...document.querySelectorAll('.discover .grid .card .l1')].map((x) => x.textContent)`);
  check('Genre gewaehlt: Abfrage mit genre=28, Liste neu', action?.genre === 28 && action.page === 1 && ids.length > 0, JSON.stringify({ action, n: ids.length }));
  await ctx.capture(path.join(out, 'SH-discover.png'));

  // ---------- Merken auf der Seite eines Seerr-Titels ----------
  await ctx.run(`location.hash = '#/seerr/movie/603'`);
  const hasBtn = await waitFor(`!!document.querySelector('[data-action="watchlist"]')`, 9000);
  const b0 = await ctx.run(`({ text: document.querySelector('[data-action="watchlist"]').textContent, pressed: document.querySelector('[data-action="watchlist"]').getAttribute('aria-pressed') })`);
  check('Seerr-Titel: Knopf "Merken"', hasBtn && b0.text === 'Merken' && b0.pressed === 'false', JSON.stringify(b0));
  await ctx.run(`document.querySelector('[data-action="watchlist"]').click()`);
  await waitFor(`document.querySelector('[data-action="watchlist"]')?.textContent === 'Gemerkt' && !document.querySelector('[data-action="watchlist"]').disabled`, 6000);
  check('Merken: Knopf "Gemerkt", bei Seerr gemerkt', SEERR.watchlist.some((w) => w.tmdbId === 603 && w.mediaType === 'movie'), JSON.stringify(SEERR.watchlist));
  await ctx.capture(path.join(out, 'SH-watchlist-button.png'));
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`(() => { const s = [...document.querySelectorAll('.rows > section.row')].find((x) => x.querySelector('h2')?.textContent === 'Merkliste'); return !!s && [...s.querySelectorAll('.l1')].some((x) => x.textContent === 'Mock Matrix Resurrection'); })()`, 9000);
  check('Startseite zeigt den gemerkten Titel in der Merkliste', await ctx.run(`(() => { const s = [...document.querySelectorAll('.rows > section.row')].find((x) => x.querySelector('h2')?.textContent === 'Merkliste'); return !!s && [...s.querySelectorAll('.l1')].map((x) => x.textContent).join('|'); })()`) === 'Mock Matrix Resurrection|Mock Thrones');
  await ctx.run(`location.hash = '#/seerr/movie/603'`);
  await waitFor(`document.querySelector('[data-action="watchlist"]')?.textContent === 'Gemerkt'`, 9000);
  await ctx.run(`document.querySelector('[data-action="watchlist"]').click()`);
  await waitFor(`document.querySelector('[data-action="watchlist"]')?.textContent === 'Merken' && !document.querySelector('[data-action="watchlist"]').disabled`, 6000);
  check('Entfernen: wieder "Merken", bei Seerr entfernt', !SEERR.watchlist.some((w) => w.tmdbId === 603));
  SEERR.noWatchlistField = true;
  await ctx.run(`location.hash = '#/seerr/tv/1399'`);
  await waitFor(`!!document.querySelector('.seerr-page .detail-title')?.textContent`, 9000);
  await ctx.wait(1200);
  check('Aeltere Seerr-Fassung (kein Feld): kein Knopf', !(await ctx.run(`!!document.querySelector('[data-action="watchlist"]')`)));
  SEERR.noWatchlistField = false;

  // ---------- Mediathek-Knopf ----------
  await ctx.run(`location.hash = '#/seerr/movie/4242'`);
  const lib = await waitFor(`!!document.querySelector('[data-action="open-library"]')`, 9000);
  const href = lib ? await ctx.run(`document.querySelector('[data-action="open-library"]').getAttribute('href')`) : null;
  check('Vorhandener Titel: Knopf "Mediathek" fuehrt zur Detailseite', lib && /^#\/item\//.test(href ?? ''), href);
  if (lib) {
    await ctx.run(`document.querySelector('[data-action="open-library"]').click()`);
    check('Klick oeffnet die Detailseite der Mediathek', await waitFor(`/^#\\/item\\//.test(location.hash) && !!document.querySelector('.detail-title')`, 8000));
  }

  // ---------- Ohne Seerr ----------
  await ctx.run(`window.jc.seerrDisconnect()`);
  await relogin();
  await waitFor(`document.querySelectorAll('.rows > section.row').length > 0`, 9000);
  await ctx.wait(1200);
  const without = await titles();
  check('Ohne Seerr keine dieser Reihen', !ROWS.some((n) => without.includes(n)), JSON.stringify(without));

  check('Keine Fehler in der Konsole', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
