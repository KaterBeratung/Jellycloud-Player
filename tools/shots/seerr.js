// Seerr-Anbindung (JC_DEV=1): Verbinden (nur mit dem Jellyfin-Konto, je Profil), Suche, Anfragen, Fehlerfaelle, Trennen (Adresse bleibt vorbelegt). Nutzt den Mock-Seerr des Mock-Servers.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/seerr.js
const fs = require('node:fs');
const path = require('node:path');
const { server, state, SEERR } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) consoleErrors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
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
  const cards = () => ctx.run(`[...document.querySelectorAll('.req-card')].map((c) => ({ title: c.querySelector('.l1')?.textContent, chip: c.querySelector('.req-status:not([hidden])')?.textContent ?? '', canRequest: !c.querySelector('.req-actions').hidden, img: c.querySelector('img')?.getAttribute('src') ?? '' }))`);
  const search = async (q) => {
    await go('#/home'); // gleicher Hash wuerde die Suche nicht neu starten
    await go(`#/search?q=${encodeURIComponent(q)}`);
    await waitFor(`!document.querySelector('.search-results.busy')`, 6000);
    await ctx.wait(1200);
  };
  const raw = () => fs.readFileSync(path.join(ctx.app.getPath('userData'), 'config.json'), 'utf8');

  // ---------- Ohne Verbindung: keine Seerr-Anzeige ----------
  await search('mock');
  check('Ohne Seerr-Verbindung erscheint nichts von Seerr in der Suche', (await ctx.run(`!document.querySelector('.seerr-group, .req-card')`)));
  check('...und die Suche fragt Seerr nicht an', !state.log.some((l) => /^seerr:/.test(l.at)));

  // ---------- Verbinden mit dem Jellyfin-Konto ----------
  await go('#/settings/seerr');
  check('Einstellungsbereich "Anfragen (Seerr)" ist in der Seitenleiste', await ctx.run(`!![...document.querySelectorAll('.snav')].find((a) => /Seerr/.test(a.innerText))`));
  const ADDR = '.settings-panel input[inputmode=url]';
  const ACCOUNT = '.settings-panel input[autocomplete=username]';
  check('Formular: Adresse, Jellyfin-Konto (vorbelegt mit dem Konto des Profils), Jellyfin-Passwort', await ctx.run(`document.querySelectorAll('.settings-panel input.field').length === 3 && document.querySelector(${JSON.stringify(ACCOUNT)})?.value === 'demo' && document.querySelector(${JSON.stringify(ACCOUNT)}).placeholder === 'Jellyfin-Konto'`));
  const visibleFields = () => ctx.run(`[...document.querySelectorAll('.settings-panel input.field')].filter((i) => !i.closest('[hidden]')).map((i) => i.type)`);
  check('Nur das Jellyfin-Konto: Adresse, Konto, Passwort; keine Wahl der Anmeldung, kein API-Schluessel', JSON.stringify(await visibleFields()) === JSON.stringify(['text', 'text', 'password']) && (await ctx.run(`!document.querySelector('.settings-panel .segmented') && !/API/.test(document.querySelector('.settings-panel').innerText)`)), JSON.stringify(await visibleFields()));
  check('Hinweis: die Verbindung gilt nur fuer dieses Profil', await ctx.run(`/nur für dieses Profil/.test(document.querySelector('.settings-panel').innerText)`));
  check('"Mit Passwort verbinden" ist gesperrt, bis Adresse und Passwort dastehen', await ctx.run(`document.querySelector('.settings-panel [data-action="seerr-password"]')?.disabled === true`));
  await ctx.capture(path.join(out, 'S-01-seerr-settings.png'));
  await type(ADDR, '127.0.0.1:8097');
  await type('.settings-panel input[type=password]', 'falsch');
  await clickText('.settings-panel [data-action="seerr-password"]', 'Mit Passwort verbinden'); // seit 1.2.25: Hauptknopf ist "Ohne Passwort verbinden"
  const pwError = `document.querySelector('.settings-panel [data-action="seerr-password"]')?.closest('.setting')?.querySelector('.form-error')?.textContent ?? ''`; // die Meldung des Wegs mit Passwort (seit 1.2.25 zwei Wege)
  check('Falsches Passwort: Fehlermeldung, nicht verbunden', await waitFor(`/abgelehnt/.test(${pwError})`, 6000), await ctx.run(pwError));
  check('...und die Jellyfin-Anmeldung bleibt davon unberuehrt, das Passwort bleibt nicht stehen', await ctx.run(`!document.querySelector('.login') && document.querySelector('.settings-panel input[type=password]').value === ''`));
  await type('.settings-panel input[type=password]', 'demo');
  await clickText('.settings-panel [data-action="seerr-password"]', 'Mit Passwort verbinden'); // seit 1.2.25: Hauptknopf ist "Ohne Passwort verbinden"
  const connectedRow = `document.querySelector('.settings-panel .status-row[data-state=connected]') && /Verbunden/.test(document.querySelector('.settings-panel .status-row').innerText) && /http:\\/\\/127\\.0\\.0\\.1:8097/.test(document.querySelector('.settings-panel').innerText) && /Jellyfin-Konto \\(demo\\)/.test(document.querySelector('.settings-panel').innerText)`;
  check('Verbunden: Stand "Verbunden", Adresse und Anmeldung "Jellyfin-Konto (demo)"', await waitFor(`!!(${connectedRow})`, 6000), await ctx.run(`document.querySelector('.settings-panel')?.innerText`));
  // Seit 1.2.25 fragt die App nach dem ersten Verbinden einmal nach den Mitteilungen des Systems (seerr-quick.js prueft das): hier "Nicht jetzt"
  if (await waitFor(`!!document.querySelector('.mdl-scrim .mdl-actions')`, 2000)) await ctx.run(`[...document.querySelectorAll('.mdl-scrim .mdl-actions button')].find((b) => b.textContent === 'Nicht jetzt')?.click()`);
  await ctx.wait(300);
  const saved = ctx.config.getSeerr();
  check('Zugangsdaten gespeichert (entschluesselt: Session-Cookie) samt Jellyfin-Kennung von Seerr, ohne Modus', saved?.secret === 'mock-seerr-sid' && typeof saved?.jellyfinUserId === 'string' && saved.jellyfinUserId.length > 0 && !('mode' in saved), JSON.stringify({ user: saved?.userName, jf: saved?.jellyfinUserId }));
  const file = JSON.parse(raw());
  check('In der Datei beim aktiven Profil, nicht fuer das ganze Geraet', !('seerr' in file) && file.servers.find((s) => s.id === file.activeServerId)?.seerr?.url === 'http://127.0.0.1:8097' && file.version === 10);
  check('Session-Cookie steht nicht im Klartext in der Konfigurationsdatei', !raw().includes('mock-seerr-sid'));
  const pub = await ctx.run(`window.jc.getState().then((s) => JSON.stringify(s.seerr))`);
  check('Oberflaeche bekommt keine Zugangsdaten', !/mock-seerr-sid/.test(pub) && JSON.parse(pub).url === 'http://127.0.0.1:8097', pub);

  // ---------- Suche: Titel, die es nicht in der Bibliothek gibt ----------
  await search('mock');
  const found = await cards();
  const by = Object.fromEntries(found.map((c) => [c.title, c]));
  check('Suche zeigt die Seerr-Treffer als Gruppe "Nicht in der Bibliothek" (wie die Apple-App)', (await ctx.run(`document.querySelector('.seerr-group h2')?.textContent`)) === 'Nicht in der Bibliothek');
  check('...darunter "Über Seerr anfragen"; ohne Treffer der Mediathek kein Hinweis "Keine Ergebnisse"', (await ctx.run(`document.querySelector('.seerr-group .search-group-note')?.textContent`)) === 'Über Seerr anfragen' && (await ctx.run(`!document.querySelector('.search-results .page-status')`)));
  check('Verfuegbare Titel und Personen fehlen, die anderen sind da (4 Karten)', found.length === 4 && !by['Mock Arrival'] && !by['Mock Person'], found.map((c) => c.title).join(', '));
  check('Neue Titel haben die Schaltflaeche "Anfragen", keine Beschriftung', by['Mock Matrix Resurrection']?.canRequest && by['Mock Matrix Resurrection']?.chip === '');
  check('Schon angefragter Titel zeigt "Angefragt" und keine Schaltflaeche', by['Mock Pending Story']?.chip === 'Angefragt' && !by['Mock Pending Story']?.canRequest);
  check('Poster laufen ueber das App-Protokoll (TMDB, feste Groesse)', by['Mock Matrix Resurrection']?.img === 'jellycloud://tmdb/w342/mockposter0001.jpg', by['Mock Matrix Resurrection']?.img);
  await ctx.capture(path.join(out, 'S-02-seerr-search.png'));

  // ---------- Seite eines Titels beim Anklicken einer Karte (P12: kein Dialogfenster mehr) ----------
  const openCard = async (title) => {
    await ctx.run(`[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)}).querySelector('.thumb').click()`);
    await ctx.wait(150);
  };
  const page = (sel, prop = 'textContent') => ctx.run(`document.querySelector('.seerr-page ${sel}')?.${prop} ?? ''`);
  const pageLoaded = () => waitFor(`!!document.querySelector('.seerr-page .info-block, .seerr-page .seerr-page-note:not([hidden])')`, 6000);
  const back = async (hash) => {
    await ctx.run('history.back()');
    await waitFor(`location.hash.startsWith(${JSON.stringify(hash)})`, 4000);
    await waitFor(`!document.querySelector('.search-results.busy')`, 6000);
    await ctx.wait(900);
  };
  check('Karten sind anklickbar: Poster mit Hand-Cursor und Tastaturfokus, Rolle "button" mit Beschriftung', await ctx.run(`(() => { const t = document.querySelector('.req-card .thumb'); const s = getComputedStyle(t); return s.cursor === 'pointer' && t.tabIndex === 0 && t.getAttribute('role') === 'button' && /Details zu/.test(t.getAttribute('aria-label')); })()`));
  state.log.length = 0;
  await openCard('Mock Matrix Resurrection');
  check('Klick auf die Karte oeffnet die Seite des Titels (im Verlauf, kein Fenster)', await waitFor(`location.hash === '#/seerr/movie/603' && document.querySelector('.seerr-page .detail-title')?.textContent === 'Mock Matrix Resurrection'`, 3000) && !(await ctx.run(`!!document.querySelector('[role=dialog]')`)), await ctx.run('location.hash'));
  check('Sofort sichtbar, was die Suche schon kennt: Beschreibung und Poster (w500)', (await page('.overview')).includes('Ein Testfilm aus dem Mock-Katalog.') && (await page('.detail-poster img', 'getAttribute("src")')) === 'jellycloud://tmdb/w500/mockposter0001.jpg', await page('.detail-poster img', 'getAttribute("src")'));
  check('Angaben werden nachgeladen (eine Abfrage /movie/603)', (await pageLoaded()) && state.log.filter((l) => l.at === 'seerr:GET /movie/603').length === 1, JSON.stringify(state.log.map((l) => l.at)));
  const metaOf = () => ctx.run(`[...document.querySelectorAll('.seerr-page .detail-meta > span')].map((s) => s.textContent.trim()).join(' | ')`);
  check('Angabenzeile: Jahr, Freigabe (FSK), Laufzeit (format.js), Bewertung', (await metaOf()) === '2021 | FSK 16 | 2 Std. 28 Min. | 7.3', await metaOf());
  check('Tagline, Genres, Hintergrundbild ueber das App-Protokoll (w1280)', (await page('.tagline')) === 'Zurueck im Mock.' && (await page('.seerr-genres')) === 'Science Fiction, Action' && (await ctx.run(`document.querySelector('.seerr-page .detail-bd-img img')?.getAttribute('src')`)) === 'jellycloud://tmdb/w1280/mockbackdrop001.jpg');
  const cast = await ctx.run(`[...document.querySelectorAll('.seerr-page .person')].map((p) => ({ n: p.querySelector('.l1').textContent, c: p.querySelector('.l2')?.textContent ?? '', img: p.querySelector('img')?.getAttribute('src') ?? '' }))`);
  check('Besetzung wie auf der Detailseite: vorn Regie, dann die Darsteller mit Rolle und Bild (w185)', cast.length === 4 && cast[0].n === 'Mock Regisseurin' && cast[0].c === 'Regie' && cast[1].n === 'Mock Actor Eins' && cast[1].c === 'Neo' && cast[1].img === 'jellycloud://tmdb/w185/mockprofile001.jpg', JSON.stringify(cast));
  check('Neuer Titel: "Film anfragen" als Hauptknopf, kein Stand', (await page('.seerr-request')).includes('Film anfragen') && !(await ctx.run(`!!document.querySelector('.seerr-page .detail-tags .tag')`)));
  await waitFor(`document.querySelectorAll('.seerr-page .seerr-related .row').length === 3`, 6000);
  const rows = await ctx.run(`[...document.querySelectorAll('.seerr-page .seerr-related .row')].map((r) => r.querySelector('h2').textContent + ': ' + [...r.querySelectorAll('.req-card .l1')].map((x) => x.textContent).join(', '))`);
  check('Weitere Titel: Filmreihe (ohne den Titel selbst), Empfohlen (ohne Personen), Aehnliche Titel', JSON.stringify(rows) === JSON.stringify(['Mock Matrix Reihe: Mock Matrix', 'Empfohlen: Trend Film Eins, Mock Arrival', 'Ähnliche Titel: Trend Film Zwei']), JSON.stringify(rows));
  const infoBlock = await ctx.run(`[...document.querySelectorAll('.seerr-page .info-group')].map((g) => g.querySelector('h3').textContent + '=' + [...g.querySelectorAll('dt')].map((d) => d.textContent + ':' + d.nextElementSibling.textContent).join('|'))`);
  check('Informationen: Allgemein, Bewertungen (TMDB und IMDb mit Stimmen), Produktion', infoBlock.length === 3 && /Erschienen:16\. Dezember 2021/.test(infoBlock[0]) && /Freigabe:FSK 16/.test(infoBlock[0]) && /TMDB:7,3 \(1\.234 Stimmen\)\|IMDb:7,8 \(54\.321 Stimmen\)/.test(infoBlock[1]) && /Studio:Mock Studios/.test(infoBlock[2]) && /Originalsprache:Englisch/.test(infoBlock[2]), JSON.stringify(infoBlock));
  await ctx.capture(path.join(out, 'S-04-seerr-seite.png'));
  await back('#/search');
  check('"Zurueck" fuehrt wieder zur Suche mit den Treffern', (await cards()).length === 4, JSON.stringify((await cards()).map((c) => c.title)));
  await ctx.run(`(() => { const t = [...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Thrones').querySelector('.thumb'); t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  check('Enter auf dem fokussierten Poster oeffnet die Seite ebenfalls (Serie)', await waitFor(`location.hash === '#/seerr/tv/1399'`, 3000) && (await pageLoaded()));
  check('Serie: Angabenzeile mit Laufzeit und Staffeln, die Schoepfer vorn ("Idee"), "Serie anfragen"', (await metaOf()) === '2011 | 57 Min. | 8 Staffeln | 8.4' && (await page('.person .l2')) === 'Idee' && (await page('.seerr-request')).includes('Serie anfragen'), `${await metaOf()} | ${await page('.person .l2')}`);
  await back('#/search');
  await openCard('Mock Pending Story');
  check('Schon angefragter Titel: der Stand "Angefragt" als Tag, kein Anfrage-Knopf, ohne Poster der Titel als Ersatz', (await pageLoaded()) && (await page('.detail-tags .tag')) === 'Angefragt' && !(await page('.seerr-request')) && (await page('.detail-poster .fallback-title')) === 'Mock Pending Story' && (await page('.overview')) === 'Wartet schon auf Freigabe.');
  check('Ohne Besetzung keine Besetzungsreihe', await ctx.run(`!document.querySelector('.seerr-page .person')`));
  await back('#/search');
  await openCard('Mock Quota Exceeded');
  check('Schlaegt das Laden der Angaben fehl (500): Hinweis mit der Meldung, Beschreibung und Anfrage bleiben', await waitFor(`/Details nicht verfuegbar/.test(document.querySelector('.seerr-page .seerr-page-note')?.textContent ?? '')`, 5000) && !!(await page('.seerr-request')), await page('.seerr-page-note'));
  await ctx.capture(path.join(out, 'S-05-seerr-seite-fehler.png'));
  await back('#/search');
  check('Der Anfragen-Knopf der Karte liegt ausserhalb von Poster und Beschriftung (sein Klick oeffnet keine Seite)', await ctx.run(`!document.querySelector('.req-card .thumb .req-actions, .req-card .meta .req-actions') && !!document.querySelector('.req-card .req-actions button')`));
  SEERR.expired = true;
  await openCard('Mock Matrix Resurrection');
  check('Abgelaufene Seerr-Sitzung beim Laden: Hinweis "abgelaufen", die Anmeldung bei Jellyfin bleibt', await waitFor(`/abgelaufen/.test(document.querySelector('.seerr-page .seerr-page-note')?.textContent ?? '')`, 5000) && (await ctx.run(`!document.querySelector('.login')`)), await page('.seerr-page-note'));
  SEERR.expired = false;
  await back('#/search');

  // ---------- Anfragen ----------
  state.log.length = 0;
  const reqBtn = (title) => `[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)}).querySelector('.req-actions button')`;
  await ctx.run(`${reqBtn('Mock Matrix Resurrection')}.click()`);
  check('Film anfragen: Beschriftung wechselt zu "Angefragt"', await waitFor(`[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Matrix Resurrection').querySelector('.req-status:not([hidden])')?.textContent === 'Angefragt'`, 5000));
  check('Hinweis "wurde angefragt"', /wurde angefragt/.test(await toasts()), await toasts());
  await ctx.run(`${reqBtn('Mock Thrones')}.click()`);
  await waitFor(`[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Thrones').querySelector('.req-status:not([hidden])')`, 5000);
  const bodies = state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b);
  check('Server bekommt Film ohne Staffeln und Serie (ohne genannte Staffeln: alle), nie 4K', JSON.stringify(bodies) === JSON.stringify([{ mediaType: 'movie', mediaId: 603, is4k: false }, { mediaType: 'tv', mediaId: 1399, is4k: false, seasons: 'all' }]), JSON.stringify(bodies));
  await ctx.run(`${reqBtn('Mock Quota Exceeded')}.click()`);
  check('Kontingent erreicht (403): verstaendliche Meldung, Schaltflaeche bleibt', (await waitFor(`/Kontingent/.test([...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' '))`, 4000)) && (await cards()).find((c) => c.title === 'Mock Quota Exceeded')?.canRequest, await toasts());
  await ctx.capture(path.join(out, 'S-03-seerr-requested.png'));

  // ---------- Anfragen auf der Seite des Titels ----------
  await search('dialog');
  state.log.length = 0;
  await openCard('Dialog Anfrage Film');
  await pageLoaded();
  await ctx.run(`document.querySelector('.seerr-page .seerr-request').click()`);
  check('Anfrage auf der Seite: der Knopf weicht dem Stand "Angefragt"', await waitFor(`document.querySelector('.seerr-page .detail-tags .tag')?.textContent === 'Angefragt' && !document.querySelector('.seerr-page .seerr-request')`, 5000));
  check('...der Server bekam genau eine Anfrage', JSON.stringify(state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b)) === JSON.stringify([{ mediaType: 'movie', mediaId: 2468, is4k: false }]), JSON.stringify(state.log.map((l) => l.at)));
  await back('#/search');
  check('Zurueck in der Suche: die Karte zeigt ebenfalls "Angefragt"', (await cards()).find((c) => c.title === 'Dialog Anfrage Film')?.chip === 'Angefragt', JSON.stringify(await cards()));
  // ---------- Treffer in der Bibliothek: kein Seerr-Block ohne Treffer ----------
  await search('aurora');
  check('Treffer aus der Bibliothek, bei Seerr nichts dazu: keine Seerr-Gruppe', (await ctx.run(`!!document.querySelector('.search-group .card') && !document.querySelector('.seerr-group')`)));

  // ---------- Sitzung bei Seerr abgelaufen: eigene Meldung, kein Wechsel zur Jellyfin-Anmeldung ----------
  await search('mock');
  SEERR.expired = true;
  await ctx.run(`${reqBtn('Mock Quota Exceeded')}.click()`);
  check('Abgelaufene Seerr-Sitzung: Hinweis mit Weg in die Einstellungen', await waitFor(`/Seerr-Anmeldung abgelaufen/.test([...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' '))`, 4000), await toasts());
  await ctx.wait(600);
  check('Die Jellyfin-Anmeldung bleibt bestehen (kein Wechsel zum Login)', await ctx.run(`!document.querySelector('.login') && location.hash.startsWith('#/search')`), await ctx.run('location.hash'));
  await search('mock');
  check('Suche bei abgelaufener Sitzung: Hinweis statt Karten', await ctx.run(`/abgelaufen/.test(document.querySelector('.seerr-note')?.textContent ?? '') && !document.querySelector('.req-card')`));
  SEERR.expired = false;

  // ---------- Trennen, dann erneut verbinden (Adresse vorbelegt) ----------
  await go('#/settings/seerr');
  await clickText('.settings-panel .link-row.danger', 'Trennen');
  check('Trennen fragt nach und sagt, was dann fehlt', await waitFor(`/Seerr trennen\\?/.test(document.querySelector('.mdl')?.textContent ?? '') && /Anfragen/.test(document.querySelector('.mdl').textContent)`, 3000));
  await clickText('.mdl .btn', 'Trennen');
  check('Trennen: Zugangsdaten sind geloescht', await waitFor(`!!document.querySelector('.settings-panel input.field')`, 4000) && ctx.config.getSeerr() === null && !JSON.parse(raw()).servers.some((s) => s.seerr));
  await ctx.wait(300);
  check('...die Sitzung ist bei Seerr abgemeldet', SEERR.counters.logouts >= 1, String(SEERR.counters.logouts));
  check('...die Adresse steht zum erneuten Verbinden schon im Formular, der Benutzer auch', await ctx.run(`document.querySelector(${JSON.stringify(ADDR)}).value === 'http://127.0.0.1:8097' && document.querySelector(${JSON.stringify(ACCOUNT)}).value === 'demo'`));
  await search('mock');
  check('Nach dem Trennen keine Seerr-Gruppe mehr', await ctx.run(`!document.querySelector('.seerr-group, .req-card')`));
  await go('#/settings/seerr');
  await type('.settings-panel input[type=password]', 'demo');
  await clickText('.settings-panel [data-action="seerr-password"]', 'Mit Passwort verbinden'); // seit 1.2.25: Hauptknopf ist "Ohne Passwort verbinden"
  check('Erneut verbunden, ohne die Adresse noch einmal einzugeben', await waitFor(`!!(${connectedRow})`, 5000));
  state.log.length = 0;
  await search('thrones');
  check('Die Suche funktioniert wieder (Sitzung des Jellyfin-Kontos)', (await cards()).some((c) => c.title === 'Mock Thrones' && c.chip === 'Angefragt'), JSON.stringify(await cards()));
  // Meldungen der Konsole: erwartete Fehlerfaelle (500 der Details, 401, 403, 409) erscheinen als "Failed to load resource" nur bei Bildern, nie als Skriptfehler
  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler und keine Warnungen in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
