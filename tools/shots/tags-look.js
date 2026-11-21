// Tags wie in der Apple-App (JC_DEV=1, JC_FAKE_MPV=1): Karten, Banner und Detailseite in allen Designs. Geprueft: Reihenfolge und Hoechstzahl
// je Stelle, feste Farben (4K immer Gold, auch bei anderer Akzentfarbe), Aufbau (Flaeche, Kontur, Schrift, Schein als fertiges Bild ohne
// Weichzeichner), Masse (klein 17 px, normal 22 px), Lesbarkeit der Schrift, nichts abgeschnitten, Zeile der Detailseite einzeilig.
// Aufnahmen: SHOT_DIR/TG-*.png.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/tags-look.js
const path = require('node:path');
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
  ctx.win.setContentSize(1280, 760);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(100);
    }
    return false;
  };
  const go = async (hash, ready) => {
    await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
    if (ready) await waitFor(ready, 10000);
    await ctx.wait(700);
  };
  // Design und Akzentfarbe wie ein Nutzer: Kachel bzw. Farbfeld in Einstellungen > Erscheinungsbild
  const setTheme = async (theme, accent) => {
    await go('#/settings/appearance', `!!document.querySelector('[data-theme-id]')`);
    await ctx.run(`document.querySelector('[data-theme-id="${theme}"]')?.click()`);
    if (accent) await ctx.run(`document.querySelector('.swatch[data-color="${accent}"]')?.click()`);
    await ctx.wait(300);
  };

  // Was eine Stelle zeigt: je Tag Art, Text, Groesse, Farben und ob der Schein ein Bild ohne Weichzeichner ist
  const READ = (sel) => `(() => [...document.querySelectorAll(${JSON.stringify(sel)})].map((row) => {
    const r = row.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), tags: [...row.querySelectorAll('.tag')].filter((t) => !t.hidden).map((t) => {
      const cs = getComputedStyle(t), before = getComputedStyle(t, '::before'), b = t.getBoundingClientRect();
      return { kind: t.dataset.kind, text: t.textContent, hl: t.classList.contains('hl'), h: Math.round(b.height * 10) / 10, w: Math.round(b.width), color: cs.color, bg: cs.backgroundImage.slice(0, 40), blur: cs.backdropFilter, glow: before.borderImageSource.slice(0, 22), glowW: before.borderTopWidth, filter: before.filter, x: Math.round(b.left), right: Math.round(b.right) };
    }) };
  }))()`;

  await go('#/home', `document.querySelectorAll('.rows .card .tags').length > 0`);
  await waitFor(`!!document.querySelector('.hero-slide.active .tags')`, 8000);

  // ---------- Karten ----------
  const cards = await ctx.run(READ('.rows .card .tags'));
  const all = cards.flatMap((c) => c.tags);
  check('Karten: Tags vorhanden, hoechstens zwei je Karte', cards.length > 0 && cards.every((c) => c.tags.length >= 1 && c.tags.length <= 2), `${cards.length} Reihen von Tags`);
  check('Karten: kleine Groesse (17 px hoch)', all.every((t) => Math.abs(t.h - 17) < 0.6), [...new Set(all.map((t) => t.h))].join(', '));
  const uhd = all.find((t) => t.kind === 'uhd');
  check('Karten: 4K zuerst, in Gold mit fester Schrift (#fff0a3)', !!uhd && cards.filter((c) => c.tags.some((t) => t.kind === 'uhd')).every((c) => c.tags[0].kind === 'uhd') && uhd.color === 'rgb(255, 240, 163)', JSON.stringify(uhd));
  check('Karten: Kurzformen ("Atmos" statt "Dolby Atmos")', !all.some((t) => t.text === 'Dolby Atmos') && (all.some((t) => t.text === 'Atmos') || !all.some((t) => t.kind === 'atmos')));
  check('Karten: HD-Filme bekommen "HD" (neutral)', all.some((t) => t.text === 'HD' && !t.hl));
  check('Aufbau: hervorgehobene Tags mit Flaeche aus Verlaeufen, Schein als Bild (border-image), nie Weichzeichner', all.filter((t) => t.hl).every((t) => /gradient/.test(t.bg) && /^url\("data:image\/png/.test(t.glow) && t.blur === 'none' && t.filter === 'none'), JSON.stringify(all.find((t) => t.hl)));
  check('Neutrale Tags ohne Schein und ohne Weichzeichner', all.filter((t) => !t.hl).every((t) => t.glow === 'none' || t.glow === '') && all.every((t) => t.blur === 'none'));
  const clipped = await ctx.run(`(() => [...document.querySelectorAll('.rows .card .tags')].filter((row) => { const th = row.closest('.thumb').getBoundingClientRect(); return [...row.children].some((t) => { const b = t.getBoundingClientRect(); return b.left - 3.5 < th.left || b.right + 3.5 > th.right || b.bottom + 3.5 > th.bottom; }); }).length)()`);
  check('Karten: kein Tag samt Schein ragt aus dem Poster', clipped === 0, `${clipped} Reihen`);

  // ---------- Banner ----------
  const hero = await ctx.run(READ('.hero-slide.active .tags'));
  check('Banner: bis zu drei Tags, klein', hero.length === 1 && hero[0].tags.length >= 1 && hero[0].tags.length <= 3 && hero[0].tags.every((t) => Math.abs(t.h - 17) < 0.6), JSON.stringify(hero[0]?.tags.map((t) => t.text)));
  await ctx.capture(path.join(out, 'TG-home-midnight.png'));

  // ---------- Detailseite ----------
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const hd = [...items.values()].find((i) => i.Name === 'Paper Moons');
  await go(`#/item/${movie.Id}`, `!!document.querySelector('.detail-tags .tag')`);
  const settled = `!!document.querySelector('.detail-tags .tag[data-kind="directPlay"], .detail-tags .tag[data-kind="directStream"], .detail-tags .tag[data-kind="transcode"]') && ![...document.querySelectorAll('.detail-tags .tag')].some((t) => t.style.visibility === 'hidden')`;
  check('Detailseite: das Wiedergabe-Tag erscheint (der Server wird ohne Abspielen gefragt)', await waitFor(settled, 8000));
  const det = (await ctx.run(READ('.detail-tags .tags')))[0];
  check('Detailseite: normale Groesse (22 px), einzeilig', !!det && det.tags.every((t) => Math.abs(t.h - 22) < 0.6) && det.height <= 23, JSON.stringify(det && { h: det.height, hs: [...new Set(det.tags.map((t) => t.h))] }));
  check('Detailseite (4K, Dolby Vision, TrueHD Atmos 7.1): 4K, Dolby Vision, Dolby Atmos, Direct Play, dann HEVC und 7.1', JSON.stringify(det?.tags.map((t) => t.text)) === JSON.stringify(['4K', 'Dolby Vision', 'Dolby Atmos', 'Direct Play', 'HEVC', '7.1']), JSON.stringify(det?.tags.map((t) => t.text)));
  const calm = await ctx.run(`(() => { const t = document.querySelector('.detail-tags .tag[data-kind="directPlay"]'); const f = document.querySelector('.detail-tags .tag[data-kind="uhd"]'); return t && f ? { play: t.style.getPropertyValue('--oa'), file: f.style.getPropertyValue('--oa'), sameGlow: t.style.getPropertyValue('--glow') === f.style.getPropertyValue('--glow') } : null; })()`);
  check('Detailseite: das Wiedergabe-Tag leuchtet ruhiger (Kontur 70 %, schwaecherer Schein) als die Formate der Datei', !!calm && /\/ 0\.7\)/.test(calm.play) && /\/ 0\.95\)/.test(calm.file) && !calm.sameGlow, JSON.stringify(calm));
  check('Detailseite: hervorgehobene vor den neutralen', (() => { const i = det.tags.findIndex((t) => !t.hl); return i < 0 || det.tags.slice(i).every((t) => !t.hl); })());
  await ctx.capture(path.join(out, 'TG-detail-uhd.png'));
  // Andere Tonspur waehlen: das Ton-Tag folgt der Wahl (AC3 5.1 ist kein Premium-Ton)
  const switched = await ctx.run(`(async () => {
    const b = [...document.querySelectorAll('.detail-options .opt')].find((x) => /Ton|Audio/.test(x.textContent));
    if (!b) return 'kein Knopf';
    b.click();
    await new Promise((r) => setTimeout(r, 400));
    const item = [...document.querySelectorAll('.menu.open .menu-item')].find((x) => /Deutsch/.test(x.textContent));
    if (!item) return 'kein Eintrag';
    item.click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.detail-tags .tag')].filter((t) => !t.hidden).map((t) => t.textContent).join(',');
  })()`);
  check('Detailseite: andere Tonspur (AC3 5.1) -> kein Atmos mehr, dafuer AC3 und 5.1', /^4K,Dolby Vision,(Direct Play,|Direct Stream,|Transcoding,)?HEVC,AC3,5\.1$/.test(switched), switched);
  await go(`#/item/${hd.Id}`, `!!document.querySelector('.detail-tags .tag')`);
  await waitFor(settled, 8000);
  const det2 = (await ctx.run(READ('.detail-tags .tags')))[0];
  check('Detailseite HD-Film: Wiedergabe, dann neutrale Angaben (Direct Play, HD, H.264, AAC, Stereo)', JSON.stringify(det2?.tags.map((t) => t.text)) === JSON.stringify(['Direct Play', 'HD', 'H.264', 'AAC', 'Stereo']) && det2.tags.slice(1).every((t) => !t.hl), JSON.stringify(det2?.tags.map((t) => t.text)));
  await ctx.capture(path.join(out, 'TG-detail-hd.png'));

  // ---------- schmales Fenster: die hinteren Tags fallen weg, statt umzubrechen ----------
  await go(`#/item/${movie.Id}`, `!!document.querySelector('.detail-tags .tag')`);
  ctx.win.setContentSize(560, 760);
  await ctx.wait(900);
  const narrow = await ctx.run(`(() => { const row = document.querySelector('.detail-tags .tags'); if (!row) return null; const shown = [...row.children].filter((t) => !t.hidden); return { shown: shown.map((t) => t.textContent), all: row.children.length, fits: row.scrollWidth <= row.clientWidth + 1, h: Math.round(row.getBoundingClientRect().height) }; })()`);
  check('Schmal: Zeile bleibt einzeilig, passt, die ersten bleiben', !!narrow && narrow.fits && narrow.h <= 23 && narrow.shown[0] === '4K', JSON.stringify(narrow));
  ctx.win.setContentSize(1280, 760);
  await ctx.wait(700);

  // ---------- Designs und Akzentfarbe: die Tags bleiben gleich ----------
  const signature = async () => ctx.run(`[...document.querySelectorAll('.detail-tags .tag.hl')].map((t) => t.dataset.kind + ':' + getComputedStyle(t).color + ':' + t.style.getPropertyValue('--fa')).join('|')`);
  const base = await signature();
  let same = true;
  for (const theme of ['graphite', 'amoled', 'midnight']) {
    await setTheme(theme, theme === 'amoled' ? '#ff4d6d' : null);
    await go(`#/item/${movie.Id}`, `!!document.querySelector('.detail-tags .tag')`);
    if ((await signature()) !== base) same = false;
    await ctx.capture(path.join(out, `TG-detail-${theme}.png`));
  }
  await setTheme('midnight', '#f5f5f7');
  check('Feste Farben: in allen Designs und mit rosa-roter Akzentfarbe sehen die Tags gleich aus', same && !!base, base.slice(0, 120));

  const libHref = await ctx.run(`[...document.querySelectorAll('.nav-link')].map((a) => a.getAttribute('href')).find((h) => /library/.test(h ?? '')) ?? null`);
  if (libHref) {
    await go(libHref, `document.querySelectorAll('.grid .card .tags').length > 0`);
    await ctx.capture(path.join(out, 'TG-library.png'));
  }

  // ---------- Leistung: Schein-Bilder werden geteilt ----------
  await go('#/home', `document.querySelectorAll('.rows .card .tags').length > 0`);
  const images = await ctx.run(`new Set([...document.querySelectorAll('.tag.hl')].map((t) => t.style.getPropertyValue('--glow').slice(0, 400))).size`);
  const count = await ctx.run(`document.querySelectorAll('.tag.hl').length`);
  check('Leistung: je Art und Groesse ein Schein-Bild, nicht je Tag', images > 0 && images <= 12 && count > images, `${images} Bilder fuer ${count} Tags`);

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
