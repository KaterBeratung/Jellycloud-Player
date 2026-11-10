// Startseite: vor allem Neuzugaenge (Banner und Reihen) und Trailer im Banner (JC_DEV=1). Braucht Internet: der Trailer kommt von YouTube (Big Buck Bunny, frei lizenziert).
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/home-trailer.js     (JC_FAKE_MPV nicht noetig)
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
  const configure = async (trailer) => {
    ctx.config.updateSettings({ trailer });
    await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
    await ctx.wait(2200);
  };
  const home = async () => {
    await ctx.run(`location.hash = '#/search'`);
    await ctx.wait(400);
    await ctx.run(`location.hash = '#/home'`);
    await waitFor(`!!document.querySelector('.hero-slide.active')`, 10000);
  };
  const activeIndex = () => ctx.run(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active'))`);
  const mouse = (x, y) => ctx.run(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`);
  // wirksame Deckkraft: Deckkraft des Elements mal die aller Vorfahren
  const eff = async (sel) => Math.round((await ctx.run(`(() => { let e = document.querySelector('${sel}'), o = 1; while (e) { o *= +getComputedStyle(e).opacity; e = e.parentElement; } return o; })()`)) * 100) / 100;
  const shadeVar = (prop) => ctx.run(`getComputedStyle(document.querySelector('.hero-slide.active .hero-shade')).getPropertyValue('${prop}').trim()`);

  const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  const byNew = (a, b) => (a.DateCreated < b.DateCreated ? 1 : -1);
  const movies = [...items.values()].filter((i) => i.Type === 'Movie').sort(byNew);
  const shows = [...items.values()].filter((i) => i.Type === 'Series').sort(byNew);
  movies[0].RemoteTrailers = [{ Url: 'https://example.com/trailer' }, { Url: YT }];
  shows[0].RemoteTrailers = [{ Url: YT }];

  // Lautstaerke mitschreiben, die die Einbettung meldet
  await ctx.run(`(() => { window.__vol = null; window.addEventListener('message', (e) => { try { const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d?.info && ('volume' in d.info || 'muted' in d.info)) window.__vol = { ...(window.__vol ?? {}), ...('volume' in d.info ? { volume: d.info.volume } : {}), ...('muted' in d.info ? { muted: d.info.muted } : {}) }; } catch {} }); })()`);

  // Logos: der erste Film hat eins (Mock), dazu die neueste Serie und der zweite Film; die zweite Serie hat keins
  shows[0].ImageTags = { ...shows[0].ImageTags, Logo: 'logo0002' };
  movies[1].ImageTags = { ...movies[1].ImageTags, Logo: 'logo0003' };

  // ---------- 1. Inhalt: vor allem Neuzugaenge ----------
  await configure({ autoplay: false });
  await home();
  await ctx.wait(1500);
  const labels = await ctx.run(`[...document.querySelectorAll('.hero-slide .hero-label')].map((l) => l.textContent.trim())`);
  check('Banner: sechs Folien', labels.length === 6, String(labels.length));
  check('Banner: alle Folien sind Neuzugaenge ("Neu hinzugefügt"), nicht Weiterschauen oder Als Naechstes', labels.length > 0 && labels.every((l) => l === 'Neu hinzugefügt'), JSON.stringify(labels));
  const titles = await ctx.run(`[...document.querySelectorAll('.hero-slide')].map((s) => s.querySelector('.hero-title')?.textContent.trim() ?? s.querySelector('.hero-logo')?.alt ?? '')`);
  check(`Banner: die neuesten Titel, Filme und Serien abwechselnd (${movies[0].Name}, ${shows[0].Name}, ${movies[1].Name}, ${shows[1].Name} ...)`, titles[0] === movies[0].Name && titles[1] === shows[0].Name && titles[2] === movies[1].Name && titles[3] === shows[1].Name, JSON.stringify(titles));
  const kinds = await ctx.run(`[...document.querySelectorAll('.hero-slide')].map((s) => s.querySelector('.hero-logo') ? 'logo' : s.querySelector('.hero-title') ? 'text' : '?')`);
  check('Banner: wo es ein Logo gibt, steht das Logo statt des Titels als Text (Logo, Logo, Logo, dann Text fuer die Serie ohne Logo)', kinds.slice(0, 4).join('|') === 'logo|logo|logo|text', JSON.stringify(kinds));
  check('Banner: die Logos kommen aus der Abfrage der Neuzugaenge (Bilder der Art Logo, nicht nur Hintergrund und Poster)', await ctx.run(`[...document.querySelectorAll('.hero-logo')].every((i) => /\\/Logo\\?/.test(i.getAttribute('src') ?? ''))`));
  const rowTitles = await ctx.run(`[...document.querySelectorAll('.rows .row .row-head h2')].map((h) => h.textContent.trim())`);
  // Ganz unten steht die Reihe "Filme im Trend" (hier ohne Seerr der Hinweis zur Einrichtung), siehe home-trending.js
  check('Reihen: Weiterschauen ganz oben, danach die Neuzugaenge (Filme, Serien), Als Naechstes, Favoriten, ganz unten Filme im Trend', rowTitles.join('|') === 'Weiterschauen|Neu in Filme|Neu in Serien|Als Nächstes|Favoriten|Filme im Trend', JSON.stringify(rowTitles));
  const counts = await ctx.run(`[...document.querySelectorAll('.rows .row')].filter((r) => /^Neu in /.test(r.querySelector('.row-head h2')?.textContent.trim() ?? '')).slice(0, 2).map((r) => r.querySelectorAll('.card').length)`);
  check('Reihen: die Neuzugaenge zeigen bis zu 30 Eintraege (mehr als vorher 20)', counts[0] > 20 && counts[0] <= 30, JSON.stringify(counts));
  check('Aus: kein Trailer im Banner', await ctx.run(`!document.querySelector('.hero .trailer')`));
  await ctx.capture(path.join(out, 'H-01-startseite-neu.png'));

  // ---------- 2. Trailer im Banner ----------
  await configure({ autoplay: true, home: true, muted: true, delaySec: 0, quality: '720', focusSec: 0 });
  await home();
  const tHome = Date.now();
  check('Trailer im Banner: nach 0 s Verzoegerung erscheint der Rahmen in der aktiven Folie', await waitFor(`!!document.querySelector('.hero-slide.active .trailer iframe')`, 8000), `${Date.now() - tHome} ms`);
  const src = await ctx.run(`document.querySelector('.hero-slide.active .trailer iframe')?.getAttribute('src') ?? ''`);
  check('Einbettung ueber youtube-nocookie mit der richtigen Video-ID, stumm und mit Autoplay', /^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?/.test(src) && /mute=1/.test(src) && /autoplay=1/.test(src), src);
  check('Der Rahmen steckt hinter der Abdunklung des Banners (Reihenfolge Bild, Trailer, Abdunklung, Text)', await ctx.run(`(() => { const k = [...document.querySelector('.hero-slide.active').children].map((c) => c.className.split(' ')[0]); return k.indexOf('hero-bg') < k.indexOf('trailer') && k.indexOf('trailer') < k.indexOf('hero-shade') && k.indexOf('hero-shade') < k.indexOf('hero-content'); })()`));
  check('Trailer laeuft und blendet sich ueber das Bild ein', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 40000));
  const tOn = Date.now();
  check('Banner: Zoom gegen schwarze Balken (sichtbare Hoehe hoechstens 74 % der Bildhoehe) und harte Beschneidung der Trailer-Ebene am Banner', await ctx.run(`(() => { const f = document.querySelector('.hero-slide.active .trailer iframe').getBoundingClientRect(); const l = document.querySelector('.hero-slide.active .trailer').getBoundingClientRect(); const s = getComputedStyle(document.querySelector('.hero-slide.active .trailer')); const hs = getComputedStyle(document.querySelector('.hero')); return l.height / f.height <= 0.745 && s.clipPath !== 'none' && hs.clipPath !== 'none' && f.bottom > l.bottom && f.top < l.top; })()`));
  check('Ton-Knopf in der Knopfleiste des Banners (neben Abspielen und Details)', await waitFor(`!!document.querySelector('.hero-slide.active .hero-actions .trailer-ctl button')`, 3000));
  check('Standard-Lautstaerke 10 %: die Einbettung meldet sie', await waitFor(`window.__vol?.volume === 10`, 5000), JSON.stringify(await ctx.run('window.__vol')));
  check('Trailer-Einstellungen: Standard Start sofort (0 s), Lautstaerke 10 %', ctx.config.settings.trailer.delaySec === 0 && ctx.config.settings.trailer.volume === 10, JSON.stringify(ctx.config.settings.trailer));
  await ctx.wait(1400); // die Abdunklung blendet in 0,9 s ab
  check('Abdunklung ueber dem Trailer kaum noch da (links 36 % statt 62 %, oben 22 % statt 45 %, Mitte unten 14 % statt 30 %)', (await shadeVar('--hs-l')) === '36%' && (await shadeVar('--hs-t')) === '22%' && (await shadeVar('--hs-c')) === '14%', `${await shadeVar('--hs-l')} ${await shadeVar('--hs-t')} ${await shadeVar('--hs-c')}`);
  await ctx.wait(1100);
  await ctx.capture(path.join(out, 'H-02-banner-trailer.png'));
  // Das Banner bleibt stehen, solange der Trailer laeuft (sonst wechselte es nach 9 s)
  await ctx.wait(Math.max(0, 11000 - (Date.now() - tOn)));
  check('Das Banner bleibt auf der Folie, solange der Trailer laeuft (kein Wechsel nach 9 s)', (await activeIndex()) === 0, `Folie ${await activeIndex()}`);
  check('Waehrenddessen laeuft kein Zeitbalken an den Punkten', await ctx.run(`!document.querySelector('.hero-dots .dot.run')`));

  // Trailer zum Ende springen lassen: das Banner geht danach zur naechsten Folie, und die startet ihren eigenen Trailer
  await ctx.run(`document.querySelector('.hero-slide.active .trailer iframe').contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [592, true] }), '*')`);
  check('Nach dem Ende des Trailers geht das Banner zur naechsten Folie (Serie)', await waitFor(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active')) === 1`, 45000), `Folie ${await activeIndex()}`);
  check('Der Trailer der ersten Folie ist weg (kein zweiter Rahmen im Hintergrund)', await ctx.run(`document.querySelectorAll('.hero .trailer iframe').length <= 1 && !document.querySelectorAll('.hero-slide')[0].querySelector('.trailer')`));
  check('Die zweite Folie (Serie, Trailer ueber die Serie geholt) startet ihren Trailer', await waitFor(`!!document.querySelector('.hero-slide.active .trailer iframe')`, 10000));
  await ctx.capture(path.join(out, 'H-03-banner-zweite-folie.png'));

  // Punkt anklicken: der laufende Trailer endet, eine Folie ohne Trailer laeuft wieder mit dem normalen Zeitbalken
  await ctx.run(`document.querySelectorAll('.hero .dot')[2]?.click()`);
  await ctx.wait(1500);
  check('Punkt angeklickt: die gewaehlte Folie ist aktiv, der Trailer der vorigen ist weg', (await activeIndex()) === 2 && (await ctx.run(`document.querySelectorAll('.hero .trailer').length === 0`)));
  check('Folie ohne Trailer: der Zeitbalken laeuft wieder und das Banner wechselt nach etwa 9 s weiter', (await ctx.run(`!!document.querySelector('.hero-dots .dot.run')`)) && (await waitFor(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active')) === 3`, 12000)));

  // ---------- 3. Nichts verschwindet: auch mit "Text ausblenden nach" bleibt im Banner alles stehen (das gilt nur fuer die Detailseite) ----------
  await configure({ autoplay: true, home: true, muted: true, delaySec: 0, quality: '720', focusSec: 5 });
  await home();
  check('Trailer im Banner laeuft (Text ausblenden nach 5 s eingestellt)', await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 40000));
  await ctx.wait(9500); // laenger als die 5 s: auf der Detailseite waere der Text jetzt weg
  const shown = {};
  for (const [name, sel] of [['Label', '.hero-slide.active .hero-label'], ['Titel/Logo', '.hero-slide.active .hero-title, .hero-slide.active .hero-logo'], ['Angaben', '.hero-slide.active .hero-meta'], ['Beschreibung', '.hero-slide.active .hero-overview'], ['Abspielen', '.hero-slide.active .hero-actions .btn.primary'], ['Details', '.hero-slide.active .hero-actions .btn.glass'], ['Ton-Knopf', '.hero-slide.active .trailer-ctl button'], ['Punkte', '.hero-dots']]) shown[name] = await eff(sel);
  check('Banner: auch nach 9 s ohne Bedienung bleibt alles voll sichtbar (Label, Titel/Logo, Angaben, Beschreibung, Knoepfe, Ton-Knopf, Punkte)', Object.values(shown).every((v) => v === 1), JSON.stringify(shown));
  check('Banner: es gibt keinen "freien Blick" (kein tr-focus, die Abdunklung bleibt bei der Trailer-Stufe)', await ctx.run(`!document.querySelector('.tr-focus')`) && (await shadeVar('--hs-l')) === '36%', await shadeVar('--hs-l'));
  check('Banner: die Knoepfe lassen sich bedienen (kein pointer-events: none)', await ctx.run(`(() => { const r = document.querySelector('.hero-slide.active .hero-actions .btn.primary').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.btn.primary'); })()`));
  await ctx.capture(path.join(out, 'H-04-banner-nach-10s.png'));

  // ---------- 4. Aus und Wegnavigieren ----------
  await ctx.run(`location.hash = '#/search'`);
  await ctx.wait(1500);
  check('Beim Verlassen der Startseite endet der Trailer (kein Rahmen mehr, die Seite bleibt im Speicher des Routers)', await ctx.run(`!document.querySelector('iframe')`));
  await ctx.run(`location.hash = '#/home'`);
  check('Zurueck auf der Startseite (aus dem Speicher): das Banner startet den Trailer der aktiven Folie neu', await waitFor(`!!document.querySelector('.hero-slide.active .trailer iframe')`, 10000) && (await waitFor(`!!document.querySelector('.hero-slide.active .trailer.on')`, 40000)));
  await ctx.run(`location.hash = '#/search'`);
  await ctx.wait(1000);
  check('Wieder weg: der Rahmen ist erneut verschwunden', await ctx.run(`!document.querySelector('iframe')`));
  await configure({ autoplay: true, home: false, muted: true, delaySec: 0, quality: '720', focusSec: 0 });
  await home();
  await ctx.wait(3000);
  check('"Auch auf der Startseite" aus: kein Trailer im Banner, es wechselt wie gewohnt', await ctx.run(`!document.querySelector('.hero .trailer') && !!document.querySelector('.hero-dots .dot.run')`));
  check('...und wechselt nach etwa 9 s', await waitFor(`[...document.querySelectorAll('.hero-slide')].findIndex((s) => s.classList.contains('active')) === 1`, 10000));
  await configure({ autoplay: false, home: true });
  await home();
  await ctx.wait(2500);
  check('Trailer-Wiedergabe ganz aus: auch im Banner keiner', await ctx.run(`!document.querySelector('.hero .trailer')`));

  // ---------- 5. Einstellung ----------
  await configure({ autoplay: true, home: true });
  await ctx.run(`location.hash = '#/settings/behavior'`);
  await waitFor(`!!document.querySelector('.settings')`, 5000);
  await ctx.wait(600);
  const row = () => ctx.run(`(() => { const r = [...document.querySelectorAll('.setting')].find((s) => /Auch auf der Startseite/.test(s.textContent)); const sw = r?.querySelector('button.switch'); return r ? { on: !!sw?.classList.contains('on') } : null; })()`);
  const before = await row();
  check('Einstellungen > Trailer: "Auch auf der Startseite" ist vorhanden und an', !!before && before.on === true, JSON.stringify(before));
  await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => /Auch auf der Startseite/.test(s.textContent))?.scrollIntoView({ block: 'center' })`);
  await ctx.wait(300);
  await ctx.capture(path.join(out, 'H-05-einstellungen.png'));
  await ctx.run(`(() => { const r = [...document.querySelectorAll('.setting')].find((s) => /Auch auf der Startseite/.test(s.textContent)); r.querySelector('button.switch').click(); })()`);
  await ctx.wait(1200);
  check('Der Schalter wird gespeichert (Einstellung trailer.home)', ctx.config.settings.trailer.home === false, String(ctx.config.settings.trailer.home));

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
