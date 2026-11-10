// YouTube-Symbol im Trailer: Die Einbettung blendet bei jedem Anhalten und Fortsetzen (pauseVideo/playVideo) ihre Steuerflaeche ein (grauer Kreis mit Pause-Zeichen in der Bildmitte, Ladekreis).
// Der Hauptprozess haengt dem Rahmen dafuer ein Stylesheet an (main.js: quietEmbedFrame). Gemessen wird im Rahmen selbst (WebFrameMain.executeJavaScript): wie sichtbar (Flaeche > 0, Deckkraft
// entlang der Elternkette) die Steuerflaechen sind, waehrend das Video angehalten, fortgesetzt und gepuffert wird. Dazu eine Gegenprobe ohne Stylesheet (das Symbol ist dann wirklich da) und ein zweiter,
// neu angelegter Rahmen (Seitenwechsel). Aufnahmen der Mitte landen in SHOT_DIR (sym-*.png).
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..', '..');
const { server, items } = require(path.join(root, 'tools', 'mock-server'));

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR;
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
  const series = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  series.RemoteTrailers = [{ Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];
  ctx.config.updateSettings({ trailer: { autoplay: true, muted: true, delaySec: 0, quality: '1080', focusSec: 0 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  ctx.win.setContentSize(1280, 720);
  await ctx.wait(600);
  // Probe: Ebene immer sichtbar, damit die Aufnahmen den Rahmen zeigen
  await ctx.run(`(() => { const s = document.createElement('style'); s.textContent = '.trailer { opacity: 1 !important; transition: none !important; }'; document.head.append(s); })()`);

  const ytFrame = () => ctx.win.webContents.mainFrame.framesInSubtree.find((f) => /youtube-nocookie/.test(f.url));
  // Fruehe Messung: gleich nach der Navigation des Rahmens (Listener der App ist zuerst eingetragen, die Aufrufe laufen in der Reihenfolge)
  const early = [];
  ctx.win.webContents.on('did-frame-navigate', (_e, url, _c, _t, isMain, pid, rid) => {
    if (isMain || early.length) return;
    try {
      const { webFrameMain } = require('electron');
      const f = webFrameMain.fromId(pid, rid);
      f.executeJavaScript(`JSON.stringify({ state: document.readyState, sheets: document.adoptedStyleSheets.length, mark: !!window.__jcQuiet, player: !!document.querySelector('.html5-video-player') })`).then((r) => early.push(JSON.parse(r))).catch(() => {});
    } catch { /* egal */ }
    early.push(null); // Platzhalter: nur der erste Rahmen wird gemessen
  });

  await ctx.run(`location.hash = '#/item/${series.Id}'`);
  check('Trailer-Rahmen wird angelegt', await waitFor(`!!document.querySelector('.trailer iframe')`, 20000));
  let f = null;
  for (let i = 0; i < 100 && !f; i++) { f = ytFrame(); if (!f) await ctx.wait(100); }
  check('Der Hauptprozess findet den YouTube-Rahmen (WebFrameMain)', !!f);
  if (!f) { console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`); server.close(); return; }
  for (let i = 0; i < 150; i++) {
    try { if (await ytFrame().executeJavaScript(`!!document.querySelector('.html5-video-player')`)) break; } catch { /* Rahmen im Umbau */ }
    await ctx.wait(100);
  }
  const e0 = early.find(Boolean);
  console.log('FRUEH ' + JSON.stringify(e0 ?? null));
  check('Stylesheet war schon da, als der Rahmen uebernommen wurde (vor dem ersten Bild des Players)', !!e0 && e0.sheets >= 1 && e0.mark && !e0.player, JSON.stringify(e0 ?? null));
  const sheets = await ytFrame().executeJavaScript(`document.adoptedStyleSheets.length`);
  check('Genau ein Stylesheet (mehrfaches Einschleusen haengt nichts doppelt an)', sheets === 1, `${sheets}`);

  // Sichtbarkeit der Steuerflaechen im Rahmen: groesste Deckkraft (Eigen- mal Eltern-Deckkraft) unter den Elementen mit Flaeche
  const MEASURE = `(() => {
    const sel = 'player-middle-controls, .player-controls-middle-core-buttons, .player-controls-spinner, .spinner, .ytp-bezel, .ytp-bezel-text-wrapper, .ytp-large-play-button, .ytp-spinner';
    const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= parseFloat(cs.opacity); } return o; };
    let best = 0, who = '';
    for (const e of document.querySelectorAll(sel)) { const b = e.getBoundingClientRect(); if (b.width < 8 || b.height < 8) continue; const o = eff(e); if (o > best) { best = o; who = e.tagName + '.' + String(e.className?.baseVal ?? e.className).split(' ')[0]; } }
    const v = document.querySelector('video');
    return JSON.stringify({ best: +best.toFixed(3), who, t: v ? +v.currentTime.toFixed(1) : -1, paused: v ? v.paused : null });
  })()`;
  const measure = async () => JSON.parse(await ytFrame().executeJavaScript(MEASURE));
  const cmd = (func) => ctx.run(`document.querySelector('.trailer iframe').contentWindow.postMessage(JSON.stringify({event:'command', func:'${func}', args:[]}), '*')`);
  const playing = async (min) => {
    for (let i = 0; i < 400; i++) {
      try { if (await ytFrame().executeJavaScript(`(() => { const v = document.querySelector('video'); return !!v && v.currentTime > ${min} && !v.paused && v.readyState >= 3; })()`)) return true; } catch { /* Rahmen im Umbau */ }
      await ctx.wait(100);
    }
    return false;
  };
  let n = 0;
  const grab = async (label) => {
    const r = await ctx.run(`(() => { const b = document.querySelector('.trailer')?.getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`);
    if (!r) return;
    const img = await ctx.win.webContents.capturePage({ x: Math.max(0, Math.round(r.x - 150)), y: Math.max(0, Math.round(r.y - 150)), width: 300, height: 300 });
    n++;
    fs.writeFileSync(path.join(out, `sym-${String(n).padStart(2, '0')}-${label}.png`), img.toPNG());
  };
  // Eine Runde: anhalten, kurz warten, fortsetzen und danach alle 250 ms messen (Puffern, Spielen, Ausblenden der Leiste)
  const round = async (tag, secs = 7) => {
    await playing(1);
    await cmd('pauseVideo');
    const samples = [];
    for (let i = 0; i < 5; i++) { await ctx.wait(100); samples.push(await measure()); }
    await grab(`${tag}-pause`);
    await cmd('playVideo');
    const t0 = Date.now();
    let k = 0;
    while (Date.now() - t0 < secs * 1000) {
      samples.push(await measure());
      if (++k % 8 === 0) await grab(`${tag}-play-${Math.round((Date.now() - t0) / 1000)}s`);
      await ctx.wait(250);
    }
    return samples;
  };
  console.log('Video laeuft: ' + (await playing(1.5)));

  // 1) Mit dem Stylesheet der App
  const withCss = await round('mit');
  const worstWith = Math.max(...withCss.map((s) => s.best));
  check('Mit Stylesheet: waehrend Anhalten, Fortsetzen und Puffern ist keine Steuerflaeche sichtbar', worstWith === 0, `${withCss.length} Messungen, groesste Sichtbarkeit ${worstWith}`);
  check('Das Video laeuft danach weiter (nur die Oberflaeche ist weg)', (await measure()).paused === false && withCss[withCss.length - 1].t > withCss[0].t, `${withCss[0].t}s -> ${withCss[withCss.length - 1].t}s`);

  // 2) Gegenprobe ohne Stylesheet: das Symbol ist wirklich da (sonst taugt die Messung nichts)
  await ytFrame().executeJavaScript(`document.adoptedStyleSheets = []`);
  const without = await round('ohne', 9);
  const worstWithout = Math.max(...without.map((s) => s.best));
  const hit = without.filter((s) => s.best > 0.3).length;
  console.log('OHNE ' + JSON.stringify(without.map((s) => s.best)));
  check('Gegenprobe ohne Stylesheet: die Steuerflaeche ist sichtbar (Messung taugt)', hit >= 2, `${hit} von ${without.length} Messungen ueber 0,3, groesste ${worstWithout} (${without.find((s) => s.best === worstWithout)?.who ?? ''})`);

  // 3) Zweiter Rahmen: Seite verlassen und wieder oeffnen, der neue Rahmen bekommt das Stylesheet ebenfalls
  await ctx.run(`location.hash = '#/'`);
  await ctx.wait(1500);
  await ctx.run(`location.hash = '#/item/${series.Id}'`);
  check('Zweiter Trailer-Rahmen wird angelegt', await waitFor(`!!document.querySelector('.trailer iframe')`, 20000));
  await ctx.run(`(() => { if (document.getElementById('probe-on')) return; const s = document.createElement('style'); s.id = 'probe-on'; s.textContent = '.trailer { opacity: 1 !important; transition: none !important; }'; document.head.append(s); })()`);
  let second = null;
  for (let i = 0; i < 150 && !second; i++) {
    try { second = await ytFrame().executeJavaScript(`document.querySelector('.html5-video-player') ? JSON.stringify({ sheets: document.adoptedStyleSheets.length, mark: !!window.__jcQuiet }) : null`); } catch { /* Rahmen im Umbau */ }
    if (!second) await ctx.wait(100);
  }
  const s2 = second ? JSON.parse(second) : null;
  check('Der neue Rahmen hat das Stylesheet ebenfalls', !!s2 && s2.sheets === 1 && s2.mark, JSON.stringify(s2));
  console.log('Video laeuft: ' + (await playing(1.5)));
  const again = await round('zweiter', 6);
  const worstAgain = Math.max(...again.map((s) => s.best));
  check('Zweiter Rahmen: auch hier keine Steuerflaeche sichtbar', worstAgain === 0, `${again.length} Messungen, groesste Sichtbarkeit ${worstAgain}`);

  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  server.close();
};
