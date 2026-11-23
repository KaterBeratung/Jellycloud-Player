// Startseite: Reihe "Filme im Trend" (Seerr). Seit 1.2.14 (Entscheidung E8 wie die Apple-App) gibt es sie nur mit Seerr und nur mit Titeln: ohne Seerr, bei einem
// Ausfall oder einer abgelaufenen Anmeldung fehlt sie, ohne Hinweis zum Einrichten (JC_DEV=1). Nutzt den Mock-Seerr des Mock-Servers.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-trending.js
const path = require('node:path');
const { server, state, SEERR } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) consoleErrors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  // Eigener Port (nicht 8097 wie die anderen Szenarien): so stoert es sich nicht mit einem gleichzeitig laufenden Szenario, und ein belegter Port bricht sofort ab statt zu haengen
  const PORT = 8197;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.win.setContentSize(1440, 900);
  await ctx.wait(500);

  const waitFor = async (js, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const waitNode = async (fn, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const go = async (hash) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    await ctx.wait(500);
  };
  const toasts = () => ctx.run(`[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')`);
  const type = (sel, value) => ctx.run(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const clickText = (sel, text) => ctx.run(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.innerText.includes(${JSON.stringify(text)}))?.click() ?? 'nicht gefunden'`);
  const trendCount = () => state.log.filter((l) => l.at === 'seerr:GET /discover/trending' && !l.mediaType).length;
  const rowSeerrCalls = () => state.log.filter((l) => /^seerr:/.test(l.at) && !l.mediaType);
  const cards = () => ctx.run(`[...document.querySelectorAll('.home .trend-row .req-card')].map((c) => ({ title: c.querySelector('.l1')?.textContent, meta: c.querySelector('.l2')?.textContent, chip: c.querySelector('.req-status:not([hidden])')?.textContent ?? '', canRequest: !c.querySelector('.req-actions').hidden, img: c.querySelector('img')?.getAttribute('src') ?? '' }))`);
  // Startseite neu aufbauen lassen (wie nach einem Film) und warten, bis die Bibliotheks-Reihen stehen
  const rebuild = async () => {
    await ctx.run(`location.hash = '#/home'; document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(1500);
    return waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton)')`, 8000);
  };
  const showRow = async (sel) => {
    await ctx.run(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center' })`);
    await ctx.wait(900);
  };
  const rowTitles = () => ctx.run(`[...document.querySelectorAll('.home .rows > *')].map((c) => (c.querySelector('h2')?.textContent ?? c.className))`);
  const connectJellyfin = async () => {
    await go('#/settings/seerr');
    await type('.settings-panel input[inputmode=url]', `127.0.0.1:${PORT}`);
    await type('.settings-panel input[type=password]', 'demo');
    await clickText('.settings-panel .btn.primary', 'Verbinden');
    return waitFor(`!!document.querySelector('.settings-panel .status-row[data-state=connected]')`, 6000);
  };
  // Ein anderes Seerr-Konto (Mock: "demo2", eigene Sitzung); einen API-Schluessel gibt es nicht mehr
  const connectOther = async () => {
    await go('#/settings/seerr');
    await type('.settings-panel input[inputmode=url]', `http://127.0.0.1:${PORT}`);
    await type('.settings-panel input[autocomplete=username]', 'demo2');
    await type('.settings-panel input[type=password]', 'demo');
    await clickText('.settings-panel .btn.primary', 'Verbinden');
    return waitFor(`!!document.querySelector('.settings-panel .status-row[data-state=connected]') && /Jellyfin-Konto \\(demo2\\)/.test(document.querySelector('.settings-panel').innerText)`, 6000);
  };
  const disconnect = async () => {
    await go('#/settings/seerr');
    await clickText('.settings-panel .link-row.danger', 'Trennen');
    await waitFor(`!!document.querySelector('.mdl')`, 3000);
    await clickText('.mdl .btn', 'Trennen');
    return waitFor(`!!document.querySelector('.settings-panel input.field')`, 4000);
  };

  // ---------- Ohne Seerr: keine Reihe, kein Hinweis (E8) ----------
  await go('#/home');
  check('Startseite steht (Bibliotheks-Reihen)', await waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton):not(.trend-row)')`, 8000));
  await ctx.wait(800);
  check('Ohne Seerr: weder die Reihe "Filme im Trend" noch ein Hinweis zum Einrichten', await ctx.run(`!document.querySelector('.home .trend-row, .home .trend-hint')`), JSON.stringify(await rowTitles()));
  check('Es gibt keine Anfrage an Seerr, solange es nicht verbunden ist', !state.log.some((l) => /^seerr:/.test(l.at)));
  await go('#/settings/home');
  check('Einstellungen > Startseite: "Filme im Trend (Seerr)" steht ausgeschaltet und gesperrt da', await ctx.run(`(() => { const r = document.querySelector('.home-row[data-row="trending"]'); return r.classList.contains('locked') && r.querySelector('button.switch').disabled && r.querySelector('.home-row-name').textContent === 'Filme im Trend (Seerr)'; })()`));
  check('...es gibt keinen Regler "Trend-Filme im Banner" mehr', !(await ctx.run(`/Trend-Filme im Banner/.test(document.querySelector('.settings-panel').innerText)`)));

  // ---------- Mit Seerr: die Reihe ----------
  check('Seerr verbunden (Jellyfin-Konto)', await connectJellyfin());
  state.log.length = 0;
  await go('#/home');
  check('Nach dem Verbinden zeigt die Startseite die Reihe', await waitFor(`document.querySelectorAll('.home .trend-row .req-card').length > 0`, 8000));
  const list = await cards();
  check('Fünf Filme in der Reihenfolge von Seerr (ohne Serie, Person, Doppelten und gesperrten Titel)', JSON.stringify(list.map((c) => c.title)) === JSON.stringify(['Trend Film Eins', 'Mock Arrival', 'Trend Film Zwei', 'Mock Pending Story', 'Trend Film Drei']), JSON.stringify(list.map((c) => c.title)));
  check('Überschrift "Filme im Trend", Zusatz "über Seerr", ganz unten', await ctx.run(`(() => { const r = document.querySelector('.home .rows').lastElementChild; return r.classList.contains('trend-row') && r.querySelector('h2').textContent === 'Filme im Trend' && r.querySelector('.sub').textContent === 'über Seerr'; })()`), JSON.stringify(await rowTitles()));
  check('Server wurde für die Liste dreimal gefragt (drei Seiten), sonst nichts (die Top 10 fragen getrennt, mit Art)', trendCount() === 3 && rowSeerrCalls().length === 3, JSON.stringify(rowSeerrCalls().map((l) => l.at)));
  const by = Object.fromEntries(list.map((c) => [c.title, c]));
  check('Neue Filme haben "Anfragen", der verfügbare "Verfügbar", der angefragte "Angefragt"', by['Trend Film Eins'].canRequest && by['Trend Film Drei'].canRequest && by['Mock Arrival'].chip === 'Verfügbar' && !by['Mock Arrival'].canRequest && by['Mock Pending Story'].chip === 'Angefragt' && !by['Mock Pending Story'].canRequest, JSON.stringify(list.map((c) => [c.title, c.chip, c.canRequest])));
  check('Poster über das App-Protokoll (TMDB, feste Größe), Jahr und "Film" unter dem Titel', by['Trend Film Eins'].img === 'jellycloud://tmdb/w342/trendposter0001.jpg' && by['Trend Film Eins'].meta === '2026 · Film', JSON.stringify([by['Trend Film Eins'].img, by['Trend Film Eins'].meta]));
  check('Stand "Verfügbar" ist ein gruenes Tag wie Direct Play (Farbe aus seerr-state.js und media-tags.js, keine eigene Palette)', await ctx.run(`(() => { const c = [...document.querySelectorAll('.home .trend-row .req-card')].find((x) => x.querySelector('.l1').textContent === 'Mock Arrival').querySelector('.req-status .tag'); return c?.dataset.kind === 'seerrAvailable' && c.classList.contains('hl') && c.style.getPropertyValue('--ink') === window.JCMediaTags.paint('directPlay').ink; })()`));
  check('Karten der Reihe sind so breit wie die Poster der anderen Reihen', await ctx.run(`(() => { const a = document.querySelector('.home .trend-row .card.poster').getBoundingClientRect().width; const b = document.querySelector('.home .rows .row:not(.trend-row) .card.poster')?.getBoundingClientRect().width; return !!b && Math.abs(a - b) < 1; })()`));
  await showRow('.trend-row');
  await ctx.capture(path.join(out, 'T-02-trend-reihe.png'));

  // ---------- Anfragen und Details aus der Reihe ----------
  state.log.length = 0;
  const reqBtn = (title) => `[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)}).querySelector('.req-actions button')`;
  await ctx.run(`${reqBtn('Trend Film Eins')}.click()`);
  check('Film aus der Reihe anfragen: Karte zeigt "Angefragt", Knopf weg, Hinweis "wurde angefragt"', (await waitFor(`[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Eins').querySelector('.req-status:not([hidden])')?.textContent === 'Angefragt'`, 5000)) && /wurde angefragt/.test(await toasts()), await toasts());
  check('Der Server bekam genau diese eine Anfrage (Film, ohne Staffeln, nie 4K)', JSON.stringify(state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b)) === JSON.stringify([{ mediaType: 'movie', mediaId: 7001, is4k: false }]), JSON.stringify(state.log.map((l) => l.at)));
  await ctx.run(`[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Zwei').querySelector('.thumb').click()`);
  check('Klick auf ein Poster der Reihe öffnet die Seite des Titels', await waitFor(`location.hash === '#/seerr/movie/7002' && document.querySelector('.seerr-page .detail-title')?.textContent === 'Trend Film Zwei'`, 3000), await ctx.run('location.hash'));
  const pageReady = await waitFor(`!!document.querySelector('.seerr-page .info-block') && !!document.querySelector('.seerr-page .seerr-request')`, 8000);
  const pageState = await ctx.run(`({ note: document.querySelector('.seerr-page .seerr-page-note')?.hidden ? '' : document.querySelector('.seerr-page .seerr-page-note')?.textContent, year: document.querySelector('.seerr-page .detail-meta > span')?.textContent, button: document.querySelector('.seerr-page .seerr-request')?.textContent })`);
  check('...die Angaben laden (kein Fehlerhinweis), Jahr aus der Liste und "Film anfragen" stehen da', pageReady && !pageState.note && pageState.year === '2025' && /Film anfragen/.test(pageState.button ?? '') && state.log.some((l) => l.at === 'seerr:GET /movie/7002'), JSON.stringify(pageState));
  await ctx.run(`history.back()`);
  check('"Zurück" führt wieder auf die Startseite', await waitFor(`location.hash === '#/home' && !!document.querySelector('.home .trend-row')`, 4000));

  // ---------- Liste wird zwischengemerkt ----------
  // Nach einer Anfrage holt die Startseite die Liste neu (der Stand hat sich geaendert, wie die Apple-App); danach gilt sie wieder zehn Minuten
  await rebuild();
  await showRow('.trend-row');
  const before = trendCount();
  await rebuild();
  await showRow('.trend-row');
  const again = await cards();
  check('Neuaufbau der Startseite innerhalb von zehn Minuten: Reihe sofort wieder da, ohne neue Abfrage an Seerr', again.length === 5 && trendCount() === before, `Abfragen ${before} -> ${trendCount()}`);
  check('...und die eben angefragten Filme zeigen weiterhin "Angefragt"', again.find((c) => c.title === 'Trend Film Eins')?.chip === 'Angefragt');

  // ---------- Ausgeblendet: keine Reihe, keine Abfrage ----------
  ctx.config.updateSettings({ home: { hidden: ['trending'] } });
  const n = trendCount();
  await rebuild();
  await ctx.wait(800);
  check('Reihe ausgeblendet (mit Seerr): keine Reihe, keine Abfrage', (await ctx.run(`!document.querySelector('.home .trend-row, .home .trend-hint')`)) && trendCount() === n);
  ctx.config.updateSettings({ home: { hidden: [] } });
  await rebuild(); // die Oberfläche liest die Einstellungen beim Neuaufbau (boot), nicht aus der Konfigurationsdatei

  // ---------- Trennen: keine Reihe, kein Hinweis ----------
  check('Seerr getrennt', await disconnect());
  await go('#/home');
  await waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton)')`, 8000);
  await ctx.wait(800);
  check('Nach dem Trennen: keine Reihe und kein Hinweis zum Einrichten', await ctx.run(`!document.querySelector('.home .trend-row, .home .trend-hint')`));

  // ---------- Fehlerfälle ----------
  SEERR.trendingError = true;
  check('Seerr mit einem anderen Konto verbunden (damit nichts aus dem Speicher kommt)', await connectOther());
  await go('#/home');
  await waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton)')`, 8000);
  await ctx.wait(1500);
  check('Seerr antwortet mit Fehler: die Startseite bleibt ohne die Reihe, ohne Hinweis und ohne Fehlermeldung', (await ctx.run(`!document.querySelector('.home .trend-row, .home .trend-hint, .home .page-status')`)) && !/Trends/.test(await toasts()));
  SEERR.trendingError = false;
  SEERR.expired = true;
  await rebuild();
  await ctx.wait(1500);
  check('Abgelaufene Seerr-Anmeldung: keine Reihe (keine leere Reihe, kein Wechsel zur Jellyfin-Anmeldung)', await ctx.run(`!document.querySelector('.home .trend-row') && !document.querySelector('.login') && !!document.querySelector('.home .rows .row')`));
  SEERR.expired = false;
  await rebuild();
  check('Wieder erreichbar: die Reihe kommt zurück (Stand "Angefragt" vom Server)', (await waitFor(`document.querySelectorAll('.home .trend-row .req-card').length === 5`, 6000)) && (await cards()).find((c) => c.title === 'Trend Film Eins')?.chip === 'Angefragt');

  // Erwartete Fehlerfälle (500, 401) und nicht ladende Mock-Poster erscheinen als "Failed to load resource", nie als Skriptfehler
  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler und keine Warnungen in der Konsole der Oberfläche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
