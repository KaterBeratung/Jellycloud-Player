// Standard-Akzent (neutrales Silberweiss): Werte pruefen und Aufnahmen auf Midnight, Daylight und mit Koenigsblau.
const path = require('node:path');
const { server } = require('../mock-server');
module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  let fail = 0;
  const check = (name, ok, info = '') => { console.log(`${ok ? 'OK   ' : 'FEHLER'} ${name}${info ? ' - ' + info : ''}`); if (!ok) fail++; };
  const vars = () => ctx.run(`(() => { const s = getComputedStyle(document.documentElement); return { accent: s.getPropertyValue('--accent').trim(), ink: s.getPropertyValue('--accent-ink').trim(), rgb: s.getPropertyValue('--accent-rgb').trim(), theme: document.documentElement.dataset.theme }; })()`);
  ctx.win.setContentSize(1280, 800);
  await ctx.wait(600);

  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(3000);
  let v = await vars();
  console.log('Midnight:', JSON.stringify(v));
  check('Midnight: Akzent ist Silberweiss', v.accent === 'rgb(245 245 247)' && v.ink === '#12131a', JSON.stringify(v));
  check('Midnight: Tonung ist abgedunkelt', v.rgb === '147 147 148', v.rgb);
  await ctx.capture(path.join(out, 'N-home.png'));

  await ctx.run(`location.hash = '#/settings/appearance'`);
  await ctx.wait(2000);
  await ctx.capture(path.join(out, 'N-settings.png'));
  await ctx.run(`document.querySelector('.setting:nth-child(6)')?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(600);
  await ctx.capture(path.join(out, 'N-settings-switches.png'));

  // Daylight: neutraler Akzent wird dunkel
  await ctx.run(`document.querySelector('[data-theme-id="daylight"]').click()`);
  await ctx.wait(900);
  v = await vars();
  console.log('Daylight:', JSON.stringify(v));
  check('Daylight: neutraler Akzent wird dunkel (sonst unsichtbar)', v.theme === 'daylight' && v.accent === 'rgb(29 29 31)' && v.ink === '#ffffff', JSON.stringify(v));
  await ctx.run(`document.querySelector('.settings-stack, .settings')?.scrollIntoView({ block: 'start' })`);
  await ctx.wait(400);
  await ctx.capture(path.join(out, 'N-settings-day.png'));
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(2800);
  await ctx.capture(path.join(out, 'N-home-day.png'));

  // zurueck auf Midnight, dann Koenigsblau gezielt waehlen (muss weiterhin funktionieren)
  await ctx.run(`location.hash = '#/settings/appearance'`);
  await ctx.wait(1500);
  await ctx.run(`document.querySelector('[data-theme-id="midnight"]').click()`);
  await ctx.wait(500);
  await ctx.run(`document.querySelector('.swatch[data-color="#0b2dbf"]').click()`);
  await ctx.wait(800);
  v = await vars();
  check('Koenigsblau bleibt waehlbar', v.accent === 'rgb(11 45 191)' && v.ink === '#ffffff', JSON.stringify(v));
  await ctx.run(`document.querySelector('.setting:nth-child(6)')?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(500);
  await ctx.capture(path.join(out, 'N-settings-blue.png'));
  // Zuruecksetzen fuehrt zum neuen Standard
  await ctx.run(`document.querySelector('.accent-hex .btn')?.click()`);
  await ctx.wait(700);
  v = await vars();
  check('Zuruecksetzen fuehrt zum neutralen Standard', v.accent === 'rgb(245 245 247)', JSON.stringify(v));

  console.log(`\nErgebnis: ${fail ? fail + ' Fehler' : 'alles in Ordnung'}`);
  server.close();
  if (fail) process.exitCode = 1;
};
