// Ein Trailer laeuft nur einmal (JC_DEV=1; braucht Internet, YouTube, Big Buck Bunny): nach dem Ende wird er weder in einer Schleife noch beim Zurueckscrollen, nach einem Fensterwechsel oder beim
// naechsten Durchlauf des Banners wiederholt. Auf einer neuen Seite beziehungsweise einem neuen Besuch der Startseite spielt er wieder.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/trailer-once.js
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
  const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  const byNew = (a, b) => (a.DateCreated < b.DateCreated ? 1 : -1);
  const movies = [...items.values()].filter((i) => i.Type === 'Movie').sort(byNew);
  const shows = [...items.values()].filter((i) => i.Type === 'Series').sort(byNew);
  movies[0].RemoteTrailers = [{ Url: YT }];
  shows[0].RemoteTrailers = [{ Url: YT }];
  ctx.config.updateSettings({ trailer: { autoplay: true, home: true, muted: true, delaySec: 0, quality: '720', focusSec: 0 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2300);
  ctx.win.setContentSize(1500, 900);
  await ctx.wait(500);
  const seekEnd = (sel) => ctx.run(`document.querySelector('${sel} iframe').contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [592, true] }), '*')`);
  const activeIndex = () => ctx.run(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active'))`);
  const frames = (sel) => ctx.run(`document.querySelectorAll('${sel} iframe').length`);

  // ---------- 1. Detailseite ----------
  await ctx.run(`location.hash = '#/item/${movies[0].Id}'`);
  check('Detailseite: der Trailer laeuft im Hintergrund', await waitFor(`!!document.querySelector('.detail-bd .trailer.on')`, 45000));
  const src = await ctx.run(`document.querySelector('.detail-bd .trailer iframe')?.getAttribute('src') ?? ''`);
  check('Die Einbettung hat keine Schleife (weder loop noch playlist)', src !== '' && !/[?&](loop|playlist)=/.test(src), src);
  await ctx.wait(1500);
  await seekEnd('.detail-bd .trailer');
  check('Nach dem Ende ist der Trailer ausgeblendet', await waitFor(`!document.querySelector('.detail-bd .trailer.on') && !document.querySelector('.detail-bd.has-trailer')`, 45000));
  check('...und der beendete Player ist ganz entfernt (kein Rahmen bleibt liegen, der neu starten koennte)', await waitFor(`!document.querySelector('.detail-bd iframe')`, 5000));
  await ctx.wait(1500);
  // Aus dem Bild und zurueck scrollen, Fenster verdecken und wieder zeigen
  await ctx.run(`(() => { let e = document.querySelector('.detail'); while (e && !(e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; (e ?? document.scrollingElement).scrollTop = 4000; })()`);
  await ctx.wait(1200);
  await ctx.run(`(() => { let e = document.querySelector('.detail'); while (e && !(e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; (e ?? document.scrollingElement).scrollTop = 0; })()`);
  await ctx.wait(1500);
  await ctx.run(`document.dispatchEvent(new Event('visibilitychange'))`);
  await ctx.wait(2500);
  check('Zurueckgescrollt und Sichtbarkeitswechsel: der Trailer startet nicht noch einmal (kein Rahmen, nicht eingeblendet)', (await frames('.detail-bd')) === 0 && (await ctx.run(`!document.querySelector('.detail-bd .trailer.on')`)));
  await ctx.capture(path.join(out, 'O-01-detail-nach-ende.png'));
  // Neue Seite: ein neuer Besuch spielt den Trailer wieder
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(1000);
  await ctx.run(`location.hash = '#/item/${movies[0].Id}'`);
  check('Die Seite neu geoeffnet: der Trailer laeuft wieder (ein neuer Besuch, keine Schleife)', await waitFor(`!!document.querySelector('.detail-bd .trailer iframe')`, 20000));

  // ---------- 2. Banner der Startseite ----------
  await ctx.run(`location.hash = '#/search'`);
  await ctx.wait(600);
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  check('Banner: der Trailer der ersten Folie laeuft', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 45000));
  const hsrc = await ctx.run(`document.querySelector('.hero-slide.active .trailer iframe')?.getAttribute('src') ?? ''`);
  check('Banner: die Einbettung hat keine Schleife', hsrc !== '' && !/[?&](loop|playlist)=/.test(hsrc), hsrc);
  await ctx.wait(1500);
  await seekEnd('.hero-slide.active .trailer');
  check('Banner: nach dem Ende geht es zur zweiten Folie (Serie)', await waitFor(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active')) === 1`, 45000), `Folie ${await activeIndex()}`);
  check('Banner: die zweite Folie startet ihren Trailer', await waitFor(`!!document.querySelector('.hero-slide.active .trailer iframe')`, 15000));
  // Zurueck zur ersten Folie (Punkt): ihr Trailer ist in diesem Besuch schon gelaufen, es bleibt beim Bild
  await ctx.run(`document.querySelectorAll('.hero .dot')[0]?.click()`);
  await ctx.wait(4000);
  check('Banner: zurueck bei der ersten Folie spielt ihr Trailer nicht noch einmal (kein Rahmen, Bild mit Zeitbalken)', (await activeIndex()) === 0 && (await frames('.hero-slide.active')) === 0 && (await ctx.run(`!!document.querySelector('.hero-dots .dot.run')`)), `Folie ${await activeIndex()}, Rahmen ${await frames('.hero-slide.active')}`);
  await ctx.capture(path.join(out, 'O-02-banner-erste-folie-nochmal.png'));
  check('Banner: es laeuft weiter wie ohne Trailer (nach etwa 9 s zur zweiten Folie, deren Trailer ebenfalls noch nicht gelaufen ist)', await waitFor(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active')) === 1`, 12000));
  // Neuer Besuch der Startseite: die aktive Folie spielt ihren Trailer wieder
  await ctx.run(`document.querySelectorAll('.hero .dot')[0]?.click()`);
  await ctx.wait(1000);
  await ctx.run(`location.hash = '#/search'`);
  await ctx.wait(1200);
  await ctx.run(`location.hash = '#/home'`);
  check('Banner: ein neuer Besuch der Startseite spielt den Trailer der aktiven Folie wieder', await waitFor(`!!document.querySelector('.hero-slide.active .trailer iframe')`, 15000));

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
