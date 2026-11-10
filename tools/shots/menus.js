// Screenshots der Glas-Menues (App + Player-Overlay). Start mit JC_DEV=1 und JC_FAKE_MPV=1.
const path = require('node:path');
const { server, items } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');

  // ---- App: Detailseite, Audio-Menue ----
  ctx.win.setContentSize(1280, 760);
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await ctx.wait(2400);
  await ctx.run(`document.querySelectorAll('.detail-options .opt')[1]?.click()`);
  await ctx.wait(800);
  await ctx.capture(path.join(out, 'M-01-app-audio-menu.png'));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(300);
  await ctx.run(`document.querySelectorAll('.detail-options .opt')[2]?.click()`);
  await ctx.wait(800);
  await ctx.capture(path.join(out, 'M-02-app-subtitle-menu.png'));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(300);

  // ---- App: Bibliothek, Sortierung + Genre ----
  const lib = await ctx.run(`document.querySelectorAll('.nav-link')[1].getAttribute('href')`);
  await ctx.run(`location.hash = '${lib}'`);
  await ctx.wait(2200);
  await ctx.run(`document.querySelectorAll('.lib-controls .btn')[1]?.click()`);
  await ctx.wait(800);
  await ctx.capture(path.join(out, 'M-03-app-genre-menu.png'));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // ---- Player ----
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: true })`);
  const player = ctx.player;
  for (let i = 0; i < 40 && player.state.phase !== 'playing'; i++) await ctx.wait(150);
  const ov = () => player.overlay;
  const ev = (js) => ov().webContents.executeJavaScript(js);
  const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  // Backdrop als Videoersatz hinter das transparente Overlay legen, damit der Glas-Effekt sichtbar wird
  await ev(`document.body.style.background = "url('jellycloud://img/${movie.Id}/Backdrop?maxWidth=1600') center / cover"`);
  await ctx.wait(1200);
  await key('s');
  await ctx.wait(700);
  await ctx.capture(path.join(out, 'M-04-player-tracks.png'), ov());
  await key('Escape');
  await ctx.wait(300);
  await ev(`document.querySelector('.chip').click()`);
  await ctx.wait(700);
  await ctx.capture(path.join(out, 'M-05-player-speed.png'), ov());
  await key('Escape');
  await ctx.wait(300);
  await key('i');
  await ctx.wait(700);
  await ctx.capture(path.join(out, 'M-06-player-info.png'), ov());
  await ev(`window.player.send({ type: 'close' })`);
  await ctx.wait(1000);
  server.close();
};
