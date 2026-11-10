// Bitratenlimit des Servers erkennen (JC_DEV=1, JC_FAKE_MPV=1): nur ueber das Internet abfragen, im lokalen Netz nichts weiter.
//   Anzeige in den Einstellungen (Netzwerk), Hinweis und Info im Player, Wirkung bei Direct Play / Transcode.
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
  const setLimits = (patch) => Object.assign(state.limits, { local: true, user: 0, server: 0, serverForbidden: false, endpointMissing: false }, patch);
  const calls = () => state.log.map((l) => l.at).filter((a) => ['/System/Endpoint', '/Users/Me', '/System/Configuration'].includes(a));
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
  const check_ = async (label) => {
    await page(`document.querySelector('.limit-text')?.closest('.setting')?.querySelector('button')?.click()`);
    await ctx.wait(700);
    return label;
  };

  // ---------- Einstellungen: lokales Netz ----------
  await page(`location.hash = '#/settings/network'`);
  await waitFor(async () => (await limitText()) !== '…' && (await limitText()) !== '', 5000);
  setLimits({ local: true, user: 8_000_000, server: 20_000_000 });
  state.log.length = 0;
  await check_('lokal');
  check('Lokales Netz: Anzeige "keine Begrenzung"', /Lokales Netz: keine Begrenzung/.test(await limitText()), await limitText());
  check('...und es bleibt bei der einen kleinen Anfrage (keine Abfrage der Grenzen)', JSON.stringify(calls()) === JSON.stringify(['/System/Endpoint']), JSON.stringify(calls()));

  // ---------- Einstellungen: Internet ----------
  setLimits({ local: false, user: 8_000_000, server: 20_000_000 });
  state.log.length = 0;
  await check_('internet');
  check('Internet: kleinere Grenze gilt, beide werden genannt', /Internet: begrenzt auf 8 Mbit\/s/.test(await limitText()) && /Benutzer 8 Mbit\/s, Server 20 Mbit\/s/.test(await limitText()), await limitText());
  check('Internet: Benutzer-Richtlinie und Server-Einstellung wurden gelesen', ['/System/Endpoint', '/Users/Me', '/System/Configuration'].every((a) => calls().includes(a)), JSON.stringify(calls()));
  await ctx.capture(path.join(out, 'L-01-limits-settings.png'));
  setLimits({ local: false, user: 6_000_000, server: 20_000_000, serverForbidden: true });
  await check_('nur-benutzer');
  check('Server-Einstellung nicht lesbar: Hinweis, Grenze des Benutzers gilt', /begrenzt auf 6 Mbit\/s/.test(await limitText()) && /nicht lesbar/.test(await limitText()), await limitText());
  setLimits({ local: false });
  await check_('ohne');
  check('Internet ohne Limit: "kein Limit festgestellt"', /kein Limit festgestellt/.test(await limitText()), await limitText());
  setLimits({ local: false, user: 8_000_000, endpointMissing: true });
  await check_('unbekannt');
  check('Verbindungsart nicht erkennbar: wird gesagt, Grenzen trotzdem gezeigt', /Verbindungsart nicht erkennbar/.test(await limitText()) && /8 Mbit\/s/.test(await limitText()), await limitText());

  // ---------- Player: Internet, Datei (52 Mbit/s) ueber dem Limit ----------
  setLimits({ local: false, user: 8_000_000 });
  check('Wiedergabe startet', await play());
  check('Der Server erzwingt einen Transcode, obwohl "Original" gilt (Einstellung 0 = Original)', player.state.method === 'Transcode', player.state.method);
  check('Player kennt das Limit und dass die Datei darueber liegt', player.state.serverLimit?.mbps === 8 && player.state.serverLimit?.exceeded === true, JSON.stringify(player.state.serverLimit));
  await ctx.wait(1200);
  const flash = await ev(`(() => { const f = document.querySelector('.flash'); return f?.classList.contains('show') ? f.textContent : ''; })()`);
  check('Beim Abspielen wird nichts eingeblendet (kein Hinweis auf das Limit)', !player.state.notice && flash === '', `notice=${JSON.stringify(player.state.notice)} flash="${flash}"`);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))`);
  await ctx.wait(500);
  const info = (await ev(`document.querySelector('.info')?.innerText ?? ''`)).replace(/\s+/g, ' ');
  check('Technik-Info zeigt "Server-Limit (Internet) 8 Mbit/s"', /Server-Limit \(Internet\) 8 Mbit\/s/.test(info), info.slice(0, 140));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))`);
  await ev(`document.querySelector('.cluster .ibtn[title="Qualität"]').click()`);
  await ctx.wait(500);
  const note = await ev(`document.querySelector('.pop .pop-note')?.textContent ?? ''`);
  check('Qualitaets-Menue erklaert, dass "Original" ueber dem Limit nicht geht', /8 Mbit\/s.*Original/.test(note), note);
  await ctx.capture(path.join(out, 'L-02-limits-player.png'), player.overlay);
  await stop();

  // ---------- Player: Datei unter dem Limit ----------
  setLimits({ local: false, server: 80_000_000 });
  check('Wiedergabe startet (Limit 80 Mbit/s)', await play());
  check('Datei unter dem Limit: weiter Direct Play, kein Hinweis', player.state.method === 'DirectPlay' && player.state.serverLimit?.exceeded === false && !player.state.notice, JSON.stringify(player.state.serverLimit));
  await stop();

  // ---------- Player: lokales Netz trotz eingetragener Grenze ----------
  setLimits({ local: true, user: 8_000_000, server: 8_000_000 });
  check('Wiedergabe startet (LAN, Grenze eingetragen)', await play());
  check('Im lokalen Netz: Direct Play, kein Limit bekannt, kein Hinweis', player.state.method === 'DirectPlay' && !player.state.serverLimit && !player.state.notice, JSON.stringify(player.state.serverLimit));
  check('Im lokalen Netz fragt der Start nur /System/Endpoint ab', JSON.stringify([...new Set(calls())]) === JSON.stringify(['/System/Endpoint']), JSON.stringify([...new Set(calls())]));
  await stop();

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
