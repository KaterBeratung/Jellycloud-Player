// Suche (P14, nach SearchView und SearchStatus der Apple-App), mit dem Mock-Server auf Port 8988:
//  - Hinweis ohne Treffer an einer Stelle entschieden: leeres Feld, "Laden" bis zur Antwort, "Keine Ergebnisse" nur fuer den beantworteten Text, Fehler
//  - 350 ms Ruhe vor der Suche (ein Wort tippen = eine Suche), Enter sofort, eine veraltete Antwort wird verworfen
//  - Treffer von Seerr unabhaengig darunter ("Nicht in der Bibliothek"): Abgleich ueber TMDB-Nummer und Art, teilweise vorhandene Serien bleiben; ein
//    Ausfall von Seerr ersetzt Treffer der Mediathek nie durch eine Fehlerseite; nach einer Anfrage nur Seerr neu
//  - zweiter Klick auf den Reiter "Suche" und Strg+K: Fokus ins Suchfeld, der Text bleibt
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/search-page.js
const path = require('node:path');
const { server, state, SEERR } = require('../mock-server');

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
  const PORT = 8988;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  ctx.win.setContentSize(1280, 860);
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(60);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 9000);
    await ctx.wait(300);
  };
  const type = (text) => ctx.run(`(() => { const i = document.querySelector('.search-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const enter = (text) => ctx.run(`(() => { const i = document.querySelector('.search-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  const status = () => ctx.run(`(() => { const s = document.querySelector('.search-results .page-status'); return s ? { kind: s.dataset.kind, title: s.querySelector('h3')?.textContent ?? '', btn: s.querySelector('.ps-action .btn')?.textContent ?? '' } : null; })()`);
  const searches = () => state.log.filter((l) => l.at === '/Items search').map((l) => l.term);
  const groups = () => ctx.run(`[...document.querySelectorAll('.search-results .search-group')].map((g) => g.querySelector('h2').textContent + ': ' + [...g.querySelectorAll('.card .l1')].map((x) => x.textContent).join(', '))`);
  const settled = `!document.querySelector('.search-results.busy') && !document.querySelector('.search-results .page-status[data-kind=loading]')`;
  const openSearch = async () => {
    await go('#/home', `!!document.querySelector('.home')`);
    await go('#/search', `!!document.querySelector('.search .search-input')`);
  };

  // ---------- Hinweis ohne Treffer ----------
  await openSearch();
  check('Leeres Feld: der Hinweis, was sich finden laesst; am Desktop steht der Fokus gleich im Suchfeld', (await status())?.title === 'Wonach suchst du?' && (await ctx.run(`document.activeElement === document.querySelector('.search-input')`)), JSON.stringify(await status()));
  state.log.length = 0;
  await type('a');
  await ctx.wait(60);
  await type('au');
  await ctx.wait(60);
  await type('aur');
  await ctx.wait(200);
  const early = searches();
  await waitFor(settled, 4000);
  await ctx.wait(300);
  check('350 ms Ruhe: waehrend des Tippens keine Suche, danach genau eine (fuer den ganzen Text)', early.length === 0 && JSON.stringify(searches()) === JSON.stringify(['aur']), `${JSON.stringify(early)} -> ${JSON.stringify(searches())}`);
  await enter('zzqq');
  await waitFor(`/Keine Ergebnisse/.test(document.querySelector('.search-results .page-status h3')?.textContent ?? '')`, 4000);
  check('Beantwortet ohne Treffer: "Keine Ergebnisse" fuer genau diesen Text', (await status())?.title === 'Keine Ergebnisse für „zzqq“', JSON.stringify(await status()));
  await ctx.capture(path.join(out, 'SP-01-keine-ergebnisse.png'));
  await type('zzqqx');
  const typing = await status();
  check('Weitergetippt: sofort "Laden", nicht "Keine Ergebnisse" zum alten oder zum neuen Text', typing?.kind === 'loading' && !/Keine Ergebnisse/.test(typing?.title ?? ''), JSON.stringify(typing));
  await waitFor(`(document.querySelector('.search-results .page-status h3')?.textContent ?? '') === 'Keine Ergebnisse für „zzqqx“'`, 4000);
  check('...nach der Antwort "Keine Ergebnisse" fuer den neuen Text', (await status())?.title === 'Keine Ergebnisse für „zzqqx“', JSON.stringify(await status()));

  // ---------- Veraltete Antwort ----------
  state.delays.items = 500;
  state.log.length = 0;
  await enter('pa');
  await ctx.wait(120);
  await enter('aurora');
  await ctx.wait(1700);
  state.delays.items = 0;
  const g1 = await groups();
  check('Zwei Suchen kurz nacheinander: nur die Antwort zum aktuellen Text steht da (die zu "pa" wird verworfen)', JSON.stringify(searches()) === JSON.stringify(['pa', 'aurora']) && g1.length >= 1 && g1.every((x) => !/Paper Moons/.test(x)) && g1.some((x) => /Aurora/.test(x)) && (await ctx.run(`location.hash`)) === '#/search?q=aurora', JSON.stringify(g1));

  // ---------- Fehler der Mediathek ohne Treffer von Seerr ----------
  state.faults.lists = { how: '500', left: 1 };
  await enter('zzqq');
  await waitFor(`document.querySelector('.search-results .page-status')?.dataset.kind === 'failed'`, 4000);
  const failed = await status();
  check('Mediathek antwortet nicht (ohne Seerr): Fehler fuer die ganze Seite mit "Erneut versuchen"', failed?.kind === 'failed' && failed.btn === 'Erneut versuchen', JSON.stringify(failed));
  await ctx.run(`document.querySelector('.search-results .page-status .ps-action .btn').click()`);
  check('"Erneut versuchen" sucht noch einmal: jetzt "Keine Ergebnisse"', await waitFor(`/Keine Ergebnisse/.test(document.querySelector('.search-results .page-status h3')?.textContent ?? '')`, 4000));

  // ---------- Mit Seerr: Abgleich ----------
  SEERR.permissions = 32;
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`, 6000);
  await ctx.wait(1500);
  await openSearch();
  await enter('glass');
  await waitFor(`!!document.querySelector('.seerr-group')`, 6000);
  await waitFor(settled, 4000);
  const glass = await groups();
  check('Treffer der Mediathek zuerst, darunter "Nicht in der Bibliothek" mit "Über Seerr anfragen"', glass[0] === 'Filme: The Glass Garden' && (await ctx.run(`document.querySelector('.seerr-group h2').textContent + ' | ' + document.querySelector('.seerr-group .search-group-note').textContent`)) === 'Nicht in der Bibliothek | Über Seerr anfragen', JSON.stringify(glass));
  check('Abgleich ueber TMDB-Nummer und Art: der Film der Mediathek fehlt bei Seerr (obwohl Seerr ihn nicht als vorhanden kennt), die Serie mit derselben Nummer steht da', glass[1] === 'Nicht in der Bibliothek: The Glass Garden: Die Serie', JSON.stringify(glass));
  await ctx.capture(path.join(out, 'SP-02-abgleich.png'));
  await enter('wild');
  await waitFor(`!!document.querySelector('.seerr-group')`, 6000);
  await waitFor(settled, 4000);
  const wild = await groups();
  const partialTag = await ctx.run(`document.querySelector('.seerr-group .req-card .req-status .tag')?.textContent ?? ''`);
  check('Teilweise vorhandene Serie bleibt anfragbar (unter den Serien der Mediathek und darunter bei Seerr), mit ihrem Stand', wild.includes('Serien: Code of the Wild') && wild.at(-1) === 'Nicht in der Bibliothek: Code of the Wild' && !!partialTag, `${JSON.stringify(wild.map((x) => x.slice(0, 60)))} | ${partialTag}`);

  // ---------- Ausfaelle ----------
  SEERR.mode = 'down';
  await enter('aurora');
  await waitFor(`!!document.querySelector('.search-results .seerr-note')`, 6000);
  check('Seerr faellt aus: die Treffer der Mediathek bleiben, darueber ein kleiner Hinweis, keine Fehlerseite', (await groups()).some((x) => /Aurora/.test(x)) && !(await status()) && /Seerr/.test(await ctx.run(`document.querySelector('.search-results .seerr-note').textContent`)), await ctx.run(`document.querySelector('.search-results .seerr-note')?.textContent ?? ''`));
  SEERR.mode = 'ok';
  state.faults.lists = { how: '500', left: 1 };
  await enter('mock');
  await waitFor(`!!document.querySelector('.seerr-group') && !!document.querySelector('.search-results .seerr-note')`, 6000);
  check('Mediathek faellt aus, Seerr hat Treffer: diese Treffer und ein kleiner Hinweis mit "Erneut versuchen", keine Fehlerseite', !(await status()) && /Mediathek antwortet nicht/.test(await ctx.run(`document.querySelector('.search-results .seerr-note').textContent`)) && (await ctx.run(`!!document.querySelector('.search-results .seerr-note .link-btn')`)), await ctx.run(`document.querySelector('.search-results .seerr-note')?.textContent ?? ''`));
  await ctx.capture(path.join(out, 'SP-03-mediathek-ausfall.png'));
  await ctx.run(`document.querySelector('.search-results .seerr-note .link-btn').click()`);
  check('...nach "Erneut versuchen" ist der Hinweis weg', await waitFor(`!document.querySelector('.search-results .seerr-note') && !!document.querySelector('.seerr-group')`, 5000));

  // ---------- Anfrage aus der Suche: nur Seerr neu ----------
  await waitFor(settled, 4000);
  state.log.length = 0;
  await ctx.run(`[...document.querySelectorAll('.seerr-group .req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Matrix Resurrection').querySelector('.req-actions .btn').click()`);
  await waitFor(`/Angefragt/.test([...document.querySelectorAll('.seerr-group .req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Matrix Resurrection')?.querySelector('.req-status')?.textContent ?? '')`, 5000);
  await ctx.wait(800);
  check('Anfrage aus der Suche: danach nur die Treffer von Seerr neu (Stand), die Mediathek nicht noch einmal', state.log.filter((l) => l.at === 'seerr:GET /search').length === 1 && searches().length === 0, JSON.stringify(state.log.map((l) => l.at)));

  // ---------- Reiter und Tastenkuerzel ----------
  await ctx.run(`document.activeElement?.blur()`);
  await ctx.run(`document.querySelector('.nav-link[href="#/search"]').click()`);
  await ctx.wait(300);
  check('Zweiter Klick auf "Suche": Fokus ins Suchfeld, der Text bleibt (keine leere Suche)', await ctx.run(`document.activeElement === document.querySelector('.search-input') && document.querySelector('.search-input').value === 'mock' && location.hash === '#/search?q=mock'`), await ctx.run('location.hash'));
  await ctx.run(`document.activeElement?.blur()`);
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`);
  await ctx.wait(300);
  check('Strg+K in der Suche: Fokus ins Feld, der Text bleibt', await ctx.run(`document.activeElement === document.querySelector('.search-input') && document.querySelector('.search-input').value === 'mock' && location.hash === '#/search?q=mock'`), await ctx.run('location.hash'));
  await go('#/home', `!!document.querySelector('.home')`);
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`);
  check('Strg+K von der Startseite: die Suche mit Fokus im Feld', await waitFor(`location.hash.startsWith('#/search') && document.activeElement === document.querySelector('.search-input')`, 3000));

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
