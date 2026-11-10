// Lautstaerkeleiste des Trailers (JC_DEV=1): Knopf und Leiste sind EIN Glasteil, die Kapsel waechst beim Daruebergehen nach rechts aus dem Knopf heraus und blendet von selbst wieder ein.
// Ohne Internet und ohne Server: der Trailer selbst wird nie gestartet (Verzoegerung eine Stunde), geprueft wird nur die Bedienung mit echten Mausereignissen und Tasten.
// Aufnahmen: TV-zu.png, TV-offen.png, TV-rechts.png.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/trailer-volume.js
const path = require('node:path');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const consoleErrors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) consoleErrors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  ctx.win.setContentSize(1280, 720);
  await ctx.wait(1500);
  const wc = ctx.win.webContents;
  const move = (x, y, held = false) => wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), ...(held ? { modifiers: ['leftButtonDown'] } : {}) });
  const key = (k) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  };

  // Aktionsleiste wie auf der Detailseite, darin der Ton-Knopf des Trailers (neben zwei gleichen Glas-Knoepfen als Vergleich)
  await ctx.run(`(async () => {
    const m = await import('./js/trailer.js');
    document.querySelector('#vt-root')?.remove();
    const root = document.createElement('div'); root.id = 'vt-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:9000;background:linear-gradient(120deg,#10121a,#2a1c3e)';
    const host = document.createElement('div'); host.style.cssText = 'position:absolute;inset:0';
    const actions = document.createElement('div'); actions.className = 'detail-actions'; actions.id = 'vt-actions'; actions.style.cssText = 'position:absolute;left:200px;top:300px;display:flex;align-items:center;gap:12px';
    for (const n of ['A', 'B']) { const b = document.createElement('button'); b.className = 'btn icon glass lg'; b.textContent = n; actions.append(b); }
    root.append(host, actions); document.body.append(root);
    window.__vtVol = null;
    window.__vt = m.createTrailer({ host, videoId: 'dQw4w9WgXcQ', delaySec: 3600, volume: 10, onVolume: (v) => { window.__vtVol = v; } });
    window.__vt.mountControls(actions);
    actions.querySelector('.trailer-ctl').hidden = false;
    return true;
  })()`);
  await ctx.wait(800);

  const q = (js) => ctx.run(js);
  const isOpen = () => q(`document.querySelector('.tr-sound').classList.contains('open')`);
  const isClosing = () => q(`document.querySelector('.tr-sound').classList.contains('closing')`);
  const geo = () => q(`(() => {
    const R = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; };
    return { btn: R('.tr-sound > button'), cap: R('.tr-pop-in'), inp: R('.tr-pop-in input'), iw: innerWidth };
  })()`);
  const glass = (sel) => q(`(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(sel)})); return { bgImage: s.backgroundImage, bgColor: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopColor, radius: s.borderTopLeftRadius, shadow: s.boxShadow, blur: s.backdropFilter, height: s.height }; })()`);
  const btnTransparent = () => q(`(() => { const s = getComputedStyle(document.querySelector('.tr-sound > button')); return s.backgroundImage === 'none' && /rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(s.backgroundColor) && /rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(s.borderTopColor) && s.boxShadow === 'none'; })()`);
  const reachableInput = () => q(`(() => { const r = document.querySelector('.tr-pop-in input').getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit?.matches('input[type=range]') ?? false; })()`);
  const rowRect = () => q(`JSON.stringify(document.getElementById('vt-actions').getBoundingClientRect())`);
  const away = () => move(900, 650);

  // ---------- Zu: ein runder Glas-Knopf wie die anderen ----------
  away();
  await ctx.wait(500);
  const g0 = await geo();
  check('Zu: nur der runde Glas-Knopf ist zu sehen (die Kapsel ist unsichtbar und liegt genau hinter ihm)', (await q(`+getComputedStyle(document.querySelector('.tr-pop')).opacity`)) === 0 && Math.abs(g0.cap.w - g0.btn.w) <= 2 && g0.cap.l === g0.btn.l && !(await btnTransparent()), JSON.stringify(g0));
  const ref = await glass('#vt-actions > button');
  const capLook = await glass('.tr-pop-in');
  const btnLook = await glass('.tr-sound > button');
  check('Die Kapsel hat genau das Glas der Knoepfe daneben (Fuellung, Kante, Rundung, Schatten, Unschaerfe, Hoehe)', JSON.stringify(capLook) === JSON.stringify(ref) && JSON.stringify(btnLook) === JSON.stringify(ref), JSON.stringify({ ref, capLook }));
  const rowBefore = await rowRect();
  await ctx.capture(path.join(out, 'TV-zu.png'));

  // ---------- Hover: der Knopf dehnt sich zur Kapsel ----------
  move(g0.btn.cx, g0.btn.cy);
  await ctx.wait(550);
  const g1 = await geo();
  check('Maus auf dem Knopf: die Kapsel waechst rechts aus dem Knopf heraus (links buendig, gleiche Hoehe)', (await isOpen()) && g1.cap.l === g1.btn.l && g1.cap.h === g1.btn.h && g1.cap.r >= g1.btn.r + 110 && g1.cap.r <= g1.iw - 8, JSON.stringify(g1));
  check('Knopf und Leiste bleiben ein Teil: der Knopf ist durchsichtig, die Kapsel traegt das Glas (keine doppelte Schicht, keine Naht)', await btnTransparent());
  check('Der Regler liegt in der Kapsel, rechts vom Knopf', g1.inp.l >= g1.btn.r - 10 && g1.inp.r <= g1.cap.r && Math.abs(g1.inp.cy - g1.btn.cy) <= 2, JSON.stringify(g1.inp));
  check('Der Regler ist bedienbar, der Knopf bleibt davor anklickbar', (await reachableInput()) && (await q(`document.elementFromPoint(${g1.btn.cx}, ${g1.btn.cy})?.closest('.tr-sound > button') !== null`)));
  check('Dabei springt nichts (die Aktionsleiste bleibt, wo sie ist)', (await rowRect()) === rowBefore);
  await ctx.capture(path.join(out, 'TV-offen.png'));
  const sc = { x: g1.inp.cx, y: g1.inp.cy, l: g1.inp.l + 6, r: g1.inp.r - 6 };
  move(sc.x, sc.y);
  await ctx.wait(1300);
  check('Maus auf der Kapsel: bleibt offen, auch weit ueber die Ausblendzeit hinaus', await isOpen());

  // ---------- Ziehen am Regler ----------
  wc.sendInputEvent({ type: 'mouseDown', x: sc.l + 10, y: sc.y, button: 'left', clickCount: 1 });
  await ctx.wait(100);
  move(sc.x, sc.y, true);
  await ctx.wait(100);
  move(sc.r + 260, sc.y + 220, true); // beim Ziehen weit aus der Kapsel heraus
  await ctx.wait(1500);
  check('Beim Ziehen am Regler bleibt die Kapsel offen, auch wenn die Maus sie verlaesst', await isOpen());
  const volDragged = await q(`+document.querySelector('.tr-pop-in input').value`);
  check('Der Regler folgte der Maus (ganz nach rechts gezogen: 100)', volDragged === 100, String(volDragged));
  wc.sendInputEvent({ type: 'mouseUp', x: sc.r + 260, y: sc.y + 220, button: 'left', clickCount: 1 });
  await ctx.wait(350);
  check('Nach dem Loslassen weit weg: noch kurz offen ...', await isOpen());
  await ctx.wait(1100);
  check('... und dann faehrt sie von selbst wieder ein', !(await isOpen()));
  check('Die gewaehlte Lautstaerke wurde gemeldet (zum Speichern)', (await q(`window.__vtVol`)) === 100, String(await q(`window.__vtVol`)));

  // ---------- Wegfahren und Einfahren ----------
  move(g0.btn.cx, g0.btn.cy);
  await ctx.wait(500);
  away();
  await ctx.wait(300);
  const stillOpen = await isOpen();
  await ctx.wait(500); // jetzt hat sie zu gehen begonnen
  const closingNow = await isClosing();
  const transparentWhileClosing = closingNow ? await btnTransparent() : null;
  await ctx.wait(500);
  const settled = { open: await isOpen(), closing: await isClosing(), glass: !(await btnTransparent()), capOpacity: await q(`+getComputedStyle(document.querySelector('.tr-pop')).opacity`) };
  check('Maus weggefahren: die Kapsel steht noch einen Augenblick, dann faehrt sie ein', stillOpen && !settled.open);
  check('Beim Einfahren bleibt der Knopf durchsichtig, bis die Kapsel wieder so schmal ist wie er (keine doppelte Schicht)', closingNow === true && transparentWhileClosing === true, `closing ${closingNow}, durchsichtig ${transparentWhileClosing}`);
  check('Danach ist es wieder der runde Glas-Knopf (Kapsel unsichtbar)', !settled.closing && settled.glass && settled.capOpacity === 0, JSON.stringify(settled));
  move(g0.btn.cx, g0.btn.cy);
  await ctx.wait(300);
  away();
  await ctx.wait(300);
  move(g0.btn.cx, g0.btn.cy); // zurueck, bevor sie eingefahren ist
  await ctx.wait(1000);
  check('Kommt die Maus rechtzeitig zurueck, bleibt sie offen', await isOpen());
  away();
  await ctx.wait(1700);

  // ---------- Mausrad ----------
  await q(`document.querySelector('.tr-sound').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`);
  await ctx.wait(350);
  check('Mausrad ueber dem Knopf (Maus sonst woanders): die Kapsel waechst heraus und zeigt den neuen Wert', await isOpen());
  await ctx.wait(1200);
  check('... bleibt nach dem Mausrad noch eine Weile ...', await isOpen());
  await ctx.wait(1500);
  check('... und faehrt ohne weitere Bedienung von selbst wieder ein (nach gut 2 s)', !(await isOpen()));
  await ctx.wait(400);

  // ---------- Klick auf den Knopf (echte Maus) ----------
  const titleBefore = await q(`document.querySelector('.tr-sound > button').title`);
  move(g0.btn.cx, g0.btn.cy);
  await ctx.wait(300);
  wc.sendInputEvent({ type: 'mouseDown', x: g0.btn.cx, y: g0.btn.cy, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: g0.btn.cx, y: g0.btn.cy, button: 'left', clickCount: 1 });
  await ctx.wait(300);
  const titleAfter = await q(`document.querySelector('.tr-sound > button').title`);
  check('Klick auf den Knopf (auch wenn die Kapsel offen ist): schaltet Ton an/aus', titleBefore !== titleAfter, `${titleBefore} -> ${titleAfter}`);
  away();
  await ctx.wait(1700);
  check('Nach dem Klick und Wegfahren faehrt die Kapsel ein, auch wenn der Knopf den Fokus behaelt', !(await isOpen()) && (await q(`document.activeElement === document.querySelector('.tr-sound > button')`)));

  // ---------- Tastatur ----------
  await q(`document.querySelectorAll('#vt-actions > button')[1].focus()`);
  key('Tab');
  await ctx.wait(500);
  check('Tab auf den Ton-Knopf: die Kapsel waechst heraus', (await q(`document.activeElement === document.querySelector('.tr-sound > button')`)) && (await isOpen()));
  await ctx.wait(2700);
  check('... und faehrt auch bei Tastaturfokus von selbst wieder ein', !(await isOpen()));
  key('Tab');
  await ctx.wait(400);
  const v0 = await q(`+document.querySelector('.tr-pop-in input').value`);
  key('Right');
  await ctx.wait(350);
  const v1 = await q(`+document.querySelector('.tr-pop-in input').value`);
  check('Pfeiltaste am Regler: der Wert aendert sich und die Kapsel ist offen', (await isOpen()) && v1 !== v0, `${v0} -> ${v1}`);
  await ctx.wait(2700);
  check('... und geht danach von selbst wieder zu', !(await isOpen()));
  await q(`document.activeElement?.blur()`);

  // ---------- Am rechten Rand ----------
  await q(`document.getElementById('vt-actions').style.left = (innerWidth - 150) + 'px'`);
  await ctx.wait(400);
  const g2 = await geo();
  move(g2.btn.cx, g2.btn.cy);
  await ctx.wait(650);
  const g3 = await geo();
  check('Knopf ganz rechts im Fenster: die Kapsel waechst nach links und bleibt im Bild (rechts buendig mit dem Knopf)', (await q(`document.querySelector('.tr-sound').classList.contains('flip')`)) && g3.cap.r === g3.btn.r && g3.cap.l >= 0 && g3.cap.w >= g3.btn.w + 110 && g3.inp.r <= g3.btn.l + 10 && (await reachableInput()), JSON.stringify(g3));
  await ctx.capture(path.join(out, 'TV-rechts.png'));
  away();
  await ctx.wait(1700);

  await q(`window.__vt.destroy(); document.querySelector('#vt-root')?.remove();`);
  check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
};
