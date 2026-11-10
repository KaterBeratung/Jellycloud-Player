// Audit der vier Themes (JC_DEV=1, JC_FAKE_MPV=1): Kontrast der Texte in den neuen Ansichten (Verwaltung, Dialoge, Menues) und Screenshots je Theme.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/audit-themes.js
const path = require('node:path');
const { server, items, setAdmin } = require('../mock-server');

// Kontrastverhaeltnis (WCAG) eines Textelements zu seinem tatsaechlichen Hintergrund (Vorfahren ueberlagert; Verlaeufe und Bilder zaehlen als nicht pruefbar)
const CONTRAST = (sels) => `(() => {
  const parse = (c) => { const cs = /color\\(srgb ([^)]+)\\)/.exec(c); if (cs) { const q = cs[1].split(/[ \\/]+/).filter(Boolean).map(Number); return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 }; } const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && !/^linear-gradient\\(rgba?\\([^)]*\\), rgba?\\([^)]*\\)\\)$/.test(s.backgroundImage)) { stack.push({ image: true }); } const c = parse(s.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let acc = pageBg; let image = false; for (const s of stack.reverse()) { if (s.image) image = true; else acc = over(s, acc); } return { color: acc, image }; };
  const probe = document.createElement('div'); probe.style.background = 'var(--page)'; document.body.append(probe); const pageBg = parse(getComputedStyle(probe).backgroundColor); probe.remove();
  const out = [];
  for (const sel of ${JSON.stringify(sels)}) {
    for (const el of [...document.querySelectorAll(sel)].slice(0, 6)) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || !(el.textContent || '').trim()) continue;
      const s = getComputedStyle(el); const fg = parse(s.color); if (!fg) continue;
      const { color: bg, image } = bgOf(el); const f = over(fg, bg);
      const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight, 10) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
      out.push({ sel, text: el.textContent.trim().slice(0, 28), ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5, image });
    }
  }
  return out;
})()`;

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  setAdmin(true);
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
  const press = (key) => ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
  const movie = [...items.values()].find((i) => i.Name === 'Paper Moons');
  ctx.win.setContentSize(1280, 720);

  const settingsSels = ['.page-title', '.snav', '.snav.on', '.group-title', '.setting-label', '.setting-desc', '.admin-status', '.admin-when', '.admin-chip', '.admin-note', '.btn.sm'];
  const dialogSels = ['.mdl-title', '.mdl-text p', '.mdl-field > span', '.mdl-hint', '.mdl-error', '.mdl-result .n', '.mdl-result .p', '.mdl-result .o', '.mdl .btn', '.mdl .field'];
  const report = async (label, sels) => {
    const rows = await ctx.run(CONTRAST(sels));
    const bad = rows.filter((r) => r.ratio < r.need && !r.image);
    check(`${label}: Textkontrast (${rows.length} Stellen geprueft)`, bad.length === 0, bad.map((r) => `${r.sel} "${r.text}" ${r.ratio} < ${r.need}`).slice(0, 5).join('; '));
  };

  for (const theme of ['midnight', 'graphite', 'amoled', 'daylight']) {
    ctx.config.updateSettings({ appearance: { theme } });
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(2300);
    const tag = theme;
    // Verwaltung
    await ctx.run(`location.hash = '#/admin/tasks'`);
    await waitFor(`document.querySelectorAll('.admin-task').length > 0`, 5000);
    await ctx.wait(900);
    await report(`[${tag}] Verwaltung (Aufgaben)`, settingsSels);
    await ctx.capture(path.join(out, `T-${tag}-admin-aufgaben.png`));
    await ctx.run(`location.hash = '#/admin/users'`);
    await waitFor(`document.querySelectorAll('.admin-user').length > 0`, 5000);
    await ctx.wait(700);
    await report(`[${tag}] Verwaltung (Benutzer)`, settingsSels);
    await ctx.capture(path.join(out, `T-${tag}-admin-benutzer.png`));
    // Einstellungen (alle Bereiche)
    for (const sec of ['appearance', 'video', 'audio', 'subtitles', 'behavior', 'network', 'general', 'discord', 'account', 'about']) {
      await ctx.run(`location.hash = '#/settings/${sec}'`);
      await ctx.wait(700);
      await report(`[${tag}] Einstellungen ${sec}`, [...settingsSels, '.seg', '.seg.on', '.setting-control .btn', '.field', '.settings-group .btn.sm', 'dt', 'dd', '.about-card p']);
    }
    // Dialog Identifizieren und Bearbeiten
    await ctx.run(`location.hash = '#/item/${movie.Id}'`);
    await waitFor(`!!document.querySelector('.detail-actions button[title="Mehr"]')`, 10000);
    await ctx.wait(1000);
    await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
    await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(400);
    await ctx.capture(path.join(out, `T-${tag}-mehr-menue.png`));
    await ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => /Identifizieren/.test(b.textContent)).click()`);
    await waitFor(`!!document.querySelector('.mdl-search')`, 3000);
    await ctx.run(`document.querySelector('.mdl-search .btn').click()`);
    await waitFor(`document.querySelectorAll('.mdl-result').length === 2`, 5000);
    await ctx.wait(400);
    await report(`[${tag}] Identifizieren-Dialog`, dialogSels);
    await ctx.capture(path.join(out, `T-${tag}-identifizieren.png`));
    await press('Escape');
    await ctx.wait(400);
    // Startseite mit Banner
    await ctx.run(`location.hash = '#/home'`);
    await ctx.wait(2300);
    await ctx.capture(path.join(out, `T-${tag}-home.png`));
  }

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
