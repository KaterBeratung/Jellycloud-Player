// Apple-TV-Stil: Hero, Reihen und der Hover-Effekt der Karten (Neigung + Glanz) mit echten Mausereignissen.
const path = require('node:path');
const { server } = require('../mock-server');
module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  let fail = 0;
  const check = (name, ok, info = '') => { console.log(`${ok ? 'OK   ' : 'FEHLER'} ${name}${info ? ' - ' + info : ''}`); if (!ok) fail++; };
  const wc = ctx.win.webContents;

  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    ctx.win.setContentSize(w, h);
    await ctx.wait(700);
    await ctx.run(`location.hash = '#/home'`);
    await ctx.wait(2800);
    await ctx.capture(path.join(out, `T-${w}x${h}-hero.png`));
    const geo = await ctx.run(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; }; return { hero: r('.hero'), content: r('.hero-content'), dots: r('.hero-dots'), pill: r('.navpill'), tools: r('.toolpill'), row: r('.rows .row') }; })()`);
    console.log(`[${w}x${h}]`, JSON.stringify(geo));
    const center = geo.pill.x + geo.pill.w / 2;
    check(`[${w}] Navigationskapsel mittig`, Math.abs(center - w / 2) < 14 || Math.abs(center - (w - 15) / 2) < 14, `Mitte ${Math.round(center)} von ${w}`);
    check(`[${w}] Seitenpunkte mittig und unter dem Hero-Inhalt`, geo.dots && geo.content && Math.abs(geo.dots.x + geo.dots.w / 2 - w / 2) < 14 && geo.dots.y > geo.content.y + geo.content.h, `Punkte y=${geo.dots?.y}, Inhalt endet bei ${geo.content ? geo.content.y + geo.content.h : '?'}`);
    check(`[${w}] Hero-Inhalt liegt unter der Kopfzeile`, geo.content && geo.content.y >= 100, `y=${geo.content?.y}`);
  }

  // Hover-Effekt mit echter Maus
  ctx.win.setContentSize(1280, 800);
  await ctx.wait(600);
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(2500);
  await ctx.run(`document.querySelector('.rows .card .thumb').scrollIntoView({ block: 'center' })`);
  await ctx.wait(900);
  const r = await ctx.run(`(() => { const b = document.querySelector('.rows .card .thumb').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  const at = (fx, fy) => ({ type: 'mouseMove', x: Math.round(r.x + r.w * fx), y: Math.round(r.y + r.h * fy) });
  wc.sendInputEvent(at(0.5, 0.5));
  await ctx.wait(120);
  wc.sendInputEvent(at(0.85, 0.2));
  await ctx.wait(600);
  const hov = await ctx.run(`(() => { const t = document.querySelector('.rows .card .thumb'); const s = getComputedStyle(t); return { transform: s.transform, ry: t.style.getPropertyValue('--ry'), rx: t.style.getPropertyValue('--rx'), gx: t.style.getPropertyValue('--gx'), glare: getComputedStyle(t, '::before').opacity, hover: t.matches(':hover') }; })()`);
  console.log('Hover:', JSON.stringify(hov));
  check('Karte reagiert auf den Mauszeiger (hover)', hov.hover === true);
  check('Neigung zur Maus gesetzt (rechts oben = positive Y-Drehung)', parseFloat(hov.ry) > 2 && parseFloat(hov.rx) > 1, `ry=${hov.ry} rx=${hov.rx}`);
  check('Karte ist angehoben und 3D-geneigt (Transformationsmatrix)', /matrix3d/.test(hov.transform), hov.transform.slice(0, 40));
  check('Glanzpunkt sichtbar', parseFloat(hov.glare) > 0.9, `Deckkraft ${hov.glare}`);
  await ctx.capture(path.join(out, 'T-hover-card.png'));
  wc.sendInputEvent({ type: 'mouseMove', x: 5, y: 400 });
  await ctx.wait(700);
  const rest = await ctx.run(`(() => { const t = document.querySelector('.rows .card .thumb'); return { transform: getComputedStyle(t).transform, ry: t.style.getPropertyValue('--ry') }; })()`);
  check('Nach dem Verlassen ist die Karte wieder gerade', rest.ry === '' && (rest.transform === 'none' || /^matrix\(1, 0, 0, 1, 0, 0\)$/.test(rest.transform)), JSON.stringify(rest));

  // Animationen aus: keine Neigung
  await ctx.run(`document.documentElement.dataset.anim = 'off'`);
  wc.sendInputEvent(at(0.5, 0.5));
  await ctx.wait(100);
  wc.sendInputEvent(at(0.9, 0.9));
  await ctx.wait(400);
  const off = await ctx.run(`document.querySelector('.rows .card .thumb').style.getPropertyValue('--ry')`);
  check('Mit ausgeschalteten Animationen keine Neigung', off === '', `--ry="${off}"`);

  // Nur Aufnahmen (keine Pruefung): Reihe mit Pfeil im Titel und Detailseite
  await ctx.run(`document.documentElement.dataset.anim = 'full'`);
  wc.sendInputEvent({ type: 'mouseMove', x: 5, y: 400 });
  await ctx.run(`document.querySelectorAll('.row-title')[0]?.scrollIntoView({ block: 'start' })`);
  await ctx.wait(900);
  const rt = await ctx.run(`document.querySelectorAll('.row-title').length`);
  check('Reihen mit Ziel haben einen Titel-Link mit Pfeil', rt > 0, `${rt} Stueck`);
  await ctx.capture(path.join(out, 'T-poster-row.png'));
  const movieHref = await ctx.run(`document.querySelector('.rows .row:not(:first-child) a.card')?.getAttribute('href')`);
  await ctx.run(`location.hash = ${JSON.stringify(movieHref)}`);
  await ctx.wait(2500);
  await ctx.run(`(document.querySelector('#view') || document.scrollingElement).scrollTop = 0`);
  await ctx.wait(700);
  await ctx.capture(path.join(out, 'T-detail.png'));

  console.log(`\nErgebnis: ${fail ? fail + ' Fehler' : 'alles in Ordnung'}`);
  server.close();
  if (fail) process.exitCode = 1;
};
