// Startseite: Reihe "Filme im Trend" (Seerr) und der Hinweis zur Einrichtung, wenn Seerr nicht verbunden ist (JC_DEV=1). Nutzt den Mock-Seerr des Mock-Servers.
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
  const trendCount = () => state.log.filter((l) => l.at === 'seerr:GET /discover/trending').length;
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
    await type('.settings-panel input[placeholder="seerr.example.com"]', `127.0.0.1:${PORT}`);
    await type('.settings-panel input[type=password]', 'demo');
    await clickText('.settings-panel .btn.primary', 'Verbinden');
    return waitFor(`/Verbunden mit/.test(document.querySelector('.settings-panel .account-card')?.innerText ?? '')`, 6000);
  };
  const connectKey = async () => {
    await go('#/settings/seerr');
    await clickText('.settings-panel button.seg', 'API-Schlüssel');
    await ctx.wait(300);
    await type('.settings-panel input[placeholder="seerr.example.com"]', `http://127.0.0.1:${PORT}`);
    await type('.settings-panel input[placeholder="API-Schlüssel"]', SEERR.apiKey);
    await clickText('.settings-panel .btn.primary', 'Verbinden');
    return waitFor(`/als Schluessel-Konto/.test(document.querySelector('.settings-panel .account-card')?.innerText ?? '')`, 6000);
  };
  const disconnect = async () => {
    await go('#/settings/seerr');
    await clickText('.settings-panel .btn.danger', 'Trennen');
    return waitFor(`!!document.querySelector('.settings-panel input.field')`, 4000);
  };

  // ---------- Ohne Seerr: Hinweis zur Einrichtung ----------
  await go('#/home');
  check('Startseite steht (Bibliotheks-Reihen)', await waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton):not(.trend-row)')`, 8000));
  await ctx.wait(600);
  check('Ohne Seerr: Hinweis-Reihe "Filme im Trend" mit dem Zusatz "über Seerr"', await ctx.run(`document.querySelector('.home .trend-hint .row-head h2')?.textContent === 'Filme im Trend' && document.querySelector('.home .trend-hint .row-head .sub')?.textContent === 'über Seerr'`));
  const titles0 = await rowTitles();
  check('...sie steht ganz unten, unter allen anderen Reihen', await ctx.run(`document.querySelector('.home .rows').lastElementChild.classList.contains('trend-hint')`), JSON.stringify(titles0));
  check('Der Hinweis erklärt es und bietet "Seerr einrichten" mit Ziel Einstellungen > Seerr', await ctx.run(`(() => { const a = document.querySelector('.trend-hint .btn.primary'); return /Seerr einrichten/.test(a.textContent) && a.getAttribute('href') === '#/settings/seerr' && /Seerr/.test(document.querySelector('.trend-hint-text p').textContent) && document.querySelector('.trend-hint-text h3').textContent.length > 10; })()`));
  check('Angedeutete Poster sind für Hilfsmittel verborgen (aria-hidden), sechs Stück', await ctx.run(`(() => { const g = document.querySelector('.trend-hint .trend-ghosts'); return g.getAttribute('aria-hidden') === 'true' && g.children.length === 6; })()`));
  check('Es gibt keine Anfrage an Seerr, solange es nicht verbunden ist', !state.log.some((l) => /^seerr:/.test(l.at)));
  check('Layout: der Kasten liegt im Fenster, kein waagerechtes Scrollen', await ctx.run(`(() => { const b = document.querySelector('.trend-hint-box').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth + 1 && b.height > 80; })()`));
  await showRow('.trend-hint');
  await ctx.capture(path.join(out, 'T-01-hinweis-ohne-seerr.png'));
  await ctx.run(`document.querySelector('.trend-hint .btn.primary').click()`);
  check('"Seerr einrichten" führt in die Einstellungen von Seerr', await waitFor(`location.hash.startsWith('#/settings/seerr') && !!document.querySelector('.settings-panel input.field')`, 3000), await ctx.run('location.hash'));

  // ---------- Ausblenden ----------
  await rebuild();
  await ctx.run(`[...document.querySelectorAll('.trend-hint .btn')].find((b) => b.textContent === 'Ausblenden').click()`);
  check('"Ausblenden" nimmt die Reihe sofort weg', await waitFor(`!document.querySelector('.trend-hint')`, 2000));
  check('...merkt es sich in den Einstellungen (Aussehen)', await waitNode(() => ctx.config.settings.appearance.homeTrending === false), String(ctx.config.settings.appearance.homeTrending));
  check('...und sagt, wo man sie wieder einschaltet (Hinweis mit Weg in die Einstellungen)', /ausgeblendet.*Startseite/.test(await toasts()) && (await ctx.run(`!!document.querySelector('.toast .toast-action, .toast button')`)), await toasts());
  await rebuild();
  check('Nach dem Neuaufbau der Startseite bleibt sie weg (kein Hinweis, keine Reihe)', await ctx.run(`!document.querySelector('.home .trend-hint, .home .trend-row')`));

  // ---------- Schalter in den Einstellungen ----------
  await go('#/settings/home');
  const sw = `document.querySelector('.home-row[data-row="trending"] button.switch')`;
  check('Einstellungen > Startseite: in der Liste der Reihen steht "Filme im Trend" auf aus', await ctx.run(`${sw}?.getAttribute('aria-checked') === 'false' && document.querySelector('.home-row[data-row="trending"]').classList.contains('off')`));
  check('...und die Einstellung zum Banner erklaert den Zusammenhang mit Seerr', await ctx.run(`/Seerr/.test([...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Trend-Filme im Banner')?.querySelector('.setting-desc')?.textContent ?? '')`));
  await ctx.run(`${sw}.click()`);
  check('Einschalten wird gespeichert', await waitNode(() => ctx.config.settings.appearance.homeTrending === true, 3000));
  await go('#/home');
  check('Zurück auf der Startseite: der Hinweis ist wieder da (die gemerkte Startseite wurde verworfen)', await waitFor(`!!document.querySelector('.home .trend-hint')`, 6000));

  // ---------- Mit Seerr: die Reihe ----------
  check('Seerr verbunden (Jellyfin-Konto)', await connectJellyfin());
  state.log.length = 0;
  await go('#/home');
  check('Nach dem Verbinden zeigt die Startseite statt des Hinweises die Reihe', await waitFor(`document.querySelectorAll('.home .trend-row .req-card').length > 0 && !document.querySelector('.home .trend-hint')`, 8000));
  const list = await cards();
  check('Fünf Filme in der Reihenfolge von Seerr (ohne Serie, Person, Doppelten und gesperrten Titel)', JSON.stringify(list.map((c) => c.title)) === JSON.stringify(['Trend Film Eins', 'Mock Arrival', 'Trend Film Zwei', 'Mock Pending Story', 'Trend Film Drei']), JSON.stringify(list.map((c) => c.title)));
  check('Überschrift "Filme im Trend", Zusatz "über Seerr", ganz unten', await ctx.run(`(() => { const r = document.querySelector('.home .rows').lastElementChild; return r.classList.contains('trend-row') && r.querySelector('h2').textContent === 'Filme im Trend' && r.querySelector('.sub').textContent === 'über Seerr'; })()`), JSON.stringify(await rowTitles()));
  check('Server wurde für die Liste dreimal gefragt (drei Seiten), sonst nichts', trendCount() === 3 && state.log.filter((l) => /^seerr:/.test(l.at)).length === 3, JSON.stringify(state.log.map((l) => l.at)));
  const by = Object.fromEntries(list.map((c) => [c.title, c]));
  check('Neue Filme haben "Anfragen", der verfügbare "Verfügbar", der angefragte "Angefragt"', by['Trend Film Eins'].canRequest && by['Trend Film Drei'].canRequest && by['Mock Arrival'].chip === 'Verfügbar' && !by['Mock Arrival'].canRequest && by['Mock Pending Story'].chip === 'Angefragt' && !by['Mock Pending Story'].canRequest, JSON.stringify(list.map((c) => [c.title, c.chip, c.canRequest])));
  check('Poster über das App-Protokoll (TMDB, feste Größe), Jahr und "Film" unter dem Titel', by['Trend Film Eins'].img === 'jellycloud://tmdb/w342/trendposter0001.jpg' && by['Trend Film Eins'].meta === '2026 · Film', JSON.stringify([by['Trend Film Eins'].img, by['Trend Film Eins'].meta]));
  check('Stand "Verfügbar" ist grün gezeichnet', await ctx.run(`(() => { const c = [...document.querySelectorAll('.home .trend-row .req-card')].find((x) => x.querySelector('.l1').textContent === 'Mock Arrival').querySelector('.req-status'); return c.classList.contains('s5') && getComputedStyle(c).backgroundColor === 'rgba(53, 208, 127, 0.55)'; })()`));
  check('Karten der Reihe sind so breit wie die Poster der anderen Reihen', await ctx.run(`(() => { const a = document.querySelector('.home .trend-row .card.poster').getBoundingClientRect().width; const b = document.querySelector('.home .rows .row:not(.trend-row) .card.poster')?.getBoundingClientRect().width; return !!b && Math.abs(a - b) < 1; })()`));
  await showRow('.trend-row');
  await ctx.capture(path.join(out, 'T-02-trend-reihe.png'));

  // ---------- Anfragen und Details aus der Reihe ----------
  state.log.length = 0;
  const reqBtn = (title) => `[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)}).querySelector('.req-actions button')`;
  await ctx.run(`${reqBtn('Trend Film Eins')}.click()`);
  check('Film aus der Reihe anfragen: Karte zeigt "Angefragt", Knopf weg, Hinweis "wurde angefragt"', (await waitFor(`[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Eins').querySelector('.req-status:not([hidden])')?.textContent === 'Angefragt'`, 5000)) && /wurde angefragt/.test(await toasts()), await toasts());
  check('Der Server bekam genau diese eine Anfrage (Film, ohne Staffeln)', JSON.stringify(state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b)) === JSON.stringify([{ mediaType: 'movie', mediaId: 7001 }]), JSON.stringify(state.log.map((l) => l.at)));
  await ctx.run(`[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Zwei').querySelector('.thumb').click()`);
  check('Klick auf ein Poster der Reihe öffnet das Detailfenster', await waitFor(`document.querySelector('.rq .rq-title')?.textContent === 'Trend Film Zwei'`, 3000));
  check('...die Details laden (kein Fehlerhinweis) und die Beschreibung der Liste steht schon da', (await waitFor(`!document.querySelector('.rq-loading')`, 4000)) && (await ctx.run(`document.querySelector('.rq .rq-note')?.hidden === true`)) && state.log.some((l) => l.at === 'seerr:GET /movie/7002'));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc schließt es, der Fokus kehrt zum Poster zurück', (await waitFor(`!document.querySelector('.rq-scrim')`, 2000)) && (await ctx.run(`document.activeElement?.closest('.req-card')?.querySelector('.l1')?.textContent === 'Trend Film Zwei'`)));

  // ---------- Liste wird zwischengemerkt ----------
  const before = trendCount();
  await rebuild();
  await showRow('.trend-row');
  const again = await cards();
  check('Neuaufbau der Startseite innerhalb von zehn Minuten: Reihe sofort wieder da, ohne neue Abfrage an Seerr', again.length === 5 && trendCount() === before, `Abfragen ${before} -> ${trendCount()}`);
  check('...und die eben angefragten Filme zeigen weiterhin "Angefragt"', again.find((c) => c.title === 'Trend Film Eins')?.chip === 'Angefragt');

  // ---------- Schalter aus: keine Reihe, keine Abfrage ----------
  ctx.config.updateSettings({ appearance: { homeTrending: false } });
  const n = trendCount();
  await rebuild();
  await ctx.wait(800);
  check('Schalter aus (mit Seerr): keine Reihe, kein Hinweis, keine Abfrage', (await ctx.run(`!document.querySelector('.home .trend-row, .home .trend-hint')`)) && trendCount() === n);
  ctx.config.updateSettings({ appearance: { homeTrending: true } });
  await rebuild(); // die Oberfläche liest die Einstellungen beim Neuaufbau (boot), nicht aus der Konfigurationsdatei

  // ---------- Trennen: wieder der Hinweis ----------
  check('Seerr getrennt', await disconnect());
  await go('#/home');
  check('Nach dem Trennen steht wieder der Hinweis statt der Reihe', await waitFor(`!!document.querySelector('.home .trend-hint') && !document.querySelector('.home .trend-row:not(.trend-hint)')`, 6000));

  // ---------- Fehlerfälle ----------
  SEERR.trendingError = true;
  check('Seerr mit API-Schlüssel verbunden (anderes Konto, damit nichts aus dem Speicher kommt)', await connectKey());
  await go('#/home');
  await waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton)')`, 8000);
  await ctx.wait(1500);
  check('Seerr antwortet mit Fehler: die Startseite bleibt ohne die Reihe, ohne Hinweis und ohne Fehlermeldung', (await ctx.run(`!document.querySelector('.home .trend-row, .home .trend-hint, .home .empty.error')`)) && !/Trends/.test(await toasts()));
  SEERR.trendingError = false;
  SEERR.expired = true;
  await rebuild();
  check('Abgelaufene Seerr-Anmeldung: Reihe mit Hinweis und Weg in die Einstellungen (kein Wechsel zur Jellyfin-Anmeldung)', (await waitFor(`/abgelaufen/.test(document.querySelector('.home .trend-row .seerr-note')?.textContent ?? '')`, 6000)) && (await ctx.run(`document.querySelector('.home .trend-row .seerr-note a')?.getAttribute('href') === '#/settings/seerr' && !document.querySelector('.login')`)));
  await showRow('.trend-row');
  await ctx.capture(path.join(out, 'T-03-abgelaufen.png'));
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
