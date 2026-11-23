// Startseite und Top 10 (P15, nach HomeStore, TopTenRow, TopTenAura und TopTenSettings der Apple-App), mit dem Mock-Server auf Port 8987:
//  - ohne Seerr: keine Seerr-Reihen, kein Hinweis zum Einrichten, keine Anfrage an Seerr; im Editor stehen die Seerr-Reihen ausgeschaltet
//  - Banner nur Neues aus der Mediathek (Filme und Serien abwechselnd), keine Trend-Folien
//  - mit Seerr: Top 10 Filme und Top 10 Serien (nur Titel der Mediathek, Reihenfolge der Trends), Rangziffern mit Rand und Schein in der Glow-Farbe des
//    Bereichs, ohne Glow farblos; Platzhalter nur beim ersten Laden; Zeitraum in den Einstellungen mit "Aktuell"
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/top-ten.js
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
  const PORT = 8987;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  ctx.win.setContentSize(1440, 900);
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
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
  /** Arbeitsspeicher (privat, MB): der Seitenprozess und alle zusammen. Der Grafikprozess schwankt in der VM (Software-Grafik) bei jeder Aenderung um
   *  rund 100 MB; verglichen wird deshalb der Seitenprozess, unter gleichen Schritten (Aufbau, einmal hinunter und wieder hinauf scrollen). */
  const memory = () => {
    const m = ctx.app.getAppMetrics();
    const sum = (pick) => Math.round(m.filter(pick).reduce((s, p) => s + (p.memory.privateBytes ?? 0), 0) / 1024);
    return { page: sum((p) => p.type === 'Tab'), all: sum(() => true) };
  };
  const measureHome = async (hidden) => {
    await ctx.run(`window.jc.setSettings({ home: { hidden: ${JSON.stringify(hidden)} } })`);
    await rebuildHome();
    for (const y of [700, 1400, 2100, 0]) {
      await ctx.run(`document.querySelector('#view').scrollTo({ top: ${y} })`);
      await ctx.wait(700);
    }
    await ctx.wait(3000);
    return memory();
  };
  const seerrCalls = () => state.log.filter((l) => /^seerr:/.test(l.at)).length;
  const rowTitles = () => ctx.run(`[...document.querySelectorAll('.home .rows > .row h2')].map((h) => h.textContent)`);
  const topCards = (kind) => ctx.run(`[...document.querySelectorAll('.home .top10-row[data-kind=${kind}] .t10-card:not(.ph) .meta .l1')].map((x) => x.textContent)`);
  const rebuildHome = async () => {
    await go('#/settings/home', `!!document.querySelector('.home-rows')`);
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await waitFor(`!!document.querySelector('.topbar')`, 9000);
    await go('#/home', `!!document.querySelector('.home .rows .row')`);
    await ctx.wait(600);
  };

  // ---------- Ohne Seerr ----------
  state.log.length = 0;
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  await ctx.wait(1200);
  const titles0 = await rowTitles();
  check('Ohne Seerr: weder Top 10 noch "Filme im Trend" noch ein Hinweis zum Einrichten; keine Anfrage an Seerr', !titles0.some((x) => /Top 10|Trend/.test(x)) && !(await ctx.run(`!!document.querySelector('.trend-hint, .top10-row')`)) && seerrCalls() === 0, JSON.stringify(titles0));
  const labels = await ctx.run(`[...document.querySelectorAll('.home .hero-slide .hero-label')].map((x) => x.textContent)`);
  check('Banner: nur Neues aus der Mediathek, Filme und Serien abwechselnd (6 Folien)', labels.length === 6 && labels[0] === 'Neu in Filme' && labels[1] === 'Neu in Serien' && labels.every((x) => /^Neu in (Filme|Serien)$/.test(x)), JSON.stringify(labels));
  await go('#/settings/home', `!!document.querySelector('.home-rows')`);
  const editor0 = await ctx.run(`[...document.querySelectorAll('.home-row')].map((r) => r.dataset.row + (r.classList.contains('locked') ? ':locked' : '') + (r.querySelector('.switch').disabled ? ':disabled' : ''))`);
  check('Editor ohne Seerr: Top 10 und Trend stehen ausgeschaltet und gesperrt da, mit Grund', ['top10Movies', 'top10Series', 'trending'].every((id) => editor0.includes(`${id}:locked:disabled`)) && /nur mit Seerr/.test(await ctx.run(`document.querySelector('.home-rows-note').textContent`)), JSON.stringify(editor0));
  check('Kein Regler "Trend-Filme im Banner" mehr; Top 10: "Seerr ist nicht verbunden"', !(await ctx.run(`/Trend-Filme im Banner/.test(document.querySelector('.settings-panel').innerText)`)) && /Seerr ist nicht verbunden/.test(await ctx.run(`document.querySelector('.top10-settings').innerText`)));

  // ---------- Mit Seerr ----------
  SEERR.permissions = 32;
  SEERR.trendingDelay = 1500; // die erste Rangliste kommt spaet: Platzhalter sind zu sehen
  await ctx.run(`window.jc.seerrConnect({ url: '${BASE}', username: 'demo', password: 'demo' })`);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`, 9000);
  await go('#/home', `!!document.querySelector('.home .rows .row')`);
  const placeholders = await waitFor(`!!document.querySelector('.home .top10-row.loading .t10-card.ph')`, 3000);
  await ctx.run(`document.querySelector('.home .top10-row')?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(200);
  await ctx.capture(path.join(out, 'TT-00-platzhalter.png'));
  SEERR.trendingDelay = 0;
  await waitFor(`document.querySelectorAll('.home .top10-row:not(.loading) .t10-card').length >= 9`, 9000);
  await ctx.wait(900);
  const movies = await topCards('movies');
  const series = await topCards('series');
  check('Beim ersten Laden Platzhalter an den Plaetzen der Top 10', placeholders);
  check('Top 10 Filme: nur Titel der Mediathek, in der Reihenfolge der Trends dieser Woche', JSON.stringify(movies) === JSON.stringify(['Echoes of Tomorrow', 'Iron Meridian', 'Midnight Cartographers', 'Solar Winds', 'Velocity', 'Hollow Crown', 'Paper Moons']), JSON.stringify(movies));
  check('Top 10 Serien: weniger als zehn, wenn es nicht mehr gibt (keine Ersatzinhalte)', JSON.stringify(series) === JSON.stringify(['Starfall Station', 'Harbor Lights']), JSON.stringify(series));
  const titles1 = await rowTitles();
  check('Reihenfolge wie die Apple-App: Top 10 nach "Als Naechstes", vor den Neuzugaengen; "Filme im Trend" ganz unten', titles1.indexOf('Top 10 Filme') === titles1.indexOf('Als Nächstes') + 1 && titles1.indexOf('Top 10 Serien') === titles1.indexOf('Top 10 Filme') + 1 && titles1.at(-1) === 'Filme im Trend', JSON.stringify(titles1));
  check('Unter dem Titel: Zeitraum, Mediathek, Quelle', (await ctx.run(`document.querySelector('.home .top10-row[data-kind=movies] .row-head .sub').textContent`)) === 'Im Trend diese Woche · aus deiner Mediathek · Quelle Seerr');
  const geo = await ctx.run(`(() => {
    const c = document.querySelector('.home .top10-row[data-kind=movies] .t10-card');
    const thumb = c.querySelector('.thumb').getBoundingClientRect();
    const num = c.querySelector('.t10-fill').getBBox();
    const svg = c.querySelector('.t10-numeral').getBoundingClientRect();
    const posterW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--poster-w'));
    return { posterW: Math.round(thumb.width), base: posterW, digitH: Math.round(num.height), posterH: Math.round(thumb.height), numLeft: Math.round(svg.left), thumbLeft: Math.round(thumb.left), z: [...document.querySelectorAll('.home .top10-row[data-kind=movies] .t10-card')].slice(0, 3).map((x) => getComputedStyle(x).zIndex), stroke: c.querySelector('.t10-aura text:last-child').getAttribute('stroke'), stops: [...c.querySelectorAll('linearGradient stop')].map((s) => s.getAttribute('stop-color')), halo: !c.querySelector('.t10-halo').hidden };
  })()`);
  check('Masse: Plakat 1,12 x so breit wie die Reihen, die Ziffer ragt hoch hinter dem Plakat hervor, fruehere Karten liegen ueber spaeteren', Math.abs(geo.posterW - Math.round(geo.base * 1.12)) <= 1 && geo.digitH > geo.posterH * 0.6 && geo.numLeft < geo.thumbLeft && Number(geo.z[0]) > Number(geo.z[1]) && Number(geo.z[1]) > Number(geo.z[2]), JSON.stringify(geo));
  check('Rand im Verlauf der Glow-Farbe (Lila zu Blau), grosser Lichtschein dahinter', geo.stroke.startsWith('url(#') && geo.stops.length === 2 && geo.stops[0] !== geo.stops[1] && geo.halo, JSON.stringify(geo.stops));
  await ctx.run(`document.querySelector('.home .top10-row[data-kind=movies]').scrollIntoView({ block: 'center' })`);
  await ctx.wait(700);
  await ctx.capture(path.join(out, 'TT-01-top10.png'));
  const rest = await ctx.run(`getComputedStyle(document.querySelector('.home .top10-row .t10-aura')).opacity`);
  check('Am Desktop leuchten Rand und Schein ohne Zeiger zu 80 %', rest === '0.8', rest);

  // ---------- Zweiter Aufbau: keine Platzhalter, aus dem Speicher ----------
  state.log.length = 0;
  SEERR.trendingDelay = 2000; // die neue Rangfolge kommt spaet: waere die Startseite auf Platzhalter angewiesen, staenden sie jetzt da
  await ctx.run(`document.dispatchEvent(new CustomEvent('reload-data'))`);
  await waitFor(`!!document.querySelector('.home .rows .row')`, 9000);
  await ctx.wait(400);
  const again = await ctx.run(`({ loading: !!document.querySelector('.home .top10-row.loading'), cards: document.querySelectorAll('.home .top10-row:not(.loading) .t10-card').length })`);
  SEERR.trendingDelay = 0;
  await waitFor(`document.querySelectorAll('.home .top10-row .t10-card').length >= 9`, 6000);
  await ctx.wait(2200);
  check('Neu laden: keine Platzhalter mehr (die Reihen von vorhin stehen sofort, waehrend die Rangfolge neu kommt), die Rangfolge wird neu geholt', !again.loading && again.cards >= 9 && state.log.some((l) => l.at === 'seerr:GET /discover/trending'), JSON.stringify(again));

  // ---------- Einstellungen: Zeitraum und Aktuell ----------
  await go('#/settings/home', `!!document.querySelector('.top10-settings')`);
  await waitFor(`/Seerr · diese Woche · 7 Filme, 2 Serien/.test(document.querySelector('.top10-settings').innerText)`, 5000);
  check('Einstellungen > Startseite > Top 10: Zeitraum (Heute, Diese Woche) und "Aktuell"', /Seerr · diese Woche · 7 Filme, 2 Serien/.test(await ctx.run(`document.querySelector('.top10-settings').innerText`)) && JSON.stringify(await ctx.run(`[...document.querySelectorAll('.top10-settings .seg')].map((b) => b.textContent)`)) === JSON.stringify(['Heute', 'Diese Woche']), await ctx.run(`document.querySelector('.top10-settings').innerText`));
  const editor1 = await ctx.run(`[...document.querySelectorAll('.home-row')].map((r) => r.dataset.row + (r.classList.contains('locked') ? ':locked' : ''))`);
  check('Mit Seerr: die Seerr-Reihen sind im Editor bedienbar', ['top10Movies', 'top10Series', 'trending'].every((id) => editor1.includes(id)), JSON.stringify(editor1));
  await ctx.capture(path.join(out, 'TT-02-einstellungen.png'));
  await ctx.run(`[...document.querySelectorAll('.top10-settings .seg')].find((b) => b.textContent === 'Heute').click()`);
  check('"Heute" gewaehlt: "Aktuell" sagt es, sobald geladen', await waitFor(`/Seerr · heute · 7 Filme, 2 Serien/.test(document.querySelector('.top10-settings').innerText)`, 6000), await ctx.run(`document.querySelector('.top10-settings').innerText`));
  await go('#/home', `document.querySelectorAll('.home .top10-row:not(.loading) .t10-card').length >= 9`);
  await ctx.wait(500);
  check('Startseite mit "Heute": andere Reihenfolge, Paper Moons vorn', (await topCards('movies'))[0] === 'Paper Moons' && /Im Trend heute/.test(await ctx.run(`document.querySelector('.home .top10-row .row-head .sub').textContent`)), JSON.stringify(await topCards('movies')));

  // ---------- Ambient Glow aus: farbloser Rand, kein Schein ----------
  await ctx.run(`window.jc.setSettings({ glow: { enabled: false } })`);
  await rebuildHome();
  await waitFor(`document.querySelectorAll('.home .top10-row:not(.loading) .t10-card').length >= 9`, 6000);
  const plain = await ctx.run(`(() => { const c = document.querySelector('.home .top10-row .t10-card'); return { stops: [...c.querySelectorAll('linearGradient stop')].map((s) => s.getAttribute('stop-color')), blurred: c.querySelectorAll('.t10-glow').length, halo: c.querySelector('.t10-halo').hidden }; })()`);
  check('Ambient Glow aus: farbloser Rand (grau), kein Schein, kein Lichtschein', plain.stops.every((s) => s === 'rgb(120, 120, 130)') && plain.blurred === 0 && plain.halo, JSON.stringify(plain));
  await ctx.run(`window.jc.setSettings({ glow: { enabled: true } })`);

  // ---------- Arbeitsspeicher: Top 10 ausgeblendet gegen eingeblendet (gleiche Schritte) ----------
  const off = await measureHome(['top10Movies', 'top10Series']);
  const on = await measureHome([]);
  const off2 = await measureHome(['top10Movies', 'top10Series']);
  const on2 = await measureHome([]);
  console.log(`INFO Arbeitsspeicher der Startseite (privat): Seitenprozess ${off.page}/${off2.page} MB ohne, ${on.page}/${on2.page} MB mit den Top-10-Reihen; alle Prozesse ${off.all}/${off2.all} gegen ${on.all}/${on2.all} MB`);
  const extra = Math.min(on.page, on2.page) - Math.max(off.page, off2.page);
  check('Arbeitsspeicher: die beiden Top-10-Reihen kosten den Seitenprozess hoechstens 40 MB', extra <= 40, `${extra} MB`);

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
