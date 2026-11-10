// Fehler aus der Durchsicht der Oberflaeche (JC_DEV=1), jeweils mit dem Ablauf, der sie ausgeloest hat:
//  1. Bibliothek: nach einer vollstaendig geladenen kurzen Liste (Filter "Favoriten") lud "Alle" nur die erste Seite, das Nachladen beim Scrollen war abgeschaltet
//  2. Bibliothek: ein Filter, der waehrend des ersten Ladens gewaehlt wurde, blieb wirkungslos (die alte Liste kam trotzdem an)
//  3. Router: Zurueck waehrend eines Uebergangs (Poster > Detailseite) zeigte die falsche Seite zur Adresse
//  4. Rahmen der Oberflaeche: jeder Neuaufbau (Sprache, erneute Anmeldung, "hartes" Neuladen) liess einen weiteren Zuhoerer fuer "route" zurueck
// Nutzt den Mock-Server auf eigenem Port 8997.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/review-fixes.js
const { server, items, state, addMovies, MOVIES_VIEW } = require('../mock-server');

module.exports = async (ctx) => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) consoleErrors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const PORT = 8997;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  addMovies(140);
  const totalMovies = [...items.values()].filter((i) => i.Type === 'Movie').length;
  await ctx.wait(400);
  ctx.win.setContentSize(1440, 900);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);

  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const cards = () => ctx.run(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length`);
  const seg = (i) => ctx.run(`document.querySelectorAll('.lib-controls .seg')[${i}].click()`);
  const scrollEnd = async (want, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await ctx.run(`(() => { const v = document.querySelector('#view'); v.scrollTop = v.scrollHeight; })()`);
      await ctx.wait(250);
      if ((await cards()) >= want) return true;
    }
    return false;
  };
  const openLibrary = async () => {
    await ctx.run(`location.hash = '#/library/${MOVIES_VIEW.Id}'`);
    return waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length > 0 && !!document.querySelector('.lib-controls .seg')`);
  };

  // ---------- 1. Nachladen nach kurzer Liste ----------
  check('Vorbereitung: die Bibliothek hat mehr Filme als eine Seite (60)', totalMovies > 60, String(totalMovies));
  check('Die Bibliothek oeffnet mit der ersten Seite (60 Karten)', (await openLibrary()) && (await cards()) === 60, String(await cards()));
  check('Bis ans Ende gescrollt: alle Filme sind da', await scrollEnd(totalMovies), `${await cards()} von ${totalMovies}`);
  await seg(2); // Favoriten: eine kurze Liste, die ganz geladen ist
  check('Filter "Favoriten": nur der eine Favorit', await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 1`), String(await cards()));
  await ctx.wait(300);
  await seg(0); // wieder alle
  check('Zurueck auf "Alle": wieder die erste Seite', await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 60`), String(await cards()));
  check('...und beim Scrollen kommen die uebrigen nach (das Nachladen funktioniert wieder)', await scrollEnd(totalMovies), `${await cards()} von ${totalMovies}`);

  // ---------- 1b. Sehr grosser Bildschirm: die erste Seite fuellt ihn nicht, es muss ohne Scrollen weitergeladen werden ----------
  ctx.win.webContents.setZoomFactor(0.25); // gleiche Wirkung wie ein sehr hoher, breiter Bildschirm: der Ansichtsbereich fasst viermal so viele Bildpunkte
  await ctx.wait(500);
  await ctx.run(`document.dispatchEvent(new CustomEvent('reload-data'))`);
  const filled = await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length >= ${totalMovies}`, 15000);
  check('Sehr grosser Ansichtsbereich: alle Filme kommen ohne Scrollen (die erste Seite fuellt ihn nicht, das Nachladen laeuft von selbst weiter)', filled, `${await cards()} von ${totalMovies}`);
  ctx.win.webContents.setZoomFactor(1);
  await ctx.wait(500);

  // ---------- 2. Filter waehrend des ersten Ladens ----------
  state.delays.items = 700;
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(500);
  await ctx.run(`(() => { sessionStorage.clear(); })()`);
  await ctx.run(`location.hash = '#/library/${MOVIES_VIEW.Id}'`);
  // Die Bibliothek bleibt im Zwischenspeicher des Routers: ein frisches Laden erzwingen
  await ctx.run(`document.dispatchEvent(new CustomEvent('reload-data'))`);
  await waitFor(`!!document.querySelector('.lib-controls .seg')`, 8000);
  await seg(2); // Favoriten, solange die erste Seite noch laedt
  await ctx.wait(2500);
  const shown = await cards();
  const selected = await ctx.run(`[...document.querySelectorAll('.lib-controls .seg')].findIndex((b) => b.classList.contains('on'))`);
  check('Filter waehrend des ersten Ladens gewaehlt: er gilt (nur der Favorit, nicht die alte Liste)', selected === 2 && shown === 1, `Filter ${selected}, ${shown} Karten`);
  state.delays.items = 0;
  await seg(0);
  check('...und "Alle" danach liefert wieder die Liste', await waitFor(`document.querySelectorAll('.library .grid .card:not(.sk-card)').length === 60`), String(await cards()));

  // ---------- 3. Router: Zurueck waehrend des Uebergangs ----------
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('#view .home')`, 8000);
  await ctx.wait(600);
  await ctx.run(`(async () => {
    const r = await import('./js/router.js');
    document.startViewTransition = (cb) => {
      const finished = new Promise((res) => setTimeout(() => { cb(); res(); }, 900)); // reichlich Zeit, auch wenn die Seite gerade beschaeftigt ist
      return { finished };
    };
    r.markSharedElement(document.querySelector('#view .card') ?? document.querySelector('#view'));
    location.hash = '#/search';
    setTimeout(() => { location.hash = '#/home'; }, 30);
  })()`);
  await ctx.wait(2200);
  const where = await ctx.run(`({ hash: location.hash, home: !!document.querySelector('#view .home'), search: !!document.querySelector('#view .search') })`);
  check('Zurueck waehrend des Uebergangs: die Seite passt zur Adresse (Startseite, nicht die Suche)', where.hash === '#/home' && where.home && !where.search, JSON.stringify(where));
  await ctx.run(`delete document.startViewTransition`);

  // ---------- 4. Zuhoerer fuer "route" ----------
  await ctx.run(`(() => {
    window.__routeListeners = 0;
    const add = document.addEventListener.bind(document);
    const rem = document.removeEventListener.bind(document);
    document.addEventListener = (type, ...a) => { if (type === 'route') window.__routeListeners++; return add(type, ...a); };
    document.removeEventListener = (type, ...a) => { if (type === 'route') window.__routeListeners--; return rem(type, ...a); };
  })()`);
  for (let i = 0; i < 3; i++) {
    await ctx.run(`document.dispatchEvent(new CustomEvent('relocalize'))`);
    await ctx.wait(1500);
  }
  const net = await ctx.run(`window.__routeListeners`);
  check('Drei Neuaufbauten des Rahmens: es bleibt bei einem Zuhoerer fuer "route" (kein Zuwachs)', net === 0, `Zuwachs ${net}`);
  check('...und die Oberflaeche steht wieder (Kopfleiste und Ansicht da)', await ctx.run(`!!document.querySelector('.topbar') && !!document.querySelector('#view')`));

  // ---------- 5. Suche: Feld geleert, bevor die Antwort kommt ----------
  state.delays.items = 600;
  await ctx.run(`location.hash = '#/search'`);
  await waitFor(`!!document.querySelector('.search-input')`, 8000);
  const typeAndEnter = (text) => ctx.run(`(() => { const i = document.querySelector('.search-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await typeAndEnter('Pa');
  await ctx.wait(100);
  await typeAndEnter('');
  await ctx.wait(1300); // die erste Antwort ist inzwischen da (und veraltet)
  const busy = await ctx.run(`document.querySelector('.search-results').classList.contains('busy')`);
  const hint = await ctx.run(`!!document.querySelector('.search-results .empty')`);
  check('Suchfeld geleert, bevor die Antwort kommt: der Hinweis steht da und ist nicht abgeblendet ("busy" bleibt nicht haengen)', hint && !busy, `Hinweis ${hint}, busy ${busy}`);
  state.delays.items = 0;

  check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
};
