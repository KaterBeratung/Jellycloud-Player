// Absinken (freier Blick) bei Serien und Filmen in mehreren Fenstergroessen (JC_DEV=1; braucht Internet, YouTube).
// Zeigt Bilder vom Ruhezustand, aus der Mitte und vom Ende und misst Poster/Titel; so sieht man, ob es bei Serien genauso gut aussieht wie bei Filmen.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/trailer-series.js
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
  const YT = [{ Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  const movie = [...items.values()].find((i) => i.Name === 'The Last Lighthouse');
  series.RemoteTrailers = YT;
  movie.RemoteTrailers = YT;
  ctx.config.updateSettings({ trailer: { autoplay: true, muted: true, delaySec: 0, quality: '720', focusSec: 3, focusStyle: 'poster' } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);

  const metrics = () => ctx.run(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) }; };
    const p = r('.detail-poster'); const t = r('.detail-title, .detail-logo');
    const H = innerHeight;
    return { H, W: innerWidth, poster: p, title: t, posterTop: p && +(p.y / H).toFixed(2), titleMid: t && +(((t.y + t.b) / 2) / H).toFixed(2), visible: p && +(Math.max(0, Math.min(p.b, H * 0.84) - p.y) / p.h).toFixed(2), infoKids: [...document.querySelectorAll('.detail-info > *')].map((e) => e.className.split(' ')[0] + ':' + getComputedStyle(e).opacity) };
  })()`);

  for (const [w, h] of [[1280, 720], [920, 620], [1920, 1080]]) {
    ctx.win.setContentSize(w, h);
    await ctx.wait(600);
    for (const [kind, item] of [['serie', series], ['film', movie]]) {
      await ctx.run(`location.hash = '#/home'`);
      await ctx.wait(500);
      await ctx.run(`location.hash = '#/item/${item.Id}'`);
      await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 10000);
      const on = await waitFor(`!!document.querySelector('.trailer.on')`, 40000);
      check(`[${w}x${h}] ${kind}: Trailer laeuft`, on);
      await ctx.wait(1500);
      const rest = await metrics();
      await ctx.capture(path.join(out, `S-${w}x${h}-${kind}-1-ruhe.png`));
      await waitFor(`!!document.querySelector('.detail-bd.tr-focus')`, 9000);
      await ctx.wait(3000);
      await ctx.capture(path.join(out, `S-${w}x${h}-${kind}-2-mitte.png`));
      await ctx.wait(3500);
      const end = await metrics();
      await ctx.capture(path.join(out, `S-${w}x${h}-${kind}-3-ende.png`));
      console.log(`[${w}x${h}] ${kind}: Ruhe ${JSON.stringify({ posterTop: rest.posterTop, titleMid: rest.titleMid })}  Ende ${JSON.stringify({ posterTop: end.posterTop, titleMid: end.titleMid, visible: end.visible, kids: end.infoKids })}`);
      check(`[${w}x${h}] ${kind}: am Ende stehen Poster (Oberkante 55 bis 68 %) und Titel (Mitte des sichtbaren Posters)`, end.posterTop > 0.5 && end.posterTop < 0.72 && end.titleMid > end.posterTop && end.titleMid < 0.8, JSON.stringify({ posterTop: end.posterTop, titleMid: end.titleMid }));
    }
  }
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
