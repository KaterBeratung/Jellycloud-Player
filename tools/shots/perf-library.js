// Leistungsmessung der Oberflaeche mit grosser Bibliothek (JC_DEV=1, JC_FAKE_MPV=1). Kein Pass/Fail: gibt Kennzahlen aus, die man vor und nach
// einer Aenderung vergleicht. PERF_N = Anzahl zusaetzlicher Filme (Standard 3000), PERF_LABEL = Name des Laufs.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; $env:PERF_N='3000'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/perf-library.js
// Gemessen wird in der Oberflaeche selbst: Bildzeiten (requestAnimationFrame), lange Aufgaben (>50 ms), DOM-Knoten, JS-Speicher.
// Hinweis: auf einer VM ohne GPU sind die absoluten Zahlen schlechter als auf echter Hardware, der Vergleich bleibt aussagekraeftig.
const { server, items, state, addMovies } = require('../mock-server');

const INSTRUMENT = `(() => {
  const P = (window.__perf = { frames: [], long: 0, longMax: 0, run: false });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.long += e.duration; P.longMax = Math.max(P.longMax, e.duration); } }).observe({ entryTypes: ['longtask'] }); } catch {}
  window.__frames = (on) => {
    P.run = on;
    if (!on) return;
    P.frames = []; P.long = 0; P.longMax = 0;
    let last = performance.now();
    const tick = (t) => { P.frames.push(t - last); last = t; if (P.run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  window.__cards = () => document.querySelectorAll('.grid .card:not(.sk-card)').length;
  window.__scroll = (dir, target, stepPx) => new Promise((res) => {
    const v = document.querySelector('#view');
    let n = 0;
    const step = () => {
      v.scrollTop += dir * stepPx; n++;
      const atEnd = dir > 0 ? window.__cards() >= target && v.scrollTop + v.clientHeight >= v.scrollHeight - 4 : v.scrollTop <= 0;
      if (atEnd || n > 3000) res(n); else requestAnimationFrame(step);
    };
    step();
  });
  window.__stats = () => {
    const f = [...P.frames].sort((a, b) => a - b);
    const q = (p) => (f.length ? f[Math.min(f.length - 1, Math.floor(f.length * p))] : 0);
    return { frames: f.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(f[f.length - 1] ?? 0).toFixed(1), over33: f.filter((x) => x > 33).length, longMs: Math.round(P.long), longMax: Math.round(P.longMax) };
  };
  window.__mem = () => ({ nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null });
})()`;

module.exports = async (ctx) => {
  const N = Number(process.env.PERF_N ?? 3000);
  const label = process.env.PERF_LABEL ?? 'lauf';
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  addMovies(N);
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(3000);
  await ctx.run(INSTRUMENT);
  // Versuche ohne Quelltext zu aendern: PERF_CSS wird als zusaetzliches Stylesheet eingefuegt
  if (process.env.PERF_CSS) await ctx.run(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(process.env.PERF_CSS)}; document.head.append(s); })()`);

  const movies = [...items.values()].filter((i) => i.Type === 'Movie').length;
  const view = [...items.values()].find((i) => i.CollectionType === 'movies');
  const within = (p, ms) => Promise.race([p, ctx.wait(ms).then(() => 'timeout')]);
  const out = { label, filme: movies };

  // ---------- 1. Bibliothek oeffnen: Zeit bis zu den ersten Karten ----------
  state.bytes.items = 0;
  const t0 = Date.now();
  await ctx.run(`location.hash = '#/library/${view.Id}'`);
  while (Date.now() - t0 < 30000 && (await ctx.run('window.__cards()')) < 60) await ctx.wait(25);
  out.ersteKartenMs = Date.now() - t0;
  out.bytesErsteSeite = state.bytes.items;
  await ctx.wait(1500); // Einblend-Animationen ausklingen lassen

  // ---------- 2. Alles laden, indem bis ans Ende gescrollt wird ----------
  await ctx.run('window.__frames(true)');
  const t1 = Date.now();
  const steps = await within(ctx.run(`window.__scroll(1, ${movies}, 500)`), 240000);
  out.ladenMs = Date.now() - t1;
  out.scrollSchritte = steps;
  await ctx.run('window.__frames(false)');
  out.runter = await ctx.run('window.__stats()');
  out.karten = await ctx.run('window.__cards()');
  out.speicher = await ctx.run('window.__mem()');
  out.bytesGesamt = state.bytes.items;
  await ctx.wait(1500);

  // ---------- 3. Alles geladen: Scrollen zurueck nach oben (reine Darstellungskosten) ----------
  await ctx.run('window.__frames(true)');
  await within(ctx.run('window.__scroll(-1, 0, 500)'), 120000);
  await ctx.run('window.__frames(false)');
  out.hoch = await ctx.run('window.__stats()');

  console.log(`PERF ${JSON.stringify(out)}`);
  server.close();
};
