// Automatische Trailer auf der Detailseite (JC_DEV=1). Braucht Internet: der Trailer kommt von YouTube (Big Buck Bunny, frei lizenziert).
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/trailer.js     (JC_FAKE_MPV nicht noetig)
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
  // Einstellungen im Hauptprozess aendern und die Oberflaeche neu starten lassen, damit sie sie liest
  const configure = async (trailer) => {
    ctx.config.updateSettings({ trailer });
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(2200);
  };
  const open = async (movie) => {
    await ctx.run(`location.hash = '#/home'`);
    await ctx.wait(600);
    await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  };
  const frameSrc = () => ctx.run(`document.querySelector('.trailer iframe')?.getAttribute('src') ?? ''`);

  const movie = [...items.values()].find((i) => i.Name === 'The Last Lighthouse');
  const noTrailer = [...items.values()].find((i) => i.Name === 'Neon Harbor');
  movie.RemoteTrailers = [{ Url: 'https://example.com/trailer' }, { Url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }];
  noTrailer.RemoteTrailers = [{ Url: 'https://example.com/nur-ein-link' }];

  // Qualitaetsstufen mitschreiben, die die Einbettung meldet
  await ctx.run(`(() => { window.__qs = []; window.__vol = null; window.addEventListener('message', (e) => { try { const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d?.info?.playbackQuality) __qs.push(d.info.playbackQuality); if (d?.info && ('volume' in d.info || 'muted' in d.info)) window.__vol = { ...(window.__vol ?? {}), ...('volume' in d.info ? { volume: d.info.volume } : {}), ...('muted' in d.info ? { muted: d.info.muted } : {}) }; } catch {} }); })()`);

  // ---------- 1. Stumm, mit Verzoegerung ----------
  await configure({ autoplay: true, muted: true, delaySec: 3, focusSec: 0 }); // ohne Ausblenden nach Ruhe: dieser Teil bedient die Seite nicht mit der Maus
  await open(movie);
  check('Detailseite geladen', await waitFor(`!!document.querySelector('.detail-title')`));
  const tTitle = Date.now();
  await ctx.wait(500);
  check('Verzoegerung 3 s: nach einer halben Sekunde noch kein Trailer-Rahmen', (await frameSrc()) === '');
  const gotFrame = await waitFor(`!!document.querySelector('.trailer iframe')`, 8000);
  const dtFrame = Date.now() - tTitle;
  check('Nach der Verzoegerung erscheint der Trailer-Rahmen (etwa 3 s nach der Seite)', gotFrame && dtFrame >= 2300 && dtFrame <= 6000, `${dtFrame} ms`);
  const src = await frameSrc();
  check('Einbettung ueber youtube-nocookie mit der richtigen Video-ID', /^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?/.test(src), src);
  check('Stumm gestartet (mute=1), Autoplay, Steuerung aus', /mute=1/.test(src) && /autoplay=1/.test(src) && /controls=0/.test(src));
  const attrs = await ctx.run(`(() => { const f = document.querySelector('.trailer iframe'); return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow') }; })()`);
  check('Rahmen ist eingeschraenkt (sandbox) und darf nur Autoplay', /allow-scripts/.test(attrs.sandbox) && !/allow-top-navigation|allow-popups|allow-forms/.test(attrs.sandbox) && /autoplay/.test(attrs.allow), JSON.stringify(attrs));

  // Laeuft er wirklich? Die Einbettung meldet den Zustand; dann blendet er ein
  const played = await waitFor(`!!document.querySelector('.trailer.on')`, 25000);
  check('Trailer laeuft und blendet sich ueber das Bild ein (Zustandsmeldung von YouTube)', played);
  const sizes = await ctx.run(`(() => { const f = document.querySelector('.trailer iframe'); const s = getComputedStyle(f); return { w: s.width, h: s.height, scale: +document.querySelector('.trailer').style.getPropertyValue('--tr-scale') }; })()`);
  check('Standard ist 4K: Rahmen hat feste 4K-Groesse (YouTube waehlt die Qualitaet nach der Playergroesse) und wird skaliert', sizes.w === '3840px' && sizes.h === '2160px' && sizes.scale > 0.15, JSON.stringify(sizes));
  check('Zoom gegen schwarze Balken: der sichtbare Ausschnitt ist hoechstens 74 % der Bildhoehe (Kino-Trailer mit Balken oben und unten zeigen keinen dunklen Streifen)', await ctx.run(`(() => { const f = document.querySelector('.trailer iframe').getBoundingClientRect(); const l = document.querySelector('.trailer').getBoundingClientRect(); return l.height / f.height <= 0.745; })()`));
  check('Der Trailer-Rahmen ragt ringsum ueber die Flaeche hinaus und wird hart beschnitten (clip-path und contain: paint an der Ebene)', await ctx.run(`(() => { const s = getComputedStyle(document.querySelector('.trailer')); return s.clipPath !== 'none' && /paint/.test(s.contain) && s.overflow === 'hidden'; })()`));
  const reached4k = await waitFor(`window.__qs.includes('hd2160')`, 30000);
  check('Qualitaet erreicht 4K (hd2160)', reached4k, JSON.stringify([...new Set(await ctx.run('window.__qs'))]));
  check('Eingeblendet wird erst bei guter Qualitaet (mindestens hd1080), nicht beim ersten (unscharfen) Bild', await ctx.run(`window.__qs.some((q) => ['hd1080', 'hd1440', 'hd2160', 'highres'].includes(q))`));
  await ctx.wait(1500);
  // Kein Nebel vor dem Trailer: die Abdunklung ueber dem Bild (Seitenfarbe links, Schleier oben und in der Mitte) ist mit dem laufenden Trailer fast ganz weg
  const fog = (prop) => ctx.run(`getComputedStyle(document.querySelector('.detail-bd-shade')).getPropertyValue('${prop}').trim()`);
  const fogNow = { l: await fog('--sh-l'), t: await fog('--sh-t'), m: await fog('--sh-m'), e: await fog('--sh-e') };
  check('Nebel: ueber dem laufenden Trailer ist die Abdunklung kaum noch da (links 26 % statt 82 %, oben und Mitte 0 %, unten erst im letzten Viertel)', fogNow.l === '26%' && fogNow.t === '0%' && fogNow.m === '0%' && fogNow.e === '100%', JSON.stringify(fogNow));
  check('Nebel: der dunkle Streifen links ist schwaecher als vorher (hoechstens 34 % Schwarz am Rand)', await ctx.run(`(() => { const g = getComputedStyle(document.querySelector('.detail-bd'), '::after').backgroundImage; const m = /rgba\\(0, 0, 0, ([\\d.]+)\\)/.exec(g); return !!m && +m[1] <= 0.34 && getComputedStyle(document.querySelector('.detail-bd'), '::after').opacity === '1'; })()`));
  await ctx.capture(path.join(out, 'T-01-trailer-playing.png'));
  // "Trailer ausblenden" steht im Menue "Mehr" (die Leiste soll nicht voll wirken)
  const hideViaMenu = async () => {
    await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
    await ctx.wait(300);
    const found = await ctx.run(`(() => { const b = [...document.querySelectorAll('.menu .menu-item')].find((x) => /Trailer ausblenden/.test(x.textContent)); b?.click(); return !!b; })()`);
    await ctx.wait(300);
    return found;
  };
  check('Nur ein Ton-Knopf in der Aktionsleiste (gleicher runder Glas-Knopf wie Gesehen/Favorit), kein eigener Ausblenden-Knopf', await ctx.run(`(() => { const c = document.querySelector('.trailer-ctl'); return !!c && !c.hidden && c.parentElement.classList.contains('detail-actions') && c.querySelectorAll('button').length === 1 && c.querySelectorAll('button.btn.icon.glass.lg').length === 1; })()`));
  check('Aktionsleiste ist schlank: hoechstens 6 Elemente (Abspielen, Trailer, Gesehen, Favorit, Mehr, Ton)', await ctx.run(`document.querySelectorAll('.detail-actions > *').length <= 6`), String(await ctx.run(`document.querySelectorAll('.detail-actions > *').length`)));
  check('Knoepfe liegen bei den anderen Aktionen, nicht frei im Bild (kein Ueberlappen mit der Kopfzeile)', await ctx.run(`(() => { const c = document.querySelector('.trailer-ctl').getBoundingClientRect(); const row = document.querySelector('.detail-actions').getBoundingClientRect(); const head = document.querySelector('.toolpill').getBoundingClientRect(); return c.top >= row.top - 1 && c.bottom <= row.bottom + 1 && c.top > head.bottom; })()`));
  check('Bereich links ist abgedunkelt, solange der Trailer laeuft (Lesbarkeit)', await waitFor(`getComputedStyle(document.querySelector('.detail-bd'), '::after').opacity === '1'`, 3000));
  await ctx.wait(1200);
  const gaps = await ctx.run(`(() => { const r = [...document.querySelectorAll('.detail-actions > *')].map((e) => e.getBoundingClientRect()); const bad = []; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (Math.min(r[i].right, r[j].right) - Math.max(r[i].left, r[j].left) > 1 && Math.min(r[i].bottom, r[j].bottom) - Math.max(r[i].top, r[j].top) > 1) bad.push(i + 'x' + j); return bad; })()`);
  check('Aktionsleiste ohne Ueberlappung', gaps.length === 0, JSON.stringify(gaps));
  const muteTitle = () => ctx.run(`document.querySelector('.trailer-ctl button')?.title ?? ''`);
  check('Ton-Knopf bietet "Ton an"', (await muteTitle()) === 'Ton an', await muteTitle());
  await ctx.run(`document.querySelector('.trailer-ctl button').click()`);
  await ctx.wait(300);
  check('Nach dem Klick bietet er "Ton aus"', (await muteTitle()) === 'Ton aus', await muteTitle());

  // Lautstaerke: Regler neben dem Ton-Knopf, Mausrad, Meldung der Einbettung, gespeicherter Wert
  const slide = (v) => ctx.run(`(() => { const i = document.querySelector('.trailer-ctl input[type=range]'); i.value = '${v}'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const inputVal = () => ctx.run(`+document.querySelector('.trailer-ctl input[type=range]')?.value`);
  check('Lautstaerkeregler sitzt in der Kapsel am Ton-Knopf und zeigt die Standard-Lautstaerke (10 %) bei Ton an', await ctx.run(`(() => { const s = document.querySelector('.trailer-ctl .tr-sound'); return !!s && s.querySelector('button') !== null && !!s.querySelector('.tr-pop input[type=range]'); })()`) && (await inputVal()) === 10, String(await inputVal()));
  // Hover mit echten Mausereignissen: die Kapsel waechst rechts aus dem Knopf heraus, nichts springt (Einzelheiten und Ausblenden: trailer-volume.js)
  const popOpacity = () => ctx.run(`+getComputedStyle(document.querySelector('.tr-pop')).opacity`);
  const rowBefore = await ctx.run(`JSON.stringify(document.querySelector('.detail-actions').getBoundingClientRect())`);
  const btnBox = await ctx.run(`(() => { const r = document.querySelector('.trailer-ctl button').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 700 });
  // Nach Klick, Mausrad oder Tasten bleibt die Kapsel noch bis zu 2,2 s offen und blendet dann von selbst aus
  check('Lautstaerkekapsel ist ohne Hover unsichtbar (blendet nach der Bedienung von selbst aus)', await waitFor(`getComputedStyle(document.querySelector('.tr-pop')).opacity === '0'`, 3500), String(await popOpacity()));
  ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: btnBox.x, y: btnBox.y });
  await ctx.wait(600);
  const hoverBox = await ctx.run(`(() => { const b = document.querySelector('.trailer-ctl button').getBoundingClientRect(); const r = document.querySelector('.tr-pop-in').getBoundingClientRect(); const i = document.querySelector('.tr-pop-in input').getBoundingClientRect(); return { opacity: +getComputedStyle(document.querySelector('.tr-pop')).opacity, rechts: r.right >= b.right + 110 && r.left <= b.left + 1 && i.left >= b.right - 10, inView: r.left >= 0 && r.right <= innerWidth }; })()`);
  check('Maus auf dem Ton-Knopf: die Lautstaerkekapsel waechst rechts aus dem Knopf heraus, im Bild', hoverBox.opacity === 1 && hoverBox.rechts && hoverBox.inView, JSON.stringify(hoverBox));
  await ctx.capture(path.join(out, 'T-05-volume-hover.png'));
  check('Die Aktionsleiste springt dabei nicht (die Kapsel liegt frei darueber)', (await ctx.run(`JSON.stringify(document.querySelector('.detail-actions').getBoundingClientRect())`)) === rowBefore);
  ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: btnBox.x + 90, y: btnBox.y }); // nach rechts auf den Regler: bleibt offen
  await ctx.wait(300);
  check('Mit der Maus nach rechts auf den Regler: bleibt offen', (await popOpacity()) === 1, String(await popOpacity()));
  ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 700 });
  await ctx.wait(1700);
  check('Maus weg: die Kapsel faehrt von selbst wieder ein', (await popOpacity()) === 0, String(await popOpacity()));
  await slide(40);
  check('Regler auf 40: die Einbettung meldet Lautstaerke 40, Ton an', await waitFor(`window.__vol?.volume === 40 && window.__vol?.muted === false`, 6000), JSON.stringify(await ctx.run('window.__vol')));
  await ctx.wait(500);
  check('...und der Wert wird gespeichert (Einstellung trailer.volume)', ctx.config.settings.trailer.volume === 40, String(ctx.config.settings.trailer.volume));
  await ctx.capture(path.join(out, 'T-03-trailer-volume.png'));
  await ctx.run(`document.querySelector('.trailer-ctl .tr-sound').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`);
  check('Mausrad nach oben: 45 %', (await waitFor(`window.__vol?.volume === 45`, 6000)) && (await inputVal()) === 45, JSON.stringify(await ctx.run('window.__vol')));
  await slide(0);
  check('Regler ganz links: stumm (Knopf bietet "Ton an", Einbettung meldet stumm)', (await waitFor(`window.__vol?.muted === true`, 6000)) && (await muteTitle()) === 'Ton an' && (await inputVal()) === 0, JSON.stringify(await ctx.run('window.__vol')));
  check('Stumm geschaltet ueber den Regler: der gespeicherte Wert bleibt (45), wird nicht 0', ctx.config.settings.trailer.volume === 45, String(ctx.config.settings.trailer.volume));
  await ctx.run(`document.querySelector('.trailer-ctl button').click()`);
  check('Knopf "Ton an": wieder 45 % und Ton an', (await waitFor(`window.__vol?.muted === false && window.__vol?.volume === 45`, 6000)) && (await inputVal()) === 45, JSON.stringify(await ctx.run('window.__vol')));
  check('Reglergruppe ueberlappt nichts in der Aktionsleiste', await ctx.run(`(() => { const r = [...document.querySelectorAll('.detail-actions > *')].map((e) => e.getBoundingClientRect()); const c = document.querySelector('.trailer-ctl').getBoundingClientRect(); const head = document.querySelector('.toolpill').getBoundingClientRect(); return r.every((x, i, a) => i === a.length - 1 || x.right <= a[a.length - 1].left + 1 || x.top >= 0) && c.right < innerWidth - 16 && c.top > head.bottom; })()`));

  // ---------- 2. Ausblenden und Wegnavigieren ----------
  check('Menue "Mehr" bietet "Trailer ausblenden" an', await hideViaMenu());
  check('Ausblenden entfernt Trailer und Ton-Knopf', (await frameSrc()) === '' && (await ctx.run(`!document.querySelector('.trailer-ctl')`)));
  await ctx.run(`document.querySelector('.detail-actions button[title="Mehr"]').click()`);
  await ctx.wait(300);
  check('Danach bietet das Menue "Mehr" kein "Trailer ausblenden" mehr an', await ctx.run(`![...document.querySelectorAll('.menu .menu-item')].some((x) => /Trailer ausblenden/.test(x.textContent))`));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await open(movie);
  await waitFor(`!!document.querySelector('.trailer iframe')`, 8000);
  await ctx.run(`location.hash = '#/home'`);
  await ctx.wait(800);
  check('Beim Verlassen der Seite ist der Trailer weg (kein Ton im Hintergrund)', await ctx.run(`!document.querySelector('.trailer, .trailer-ctl, iframe')`));

  // ---------- 3. Beginnt ein Film, endet der Trailer ----------
  await open(movie);
  await waitFor(`!!document.querySelector('.trailer iframe')`, 8000);
  await ctx.run(`document.documentElement.classList.add('playing')`);
  await ctx.wait(500);
  check('Beginnt die Wiedergabe (Klasse "playing"), wird der Trailer beendet', await ctx.run(`!document.querySelector('.trailer iframe')`));
  await ctx.run(`document.documentElement.classList.remove('playing')`);

  // ---------- 4. Mit Ton starten ----------
  await configure({ autoplay: true, muted: false, delaySec: 0 });
  await open(movie);
  check('Mit Ton: mute=0', await waitFor(`/mute=0/.test(document.querySelector('.trailer iframe')?.getAttribute('src') ?? '')`, 6000), await frameSrc());
  check('Ton-Knopf zeigt den Zustand "Ton aus" (Ton ist an)', (await muteTitle()) === 'Ton aus', await muteTitle());

  // ---------- 4b. Hoechststufe: Full HD und 720p begrenzen auch die Einbettung ----------
  for (const [quality, w, h, best, forbidden] of [
    ['1080', '1920px', '1080px', 'hd1080', ['hd1440', 'hd2160', 'highres']],
    ['720', '1280px', '720px', 'hd720', ['hd1080', 'hd1440', 'hd2160', 'highres']]
  ]) {
    await configure({ autoplay: true, muted: true, delaySec: 0, quality });
    await ctx.run(`window.__qs = []`);
    await open(movie);
    check(`Stufe ${quality}: Trailer-Rahmen erscheint`, await waitFor(`!!document.querySelector('.trailer iframe')`, 20000), await ctx.run(`document.visibilityState`));
    const sz = await ctx.run(`(() => { const f = document.querySelector('.trailer iframe'); if (!f) return {}; const s = getComputedStyle(f); return { w: s.width, h: s.height }; })()`);
    check(`Stufe ${quality}: Rahmengroesse ${w} x ${h}`, sz.w === w && sz.h === h, JSON.stringify(sz));
    const got = await waitFor(`window.__qs.includes('${best}')`, 30000);
    check(`Stufe ${quality}: erreicht ${best}`, got, JSON.stringify([...new Set(await ctx.run('window.__qs'))]));
    await ctx.wait(10000);
    const seen = [...new Set(await ctx.run('window.__qs'))];
    check(`Stufe ${quality}: geht nicht darueber hinaus (kein ${forbidden.join('/')})`, !seen.some((q) => forbidden.includes(q)), JSON.stringify(seen));
  }

  // ---------- 4c. Einstellung in der Oberflaeche ----------
  ctx.config.updateSettings({ trailer: { autoplay: true, muted: true, delaySec: 2, quality: '2160', volume: 100 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  await ctx.run(`location.hash = '#/settings/behavior'`);
  const segTexts = () => ctx.run(`(() => { const row = [...document.querySelectorAll('.setting')].find((s) => /Qualität/.test(s.querySelector('.setting-label, .label, h4, strong')?.textContent ?? s.firstElementChild?.textContent ?? '') && s.querySelector('[role="radiogroup"], .segmented, .seg')); return row ? [...row.querySelectorAll('button')].map((b) => b.textContent.trim() + (b.classList.contains('on') ? '*' : '')) : null; })()`);
  await waitFor(`!!document.querySelector('.settings')`, 5000);
  await ctx.wait(500);
  const seg0 = await segTexts();
  check('Einstellungen > Wiedergabe > Trailer: Qualitaet mit "Bis 4K", "Full HD", "720p", Standard Bis 4K', Array.isArray(seg0) && seg0.length === 3 && seg0[0] === 'Bis 4K*', JSON.stringify(seg0));
  await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => /Qualität/.test(s.textContent) && /Full HD/.test(s.textContent))?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(500);
  await ctx.capture(path.join(out, 'T-02-settings-quality.png'));
  await ctx.run(`(() => { const row = [...document.querySelectorAll('.setting')].find((s) => /Qualität/.test(s.textContent) && /Full HD/.test(s.textContent)); [...row.querySelectorAll('button')].find((b) => /Full HD/.test(b.textContent)).click(); })()`);
  await ctx.wait(1200);
  check('Auswahl "Full HD" wird gespeichert', ctx.config.settings.trailer.quality === '1080', ctx.config.settings.trailer.quality);
  const volRow = () => ctx.run(`(() => { const row = [...document.querySelectorAll('.setting')].find((s) => /Lautstärke/.test(s.textContent) && s.querySelector('input[type=range]')); return row ? { v: +row.querySelector('input').value, out: row.querySelector('output')?.textContent } : null; })()`);
  const vr = await volRow();
  check('Einstellungen > Trailer: Lautstaerke-Regler (5 bis 100 %), zeigt den gespeicherten Wert (hier gesetzt: 100 %)', !!vr && vr.v === 100 && vr.out === '100%', JSON.stringify(vr));

  // ---------- 4d. Trailer im Vordergrund: Poster, Titel und Angaben sinken nach einer Weile langsam ab und blenden aus ----------
  const opac = (sel) => ctx.run(`+getComputedStyle(document.querySelector('${sel}')).opacity`);
  // wirksame Deckkraft: Deckkraft des Elements mal die aller Vorfahren (die Knopfleiste blendet als Ganzes aus)
  const eff = async (sel) => Math.round((await ctx.run(`(() => { let e = document.querySelector('${sel}'), o = 1; while (e) { o *= +getComputedStyle(e).opacity; e = e.parentElement; } return o; })()`)) * 100) / 100;
  const shift = (sel) => ctx.run(`(() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('${sel}')).transform); return { x: Math.round(m.m41), y: Math.round(m.m42) }; })()`);
  const focused = () => ctx.run(`!!document.querySelector('.detail-bd.tr-focus')`);
  const mouse = (x, y) => ctx.run(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`);
  await configure({ autoplay: true, muted: true, delaySec: 0, quality: '720', focusSec: 5, focusStyle: 'poster' });
  await open(movie);
  check('Fokus: Trailer wird eingeblendet', await waitFor(`!!document.querySelector('.trailer.on')`, 30000));
  const tReveal = Date.now();
  await ctx.wait(1300); // die Einblend-Animation der Seite ist durch
  check('Fokus: kurz nach dem Einblenden sind Titel, Poster und Angaben voll da', (await eff('.detail-title')) === 1 && (await eff('.detail-poster')) === 1 && (await eff('.detail-actions button')) === 1 && !(await focused()));
  // Lage von Titel und Angaben zum Poster in Ruhe: beim Absinken muss sie gleich bleiben (ein Block)
  const relTo = (sel) => ctx.run(`(() => { const p = document.querySelector('.detail-poster').getBoundingClientRect(); const r = document.querySelector('${sel}').getBoundingClientRect(); return { dx: Math.round(r.left - p.left), dy: Math.round(r.top - p.top) }; })()`);
  const rest = { title: await relTo('.detail-title, .detail-logo'), meta: await relTo('.detail-meta'), actions: await relTo('.detail-actions') };
  check('Buehne: das Polster der Buehne verlaengert die Seite nicht (die Besetzung folgt gleich auf den Kopf)', await ctx.run(`(() => { const h = document.querySelector('.detail-head').getBoundingClientRect(); const n = document.querySelector('.detail-stage').nextElementSibling; return !n || n.getBoundingClientRect().top - h.bottom < 120; })()`));
  check('Buehne: in Ruhe liegt keine Maske auf dem Kopf, der Kopf ist bedienbar', await ctx.run(`getComputedStyle(document.querySelector('.detail-stage')).maskImage === 'none' && getComputedStyle(document.querySelector('.detail-head')).pointerEvents === 'auto' && getComputedStyle(document.querySelector('.detail-head')).transform === 'none'`));
  check('Fokus: nach 5 s ohne Bedienung setzt die Seite "tr-focus"', await waitFor(`!!document.querySelector('.detail-bd.tr-focus')`, 9000), `${Date.now() - tReveal} ms nach dem Einblenden`);
  const tFocus = Date.now();
  const dur = await ctx.run(`({ fade: getComputedStyle(document.querySelector('.detail-meta')).transitionDuration, tagline: getComputedStyle(document.querySelector('.detail-info > .tagline')).transitionDuration, slide: getComputedStyle(document.querySelector('.detail-head')).transitionDuration, edge: getComputedStyle(document.querySelector('.detail-stage')).transitionDuration, titleDelay: getComputedStyle(document.querySelector('.detail-title, .detail-logo')).transitionDelay, below: getComputedStyle(document.querySelector('.detail-body > :not(.detail-stage)')).transitionDuration })`);
  check('Fokus (wie bei Netflix): die Texte gehen schnell (Angaben 1,8 s, Zeile unter dem Titel 1,2 s), der Block sinkt in 4 s, die Kante in derselben Zeit, der Titel startet nach 1,4 s, alles darunter blendet in 1,8 s aus', dur.fade === '1.8s' && dur.tagline === '1.2s' && dur.slide === '4s' && /^4s, 4s$/.test(dur.edge) && dur.titleDelay === '1.4s' && dur.below === '1.8s', JSON.stringify(dur));
  await ctx.wait(Math.max(0, 400 - (Date.now() - tFocus)));
  const early = { title: await eff('.detail-title'), meta: await eff('.detail-meta'), poster: await eff('.detail-poster'), headY: (await shift('.detail-head')).y };
  check('Fokus: es geht gleich los, aber sanft (nach 0,4 s sind die Angaben schon teilweise weg, der Block kaum gerutscht)', early.meta > 0.2 && early.meta < 0.95 && early.headY < 60, JSON.stringify(early));
  await ctx.wait(Math.max(0, 1000 - (Date.now() - tFocus)));
  const half = { meta: await eff('.detail-meta'), title: await eff('.detail-title'), poster: await eff('.detail-poster'), y: (await shift('.detail-head')).y, titleY: (await shift('.detail-title')).y, posterY: (await shift('.detail-poster')).y, metaY: (await shift('.detail-meta')).y };
  check('Fokus: nach 1 s ist es unterwegs, nichts springt (Angaben fast weg, der Block rutscht nach unten, Poster und Titel bleiben voll sichtbar)', half.meta > 0.02 && half.meta < 0.5 && half.title === 1 && half.poster === 1 && half.y > 20, JSON.stringify(half));
  check('Fokus: es gleitet EIN Block (nur der Kopf bekommt eine Verschiebung, Poster und Angaben keine eigene; der Titel wartet noch)', half.posterY === 0 && half.metaY === 0 && half.titleY === 0, JSON.stringify(half));
  const mid = { title: await relTo('.detail-title, .detail-logo'), meta: await relTo('.detail-meta'), actions: await relTo('.detail-actions') };
  check('Fokus: mitten im Absinken liegen Angaben und Knoepfe noch genau so zum Poster wie vorher (nichts wandert gegeneinander)', JSON.stringify(mid.meta) === JSON.stringify(rest.meta) && JSON.stringify(mid.actions) === JSON.stringify(rest.actions) && mid.title.dx === rest.title.dx, `${JSON.stringify(rest)} -> ${JSON.stringify(mid)}`);
  await ctx.capture(path.join(out, 'T-04a-trailer-focus-mitte.png'));
  await ctx.wait(Math.max(0, 2200 - (Date.now() - tFocus)));
  const gone = { meta: await eff('.detail-meta'), overview: await eff('.detail-info > p:not(.tagline)'), play: await eff('.detail-actions button'), below: await eff('.detail-body > :not(.detail-stage)'), y: (await shift('.detail-head')).y };
  check('Fokus: nach 2,2 s sind alle Texte und alles unterhalb weg, waehrend das Poster noch sinkt (Netflix: erst die Texte, dann kommt der Rest zur Ruhe)', gone.meta === 0 && gone.overview === 0 && gone.play === 0 && gone.below === 0 && gone.y > 0, JSON.stringify(gone));
  await ctx.capture(path.join(out, 'T-04b-trailer-focus-spaeter.png'));
  await ctx.wait(Math.max(0, 3300 - (Date.now() - tFocus)));
  await ctx.capture(path.join(out, 'T-04c-trailer-focus-fast-am-ziel.png'));
  await ctx.wait(Math.max(0, 4500 - (Date.now() - tFocus)));
  const scale = await ctx.run(`new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.detail-title, .detail-logo')).transform).a`);
  check('Fokus: der Titel/das Logo ist am Ende kleiner geworden (rund 80 %), wie bei Netflix', scale > 0.75 && scale < 0.85, String(Math.round(scale * 100) / 100));
  const end = { title: await eff('.detail-title'), poster: await eff('.detail-poster'), meta: await eff('.detail-meta'), overview: await eff('.detail-info > p:not(.tagline)'), play: await eff('.detail-actions button'), sound: await eff('.trailer-ctl button'), options: await eff('.detail-options button') };
  check('Fokus: am Ende bleiben nur Poster und Titel/Logo stehen (voll sichtbar)', end.title === 1 && end.poster === 1, JSON.stringify(end));
  check('Fokus: Angaben, Beschreibung, Auswahl und Knoepfe (Abspielen, Ton) sind ganz weg', end.meta === 0 && end.overview === 0 && end.play === 0 && end.sound === 0 && end.options === 0, JSON.stringify(end));
  const sh = { head: await shift('.detail-head'), title: await shift('.detail-title'), poster: await shift('.detail-poster'), meta: await shift('.detail-meta') };
  check('Fokus: der Block ist ein Stueck nach unten gerutscht, nicht zur Seite', sh.head.y > 150 && sh.head.x === 0, JSON.stringify(sh));
  const fin = { title: await relTo('.detail-title, .detail-logo'), meta: await relTo('.detail-meta'), actions: await relTo('.detail-actions') };
  check('Fokus: am Ende liegen Angaben und Knoepfe noch genau so zum Poster wie vorher (ein Block), nur der Titel ist weiter nach unten gerutscht', JSON.stringify(fin.meta) === JSON.stringify(rest.meta) && JSON.stringify(fin.actions) === JSON.stringify(rest.actions) && fin.title.dx === rest.title.dx && fin.title.dy > rest.title.dy + 30, `${JSON.stringify(rest)} -> ${JSON.stringify(fin)}`);
  // Titel/Logo steht etwa in der Mitte des sichtbaren Posters (zwischen Oberkante des Posters und 78 % der Hoehe), und noch vor der Abschneidekante bei 76 %
  const tpos = await ctx.run(`(() => { const p = document.querySelector('.detail-poster').getBoundingClientRect(); const t = document.querySelector('.detail-title, .detail-logo').getBoundingClientRect(); const mid = (p.top + innerHeight * 0.78) / 2; return { offMid: Math.round(Math.abs((t.top + t.bottom) / 2 - mid)), bottom: Math.round(t.bottom / innerHeight * 100) / 100 }; })()`);
  check('Fokus: der Titel/das Logo steht etwa in der Mitte des sichtbaren Posters (hoechstens 20 Pixel daneben) und voll vor der Abschneidekante', tpos.offMid <= 20 && tpos.bottom <= 0.77, JSON.stringify(tpos));
  // der Streifen unten links, den der Nutzer markiert hat: Oberkante von Poster und Titel bei rund 60 % der Fensterhoehe, rechts bis etwa 63 % der Breite
  const zone = await ctx.run(`(() => { const p = document.querySelector('.detail-poster').getBoundingClientRect(); const t = document.querySelector('.detail-title, .detail-logo').getBoundingClientRect(); const s = getComputedStyle(document.querySelector('.detail-stage')); return { h: innerHeight, w: innerWidth, posterTop: p.top / innerHeight, titleTop: t.top / innerHeight, posterLeft: p.left / innerWidth, titleRight: t.right / innerWidth, ca: parseFloat(s.getPropertyValue('--tr-ca')) / innerHeight, cb: parseFloat(s.getPropertyValue('--tr-cb')) / innerHeight, mask: s.maskImage !== 'none' }; })()`);
  check('Fokus: Poster und Titel/Logo stehen im Streifen unten links (Oberkante des Posters bei 55 bis 68 % der Hoehe, Titel tiefer in der Mitte davon und rechts vom Poster, links am Seitenrand)', zone.posterTop > 0.55 && zone.posterTop < 0.68 && zone.titleTop > 0.55 && zone.titleTop < 0.78 && zone.posterLeft < 0.08 && zone.titleRight < 0.7, JSON.stringify(zone));
  check('Fokus: unten werden sie weich abgeschnitten (Kante bei 76 bis 84 % der Hoehe), das Poster ist zur Haelfte zu sehen', zone.mask && Math.abs(zone.ca - 0.76) < 0.01 && Math.abs(zone.cb - 0.84) < 0.01, JSON.stringify(zone));
  const posterVis = await ctx.run(`(() => { const p = document.querySelector('.detail-poster').getBoundingClientRect(); const visible = Math.max(0, Math.min(p.bottom, innerHeight * 0.84) - p.top); return Math.round(visible / p.height * 100) / 100; })()`);
  check('Fokus: vom Poster ist rund die Haelfte zu sehen (zwischen 30 und 65 %)', posterVis >= 0.3 && posterVis <= 0.65, String(posterVis));
  check('Fokus: die Abdunklung links ist weg (freier Blick auf den Trailer)', await waitFor(`getComputedStyle(document.querySelector('.detail-bd'), '::after').opacity === '0'`, 3000));
  check('Fokus: auch die Seitenfarbe links ist weg, nur der Uebergang unten in die Seite bleibt (ab 74 % der Hoehe)', (await fog('--sh-l')) === '0%' && (await fog('--sh-t')) === '0%' && (await fog('--sh-p')) === '74%' && (await fog('--sh-e')) === '100%', `${await fog('--sh-l')} ${await fog('--sh-p')}`);
  await ctx.capture(path.join(out, 'T-04-trailer-focus.png'));
  await mouse(300, 300); // erste Position: zaehlt nur als Bezugspunkt
  await mouse(302, 301); // Zittern unter 8 Pixeln: keine Bedienung
  await ctx.wait(300);
  check('Fokus: kleines Zittern der Maus (unter 8 Pixel) holt den Text nicht zurueck', await focused());
  await mouse(360, 340);
  check('Fokus: echte Mausbewegung bringt alles zurueck', await waitFor(`!document.querySelector('.detail-bd.tr-focus')`, 2000));
  check('Fokus: die Abschneidekante bleibt beim Zurueckkommen kurz (tr-focus-out) und wandert nach unten, das Poster taucht nicht ploetzlich ganz auf', await ctx.run(`!!document.querySelector('.detail-bd.tr-focus-out') && getComputedStyle(document.querySelector('.detail-stage')).maskImage !== 'none'`));
  await ctx.wait(1100);
  check('Fokus: danach ist die Maske weg (Glas-Unschaerfe der Knoepfe wirkt wieder)', await ctx.run(`getComputedStyle(document.querySelector('.detail-stage')).maskImage === 'none' && !document.querySelector('.detail-bd.tr-focus-out')`));
  const back = { title: await eff('.detail-title'), poster: await eff('.detail-poster'), meta: await eff('.detail-meta'), play: await eff('.detail-actions button'), sound: await eff('.trailer-ctl button'), below: await eff('.detail-body > :not(.detail-stage)'), y: (await shift('.detail-head')).y, titleScale: await ctx.run(`new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.detail-title, .detail-logo')).transform).a`) };
  check('Fokus: danach ist alles wieder voll da und am Platz, auch alles unterhalb und der Titel in voller Groesse (schneller zurueck als es ging)', back.title === 1 && back.poster === 1 && back.meta === 1 && back.play === 1 && back.sound === 1 && back.below === 1 && back.y === 0 && back.titleScale === 1, JSON.stringify(back));
  check('Fokus: die Knoepfe sind wieder bedienbar', await ctx.run(`(() => { const r = document.querySelector('.trailer-ctl').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.trailer-ctl'); })()`));
  check('Fokus: nach weiteren 5 s ohne Bedienung beginnt es wieder', await waitFor(`!!document.querySelector('.detail-bd.tr-focus')`, 9000));
  await ctx.wait(3000); // mitten im Ausblenden: Bedienung bringt es sofort wieder zurueck, ohne Sprung
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))`);
  check('Fokus: eine Taste bringt es auch mitten im Ausblenden zurueck', await waitFor(`!document.querySelector('.detail-bd.tr-focus')`, 2000));
  await ctx.wait(900);
  check('Fokus: ...und alles ist wieder voll da', (await eff('.detail-title')) === 1 && (await eff('.detail-meta')) === 1 && (await shift('.detail-head')).y === 0);
  await hideViaMenu();
  await ctx.wait(700);
  check('Fokus: Trailer ausblenden entfernt "tr-focus" und alle Angaben bleiben sichtbar', !(await focused()) && (await opac('.detail-title')) === 1);
  await configure({ autoplay: true, muted: true, delaySec: 0, quality: '720', focusSec: 0 });
  await open(movie);
  await waitFor(`!!document.querySelector('.trailer.on')`, 30000);
  await ctx.wait(7000);
  check('Fokus aus (0): auch nach 7 s bleibt der Text stehen', !(await focused()) && (await opac('.detail-title')) === 1);
  await hideViaMenu();
  const fr = async () => ctx.run(`(() => { const row = [...document.querySelectorAll('.setting')].find((s) => /Text ausblenden/.test(s.textContent) && s.querySelector('input[type=range]')); return row ? { v: +row.querySelector('input').value, out: row.querySelector('output')?.textContent } : null; })()`);
  ctx.config.updateSettings({ trailer: { focusSec: 10, delaySec: 8 } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  await ctx.run(`location.hash = '#/settings/behavior'`);
  await waitFor(`!!document.querySelector('.settings')`, 5000);
  await ctx.wait(500);
  const fv = await fr();
  check('Einstellungen > Trailer: Regler "Text ausblenden nach" (0 bis 60 s), Standard 10 s', !!fv && fv.v === 10 && fv.out === '10 s', JSON.stringify(fv));
  const dv = await ctx.run(`(() => { const row = [...document.querySelectorAll('.setting')].find((s) => /Verzögerung/.test(s.textContent) && s.querySelector('input[type=range]')); return row ? { v: +row.querySelector('input').value, out: row.querySelector('output')?.textContent } : null; })()`);
  check('Einstellungen > Trailer: Verzoegerung, zeigt den gespeicherten Wert (hier gesetzt: 8 s)', !!dv && dv.v === 8 && dv.out === '8 s', JSON.stringify(dv));

  // ---------- 5. Aus, und Eintraege ohne YouTube-Trailer ----------
  await configure({ autoplay: false, muted: true, delaySec: 0 });
  await open(movie);
  await ctx.wait(2500);
  check('Automatische Wiedergabe aus: kein Trailer-Rahmen', (await frameSrc()) === '' && (await ctx.run(`!document.querySelector('.trailer')`)));
  await configure({ autoplay: true, muted: true, delaySec: 0 });
  await open(noTrailer);
  await ctx.wait(2500);
  check('Ohne YouTube-Link (nur anderer Link): kein Trailer', await ctx.run(`!document.querySelector('.trailer, .trailer-ctl')`));
  check('Der "Trailer"-Knopf (extern oeffnen) bleibt davon unberuehrt', await ctx.run(`!!document.querySelector('.detail-actions') && [...document.querySelectorAll('.detail-actions button')].some((b) => /Trailer/.test(b.innerText))`));

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
