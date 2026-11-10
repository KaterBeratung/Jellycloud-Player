// Audit mit Randfaellen (JC_DEV=1, JC_FAKE_MPV=1): sehr lange Titel und Texte, fehlende Bilder, viele Genres, lange Namen in der Verwaltung.
// Gleiche Layout-Pruefung wie layout.js (Ueberlappung, Ueberlauf, Scrollen) in drei Fenstergroessen.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/audit-edge.js
const path = require('node:path');
const crypto = require('node:crypto');
const { server, items, add, MOVIES_VIEW, setAdmin, state } = require('../mock-server');
const { CHECK } = require('./layout');

// Bedienbare Elemente ohne Namen (Bildschirmleser, Tooltips) und doppelte IDs
const A11Y = `(() => {
  const issues = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=menuitem]')) {
    if (!vis(el)) continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim() || (el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent.trim()) || (el.closest('label')?.textContent.trim()) || el.getAttribute('aria-labelledby');
    if (!name) issues.push('ohne Namen: ' + el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
  }
  const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) issues.push('doppelte ID: ' + id + ' x' + n);
  return [...new Set(issues)];
})()`;
module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const errors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) errors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };

  // ---------- Randfaelle in den Mock-Daten ----------
  const id32 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const longWord = 'Donaudampfschifffahrtsgesellschaftskapitaenspatent'.repeat(2);
  const edge = add(
    {
      Id: id32('edge-movie'),
      Name: `Der unglaublich lange Filmtitel ohne Ende ${longWord} und noch ein Nachsatz fuer die zweite Zeile`,
      Type: 'Movie',
      MediaType: 'Video',
      ProductionYear: 2025,
      Genres: ['Science Fiction', 'Abenteuer', 'Dokumentarfilm', 'Kriegsfilm', 'Familie', 'Mystery', 'Thriller', 'Western', 'Musik', 'Historie', 'Fantasy', 'Krimi', 'Komoedie', 'Romanze', 'Animation'],
      Overview: 'Ein sehr langer Text. '.repeat(160),
      Taglines: ['Ein ebenso langer Slogan, der eigentlich nie in eine Zeile passen wuerde und deshalb umbrechen muss, ohne etwas zu ueberlappen oder abzuschneiden.'],
      OfficialRating: 'FSK 16',
      CommunityRating: 7.4,
      RunTimeTicks: 7200 * 10_000_000,
      ImageTags: {},
      BackdropImageTags: [],
      Studios: [{ Name: 'Ein Studio mit einem ebenfalls sehr langen Namen GmbH & Co. KG' }],
      People: [{ Name: 'Ein Darsteller mit einem wirklich ausserordentlich langen Namen', Type: 'Actor', Role: 'Eine Rolle mit einer ebenfalls ungewoehnlich langen Beschreibung der Figur', Id: id32('edge-person') }],
      DateCreated: new Date(Date.now() + 3600e3).toISOString(),
      ParentId: MOVIES_VIEW.Id,
      MediaSources: [{ Id: id32('edge-movie'), Name: 'Eine Version mit sehr langem Namen - 2160p HEVC HDR10 Atmos Remux - Director’s Cut Extended', Container: 'mkv', Size: 62_000_000_000, Bitrate: 52_000_000, SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, MediaStreams: [{ Index: 0, Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, VideoRangeType: 'HDR10' }, { Index: 1, Type: 'Audio', Codec: 'eac3', Language: 'ger', Channels: 6, DisplayTitle: 'Deutsch - Dolby Digital Plus - 5.1 - mit einem ungewoehnlich langen Zusatz zur Beschreibung der Tonspur' }], DefaultAudioStreamIndex: 1 }]
    },
    MOVIES_VIEW.Id
  );
  items.set(edge.Id, edge);

  setAdmin(true);
  const ad = (state.adminData ??= null);
  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);
  // Verwaltungsdaten mit langen Texten (nach dem ersten Abruf legt der Mock sie an)
  await ctx.run(`window.jc.api('getUsers')`);
  const data = state.adminData;
  data.users.push({ Id: id32('user-long'), Name: 'ein-benutzername-mit-genau-vierundsechzig-zeichen-und-keinem-leerzeichen-', HasPassword: false, LastLoginDate: null, LastActivityDate: null, Policy: { IsAdministrator: true, IsDisabled: true } });
  data.sessions.push({ Id: 's-long', UserName: 'benutzer-mit-langem-namen', Client: 'Ein Client mit sehr langem Programmnamen und Versionsangabe 12.345.678', DeviceName: 'Ein Geraet mit einem noch viel laengeren Namen als ueblich', LastActivityDate: new Date().toISOString(), NowPlayingItem: { Id: edge.Id, Name: edge.Name, SeriesName: 'Eine Serie mit langem Namen', Type: 'Episode', RunTimeTicks: 3000 * 10_000_000 }, PlayState: { PositionTicks: 600 * 10_000_000, IsPaused: true } });
  data.activity.unshift({ Id: 99, Name: 'Ein Protokolleintrag mit einem extrem langen Text, der ueber mehrere Zeilen laufen muss, ohne die Zeitangabe rechts zu ueberlagern oder abgeschnitten zu werden ' + 'x'.repeat(40), ShortOverview: 'Eine Zusatzzeile mit https://example.com/sehr/langer/pfad/der/nicht/umbrechen/will/ohne/leerzeichen/'.repeat(2), Type: 'X', Date: new Date().toISOString(), Severity: 'Error' });
  data.tasks.push({ Id: id32('task-long'), Name: 'Eine Aufgabe mit einem sehr langen Namen, der in der Zeile Platz brauchen wird', Description: 'Eine ebenso lange Beschreibung. '.repeat(12), Category: 'Eine Kategorie mit langem Namen', State: 'Idle', IsHidden: false, LastExecutionResult: { EndTimeUtc: new Date().toISOString(), Status: 'Failed' }, Triggers: [] });

  const routes = [
    ['home', '#/home'],
    ['library', '#/library/' + MOVIES_VIEW.Id],
    ['edge-detail', `#/item/${edge.Id}`],
    ['search', '#/search?q=unglaublich'],
    ['admin-tasks', '#/admin/tasks'],
    ['admin-sessions', '#/admin/sessions'],
    ['admin-users', '#/admin/users']
  ];
  let total = 0;
  for (const [w, h] of [[920, 620], [1280, 720], [1920, 1080]]) {
    ctx.win.setContentSize(w, h);
    await ctx.wait(600);
    for (const [name, hash] of routes) {
      await ctx.run(`location.hash = ${JSON.stringify(hash)}`);
      await ctx.wait(name === 'home' ? 2600 : 1800);
      const issues = [...new Set(await ctx.run(CHECK))];
      total += issues.length;
      check(`[${w}x${h}] ${name}`, issues.length === 0, issues.join('; '));
      if (w === 1280) {
        const a11y = await ctx.run(A11Y);
        check(`[${w}x${h}] ${name}: jedes bedienbare Element hat einen Namen, keine doppelten IDs`, a11y.length === 0, a11y.slice(0, 5).join('; '));
      }
      if (w === 920) await ctx.capture(path.join(out, `E-${w}x${h}-${name}.png`));
    }
  }
  check('Keine Konsolenfehler oder -warnungen', errors.length === 0, errors.slice(0, 4).join(' | '));
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
