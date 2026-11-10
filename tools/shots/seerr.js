// Seerr-Anbindung (JC_DEV=1): Verbinden (Jellyfin-Konto und API-Schluessel), Suche, Anfragen, Fehlerfaelle, Trennen. Nutzt den Mock-Seerr des Mock-Servers.
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
  check('Formular: Adresse, Benutzer (vorbelegt mit dem Jellyfin-Konto), Passwort', await ctx.run(`document.querySelectorAll('.settings-panel input.field').length === 4 && document.querySelector('.settings-panel input[placeholder="Benutzername"]')?.value === 'demo'`));
  const visibleFields = () => ctx.run(`[...document.querySelectorAll('.settings-panel input.field')].filter((i) => !i.closest('[hidden]')).map((i) => i.type)`);
  check('Jellyfin-Modus zeigt Adresse, Benutzer, Passwort (nicht den Schluessel)', JSON.stringify(await visibleFields()) === JSON.stringify(['text', 'text', 'password']), JSON.stringify(await visibleFields()));
  await ctx.capture(path.join(out, 'S-01-seerr-settings.png'));
  await type('.settings-panel input[placeholder="seerr.example.com"]', '127.0.0.1:8097');
  await type('.settings-panel input[type=password]', 'falsch');
  await clickText('.settings-panel .btn.primary', 'Verbinden');
  check('Falsches Passwort: Fehlermeldung, nicht verbunden', await waitFor(`/abgelehnt/.test(document.querySelector('.settings-panel .form-error')?.textContent ?? '')`, 6000), await ctx.run(`document.querySelector('.settings-panel .form-error')?.textContent`));
  check('...und die Jellyfin-Anmeldung bleibt davon unberuehrt', await ctx.run(`!document.querySelector('.login')`));
  await type('.settings-panel input[type=password]', 'demo');
  await clickText('.settings-panel .btn.primary', 'Verbinden');
  check('Verbunden: Statuszeile mit Adresse und Benutzer', await waitFor(`/Verbunden mit http:\\/\\/127\\.0\\.0\\.1:8097 als Demo/.test(document.querySelector('.settings-panel .account-card')?.innerText ?? '')`, 6000), await ctx.run(`document.querySelector('.settings-panel .account-card')?.innerText`));
  const saved = ctx.config.getSeerr();
  check('Zugangsdaten gespeichert (entschluesselt: Session-Cookie), Modus Jellyfin', saved?.secret === 'mock-seerr-sid' && saved?.mode === 'jellyfin', JSON.stringify({ mode: saved?.mode, user: saved?.userName }));
  check('Session-Cookie steht nicht im Klartext in der Konfigurationsdatei', !raw().includes('mock-seerr-sid'));
  const pub = await ctx.run(`window.jc.getState().then((s) => JSON.stringify(s.seerr))`);
  check('Oberflaeche bekommt keine Zugangsdaten', !/mock-seerr-sid/.test(pub) && JSON.parse(pub).url === 'http://127.0.0.1:8097', pub);

  // ---------- Suche: Titel, die es nicht in der Bibliothek gibt ----------
  await search('mock');
  const found = await cards();
  const by = Object.fromEntries(found.map((c) => [c.title, c]));
  check('Suche zeigt die Seerr-Treffer als Gruppe "Bei Seerr anfragen"', (await ctx.run(`document.querySelector('.seerr-group h2')?.textContent`)) === 'Bei Seerr anfragen');
  check('Hinweis, dass nichts in der Bibliothek gefunden wurde', await ctx.run(`/nicht gefunden/.test(document.querySelector('.seerr-note')?.textContent ?? '')`));
  check('Verfuegbare Titel und Personen fehlen, die anderen sind da (4 Karten)', found.length === 4 && !by['Mock Arrival'] && !by['Mock Person'], found.map((c) => c.title).join(', '));
  check('Neue Titel haben die Schaltflaeche "Anfragen", keine Beschriftung', by['Mock Matrix Resurrection']?.canRequest && by['Mock Matrix Resurrection']?.chip === '');
  check('Schon angefragter Titel zeigt "Angefragt" und keine Schaltflaeche', by['Mock Pending Story']?.chip === 'Angefragt' && !by['Mock Pending Story']?.canRequest);
  check('Poster laufen ueber das App-Protokoll (TMDB, feste Groesse)', by['Mock Matrix Resurrection']?.img === 'jellycloud://tmdb/w342/mockposter0001.jpg', by['Mock Matrix Resurrection']?.img);
  await ctx.capture(path.join(out, 'S-02-seerr-search.png'));

  // ---------- Details beim Anklicken einer Karte ----------
  const openCard = async (title) => {
    await ctx.run(`[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)}).querySelector('.thumb').click()`);
    await ctx.wait(150);
  };
  const dlg = (sel, prop = 'textContent') => ctx.run(`document.querySelector('.rq ${sel}')?.${prop} ?? ''`);
  const dlgLoaded = () => waitFor(`!!document.querySelector('.rq') && !document.querySelector('.rq-loading')`, 5000);
  const closeDlg = async () => {
    await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    return waitFor(`!document.querySelector('.rq-scrim')`, 2000);
  };
  check('Karten sind anklickbar: Poster mit Hand-Cursor und Tastaturfokus, Rolle "button" mit Beschriftung', await ctx.run(`(() => { const t = document.querySelector('.req-card .thumb'); const s = getComputedStyle(t); return s.cursor === 'pointer' && t.tabIndex === 0 && t.getAttribute('role') === 'button' && /Details zu/.test(t.getAttribute('aria-label')); })()`));
  state.log.length = 0;
  await openCard('Mock Matrix Resurrection');
  check('Klick auf die Karte oeffnet ein Detailfenster (Dialog mit Titel)', await waitFor(`!!document.querySelector('.rq[role=dialog][aria-modal=true] .rq-title')`, 3000) && (await dlg('.rq-title')) === 'Mock Matrix Resurrection');
  check('Sofort sichtbar, was die Suche schon kennt: Beschreibung und Poster', (await dlg('.rq-overview')).includes('Ein Testfilm aus dem Mock-Katalog.') && (await dlg('.rq-poster img', 'getAttribute("src")')) === 'jellycloud://tmdb/w342/mockposter0001.jpg');
  check('Details werden nachgeladen (genau eine Abfrage /movie/603)', (await dlgLoaded()) && state.log.filter((l) => l.at === 'seerr:GET /movie/603').length === 1, JSON.stringify(state.log.map((l) => l.at)));
  check('Kopfzeile: Jahr, Typ, Laufzeit und Bewertung', (await dlg('.rq-meta')).replace(/\s+/g, ' ').trim() === '2021 · Film · 148 Min.★ 7.3', await dlg('.rq-meta'));
  check('Genres als Marken, Tagline und Regie', (await ctx.run(`[...document.querySelectorAll('.rq .rq-chip')].map((c) => c.textContent).join(',')`)) === 'Science Fiction,Action' && (await dlg('.rq-tagline')) === 'Zurueck im Mock.' && /Regie.*Mock Regisseurin/.test(await dlg('.rq-facts')), await dlg('.rq-facts'));
  check('Hintergrundbild ueber das App-Protokoll (w780)', (await dlg('.rq-hero-bd img', 'getAttribute("src")')) === 'jellycloud://tmdb/w780/mockbackdrop001.jpg', await dlg('.rq-hero-bd img', 'getAttribute("src")'));
  const cast = await ctx.run(`[...document.querySelectorAll('.rq .rq-person')].map((p) => ({ n: p.querySelector('.n').textContent, c: p.querySelector('.c')?.textContent ?? '', img: p.querySelector('img')?.getAttribute('src') ?? '', init: p.querySelector('.fallback-title')?.textContent ?? '' }))`);
  check('Besetzung: Name, Rolle und Bild (w185), ohne Bild die Initialen', cast.length === 3 && cast[0].n === 'Mock Actor Eins' && cast[0].c === 'Neo' && cast[0].img === 'jellycloud://tmdb/w185/mockprofile001.jpg' && cast[1].img === '' && cast[1].init === 'MZ', JSON.stringify(cast));
  check('Neuer Titel: im Fenster die Schaltflaeche "Anfragen", kein Stand', (await dlg('.rq-actions button', 'textContent')).includes('Anfragen') && !(await dlg('.rq-status')));
  // Die Bilder des Mock-Katalogs gibt es bei TMDB nicht: sie scheitern, und dann muessen Initialen stehen statt leerer Kreise, das verwischte Poster bleibt Kopfbild
  check('Besetzung: Fotos, die nicht laden, zeigen die Initialen (keine leeren Kreise)', await waitFor(`[...document.querySelectorAll('.rq .rq-person')].every((p) => p.querySelector('.fallback-title')?.textContent)`, 20000), await ctx.run(`[...document.querySelectorAll('.rq .rq-person')].map((p) => p.querySelector('.fallback-title')?.textContent ?? '-').join(',')`));
  check('Kopfbild: ein fehlgeschlagenes Hintergrundbild verdeckt das verwischte Poster nicht (keine eigene Flaeche)', await ctx.run(`[...document.querySelectorAll('.rq-hero .imgbox')].length === 2 && [...document.querySelectorAll('.rq-hero .imgbox')].every((b) => getComputedStyle(b).backgroundImage === 'none' && getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)')`));
  check('Fokus liegt auf dem Schliessen-Kreuz (Tastatur)', await ctx.run(`document.activeElement?.classList.contains('rq-close')`));
  check('Hintergrund ist abgeblendet, die Karten dahinter sind unveraendert (Anfragen-Knopf der Karte nicht ausgeloest)', (await cards()).find((c) => c.title === 'Mock Matrix Resurrection')?.canRequest === true && !state.log.some((l) => l.at === 'seerr:request-body'));
  await ctx.capture(path.join(out, 'S-04-seerr-detail.png'));
  check('Esc schliesst das Fenster', await closeDlg());
  check('...und der Fokus kehrt zum Poster der Karte zurueck', await ctx.run(`document.activeElement?.classList.contains('thumb') && document.activeElement.closest('.req-card')?.querySelector('.l1')?.textContent === 'Mock Matrix Resurrection'`));
  await ctx.run(`(() => { const t = [...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Thrones').querySelector('.thumb'); t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  check('Enter auf dem fokussierten Poster oeffnet die Details ebenfalls (Serie)', await waitFor(`document.querySelector('.rq .rq-title')?.textContent === 'Mock Thrones'`, 3000) && (await dlgLoaded()));
  check('Serie: Jahr, Typ, Laufzeit, Staffeln, Folgen und "Erstellt von"', (await dlg('.rq-meta')).replace(/\s+/g, ' ').includes('2011 · Serie · 57 Min. · 8 Staffeln · 73 Folgen') && /Erstellt von.*Mock Erfinder, Mock Erfinderin/.test(await dlg('.rq-facts')) && /Stand.*Ended/.test(await dlg('.rq-facts')), `${await dlg('.rq-meta')} | ${await dlg('.rq-facts')}`);
  await ctx.run(`document.querySelector('.rq-scrim').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  check('Klick neben das Fenster schliesst es', await waitFor(`!document.querySelector('.rq-scrim')`, 2000));
  await openCard('Mock Pending Story');
  check('Schon angefragter Titel: im Fenster der Stand "Angefragt" statt Schaltflaeche, ohne Poster der Titel als Ersatz', (await dlgLoaded()) && (await dlg('.rq-status')) === 'Angefragt' && !(await dlg('.rq-actions button')) && (await dlg('.rq-poster .fallback-title')) === 'Mock Pending Story' && (await dlg('.rq-overview')) === 'Wartet schon auf Freigabe.');
  check('Ohne Besetzung bleibt der Besetzungsbereich weg', await ctx.run(`document.querySelector('.rq .rq-cast')?.hidden === true`));
  await closeDlg();
  await openCard('Mock Quota Exceeded');
  check('Schlaegt das Laden der Details fehl (500): Hinweis mit der Meldung, Beschreibung und Anfragen-Knopf bleiben', await waitFor(`/Details nicht verfuegbar/.test(document.querySelector('.rq .rq-note')?.textContent ?? '')`, 5000) && !!(await dlg('.rq-actions button')), await dlg('.rq-note'));
  await ctx.capture(path.join(out, 'S-05-seerr-detail-error.png'));
  await closeDlg();
  check('Der Anfragen-Knopf der Karte liegt ausserhalb von Poster und Beschriftung (sein Klick oeffnet keine Details)', await ctx.run(`!document.querySelector('.req-card .thumb .req-actions, .req-card .meta .req-actions') && !!document.querySelector('.req-card .req-actions button')`));
  SEERR.expired = true;
  await openCard('Mock Matrix Resurrection');
  check('Abgelaufene Seerr-Sitzung beim Laden der Details: Hinweis mit Weg in die Einstellungen, Anmeldung bei Jellyfin bleibt', await waitFor(`/abgelaufen/.test(document.querySelector('.rq .rq-note')?.textContent ?? '') && !!document.querySelector('.rq .rq-note .link-btn')`, 5000) && (await ctx.run(`!document.querySelector('.login')`)), await dlg('.rq-note'));
  await closeDlg();
  SEERR.expired = false;

  // ---------- Anfragen ----------
  state.log.length = 0;
  const reqBtn = (title) => `[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)}).querySelector('.req-actions button')`;
  await ctx.run(`${reqBtn('Mock Matrix Resurrection')}.click()`);
  check('Film anfragen: Beschriftung wechselt zu "Angefragt"', await waitFor(`[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Matrix Resurrection').querySelector('.req-status:not([hidden])')?.textContent === 'Angefragt'`, 5000));
  check('Hinweis "wurde angefragt"', /wurde angefragt/.test(await toasts()), await toasts());
  await ctx.run(`${reqBtn('Mock Thrones')}.click()`);
  await waitFor(`[...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Thrones').querySelector('.req-status:not([hidden])')`, 5000);
  const bodies = state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b);
  check('Server bekommt Film ohne Staffeln und Serie mit allen Staffeln', JSON.stringify(bodies) === JSON.stringify([{ mediaType: 'movie', mediaId: 603 }, { mediaType: 'tv', mediaId: 1399, seasons: 'all' }]), JSON.stringify(bodies));
  await ctx.run(`${reqBtn('Mock Quota Exceeded')}.click()`);
  check('Kontingent erreicht (403): verstaendliche Meldung, Schaltflaeche bleibt', (await waitFor(`/Kontingent/.test([...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' '))`, 4000)) && (await cards()).find((c) => c.title === 'Mock Quota Exceeded')?.canRequest, await toasts());
  await ctx.capture(path.join(out, 'S-03-seerr-requested.png'));

  // ---------- Anfragen aus dem Detailfenster ----------
  await search('dialog');
  state.log.length = 0;
  await openCard('Dialog Anfrage Film');
  await dlgLoaded();
  await ctx.run(`document.querySelector('.rq .rq-actions button').click()`);
  check('Anfrage im Detailfenster: Schaltflaeche wird zum Stand "Angefragt"', await waitFor(`document.querySelector('.rq .rq-status')?.textContent === 'Angefragt' && !document.querySelector('.rq .rq-actions button')`, 5000));
  check('...die Karte dahinter zeigt ebenfalls "Angefragt", der Server bekam genau eine Anfrage', (await cards()).find((c) => c.title === 'Dialog Anfrage Film')?.chip === 'Angefragt' && JSON.stringify(state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b)) === JSON.stringify([{ mediaType: 'movie', mediaId: 2468 }]), JSON.stringify(state.log.map((l) => l.at)));
  check('...und der Hinweis "wurde angefragt" erscheint', /wurde angefragt/.test(await toasts()), await toasts());
  await closeDlg();
  await openCard('Dialog Anfrage Film');
  check('Erneut geoeffnet: der Stand ist schon "Angefragt" (auch aus den frisch geladenen Details)', (await dlgLoaded()) && (await dlg('.rq-status')) === 'Angefragt');
  check('Das Fenster ist offen, bevor die Seite gewechselt wird', await ctx.run(`!!document.querySelector('.rq-scrim')`));
  await go('#/home');
  await ctx.wait(400);
  check('Beim Seitenwechsel schliesst sich das Detailfenster von selbst', await ctx.run(`!document.querySelector('.rq-scrim')`));

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

  // ---------- Trennen, dann mit API-Schluessel verbinden ----------
  await go('#/settings/seerr');
  await clickText('.settings-panel .btn.danger', 'Trennen');
  check('Trennen: Zugangsdaten sind geloescht', await waitFor(`!!document.querySelector('.settings-panel input.field')`, 4000) && ctx.config.getSeerr() === null);
  await search('mock');
  check('Nach dem Trennen keine Seerr-Gruppe mehr', await ctx.run(`!document.querySelector('.seerr-group, .req-card')`));
  await go('#/settings/seerr');
  await clickText('.settings-panel button.seg', 'API-Schlüssel');
  await ctx.wait(300);
  check('API-Schluessel-Modus zeigt das Schluesselfeld statt Benutzer/Passwort', JSON.stringify(await visibleFields()) === JSON.stringify(['text', 'password']), JSON.stringify(await visibleFields()));
  await type('.settings-panel input[placeholder="seerr.example.com"]', 'http://127.0.0.1:8097');
  await type('.settings-panel input[placeholder="API-Schlüssel"]', 'falscher-schluessel');
  await clickText('.settings-panel .btn.primary', 'Verbinden');
  check('Falscher Schluessel wird abgelehnt', await waitFor(`/abgelehnt/.test(document.querySelector('.settings-panel .form-error')?.textContent ?? '')`, 5000), await ctx.run(`document.querySelector('.settings-panel .form-error')?.textContent`));
  await type('.settings-panel input[placeholder="API-Schlüssel"]', SEERR.apiKey);
  await clickText('.settings-panel .btn.primary', 'Verbinden');
  check('Mit gueltigem Schluessel verbunden (Konto des Schluessels)', await waitFor(`/als Schluessel-Konto/.test(document.querySelector('.settings-panel .account-card')?.innerText ?? '')`, 5000) && ctx.config.getSeerr()?.mode === 'apikey');
  state.log.length = 0;
  await search('thrones');
  check('Mit Schluessel funktioniert die Suche (Header X-Api-Key)', (await cards()).some((c) => c.title === 'Mock Thrones' && c.chip === 'Angefragt'), JSON.stringify(await cards()));

  // Meldungen der Konsole: erwartete Fehlerfaelle (500 der Details, 401, 403, 409) erscheinen als "Failed to load resource" nur bei Bildern, nie als Skriptfehler
  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler und keine Warnungen in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
