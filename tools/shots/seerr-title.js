// Seite eines Seerr-Titels (P12, nach SeerrDetailSheet der Apple-App), mit dem Mock-Server auf Port 8990:
//  - Serie mit Staffeln ("Wintersignale": Staffel 1 da, 2 und 3 offen): Staffeluebersicht mit Stand, "Weitere Staffeln anfragen", Staffelauswahl (vorhandene
//    nicht waehlbar, offene vorausgewaehlt), Anfrage nur der gewaehlten Staffel, danach als angefragt markiert; ein zweiter Klick waehrend der Anfrage zaehlt nicht
//  - Kontingent: vorher als Hinweis, erschoepft ist der Knopf gesperrt; ohne Recht keine Anfrage, sondern der Grund
//  - weitere Titel: eine Karte oeffnet die Seite des anderen Titels, ein Titel der Mediathek (ueber die TMDB-Nummer) die Detailseite dort
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/seerr-title.js
const path = require('node:path');
const { server, state, SEERR, items } = require('../mock-server');

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
  const PORT = 8990;
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
  const loaded = `!!document.querySelector('.seerr-page .info-block')`;
  const openPage = async (type, id) => {
    await go('#/home', `!!document.querySelector('.home')`);
    await go(`#/seerr/${type}/${id}`, loaded);
    await ctx.wait(900); // nach dem Einblenden der Seite
  };
  const page = (sel, prop = 'textContent') => ctx.run(`document.querySelector('.seerr-page ${sel}')?.${prop} ?? ''`);
  const seasons = () => ctx.run(`[...document.querySelectorAll('.seerr-page .seerr-season')].map((s) => s.querySelector('.seerr-season-name').textContent + ' · ' + s.querySelector('.seerr-season-sub').textContent + ' · ' + (s.querySelector('.tag')?.textContent ?? '-'))`);
  const bodies = () => state.log.filter((l) => l.at === 'seerr:request-body').map(({ at, ...b }) => b);

  // ---------- Serie mit Staffeln ----------
  await openPage('tv', 2001);
  check('Serie: Titel, Angabenzeile mit Freigabe (FSK 16), Laufzeit je Folge, Staffeln, Bewertung', (await page('.detail-title')) === 'Wintersignale' && (await ctx.run(`[...document.querySelectorAll('.seerr-page .detail-meta > span')].map((s) => s.textContent.trim()).join(' | ')`)) === '2025 | FSK 16 | 48 Min. | 3 Staffeln | 8.0', await ctx.run(`[...document.querySelectorAll('.seerr-page .detail-meta > span')].map((s) => s.textContent.trim()).join(' | ')`));
  check('Stand der Serie als Tag: "Teilweise verfügbar"', (await page('.detail-tags .tag')) === 'Teilweise verfügbar', await page('.detail-tags .tag'));
  check('Staffeln mit Folgen, Jahr und Stand (ohne "Extras")', JSON.stringify(await seasons()) === JSON.stringify(['Staffel 1 · 8 Folgen · 2025 · Verfügbar', 'Staffel 2 · 8 Folgen · 2026 · -', 'Staffel 3 · 8 Folgen · 2026 · -']), JSON.stringify(await seasons()));
  check('Hauptknopf "Weitere Staffeln anfragen" (Staffel 1 ist schon da)', (await page('.seerr-request')).includes('Weitere Staffeln anfragen'));
  check('Besetzung: die Schoepferin vorn mit "Idee", Produktion hinten', await ctx.run(`(() => { const p = [...document.querySelectorAll('.seerr-page .person')].map((x) => x.querySelector('.l1').textContent + ':' + (x.querySelector('.l2')?.textContent ?? '')); return p[0] === 'Ines Berger:Idee' && p.at(-1) === 'Jo Kim:Produktion'; })()`));
  const info = await ctx.run(`Object.fromEntries([...document.querySelectorAll('.seerr-page .info-group dt')].map((d) => [d.textContent, d.nextElementSibling.textContent]))`);
  check('Informationen: Erstausstrahlung, Umfang, Laufzeit je Folge, Status, Sender, Originalsprache', info.Erstausstrahlung === '1. Oktober 2025' && info.Umfang === '3 Staffeln · 24 Folgen' && info['Laufzeit je Folge'] === '48 Min.' && info.Status === 'Wird fortgesetzt' && info.Sender === 'Kanal Eins' && info.Originalsprache === 'Deutsch', JSON.stringify(info));
  await ctx.capture(path.join(out, 'ST-01-serie.png'));
  state.log.length = 0;
  await ctx.run(`document.querySelector('.seerr-page .seerr-request').click()`);
  check('"Weitere Staffeln anfragen" oeffnet die Staffelauswahl', await waitFor(`/Staffeln anfragen/.test(document.querySelector('.mdl .mdl-title')?.textContent ?? '')`, 3000));
  const chooser = await ctx.run(`[...document.querySelectorAll('.mdl .season-pick')].map((r) => ({ n: r.querySelector('.setting-label').textContent, d: r.querySelector('.setting-desc')?.textContent ?? '', on: r.querySelector('.switch').classList.contains('on'), off: r.querySelector('.switch').disabled }))`);
  check('Auswahl: Staffel 1 da (an, gesperrt, "Verfügbar"), 2 und 3 vorausgewaehlt', JSON.stringify(chooser) === JSON.stringify([{ n: 'Staffel 1', d: 'Verfügbar', on: true, off: true }, { n: 'Staffel 2', d: '8 Folgen', on: true, off: false }, { n: 'Staffel 3', d: '8 Folgen', on: true, off: false }]), JSON.stringify(chooser));
  check('Die Schalter stehen ganz im Fenster (nichts abgeschnitten), das Fenster blendet ein', await ctx.run(`(() => { const g = document.querySelector('.mdl .settings-group').getBoundingClientRect(); return [...document.querySelectorAll('.mdl .switch')].every((s) => s.getBoundingClientRect().right <= g.right - 8) && getComputedStyle(document.querySelector('.mdl')).animationName === 'mdl-pop'; })()`));
  check('Der Fokus liegt auf der ersten offenen Staffel, nicht auf "Anfragen"', await waitFor(`document.activeElement?.closest('.season-pick')?.querySelector('.setting-label')?.textContent === 'Staffel 2'`, 2000));
  await ctx.capture(path.join(out, 'ST-02-staffelauswahl.png'));
  await ctx.run(`[...document.querySelectorAll('.mdl .season-pick')].find((r) => r.querySelector('.setting-label').textContent === 'Staffel 3').querySelector('.switch').click()`);
  await ctx.run(`[...document.querySelectorAll('.mdl .season-pick')].find((r) => r.querySelector('.setting-label').textContent === 'Staffel 2').querySelector('.switch').click()`);
  check('Ohne gewaehlte Staffel ist "Anfragen" gesperrt', await ctx.run(`[...document.querySelectorAll('.mdl .mdl-actions .btn')].find((b) => b.textContent === 'Anfragen').disabled === true`));
  await ctx.run(`[...document.querySelectorAll('.mdl .season-pick')].find((r) => r.querySelector('.setting-label').textContent === 'Staffel 2').querySelector('.switch').click()`);
  SEERR.requestDelay = 0;
  await ctx.run(`[...document.querySelectorAll('.mdl .mdl-actions .btn')].find((b) => b.textContent === 'Anfragen').click()`);
  await ctx.run(`document.querySelector('.seerr-page .seerr-request')?.click()`); // ein zweiter Klick waehrend der Anfrage
  await waitFor(`[...document.querySelectorAll('.seerr-page .seerr-season')].some((s) => /Staffel 2/.test(s.textContent) && s.querySelector('.tag')?.textContent === 'Angefragt')`, 6000);
  await ctx.wait(400);
  check('Nur Staffel 2 angefragt, genau eine Anfrage, nie 4K', JSON.stringify(bodies()) === JSON.stringify([{ mediaType: 'tv', mediaId: 2001, is4k: false, seasons: [2] }]), JSON.stringify(bodies()));
  check('Danach steht Staffel 2 als "Angefragt" da; Staffel 3 laesst sich weiter anfragen', JSON.stringify(await seasons()) === JSON.stringify(['Staffel 1 · 8 Folgen · 2025 · Verfügbar', 'Staffel 2 · 8 Folgen · 2026 · Angefragt', 'Staffel 3 · 8 Folgen · 2026 · -']) && (await page('.seerr-request')).includes('Weitere Staffeln anfragen') && !(await ctx.run(`!!document.querySelector('.mdl')`)), JSON.stringify(await seasons()));
  await ctx.capture(path.join(out, 'ST-03-angefragt.png'));

  // ---------- Kontingent und Rechte ----------
  SEERR.quota.tv = { limit: 3, days: 7, used: 1 };
  await openPage('tv', 2001);
  check('Kontingent vorher: "Noch 2 von 3 Anfragen in 7 Tagen."', await waitFor(`document.querySelector('.seerr-page .seerr-page-note')?.textContent === 'Noch 2 von 3 Anfragen in 7 Tagen.'`, 4000), await page('.seerr-page-note'));
  SEERR.quota.tv = { limit: 3, days: 7, used: 3 };
  await openPage('tv', 2001);
  check('Kontingent erschoepft: Hinweis, der Knopf ist gesperrt', (await waitFor(`/Kontingent ist erschöpft \\(3 in 7 Tagen\\)/.test(document.querySelector('.seerr-page .seerr-page-note')?.textContent ?? '')`, 4000)) && (await ctx.run(`document.querySelector('.seerr-page .seerr-request')?.disabled === true`)), await page('.seerr-page-note'));
  SEERR.quota.tv = { limit: 0, days: 7, used: 0 };
  SEERR.permissions = 262144; // darf nur Filme anfragen
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`, 6000);
  await openPage('tv', 2001);
  check('Ohne Recht fuer Serien: keine Anfrage, sondern der Grund', (await waitFor(`/darf keine Serien anfragen/.test(document.querySelector('.seerr-page .seerr-page-note')?.textContent ?? '')`, 4000)) && !(await page('.seerr-request')), await page('.seerr-page-note'));
  SEERR.permissions = 32;
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await waitFor(`!!document.querySelector('.topbar')`, 6000);

  // ---------- Weitere Titel und ein Weg zum Oeffnen ----------
  await openPage('movie', 603);
  await waitFor(`document.querySelectorAll('.seerr-page .seerr-related .row').length === 3`, 6000);
  await ctx.run(`document.querySelector('.seerr-page .seerr-related')?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(600);
  await ctx.capture(path.join(out, 'ST-04-weitere-titel.png'));
  await ctx.run(`[...document.querySelectorAll('.seerr-page .seerr-related .req-card')].find((c) => c.querySelector('.l1').textContent === 'Trend Film Zwei').querySelector('.thumb').click()`);
  check('Karte "Trend Film Zwei" (nicht in der Mediathek): die Seite dieses Titels', await waitFor(`location.hash === '#/seerr/movie/7002' && document.querySelector('.seerr-page .detail-title')?.textContent === 'Trend Film Zwei'`, 4000), await ctx.run('location.hash'));
  await ctx.run('history.back()');
  await waitFor(`location.hash === '#/seerr/movie/603' && document.querySelectorAll('.seerr-page .seerr-related .row').length === 3`, 6000);
  const paper = [...items.values()].find((i) => i.Name === 'Paper Moons');
  await ctx.run(`[...document.querySelectorAll('.seerr-page .seerr-related .req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Arrival').querySelector('.thumb').click()`);
  check('Karte "Mock Arrival" (laut Seerr verfuegbar, in der Mediathek ueber die TMDB-Nummer): die Detailseite der Mediathek', await waitFor(`location.hash === '#/item/${paper.Id}'`, 5000), await ctx.run('location.hash'));
  // Doppelt schnell getippt: nur eine Seite kommt dazu
  await go('#/search?q=mock', `!!document.querySelector('.seerr-group')`);
  await ctx.wait(800);
  const before = await ctx.run('history.length');
  await ctx.run(`(() => { const t = [...document.querySelectorAll('.req-card')].find((c) => c.querySelector('.l1').textContent === 'Mock Thrones').querySelector('.thumb'); t.click(); t.click(); })()`);
  await waitFor(`location.hash === '#/seerr/tv/1399'`, 4000);
  await ctx.wait(500);
  check('Zwei schnelle Klicks oeffnen die Seite einmal', (await ctx.run('history.length')) === before + 1, `${before} -> ${await ctx.run('history.length')}`);

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
