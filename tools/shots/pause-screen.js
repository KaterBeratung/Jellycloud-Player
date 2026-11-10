// Pausenbildschirm im Player (JC_DEV=1, JC_FAKE_MPV=1): nach einigen Sekunden Pause ohne Bedienung blendet der Player Logo (sonst Titel), Angaben,
// Beschreibung, Fortschritt und "Endet um ..." ein; jede Regung blendet ihn aus; Menues, Info, Puffern und Weiterspielen verhindern ihn.
// Aufnahmen mit einem Ersatz-Hintergrund (das Overlay ist durchsichtig, das Video liegt in einem eigenen Fenster).
const path = require('node:path');
const { server, items, state } = require('../mock-server');

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
  const player = ctx.player;
  const errors = [];
  const ev = (js) => player.overlay.webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const shown = () => ev(`(() => { const p = document.querySelector('.pause'); return !!p && !p.hidden && p.classList.contains('in'); })()`);
  const uiOn = () => ev(`document.getElementById('ui').classList.contains('ui-on')`);
  const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);
  const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
  const togglePause = () => ev(`window.player.send({ type: 'pause' })`);
  const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  const move = (dx = 6, dy = 4) => ev(`window.dispatchEvent(new PointerEvent('pointermove', { movementX: ${dx}, movementY: ${dy}, clientX: 300, clientY: 300, bubbles: true }))`);
  const stillAt = (ms) => ctx.wait(ms);
  const play = async (item) => {
    await ctx.run(`window.jc.play({ itemId: '${item.Id}', resume: false, startTicks: 0 })`);
    const ok = await waitFor(() => player.state.phase === 'playing');
    if (ok) player.overlay.webContents.on('console-message', (e) => (e.level === 'error' || e.level === 'warning' || e.level >= 2) && errors.push(`[${e.level}] ${e.message}`));
    await ctx.wait(500);
    return ok;
  };
  const stop = async () => {
    await ev(`window.player.send({ type: 'close' })`);
    await waitFor(() => !player.mpv && !player.overlay);
    await ctx.wait(400);
  };
  /** Pausieren und warten, bis der Pausenbildschirm da ist. Liefert die Wartezeit in ms oder null. */
  const pauseAndWait = async (ms = 7000) => {
    const t0 = Date.now();
    await togglePause();
    await waitFor(() => player.state.paused === true, 3000);
    const ok = await waitFor(shown, ms);
    return ok ? Date.now() - t0 : null;
  };
  const withBackdrop = async (fn) => {
    // Ersatz fuer das Video: ein heller Verlauf in einer eigenen Ebene hinter der Oberflaeche (nur fuer die Aufnahme)
    await ev(`(() => { const d = document.createElement('div'); d.id = 'fake-video'; Object.assign(d.style, { position: 'absolute', inset: '0', zIndex: '-1', background: 'radial-gradient(60% 70% at 78% 30%, #ffe6a8 0%, #f0b35a 35%, transparent 70%), linear-gradient(120deg, #1d4e89 0%, #8a3b6e 52%, #f0b35a 100%)' }); document.body.prepend(d); })()`);
    await ctx.wait(250);
    await fn();
    await ev(`document.getElementById('fake-video')?.remove()`);
  };
  const layout = () =>
    ev(`(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) }; };
      const card = document.querySelector('.pause-card');
      // Ausgeblendete Teile (display: none, etwa die Genres in kleinen Fenstern) haben keine Ausdehnung und zaehlen nicht
      const kids = [...card.children].filter((c) => c.offsetHeight > 0).map((c) => ({ cls: c.className, ...r(c) }));
      return { vw: innerWidth, vh: innerHeight, card: r(card), kids, go: r(document.querySelector('.pause-go')) };
    })()`);

  ctx.config.updateSettings({ player: { pauseScreen: true, pauseScreenSec: 2, volume: 10 } });
  const movies = [...items.values()].filter((i) => i.Type === 'Movie');
  const withLogo = movies.find((i) => i.ImageTags?.Logo);
  const noLogo = movies.find((i) => !i.ImageTags?.Logo);
  const episode = [...items.values()].find((i) => i.Type === 'Episode');
  ctx.win.setContentSize(1500, 900);
  await ctx.wait(500);

  // ---------- 1. Film mit Logo ----------
  check('Wiedergabe startet (Film mit Logo)', await play(withLogo));
  check('Beim Abspielen ist nichts vom Pausenbildschirm da', !(await shown()) && (await ev(`document.querySelector('.pause').hidden`)));
  await ctx.wait(3500); // ein Stueck laufen lassen: der Fortschritt soll nicht bei 0 stehen
  await togglePause();
  await waitFor(() => player.state.paused === true, 3000);
  const pausedAt = Date.now();
  await stillAt(900);
  check('Kurz nach dem Anhalten: Bedienung sichtbar, Pausenbildschirm noch nicht', (await uiOn()) && !(await shown()));
  check('...er erscheint nach der eingestellten Wartezeit (2 s)', await waitFor(shown, 5000));
  const appear = Date.now() - pausedAt;
  check('...nicht vor 1,6 s und nicht nach 3,8 s', appear >= 1600 && appear <= 3800, `${appear} ms`);
  await ctx.wait(1700); // Einblendanimation fertig
  check('Beschriftung "Pausiert"', (await text('.pause-tag')) === 'Pausiert', await text('.pause-tag'));
  const logoSrc = await ev(`document.querySelector('.pause-logo')?.getAttribute('src') ?? ''`);
  check('Logo des Films wird gezeigt (Adresse ueber jellycloud://, mit Kennung des Films)', logoSrc.startsWith(`jellycloud://img/${withLogo.Id}/Logo?`), logoSrc);
  check('...und ist geladen (Bild hat Groesse)', await ev(`(() => { const i = document.querySelector('.pause-logo'); return !!i && i.complete && i.naturalWidth > 0; })()`));
  check('...kein Titeltext daneben', !(await exists('.pause-title')));
  check('Angaben: Jahr, Altersfreigabe, Bewertung und Laufzeit', await ev(`(() => { const m = document.querySelector('.pause-meta')?.textContent ?? ''; return m.includes(${JSON.stringify(String(withLogo.ProductionYear))}) && m.includes(${JSON.stringify(withLogo.OfficialRating)}) && /\\d\\.\\d/.test(m) && /(Std\\.|Min\\.)/.test(m); })()`), await text('.pause-meta'));
  check('Beschreibung des Films', (await text('.pause-ov')) === withLogo.Overview.replace(/\s+/g, ' ').trim(), (await text('.pause-ov')).slice(0, 60));
  check('Genres (hoechstens drei)', (await text('.pause-genres')) === withLogo.Genres.slice(0, 3).join(' · '), await text('.pause-genres'));
  const endsText = await text('.pause-times .b b');
  const leftText = await text('.pause-times .b span');
  const m = /^Endet um (\d\d):(\d\d)$/.exec(endsText);
  const left = (player.state.duration - player.state.position) / (player.state.speed || 1);
  const expected = new Date(Date.now() + left * 1000);
  const diffMin = m ? Math.abs((+m[1] * 60 + +m[2]) - (expected.getHours() * 60 + expected.getMinutes())) : 999;
  check('"Endet um HH:MM" stimmt mit Dauer und Position ueberein (hoechstens 1 Minute Abweichung)', !!m && Math.min(diffMin, 1440 - diffMin) <= 1, `${endsText} gegen ${expected.getHours()}:${String(expected.getMinutes()).padStart(2, '0')}`);
  check('Restzeit "noch ..."', /^noch (\d+ Std\. )?(\d+ Min\.)?$/.test(leftText) || /weniger/.test(leftText), leftText);
  const frac = await ev(`parseFloat(document.querySelector('.pause-bar i').style.width) / 100`);
  const want = player.state.position / player.state.duration;
  check('Fortschrittsbalken passt zur Position', Math.abs(frac - want) < 0.03, `${(frac * 100).toFixed(1)} % gegen ${(want * 100).toFixed(1)} %`);
  check('Kapitelzeile', /^Kapitel \d+$/.test(await text('.pause-chapter')), await text('.pause-chapter'));
  check('Knopf "Weiter" und Hinweis "Leertaste"', (await text('.pause-go')) === 'Weiter' && (await text('.pause-hint')) === 'Leertaste');
  check('Waehrend er steht, sind Leiste und Kopf weg (Deckkraft 0, keine Klicks)', await ev(`(() => { const b = getComputedStyle(document.querySelector('.bar')); const t = getComputedStyle(document.querySelector('.top')); return b.opacity === '0' && t.opacity === '0' && b.pointerEvents === 'none'; })()`));
  await withBackdrop(async () => {
    await ctx.capture(path.join(out, 'P-01-pause-film-1500.png'), player.overlay);
  });

  // ---------- 2. Regung blendet aus, Stillstand bringt ihn zurueck ----------
  await ev(`window.dispatchEvent(new PointerEvent('pointermove', { movementX: 0, movementY: 0, clientX: 300, clientY: 300, bubbles: true }))`);
  await stillAt(300);
  check('Mausereignis ohne Bewegung zaehlt nicht (Pausenbildschirm bleibt)', await shown());
  await move();
  check('Mausbewegung blendet ihn aus', await waitFor(async () => !(await shown()), 1500));
  check('...und die Bedienung ist wieder da', await waitFor(uiOn, 1500));
  await ctx.wait(800); // Ausblenden fertig: das Element ist wieder versteckt
  check('...nach dem Ausblenden ist die Ebene versteckt', await ev(`document.querySelector('.pause').hidden`));
  check('Nach 2 s ohne Regung kommt er wieder', await waitFor(shown, 5000));
  await ctx.wait(500);
  await key('ArrowRight');
  check('Eine Taste (Spulen) blendet ihn aus', await waitFor(async () => !(await shown()), 1500));
  check('...die Position wurde veraendert, der Film bleibt pausiert', player.state.paused === true);
  check('...und er kommt danach wieder', await waitFor(shown, 5000));
  await ev(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))`);
  check('Mausrad blendet ihn aus und holt die Bedienung zurueck', (await waitFor(async () => !(await shown()), 1500)) && (await waitFor(uiOn, 1500)));

  // ---------- 3. Weiterspielen ----------
  await waitFor(shown, 5000);
  await ctx.wait(1500);
  await ev(`document.querySelector('.pause-go').click()`);
  check('Knopf "Weiter" setzt die Wiedergabe fort (nur einmal umgeschaltet)', await waitFor(() => player.state.paused === false, 3000));
  await ctx.wait(900);
  check('...und der Pausenbildschirm ist weg, der Film laeuft weiter', !(await shown()) && player.state.paused === false);
  await togglePause();
  await waitFor(shown, 6000);
  await ctx.wait(400);
  await key(' ');
  check('Leertaste setzt ebenfalls fort', await waitFor(() => player.state.paused === false, 3000) && (await waitFor(async () => !(await shown()), 1500)));

  // ---------- 4. Menues, Info und Puffern verhindern ihn ----------
  await togglePause();
  await waitFor(() => player.state.paused === true, 3000);
  await ev(`document.querySelector('.ibtn[title="Audio & Untertitel"]').click()`);
  await ctx.wait(3500);
  check('Bei offenem Menue (Audio und Untertitel) erscheint er nicht', !(await shown()) && (await exists('.pop.open')));
  await key('Escape');
  await ctx.wait(300);
  check('...nach dem Schliessen des Menues erscheint er', await waitFor(shown, 6000));
  await move();
  await waitFor(async () => !(await shown()), 1500);
  await key('i');
  await ctx.wait(3500);
  check('Bei offener Technik-Info erscheint er nicht', !(await shown()) && (await exists('.info:not([hidden])')));
  await key('i');
  await ctx.wait(500);
  check('...nach dem Schliessen der Info erscheint er', await waitFor(shown, 6000));
  await move();
  await waitFor(async () => !(await shown()), 1500);
  await togglePause();
  await waitFor(() => player.state.paused === false, 3000);
  await ctx.wait(300);

  // ---------- 5. Fenstergroessen ----------
  await togglePause();
  await waitFor(shown, 7000);
  await ctx.wait(1700);
  for (const [w, h] of [[1500, 900], [1280, 720], [920, 620]]) {
    ctx.win.setContentSize(w, h);
    await ctx.wait(900);
    const l = await layout();
    const inside = l.card.l >= 0 && l.card.r <= l.vw && l.card.t >= 0 && l.card.b <= l.vh + 1;
    let overlap = null;
    for (let i = 1; i < l.kids.length; i++) if (l.kids[i].t < l.kids[i - 1].b - 1) overlap = `${l.kids[i - 1].cls} / ${l.kids[i].cls}`;
    check(`[${w}x${h}] Karte liegt im Fenster, Knopf sichtbar`, inside && l.go.b <= l.vh - 8, JSON.stringify({ vw: l.vw, vh: l.vh, card: l.card, go: l.go }));
    check(`[${w}x${h}] nichts ueberlappt sich`, overlap === null, overlap ?? `${l.kids.length} Teile`);
    await withBackdrop(async () => {
      await ctx.capture(path.join(out, `P-02-pause-${w}x${h}.png`), player.overlay);
    });
  }
  ctx.win.setContentSize(1500, 900);
  await ctx.wait(500);
  await stop();

  // ---------- 6. Film ohne Logo: Titel als Text ----------
  check('Wiedergabe startet (Film ohne Logo)', await play(noLogo));
  check('Pausenbildschirm erscheint', (await pauseAndWait()) !== null);
  check('Ohne Logo steht der Titel als Text da', (await text('.pause-title')) === noLogo.Name && !(await exists('.pause-logo')), await text('.pause-title'));
  await ctx.wait(1500);
  await withBackdrop(async () => {
    await ctx.capture(path.join(out, 'P-03-pause-ohne-logo.png'), player.overlay);
  });
  await stop();

  // ---------- 7. Folge: Serienlogo fehlt (Bild nicht ladbar) -> Titel, Staffel/Folge, Spoiler-Schutz ----------
  episode.ParentLogoItemId = 'a'.repeat(32); // gibt es nicht: der Server antwortet 404
  episode.ParentLogoImageTag = 'zz';
  state.played.delete(episode.Id); // der Mock rechnet "gesehen" aus seinem Stand: diese Folge gilt als ungesehen
  ctx.config.updateSettings({ general: { spoilerProtection: false } });
  check('Wiedergabe startet (Folge)', await play(episode));
  check('Pausenbildschirm erscheint', (await pauseAndWait()) !== null);
  await ctx.wait(1500);
  check('Folge: Serientitel als Rueckfall, wenn das Logo nicht laedt', (await text('.pause-title')) === episode.SeriesName && !(await exists('.pause-logo')), await text('.pause-title'));
  check('Folge: "Staffel n · Folge m" und Folgentitel', (await text('.pause-ep .k')) === `Staffel ${episode.ParentIndexNumber} · Folge ${episode.IndexNumber}` && (await text('.pause-ep .n')) === episode.Name, `${await text('.pause-ep .k')} / ${await text('.pause-ep .n')}`);
  check('Folge: Beschreibung der Folge', (await text('.pause-ov')).length > 20, (await text('.pause-ov')).slice(0, 40));
  await withBackdrop(async () => {
    await ctx.capture(path.join(out, 'P-04-pause-folge.png'), player.overlay);
  });
  await stop();
  ctx.config.updateSettings({ general: { spoilerProtection: true } });
  check('Wiedergabe startet (ungesehene Folge, Spoiler-Schutz an)', await play(episode));
  check('Pausenbildschirm erscheint', (await pauseAndWait()) !== null);
  check('Spoiler-Schutz: keine Beschreibung der ungesehenen Folge', !(await exists('.pause-ov')));
  await stop();
  ctx.config.updateSettings({ general: { spoilerProtection: false } });

  // ---------- 8. Abgeschaltet ----------
  ctx.config.updateSettings({ player: { pauseScreen: false } });
  check('Wiedergabe startet (Pausenbildschirm aus)', await play(withLogo));
  await togglePause();
  await waitFor(() => player.state.paused === true, 3000);
  await ctx.wait(4500);
  check('Ausgeschaltet in den Einstellungen: er erscheint nie', !(await shown()) && (await uiOn()));
  await stop();
  ctx.config.updateSettings({ player: { pauseScreen: true, pauseScreenSec: 3 } });
  check('Wiedergabe startet (3 s)', await play(withLogo));
  const t3 = await pauseAndWait(9000);
  check('Wartezeit 3 s: erscheint nach 3 bis 4,8 s', t3 !== null && t3 >= 2700 && t3 <= 4800, `${t3} ms`);
  await stop();

  check('Konsole des Players ohne Fehler und Warnungen', errors.length === 0, errors.slice(0, 3).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
