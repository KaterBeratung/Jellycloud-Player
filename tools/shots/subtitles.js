// Lange Untertitel-Listen bleiben uebersichtlich (JC_DEV=1, JC_FAKE_MPV=1): Detailseite (Auswahl und Technik-Info) und Spur-Panel des Players.
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/subtitles.js
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

  // ---------- Vorbereitung: Film mit vielen Untertitelspuren, Film mit wenigen ----------
  const many = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const few = [...items.values()].find((i) => i.Name === 'Neon Harbor');
  const stream = (Index, Language, extra = {}) => ({ Index, Type: 'Subtitle', Codec: 'subrip', Language, DisplayTitle: `${Language ?? 'und'} - SubRip`, IsDefault: false, ...extra });
  const langs = ['eng', 'fre', 'spa', 'ita', 'por', 'pol', 'rus', 'tur', 'jpn', 'kor', 'dut', 'swe'];
  const base = many.MediaSources[0].MediaStreams.filter((s) => s.Type !== 'Subtitle');
  const added = [
    stream(10, 'ger', { DisplayTitle: 'Deutsch - SubRip' }),
    stream(11, 'ger', { IsForced: true, DisplayTitle: 'Deutsch - Erzwungen - SubRip' }),
    stream(12, 'ger', { Title: 'Deutsch (SDH)', DisplayTitle: 'Deutsch (SDH) - SubRip' }),
    stream(13, 'eng', { DisplayTitle: 'English - SubRip' }),
    stream(14, 'eng', { Title: 'English SDH', DisplayTitle: 'English SDH - SubRip' }),
    ...langs.slice(1).map((l, i) => stream(20 + i, l)),
    stream(40, 'jpn', { Title: 'Signs & Songs', DisplayTitle: 'Japanese (Signs & Songs) - SubRip' }),
    stream(41, undefined, { DisplayTitle: 'Untertitel' })
  ];
  many.MediaSources[0].MediaStreams.splice(0, many.MediaSources[0].MediaStreams.length, ...base, ...added);
  const total = added.length;
  const fewSubs = few.MediaSources[0].MediaStreams.filter((s) => s.Type === 'Subtitle').length;
  check('Vorbereitung: ein Film mit vielen Spuren (mehr als 8), einer mit wenigen', total > 8 && fewSubs <= 8, `${total} und ${fewSubs}`);

  ctx.config.updateSettings({ player: { audioLanguage: 'de', subtitleMode: 'off', subtitleLanguage: 'de' } });
  await ctx.run(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(2200);

  // das zuletzt geoeffnete Menue (das alte blendet beim Schliessen noch kurz aus)
  const menuEntries = () => ctx.run(`(() => { const m = [...document.querySelectorAll('.menu')].at(-1); if (!m) return null; return [...m.children].map((c) => c.classList.contains('menu-head') ? { head: c.textContent.trim() } : { label: c.querySelector('.lbl')?.textContent.trim(), sub: c.querySelector('.sub')?.textContent.trim() ?? '', selected: c.classList.contains('selected') }); })()`);
  const openSubMenu = async () => {
    await ctx.run(`[...document.querySelectorAll('.detail-options .opt')].find((b) => /Untertitel/.test(b.textContent)).click()`);
    const ok = await waitFor(`!!document.querySelector('.menu')`, 3000);
    await ctx.wait(350); // ein eben geschlossenes Menue ist dann ganz weg
    return ok;
  };
  const clickEntry = (text) => ctx.run(`[...[...document.querySelectorAll('.menu')].at(-1).querySelectorAll('.menu-item')].find((b) => b.querySelector('.lbl')?.textContent.trim() === ${JSON.stringify(text)})?.click()`);

  // ---------- 1. Detailseite: viele Spuren ----------
  await ctx.run(`location.hash = '#/item/${many.Id}'`);
  check('Detailseite mit Auswahl geladen', await waitFor(`!!document.querySelector('.detail-options')`, 10000));
  await ctx.wait(800);
  check('Auswahl "Untertitel" oeffnet das Menue', await openSubMenu());
  const e1 = await menuEntries();
  const labels1 = e1.map((e) => e.label ?? `[${e.head}]`);
  check('Menue: zuerst Aus, dann die bevorzugten Sprachen (Deutsch, danach Englisch), am Ende "Weitere Sprachen"', labels1[0] === 'Aus' && labels1.slice(1, 4).join('|') === 'Deutsch|Deutsch · Erzwungen|Deutsch · SDH' && labels1.slice(4, 6).join('|') === 'Englisch|Englisch · SDH' && /^Weitere Sprachen \(\d+\)$/.test(labels1.at(-1)), JSON.stringify(labels1));
  check('Menue: kompakt (hoechstens 9 Zeilen statt aller Spuren)', labels1.length <= 9 && labels1.length < total, `${labels1.length} Zeilen bei ${total} Spuren`);
  check('Menue: in einer Spalte, ohne Scrollen (kein mehrspaltiges Gitter)', await ctx.run(`(() => { const m = document.querySelector('.menu'); return !m.classList.contains('multi') && m.scrollHeight <= m.clientHeight + 1; })()`));
  const moreN = +/\((\d+)\)/.exec(labels1.at(-1))[1];
  const otherLangs = new Set(added.map((s) => s.Language ?? 'und').filter((l) => !['ger', 'eng'].includes(l))).size;
  check('"Weitere Sprachen (n)": n ist die Zahl der uebrigen Sprachen', moreN === otherLangs, `${moreN} von ${otherLangs}`);
  check('Die Zeile verrät, wie viele Spuren dahinterstecken', /\d+ weitere Spuren/.test(e1.at(-1).sub), e1.at(-1).sub);
  check('Zusatz je Spur: Format (SRT) in der zweiten Zeile', e1[1].sub === 'SUBRIP', e1[1].sub);
  await ctx.capture(path.join(out, 'S-01-detail-menue-kurz.png'));

  await clickEntry(labels1.at(-1));
  check('Klick auf "Weitere Sprachen" zeigt die uebrigen, unter einer Ueberschrift', await waitFor(`!!document.querySelector('.menu .menu-head')`, 2000));
  const e2 = await menuEntries();
  const labels2 = e2.map((e) => e.label ?? `[${e.head}]`);
  check('Aufgeklappt: Aus, bevorzugte und die uebrigen, nichts mehr eingeklappt', labels2[0] === 'Aus' && labels2.includes('[Weitere Sprachen]') && !labels2.some((l) => /^Weitere Sprachen \(/.test(l)), JSON.stringify(labels2));
  const afterHead = labels2.slice(labels2.indexOf('[Weitere Sprachen]') + 1);
  const names = [...new Set(afterHead.map((l) => l.replace(/ \d+$/, '').replace(/ · .*$/, '')))];
  const known = names.filter((n) => n !== 'Unbekannte Sprache');
  check('Aufgeklappt: die uebrigen sind alphabetisch nach Sprachname sortiert, die ohne Sprachangabe zuletzt', known.join('|') === [...known].sort((a, b) => a.localeCompare(b, 'de')).join('|') && names.at(-1) === 'Unbekannte Sprache', JSON.stringify(names));
  check('Aufgeklappt: Franzoesisch, Japanisch und die Spur ohne Sprache ("Unbekannte Sprache") sind da', ['Französisch', 'Japanisch', 'Unbekannte Sprache'].every((n) => afterHead.some((l) => l.startsWith(n))), JSON.stringify(afterHead));
  check('Aufgeklappt: zwei japanische Spuren sind unterscheidbar (Signs & Songs steht in der zweiten Zeile)', e2.filter((e) => e.label?.startsWith('Japanisch')).some((e) => e.sub.includes('Signs & Songs')), JSON.stringify(e2.filter((e) => e.label?.startsWith('Japanisch'))));
  await ctx.capture(path.join(out, 'S-02-detail-menue-alle.png'));

  await clickEntry('Französisch');
  await ctx.wait(400);
  const val = await ctx.run(`[...document.querySelectorAll('.detail-options .opt')].find((b) => /Untertitel/.test(b.textContent)).querySelector('.val').textContent`);
  check('Auswahl einer Sprache aus dem Rest: die Option zeigt sie', /fre/i.test(val), val);
  await openSubMenu();
  const e3 = await menuEntries();
  check('Die gewaehlte Sprache bleibt beim naechsten Oeffnen gleich sichtbar (Franzoesisch steht oben, ausgewaehlt, "Weitere Sprachen" dahinter)', e3.some((e) => e.label === 'Französisch' && e.selected) && /^Weitere Sprachen \(\d+\)$/.test(e3.at(-1).label) && e3.findIndex((e) => e.label === 'Französisch') < e3.length - 1, JSON.stringify(e3.map((e) => e.label)));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(300);

  // Technik-Info: eine Zeile je Sprache
  await ctx.run(`document.querySelector('details.tech')?.setAttribute('open', '')`);
  await ctx.wait(400);
  const tech = await ctx.run(`(() => { const card = [...document.querySelectorAll('.tech-card')].find((c) => c.querySelector('h4')?.textContent.trim() === 'Untertitel'); return card ? [...card.querySelectorAll('dt')].map((d) => d.textContent.trim()) : null; })()`);
  check('Technik-Info: eine Zeile je Sprache statt je Spur', Array.isArray(tech) && tech.length === 1 + otherLangs + 1 && tech.length < total, JSON.stringify(tech));
  check('Technik-Info: mehrere Spuren einer Sprache stehen mit Anzahl da ("Deutsch (3)")', tech.includes('Deutsch (3)') && tech.includes('Englisch (2)'), JSON.stringify(tech));

  // ---------- 2. Detailseite: wenige Spuren bleiben eine einfache Liste ----------
  await ctx.run(`location.hash = '#/item/${few.Id}'`);
  await waitFor(`!!document.querySelector('.detail-options')`, 10000);
  await ctx.wait(800);
  await openSubMenu();
  const e4 = await menuEntries();
  check('Wenige Spuren (bis 8): wie bisher eine einfache Liste, ohne "Weitere Sprachen"', e4.length === 1 + fewSubs && !e4.some((e) => /Weitere/.test(e.label ?? e.head)), JSON.stringify(e4.map((e) => e.label)));
  await ctx.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await ctx.wait(300);

  // ---------- 3. Player: Spur-Panel mit vielen Untertiteln ----------
  const player = ctx.player;
  const ov = () => player.overlay;
  const ev = (js) => ov().webContents.executeJavaScript(js).catch((e) => (/disposed/i.test(String(e?.message ?? e)) ? null : Promise.reject(e)));
  const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  const waitPlayer = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(150);
    }
    return false;
  };
  player.fake.env.FAKE_SUBS = '24'; // der mpv-Simulator haengt 24 weitere Untertitelspuren an (zwoelf Sprachen, je zweimal); gilt fuer den naechsten Start
  ctx.config.updateSettings({ player: { audioLanguage: 'de', subtitleMode: 'always', subtitleLanguage: 'de' } });
  const movie = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  await ctx.run(`window.jc.play({ itemId: '${movie.Id}', resume: false })`);
  check('Wiedergabe gestartet', await waitPlayer(() => player.state.phase === 'playing'), `phase=${player.state.phase}`);
  await ctx.wait(1500);
  await key('s');
  await ctx.wait(600);
  const subCol = `document.querySelectorAll('.pop .col')[1]`;
  const rows = () => ev(`[...${subCol}.querySelectorAll('.opt')].filter((b) => !b.closest('.more') && !b.classList.contains('more-toggle')).map((b) => ({ label: b.querySelector('.lb').textContent.trim(), sub: b.querySelector('.sb')?.textContent.trim() ?? '', sel: b.classList.contains('sel') }))`);
  const r1 = await rows();
  const l1 = r1.map((r) => r.label);
  // Deutsch: die PGS-Spur und die vom Player geladene externe Spur (beide normal, deshalb nummeriert) und die erzwungene
  check('Player: zuerst Aus, dann Deutsch (zwei normale Spuren nummeriert, dazu Erzwungen) und Englisch (drei Spuren, nummeriert)', l1[0] === 'Aus' && l1.slice(1, 4).join('|') === 'Deutsch 1|Deutsch 2|Deutsch · Erzwungen' && l1.slice(4).join('|') === 'Englisch 1|Englisch 2|Englisch 3', JSON.stringify(l1));
  check('Player: die ausgewaehlte Spur (deutsch, Modus "Immer") ist markiert', r1.find((r) => r.sel)?.label === 'Deutsch 1', JSON.stringify(r1.filter((r) => r.sel)));
  const toggleText = await ev(`${subCol}.querySelector('.more-toggle .lb')?.textContent.trim()`);
  check('Player: dahinter "Weitere Sprachen (11)" (elf uebrige Sprachen), aufgeklappt wird mit einem Klick', toggleText === 'Weitere Sprachen (11)', toggleText);
  check('Player: Der Rest ist zu', await ev(`${subCol}.querySelector('.more').hidden === true && ${subCol}.querySelector('.more-toggle').getAttribute('aria-expanded') === 'false'`));
  check('Player: das Panel passt ohne Scrollen und muss nicht zusammengestaucht werden (kein compact/dense/tight)', (await ev(`(() => { const p = document.querySelector('.pop'); return p.scrollHeight <= p.clientHeight + 1 && !/compact|dense|tight/.test(p.className); })()`)), await ev(`document.querySelector('.pop').className`));
  await ctx.capture(path.join(out, 'S-03-player-kurz.png'), ov());
  await ev(`${subCol}.querySelector('.more-toggle').click()`);
  await ctx.wait(400);
  check('Player: Klick klappt die uebrigen Sprachen auf (Knopf heisst nun "Weniger Sprachen")', await ev(`${subCol}.querySelector('.more').hidden === false && /Weniger/.test(${subCol}.querySelector('.more-toggle .lb').textContent)`));
  const moreLabels = await ev(`[...${subCol}.querySelectorAll('.more .opt')].map((b) => b.querySelector('.lb').textContent.trim())`);
  check('Player: aufgeklappt sind es alle uebrigen Sprachen mit ihren zwei Spuren (22)', moreLabels.length === 22 && moreLabels.includes('Japanisch 1') && moreLabels.includes('Japanisch 2') && moreLabels.includes('Französisch 1'), `${moreLabels.length}: ${moreLabels.slice(0, 6).join(', ')} ...`);
  await ctx.capture(path.join(out, 'S-04-player-alle.png'), ov());
  await ev(`[...${subCol}.querySelectorAll('.more .opt')].find((b) => b.querySelector('.lb').textContent.trim() === 'Japanisch 2').click()`);
  await ctx.wait(600);
  check('Player: Auswahl aus dem aufgeklappten Rest erreicht mpv (Japanisch, zweite Spur = Zusatz 21)', player.mpv.prop('sid') === 100 + 8 + 12, `sid=${player.mpv.prop('sid')}`);
  await key('s');
  await ctx.wait(600);
  const r2 = await rows();
  check('Player: beim naechsten Oeffnen steht die gewaehlte Sprache oben, markiert (Japanisch 2 hinter Englisch)', r2.some((r) => r.label === 'Japanisch 2' && r.sel) && r2.findIndex((r) => r.label === 'Japanisch 2') > r2.findIndex((r) => r.label === 'Englisch 3'), JSON.stringify(r2.map((r) => r.label)));
  const toggle2 = await ev(`${subCol}.querySelector('.more-toggle .lb')?.textContent.trim()`);
  check('Player: ...und der Rest ist wieder zu (elf Sprachen minus die gewaehlte = 10)', toggle2 === 'Weitere Sprachen (10)', toggle2);
  await key('Escape');
  await ctx.wait(300);
  await ev(`window.player.send({ type: 'close' })`);
  await waitPlayer(() => !player.mpv && !player.host, 8000);
  delete player.fake.env.FAKE_SUBS;

  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  server.close();
  if (pass !== results.length) process.exitCode = 1;
};
