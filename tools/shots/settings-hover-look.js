// Hover-Aufnahmen der Einstellungen (JC_DEV=1): faehrt mit echten Mausereignissen auf jede Art bedienbarer Elemente jeder Seite der Einstellungen, nimmt
// Ruhe und Hover als Ausschnitt auf und schreibt die Unterschiede der berechneten Stile (Hintergrund, Rand, Schatten, Hebung, Schrift, Uebergang) ins
// Protokoll. Dient der Durchsicht ("die Hovereffekte sind noch etwas unsauber"), keine Pruefung mit Bestanden/Nicht bestanden. Port 9198.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/settings-hover-look.js
const path = require('node:path');
const fs = require('node:fs');
const { server } = require('../mock-server');

module.exports = async (ctx) => {
  const out = path.join(process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots'), 'hover-look');
  fs.mkdirSync(out, { recursive: true });
  const PORT = 9198;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  ctx.win.setContentSize(1280, 860);
  await ctx.wait(400);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.setSettings({ trailer: { autoplay: false, home: false } })`);
  const wc = ctx.win.webContents;
  const move = (x, y) => wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  const pages = (process.env.LOOK_PAGES || 'appearance,home,video,audio,subtitles,behavior,network,general,seerr,notifications,discord,account,about').split(',');
  const SEL = '.btn, .switch, .seg, [role="radio"], .select, .snav, .slist-row, .swatch, .theme-tile, .stepper button, .chip-btn, .tool, .link-row, .setting a, .settings-back, .tab, .opt, .acct-row, .profile-row, .row-link';
  const STYLE = `(el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, bgi: s.backgroundImage.slice(0, 60), bd: s.borderColor, bs: s.boxShadow.slice(0, 90), tf: s.transform, sc: s.scale, color: s.color, op: s.opacity, tr: s.transitionProperty.slice(0, 80) + ' ' + s.transitionDuration.slice(0, 30), rad: s.borderRadius, outline: s.outlineStyle }; }`;
  const report = [];
  let n = 0;
  for (const page of pages) {
    await ctx.run(`location.hash = '#/settings/${page}'`);
    await ctx.wait(1800);
    move(3, 3);
    await ctx.wait(300);
    await ctx.capture(path.join(out, `page-${page}.png`));
    const els = await ctx.run(`(() => {
      const seen = new Map(); const out = [];
      for (const el of document.querySelectorAll(${JSON.stringify(SEL)})) {
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 12 || r.top < 90 || r.bottom > innerHeight - 4 || r.left < 2 || r.right > innerWidth - 2) continue;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || el.disabled) continue;
        const key = el.tagName + '.' + String(el.className).split(/\\s+/).filter((c) => c && !/^(on|off|selected|open|active)$/.test(c)).join('.');
        const k = (seen.get(key) ?? 0) + 1; seen.set(key, k); if (k > 1) continue;
        el.dataset.look = String(out.length);
        out.push({ i: out.length, key, text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30), r: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
      return out;
    })()`);
    for (const el of els) {
      const pad = 18;
      const rect = { x: Math.max(0, Math.floor(el.r.x - pad)), y: Math.max(0, Math.floor(el.r.y - pad)), width: Math.ceil(el.r.w + pad * 2), height: Math.ceil(el.r.h + pad * 2) };
      move(3, 3);
      await ctx.wait(350);
      const rest = await ctx.run(`(${STYLE})(document.querySelector('[data-look="${el.i}"]'))`);
      const imgRest = await wc.capturePage(rect);
      move(el.r.x + el.r.w / 2, el.r.y + el.r.h / 2);
      await ctx.wait(420);
      const hov = await ctx.run(`(() => { const e = document.querySelector('[data-look="${el.i}"]'); return { hover: e.matches(':hover'), s: (${STYLE})(e) }; })()`);
      const imgHov = await wc.capturePage(rect);
      const id = String(++n).padStart(3, '0');
      fs.writeFileSync(path.join(out, `${id}-${page}-a.png`), imgRest.toPNG());
      fs.writeFileSync(path.join(out, `${id}-${page}-b.png`), imgHov.toPNG());
      const diff = {};
      for (const k of Object.keys(rest)) if (rest[k] !== hov.s[k]) diff[k] = `${rest[k]} -> ${hov.s[k]}`;
      report.push({ id, page, key: el.key, text: el.text, hover: hov.hover, diff, rest });
    }
  }
  move(3, 3);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const r of report) console.log(`${r.id} [${r.page}] ${r.key} "${r.text}" hover=${r.hover} ${JSON.stringify(r.diff)} tr=${r.rest.tr}`);
  console.log(`\nErgebnis: ${report.length}/${report.length} Aufnahmen`);
  server.close();
};
