// Banner der Startseite: bis zu zwei gut bewertete Trend-Filme (Seerr) zwischen den Neuzugaengen (JC_DEV=1). Nutzt den Mock-Seerr des Mock-Servers.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-trend-hero.js
// Geprueft: ohne Seerr alles wie vorher; Seerr-Fehler und langsames Seerr (das Banner wartet nicht lange, nichts Falsches wird gemerkt); Auswahl (Bewertung ab 7, mit Hintergrundbild,
// Reihenfolge von Seerr, hoechstens zwei); Platz im Banner (Folien 3 und 5 von 6, ohne doppelte Eintraege); Folie fuer Titel ausserhalb der Bibliothek (Hintergrund von TMDB, Details,
// Anfragen); Zuordnung zur Bibliothek ueber die TMDB-Nummer ("Abspielen"); Trailer aus den Seerr-Details; Schalter; dass Banner und Reihe die Trend-Liste nur einmal holen.
// Die Liste im Speicher gilt zehn Minuten je Verbindung: Fehler und langsames Seerr kommen deshalb vor dem ersten erfolgreichen Laden.
const path = require('node:path');
const fs = require('node:fs');
const { server, state, SEERR, items } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  let pass = 0, fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) consoleErrors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  // Eigener Port: stoert sich nicht mit gleichzeitig laufenden Szenarien auf 8097, 8197 oder 8297; ein belegter Port bricht sofort ab statt zu haengen
  const PORT = 8397;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.win.setContentSize(1440, 900);
  await ctx.wait(500);
  // Ohne Trailer (die Aufbau-Pruefungen brauchen kein YouTube); die Trailer-Pruefung schaltet ihn spaeter ein
  ctx.config.updateSettings({ trailer: { autoplay: false, home: true, muted: true, delaySec: 0, quality: '1080', focusSec: 0 } });

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
  const type = (sel, value) => ctx.run(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const clickText = (sel, text) => ctx.run(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.innerText.includes(${JSON.stringify(text)}))?.click() ?? 'nicht gefunden'`);
  const trendCount = () => state.log.filter((l) => l.at === 'seerr:GET /discover/trending').length;
  const connectJellyfin = async () => {
    await go('#/settings/seerr');
    await type('.settings-panel input[placeholder="seerr.example.com"]', `127.0.0.1:${PORT}`);
    await type('.settings-panel input[type=password]', 'demo');
    await clickText('.settings-panel .btn.primary', 'Verbinden');
    return waitFor(`/Verbunden mit/.test(document.querySelector('.settings-panel .account-card')?.innerText ?? '')`, 6000);
  };
  // Startseite neu aufbauen lassen (wie nach einem Film) und warten, bis die Bibliotheks-Reihen stehen
  const rebuild = async () => {
    await ctx.run(`location.hash = '#/home'; document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(1500);
    return waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton)')`, 8000);
  };
  // Alle Folien des Banners mit dem, was sie zeigen
  const slides = () =>
    ctx.run(`[...document.querySelectorAll('.home .hero .hero-slide')].map((e, i) => ({
      i,
      label: e.querySelector('.hero-label')?.textContent ?? '',
      title: e.querySelector('.hero-title')?.textContent ?? e.querySelector('.hero-logo')?.alt ?? '',
      score: e.querySelector('.score')?.textContent ?? '',
      year: e.querySelector('.hero-meta span')?.textContent ?? '',
      bg: e.querySelector('.hero-bg img')?.getAttribute('src') ?? '',
      overview: e.querySelector('.hero-overview')?.textContent ?? '',
      actions: [...e.querySelectorAll('.hero-actions > .btn:not([hidden])')].map((b) => b.textContent.trim()),
      href: e.querySelector('.hero-actions a.btn')?.getAttribute('href') ?? '',
      tag: e.querySelector('.hero-meta .rating-box')?.textContent ?? ''
    }))`);
  const titles = (s) => s.map((x) => x.title);
  const trendOf = (s) => s.filter((x) => x.label === 'Im Trend');
  const trendLabels = () => ctx.run(`[...document.querySelectorAll('.home .hero .hero-label')].filter((l) => l.textContent === 'Im Trend').length`);
  const rowCards = () => ctx.run(`document.querySelectorAll('.home .trend-row .req-card').length`);

  // ---------- Ohne Seerr: das Banner bleibt wie es war ----------
  await go('#/home');
  check('Startseite steht', await waitFor(`!!document.querySelector('.home .hero .hero-slide') && !!document.querySelector('.home .rows .row:not(.skeleton)')`, 10000));
  let s = await slides();
  check('Ohne Seerr: sechs Folien, keine mit "Im Trend"', s.length === 6 && trendOf(s).length === 0, JSON.stringify(s.map((x) => [x.label, x.title])));
  check('Ohne Seerr wird Seerr nicht gefragt', trendCount() === 0);

  // ---------- Seerr verbunden, aber die Trend-Liste scheitert ----------
  SEERR.trendingError = true;
  check('Seerr verbunden (Anmeldung mit dem Jellyfin-Konto)', await connectJellyfin());
  state.log.length = 0;
  check('Neu aufgebaut (Seerr meldet bei den Trends einen Fehler)', await rebuild());
  await ctx.wait(1000);
  s = await slides();
  check('Seerr-Fehler: sechs Folien ohne "Im Trend", die Startseite ist trotzdem da', s.length === 6 && trendOf(s).length === 0, JSON.stringify(s.map((x) => x.label)));

  // ---------- Langsames Seerr: das Banner wartet nicht lange ----------
  SEERR.trendingError = false;
  SEERR.trendingDelay = 4500;
  state.log.length = 0;
  const t0 = Date.now();
  await ctx.run(`location.hash = '#/home'; document.dispatchEvent(new CustomEvent('relogin'))`);
  // Das alte Banner steht noch, bis die Seite neu aufgebaut wird: erst auf den Platzhalter warten, dann auf das neue Banner (sonst misst es nichts)
  const rebuilding = await waitFor(`!!document.querySelector('.home .hero-skeleton')`, 2500);
  const heroIn = await waitFor(`document.querySelectorAll('.home .hero:not(.hero-skeleton) .hero-slide').length > 0`, 6000);
  const heroMs = Date.now() - t0;
  s = await slides();
  check('Langsames Seerr (4,5 s je Seite): die Startseite wurde neu aufgebaut, das Banner steht nach hoechstens rund 3 s (nicht erst nach 4,5 s), ohne Trend-Folien', rebuilding && heroIn && heroMs > 1000 && heroMs < 3600 && s.length === 6 && trendOf(s).length === 0, `neu aufgebaut ${rebuilding}, ${heroMs} ms, ${s.length} Folien, ${trendOf(s).length} Trend`);
  check('...die Reihe kommt, sobald Seerr antwortet; das Banner bleibt unveraendert', (await waitFor(`document.querySelectorAll('.home .trend-row .req-card').length === 5`, 20000)) && (await trendLabels()) === 0);
  check('...drei Seiten, nur einmal gefragt', trendCount() === 3, `${trendCount()} Abfragen`);
  SEERR.trendingDelay = 0;

  // ---------- Liste da: die Trend-Folien ----------
  state.log.length = 0;
  check('Neu aufgebaut (Liste kommt aus dem Speicher)', await rebuild());
  check('Banner mit sechs Folien und die Reihe stehen', await waitFor(`document.querySelectorAll('.home .hero .hero-slide').length === 6 && document.querySelectorAll('.home .trend-row .req-card').length === 5`, 8000));
  check('Keine neue Abfrage an Seerr (Banner und Reihe holen die Liste zusammen nur einmal)', trendCount() === 0, `${trendCount()} Abfragen`);
  s = await slides();
  console.log('SLIDES ' + JSON.stringify(s.map((x) => [x.i, x.label, x.title, x.score, x.actions.join('/')])));
  const tr = trendOf(s);
  check('Sechs Folien, davon genau zwei "Im Trend" (hoechstens zwei)', s.length === 6 && tr.length === 2, `${s.length} Folien, ${tr.length} Trend`);
  check('Die Trend-Folien stehen an dritter und fuenfter Stelle, davor und dazwischen Neuzugaenge', JSON.stringify(s.map((x) => x.label === 'Im Trend')) === JSON.stringify([false, false, true, false, true, false]), JSON.stringify(s.map((x) => x.label)));
  check('Die Neuzugaenge heissen weiter "Neu hinzugefügt"', s.filter((x) => x.label !== 'Im Trend').every((x) => x.label === 'Neu hinzugefügt'), JSON.stringify(s.map((x) => x.label)));
  check('Gewaehlt sind die gut bewerteten in der Reihenfolge von Seerr (Trend Film Eins 7,9; Mock Arrival 8,1 = Paper Moons in der Bibliothek)', JSON.stringify(titles(tr)) === JSON.stringify(['Trend Film Eins', 'Paper Moons']), JSON.stringify(titles(tr)));
  check('Nicht im Banner: zu schlecht bewertet, ohne Bewertung, gesperrt, Serie, ueber dem Limit von zwei', !titles(s).some((x) => ['Trend Film Zwei', 'Mock Pending Story', 'Trend Gesperrt', 'Mock Thrones', 'Trend Film Drei'].includes(x)), JSON.stringify(titles(s)));
  check('Kein Titel doppelt im Banner (auch "Paper Moons" nicht noch einmal als Neuzugang)', new Set(titles(s)).size === s.length, JSON.stringify(titles(s)));

  // Folie fuer einen Titel ausserhalb der Bibliothek
  const a = s[2];
  check('Seerr-Folie: Titel, Bewertung mit einer Nachkommastelle, Jahr, Beschreibung', a.title === 'Trend Film Eins' && a.score === '7.9' && a.year === '2026' && /erste Trend-Film/.test(a.overview), JSON.stringify([a.title, a.score, a.year, a.overview]));
  check('Seerr-Folie: Hintergrund von TMDB in grosser Stufe ueber das App-Protokoll', a.bg === 'jellycloud://tmdb/w1280/trendbackdrop0001.jpg', a.bg);
  check('Seerr-Folie: "Details" und "Anfragen" (noch nichts angefragt, kein Stand)', JSON.stringify(a.actions) === JSON.stringify(['Details', 'Anfragen']) && a.tag === '', JSON.stringify([a.actions, a.tag]));
  // Folie fuer einen Titel aus der Bibliothek (Seerr: verfuegbar, ueber die TMDB-Nummer zugeordnet)
  const b = s[4];
  const paperMoons = [...items.values()].find((i) => i.Name === 'Paper Moons');
  check('Bibliotheks-Folie (ueber die TMDB-Nummer zugeordnet): der Film mit "Abspielen" und "Details" auf seine Seite', b.title === 'Paper Moons' && JSON.stringify(b.actions) === JSON.stringify(['Abspielen', 'Details']) && b.href === `#/item/${paperMoons.Id}`, JSON.stringify([b.title, b.actions, b.href]));
  check('Bibliotheks-Folie: mit dem Bild aus der Bibliothek (kein TMDB)', !!b.bg && !b.bg.startsWith('jellycloud://tmdb/'), b.bg);

  // ---------- Details und Anfragen aus dem Banner ----------
  const S3 = `document.querySelectorAll('.home .hero .hero-slide')[2]`; // die Folie von "Trend Film Eins"
  await ctx.run(`${S3}.querySelector('.hero-actions .btn.primary').click()`);
  check('"Details" oeffnet das Fenster zum Anfragen mit dem Titel', await waitFor(`document.querySelector('.rq .rq-title')?.textContent === 'Trend Film Eins'`, 4000));
  check('...die Details werden geladen (Seerr bekam die Abfrage)', (await waitFor(`!document.querySelector('.rq-loading')`, 4000)) && state.log.some((l) => l.at === 'seerr:GET /movie/7001'));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('...Esc schliesst es', await waitFor(`!document.querySelector('.rq .rq-title')`, 3000));
  await ctx.run(`[...${S3}.querySelectorAll('.hero-actions .btn')].find((b) => b.textContent.includes('Anfragen')).click()`);
  check('"Anfragen" im Banner: die Folie zeigt "Angefragt", der Knopf ist weg, Hinweis "wurde angefragt"', (await waitFor(`${S3}.querySelector('.hero-meta .rating-box')?.textContent === 'Angefragt' && ![...${S3}.querySelectorAll('.hero-actions .btn:not([hidden])')].some((b) => b.textContent.includes('Anfragen'))`, 5000)) && /wurde angefragt/.test(await ctx.run(`[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')`)));
  check('Der Server bekam genau diese eine Anfrage (Film 7001)', JSON.stringify(state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...x }) => x)) === JSON.stringify([{ mediaType: 'movie', mediaId: 7001 }]));
  check('Dieselbe Anfrage zeigt auch die Karte in der Reihe als "Angefragt" (gleiche Daten)', await ctx.run(`[...document.querySelectorAll('.home .trend-row .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Eins').querySelector('.req-status:not([hidden])')?.textContent === 'Angefragt'`));
  // Folien zeigen und aufnehmen
  await ctx.run(`document.querySelectorAll('.home .hero .hero-dots .dot')[2].click()`);
  await ctx.wait(1500);
  await ctx.capture(path.join(out, 'hero-trend-seerr.png'));
  await ctx.run(`document.querySelectorAll('.home .hero .hero-dots .dot')[4].click()`);
  await ctx.wait(1500);
  await ctx.capture(path.join(out, 'hero-trend-library.png'));
  SEERR.statuses.delete('movie:7001'); // fuer den Rest zuruecksetzen
  SEERR.requests.length = 0;

  // ---------- Trailer der Seerr-Folie aus den Details ----------
  state.log.length = 0;
  ctx.config.updateSettings({ trailer: { autoplay: true, home: true, muted: true, delaySec: 0, quality: '1080', focusSec: 0 } });
  check('Neu aufgebaut (Trailer an)', await rebuild());
  check('Banner steht mit den Trend-Folien', await waitFor(`document.querySelectorAll('.home .hero .hero-slide').length === 6 && [...document.querySelectorAll('.home .hero .hero-label')].filter((l) => l.textContent === 'Im Trend').length === 2`, 6000));
  await ctx.run(`document.querySelectorAll('.home .hero .hero-dots .dot')[2].click()`);
  check('Trailer-Rahmen der Seerr-Folie mit dem YouTube-Schluessel des Trailers (Teaser, anderer Anbieter und kaputter Schluessel werden uebergangen)', await waitFor(`!!document.querySelector('.home .hero .hero-slide.active iframe[src*="/embed/aqz-KE-bpKQ"]')`, 30000), await ctx.run(`document.querySelector('.home .hero .hero-slide.active iframe')?.src ?? 'kein Rahmen'`));
  check('Die Details kamen von Seerr (GET /movie/7001), ein einziges Mal', state.log.filter((l) => l.at === 'seerr:GET /movie/7001').length === 1, JSON.stringify(state.log.filter((l) => /seerr:GET \/movie/.test(l.at)).map((l) => l.at)));
  await ctx.capture(path.join(out, 'hero-trend-trailer.png'));
  ctx.config.updateSettings({ trailer: { autoplay: false } });

  // ---------- Schalter aus ----------
  state.log.length = 0;
  ctx.config.updateSettings({ appearance: { homeTrending: false } });
  check('Neu aufgebaut (Schalter aus)', await rebuild());
  await ctx.wait(800);
  s = await slides();
  check('Schalter "Filme im Trend" aus: keine Trend-Folie im Banner und keine Reihe', s.length === 6 && trendOf(s).length === 0 && (await rowCards()) === 0, JSON.stringify(s.map((x) => x.label)));
  check('...und Seerr wurde dafuer nicht gefragt', trendCount() === 0, `${trendCount()} Abfragen`);
  ctx.config.updateSettings({ appearance: { homeTrending: true } });

  // ---------- Quelltext ----------
  const rootDir = path.join(__dirname, '..', '..');
  const seerrSrc = fs.readFileSync(path.join(rootDir, 'src', 'main', 'seerr.js'), 'utf8');
  check('Quelltext: TMDB-Bildstufe w1280 ist freigegeben (Hintergrund im Banner)', /'w780', 'w1280'/.test(seerrSrc));

  check('Keine Konsolenfehler oder -warnungen', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  server.close();
};
