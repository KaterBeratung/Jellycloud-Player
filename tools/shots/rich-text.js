// Beschreibungen mit HTML (Apple-App Build 93, DescriptionText), mit dem Mock-Server auf eigenem Port:
//  - Detailseite: Absaetze, Liste, fett, Link (nur http/https), Entitaeten; kein Skript, keine Ereignis-Attribute, keine fremden Elemente
//  - Folgenliste: Vorschau ohne Tags und ohne Leerzeilen
//  - Text ohne HTML bleibt, wie er war
//   $env:JC_DEV='1'; $env:JC_FAKE_MPV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/rich-text.js
const path = require('node:path');
const { server, items } = require('../mock-server');

module.exports = async (ctx) => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const PORT = 8964;
  const BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const waitFor = async (js, ms = 9000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await ctx.run(js).catch(() => false)) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const movie = [...items.values()].find((i) => i.Name === 'Paper Moons');
  const plain = [...items.values()].find((i) => i.Name === 'Aurora Protocol');
  const episode = [...items.values()].find((i) => i.Type === 'Episode');
  const series = items.get(episode.SeriesId);
  movie.Overview = '<p>Erster <b>Absatz</b> mit <a href="https://example.com/info" onclick="window.__clicked=1">Link</a> und <a href="javascript:window.__js=1">Trick</a>.</p><ul><li>Eins</li><li>Zwei</li></ul><script>window.__x = 1</script><img src="x" onerror="window.__img=1"><p onmouseover="window.__hover=1">Zweiter &amp; letzter</p>';
  episode.Overview = '<p>Folge <i>eins</i>.</p><p>Noch ein Satz.</p>';
  ctx.win.setContentSize(1280, 860);
  await ctx.run(`window.jc.login({url:'${BASE}', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await waitFor(`!!document.querySelector('.topbar')`);
  await ctx.wait(800);

  await ctx.run(`location.hash = '#/item/${movie.Id}'`);
  await waitFor(`!!document.querySelector('.detail-info .overview')`, 9000);
  await ctx.wait(400);
  const d = await ctx.run(`(() => { const o = document.querySelector('.detail-info .overview'); return { tag: o.tagName, rich: o.classList.contains('rich'), ps: o.querySelectorAll(':scope > p').length, lis: [...o.querySelectorAll('li')].map((x) => x.textContent), strong: o.querySelector('strong')?.textContent, links: [...o.querySelectorAll('a')].map((a) => a.getAttribute('href')), text: o.textContent, attrs: [...o.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name)).filter((n) => /^on/.test(n)), bad: !!o.querySelector('script, img, style') }; })()`);
  check('Handlung mit HTML: zwei Absaetze, Liste, fett', d.tag === 'DIV' && d.rich && d.ps === 2 && JSON.stringify(d.lis) === '["Eins","Zwei"]' && d.strong === 'Absatz', JSON.stringify(d));
  check('Nur http(s)-Links; javascript: wird zu Text', JSON.stringify(d.links) === '["https://example.com/info"]' && /Trick/.test(d.text), JSON.stringify(d.links));
  check('Entitaeten aufgeloest, keine Tags im Text', /Zweiter & letzter/.test(d.text) && !/[<>]/.test(d.text));
  check('Sicher: kein Skript, kein Bild, keine Ereignis-Attribute, nichts ausgefuehrt', !d.bad && d.attrs.length === 0 && (await ctx.run(`window.__x === undefined && window.__img === undefined && window.__js === undefined && window.__hover === undefined && window.__clicked === undefined`)), JSON.stringify(d.attrs));
  await ctx.capture(path.join(out, 'RT-detail.png'));

  await ctx.run(`location.hash = '#/item/${plain.Id}'`);
  await waitFor(`!!document.querySelector('.detail-info .overview') && document.querySelector('.detail-title')?.textContent`, 9000);
  await ctx.wait(400);
  const p = await ctx.run(`(() => { const o = document.querySelector('.detail-info .overview'); return { tag: o.tagName, rich: o.classList.contains('rich'), text: o.textContent }; })()`);
  check('Text ohne HTML: unveraendert als Absatz', p.tag === 'P' && !p.rich && p.text === plain.Overview, JSON.stringify(p));

  await ctx.run(`location.hash = '#/item/${series.Id}'`);
  await waitFor(`!!document.querySelector('.ep .ep-ov')`, 9000);
  const ep = await ctx.run(`[...document.querySelectorAll('.ep')].find((e) => e.dataset.id === ${JSON.stringify(episode.Id)})?.querySelector('.ep-ov')?.innerHTML ?? null`);
  check('Folgenliste: Vorschau ohne Tags und Leerzeilen', ep === 'Folge eins. Noch ein Satz.', JSON.stringify(ep));
  // Folgenkarte (Apple-App Build 95): Bild und Text auf einer deckenden Karte, die Rundung umschliesst die des Bildes
  const card = await ctx.run(`(() => { const e = document.querySelector('.ep'); const cs = getComputedStyle(e); const th = getComputedStyle(e.querySelector('.ep-thumb')); return { bg: cs.backgroundColor, outer: parseFloat(cs.borderTopLeftRadius), inner: parseFloat(th.borderTopLeftRadius), pad: parseFloat(cs.paddingLeft) }; })()`);
  check('Folgenkarte: deckende Flaeche, Rundung = Bildrundung + Innenrand', !/rgba\(0, 0, 0, 0\)|transparent/.test(card.bg) && Math.abs(card.outer - (card.inner + card.pad)) < 0.6, JSON.stringify(card));
  await ctx.capture(path.join(out, 'RT-episodes.png'));

  // Seite einer Folge: der Name der Serie vorn in der Angabenzeile fuehrt zur Serie
  await ctx.run(`location.hash = '#/item/${episode.Id}'`);
  await waitFor(`!!document.querySelector('.detail-meta .meta-series')`, 9000);
  const meta = await ctx.run(`(() => { const a = document.querySelector('.detail-meta .meta-series'); return { text: a.textContent, href: a.getAttribute('href'), first: a === document.querySelector('.detail-meta').firstElementChild, crumb: !!document.querySelector('.crumb') }; })()`);
  check('Folge: Serienname vorn in der Angabenzeile, fuehrt zur Serie (keine Brotkrume mehr)', meta.text === series.Name && meta.href === `#/item/${series.Id}` && meta.first && !meta.crumb, JSON.stringify(meta));
  await ctx.run(`document.querySelector('.detail-meta .meta-series').click()`);
  check('Klick oeffnet die Serie', await waitFor(`location.hash === '#/item/${series.Id}' && !!document.querySelector('.ep')`, 8000));

  console.log(`\nErgebnis: ${pass}/${pass + fail} Pruefungen bestanden`);
  server.close();
  if (fail) process.exitCode = 1;
};
