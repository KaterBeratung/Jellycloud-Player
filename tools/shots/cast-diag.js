// Misst Besetzungs-Platzhalter (Personen ohne Bild) und die Icons der Kopfzeile und speichert Screenshots.
const path = require('node:path');
const { server, items } = require('../mock-server');
module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.win.setContentSize(1280, 800);
  await ctx.wait(500);
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await ctx.wait(2500);
  const box = (sel) => ctx.run(`(() => [...document.querySelectorAll(${JSON.stringify(sel)})].slice(0, 3).map((e) => { const b = e.getBoundingClientRect(); return { cls: e.className, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; }))()`);
  console.log('person:', JSON.stringify(await box('.person')));
  console.log('avatar:', JSON.stringify(await box('.avatar')));
  console.log('tools:', JSON.stringify(await box('.toolpill, .toolpill > *')));
  console.log('navpill:', JSON.stringify(await box('.navpill')));
  await ctx.run(`document.querySelector('.people')?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(900);
  await ctx.capture(path.join(out, 'C-cast.png'));
  await ctx.run(`location.hash = '#/settings'`);
  await ctx.wait(1500);
  await ctx.capture(path.join(out, 'C-topbar-settings.png'));
  server.close();
};
