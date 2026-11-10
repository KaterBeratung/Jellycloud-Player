// Zurueck auf die Startseite mit Trailer im Banner (JC_DEV=1, JC_FAKE_MPV=1; braucht Internet, YouTube): nach dem Zurueckwechseln startet der Trailer neu und blendet nach einigen Sekunden ein.
// Aufgenommen wird laenger als eine Sekunde (bis der Trailer wieder zu sehen ist), um zu sehen, was dabei unten am Banner und an der ersten Reihe passiert.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-trailer-return.js
const path = require('node:path');
const { server, items } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
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
  const movies = [...items.values()].filter((i) => i.Type === 'Movie').sort((a, b) => (a.DateCreated < b.DateCreated ? 1 : -1));
  movies[0].RemoteTrailers = YT;
  const other = movies[3];
  ctx.config.updateSettings({ trailer: { autoplay: true, home: true, muted: true, delaySec: 0, quality: '1080', focusSec: 0 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2300);
  ctx.win.setContentSize(1760, 990);
  await ctx.wait(600);

  const STATE = `(() => {
    const hero = document.querySelector('.hero'); const slide = document.querySelector('.hero-slide.active'); const tr = slide?.querySelector('.trailer'); const ifr = tr?.querySelector('iframe');
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width) }; };
    return { hero: r(hero), trailer: r(tr), iframe: r(ifr), on: !!tr?.classList.contains('on'), scale: tr?.style.getPropertyValue('--tr-scale') ?? null, rowsTop: r(document.querySelector('.rows'))?.top, head: r(document.querySelector('.rows .row-head')), has: slide?.classList.contains('has-trailer') };
  })()`;

  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  console.log('Trailer laeuft im Banner:', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 45000));
  await ctx.wait(1500);
  console.log('Ausgangszustand:', JSON.stringify(await ctx.run(STATE)));
  await ctx.capture(path.join(out, 'R-0-vorher.png'));

  for (let round = 1; round <= 2; round++) {
    await ctx.run(`location.hash = '#/item/${other.Id}'`);
    await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 8000);
    await ctx.wait(1500);
    await ctx.run(`history.back()`);
    const t0 = Date.now();
    for (const ms of [100, 250, 500, 1000, 2000, 3500, 5000, 7000, 9000, 12000]) {
      await ctx.wait(Math.max(0, ms - (Date.now() - t0)));
      const s = await ctx.run(STATE);
      console.log(`Runde ${round} ${ms} ms:`, JSON.stringify(s));
      await ctx.capture(path.join(out, `R-${round}-${String(ms).padStart(5, '0')}.png`));
    }
  }
  server.close();
};
