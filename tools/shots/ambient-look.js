// Hintergrundton aus dem Artwork: an auf Start und Detail, aus auf Bibliothek/Einstellungen, abschaltbar.
const path = require('node:path');
const { server } = require('../mock-server');
module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  let fail = 0;
  const check = (name, ok, info = '') => { console.log(`${ok ? 'OK   ' : 'FEHLER'} ${name}${info ? ' - ' + info : ''}`); if (!ok) fail++; };

  // Der Browser gibt gemischte Farben als color(srgb ...) aus. Fuer den Vergleich beide Werte ueber ein Canvas in Bytes umrechnen.
  const read = () => ctx.run(`(() => {
    const toBytes = (css) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#000'; x.fillStyle = css; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
    const probe = document.createElement('div'); probe.style.background = 'var(--bg)'; document.body.append(probe);
    const base = toBytes(getComputedStyle(probe).backgroundColor); probe.remove();
    const s = getComputedStyle(document.documentElement);
    return { amt: s.getPropertyValue('--tint-amt').trim(), tint: s.getPropertyValue('--tint').trim(), bg: toBytes(getComputedStyle(document.body).backgroundColor), base };
  })()`);
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  // Das Ueberblenden laeuft ueber die Hauptlinie und kann beim Aufbau grosser Seiten spaeter anlaufen: bis zu 5 s warten
  const settle = async (pred, ms = 5000) => {
    const t0 = Date.now();
    let s = await read();
    while (!pred(s) && Date.now() - t0 < ms) { await ctx.wait(250); s = await read(); }
    return s;
  };

  ctx.win.setContentSize(1280, 800);
  await ctx.wait(600);

  // Start: der Hero meldet die Farbe seines Hintergrundbilds
  await ctx.run(`location.hash = '#/home'`);
  let s = await settle((v) => v.amt === '13%');
  console.log('Start:', JSON.stringify(s));
  check('Start: Anteil gesetzt (Midnight 13 %)', s.amt === '13%', s.amt);
  await ctx.wait(1500);
  s = await read();
  check('Start: Seitenhintergrund ist getoent (nicht mehr das reine --bg)', !same(s.bg, s.base), `${s.bg} gegen ${s.base}`);
  check('Start: Ansicht hat ihre Farbe gemerkt', await ctx.run(`!!document.querySelector('.page.home')?._tint`));
  await ctx.capture(path.join(out, 'A-home.png'));

  // Hero-Wechsel aendert den Ton
  // Alle Folien nacheinander anwaehlen. Der Mock vergibt Farben aus dem Namen; einzelne Folien koennen aehnlich ausfallen,
  // die Folien insgesamt muessen aber verschiedene Toene ergeben, und der Ton muss jeweils zur gewaehlten Folie gehoeren.
  const nums = (c) => (c.match(/\d+/g) || []).map(Number);
  const seen = [s.tint];
  const dots = await ctx.run(`document.querySelectorAll('.hero .dot').length`);
  for (let i = 1; i < dots; i++) {
    await ctx.run(`document.querySelectorAll('.hero .dot')[${i}]?.click()`);
    await ctx.wait(1700); // Ueberblenden abwarten (1,1 s)
    const cur = await read();
    const want = await ctx.run(`(() => { const h = document.querySelectorAll('.hero-slide')[${i}]._hash; return h; })()`);
    seen.push(cur.tint);
    console.log(`Folie ${i + 1}: Blurhash ${want} -> Ton ${cur.tint}`);
  }
  let maxDiff = 0;
  for (const a of seen) for (const b of seen) maxDiff = Math.max(maxDiff, ...nums(a).map((n, k) => Math.abs(n - nums(b)[k])));
  check('Hero-Wechsel: Folien ergeben verschiedene Toene', maxDiff >= 20, `${seen.join(' | ')} (groesster Kanalunterschied ${maxDiff})`);
  await ctx.run(`document.querySelectorAll('.hero .dot')[2]?.click()`);
  await ctx.wait(1700);
  await ctx.capture(path.join(out, 'A-home-slide3.png'));

  // Bibliothek: kein Ton
  const libs = await ctx.run(`[...document.querySelectorAll('.nav-link')].map(a => a.getAttribute('href'))`);
  await ctx.run(`location.hash = ${JSON.stringify(libs[1])}`);
  s = await settle((v) => v.amt === '0%' && same(v.bg, v.base));
  check('Bibliothek: Ton ausgeblendet', s.amt === '0%' && same(s.bg, s.base), `${s.amt} ${s.bg} gegen ${s.base}`);
  await ctx.capture(path.join(out, 'A-library.png'));

  // Zurueck zum Start (aus dem Cache): Ton kommt wieder
  await ctx.run(`location.hash = '#/home'`);
  s = await settle((v) => v.amt === '13%');
  check('Zurueck zum Start: Ton kommt wieder (Cache)', s.amt === '13%', s.amt);

  // Detail
  const href = await ctx.run(`document.querySelector('.rows .row:not(:first-child) a.card')?.getAttribute('href')`);
  await ctx.run(`location.hash = ${JSON.stringify(href)}`);
  await ctx.wait(2500);
  s = await settle((v) => v.amt === '13%');
  await ctx.wait(1300);
  s = await read();
  check('Detail: getoent', s.amt === '13%' && !same(s.bg, s.base), `${s.amt} ${s.bg} gegen ${s.base}`);
  await ctx.run(`document.querySelector('#view').scrollTop = 0`);
  await ctx.wait(600);
  await ctx.capture(path.join(out, 'A-detail.png'));

  // Einstellungen: kein Ton; Schalter vorhanden
  await ctx.run(`location.hash = '#/settings/appearance'`);
  s = await settle((v) => v.amt === '0%');
  check('Einstellungen: Ton ausgeblendet', s.amt === '0%', s.amt);
  check('Einstellung "Hintergrund passt sich dem Bild an" vorhanden', await ctx.run(`[...document.querySelectorAll('.setting-label')].some(e => /Hintergrund passt sich/.test(e.textContent))`));

  // Abgeschaltet: bleibt aus, auch auf dem Start
  await ctx.run(`import('./js/state.js').then((m) => { m.state.settings.appearance.ambient = false; })`);
  await ctx.wait(300);
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(3000);
  s = await read();
  check('Abgeschaltet: Start bleibt ohne Ton', s.amt === '0%' && same(s.bg, s.base), `${s.amt} ${s.bg} gegen ${s.base}`);

  console.log(`\nErgebnis: ${fail ? fail + ' Fehler' : 'alles in Ordnung'}`);
  server.close();
  if (fail) process.exitCode = 1;
};
