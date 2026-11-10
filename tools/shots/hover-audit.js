// Hover-Pruefung (JC_DEV=1): fuhrt die Maus mit echten Eingabeereignissen auf den Rand bedienbarer Elemente und misst, ob der Hover-Zustand stabil bleibt.
// Fehlerbild "Flackern": Hebt sich ein Element beim Zeigen (transform: translate...) von der Maus weg, verliert es den Hover, faellt zurueck, bekommt ihn wieder ... (Zittern am Rand).
// Dazu: Zeiger (cursor) bedienbarer Elemente und das Verhalten bei Animationen "aus". Mock-Server auf eigenem Port 9197.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/hover-audit.js
const { server, items, SEERR, MOVIES_VIEW } = require('../mock-server');

module.exports = async (ctx) => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const PORT = 9197;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(400);
  ctx.win.setContentSize(1440, 900);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.seerrConnect({ url: 'http://127.0.0.1:${PORT}', mode: 'apikey', apiKey: ${JSON.stringify(SEERR.apiKey)} }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(1800);

  // Kein Trailer: sein fremder Rahmen (YouTube) kann Mausereignisse an sich ziehen und die Messung der folgenden Seiten verfaelschen
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
  const wc = ctx.win.webContents;
  const move = (x, y) => wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  const movie = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const show = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  const only = process.env.HOVER_PAGES ? process.env.HOVER_PAGES.split(',') : null;
  const pages = [
    ['Startseite', '#/home'],
    ['Bibliothek', `#/library/${MOVIES_VIEW.Id}`],
    ['Film', `#/item/${movie.Id}`],
    ['Serie', `#/item/${show.Id}`],
    ['Einstellungen Erscheinungsbild', '#/settings/appearance'],
    ['Einstellungen Discord', '#/settings/discord'],
    ['Suche', '#/search?q=a']
  ].filter(([n]) => !only || only.some((o) => n.includes(o)));

  const COLLECT = `(() => {
    const sel = 'a[href], button, [role="button"], [role="radio"], [role="switch"], .card, .ep, .person, .opt, .tab, .chip-btn, .snav, .theme-tile, .swatch, .nav-link, .seg, .issue-type, .tool, .brand, .btn, .switch, .req-card';
    const seen = new Set(); const sig = new Map(); const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue; seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || r.top < 96 && !el.closest('.topbar') && r.top < 70 || r.bottom > innerHeight - 6 || r.top < 4 || r.right > innerWidth - 6 || r.left < 4) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || el.disabled || cs.display === 'none' || +cs.opacity < 0.2) continue;
      const key = el.tagName + '.' + String(el.className).split(/\\s+/).filter((c) => !/^(on|off|selected|open)$/.test(c)).join('.');
      sig.set(key, (sig.get(key) ?? 0) + 1);
      if (sig.get(key) > 2) continue; // je Art hoechstens zwei Stuecke
      el.dataset.hv = String(out.length);
      out.push({ i: out.length, key, text: (el.getAttribute('aria-label') || el.title || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28), cursor: cs.cursor });
    }
    return out;
  })()`;

  /** Maus auf einen Randpunkt des Elements, dann den Hover-Zustand ueber 330 ms abtasten */
  const probe = async (i, edge) => {
    const pt = await ctx.run(`(() => {
      const el = document.querySelector('[data-hv="${i}"]'); if (!el) return null;
      const r = el.getBoundingClientRect();
      // Ganze Bildpunkte (so kommen Mausereignisse an): die letzte Zeile bzw. erste Spalte im Element, genau dort, wo eine Verschiebung beim Zeigen den Hover verliert
      const cx = Math.floor(r.left + r.width / 2); const cy = Math.floor(r.top + r.height / 2);
      const p = { bottom: [cx, Math.floor(r.bottom - 0.01)], left: [Math.ceil(r.left + 0.01), cy], top: [cx, Math.ceil(r.top + 0.01)], right: [Math.floor(r.right - 0.01), cy] }['${edge}'];
      // Runde Elemente (Farbfelder, Scheiben) haben an ihrem aeussersten Punkt keine verlaessliche Flaeche: dort nicht messen
      const cs = getComputedStyle(el); const round = parseFloat(cs.borderTopLeftRadius) >= Math.min(r.width, r.height) / 2 - 1 && cs.borderTopLeftRadius.indexOf('%') < 0 || cs.borderTopLeftRadius === '50%';
      if (round && ('${edge}' === 'left' || '${edge}' === 'right')) return null;
      const hit = document.elementFromPoint(p[0], p[1]);
      return hit && (hit === el || el.contains(hit)) ? p : null;
    })()`);
    if (!pt) return null;
    move(5, 5);
    await ctx.wait(70);
    move(pt[0], pt[1]);
    await ctx.wait(260); // Uebergaenge laufen aus
    const samples = [];
    for (let k = 0; k < 9; k++) {
      samples.push(await ctx.run(`document.querySelector('[data-hv="${i}"]')?.matches(':hover') ?? null`));
      await ctx.wait(35);
    }
    let flips = 0;
    for (let k = 1; k < samples.length; k++) if (samples[k] !== samples[k - 1]) flips++;
    return { flips, end: samples.at(-1), samples };
  };

  const flickers = [];
  const cursors = [];
  const blurred = [];
  let glassSeen = 0;
  let tabsSeen = 0;
  let tested = 0;
  for (const [name, hash] of pages) {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    await ctx.wait(2600);
    move(5, 5);
    const els = await ctx.run(COLLECT);
    // Weichzeichner (backdrop-filter) an Knoepfen/Reitern macht auf echter Grafikkarte einen harten senkrechten Streifen im Knopf beim Zeigen: alle ohne
    const glass = await ctx.run(`(() => { const all = [...document.querySelectorAll('.btn, .tab, .chip-btn, .opt, .tool')]; return { n: all.length, tabs: document.querySelectorAll('.tab').length, bad: all.filter((e) => { const b = getComputedStyle(e).backdropFilter; return b && b !== 'none'; }).map((e) => e.tagName + '.' + String(e.className).trim().replace(/\\s+/g, '.') + ' "' + e.textContent.trim().slice(0, 16) + '"').slice(0, 4) }; })()`);
    glassSeen += glass.n;
    tabsSeen += glass.tabs;
    for (const b of glass.bad) blurred.push(`[${name}] ${b}`);
    let bad = 0;
    for (const el of els) {
      for (const edge of ['bottom', 'left']) {
        const r = await probe(el.i, edge);
        if (!r) continue;
        tested++;
        // Fehler: der Hover zittert (wechselt) oder geht ganz verloren, obwohl die Maus im Element steht (die Hebung hat das Element unter der Maus weggezogen)
        if (r.flips >= 2 || r.end === false) {
          bad++;
          flickers.push(`[${name}] ${el.key} "${el.text}" Rand ${edge}: ${r.samples.map((s) => (s ? 1 : 0)).join('')}`);
        }
      }
      if (el.cursor !== 'pointer' && !/^(INPUT|TEXTAREA|SELECT)/.test(el.key) && !cursors.includes(`${el.key} "${el.text}" (${el.cursor})`)) cursors.push(`[${name}] ${el.key} "${el.text}" (${el.cursor})`);
    }
    console.log(`Seite ${name}: ${els.length} Elemente, ${bad} mit Flackern`);
  }
  move(5, 5);
  console.log(`Randpunkte geprueft: ${tested}`);

  // Klick ganz am Rand (letzte Zeile bzw. erste Spalte): Druecken verkleinert den Knopf, der Klick darf trotzdem nicht verloren gehen
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await ctx.wait(2600);
  const targets = await ctx.run(`(() => {
    window.__hvClicks = {};
    const out = [];
    for (const [i, el] of [...document.querySelectorAll('.detail-actions .btn.icon, .detail-actions .btn.glass')].filter((b) => !/Trailer/.test(b.textContent)).slice(0, 4).entries()) {
      el.dataset.edge = String(i); window.__hvClicks[i] = 0; el.addEventListener('click', () => { window.__hvClicks[i]++; });
      out.push(i);
    }
    return out;
  })()`);
  let lost = 0;
  let tries = 0;
  for (const i of targets) {
    for (const edge of ['bottom', 'left']) {
      const pt = await ctx.run(`(() => { const el = document.querySelector('[data-edge="${i}"]'); const r = el.getBoundingClientRect(); const cx = Math.floor(r.left + r.width / 2); const cy = Math.floor(r.top + r.height / 2);
        const p = '${edge}' === 'bottom' ? [cx, Math.floor(r.bottom - 0.01)] : [Math.ceil(r.left + 0.01), cy]; const hit = document.elementFromPoint(p[0], p[1]); return hit && (hit === el || el.contains(hit)) ? p : null; })()`);
      if (!pt) continue;
      move(5, 5);
      await ctx.wait(60);
      move(pt[0], pt[1]);
      await ctx.wait(220);
      wc.sendInputEvent({ type: 'mouseDown', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
      await ctx.wait(120);
      wc.sendInputEvent({ type: 'mouseUp', x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
      await ctx.wait(150);
      tries++;
      const n = await ctx.run(`window.__hvClicks[${i}]`);
      if (n < 1) {
        lost++;
        console.log(`  KLICK VERLOREN Knopf ${i} Rand ${edge}`);
      }
      await ctx.run(`window.__hvClicks[${i}] = 0`);
    }
  }
  move(5, 5);
  check('Ein Klick ganz am Rand eines Knopfes kommt an (der Knopf weicht beim Druecken nicht unter der Maus weg)', tries > 0 && lost === 0, `${tries} Versuche, ${lost} verloren`);
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); // ein Klick kann ein Fenster geoeffnet haben (Problem melden)
  await ctx.wait(500);

  // Animationen "aus": keine Hebung beim Zeigen
  await ctx.run(`window.jc.setSettings({ appearance: { animations: 'off' } }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await ctx.wait(2200);
  const centre = await ctx.run(`(() => { const el = document.querySelector('.detail-actions .btn.icon'); const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  move(5, 5);
  await ctx.wait(80);
  move(centre[0] - 3, centre[1]);
  await ctx.wait(80);
  move(centre[0], centre[1]);
  await ctx.wait(400);
  const hovered = await ctx.run(`(() => { const el = document.querySelector('.detail-actions .btn.icon:hover'); return el ? { transform: getComputedStyle(el).transform, anim: document.documentElement.dataset.anim } : { none: [...document.querySelectorAll(':hover')].map((e) => e.tagName + '.' + e.className).join(' > ').slice(0, 160), anim: document.documentElement.dataset.anim }; })()`);
  check('Animationen "aus": der Knopf hebt sich beim Zeigen nicht', hovered.transform === 'none' && hovered.anim === 'off', JSON.stringify(hovered));
  await ctx.run(`window.jc.setSettings({ appearance: { animations: 'full' } }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(1500);
  check('Kein Element flackert am Rand (Hover bleibt stabil, wenn sich das Element beim Zeigen bewegt)', flickers.length === 0, `${flickers.length} Treffer`);
  for (const f of flickers) console.log(`  FLACKERN ${f}`);
  check('Alle bedienbaren Elemente zeigen den Zeiger (cursor: pointer)', cursors.length === 0, `${cursors.length} ohne`);
  check('Knoepfe, Reiter (Staffeln) und Auswahlfelder haben keinen Weichzeichner (sonst Streifen am Rand beim Zeigen)', glassSeen > 10 && (only || tabsSeen >= 2) && blurred.length === 0, `${glassSeen} Elemente, ${tabsSeen} Reiter, mit Weichzeichner: ${blurred.join(' | ')}`);
  for (const c of cursors) console.log(`  ZEIGER ${c}`);

  // ---------- Karte: Neigung und Hebung gehen zurueck, wenn die Maus weg ist ----------
  await ctx.run(`location.hash = '#/library/${MOVIES_VIEW.Id}'`);
  await ctx.wait(2600);
  const cardPt = await ctx.run(`(() => { const c = document.querySelector('.library .card'); const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.9), y: Math.round(r.top + r.height * 0.15) }; })()`);
  move(5, 5);
  await ctx.wait(80);
  move(cardPt.x - 20, cardPt.y);
  await ctx.wait(60);
  move(cardPt.x, cardPt.y);
  await ctx.wait(500);
  const tilted = await ctx.run(`getComputedStyle(document.querySelector('.library .card:hover .thumb') ?? document.body).transform`);
  move(5, 5); // in einem Sprung weg, ohne ueber den Rand der Karte zu fahren
  await ctx.wait(700);
  const rested = await ctx.run(`(() => { const t = document.querySelector('.library .card .thumb'); return { transform: getComputedStyle(t).transform, hovered: document.querySelectorAll('.library .card:hover').length, rx: t.parentElement.style.getPropertyValue('--rx') || getComputedStyle(t).getPropertyValue('--rx') }; })()`);
  check('Karte: beim Zeigen geneigt und angehoben, nach dem Wegfahren wieder in Ruhe', tilted !== 'none' && rested.transform === 'none' && rested.hovered === 0, `beim Zeigen ${tilted.slice(0, 40)}, danach ${rested.transform}, Karten mit Hover ${rested.hovered}`);

  // ---------- Menue: Tastatur und Maus gleichzeitig ----------
  // Mit der Tastatur geoeffnet steht der erste Eintrag im Fokus; faehrt man dann mit der Maus auf einen anderen, durfte nur der unter der Maus hervorgehoben sein
  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await ctx.wait(2400);
  await ctx.run(`document.querySelector('.detail-actions [aria-label="Mehr"]').focus()`);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'char', keyCode: '\r' }); // erst das Zeichen loest bei einem Knopf den Klick aus
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await ctx.wait(600);
  const menuOpen = await ctx.run(`document.querySelectorAll('.menu-item').length`);
  const firstFocus = await ctx.run(`!!document.activeElement?.classList.contains('menu-item') && document.activeElement.matches(':focus-visible')`);
  let lit = [];
  if (menuOpen >= 3) {
    const third = await ctx.run(`(() => { const b = document.querySelectorAll('.menu-item')[2]; const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    move(5, 5);
    await ctx.wait(60);
    move(third[0] - 4, third[1]);
    await ctx.wait(60);
    move(third[0], third[1]);
    await ctx.wait(350);
    lit = await ctx.run(`[...document.querySelectorAll('.menu-item')].map((b, i) => (b.matches(':hover') || b.matches(':focus-visible') ? i : -1)).filter((i) => i >= 0)`);
  }
  check('Menue mit Tastatur geoeffnet, dann Maus auf einen Eintrag: nur dieser eine ist hervorgehoben', menuOpen >= 3 && firstFocus && lit.length === 1 && lit[0] === 2, `Eintraege ${menuOpen}, Tastaturfokus am Anfang ${firstFocus}, hervorgehoben: ${JSON.stringify(lit)}`);
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(400);
  move(5, 5);

  // ---------- Player-Overlay: Knoepfe am Rand ----------
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, startTicks: 0 })`);
  const playEnd = Date.now() + 12000;
  while (Date.now() < playEnd && ctx.player.state.phase !== 'playing') await ctx.wait(100);
  await ctx.wait(800);
  if (ctx.player.state.phase === 'playing' && ctx.player.overlay) {
    const ov = ctx.player.overlay.webContents;
    const ovMove = (x, y) => ov.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    ovMove(400, 300);
    await ctx.wait(80);
    ovMove(420, 310);
    await ctx.wait(900); // die Leiste blendet ein
    const ids = await ov.executeJavaScript(`(() => { const out = []; document.querySelectorAll('.ibtn, .round, .stepper button, .skip, .pause-go').forEach((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width < 20 || cs.visibility === 'hidden' || el.closest('[hidden]') || r.bottom > innerHeight - 2 || r.top < 2 || r.left < 2 || r.right > innerWidth - 2) return; el.dataset.hv = String(out.length); out.push({ i: out.length, key: el.className }); }); return out; })()`);
    const ovBad = [];
    for (const el of ids.slice(0, 10)) {
      const pt = await ov.executeJavaScript(`(() => { const e = document.querySelector('[data-hv="${el.i}"]'); const r = e.getBoundingClientRect(); const p = [Math.floor(r.left + r.width / 2), Math.floor(r.bottom - 0.01)]; const hit = document.elementFromPoint(p[0], p[1]); return hit && (hit === e || e.contains(hit)) ? p : null; })()`);
      if (!pt) continue;
      ovMove(420, 310);
      await ctx.wait(80);
      ovMove(pt[0], pt[1]);
      await ctx.wait(300);
      const samples = [];
      for (let k = 0; k < 8; k++) {
        samples.push(await ov.executeJavaScript(`document.querySelector('[data-hv="${el.i}"]')?.matches(':hover') ?? null`));
        await ctx.wait(35);
      }
      let flips = 0;
      for (let k = 1; k < samples.length; k++) if (samples[k] !== samples[k - 1]) flips++;
      if (flips >= 2 || samples.at(-1) === false) ovBad.push(`${el.key} ${samples.map((s) => (s ? 1 : 0)).join('')}`);
    }
    check('Player-Overlay: Knoepfe flackern am unteren Rand nicht und verlieren den Hover nicht', ids.length > 0 && ovBad.length === 0, `${ids.length} Knoepfe, ${ovBad.length} Treffer ${ovBad.join(' | ')}`);
    // Pausenbildschirm: "Weiter" hebt sich beim Zeigen (und wird beim Druecken kleiner)
    await ov.executeJavaScript(`window.player.send({ type: 'pause' })`);
    const pauseEnd = Date.now() + 12000;
    let goShown = false;
    while (Date.now() < pauseEnd && !goShown) {
      await ctx.wait(200);
      goShown = await ov.executeJavaScript(`(() => { const p = document.querySelector('.pause'); return !!p && !p.hidden && p.classList.contains('in'); })()`);
    }
    if (goShown) {
      await ov.executeJavaScript(`document.querySelector('.pause-go').dataset.hv = 'go'`);
      const gpt = await ov.executeJavaScript(`(() => { const e = document.querySelector('.pause-go'); const r = e.getBoundingClientRect(); return [Math.floor(r.left + r.width / 2), Math.floor(r.bottom - 0.01)]; })()`);
      ovMove(gpt[0] + 60, gpt[1] - 80);
      await ctx.wait(100);
      ovMove(gpt[0], gpt[1]);
      await ctx.wait(500);
      const gs = [];
      for (let k = 0; k < 8; k++) {
        gs.push(await ov.executeJavaScript(`document.querySelector('.pause-go')?.matches(':hover') ?? null`));
        await ctx.wait(35);
      }
      let gflips = 0;
      for (let k = 1; k < gs.length; k++) if (gs[k] !== gs[k - 1]) gflips++;
      check('Pausenbildschirm: "Weiter" behaelt den Hover am unteren Rand (flackert nicht)', gflips < 2 && gs.at(-1) === true, gs.map((s) => (s ? 1 : 0)).join(''));
    } else check('Pausenbildschirm erscheint fuer die Pruefung', false);
    await ov.executeJavaScript(`window.player.send({ type: 'close' })`).catch(() => {});
    const closeEnd = Date.now() + 8000;
    while (Date.now() < closeEnd && ctx.player.mpv) await ctx.wait(100);
    await ctx.wait(600);
  } else {
    check('Player-Overlay: Wiedergabe laeuft fuer die Pruefung', false, String(ctx.player.state.phase));
  }

  // ---------- Textkontrast beim Zeigen in allen Themes ----------
  // Misst die Farbe der Schrift gegen den Untergrund des Elements (Schichten uebereinandergelegt) im Hover-Zustand; mindestens 4,5 : 1 (grosse fette Schrift 3 : 1)
  const measure = (i) => {
    const parse = (c) => { const cs = /color\(srgb ([^)]+)\)/.exec(c); if (cs) { const q = cs[1].split(/[ /]+/).filter(Boolean).map(Number); return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 }; } const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const el = document.querySelector(`[data-hv="${i}"]`);
    if (!el) return null;
    const probe = document.createElement('div'); probe.style.background = 'var(--page)'; document.body.append(probe); const pageBg = parse(getComputedStyle(probe).backgroundColor); probe.remove();
    const stack = []; let image = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none' && !/^linear-gradient\(rgba?\([^)]*\), rgba?\([^)]*\)\)$/.test(s.backgroundImage) && !/gradient\(150deg, rgba\(255, 255, 255/.test(s.backgroundImage)) image = true;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let bg = pageBg;
    for (const s of stack.reverse()) bg = over(s, bg);
    const s = getComputedStyle(el); const fg = parse(s.color);
    if (!fg || !(el.textContent || '').trim()) return null;
    const f = over(fg, bg); const L1 = lum(f); const L2 = lum(bg);
    const size = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight, 10) >= 700;
    return { ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100, need: size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5, image, hover: el.matches(':hover') };
  };
  const lowContrast = [];
  let measured = 0;
  for (const theme of ['midnight', 'graphite', 'amoled', 'daylight']) {
    ctx.config.updateSettings({ appearance: { theme } });
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(2300);
    for (const [name, hash] of [['Einstellungen', '#/settings/appearance'], ['Film', `#/item/${movie.Id}`], ['Bibliothek', `#/library/${MOVIES_VIEW.Id}`]]) {
      await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
      await ctx.wait(2300);
      move(5, 5);
      const els = await ctx.run(COLLECT);
      for (const el of els) {
        // Karten tragen ein Bild; die Reiter der Kopfleiste liegen auf einer eigenen Anzeige (nav-indicator), ihr Untergrund laesst sich nicht aus den Vorfahren lesen
        if (/^(A\.card|A\.nav-link)/.test(el.key) || !el.text) continue;
        const pt = await ctx.run(`(() => { const e = document.querySelector('[data-hv="${el.i}"]'); const r = e.getBoundingClientRect(); const p = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; const hit = document.elementFromPoint(p[0], p[1]); return hit && (hit === e || e.contains(hit)) ? p : null; })()`);
        if (!pt) continue;
        move(5, 5);
        await ctx.wait(60);
        move(pt[0], pt[1]);
        await ctx.wait(340);
        const m = await ctx.run(`(${measure.toString()})(${el.i})`);
        if (!m || m.image || !m.hover) continue;
        measured++;
        if (m.ratio < m.need) lowContrast.push(`[${theme}/${name}] ${el.key} "${el.text}" ${m.ratio} < ${m.need}`);
      }
    }
  }
  move(5, 5);
  ctx.config.updateSettings({ appearance: { theme: 'midnight' } });
  check('Text beim Zeigen ist in allen vier Themes gut lesbar (Kontrast mindestens 4,5 : 1)', lowContrast.length === 0, `${measured} Stellen, ${lowContrast.length} zu schwach`);
  for (const l of lowContrast) console.log(`  KONTRAST ${l}`);

  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
};
