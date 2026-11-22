// Seite einer Person (P13, nach PersonView und CastRow der Apple-App), mit dem Mock-Server auf Port 8989:
//  - aus der Besetzung eines Titels der Mediathek: jede Person mit Kennung ist ein Verweis, die Seite zeigt Foto, Lebensdaten, Zahl der Titel, Biografie, die Titel
//    der Mediathek und darunter die Filmografie aus Seerr ohne diese Titel (Abgleich nur ueber die TMDB-Nummer), mit Jahr, Rolle und Stand
//  - aus der Besetzung eines Seerr-Titels: dieselbe Seite mit den Angaben von Seerr und, ueber die TMDB-Nummer gefunden, den Titeln der Mediathek
//  - Lebensdaten (gestorben, Alter), nur eine Gastrolle ("Folgen"), Person ohne Angaben (ein Administrator laesst einmal nachladen), unbekannte Person (Fehler)
//  - eine Anfrage aus der Filmografie: genau eine, danach mit Stand
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/person-page.js
const path = require('node:path');
const { server, state, SEERR, items, persons, setAdmin } = require('../mock-server');

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
  const PORT = 8989;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  ctx.win.setContentSize(1280, 860);
  await ctx.wait(400);
  SEERR.permissions = 32;
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' })).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
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
  const personId = (name) => [...persons.values()].find((p) => p.Name === name).Id;
  const page = (sel, prop = 'textContent') => ctx.run(`document.querySelector('.person-page ${sel}')?.${prop} ?? ''`);
  const facts = () => ctx.run(`[...document.querySelectorAll('.person-page .person-fact')].map((f) => f.textContent)`);
  const rows = () => ctx.run(`[...document.querySelectorAll('.person-page .person-rows .row')].map((r) => r.querySelector('h2').textContent + ': ' + [...r.querySelectorAll('.card .l1')].map((x) => x.textContent).join(', '))`);
  const rowTitles = () => ctx.run(`[...document.querySelectorAll('.person-page .person-rows .row h2')].map((h) => h.textContent)`);
  const cardLine = (title) => ctx.run(`[...document.querySelectorAll('.person-page .req-card')].find((c) => c.querySelector('.l1').textContent === ${JSON.stringify(title)})?.querySelector('.l2')?.textContent ?? ''`);
  const seerrGets = (p) => state.log.filter((l) => l.at === `seerr:GET ${p}`).length;
  const openPerson = async (hash, ready = `!!document.querySelector('.person-page .person-rows .row, .person-page .person-empty, .person-page .page-status')`) => {
    await go('#/home', `!!document.querySelector('.home')`);
    await go(hash, ready);
    await ctx.wait(700);
  };

  // ---------- Aus der Besetzung eines Titels der Mediathek ----------
  const paper = [...items.values()].find((i) => i.Name === 'Paper Moons');
  await go('#/home', `!!document.querySelector('.home')`);
  await go(`#/item/${paper.Id}`, `!!document.querySelector('.detail .cast-row')`);
  const cast = await ctx.run(`[...document.querySelectorAll('.detail .cast-row .person')].map((p) => ({ tag: p.tagName, n: p.querySelector('.l1').textContent, r: p.querySelector('.l2')?.textContent ?? '', href: p.getAttribute('href') }))`);
  const mara = personId('Mara Ellison');
  check('Besetzung der Mediathek: Schauspiel und Regie (ohne Drehbuch), je ein Verweis auf die Seite der Person', cast.length === 5 && cast.every((c) => c.tag === 'A') && cast[0].n === 'Mara Ellison' && cast[0].r === 'Captain Reyes' && cast[0].href === `#/person/${mara}` && cast.some((c) => c.n === 'Elise Fontaine' && c.r === 'Regie') && !cast.some((c) => c.n === 'Daniel Okafor'), JSON.stringify(cast));
  check('Personen der Besetzung sind per Tastatur erreichbar (Verweis mit Beschriftung "Name, Rolle")', await ctx.run(`(() => { const a = document.querySelector('.detail .cast-row a.person'); return a.tabIndex === 0 && a.getAttribute('aria-label') === 'Mara Ellison, Captain Reyes'; })()`));
  state.log.length = 0;
  await ctx.run(`document.querySelector('.detail .cast-row a.person').click()`);
  check('Klick auf die Person: ihre Seite, der Name steht sofort da', await waitFor(`location.hash === '#/person/${mara}' && document.querySelector('.person-page .person-name')?.textContent === 'Mara Ellison'`, 2000), await ctx.run('location.hash'));
  await waitFor(`document.querySelectorAll('.person-page .person-rows .row').length >= 5`, 8000);
  await ctx.wait(900);
  const f1 = await facts();
  check('Lebensdaten: Tag aus der Mediathek richtig (1980-04-06T23:00Z = 7. April), Geburtsort gekuerzt, Alter', f1[0] === 'Geboren am 7. April 1980 in Norwood, London' && /^\d{2} Jahre alt$/.test(f1[1] ?? ''), JSON.stringify(f1));
  const libMovies = [...items.values()].filter((i) => i.Type === 'Movie').length;
  const libSeries = [...items.values()].filter((i) => i.Type === 'Series').length;
  check('Zahl der Titel der Mediathek als Kapsel', (await page('.person-badge')) === `${libMovies} Filme und ${libSeries} Serien in deiner Bibliothek`, await page('.person-badge'));
  check('Biografie aus der Mediathek, Foto ueber den Server', (await page('.person-bio .overview')) === 'Mara Ellison ist eine Testperson der Mediathek.' && /^jellycloud:\/\/img\/[0-9a-f]{32}\/Primary\?/.test(await page('.person-photo img', 'getAttribute("src")')), await page('.person-photo img', 'getAttribute("src")'));
  check('Reihen: zuerst die Mediathek, darunter die Filmografie aus Seerr', JSON.stringify(await rowTitles()) === JSON.stringify(['Filme', 'Serien', 'Weitere Filme', 'Weitere Serien', 'Hinter der Kamera']), JSON.stringify(await rowTitles()));
  const r1 = await rows();
  check('Filmografie ohne die Titel der Mediathek (TMDB 4242 = Paper Moons, 1399 = Starfall Station), Bekanntes zuerst, gleiche Titel einmal', r1[2] === 'Weitere Filme: Mock Matrix Resurrection, Trend Film Drei' && r1[3] === 'Weitere Serien: Wintersignale' && r1[4] === 'Hinter der Kamera: Trend Film Eins', JSON.stringify(r1.slice(2)));
  check('Unter dem Titel Jahr und Rolle (zusammengefasst), hinter der Kamera die Aufgaben', (await cardLine('Mock Matrix Resurrection')) === '2021 · Captain Reyes, Erzählerin' && (await cardLine('Trend Film Eins')) === '2026 · Regie, Drehbuch', `${await cardLine('Mock Matrix Resurrection')} | ${await cardLine('Trend Film Eins')}`);
  check('Stand bei Seerr auf der Karte ("Wintersignale" teilweise da)', await ctx.run(`!![...document.querySelectorAll('.person-page .req-card')].find((c) => c.querySelector('.l1').textContent === 'Wintersignale')?.querySelector('.req-status .tag')`));
  check('Seerr: nur die Filmografie, die Person selbst nicht (die Mediathek hat Biografie, Tag und Foto)', seerrGets('/person/9202/combined_credits') === 1 && seerrGets('/person/9202') === 0, JSON.stringify(state.log.filter((l) => /person/.test(l.at ?? '')).map((l) => l.at)));
  await ctx.capture(path.join(out, 'P-01-person-mediathek.png'));

  // Anfrage aus der Filmografie: genau eine, danach mit Stand; die Seite liest die Staende neu
  state.log.length = 0;
  await ctx.run(`[...document.querySelectorAll('.person-page .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Drei').querySelector('.req-actions .btn').click()`);
  await waitFor(`!![...document.querySelectorAll('.person-page .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Drei')?.querySelector('.req-status .tag')`, 5000);
  await ctx.wait(600);
  const bodies = state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b);
  check('Anfrage aus der Filmografie: genau eine, nie 4K; die Karte zeigt danach den Stand', JSON.stringify(bodies) === JSON.stringify([{ mediaType: 'movie', mediaId: 7003, is4k: false }]), JSON.stringify(bodies));
  check('Danach liest die Seite die Staende der Filmografie neu, die Reihen bleiben stehen', seerrGets('/person/9202/combined_credits') === 1 && (await rows()).length === 5);

  // Ein Titel der Filmografie oeffnet seine Seite bei Seerr
  await ctx.run(`[...document.querySelectorAll('.person-page .req-card')].find((c) => c.querySelector('.l1').textContent === 'Wintersignale').querySelector('.thumb').click()`);
  check('Karte der Filmografie: die Seite des Titels bei Seerr', await waitFor(`location.hash === '#/seerr/tv/2001'`, 4000), await ctx.run('location.hash'));

  // ---------- Aus der Besetzung eines Seerr-Titels ----------
  await waitFor(`!!document.querySelector('.seerr-page .cast-row')`, 8000);
  await ctx.wait(500);
  const seerrCast = await ctx.run(`[...document.querySelectorAll('.seerr-page .cast-row .person')].map((p) => ({ tag: p.tagName, n: p.querySelector('.l1').textContent, href: p.getAttribute('href') }))`);
  check('Besetzung eines Seerr-Titels: Personen mit Nummer fuehren auf ihre Seite (#/person/tmdb/...)', seerrCast.some((c) => c.n === 'Mara Ellison' && c.tag === 'A' && c.href === '#/person/tmdb/9202'), JSON.stringify(seerrCast));
  state.log.length = 0;
  await ctx.run(`[...document.querySelectorAll('.seerr-page .cast-row a.person')].find((p) => p.querySelector('.l1').textContent === 'Mara Ellison').click()`);
  await waitFor(`location.hash === '#/person/tmdb/9202' && document.querySelectorAll('.person-page .person-rows .row').length >= 5`, 8000);
  await ctx.wait(900);
  check('Seerr-Person: Angaben von Seerr (Biografie, Geburtstag, Ort)', (await page('.person-bio .overview')) === 'Mara Ellison ist eine Testperson des Mock-Seerr.' && (await facts())[0] === 'Geboren am 1. Mai 1980 in Mockstadt', JSON.stringify(await facts()));
  const lookups = state.log.filter((l) => l.at === '/Persons');
  check('Die Person der Mediathek ueber den Namen gesucht, aber ueber die TMDB-Nummer zugeordnet: ihre Titel stehen da', lookups.length === 1 && lookups[0].searchTerm === 'Mara Ellison' && lookups[0].fields === 'ProviderIds' && JSON.stringify(await rowTitles()) === JSON.stringify(['Filme', 'Serien', 'Weitere Filme', 'Weitere Serien', 'Hinter der Kamera']), JSON.stringify(lookups));
  await ctx.capture(path.join(out, 'P-02-person-seerr.png'));

  await openPerson('#/person/tmdb/9101', `document.querySelectorAll('.person-page .person-rows .row').length >= 1`);
  check('Seerr-Person ohne Gegenstueck in der Mediathek: "Filme" aus Seerr, keine Kapsel', JSON.stringify(await rows()) === JSON.stringify(['Filme: Mock Matrix Resurrection']) && (await ctx.run(`document.querySelector('.person-page .person-badge').hidden`)), JSON.stringify(await rows()));
  check('Ohne Foto die Initialen (erstes und letztes Wort, wie in der Besetzung)', (await page('.person-photo .initial')) === 'ME' && (await ctx.run(`document.querySelector('.person-page .person-photo-img').classList.contains('noimg')`)), await page('.person-photo .initial'));

  await openPerson('#/person/tmdb/424242');
  check('Unbekannte Person: "Person nicht geladen", Grund in der Sprache der App, "Erneut versuchen"; kein leerer Kopf', (await page('.page-status h3')) === 'Person nicht geladen' && (await page('.page-status p')) === 'Seerr kennt diese Person nicht.' && !!(await page('.page-status .btn')) && (await ctx.run(`document.querySelector('.person-page .person-head').hidden`)), await page('.page-status'));
  await ctx.capture(path.join(out, 'P-05-unbekannt.png'));

  // ---------- Lebensdaten, Gastrolle, Person ohne Angaben ----------
  await openPerson(`#/person/${personId('Elise Fontaine')}`);
  check('Gestorben: beide Tage richtig, Alter beim Tod', JSON.stringify(await facts()) === JSON.stringify(['Geboren am 7. April 1918 in Lyon, Auvergne-Rhône-Alpes', 'Gestorben am 19. Dezember 1996 (78 Jahre)']), JSON.stringify(await facts()));
  await ctx.capture(path.join(out, 'P-03-lebensdaten.png'));

  await openPerson(`#/person/${personId('Nadia Gast')}`);
  check('Nur eine Gastrolle: Reihe "Folgen" (breite Karte), "1 Titel in deiner Bibliothek"', JSON.stringify(await rowTitles()) === JSON.stringify(['Folgen']) && (await ctx.run(`!!document.querySelector('.person-page .row .card.landscape')`)) && (await page('.person-badge')) === '1 Titel in deiner Bibliothek', `${JSON.stringify(await rows())} | ${await page('.person-badge')}`);
  await ctx.capture(path.join(out, 'P-04-gastrolle.png'));

  state.log.length = 0;
  await openPerson(`#/person/${personId('Tomas Berg')}`);
  await ctx.wait(1800);
  check('Ohne Angaben und ohne Verwaltungsrechte: keine Bitte an den Server, keine Biografie, keine Lebensdaten', !state.log.some((l) => l.at === 'Refresh') && (await ctx.run(`document.querySelector('.person-page .person-bio').hidden`)) && (await facts()).length === 0);

  setAdmin(true);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`, 6000);
  await ctx.wait(800);
  state.log.length = 0;
  const jonas = personId('Jonas Whitfield');
  await openPerson(`#/person/${jonas}`);
  check('Administrator, Person ohne Angaben: der Server soll einmal nachladen (nichts ersetzen)', await waitFor(`true`, 10) && state.log.filter((l) => l.at === 'Refresh' && l.itemId === jonas).length === 1 && state.log.find((l) => l.at === 'Refresh')?.query?.replaceAllMetadata === 'false' && state.log.find((l) => l.at === 'Refresh')?.query?.imageRefreshMode === 'Default', JSON.stringify(state.log.filter((l) => l.at === 'Refresh')));
  check('Danach stehen die nachgeladenen Angaben da', await waitFor(`document.querySelector('.person-page .person-bio .overview')?.textContent === 'Vom Server nachgeladen.'`, 6000) && (await facts())[0] === 'Geboren am 1. Oktober 1975', JSON.stringify(await facts()));
  setAdmin(false);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`, 6000);

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
