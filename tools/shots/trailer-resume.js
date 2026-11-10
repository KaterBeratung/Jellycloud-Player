// Trailer bei verdecktem Fenster und aus dem Blick gescrollt: Das Video wird angehalten (pauseVideo) und beim Zurueckkommen fortgesetzt (playVideo), derselbe Player, die Ebene bleibt sichtbar. Das Symbol,
// das YouTube dabei einblendet, unterdrueckt der Hauptprozess im Rahmen (main.js: quietEmbedFrame, Szenario trailer-symbol.js misst es genauer). Dazu: Der Rahmen ist auf ein Raster skaliert (halbe
// Rahmenmasse auf ganzen Bildpunkten) und auf einem ganzen Bildpunkt zentriert, damit keine dunkle Naht in der Bildmitte bleibt (auch nicht beim Fortsetzen).
// Umgebung: SEAM_ZOOM (Zoomfaktor wie Windows-Skalierung, Standard 1.25), SEAM_W/SEAM_H (Fenstergroesse in Bildschirmpixeln).
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..', '..');
const { server, items } = require(path.join(root, 'tools', 'mock-server'));

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR;
  const zoom = Number(process.env.SEAM_ZOOM || 1.25);
  const W = Number(process.env.SEAM_W || 1280), H = Number(process.env.SEAM_H || 720);
  let pass = 0, fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  };
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(50);
    }
    return false;
  };
  const YT = [{ Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  series.RemoteTrailers = YT;
  ctx.config.updateSettings({ trailer: { autoplay: true, muted: true, delaySec: 0, quality: process.env.SEAM_Q || '2160', focusSec: 0 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  ctx.win.setContentSize(W, H);
  ctx.win.webContents.setZoomFactor(zoom);
  await ctx.wait(600);
  await ctx.run(`location.hash = '#/item/${series.Id}'`);
  check('Trailer laeuft und blendet sich ein', await waitFor(`!!document.querySelector('.trailer.on')`, 60000));
  await waitFor(`getComputedStyle(document.querySelector('.trailer')).opacity === '1'`, 5000);
  await ctx.wait(1000);

  const geo = await ctx.run(`(() => { const l = document.querySelector('.trailer'); const f = l.querySelector('iframe'); const dpr = devicePixelRatio; const s = parseFloat(l.style.getPropertyValue('--tr-scale')); const fr = f.getBoundingClientRect(); const r = l.getBoundingClientRect(); return { dpr, s, fw: f.offsetWidth * s * dpr, fh: f.offsetHeight * s * dpr, halfW: f.offsetWidth / 2 * s * dpr, halfH: f.offsetHeight / 2 * s * dpr, cy: (fr.top + fr.height / 2) * dpr, cx: (fr.left + fr.width / 2) * dpr, layerH: r.height * dpr, layerW: r.width * dpr, frameDevH: fr.height * dpr, frameDevW: fr.width * dpr }; })()`);
  console.log('GEO ' + JSON.stringify(geo));
  const near = (v) => Math.abs(v - Math.round(v)) < 0.01;
  check('Halbe Rahmenhoehe und -breite liegen auf ganzen Bildpunkten (Raster)', near(geo.halfH) && near(geo.halfW), `halbe Hoehe ${geo.halfH.toFixed(3)}, halbe Breite ${geo.halfW.toFixed(3)}`);
  check('Die Rahmenmitte liegt auf einem ganzen Bildpunkt', near(geo.cy) && near(geo.cx), `Mitte ${geo.cx.toFixed(3)} / ${geo.cy.toFixed(3)}`);
  check('Der Rahmen deckt die Ebene (kein Rand)', geo.frameDevW >= geo.layerW - 0.5 && geo.frameDevH >= geo.layerH - 0.5, `${geo.frameDevW.toFixed(1)}x${geo.frameDevH.toFixed(1)} gegen ${geo.layerW.toFixed(1)}x${geo.layerH.toFixed(1)}`);

  const read = () => ctx.run(`(() => { const l = document.querySelector('.trailer'); const r = l.getBoundingClientRect(); return { op: +getComputedStyle(l).opacity, iw: innerWidth, lx: r.left, ly: r.top, lw: r.width, lh: r.height }; })()`);
  const scanFrame = async (info) => {
    const img = await ctx.win.webContents.capturePage();
    const { width, height } = img.getSize();
    const buf = img.toBitmap();
    const lum = (x, y) => { const o = (y * width + x) * 4; return 0.114 * buf[o] + 0.587 * buf[o + 1] + 0.299 * buf[o + 2]; };
    const k = width / info.iw;
    const y0 = Math.round(info.ly * k), y1 = Math.min(height - 2, Math.round((info.ly + info.lh) * k));
    const x0 = Math.round(info.lx * k), x1 = Math.min(width, Math.round((info.lx + info.lw) * k));
    const mid = Math.round((y0 + y1) / 2);
    let worst = 9, wy = -1;
    for (let y = mid - 5; y <= mid + 5; y++) {
      const rs = [];
      for (let x = x0; x < x1; x += 3) {
        const a = (lum(x, y - 1) + lum(x, y + 1)) / 2;
        if (a > 30) rs.push(lum(x, y) / a);
      }
      if (rs.length < 40) continue;
      rs.sort((a, b) => a - b);
      const med = rs[rs.length >> 1];
      if (med < worst) { worst = med; wy = y; }
    }
    return { worst, wy, mid, img };
  };
  const setHidden = (on) => ctx.run(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${on} }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  const scrollTo = (y) => ctx.run(`(() => { let e = document.querySelector('.detail'); while (e && !(e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; (e ?? document.scrollingElement).scrollTop = ${y}; return (e ?? document.scrollingElement).scrollTop; })()`);
  const probe = () => ctx.run(`(() => { const l = document.querySelector('.trailer'); const f = l.querySelector('iframe'); return { frames: l.querySelectorAll('iframe').length, mark: f?.dataset.mark ?? null, src: f?.src ?? '', on: l.classList.contains('on'), op: +getComputedStyle(l).opacity, has: !!document.querySelector('.has-trailer') }; })()`);
  // Zustand des Videos im Rahmen selbst (WebFrameMain: der Hauptprozess darf in den fremden Rahmen sehen) und Sichtbarkeit der Steuerflaechen der Einbettung
  const ytFrame = () => ctx.win.webContents.mainFrame.framesInSubtree.find((f) => /youtube-nocookie/.test(f.url));
  const vid = async () => JSON.parse(await ytFrame().executeJavaScript(`(() => { const v = document.querySelector('video'); const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= parseFloat(cs.opacity); } return o; }; let ui = 0; for (const e of document.querySelectorAll('player-middle-controls, .player-controls-middle-core-buttons, .player-controls-spinner, .ytp-bezel, .ytp-large-play-button, .ytp-spinner')) { const b = e.getBoundingClientRect(); if (b.width >= 8 && b.height >= 8) ui = Math.max(ui, eff(e)); } return JSON.stringify({ paused: v ? v.paused : null, t: v ? +v.currentTime.toFixed(2) : -1, ui }); })()`));
  await ctx.run(`document.querySelector('.trailer iframe').dataset.mark = 'erster'`);
  const t00 = (await vid()).t;
  check('Das Video laeuft vor dem Test', (await vid()).paused === false && t00 > 0, `${t00} s`);

  // 1) Nur kurz verdeckt: derselbe Player, die Ebene bleibt sichtbar
  await setHidden(true);
  await ctx.wait(700);
  await setHidden(false);
  await ctx.wait(1400);
  const brief = await probe();
  check('Nur kurz verdeckt: derselbe Player, die Ebene bleibt sichtbar', brief.frames === 1 && brief.mark === 'erster' && brief.on && brief.op > 0.99, JSON.stringify({ frames: brief.frames, mark: brief.mark, op: brief.op }));
  check('Danach laeuft das Video', (await vid()).paused === false);

  // 2) Laenger verdeckt: das Video steht (im Rahmen angehalten), Player und Ebene bleiben
  await setHidden(true);
  await ctx.wait(1500);
  const held = await vid();
  const heldProbe = await probe();
  check('Verdeckt: das Video im Rahmen ist angehalten', held.paused === true, JSON.stringify(held));
  check('Verdeckt: derselbe Player bleibt, die Seite behaelt den Trailer-Zustand', heldProbe.frames === 1 && heldProbe.mark === 'erster' && heldProbe.has && heldProbe.on, JSON.stringify({ frames: heldProbe.frames, mark: heldProbe.mark, has: heldProbe.has, on: heldProbe.on }));
  await ctx.wait(1500);
  const held2 = await vid();
  check('Verdeckt: die Position bleibt stehen', Math.abs(held2.t - held.t) < 0.3, `${held.t} s -> ${held2.t} s`);

  // 3) Wieder sichtbar: schnell fortgesetzt, derselbe Player, die Ebene blieb die ganze Zeit sichtbar
  await setHidden(false);
  const tBack = Date.now();
  let resumed = null;
  const uiSeen = [];
  while (Date.now() - tBack < 6000) {
    const v = await vid();
    uiSeen.push(v.ui);
    if (!v.paused && v.t > held2.t + 0.3) { resumed = Date.now() - tBack; break; }
    await ctx.wait(60);
  }
  check('Wieder sichtbar: das Video laeuft rasch weiter (kein Neustart, keine Wartezeit auf die Qualitaet)', resumed !== null && resumed < 3000, resumed !== null ? `nach ${resumed} ms` : 'nie');
  const after = await probe();
  check('Wieder sichtbar: derselbe Player (kein neuer Rahmen), die Ebene ist voll sichtbar', after.frames === 1 && after.mark === 'erster' && after.on && after.op > 0.99, JSON.stringify({ frames: after.frames, mark: after.mark, op: after.op }));
  check('Beim Fortsetzen steht kein Parameter "start" in der Adresse (der Player wurde nicht neu angelegt)', !/[?&]start=/.test(after.src), after.src.replace(/^.*\?/, '?'));
  // Naht und Steuerflaeche waehrend der ersten Sekunden nach dem Fortsetzen
  const frames = [];
  let uiMax = Math.max(0, ...uiSeen);
  const tWait = Date.now();
  while (Date.now() - tWait < 6000) {
    const info = await read();
    const f = await scanFrame(info);
    frames.push({ op: info.op, worst: f.worst, mid: f.mid, wy: f.wy });
    if (frames.length === 6) fs.writeFileSync(path.join(out, 'resume-6.png'), f.img.toPNG());
    uiMax = Math.max(uiMax, (await vid()).ui);
    await ctx.wait(80);
  }
  check('Nach dem Fortsetzen war keine Steuerflaeche der Einbettung sichtbar (kein Symbol)', uiMax === 0, `groesste Sichtbarkeit ${uiMax}`);
  const visible = frames.filter((f) => f.op > 0.3);
  const lines = visible.filter((f) => f.worst < 0.95);
  check('Keine dunkle Naht in der Bildmitte, solange der Trailer zu sehen ist', visible.length > 5 && lines.length === 0, `${visible.length} Bilder, ${lines.length} mit Linie, kleinstes Verhaeltnis ${visible.length ? Math.min(...visible.map((f) => f.worst)).toFixed(3) : '-'}`);

  // 4) Weitere Sichtbarkeitsmeldungen legen keinen weiteren Player an
  for (let i = 0; i < 4; i++) {
    await setHidden(false);
    await ctx.wait(80);
  }
  const again = await probe();
  check('Wiederholte Meldungen "sichtbar": kein weiterer Player', again.frames === 1 && again.mark === 'erster', JSON.stringify({ frames: again.frames, mark: again.mark }));

  // 5) Aus dem Blick gescrollt und zurueck: gleiche Behandlung
  const sc = await scrollTo(4000);
  if (sc > 300) {
    await ctx.wait(1500);
    const away = await vid();
    const awayProbe = await probe();
    check('Aus dem Blick gescrollt: das Video im Rahmen ist angehalten, derselbe Player bleibt', away.paused === true && awayProbe.frames === 1 && awayProbe.mark === 'erster', JSON.stringify({ paused: away.paused, frames: awayProbe.frames, mark: awayProbe.mark }));
    await scrollTo(0);
    const tScroll = Date.now();
    let back = null;
    while (Date.now() - tScroll < 5000) {
      const v = await vid();
      if (!v.paused && v.t > away.t + 0.3) { back = Date.now() - tScroll; break; }
      await ctx.wait(60);
    }
    const backProbe = await probe();
    check('Zurueckgescrollt: das Video laeuft weiter, derselbe Player, Ebene sichtbar', back !== null && backProbe.frames === 1 && backProbe.mark === 'erster' && backProbe.op > 0.99, back !== null ? `nach ${back} ms` : 'nie');
  } else {
    console.log('INFO Seite lies sich nicht scrollen, Pruefung 5 uebersprungen');
  }

  // 6) Quelltext: Abbau und Neustart sind weg, Anhalten bei Sichtbarkeit und bei der Uebergabe, Fortsetzen nur bei Sichtbarkeit
  const code = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'trailer.js'), 'utf8');
  check('Quelltext: kein sofortiger Abbau des Players (suspend, quiet, Parameter start); der Abbau nach langer Ruhe steht in trailer-release.js',!/suspend|\bquiet\b|params\.start|lastTime/.test(code));
  check('Quelltext: "playVideo" nur einmal (bei Sichtbarkeit), "pauseVideo" zweimal (Sichtbarkeit und Uebergabe)', (code.match(/post\(\s*'playVideo'/g) || []).length === 1 && (code.match(/post\(\s*'pauseVideo'/g) || []).length === 2);

  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  server.close();
};
