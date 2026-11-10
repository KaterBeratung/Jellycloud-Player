// Discord Rich Presence (JC_DEV=1, JC_FAKE_MPV=1): Einstellungen (Application-ID, Test, Schalter, Status) und die Anzeige waehrend der Wiedergabe
// gegen ein FAKE-Discord auf einer eigenen Pipe (test/fake-discord.js, nie das echte Discord): Titel, Folge, Poster von TMDB ueber Seerr, Fortschritt, Pause, Sprung,
// Titel verbergen, Knopf, Ende, Neustart von Discord, Ausschalten. Mock-Server auf eigenem Port 9097.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/discord.js
const path = require('node:path');
const { server, items, SEERR, state } = require('../mock-server');
const { startFakeDiscord, fakePipeBase } = require('../../test/fake-discord');

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
  const PORT = 9097;
  const APP_ID = '123456789012345678';
  const base = fakePipeBase();
  process.env.JC_DISCORD_PIPE = base; // main.js liest das bei jedem Verbinden: Discord ist hier nur diese Fake-Pipe
  const fake = await startFakeDiscord(`${base}0`, { validIds: [APP_ID], user: { id: '42', username: 'tester', global_name: 'Test Nutzer' } });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await ctx.wait(400);
  ctx.win.setContentSize(1440, 900);
  ctx.presence.defaultClientId = ''; // erster Teil: keine eingebaute Anwendung, die ID wird eingetragen (der zweite Teil baut sie ein)
  ctx.presence.minIntervalMs = 300; // sonst waere jeder Wechsel um 5 s verzoegert
  ctx.presence.graceMs = 900;
  ctx.presence.retryMs = 800;
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:${PORT}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  await ctx.run(`window.jc.seerrConnect({ url: 'http://127.0.0.1:${PORT}', mode: 'apikey', apiKey: ${JSON.stringify(SEERR.apiKey)} }).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(1800);

  const player = ctx.player;
  const waitFor = async (js, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const until = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(60);
    }
    return !!(await fn());
  };
  const ev = (js) => player.overlay.webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const setDiscord = (patch) => ctx.run(`window.jc.setSettings({ discord: ${JSON.stringify(patch)} })`);
  const statusLine = () => ctx.run(`document.querySelector('.dc-status')?.textContent ?? ''`);
  const lastActivity = () => fake.current();
  const n = () => fake.activities.length;

  const movie = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const show = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  const episode = [...items.values()].find((i) => i.Type === 'Episode' && i.SeriesId === show.Id && i.ParentIndexNumber === 1 && i.IndexNumber === 2);

  // ---------- Einstellungen ----------
  await ctx.run(`location.hash = '#/settings/discord'`);
  check('Der Bereich "Discord" steht in der Seitenleiste und oeffnet sich', await waitFor(`!!document.querySelector('.snav[href="#/settings/discord"].on') && !!document.querySelector('.dc-id')`));
  check('Anfangs ist alles aus: Schalter aus, kein Eintrag, Status "Aus."', (await waitFor(`document.querySelector('.dc-status')?.textContent === 'Aus.'`)) && (await ctx.run(`document.querySelector('.switch').getAttribute('aria-checked')`)) === 'false' && (await ctx.run(`document.querySelector('.dc-id').value`)) === '');
  check('Anleitung mit vier Schritten und Knopf zum Entwicklerportal', (await ctx.run(`document.querySelectorAll('.dc-steps li').length`)) === 4 && (await ctx.run(`[...document.querySelectorAll('.btn-row .btn')].some((b) => /Entwicklerportal/.test(b.textContent))`)));
  await ctx.run(`(() => { const i = document.querySelector('.dc-id'); i.value = '12ab34 5'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('Die Application-ID nimmt nur Ziffern an (Buchstaben und Leerzeichen fallen weg)', (await ctx.run(`document.querySelector('.dc-id').value`)) === '12345');
  await ctx.run(`document.querySelector('.switch').click()`);
  check('Eingeschaltet mit unvollstaendiger ID: Hinweis, eine gueltige ID einzutragen; es wird keine Verbindung aufgebaut', (await waitFor(`/Application-ID ein/.test(document.querySelector('.dc-status')?.textContent ?? '')`, 4000)) && fake.connections === 0, String(await statusLine()));

  const testBtn = `[...document.querySelectorAll('.btn-row .btn')].find((b) => /testen/.test(b.textContent))`;
  const typeId = (id) => ctx.run(`(() => { const i = document.querySelector('.dc-id'); i.value = ${JSON.stringify(id)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await typeId('999999999999999999');
  await ctx.run(`${testBtn}.click()`);
  check('Test mit einer ID, die Discord nicht kennt: klare Meldung', await waitFor(`/kennt diese Application-ID nicht/.test(document.querySelector('.dc-test')?.textContent ?? '') && document.querySelector('.dc-test').classList.contains('fail')`, 5000), await ctx.run(`document.querySelector('.dc-test')?.textContent`));
  await typeId(APP_ID);
  const before = n();
  await ctx.run(`${testBtn}.click()`);
  check('Test mit der richtigen ID: "Verbunden mit Discord als Test Nutzer"', await waitFor(`/Verbunden mit Discord als Test Nutzer/.test(document.querySelector('.dc-test')?.textContent ?? '') && document.querySelector('.dc-test').classList.contains('ok')`, 5000), await ctx.run(`document.querySelector('.dc-test')?.textContent`));
  check('...Discord bekam die Testanzeige mit dem Namen der App und dem Hinweis', n() === before + 1 && lastActivity()?.details === 'Jellycloud Player' && /Alles in Ordnung/.test(lastActivity()?.state ?? ''), JSON.stringify(lastActivity()));
  check('...die Application-ID kam im Handshake an (17 bis 20 Ziffern)', fake.handshakes.at(-1)?.client_id === APP_ID);
  await ctx.capture(path.join(out, 'DC-einstellungen.png'));
  check('Gespeichert wird nur die ID aus Ziffern', await until(() => ctx.config.settings.discord.clientId === APP_ID && ctx.config.settings.discord.enabled === true));
  check('Eingeschaltet mit gueltiger ID, nichts laeuft: "Eingeschaltet", noch keine echte Anzeige', await waitFor(`/Eingeschaltet|verbunden/i.test(document.querySelector('.dc-status')?.textContent ?? '')`, 4000), await statusLine());

  // ---------- Film ----------
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, startTicks: 0 })`);
  check('Wiedergabe laeuft', await until(() => player.state.phase === 'playing', 10000));
  const first = n();
  check('Discord bekommt die Anzeige "Schaut Paper Moons"', await until(() => n() > first - 0 && lastActivity()?.details === 'Paper Moons', 8000), JSON.stringify(lastActivity()));
  let a = lastActivity();
  check('...Art "Schaut" (3), im Status der Titel (2)', a?.type === 3 && a?.status_display_type === 2);
  check('...Jahr und Genres stehen darunter', a?.state === [movie.ProductionYear, movie.Genres.slice(0, 2).join(', ')].filter(Boolean).join(' · '), a?.state);
  check('...das Poster kommt von TMDB (ueber Seerr, Groesse w500)', a?.assets?.large_image === 'https://image.tmdb.org/t/p/w500/mockposter0003.jpg', a?.assets?.large_image);
  const dur = player.state.duration;
  check('...Fortschritt: Beginn und Ende als Zeitpunkte (Unix-Sekunden), Laenge passt zur Laufzeit', a?.timestamps && Math.abs(a.timestamps.end - a.timestamps.start - dur) < 2 && Math.abs(Date.now() / 1000 - a.timestamps.start) < 60, JSON.stringify(a?.timestamps));
  check('...ohne Knopf (nur auf Wunsch)', a?.buttons === undefined);
  await ctx.capture(path.join(out, 'DC-film-stand.png'));

  // Der Schalter wird wirklich in der Oberflaeche umgelegt (nicht ueber die Schnittstelle): Schalter, Speichern und Anzeige muessen zusammenpassen
  const linkSwitch = `[...document.querySelectorAll('.setting')].find((s) => /Link zur Titelseite/.test(s.textContent)).querySelector('.switch')`;
  check('Schalter "Link zur Titelseite": steht aus, mit Erklaerung, dass Discord einem den eigenen Knopf nicht zeigt', (await ctx.run(`${linkSwitch}.getAttribute('aria-checked')`)) === 'false' && /nicht, andere sehen ihn/.test(await ctx.run(`[...document.querySelectorAll('.setting')].find((s) => /Link zur Titelseite/.test(s.textContent)).textContent`)));
  await ctx.run(`${linkSwitch}.click()`);
  check('...umgelegt: eingeschaltet und gespeichert', (await ctx.run(`${linkSwitch}.getAttribute('aria-checked')`)) === 'true' && (await until(() => ctx.config.settings.discord.button === true)));
  check('Link eingeschaltet: Anzeige bekommt "Auf TMDB ansehen" mit der oeffentlichen Seite des Films (der Film hat keine IMDb-Nummer)', await until(() => lastActivity()?.buttons?.[0]?.url === 'https://www.themoviedb.org/movie/4242'), JSON.stringify(lastActivity()?.buttons));
  check('...und der Titel ist anklickbar (details_url), damit man den Link auch selbst sieht', lastActivity()?.details_url === 'https://www.themoviedb.org/movie/4242', String(lastActivity()?.details_url));
  await ctx.run(`${linkSwitch}.click()`);
  check('...ausgeschaltet: Knopf und Titel-Link wieder weg', (await until(() => ctx.config.settings.discord.button === false)) && (await until(() => lastActivity()?.buttons === undefined && lastActivity()?.details_url === undefined)));

  const c1 = n();
  await ev(`window.player.send({ type: 'pause' })`);
  check('Pause: neue Anzeige ohne Fortschrittsbalken, "Pausiert" im Status', await until(() => n() > c1 && lastActivity()?.timestamps === undefined && /^Pausiert/.test(lastActivity()?.state ?? '')), JSON.stringify(lastActivity()));
  const c2 = n();
  await ev(`window.player.send({ type: 'pause' })`);
  check('Weiterspielen: der Balken ist zurueck', await until(() => n() > c2 && !!lastActivity()?.timestamps && !/Pausiert/.test(lastActivity()?.state ?? '')), JSON.stringify(lastActivity()));
  const c3 = n();
  await ev(`window.player.send({ type: 'seek', to: 3000 })`);
  check('Sprung auf 50:00: der Fortschritt zieht nach (Beginn liegt rund 3000 s zurueck)', await until(() => n() > c3 && Math.abs(Date.now() / 1000 - lastActivity().timestamps.start - 3000) < 40, 8000), `${Math.round(Date.now() / 1000 - (lastActivity()?.timestamps?.start ?? 0))} s`);
  const idle = n();
  await ctx.wait(2500);
  check('Normales Weiterlaufen sendet nichts nach (keine Flut von Aktualisierungen)', n() === idle, `${n() - idle} neue`);

  await setDiscord({ hideTitle: true });
  check('Titel verbergen: "Schaut einen Film", kein Titel, kein Poster, im Status der Name der Anwendung', await until(() => lastActivity()?.details === 'Schaut einen Film' && !lastActivity()?.assets && lastActivity()?.status_display_type === 0), JSON.stringify(lastActivity()));
  await setDiscord({ hideTitle: false, poster: 'off' });
  check('Poster "Kein Poster": Titel wieder da, kein Bild', await until(() => lastActivity()?.details === 'Paper Moons' && !lastActivity()?.assets?.large_image));
  await setDiscord({ poster: 'server' });
  check('Poster "Von meinem Server" bei einem Server im Heimnetz (127.0.0.1, http): kein Bild, Discord kaeme nicht heran', await until(() => lastActivity()?.details === 'Paper Moons') && !lastActivity()?.assets?.large_image);
  await setDiscord({ poster: 'auto' });
  check('Poster "Automatisch": wieder TMDB', await until(() => lastActivity()?.assets?.large_image === 'https://image.tmdb.org/t/p/w500/mockposter0003.jpg'));

  // ---------- Ende und Folge ----------
  const clears0 = fake.clears;
  await ev(`window.player.send({ type: 'close' })`);
  check('Ende der Wiedergabe: nach kurzer Schonfrist verschwindet die Anzeige', await until(() => fake.clears > clears0 && fake.current() === null, 8000));
  check('...Status in den Einstellungen: nichts laeuft', await waitFor(`/Es l(ä|ae)uft nichts|Eingeschaltet/.test(document.querySelector('.dc-status')?.textContent ?? '')`, 5000), await statusLine());

  await ctx.run(`window.jc.play({ itemId: '${episode.Id}', resume: false, startTicks: 0 })`);
  check('Folge laeuft: Anzeige "Starfall Station", darunter S1E2 und Titel der Folge', await until(() => lastActivity()?.details === 'Starfall Station' && lastActivity()?.state === `S1E2 · ${episode.Name}`, 10000), JSON.stringify(lastActivity()));
  check('...das Poster ist das der Serie (TMDB-Nummer der Serie ueber den Server geholt)', lastActivity()?.assets?.large_image === 'https://image.tmdb.org/t/p/w500/mockposter0002.jpg', lastActivity()?.assets?.large_image);

  // ---------- Discord wird neu gestartet ----------
  const hs = fake.handshakes.length;
  const na = n();
  fake.dropAll();
  check('Discord wird beendet und neu gestartet: die App verbindet neu und zeigt die Folge wieder', await until(() => fake.handshakes.length > hs && n() > na && lastActivity()?.details === 'Starfall Station', 10000), `Handshakes ${fake.handshakes.length - hs}, Anzeigen ${n() - na}`);

  // ---------- Ausschalten ----------
  const cl = fake.clears;
  await setDiscord({ enabled: false });
  check('Ausgeschaltet waehrend der Wiedergabe: Anzeige weg, Verbindung zu', (await until(() => fake.clears > cl && fake.sockets.size === 0, 6000)) && fake.current() === null);
  check('...Status: Aus.', await waitFor(`document.querySelector('.dc-status')?.textContent === 'Aus.'`, 5000), await statusLine());
  await ev(`window.player.send({ type: 'close' })`);
  await until(() => !player.mpv, 6000);
  await ctx.wait(400);

  // ---------- Eingebaute Anwendung und eigener Name ----------
  await setDiscord({ enabled: false, clientId: '', name: '' });
  ctx.presence.defaultClientId = APP_ID; // ab jetzt: die Anwendung ist eingebaut, niemand braucht eine ID
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);
  await ctx.run(`location.hash = '#/settings/home'`);
  await ctx.wait(400);
  await ctx.run(`location.hash = '#/settings/discord'`);
  check('Eingebaute Anwendung: das ID-Feld ist nur "optional" und leer, die Anleitung steht unter "Eigene Anwendung"', await waitFor(`!!document.querySelector('.dc-id') && document.querySelector('.dc-id').placeholder === 'Eingebaute Anwendung' && [...document.querySelectorAll('.group-title')].some((g) => /Eigene Anwendung/.test(g.textContent)) && /optional/.test(document.body.innerText)`), await ctx.run(`document.querySelector('.dc-id')?.placeholder`));
  check('...im Bereich "Verbindung" gibt es nur noch Schalter, Test und Status (kein Entwicklerportal, keine ID)', await ctx.run(`(() => { const g = document.querySelector('.settings-group'); return !g.querySelector('.dc-id') && ![...g.querySelectorAll('.btn')].some((b) => /Entwicklerportal/.test(b.textContent)) && [...g.querySelectorAll('.btn')].some((b) => /testen/.test(b.textContent)); })()`));
  await ctx.wait(900); // die Seite ist gezeichnet, bevor aufgenommen wird
  await ctx.capture(path.join(out, 'DC-eingebaut.png'));
  const hs2 = fake.handshakes.length;
  await ctx.run(`${testBtn}.click()`);
  check('Test ohne eigene ID: verbindet mit der eingebauten Anwendung', (await waitFor(`/Verbunden mit Discord als Test Nutzer/.test(document.querySelector('.dc-test')?.textContent ?? '')`, 5000)) && fake.handshakes.length > hs2 && fake.handshakes.at(-1).client_id === APP_ID, String(fake.handshakes.at(-1)?.client_id));
  await ctx.run(`document.querySelector('.switch').click()`);
  check('Einschalten genuegt: kein Hinweis auf eine fehlende ID', await waitFor(`/Eingeschaltet|verbunden/i.test(document.querySelector('.dc-status')?.textContent ?? '')`, 4000), await statusLine());
  check('Das Namensfeld ist da (leer, Vorschlag "Jellycloud Player") samt Knopf "Servername"', await ctx.run(`(() => { const i = document.querySelector('.dc-name-input'); return !!i && i.value === '' && i.placeholder === 'Jellycloud Player' && [...document.querySelectorAll('.dc-name .btn')].some((b) => /Servername/.test(b.textContent)); })()`));
  const typeName = (v) => ctx.run(`(() => { const i = document.querySelector('.dc-name-input'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await typeName('Mein Kino');
  check('Name eingetragen: er wird gespeichert', await until(() => ctx.config.settings.discord.name === 'Mein Kino'));
  await ctx.wait(500);
  await ctx.capture(path.join(out, 'DC-name.png'));
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false, startTicks: 0 })`);
  check('Anzeige traegt den eigenen Namen ("Schaut Mein Kino"), der Titel bleibt', await until(() => lastActivity()?.details === 'Paper Moons' && lastActivity()?.name === 'Mein Kino', 10000), JSON.stringify(lastActivity()));
  check('...und die Verbindung lief ueber die eingebaute Anwendung', fake.handshakes.at(-1)?.client_id === APP_ID);
  const serverName = ctx.config.publicState().servers[0]?.name;
  await ctx.run(`[...document.querySelectorAll('.dc-name .btn')].find((b) => /Servername/.test(b.textContent)).click()`);
  check('Knopf "Servername": setzt den Namen des Servers ein (Feld und Anzeige)', !!serverName && (await ctx.run(`document.querySelector('.dc-name-input').value`)) === serverName && (await until(() => lastActivity()?.name === serverName)), `${serverName} / ${lastActivity()?.name}`);
  await typeName('');
  check('Namen geleert: kein "name" mehr in der Anzeige (Discord nimmt den Namen der Anwendung)', await until(() => lastActivity()?.details === 'Paper Moons' && !('name' in lastActivity())), JSON.stringify(lastActivity()));
  await typeName('Z'.repeat(200));
  check('Sehr langer Name: auf 128 Zeichen gekuerzt', await until(() => lastActivity()?.name && Array.from(lastActivity().name).length === 128), String(lastActivity()?.name?.length));
  await typeName('');
  await ev(`window.player.send({ type: 'close' })`);
  await until(() => !player.mpv, 6000);
  await setDiscord({ enabled: false });
  await ctx.wait(800);

  // ---------- Datenschutz ----------
  const wire = JSON.stringify(fake.commands) + JSON.stringify(fake.handshakes);
  check('Nichts Vertrauliches ging an Discord: kein Token, keine Adresse des eigenen Servers, kein Benutzername', !/Token|api_key|ApiKey|Authorization|127\.0\.0\.1|localhost|"demo"/i.test(wire), (wire.match(/Token|api_key|ApiKey|Authorization|127\.0\.0\.1|localhost|"demo"/i) ?? [''])[0]);
  check('Jede Anzeige haelt Discords Grenzen ein (Texte 2 bis 128 Zeichen, hoechstens ein Knopf)', fake.activities.every((x) => [x.details, x.state].every((s) => s === undefined || (s.length >= 2 && Array.from(s).length <= 128)) && (x.buttons?.length ?? 0) <= 1));
  await fake.close();
  check('Keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
  void state;
};
