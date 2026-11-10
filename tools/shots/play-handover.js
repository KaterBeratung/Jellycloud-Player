// Klick auf "Abspielen" waehrend der Trailer laeuft (JC_DEV=1, JC_FAKE_MPV=1; braucht Internet, YouTube, Big Buck Bunny):
// Die Seite darf sich beim Start der Wiedergabe nicht sichtbar veraendern. Frueher wurde der Trailer sofort abgebaut (Hintergrundbild und Normalzustand der Seite
// kamen zum Vorschein, solange mpv noch nichts zeichnete). Jetzt bleibt alles stehen, bis der schwarze Vorhang (#play-curtain) zu ist, und wird erst dann aufgeraeumt.
// Gemessen wird in der Seite, Bild fuer Bild (requestAnimationFrame): Deckkraft des Vorhangs, Trailer-Ebene, Klassen am Hintergrund.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/play-handover.js
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
  movies[0].RemoteTrailers = [{ Url: YT }];
  ctx.config.updateSettings({ trailer: { autoplay: true, home: true, muted: true, delaySec: 0, quality: '720', focusSec: 3 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2300);
  ctx.win.setContentSize(1500, 900);
  await ctx.wait(500);

  // Eine Messreihe: Klick und danach Bild fuer Bild 900 ms lang
  const clickAndSample = (selector) =>
    ctx.run(`new Promise((resolve) => {
      const samples = [];
      const t0 = performance.now();
      const curtain = document.querySelector('#play-curtain');
      const snap = () => {
        const host = document.querySelector(${JSON.stringify(selector)});
        const layer = host?.querySelector('.trailer');
        return { t: Math.round(performance.now() - t0), op: +(+getComputedStyle(curtain).opacity).toFixed(2), layer: !!layer, on: !!layer?.classList.contains('on'), has: !!host?.classList.contains('has-trailer'), focus: !!host?.classList.contains('tr-focus'), frame: !!host?.querySelector('iframe') };
      };
      const first = snap();
      const btn = [...document.querySelectorAll('.detail-actions .btn, .hero-slide.active .btn')].find((b) => /Von vorn|From start|Abspielen|Play|Fortsetzen/.test(b.textContent));
      btn.click();
      (function tick() {
        samples.push(snap());
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
        else resolve({ first, samples });
      })();
    })`);

  const verdict = (label, r) => {
    const covered = r.samples.find((s) => s.op >= 0.95);
    const early = r.samples.filter((s) => s.op < 0.95);
    const changed = early.filter((s) => s.layer !== r.first.layer || s.on !== r.first.on || s.has !== r.first.has || s.focus !== r.first.focus);
    const gone = r.samples.find((s) => !s.layer && !s.frame);
    console.log(`[${label}] vorher ${JSON.stringify(r.first)}; Vorhang zu nach ${covered?.t ?? 'nie'} ms; erste Aenderung der Seite bei ${changed[0]?.t ?? '-'} ms (Vorhang ${changed[0]?.op ?? '-'}); Trailer weg nach ${gone?.t ?? 'nie'} ms`);
    check(`${label}: der Vorhang ist zu (Deckkraft 1) innerhalb von 250 ms`, !!covered && covered.t <= 250, `${covered?.t ?? 'nie'} ms`);
    check(`${label}: solange der Vorhang noch offen ist, aendert sich die Seite nicht (Trailer-Ebene, Klassen)`, changed.length === 0, changed.length ? `Aenderung bei ${changed[0].t} ms, Vorhang erst ${changed[0].op}` : `${early.length} Bilder unveraendert`);
    check(`${label}: danach ist der Trailer aufgeraeumt (Rahmen entfernt, spart Rechenlast waehrend des Films)`, !!gone && (!covered || gone.t >= covered.t), `${gone?.t ?? 'nie'} ms`);
  };

  // ---------- Detailseite, Trailer im freien Blick (Poster und Titel abgesunken) ----------
  await ctx.run(`location.hash = '#/item/${movies[0].Id}'`);
  check('Detailseite: der Trailer laeuft im Hintergrund', await waitFor(`!!document.querySelector('.detail-bd .trailer.on')`, 45000));
  check('...und die Seite ist im freien Blick (Klasse tr-focus)', await waitFor(`!!document.querySelector('.detail-bd.tr-focus')`, 30000));
  await ctx.capture(path.join(out, 'H-01-detail-vor-klick.png'));
  verdict('Detailseite', await clickAndSample('.detail-bd'));
  await ctx.capture(path.join(out, 'H-02-detail-nach-klick.png'));
  const player = ctx.player;
  await ctx.wait(600);
  await player.stop();
  await ctx.wait(1500);

  // ---------- Banner der Startseite ----------
  await ctx.run(`location.hash = '#/search'`);
  await ctx.wait(600);
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  check('Banner: der Trailer der ersten Folie laeuft', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 45000));
  verdict('Banner', await clickAndSample('.hero-slide.active'));
  await ctx.wait(600);
  await player.stop();
  await ctx.wait(1000);

  server.close();
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  if (pass !== results.length) process.exitCode = 1;
};
