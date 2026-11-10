// Stil "Logo in die Ecke" im freien Blick, Film und Serie, drei Fenstergroessen (JC_DEV=1; braucht Internet, YouTube).
// Ein Bildsampler (requestAnimationFrame) zeichnet waehrend des Absinkens und des Zurueckkommens Lage, Groesse und Deckkraft von Titel/Logo und Poster auf. Daraus wird geprueft,
// ob der Uebergang gut ist: kein Sprung, gleichmaessige Bewegung in eine Richtung, das Logo faehrt erst ueber das Poster, wenn es fast weg ist, es landet genau in der Ecke, und
// es geht ohne Flackern wieder zurueck. Dazu Bilder aus dem Ablauf und die Pruefung, dass beim Scrollen (Besetzung, aehnliche Titel ansehen) nichts ausgeblendet wird.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/trailer-corner.js
const path = require('node:path');
const { server, items } = require('../mock-server');

const SAMPLER = `(() => {
  window.__s = []; window.__stop = false; const t0 = performance.now();
  const tick = () => {
    const title = document.querySelector('.detail-title, .detail-logo'); const poster = document.querySelector('.detail-poster'); const meta = document.querySelector('.detail-meta'); const below = document.querySelector('.detail-body > :not(.detail-stage)');
    if (title && poster && meta) {
      const r = title.getBoundingClientRect(); const pr = poster.getBoundingClientRect(); const m = new DOMMatrixReadOnly(getComputedStyle(title).transform);
      window.__s.push({ t: Math.round(performance.now() - t0), left: r.left, right: r.right, top: r.top, bottom: r.bottom, cy: (r.top + r.bottom) / 2, scale: m.a, po: +getComputedStyle(poster).opacity, mo: +getComputedStyle(meta).opacity, bo: below ? +getComputedStyle(below).opacity : 1, pl: pr.left, pr: pr.right, pt: pr.top, pb: pr.bottom, focus: document.querySelector('.detail-bd').classList.contains('tr-focus') });
    }
    if (!window.__stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

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
  const mouse = (x, y) => ctx.run(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`);
  ctx.config.updateSettings({ trailer: { autoplay: true, muted: true, delaySec: 0, quality: '720', focusSec: 3, focusStyle: 'corner' } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);

  for (const [w, h] of [[1280, 720], [920, 620], [1920, 1080]]) {
    ctx.win.setContentSize(w, h);
    await ctx.wait(600);
    for (const [kind, item] of [['film', movie], ['serie', series]]) {
      const tag = `[${w}x${h}] ${kind}`;
      await ctx.run(`location.hash = '#/home'`);
      await ctx.wait(500);
      await ctx.run(`location.hash = '#/item/${item.Id}'`);
      await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 10000);
      const on = await waitFor(`!!document.querySelector('.trailer.on')`, 40000);
      check(`${tag}: Trailer laeuft`, on);
      await ctx.wait(1500);
      await ctx.capture(path.join(out, `C-${w}x${h}-${kind}-0-ruhe.png`));
      await ctx.run(SAMPLER);
      await waitFor(`!!document.querySelector('.detail-bd.tr-focus')`, 9000);
      const tFocus = Date.now();
      const snaps = w === 1280 ? [[900, '1'], [1700, '2'], [2400, '3'], [3100, '4'], [4500, '5']] : [];
      for (const [ms, n] of snaps) {
        await ctx.wait(Math.max(0, ms - (Date.now() - tFocus)));
        await ctx.capture(path.join(out, `C-${w}x${h}-${kind}-${n}-absinken.png`));
      }
      await ctx.wait(Math.max(0, 5200 - (Date.now() - tFocus)));
      // Zurueck: Mausbewegung, dann 1,5 s weiter aufzeichnen
      await mouse(300, 300);
      await mouse(380, 340);
      const tBack = Date.now();
      if (w === 1280) {
        await ctx.wait(200);
        await ctx.capture(path.join(out, `C-${w}x${h}-${kind}-6-zurueck.png`));
      }
      await ctx.wait(Math.max(0, 1500 - (Date.now() - tBack)));
      await ctx.run(`window.__stop = true`);
      const S = await ctx.run(`window.__s`);
      const H = h;
      const fi = S.findIndex((s) => s.focus);
      const bi = S.findIndex((s, i) => i > fi && !s.focus);
      const rest = S[Math.max(0, fi - 1)];
      const fo = S.slice(fi, bi);
      const back = S.slice(bi);
      const end = fo.at(-1);
      check(`${tag}: der Sampler hat genug Bilder (mindestens 40 beim Absinken)`, fo.length >= 40, `${fo.length} Bilder bei ${Math.round((fo.at(-1)?.t ?? 0) - (fo[0]?.t ?? 0))} ms`);
      check(`${tag}: das Logo landet in der Ecke: linke Kante auf der des Posters (+-3 px), Unterkante bei 80 % der Hoehe (+-4 px), Groesse 80 %`, Math.abs(end.left - rest.pl) <= 3 && Math.abs(end.bottom - H * 0.8) <= 4 && Math.abs(end.scale - 0.8) < 0.02, JSON.stringify({ left: Math.round(end.left), poster: Math.round(rest.pl), bottom: Math.round(end.bottom), soll: Math.round(H * 0.8), scale: +end.scale.toFixed(2) }));
      check(`${tag}: am Ende ist das Poster ganz weg, alle Texte und alles unterhalb auch`, end.po === 0 && end.mo === 0 && end.bo === 0, JSON.stringify({ poster: end.po, meta: end.mo, unten: end.bo }));
      check(`${tag}: beim Start springt nichts (erstes Bild des Absinkens liegt auf der Ruheposition, +-1,5 px)`, Math.abs(fo[0].cy - rest.cy) <= 1.5 && Math.abs(fo[0].left - rest.left) <= 1.5, JSON.stringify({ dy: Math.round((fo[0].cy - rest.cy) * 10) / 10, dx: Math.round((fo[0].left - rest.left) * 10) / 10 }));
      const eps = 0.6;
      const mono = fo.every((s, i) => i === 0 || (s.left <= fo[i - 1].left + eps && s.cy >= fo[i - 1].cy - eps && s.po <= fo[i - 1].po + 0.01 && s.mo <= fo[i - 1].mo + 0.01));
      check(`${tag}: die Bewegung geht gleichmaessig in eine Richtung (Logo nach links und unten, Poster und Texte nur ausblendend, nie zurueck)`, mono);
      const travel = Math.hypot(rest.left - end.left, end.cy - rest.cy);
      let maxStep = 0;
      for (let i = 1; i < fo.length; i++) if (fo[i].t - fo[i - 1].t < 90) maxStep = Math.max(maxStep, Math.hypot(fo[i].left - fo[i - 1].left, fo[i].cy - fo[i - 1].cy));
      check(`${tag}: kein Sprung (groesster Schritt zwischen zwei Bildern ${Math.round(maxStep)} px bei ${Math.round(travel)} px Gesamtweg, hoechstens 12 %)`, maxStep <= travel * 0.12, `${Math.round(maxStep)} / ${Math.round(travel)}`);
      const speeds = [];
      for (let i = 1; i < fo.length; i++) {
        const dt = fo[i].t - fo[i - 1].t;
        if (dt > 0 && dt < 90) speeds.push(Math.hypot(fo[i].left - fo[i - 1].left, fo[i].cy - fo[i - 1].cy) / dt);
      }
      const vmax = Math.max(...speeds);
      const tail = speeds.slice(-Math.max(3, Math.floor(speeds.length * 0.06)));
      const head = speeds.slice(0, Math.max(3, Math.floor(speeds.length * 0.1)));
      check(`${tag}: weicher Anlauf und abgebremstes Ende (Anfang und Ende hoechstens 35 % der Hoechstgeschwindigkeit)`, Math.max(...tail) <= vmax * 0.35 && Math.max(...head) <= vmax * 0.35, `v max ${vmax.toFixed(2)} px/ms, Anfang ${Math.max(...head).toFixed(2)}, Ende ${Math.max(...tail).toFixed(2)}`);
      const overlapBad = fo.filter((s) => Math.min(s.right, s.pr) - Math.max(s.left, s.pl) > 4 && Math.min(s.bottom, s.pb) - Math.max(s.top, s.pt) > 4 && s.po > 0.2);
      check(`${tag}: das Logo faehrt erst ueber das Poster, wenn es fast weg ist (ueberlappen sie sich, ist das Poster unter 20 % sichtbar)`, overlapBad.length === 0, overlapBad.length ? `t=${overlapBad[0].t} Poster ${overlapBad[0].po}` : '');
      const textBad = fo.filter((s) => s.cy - rest.cy > 6 && s.mo > 0.15);
      check(`${tag}: das Logo faehrt nicht durch sichtbaren Text (sobald es sich bewegt, sind die Angaben unter 15 %)`, textBad.length === 0, textBad.length ? `t=${textBad[0].t} Angaben ${textBad[0].mo}` : '');
      const e2 = back.at(-1);
      check(`${tag}: zurueck ist alles wieder da und am Platz (Logo auf der Ruheposition +-1 px, Groesse 100 %, Poster, Angaben und Unteres voll sichtbar)`, Math.abs(e2.left - rest.left) <= 1 && Math.abs(e2.cy - rest.cy) <= 1 && Math.abs(e2.scale - 1) < 0.005 && e2.po === 1 && e2.mo === 1 && e2.bo === 1, JSON.stringify({ dx: Math.round(e2.left - rest.left), dy: Math.round(e2.cy - rest.cy), scale: +e2.scale.toFixed(3), poster: e2.po, meta: e2.mo }));
      const backMono = back.every((s, i) => i === 0 || (s.left >= back[i - 1].left - eps && s.cy <= back[i - 1].cy + eps));
      check(`${tag}: auch zurueck gleichmaessig (Logo nach rechts und oben, kein Zucken)`, backMono);
      const backOverlap = back.filter((s) => Math.min(s.right, s.pr) - Math.max(s.left, s.pl) > 4 && Math.min(s.bottom, s.pb) - Math.max(s.top, s.pt) > 4 && s.po > 0.45);
      check(`${tag}: zurueck erscheint das Poster erst, wenn das Logo zur Seite gerutscht ist (bei Ueberlappung hoechstens 45 % sichtbar)`, backOverlap.length === 0, backOverlap.length ? `t=${backOverlap[0].t} Poster ${backOverlap[0].po}` : '');
      const backMs = (back.find((s) => Math.abs(s.left - rest.left) <= 1 && Math.abs(s.cy - rest.cy) <= 1 && s.po > 0.99)?.t ?? Infinity) - back[0].t;
      check(`${tag}: das Zurueckkommen dauert unter 1 s (schneller als das Absinken)`, backMs < 1000, `${backMs} ms`);
      console.log(`${tag}: Absinken ${Math.round(fo.at(-1).t - fo[0].t)} ms, ${fo.length} Bilder, Weg ${Math.round(travel)} px, v max ${vmax.toFixed(2)} px/ms; zurueck ${backMs} ms`);

      // ---------- Weiter unten gescrollt: nichts verschwindet (Besetzung, aehnliche Titel, Folgen ansehen), die Animation startet nicht ----------
      if (w === 1280) {
        await ctx.run(`document.querySelector('#view').scrollTop = 520`);
        await ctx.wait(500);
        check(`${tag}: gescrollt (Seite steht nicht mehr oben)`, await ctx.run(`document.querySelector('#view').scrollTop > 300`));
        await ctx.wait(5500); // laenger als 3 s Ruhe: oben waere der freie Blick jetzt gestartet
        const stayed = await ctx.run(`({ focus: !!document.querySelector('.detail-bd.tr-focus'), below: +getComputedStyle(document.querySelector('.detail-body > :not(.detail-stage)')).opacity, cast: [...document.querySelectorAll('.detail-body > :not(.detail-stage)')].map((e) => +getComputedStyle(e).opacity) })`);
        check(`${tag}: weiter unten gescrollt startet die Animation nicht, nichts darunter wird ausgeblendet (Besetzung, aehnliche Titel, Folgen bleiben voll sichtbar)`, !stayed.focus && stayed.cast.every((o) => o === 1), JSON.stringify(stayed));
        await ctx.capture(path.join(out, `C-${w}x${h}-${kind}-7-gescrollt.png`));
        await ctx.run(`document.querySelector('#view').scrollTop = 0`);
        check(`${tag}: zurueck nach oben gescrollt: nach der Ruhezeit beginnt der freie Blick wieder`, await waitFor(`!!document.querySelector('.detail-bd.tr-focus')`, 9000));
      }
      await ctx.run(`location.hash = '#/home'`);
      await ctx.wait(600);
    }
  }
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
