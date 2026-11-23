// Heimnetz und Grenze des Servers (JC_DEV=1, JC_FAKE_MPV=1; Plan P21): im Heimnetz keine eigene Grenze und keine Abfrage der Grenzen, ueber das Internet
//   nie mehr als die Grenze des Servers, die die App selbst anwendet; "Automatisch" misst dort die Bandbreite. Anzeige in den Einstellungen (Netzwerk),
//   Technik-Info und Qualitaetsmenue im Player. Der Testserver laeuft unter 127.0.0.1 (private Adresse): seine Einstufung (state.limits.local) entscheidet.
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
  // Die Messung der Bandbreite gegen den Testserver: hoechstens 200 Mbit/s (so liegt "Automatisch" ueber das Internet sicher ueber der Datei mit 52 Mbit/s,
  // und das Ergebnis haengt nicht davon ab, wie schnell die Schleife des Rechners gerade ist)
  process.env.MOCK_BITRATE_MBPS = '200';
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  const player = ctx.player;
  const ev = (js) => player.overlay.webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const page = (js) => ctx.run(js);
  const limitText = () => page(`document.querySelector('.limit-text')?.textContent ?? ''`);
  const setLimits = (patch) => Object.assign(state.limits, { local: true, user: 0, server: 0, serverForbidden: false, endpointMissing: false, meMissing: false }, patch);
  const calls = () => state.log.map((l) => l.at).filter((a) => ['/System/Endpoint', '/Users/Me', '/System/Configuration'].includes(a));
  const infos = () => state.log.filter((l) => l.at === 'PlaybackInfo');
  const bitrateTests = () => state.log.filter((l) => l.at === 'BitrateTest');
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol'); // 52 Mbit/s
  const play = async () => {
    state.log.length = 0;
    await page(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
    return waitFor(() => player.state.phase === 'playing');
  };
  const stop = async () => {
    await ev(`window.player.send({ type: 'close' })`);
    await waitFor(() => !player.mpv && !player.overlay);
    await ctx.wait(300);
  };
  const check_ = async () => {
    await page(`document.querySelector('.limit-text')?.closest('.setting')?.querySelector('button')?.click()`);
    await ctx.wait(700);
  };
  const qualityRows = async () => {
    await ev(`document.querySelector('.cluster .ibtn[title="Qualität"]').click()`);
    await ctx.wait(500);
    return ev(`[...document.querySelectorAll('.pop .opt')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
  };

  // ---------- Einstellungen: Heimnetz ----------
  await page(`location.hash = '#/settings/network'`);
  await waitFor(async () => (await limitText()) !== '…' && (await limitText()) !== '', 5000);
  setLimits({ local: true, user: 8_000_000, server: 20_000_000 });
  state.log.length = 0;
  await check_();
  check('Heimnetz: Anzeige "keine Begrenzung"', /Heimnetz: keine Begrenzung/.test(await limitText()), await limitText());
  check('...und es bleibt bei der einen kleinen Anfrage (keine Abfrage der Grenzen)', JSON.stringify(calls()) === JSON.stringify(['/System/Endpoint']), JSON.stringify(calls()));
  const opts = await page(`(() => { const b = [...document.querySelectorAll('.setting')].find((s) => s.querySelector('.setting-label')?.textContent === 'Bitratengrenze'); return b ? b.querySelector('button')?.textContent.trim() : null; })()`);
  check('Einstellung heisst "Bitratengrenze", Standard "Automatisch"', opts === 'Automatisch', String(opts));

  // ---------- Einstellungen: Internet ----------
  setLimits({ local: false, user: 8_000_000, server: 20_000_000 });
  state.log.length = 0;
  await check_();
  check('Internet: die Grenze des Kontos gilt, beide werden genannt', /Internet: begrenzt auf 8 Mbit\/s/.test(await limitText()) && /Benutzer 8 Mbit\/s, Server 20 Mbit\/s/.test(await limitText()), await limitText());
  check('Internet: Konto und Server-Einstellung wurden gelesen', ['/System/Endpoint', '/Users/Me', '/System/Configuration'].every((a) => calls().includes(a)), JSON.stringify(calls()));
  await ctx.capture(path.join(out, 'L-01-limits-settings.png'));
  setLimits({ local: false, user: 30_000_000, server: 20_000_000 });
  await check_();
  check('Konto 30, Server 20: es gilt die des Kontos (wie Jellyfin), nicht die kleinere', /begrenzt auf 30 Mbit\/s/.test(await limitText()), await limitText());
  setLimits({ local: false, user: 6_000_000, server: 20_000_000, serverForbidden: true });
  await check_();
  check('Server-Einstellung nicht lesbar: die Grenze des Kontos genuegt (kein Hinweis noetig)', /begrenzt auf 6 Mbit\/s/.test(await limitText()) && !/nicht lesbar/.test(await limitText()), await limitText());
  setLimits({ local: false, user: 0, server: 20_000_000, serverForbidden: true });
  await check_();
  check('Grenze nicht lesbar: die zuletzt bekannte gilt weiter und das steht da', /begrenzt auf 6 Mbit\/s/.test(await limitText()) && /zuletzt bekannte/.test(await limitText()), await limitText());
  setLimits({ local: false });
  await check_();
  check('Internet ohne Grenze: "kein Limit festgestellt"', /kein Limit festgestellt/.test(await limitText()), await limitText());
  setLimits({ local: false, user: 8_000_000, endpointMissing: true });
  await check_();
  check('Verbindungsart nicht genannt, private Adresse: Heimnetz (wie die Apple-App), und das wird gesagt', /Verbindungsart nicht erkennbar/.test(await limitText()) && /Heimnetz/.test(await limitText()), await limitText());

  // ---------- Player: Internet, Datei (52 Mbit/s) ueber der Grenze, Automatisch ----------
  setLimits({ local: false, user: 8_000_000 });
  check('Wiedergabe startet', await play());
  check('Die App fragt selbst hoechstens die Grenze an (8 Mbit/s), der Server setzt um', player.state.method === 'Transcode' && infos()[0]?.maxBitrate === 8_000_000 && infos()[0]?.profileMaxBitrate === 8_000_000, `${player.state.method} ${JSON.stringify(infos().map((l) => l.maxBitrate))}`);
  check('Automatisch ueber das Internet: die Bandbreite wurde gemessen (1 MB)', bitrateTests()[0]?.size === 1_000_000, JSON.stringify(bitrateTests()));
  check('Player kennt die Grenze und dass die Datei darueber liegt', player.state.serverLimit?.mbps === 8 && player.state.serverLimit?.exceeded === true, JSON.stringify(player.state.serverLimit));
  await ctx.wait(1200);
  const flash = await ev(`(() => { const f = document.querySelector('.flash'); return f?.classList.contains('show') ? f.textContent : ''; })()`);
  check('Beim Abspielen wird nichts eingeblendet (kein Hinweis auf die Grenze)', !player.state.notice && flash === '', `notice=${JSON.stringify(player.state.notice)} flash="${flash}"`);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))`);
  await ctx.wait(500);
  const info = (await ev(`document.querySelector('.info')?.innerText ?? ''`)).replace(/\s+/g, ' ');
  check('Technik-Info zeigt "Server-Limit (Internet) 8 Mbit/s"', /Server-Limit \(Internet\) 8 Mbit\/s/.test(info), info.slice(0, 140));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))`);
  const rows = await qualityRows();
  check('Qualitaetsmenue endet an der Grenze: Automatisch (ca. 8), 1080p 8, 720p 4, 480p 2; nichts darueber', JSON.stringify(rows) === JSON.stringify(['Automatisch ca. 8 Mbit/s', '1080p 8 Mbit/s', '720p 4 Mbit/s', '480p 2 Mbit/s']), JSON.stringify(rows));
  await ctx.capture(path.join(out, 'L-02-limits-player.png'), player.overlay);
  await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  state.log.length = 0;
  await ev(`window.player.send({ type: 'quality', mbps: 20 })`);
  await ctx.wait(600);
  check('Eine Stufe ueber der Grenze laesst sich auch per Befehl nicht waehlen', infos().length === 0 && player.state.quality?.mbps === 0, `${infos().length} Anfragen, Wahl ${player.state.quality?.mbps}`);
  await stop();

  // ---------- Player: Internet, Einstellung ueber der Grenze ----------
  ctx.config.updateSettings({ player: { maxBitrateMbps: 40 } });
  setLimits({ local: false, server: 15_000_000 });
  check('Wiedergabe startet (Einstellung 40, Grenze des Servers 15)', await play());
  check('Es gilt die Grenze des Servers (15 Mbit/s angefragt), das Menue zeigt sie als gewaehlte Stufe', infos()[0]?.maxBitrate === 15_000_000 && player.state.quality?.mbps === 15, `${JSON.stringify(infos().map((l) => l.maxBitrate))} Wahl ${player.state.quality?.mbps}`);
  const rows15 = await qualityRows();
  check('Menue: "Grenze des Servers 15 Mbit/s" ist markiert', rows15[1] === 'Grenze des Servers 15 Mbit/s' && /Grenze des Servers/.test(await ev(`document.querySelector('.pop .opt.sel')?.innerText ?? ''`)), JSON.stringify(rows15));
  await stop();
  ctx.config.updateSettings({ player: { maxBitrateMbps: 0 } });

  // ---------- Player: Automatisch ueber eine langsame Leitung (10 Mbit/s) ----------
  process.env.MOCK_BITRATE_MBPS = '10';
  ctx.backend.resetLimits(); // gemerkte Messung verwerfen
  setLimits({ local: false, server: 15_000_000 });
  check('Wiedergabe startet (Leitung 10 Mbit/s, Grenze 15)', await play());
  const auto = player.state.quality?.autoMbps;
  check(
    'Automatisch: 75 % der gemessenen Bandbreite (unter der Grenze des Servers) wird angefragt',
    auto >= 5 && auto <= 7 && infos()[0]?.maxBitrate === auto * 1_000_000 && player.state.method === 'Transcode',
    `auto=${auto} angefragt=${JSON.stringify(infos().map((l) => l.maxBitrate))}`
  );
  const rowsSlow = await qualityRows();
  check('Menue zeigt, was Automatisch gerade bedeutet', rowsSlow[0] === `Automatisch ca. ${auto} Mbit/s`, JSON.stringify(rowsSlow));
  await stop();
  process.env.MOCK_BITRATE_MBPS = '200';
  ctx.backend.resetLimits();

  // ---------- Player: Datei unter der Grenze ----------
  setLimits({ local: false, server: 80_000_000 });
  check('Wiedergabe startet (Grenze 80 Mbit/s)', await play());
  check('Datei unter der Grenze: weiter Direct Play, kein Hinweis', player.state.method === 'DirectPlay' && player.state.serverLimit?.exceeded === false && !player.state.notice, JSON.stringify(player.state.serverLimit));
  await stop();

  // ---------- Player: Heimnetz trotz eingetragener Grenze ----------
  setLimits({ local: true, user: 8_000_000, server: 8_000_000 });
  check('Wiedergabe startet (Heimnetz, Grenze eingetragen)', await play());
  check('Im Heimnetz: Direct Play, keine Grenze bekannt, kein Hinweis', player.state.method === 'DirectPlay' && !player.state.serverLimit && !player.state.notice, JSON.stringify(player.state.serverLimit));
  check('...die Anfrage nennt "keine Grenze" als Zahl (400 Mbit/s)', infos()[0]?.maxBitrate === 400_000_000, JSON.stringify(infos().map((l) => l.maxBitrate)));
  check('Im Heimnetz fragt der Start nur /System/Endpoint ab und misst nicht', JSON.stringify([...new Set(calls())]) === JSON.stringify(['/System/Endpoint']) && bitrateTests().length === 0, JSON.stringify([...new Set(calls())]));
  await stop();

  delete process.env.MOCK_BITRATE_MBPS;
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
