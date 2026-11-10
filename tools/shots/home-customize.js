// Startseite anpassen (Einstellungen > Startseite): Banner an/aus, Folien, Reihen ein/aus und umordnen, Zuruecksetzen; wirkt ohne Neuladen und bleibt gespeichert (JC_DEV=1).
// Nutzt den Mock-Server (eigener Port 8797) und den Mock-Seerr.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-customize.js
const path = require('node:path');
const { server, SEERR } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
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
  const PORT = 8797;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.win.setContentSize(1440, 900);
  await ctx.wait(400);

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
  const rowTitles = () => ctx.run(`[...document.querySelectorAll('.home .rows .row h2')].map((e) => e.textContent.trim())`);
  const homeReady = async () => {
    await go('#/home');
    return waitFor(`!!document.querySelector('.home .rows .row:not(.skeleton)') || !!document.querySelector('.home .rows .empty')`, 9000);
  };
  const listNames = () => ctx.run(`[...document.querySelectorAll('.home-row .home-row-name')].map((e) => e.textContent.trim())`);
  const clickRow = (name, what) => ctx.run(`(() => { const r = [...document.querySelectorAll('.home-row')].find((x) => x.querySelector('.home-row-name').textContent.trim() === ${JSON.stringify(name)}); if (!r) return 'nicht gefunden'; ${what}; return 'ok'; })()`);
  const cfgHome = () => ctx.config.settings.home;

  // Mock-Seerr verbinden, damit "Filme im Trend" eine echte Reihe ist
  await ctx.run(`window.jc.seerrConnect({ url: 'http://127.0.0.1:${PORT}', mode: 'apikey', apiKey: ${JSON.stringify(SEERR.apiKey)} }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(1500);

  // ---------- Ausgangslage ----------
  check('Standard: das Banner ist da', await (async () => { await homeReady(); return waitFor(`!!document.querySelector('.home .hero .hero-slide')`, 8000); })());
  const base = await rowTitles();
  console.log('INFO Reihen im Standard:', JSON.stringify(base));
  check('Standard: mehrere Reihen, "Filme im Trend" steht zuletzt', base.length >= 4 && base[base.length - 1] === 'Filme im Trend', base.join(' | '));
  const slidesDefault = await ctx.run(`document.querySelectorAll('.hero-slide').length`);
  check('Standard: bis zu 6 Folien', slidesDefault >= 3 && slidesDefault <= 6, String(slidesDefault));
  check('Standard: die Einstellungen haben die Standardwerte der Startseite', JSON.stringify(cfgHome()) === JSON.stringify({ hero: true, heroSlides: 6, heroTrend: 2, order: [], hidden: [] }), JSON.stringify(cfgHome()));

  // ---------- Einstellungsseite ----------
  await go('#/settings/home');
  check('Einstellungen > Startseite: die Seite hat Bereiche Banner und Reihen', await waitFor(`document.querySelectorAll('.settings-panel .group-title').length >= 2 && !!document.querySelector('.home-rows')`, 4000));
  check('...die Seitenleiste hat den Eintrag "Startseite" und er ist gewaehlt', await ctx.run(`document.querySelector('.snav.on')?.textContent.trim() === 'Startseite'`));
  const names = await listNames();
  check('...die Liste zeigt alle Reihen in der Standardreihenfolge', names.length >= 4 && names[names.length - 1] === 'Filme im Trend' && names.includes('Weiterschauen') && names.includes('Favoriten'), names.join(' | '));
  check('...jede Reihe hat Nummer, zwei Pfeile und einen Schalter, der oberste kann nicht hoch, der unterste nicht runter', await ctx.run(`(() => { const rs = [...document.querySelectorAll('.home-row')]; return rs.every((r) => r.querySelectorAll('.home-row-move button').length === 2 && r.querySelector('button.switch') && r.querySelector('.home-row-pos')) && rs[0].querySelector('.home-row-move button').disabled && rs.at(-1).querySelectorAll('.home-row-move button')[1].disabled; })()`));
  await ctx.capture(path.join(out, 'HC-einstellungen.png'));

  // ---------- Umordnen ----------
  check('Favoriten nach oben schieben (mehrfach)', (await clickRow('Favoriten', `r.querySelectorAll('.home-row-move button')[0].click()`)) === 'ok');
  const after1 = await listNames();
  check('...die Liste folgt sofort', after1.indexOf('Favoriten') === names.indexOf('Favoriten') - 1, after1.join(' | '));
  for (let i = 0; i < names.length; i++) {
    const r = await ctx.run(`(() => { const r = [...document.querySelectorAll('.home-row')].find((x) => x.querySelector('.home-row-name').textContent.trim() === 'Favoriten'); const b = r.querySelectorAll('.home-row-move button')[0]; if (b.disabled) return false; b.click(); return true; })()`);
    if (!r) break;
  }
  check('...bis ganz nach oben (der Pfeil nach oben ist dann ausgegraut)', (await listNames())[0] === 'Favoriten');
  await ctx.wait(500);
  check('...gespeichert: die Reihenfolge steht in den Einstellungen', cfgHome().order[0] === 'favorites', JSON.stringify(cfgHome().order));
  await homeReady();
  const t2 = await rowTitles();
  check('Startseite: Favoriten steht jetzt zuerst (ohne Neuladen, die gemerkte Startseite wurde verworfen)', t2[0] === 'Favoriten' || !base.includes('Favoriten'), t2.join(' | '));
  check('...die uebrigen Reihen behalten ihre Reihenfolge', JSON.stringify(t2.filter((x) => x !== 'Favoriten')) === JSON.stringify(base.filter((x) => x !== 'Favoriten')), t2.join(' | '));

  // Trend-Reihe an die zweite Stelle: der Platzhalter fuellt sich an seiner Stelle
  await go('#/settings/home');
  await clickRow('Filme im Trend', `for (let i = 0; i < 12; i++) { const b = r.querySelectorAll('.home-row-move button')[0]; if (!b.disabled) b.click(); }`);
  await ctx.wait(500);
  await homeReady();
  check('"Filme im Trend" steht ganz oben und ist gefuellt (nicht mehr unten)', await waitFor(`document.querySelector('.home .rows > :first-child.trend-row .req-card, .home .rows > :first-child.trend-row .card')`, 6000), (await rowTitles()).join(' | '));
  await ctx.capture(path.join(out, 'HC-trend-oben.png'));

  // ---------- Ausblenden ----------
  await go('#/settings/home');
  await clickRow('Weiterschauen', `r.querySelector('button.switch').click()`);
  check('Weiterschauen ausschalten: der Eintrag wird blass und durchgestrichen', await ctx.run(`document.querySelector('.home-row[data-row="continue"]')?.classList.contains('off')`));
  await ctx.wait(500);
  check('...gespeichert in "hidden"', cfgHome().hidden.includes('continue'), JSON.stringify(cfgHome().hidden));
  await homeReady();
  const t3 = await rowTitles();
  check('Startseite: die Reihe "Weiterschauen" fehlt', !t3.includes('Weiterschauen') && t3.length === (await rowTitles()).length && t3.length >= 3, t3.join(' | '));
  await go('#/settings/home');
  await clickRow('Weiterschauen', `r.querySelector('button.switch').click()`);
  await ctx.wait(500);
  await homeReady();
  check('Wieder einschalten: die Reihe ist zurueck an ihrer Stelle', (await rowTitles()).includes('Weiterschauen') && !cfgHome().hidden.includes('continue'));

  // ---------- Banner ----------
  await go('#/settings/home');
  await ctx.run(`(() => { const i = [...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Folien im Banner').querySelector('input[type=range]'); i.value = 3; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.wait(500);
  check('Folien im Banner auf 3: gespeichert', cfgHome().heroSlides === 3, String(cfgHome().heroSlides));
  await homeReady();
  await waitFor(`!!document.querySelector('.hero-slide')`, 8000);
  const s3 = await ctx.run(`document.querySelectorAll('.hero-slide').length`);
  check('...das Banner hat hoechstens 3 Folien (die Trend-Folien zaehlen mit)', s3 >= 1 && s3 <= 3, String(s3));
  await go('#/settings/home');
  await ctx.run(`(() => { const i = [...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Trend-Filme im Banner').querySelector('input[type=range]'); i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.wait(500);
  await homeReady();
  await waitFor(`!!document.querySelector('.hero-slide')`, 8000);
  check('Trend-Filme im Banner auf 0: keine Trend-Folie (Beschriftung "Im Trend")', await ctx.run(`![...document.querySelectorAll('.hero-slide .hero-label')].some((l) => /Trend/.test(l.textContent))`));

  await go('#/settings/home');
  await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Banner anzeigen').querySelector('button.switch').click()`);
  await ctx.wait(500);
  check('Banner ausschalten: gespeichert', cfgHome().hero === false);
  await homeReady();
  await ctx.wait(800);
  check('Startseite ohne Banner: kein Banner, kein Platzhalter', await ctx.run(`!document.querySelector('.home .hero, .home .hero-slide, .home .hero-skeleton') && document.querySelector('.home').classList.contains('no-hero')`));
  const geo = await ctx.run(`(() => { const top = document.querySelector('.topbar').getBoundingClientRect(); const first = document.querySelector('.home .rows .row').getBoundingClientRect(); return { barBottom: Math.round(top.bottom), rowTop: Math.round(first.top) }; })()`);
  check('...die erste Reihe beginnt unter der Kopfleiste (keine Ueberdeckung)', geo.rowTop >= geo.barBottom, JSON.stringify(geo));
  await ctx.capture(path.join(out, 'HC-ohne-banner.png'));

  // ---------- Alles ausgeblendet ----------
  await go('#/settings/home');
  for (const n of await listNames()) await clickRow(n, `if (r.querySelector('button.switch').getAttribute('aria-checked') === 'true') r.querySelector('button.switch').click()`);
  await ctx.wait(600);
  await homeReady();
  check('Alle Reihen aus: eine Erklaerung mit Weg in die Einstellungen statt einer leeren Seite', await waitFor(`!!document.querySelector('.home .rows .empty a[href="#/settings/home"]')`, 5000) && (await ctx.run(`/ausgeblendet/.test(document.querySelector('.home .rows .empty h3').textContent)`)));
  await ctx.capture(path.join(out, 'HC-alles-aus.png'));
  await ctx.run(`document.querySelector('.home .rows .empty a[href="#/settings/home"]').click()`);
  check('...der Knopf fuehrt in die Einstellungen der Startseite', await waitFor(`location.hash === '#/settings/home' && !!document.querySelector('.home-rows')`, 3000), await ctx.run('location.hash'));

  // ---------- Zuruecksetzen ----------
  await ctx.run(`document.querySelector('.settings-panel .btn.glass.sm:not(.icon)')?.click()`);
  await ctx.wait(500);
  const reset = JSON.stringify(cfgHome());
  check('Zuruecksetzen: Standardwerte der Startseite', reset === JSON.stringify({ hero: true, heroSlides: 6, heroTrend: 2, order: [], hidden: [] }) && ctx.config.settings.appearance.homeTrending === true && ctx.config.settings.appearance.heroAutoplay === true, reset);
  check('...die Liste zeigt wieder alle Reihen eingeschaltet in Standardreihenfolge', JSON.stringify(await listNames()) === JSON.stringify(names) && (await ctx.run(`!document.querySelector('.home-row.off')`)));
  await homeReady();
  check('...die Startseite ist wieder wie am Anfang (Banner und Reihen)', (await waitFor(`!!document.querySelector('.home .hero .hero-slide')`, 8000)) && JSON.stringify(await rowTitles()) === JSON.stringify(base), (await rowTitles()).join(' | '));

  // ---------- Quelltext ----------
  const fs = require('node:fs');
  const root = path.join(__dirname, '..', '..');
  check('Quelltext: die Startseite liest die Anpassung ueber JCHomeRows (kein eigener Ersatz der Regeln)', /HomeRows\.arrangeRows/.test(fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'views', 'home.js'), 'utf8')) && /home-rows\.js/.test(fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')));
  check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
};
