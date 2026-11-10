// Startanimation (JC_DEV=1): Ablauf, Ueberspringen, Stufen "aus" und "reduziert", Schalter, Vorschau, kein zweites Mal, Warten bis das Fenster sichtbar ist.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/startup-anim.js
// Die anderen Szenarien laufen ohne Startanimation (main.js schaltet sie in --shots aus); hier wird sie gezielt eingeschaltet und die Seite neu geladen.
const path = require('node:path');
const { server } = require('../mock-server');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) consoleErrors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const PORT = 8497; // eigener Port: stoert sich nicht mit gleichzeitig laufenden Szenarien auf 8097
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  ctx.win.setContentSize(1280, 720);
  await ctx.wait(500);

  const waitFor = async (js, ms = 6000, step = 40) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(step);
    }
    return false;
  };
  const setAppearance = (patch) => ctx.config.updateSettings({ appearance: patch });
  /** Seite neu laden (wie ein App-Start) und zurueckgeben, wann (ms nach dem Laden) die Animation zum ersten Mal zu sehen ist (null: nie innerhalb von 1,5 s). */
  const restart = async () => {
    const loaded = new Promise((r) => ctx.win.webContents.once('did-finish-load', r));
    ctx.win.webContents.reload();
    await loaded;
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      try {
        if (await ctx.run(`!!document.querySelector('#splash')`)) return { t0, seen: Date.now() - t0, at: Date.now() };
      } catch {
        /* Seite noch im Aufbau */
      }
      await ctx.wait(25);
    }
    return { t0, seen: null, at: Date.now() };
  };
  const goneAfter = async (since, ms = 6000) => {
    const ok = await waitFor(`!document.querySelector('#splash') && !document.documentElement.classList.contains('is-splash')`, ms, 30);
    return ok ? Date.now() - since : null;
  };
  const appState = () => ctx.run(`(() => { const a = document.getElementById('app'); const s = getComputedStyle(a); return { opacity: s.opacity, transform: s.transform, cls: document.documentElement.className, splash: !!document.getElementById('splash') }; })()`);
  const frames = [];
  const grab = async (label) => {
    await ctx.capture(path.join(out, `A-${String(frames.length + 1).padStart(2, '0')}-${label}.png`));
    frames.push(label);
  };

  // ---------- Standard ----------
  check('Szenarien starten ohne Startanimation (main.js schaltet sie in --shots aus)', ctx.config.settings.appearance.startAnimation === false);
  check('Im Normalbetrieb ist die Startanimation eingeschaltet (Standardwert)', require('../../src/main/config').DEFAULT_SETTINGS.appearance.startAnimation === true);
  setAppearance({ startAnimation: true, animations: 'full' });

  // ---------- Voller Ablauf ----------
  const r1 = await restart();
  check('Nach dem Laden der Seite erscheint die Animation (innerhalb von 0,6 s, sobald die Einstellungen da sind)', r1.seen !== null && r1.seen < 600, String(r1.seen));
  const first = await appState();
  check('Waehrend sie laeuft, ist die Oberflaeche unsichtbar (is-splash, Deckkraft 0)', first.cls.includes('is-splash') && first.opacity === '0', JSON.stringify(first));
  check('Die Animation liegt ueber allem: ein Klick in die Mitte trifft den Vorspann, nicht die Seite', await ctx.run(`document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#splash') !== null`));
  check('Aufbau: Wolken-Umriss, Dreieck, Glanz, Lichtblitz, Ring, zehn Buchstaben', await ctx.run(`(() => { const s = document.getElementById('splash'); return !!s.querySelector('svg.sp-mark .sp-draw') && !!s.querySelector('svg.sp-mark .sp-play') && !!s.querySelector('svg.sp-glow') && !!s.querySelector('.sp-streak') && !!s.querySelector('.sp-ring') && s.querySelectorAll('.sp-word span').length === 10 && [...s.querySelectorAll('.sp-word span')].map((x) => x.textContent).join('') === 'Jellycloud'; })()`));
  const probe = `(() => { const s = document.getElementById('splash'); if (!s) return null; const q = (sel) => s.querySelector(sel); return { dash: parseFloat(getComputedStyle(q('.sp-draw')).strokeDashoffset), play: parseFloat(getComputedStyle(q('.sp-play')).opacity), letters: [...s.querySelectorAll('.sp-word span')].map((x) => parseFloat(getComputedStyle(x).opacity)), zoom: getComputedStyle(q('.sp-zoom')).transform, bg: parseFloat(getComputedStyle(s).opacity), app: parseFloat(getComputedStyle(document.getElementById('app')).opacity) }; })()`;
  // Bilder und Messwerte ueber den Ablauf (Zeit ab dem ersten Auftauchen)
  const samples = [];
  const base = r1.at;
  for (let i = 0; i < 24; i++) {
    const want = i * 140;
    const now = Date.now() - base;
    if (want > now) await ctx.wait(want - now);
    const t = Date.now() - base;
    const p = await ctx.run(probe).catch(() => null);
    samples.push({ t, p });
    if (i % 2 === 0 && p) await grab(`t${String(t).padStart(4, '0')}`);
    if (!p) break;
  }
  const near = (ms) => samples.reduce((a, b) => (Math.abs(b.t - ms) < Math.abs(a.t - ms) ? b : a)).p;
  const early = near(450);
  check('Zu Beginn zeichnet sich der Umriss (Strichversatz zwischen Anfang und Ende)', early && early.dash > 0.02 && early.dash < 1.02, JSON.stringify(early?.dash));
  const mid = near(1350);
  const full = near(2250);
  check('Das Dreieck ist nach rund einer Sekunde da', (near(1500)?.play ?? 0) > 0.95, JSON.stringify(near(1500)?.play));
  check('Der Umriss ist fertig gezeichnet (Versatz 0)', (near(1200)?.dash ?? 1) < 0.02, JSON.stringify(near(1200)?.dash));
  check('Der Schriftzug erscheint nach und nach: erst nur die ersten Buchstaben, spaeter alle zehn', mid && full && mid.letters[0] > 0.3 && mid.letters[9] < 0.3 && full.letters.every((o) => o > 0.95), JSON.stringify({ mid: mid?.letters.map((o) => +o.toFixed(1)), full: full?.letters.map((o) => +o.toFixed(1)) }));
  check('Bis zum Zoom bleibt die Oberflaeche unsichtbar (Deckkraft 0 bei 1,7 s)', near(1700)?.app === 0, JSON.stringify(near(1700)?.app));
  const scaleOf = (m) => Number(/matrix\(([-\d.e]+)/.exec(m)?.[1] ?? 1); // "matrix(a, b, c, d, e, f)": a ist der Zoom
  const zoomed = samples.filter((s) => s.p && s.t > 2100).map((s) => scaleOf(s.p.zoom));
  check('Danach faehrt es durch das Logo: der Zoom waechst stark (mehr als 3fach)', zoomed.length > 0 && Math.max(...zoomed) > 3, JSON.stringify(zoomed.map((z) => +z.toFixed(1))));
  const fadeApp = samples.filter((s) => s.p && s.t > 2100).map((s) => s.p.app);
  check('...und die Oberflaeche blendet dahinter ein (Deckkraft waechst)', fadeApp.length > 0 && Math.max(...fadeApp) > 0.3, JSON.stringify(fadeApp.map((z) => +z.toFixed(2))));
  const done1 = await goneAfter(base, 5000);
  check('Nach rund 2,7 s ist alles vorbei (Vorspann weg, Klassen weg)', done1 !== null && done1 > 2400 && done1 < 3600, String(done1));
  const after = await appState();
  check('Danach ist die Oberflaeche voll sichtbar und ohne Verschiebung (keine Reste von Deckkraft oder Zoom)', after.opacity === '1' && (after.transform === 'none' || after.transform === 'matrix(1, 0, 0, 1, 0, 0)') && !/splash/.test(after.cls), JSON.stringify(after));
  check('Die Seite reagiert wieder (Klick trifft die Oberflaeche)', await ctx.run(`document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#app') !== null`));
  await grab('danach');
  // nicht noch einmal bei einem Neuaufbau (erneute Anmeldung, Sprache, Neu laden)
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(900);
  check('Ein Neuaufbau der Oberflaeche (erneute Anmeldung) startet sie nicht noch einmal', await ctx.run(`!document.getElementById('splash') && !document.documentElement.classList.contains('is-splash')`));

  // ---------- Ueberspringen ----------
  const click = async (x, y) => {
    ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await ctx.wait(60);
    ctx.win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    ctx.win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  };
  const r2 = await restart();
  await ctx.wait(700);
  const tClick = Date.now();
  await click(640, 360);
  const skipGone = await goneAfter(tClick, 3000);
  check('Klick ueberspringt sie: nach 0,6 s weg und die Oberflaeche sichtbar', r2.seen !== null && skipGone !== null && skipGone < 800 && (await appState()).opacity === '1', String(skipGone));
  check('Der Klick fiel nicht auf die Seite durch (kein Seitenwechsel, kein Fenster)', await ctx.run(`!document.querySelector('.rq-scrim, .menu') && location.hash.startsWith('#/home')`));
  const r3 = await restart();
  await ctx.wait(500);
  const tKey = Date.now();
  ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  const keyGone = await goneAfter(tKey, 3000);
  check('Eine Taste ueberspringt sie ebenfalls', r3.seen !== null && keyGone !== null && keyGone < 800, String(keyGone));

  // ---------- Stufen ----------
  setAppearance({ animations: 'off' });
  const r4 = await restart();
  await ctx.wait(1200);
  const off = await appState();
  check('Animationen "aus": keine Startanimation, die Oberflaeche ist gleich da', r4.seen === null && !off.splash && off.opacity === '1' && !/splash/.test(off.cls), JSON.stringify(off));
  setAppearance({ animations: 'reduced' });
  const r5 = await restart();
  const calmInfo = await ctx.run(`(() => { const s = document.getElementById('splash'); return s ? { calm: s.classList.contains('calm'), ring: getComputedStyle(s.querySelector('.sp-ring')).display, streak: getComputedStyle(s.querySelector('.sp-streak')).display, zoom: getComputedStyle(s.querySelector('.sp-zoom')).animationName, html: document.documentElement.className } : null; })()`);
  const calmGone = await goneAfter(r5.at, 4000);
  check('Animationen "reduziert": ruhige Fassung ohne Ring, Blitz und Zoom', r5.seen !== null && calmInfo?.calm && calmInfo.ring === 'none' && calmInfo.streak === 'none' && calmInfo.zoom === 'sp-zoom-calm' && /splash-calm/.test(calmInfo.html), JSON.stringify(calmInfo));
  check('...und kuerzer: nach rund 1,2 s vorbei (45 % der vollen Zeit)', calmGone !== null && calmGone > 900 && calmGone < 1900, String(calmGone));
  setAppearance({ animations: 'full', startAnimation: false });
  const r6 = await restart();
  await ctx.wait(1000);
  check('Schalter "Startanimation" aus: keine Animation', r6.seen === null && !(await appState()).splash && (await appState()).opacity === '1');

  // ---------- Einstellungen: Schalter und Vorschau ----------
  await ctx.run(`location.hash = '#/settings/appearance'`);
  await ctx.wait(700);
  const sw = `[...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Startanimation')`;
  check('Einstellungen > Erscheinungsbild: "Startanimation" mit Erklaerung, Schalter (aus) und Vorschau-Knopf', await ctx.run(`(() => { const s = ${sw}; return !!s && s.querySelector('button.switch')?.getAttribute('aria-checked') === 'false' && /Netflix/.test(s.querySelector('.setting-desc')?.textContent ?? '') && /Vorschau/.test(s.querySelector('.ctl-pair .btn')?.textContent ?? ''); })()`));
  await ctx.run(`${sw}.querySelector('button.switch').click()`);
  const stored = async () => {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      if (ctx.config.settings.appearance.startAnimation === true) return true;
      await ctx.wait(60);
    }
    return false;
  };
  check('Einschalten wird gespeichert', await stored());
  await ctx.run(`${sw}.querySelector('.ctl-pair .btn').click()`);
  const tPrev = Date.now();
  check('Vorschau: der Vorspann erscheint ueber der Einstellungsseite (Klasse preview)', await waitFor(`document.getElementById('splash')?.classList.contains('preview')`, 1500, 25));
  await ctx.wait(700);
  const prevMid = await ctx.run(`(() => ({ app: getComputedStyle(document.getElementById('app')).opacity, panel: !!document.querySelector('.settings-panel'), hash: location.hash }))()`);
  check('...die Seite dahinter ist da, aber verdeckt', prevMid.app === '0' && prevMid.panel && prevMid.hash.startsWith('#/settings'), JSON.stringify(prevMid));
  await grab('vorschau');
  const prevGone = await goneAfter(tPrev, 6000);
  check('...und nach rund 3 s ist die Vorschau vorbei, die Einstellungsseite steht unveraendert da', prevGone !== null && prevGone > 2400 && prevGone < 4200 && (await ctx.run(`getComputedStyle(document.getElementById('app')).opacity === '1' && !!document.querySelector('.settings-panel') && location.hash.startsWith('#/settings')`)), String(prevGone));
  await ctx.run(`${sw}.querySelector('.ctl-pair .btn').click()`);
  await ctx.wait(400);
  await ctx.run(`${sw}.querySelector('.ctl-pair .btn').click()`);
  check('Zweiter Klick auf "Vorschau" mitten im Ablauf startet keine zweite Animation', await ctx.run(`document.querySelectorAll('#splash').length === 1`));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await goneAfter(Date.now(), 2000);
  setAppearance({ animations: 'off' });
  await ctx.run(`location.hash = '#/settings/behavior'; location.hash = '#/settings/appearance'`);
  await ctx.wait(500);
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(1500);
  await ctx.run(`location.hash = '#/settings/appearance'`);
  await ctx.wait(700);
  await ctx.run(`${sw}.querySelector('.ctl-pair .btn').click()`);
  await ctx.wait(300);
  check('Vorschau bei "Animationen: aus": kein Vorspann, dafuer ein Hinweis', (await ctx.run(`!document.getElementById('splash')`)) && /braucht Animationen/.test(await ctx.run(`[...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')`)));
  setAppearance({ animations: 'full' });

  // ---------- Fenster noch unsichtbar (minimierter Autostart) ----------
  await restart();
  await goneAfter(Date.now(), 6000);
  const hiddenRun = await ctx.run(`(async () => {
    const m = await import('./js/splash.js');
    const log = [];
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    m.playSplash({ animations: 'full' });
    log.push({ step: 'unsichtbar', splash: !!document.getElementById('splash'), app: getComputedStyle(document.getElementById('app')).opacity, waiting: m.splashActive() });
    await new Promise((r) => setTimeout(r, 400));
    log.push({ step: 'noch unsichtbar', splash: !!document.getElementById('splash') });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 200));
    log.push({ step: 'sichtbar', splash: !!document.getElementById('splash') });
    return log;
  })()`);
  check('Fenster unsichtbar: die Animation wartet (Oberflaeche verdeckt, noch kein Vorspann) und startet, sobald es sichtbar wird', hiddenRun[0].splash === false && hiddenRun[0].app === '0' && hiddenRun[0].waiting && hiddenRun[1].splash === false && hiddenRun[2].splash === true, JSON.stringify(hiddenRun));
  const orderRun = await ctx.run(`(async () => {
    const m = await import('./js/splash.js');
    const order = [];
    m.afterSplash(() => order.push('nach der Animation'));
    order.push('sofort danach');
    await new Promise((r) => setTimeout(r, 3500));
    return { order, active: m.splashActive(), classes: document.documentElement.className };
  })()`);
  check('Hinweise warten (afterSplash): erst nach dem Ende der Animation, danach laeuft alles sofort', JSON.stringify(orderRun.order) === JSON.stringify(['sofort danach', 'nach der Animation']) && !orderRun.active && !/splash/.test(orderRun.classes), JSON.stringify(orderRun));
  check('afterSplash ohne laufende Animation: sofort', await ctx.run(`(async () => { const m = await import('./js/splash.js'); let ran = false; m.afterSplash(() => { ran = true; }); return ran; })()`));

  // Ruckeln: Abstaende zwischen zwei Bildern waehrend der Animation (nur zur Information, die VM hat keine Grafikkarte)
  setAppearance({ startAnimation: true });
  const loaded = new Promise((r) => ctx.win.webContents.once('did-finish-load', r));
  ctx.win.webContents.reload();
  await loaded;
  const jank = await ctx.run(`new Promise((resolve) => { const gaps = []; let last = performance.now(); const end = last + 3000; const tick = (t) => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(gaps); }; requestAnimationFrame(tick); })`);
  const worst = Math.max(...jank);
  const avg = jank.reduce((a, b) => a + b, 0) / jank.length;
  let acc = 0;
  const slow = [];
  jank.forEach((g) => {
    acc += g;
    if (g > 60) slow.push(`${Math.round(acc)} ms: ${Math.round(g)} ms Pause`);
  });
  console.log(`INFO  Bildabstaende waehrend der Animation: Mittel ${avg.toFixed(1)} ms, schlechtester ${worst.toFixed(0)} ms, ${jank.length} Bilder in 3 s (VM ohne Grafikkarte); Pausen ueber 60 ms: ${slow.join(' | ') || 'keine'}`);

  const scriptErrors = consoleErrors.filter((m) => !/Failed to load resource|ERR_/.test(m));
  check('Keine Skriptfehler und keine Warnungen in der Konsole der Oberflaeche', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
