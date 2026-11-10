// Zurueck auf die Startseite (JC_DEV=1, JC_FAKE_MPV=1): Bild fuer Bild nach dem Wechsel aufzeichnen, ob das Banner und die Reihen an ihrem Platz sind
// oder ob kurz nur ein Streifen (die Ueberschrift der ersten Reihe ohne Banner) zu sehen ist. Mehrere Wege zurueck: aus einer Detailseite, aus den Einstellungen
// (nach einer Aenderung wird die Startseite neu aufgebaut), aus der Bibliothek, nach Scrollen, mit und ohne Trailer im Banner.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-back.js
const path = require('node:path');
const { server, items } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const movie = [...items.values()].find((i) => i.Name === 'The Last Lighthouse');
  const lib = await ctx.run(`[...document.querySelectorAll('.nav-link')].map((a) => a.getAttribute('href'))[1]`);

  // Zustand der Startseite im Fenster: Lage von Banner und erster Reihe
  const STATE = `(() => {
    const view = document.querySelector('#view'); const home = document.querySelector('.home');
    if (!home) return { home: false };
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
    const act = document.querySelector('.hero-slide.active');
    return { home: true, scrollTop: Math.round(view.scrollTop), hero: r('.hero'), heroHost: r('.hero-host'), rows: r('.rows'), row1: r('.rows .row'), head1: r('.rows .row .row-head'), skeletonHero: !!document.querySelector('.hero-skeleton'), skeletonRows: document.querySelectorAll('.rows .skeleton-row, .rows .sk').length, slides: document.querySelectorAll('.hero-slide').length, active: !!act, activeOpacity: act ? +getComputedStyle(act).opacity : null, bgLoaded: !!act?.querySelector('img.loaded'), homeOpacity: +getComputedStyle(home).opacity, homeTransform: getComputedStyle(home).transform };
  })()`;

  const ok = (s, scrolled) => s.home && s.hero && s.hero.h >= 400 && s.rows && s.row1 && s.head1 && s.head1.top > s.hero.top + 200 && (scrolled || s.scrollTop === 0);
  const trace = async (label, { scrolled = false } = {}) => {
    const t0 = Date.now();
    const frames = [];
    const marks = [0, 60, 150, 300, 500, 800, 1200, 2000];
    for (const ms of marks) {
      await ctx.wait(Math.max(0, ms - (Date.now() - t0)));
      const s = await ctx.run(STATE);
      frames.push({ ms, ...s });
      if (ms === 150 || ms === 500) await ctx.capture(path.join(out, `B-${label.replace(/[^a-z0-9]+/gi, '-')}-${ms}.png`));
    }
    const bad = frames.filter((f) => !ok(f, scrolled) && f.ms >= 150);
    check(`${label}: Banner und Reihen sind ab 150 ms an ihrem Platz (Banner mindestens 400 px hoch, erste Reihe darunter), kein Streifen`, bad.length === 0, bad.length ? JSON.stringify(bad[0]) : `Banner ${frames.at(-1).hero?.h} px, Reihe ab ${frames.at(-1).head1?.top}`);
    const early = frames.filter((f) => f.ms < 150 && f.home && f.head1 && f.hero && f.hero.h < 300);
    if (early.length) console.log(`   Hinweis ${label}: in den ersten 150 ms war das Banner zeitweise niedrig: ${JSON.stringify(early[0])}`);
    return frames;
  };

  // Aufbau der Startseite
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  await ctx.wait(1500);
  const first = await ctx.run(STATE);
  check('Startseite: Banner und Reihen beim ersten Aufbau in Ordnung', ok(first, false), JSON.stringify({ hero: first.hero, head1: first.head1 }));

  // 1. Detailseite und zurueck
  for (let i = 0; i < 3; i++) {
    await ctx.run(`location.hash = '#/item/${movie.Id}'`);
    await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 8000);
    await ctx.wait(400 + i * 700);
    await ctx.run(`history.back()`);
    await trace(`Detail und zurueck (${i + 1}. Mal)`);
  }
  // 2. Gescrollt, Detailseite, zurueck
  await ctx.run(`document.querySelector('#view').scrollTop = 500`);
  await ctx.wait(600);
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 8000);
  await ctx.wait(500);
  await ctx.run(`history.back()`);
  await trace('Gescrollt, Detail und zurueck', { scrolled: true });
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);
  await ctx.wait(500);
  // 3. Bibliothek und zurueck, schnell hin und her
  for (let i = 0; i < 3; i++) {
    await ctx.run(`location.hash = ${JSON.stringify(lib)}`);
    await ctx.wait(150 + i * 400);
    await ctx.run(`location.hash = '#/home'`);
    await trace(`Bibliothek und zurueck (${i + 1}. Mal, nach ${150 + i * 400} ms)`);
  }
  // 4. Einstellungen: etwas aendern (Startseite wird neu aufgebaut), zurueck
  await ctx.run(`location.hash = '#/settings/appearance'`);
  await ctx.wait(700);
  await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => /Qualitäts-Badges/.test(s.textContent))?.querySelector('button.switch')?.click()`);
  await ctx.wait(500);
  await ctx.run(`location.hash = '#/home'`);
  await trace('Einstellung geaendert und zurueck (Startseite wird neu aufgebaut)');
  await ctx.run(`location.hash = '#/settings/appearance'`);
  await ctx.wait(700);
  await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => /Qualitäts-Badges/.test(s.textContent))?.querySelector('button.switch')?.click()`);
  await ctx.wait(500);
  await ctx.run(`location.hash = '#/home'`);
  await trace('Einstellung zurueckgestellt und zurueck');
  // 5. Mit Fensterwechsel waehrend der Startseite ausser Sicht (Sichtbarkeit)
  await ctx.run(`location.hash = '#/search'`);
  await ctx.wait(500);
  await ctx.run(`history.back()`);
  await trace('Suche und zurueck');
  // 6. Schnell dreimal hintereinander wechseln
  for (let i = 0; i < 4; i++) {
    await ctx.run(`location.hash = '#/search'`);
    await ctx.wait(60);
    await ctx.run(`location.hash = '#/home'`);
    await ctx.wait(60);
  }
  await trace('Schnell hin und her (4 Mal im 60-ms-Takt)');

  // 7. Mit Trailer im Banner (echtes YouTube): Detailseite und zurueck, Bibliothek und zurueck
  const YT = [{ Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];
  const newest = [...items.values()].filter((i) => i.Type === 'Movie').sort((a, b) => (a.DateCreated < b.DateCreated ? 1 : -1))[0];
  newest.RemoteTrailers = YT;
  ctx.config.updateSettings({ trailer: { autoplay: true, home: true, muted: true, delaySec: 0, quality: '720', focusSec: 3 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2300);
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  check('Mit Trailer: der Trailer laeuft im Banner', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 40000));
  await ctx.wait(1500);
  for (let i = 0; i < 3; i++) {
    await ctx.run(`location.hash = '#/item/${movie.Id}'`);
    await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 8000);
    await ctx.wait(1200 + i * 1500);
    await ctx.run(`history.back()`);
    await trace(`Mit Trailer: Detail und zurueck (${i + 1}. Mal)`);
    await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 30000);
  }
  await ctx.run(`document.querySelector('#view').scrollTop = 300`);
  await ctx.wait(400);
  await ctx.run(`location.hash = ${JSON.stringify(lib)}`);
  await ctx.wait(700);
  await ctx.run(`history.back()`);
  await trace('Mit Trailer: gescrollt, Bibliothek und zurueck', { scrolled: true });

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
