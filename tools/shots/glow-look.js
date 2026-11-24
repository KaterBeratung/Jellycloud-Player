// Ambient Glow wie in der Apple-App (JC_DEV=1, JC_FAKE_MPV=1): Bereiche (Anmeldung, Startseite, Filme, Serien, Suche, Einstellungen; keiner auf
// Detailseiten), Regel der Startseite (oben erst ohne Banner bzw. wenn es hinausgescrollt ist, unten bis unter das Banner), keine Unschaerfe und
// keine laufende Bewegung, Einstellungen (Ein/Aus, Einzelfarbe, Verlauf, Intensitaet, eigener Bereich, Bereich aus, alles zuruecksetzen) wirken
// sofort und werden gespeichert. Aufnahmen: SHOT_DIR/GL-*.png.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/glow-look.js
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
  ctx.win.setContentSize(1280, 800);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 10000);
    await ctx.wait(600);
  };
  // Zustand der Ebene: Bereich, sichtbar oben/unten (Klasse on, ohne hero-visible), Hoehen, Hintergrund und Maske, Filter, laufende Animationen
  const LAYER = `(() => {
    const l = document.getElementById('glow'); if (!l) return null;
    const t = l.querySelector('.glow-top'), b = l.querySelector('.glow-bottom');
    const shown = (e) => e.classList.contains('on') && getComputedStyle(e).opacity !== '0';
    return { scope: l.dataset.scope, top: shown(t), bottom: shown(b), heroVisible: l.classList.contains('hero-visible'), topH: Math.round(t.getBoundingClientRect().height), bottomH: Math.round(b.getBoundingClientRect().height),
      bg: t.style.background.slice(0, 120), mask: t.style.maskImage.slice(0, 60), filter: getComputedStyle(t).filter + '|' + getComputedStyle(l).filter, backdrop: getComputedStyle(l).backdropFilter,
      anims: document.getAnimations().filter((a) => a.effect?.target && l.contains(a.effect.target) && a.playState === 'running' && !(a instanceof CSSTransition)).length };
  })()`;
  const layer = () => ctx.run(LAYER);

  // ---------- Anmeldung ----------
  await waitFor(`!!document.querySelector('.login .connect-col')`, 8000);
  await ctx.wait(500);
  const login = await layer();
  check('Anmeldung: Bereich Anmeldung, Schein oben und unten', login?.scope === 'signIn' && login.top && login.bottom, JSON.stringify(login));
  check('Anmeldung: keine laufende Aurora mehr, keine Unschaerfe, keine Animation', !(await ctx.run(`!!document.querySelector('.aurora')`)) && login.filter === 'none|none' && login.backdrop === 'none' && login.anims === 0, JSON.stringify({ f: login.filter, a: login.anims }));
  check('Standard: Verlauf Lila zu Blau als Farben quer, Lichtfleck als Maske', /linear-gradient\(90deg, rgb\(94, 58, 190\), rgb\(38, 78, 190\)\)/.test(login.bg) && /radial-gradient/.test(login.mask), login.bg);
  await ctx.capture(path.join(out, 'GL-anmeldung.png'));

  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.home .hero-slide.active')`, 15000);
  await ctx.wait(800);

  // ---------- Startseite ----------
  const home = await layer();
  const h = await ctx.run('innerHeight');
  const heroBottom = await ctx.run(`Math.round(document.querySelector('.home .hero').getBoundingClientRect().bottom)`);
  const expectBottom = Math.min(Math.min(760, h * 0.58), Math.max(160, h - heroBottom));
  check('Startseite: Bereich Startseite; mit Banner im Blick oben kein Schein (das Banner bleibt, wie es ist)', home.scope === 'home' && !home.top && home.heroVisible, JSON.stringify(home));
  check('Startseite: unten reicht der Schein bis unter das Banner (mindestens 160 px)', home.bottom && Math.abs(home.bottomH - Math.round(expectBottom)) <= 2, `${home.bottomH} px, erwartet ${Math.round(expectBottom)} (Fenster ${h}, Banner bis ${heroBottom})`);
  await ctx.capture(path.join(out, 'GL-start.png'));
  // Der untere Schein beginnt nie unter dem deckenden Banner (sonst steht an dessen Unterkante eine harte Kante), auch beim Scrollen nicht
  const edge = (scroll) =>
    ctx.run(`(async () => { const v = document.querySelector('#view'); v.scrollTop = ${scroll}; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const b = document.querySelector('#glow .glow-bottom').getBoundingClientRect(); const hb = document.querySelector('.home .hero').getBoundingClientRect().bottom; return { top: Math.round(b.top), hero: Math.round(hb), h: innerHeight, height: Math.round(b.height) }; })()`);
  const e0 = await edge(0);
  const e1 = await edge(120);
  const e2 = await edge(heroBottom + 50);
  check(
    'Startseite: der untere Schein beginnt an der Unterkante des Banners (nie darunter), steigt beim Scrollen mit ihr auf und steht danach ganz',
    e0.top >= e0.hero - 1 && e1.top >= e1.hero - 1 && (e0.top > e0.h - e0.height ? e1.top < e0.top : true) && Math.abs(e2.top - (e2.h - e2.height)) <= 1,
    JSON.stringify({ e0, e1, e2 })
  );
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);
  await ctx.wait(300);
  await ctx.run(`document.querySelector('#view').scrollTop = ${heroBottom + 200}`);
  const scrolled = await waitFor(`(() => { const l = document.getElementById('glow'); return !l.classList.contains('hero-visible'); })()`, 3000);
  await ctx.wait(500);
  const home2 = await layer();
  check('Startseite: ist das Banner hinausgescrollt, kommt der Schein auch von oben', scrolled && home2.top, JSON.stringify(home2));
  await ctx.capture(path.join(out, 'GL-start-gescrollt.png'));
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);

  // ---------- Bibliotheken, Suche, Einstellungen, Detailseite ----------
  // Seit P9 die Reiter Filme und Serien (alle Bibliotheken der Art), wie in der Apple-App
  const libs = await ctx.run(`[...document.querySelectorAll('.nav-link')].map((a) => a.getAttribute('href')).filter((x) => x === '#/movies' || x === '#/shows')`);
  await go(libs[0], `!!document.querySelector('.grid .card')`);
  const movies = await layer();
  check('Reiter Filme: Bereich Filme, oben 58 % der Hoehe (hoechstens 760)', movies.scope === 'movies' && movies.top && movies.bottom && Math.abs(movies.topH - Math.round(Math.min(760, h * 0.58))) <= 1, JSON.stringify({ s: movies.scope, t: movies.topH }));
  await ctx.capture(path.join(out, 'GL-filme.png'));
  await go(libs[1], `!!document.querySelector('.grid .card')`);
  check('Reiter Serien: Bereich Serien', (await layer()).scope === 'series');
  await go('#/search?q=a', `!!document.querySelector('.search')`);
  check('Suche: Bereich Suche', (await layer()).scope === 'search');
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  await go(`#/item/${movie.Id}`, `!!document.querySelector('.detail-tags')`);
  const det = await layer();
  check('Detailseite: kein Ambient Glow (dort der Hintergrund aus dem Bild)', det.scope === '' && !det.top && !det.bottom, JSON.stringify(det));

  // ---------- Einstellungen ----------
  await go('#/settings/appearance', `!!document.querySelector('.glow-settings .glow-preview')`);
  const set0 = await layer();
  check('Einstellungen: Bereich Einstellungen; Abschnitt Ambient Glow mit Vorschau direkt nach Design und Akzentfarbe', set0.scope === 'settings' && (await ctx.run(`(() => { const blocks = [...document.querySelectorAll('.settings-panel .settings-block')]; return blocks.findIndex((b) => b.querySelector('.glow-preview')) === 1; })()`)));
  await ctx.capture(path.join(out, 'GL-einstellungen.png'));
  const pw = await ctx.run(`Math.round(document.querySelector('.glow-settings .glow-preview').getBoundingClientRect().width)`);
  check('Vorschau: zwei Scheine in einem Feld ueber die Breite', pw >= 220 && (await ctx.run(`document.querySelectorAll('.glow-settings .glow-preview i.on').length`)) === 2, `Breite ${pw}`);
  await ctx.run(`document.querySelector('.glow-settings').scrollIntoView()`);
  await ctx.wait(400);
  await ctx.capture(path.join(out, 'GL-einstellungen-glow.png'));
  const settingRow = (label) => `[...document.querySelectorAll('.glow-settings .setting')].find((s) => s.querySelector('.setting-label')?.textContent === ${JSON.stringify(label)})`;
  // Einzelfarbe
  await ctx.run(`${settingRow('Farbverlauf')}.querySelector('button.switch').click()`);
  await ctx.wait(300);
  await ctx.run(`document.querySelector('[data-glow-color="teal"]').click()`);
  await ctx.wait(400);
  const teal = await layer();
  check('Einzelfarbe Tuerkis: der Schein ist ein elliptischer Verlauf in dieser Farbe, sofort', /radial-gradient/.test(teal.bg) && /20, 140, 142/.test(teal.bg) && teal.mask === 'none', teal.bg);
  // Verlauf wieder an: die gemerkte Wahl ist wieder da; dann ein anderer Verlauf
  await ctx.run(`${settingRow('Farbverlauf')}.querySelector('button.switch').click()`);
  await ctx.wait(400);
  check('Verlauf wieder an: Lila zu Blau ist gemerkt geblieben', /94, 58, 190/.test((await layer()).bg));
  await ctx.run(`document.querySelector('[data-glow-gradient="ember"]').click()`);
  await ctx.wait(400);
  check('Verlauf Rot zu Orange', /176, 40, 56\), rgb\(186, 98, 34/.test((await layer()).bg));
  // Intensitaet 50 %
  await ctx.run(`(() => { const i = ${settingRow('Intensität')}.querySelector('input[type=range]'); i.value = 50; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ctx.wait(500);
  const half = await ctx.run(`document.querySelector('#glow .glow-top').style.maskImage`);
  check('Intensitaet 50 %: staerkste Stelle 0,425 statt 0,85 (Chromium speichert die Deckkraft in 8 Bit: 0,424)', /, 0\.42[45]\) 0%/.test(half), half.slice(0, 90));
  // eigener Bereich Suche in Rot, Bereich Startseite aus
  const areaPick = (scope, label) => ctx.run(`[...document.querySelector('[data-glow-scope="${scope}"]').querySelectorAll('.segmented button')].find((b) => b.textContent === ${JSON.stringify(label)})?.click()`);
  await areaPick('search', 'Eigene');
  await ctx.wait(400);
  await ctx.run(`(() => { const own = document.querySelector('[data-glow-own="search"]'); const sw = [...own.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Farbverlauf'); sw.querySelector('button.switch').click(); })()`);
  await ctx.wait(300);
  await ctx.run(`document.querySelector('[data-glow-own="search"] [data-glow-color="red"]').click()`);
  await ctx.wait(300);
  await areaPick('home', 'Aus');
  await ctx.wait(1000); // gebuendelt gespeichert
  const saved = ctx.config.settings.glow;
  check('Gespeichert: Verlauf Rot zu Orange, 50 %, Suche eigene Einzelfarbe Rot, Startseite aus', saved.firstHex === '#b02838' && saved.intensity === 50 && saved.areas.search?.own === true && saved.areas.search.color === 'red' && saved.areas.search.gradient === false && saved.areas.home?.enabled === false, JSON.stringify(saved));
  await go('#/search?q=a', `!!document.querySelector('.search')`);
  const search = await layer();
  check('Suche zeigt ihre eigene Einstellung (Rot, einfarbig)', /176, 40, 56/.test(search.bg) && search.mask === 'none', search.bg);
  await go('#/home', `!!document.querySelector('.home .rows .card')`);
  const off = await layer();
  check('Startseite aus: kein Schein', off.scope === 'home' && !off.top && !off.bottom);
  // alles zuruecksetzen (mit Rueckfrage)
  await go('#/settings/appearance', `!!document.querySelector('.glow-settings')`);
  await ctx.run(`${settingRow('Ambient Glow zurücksetzen')}.querySelector('button').click()`);
  await waitFor(`!!document.querySelector('.mdl .btn.primary, .mdl .btn.danger')`, 3000);
  await ctx.run(`[...document.querySelectorAll('.mdl .mdl-actions .btn')].pop().click()`);
  await ctx.wait(1000);
  const reset = ctx.config.settings.glow;
  check('Zuruecksetzen: wieder Standard (an, Lila zu Blau, 100 %, keine Bereiche)', reset.enabled === true && reset.firstHex === '#5e3abe' && reset.intensity === 100 && Object.keys(reset.areas).length === 0, JSON.stringify(reset));
  // aus
  await ctx.run(`${settingRow('Ambient Glow')}.querySelector('button.switch').click()`);
  await ctx.wait(500);
  const allOff = await layer();
  check('Ambient Glow aus: kein Schein, die Seitenfarbe bleibt', !allOff.top && !allOff.bottom);
  await ctx.run(`${settingRow('Ambient Glow')}.querySelector('button.switch').click()`);
  await ctx.wait(500);

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
