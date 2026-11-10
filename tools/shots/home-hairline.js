// Haarlinie am unteren Rand des Banners (JC_DEV=1, JC_FAKE_MPV=1; mit Trailer braucht es Internet): Beim Zurueckwechseln auf die Startseite (die Seite blendet 0,4 s lang ein und bewegt sich dabei)
// kann eine 1 bis 2 Pixel dicke Linie in den Farben des Bildes oder Trailers ueber der Ueberschrift der ersten Reihe stehen, weil die Ebenen (Bild, Trailer, Abdunklung) unterschiedlich auf ganze
// Pixel gerundet werden. Gemessen wird in den aufgenommenen Bildern: die Zeilen um die Unterkante des Banners gegen die Seitenfarbe darunter.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-hairline.js
const path = require('node:path');
const { nativeImage } = require('electron');
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
  const movies = [...items.values()].filter((i) => i.Type === 'Movie').sort((a, b) => (a.DateCreated < b.DateCreated ? 1 : -1));
  const other = movies[3];
  const YT = [{ Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let edgeSel = '.hero';
  const measure = async (file) => {
    const img = nativeImage.createFromPath(file);
    const { width, height } = img.getSize();
    const k = width / (await ctx.run(`innerWidth`)); // Aufnahmen sind in Bildpunkten (bei 125 % Skalierung 1,25 je CSS-Pixel)
    const hb = Math.round((await ctx.run(`document.querySelector('${edgeSel}').getBoundingClientRect().bottom`)) * k);
    const bm = img.toBitmap();
    const x0 = Math.round(width * 0.5); const x1 = width - 24;
    const row = (y) => { let r = 0; let g = 0; let b = 0; let n = 0; for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; b += bm[i]; g += bm[i + 1]; r += bm[i + 2]; n++; } return [r / n, g / n, b / n]; };
    if (hb + 14 * k >= height || hb < 20) return { hb, worst: 0, y: 0 };
    const ref = row(hb + Math.round(12 * k));
    let worst = 0; let wy = 0;
    for (let y = hb; y <= hb + Math.round(4 * k); y++) { const d = dist(row(y), ref); if (d > worst) { worst = d; wy = y - hb; } } // nur ab der Unterkante nach unten: darueber liegt der gewollte Verlauf
    if (worst > 10) { try { require('node:fs').writeFileSync(file.replace('.png', '-ausschnitt.png'), img.crop({ x: 0, y: Math.max(0, hb - 14), width, height: 40 }).toPNG()); } catch { /* Ausschnitt ist nur eine Hilfe */ } }
    return { hb, worst: Math.round(worst * 10) / 10, y: wy };
  };
  const trace = async (label, marks) => {
    const t0 = Date.now();
    const rows = [];
    for (const ms of marks) {
      await ctx.wait(Math.max(0, ms - (Date.now() - t0)));
      const f = path.join(out, `H-${label.replace(/[^a-z0-9]+/gi, '-')}-${ms}.png`);
      await ctx.capture(f);
      rows.push({ ms, ...(await measure(f)) });
    }
    const bad = rows.filter((r) => r.worst > 10);
    console.log(`   ${label}: ${rows.map((r) => `${r.ms}ms=${r.worst}`).join(' ')}`);
    check(`${label}: am unteren Rand des Banners steht keine Linie in Bildfarben (hoechstens 10 Farbstufen Abweichung von der Seitenfarbe darunter)`, bad.length === 0, bad.length ? `${bad[0].ms} ms: ${bad[0].worst} bei Zeile ${bad[0].y} zur Unterkante` : '');
  };

  const only = process.env.HAIR_ONLY || ''; // 'home' oder 'detail': nur diesen Teil pruefen
  // Gegenprobe: HAIR_NOBAND=1 schaltet die Deckbaender ab, dann muessen die Pruefungen anschlagen
  if (process.env.HAIR_NOBAND) await ctx.run(`document.head.append(Object.assign(document.createElement('style'), { textContent: '.detail-body::before, .hero-host::after { display: none !important; }' }))`);
  ctx.win.setContentSize(1760, 990);
  await ctx.wait(500);
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  await ctx.wait(2000);
  const skipHome = only === 'detail' || only === 'scan';
  for (let i = 0; i < (skipHome ? 0 : 3); i++) {
    await ctx.run(`location.hash = '#/item/${other.Id}'`);
    await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 8000);
    await ctx.wait(800);
    await ctx.run(`history.back()`);
    await trace(`Ohne Trailer, zurueck (${i + 1}. Mal)`, [30, 70, 110, 150, 200, 260, 330, 420, 600, 1200]);
  }
  // Mit Trailer
  movies[0].RemoteTrailers = YT;
  ctx.config.updateSettings({ trailer: { autoplay: true, home: true, muted: true, delaySec: 0, quality: '720', focusSec: 0 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2300);
  await ctx.run(`location.hash = '#/home'`);
  await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  if (only !== 'detail') check('Mit Trailer: der Trailer laeuft im Banner', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 45000));
  await ctx.wait(1500);
  if (!skipHome) await trace('Mit Trailer, Ruhe', [100, 400]);
  for (let i = 0; i < (skipHome ? 0 : 2); i++) {
    await ctx.run(`location.hash = '#/item/${other.Id}'`);
    await waitFor(`!!document.querySelector('.detail-title, .detail-logo')`, 8000);
    await ctx.wait(1000);
    await ctx.run(`history.back()`);
    await trace(`Mit Trailer, zurueck (${i + 1}. Mal)`, [30, 70, 110, 150, 200, 260, 330, 420, 600, 900, 1300, 2000, 3500, 6000, 9000]);
  }

  // ---------- Suche ueber das ganze Bild: eine Zeile, die durch (fast) die ganze Breite anders aussieht als die Zeilen 3 Bildpunkte darueber und darunter ----------
  // Die Stelle der Linie ist nicht festgelegt (Unterkante des Banners, Hintergrund der Detailseite, Trailer-Ebene), deshalb wird jedes Bild abgesucht.
  const scanFrame = (file) => {
    const img = nativeImage.createFromPath(file);
    const { width, height } = img.getSize();
    const bm = img.toBitmap();
    const px = (x, y, c) => bm[(y * width + x) * 4 + c];
    const found = [];
    for (let y = 40; y < height - 4; y++) {
      let hit = 0; let n = 0;
      for (let x = 40; x < width - 40; x += 3) {
        n++;
        let dev = 0; let nb = 0;
        for (let c = 0; c < 3; c++) {
          const up = px(x, y - 3, c); const dn = px(x, y + 3, c);
          dev = Math.max(dev, Math.abs(px(x, y, c) - (up + dn) / 2));
          nb = Math.max(nb, Math.abs(up - dn));
        }
        if (dev > 12 && nb < 12) hit++;
      }
      if (hit / n > 0.5) found.push({ y, share: Math.round((hit / n) * 100) });
    }
    return found;
  };
  const scanTrace = async (label, marks) => {
    const t0 = Date.now();
    const bad = [];
    for (const ms of marks) {
      await ctx.wait(Math.max(0, ms - (Date.now() - t0)));
      const f = path.join(out, `S-${label.replace(/[^a-z0-9]+/gi, '-')}-${ms}.png`);
      await ctx.capture(f);
      const found = scanFrame(f);
      if (found.length) {
        bad.push(`${ms} ms: Zeile ${found.map((r) => `${r.y} (${r.share} %)`).join(', ')}`);
        try { const img = nativeImage.createFromPath(f); require('node:fs').writeFileSync(f.replace('.png', '-ausschnitt.png'), img.crop({ x: 0, y: Math.max(0, found[0].y - 20), width: img.getSize().width, height: 40 }).toPNG()); } catch { /* Hilfe */ }
      }
    }
    console.log(`   ${label}: ${bad.length ? bad.join(' | ') : 'keine Linie gefunden'}`);
    check(`${label}: keine durchgehende, einzeilige Linie im Bild`, bad.length === 0, bad[0] || '');
  };
  if (only === 'scan') {
    const MARKS = [30, 70, 110, 150, 200, 260, 330, 420, 600, 900, 1500, 3000, 6000];
    const series2 = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
    series2.RemoteTrailers = YT;
    await scanTrace('Startseite mit Trailer, Ruhe', [100, 400, 800]);
    for (const [kind, it] of [['Film ohne Trailer', other], ['Film mit Trailer', movies[0]], ['Serie mit Trailer', series2]]) {
      for (let i = 0; i < 2; i++) {
        await ctx.run(`location.hash = '#/home'`);
        await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 20000);
        await ctx.wait(800);
        await ctx.run(`location.hash = '#/item/${it.Id}'`);
        await scanTrace(`${kind}, von der Startseite (${i + 1}. Mal)`, MARKS);
        await ctx.run(`history.back()`);
        await scanTrace(`${kind}, zurueck zur Startseite (${i + 1}. Mal)`, [30, 70, 110, 150, 200, 260, 330, 420, 600, 900, 1500]);
      }
    }
    const passed = results.filter(Boolean).length;
    console.log(`\nErgebnis: ${passed}/${results.length} Pruefungen bestanden`);
    server.close();
    if (passed !== results.length) process.exitCode = 1;
    return;
  }

  // ---------- Detailseite (Film und Serie): Unterkante des Hintergrunds ----------
  // Hier steht unter dem Hintergrund echter Inhalt (Knoepfe, Besetzung), deshalb wird verglichen: Aufnahme mit Hintergrund gegen Aufnahme ohne Hintergrund (visibility:hidden, gleicher Aufbau).
  // Ab der Unterkante des Hintergrunds darf sich nichts unterscheiden, jede Abweichung dort ist Hintergrund, der ueber seinen Rand hinausschaut (die Haarlinie).
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  series.RemoteTrailers = YT;
  const movie = movies[0];
  const diffMeasure = async (label, tag) => {
    const hb = await ctx.run(`document.querySelector('.detail-bd').getBoundingClientRect().bottom`);
    const fa = path.join(out, `D-${tag}-a.png`); const fb = path.join(out, `D-${tag}-b.png`);
    await ctx.capture(fa);
    await ctx.run(`document.querySelector('.detail-bd').style.visibility = 'hidden'`);
    await ctx.wait(80);
    await ctx.capture(fb);
    await ctx.run(`document.querySelector('.detail-bd').style.visibility = ''`);
    const A = nativeImage.createFromPath(fa); const B = nativeImage.createFromPath(fb);
    const { width, height } = A.getSize();
    const k = width / (await ctx.run(`innerWidth`));
    const ba = A.toBitmap(); const bb = B.toBitmap();
    const y0 = Math.round(hb * k);
    if (y0 + 8 >= height) return null;
    const x0 = Math.round(width * 0.3); const x1 = width - 24;
    let worst = 0; let wy = 0;
    for (let y = y0; y <= y0 + 5; y++) {
      // Median ueber die Breite: eine Haarlinie geht durch die ganze Zeile, ein einzelner Knopf mit Glas-Effekt (zeichnet den Hintergrund dahinter weich) nur durch einen Teil
      const ds = [];
      for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; ds.push(Math.max(Math.abs(ba[i] - bb[i]), Math.abs(ba[i + 1] - bb[i + 1]), Math.abs(ba[i + 2] - bb[i + 2]))); }
      ds.sort((p, q) => p - q);
      const d = ds[Math.floor(ds.length * 0.5)];
      if (d > worst) { worst = d; wy = y - y0; }
    }
    if (worst > 3) { try { require('node:fs').writeFileSync(fa.replace('-a.png', '-ausschnitt.png'), A.crop({ x: 0, y: Math.max(0, y0 - 14), width, height: 40 }).toPNG()); } catch { /* Hilfe */ } }
    console.log(`   ${label}: Unterkante bei ${Math.round(hb * 100) / 100} px (${Math.round(hb * k * 100) / 100} Bildpunkte), groesste Abweichung ${worst} (Zeile ${wy} ab Unterkante)`);
    check(`${label}: unter dem Hintergrund (ab seiner Unterkante) stimmen die Bilder mit und ohne Hintergrund ueberein (hoechstens 3 Farbstufen)`, worst <= 3, `${worst} bei Zeile ${wy}`);
    return worst;
  };
  const SIZES = [[1760, 990], [1280, 720], [1366, 768], [1920, 1080], [1500, 900]];
  // Beim Einblenden der Seite (Animation angehalten bei t)
  for (const [w, hgt] of [[1760, 990], [1280, 720]]) {
    ctx.win.setContentSize(w, hgt);
    await ctx.wait(500);
    for (let i = 0; i < 2; i++) {
      await ctx.run(`location.hash = '#/home'`);
      await ctx.wait(900);
      await ctx.run(`location.hash = '#/item/${movie.Id}'`);
      await waitFor(`!!document.querySelector('.detail-bd')`, 8000);
      await ctx.wait(300);
      for (const t of [0, 60, 120, 180, 240, 300, 380]) {
        await ctx.run(`document.getAnimations().forEach((a) => { if (['page-in', 'bd-in'].includes(a.animationName)) { a.pause(); a.currentTime = ${t}; } })`);
        await ctx.wait(120);
        await diffMeasure(`Detailseite Film ${w}x${hgt}, Einblenden bei ${t} ms (${i + 1}. Mal)`, `ein-${w}-${t}-${i}`);
      }
    }
  }
  // Im Ruhezustand, mit laufendem Trailer, in verschiedenen Fenstergroessen (bei den meisten ist 86vh keine ganze Zahl)
  for (const [kind, it] of [['Film', movie], ['Serie', series]]) {
    ctx.win.setContentSize(1760, 990);
    await ctx.wait(500);
    await ctx.run(`location.hash = '#/home'`);
    await ctx.wait(900);
    await ctx.run(`location.hash = '#/item/${it.Id}'`);
    check(`${kind}: der Trailer laeuft im Hintergrund`, await waitFor(`!!document.querySelector('.detail-bd .trailer.on')`, 45000));
    await ctx.wait(1500);
    for (const [w, hgt] of SIZES) {
      ctx.win.setContentSize(w, hgt);
      await ctx.wait(900);
      await diffMeasure(`Detailseite ${kind} mit Trailer ${w}x${hgt}`, `ruhe-${kind}-${w}`);
    }
  }
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
