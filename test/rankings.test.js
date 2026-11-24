'use strict';

// Top 10 (Plan P15): die Faelle der Apple-App (JellycloudTests/RankingRulesTests.swift ohne die entfernte TMDB-Anbindung; NumeralAuraTests.swift) mit
// denselben Zahlen, dazu das Laden ueber die Rueckseite gegen den Test-Server.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/shared/rankings');
const Glow = require('../src/shared/glow');
const Accent = require('../src/shared/accent');
const HR = require('../src/shared/home-rows');
const { SeerrClient } = require('../src/shared/seerr');
const { JellyfinClient } = require('../src/shared/jellyfin');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { server, state, SEERR, items, resetSeerr } = require('../tools/mock-server');

const ranking = (ids, kind = 'movies') => ids.map((id) => ({ tmdbId: id, kind, title: `T${id}` }));

// ---------- Apple: RankingRulesTests ----------

test('Zeitraeume: Seerr heute und Woche, nur heute, wenn der Server den Zeitraum uebergeht; Standard diese Woche', () => {
  assert.deepEqual(R.windows(true), ['day', 'week']);
  assert.deepEqual(R.windows(null), ['day', 'week']);
  assert.deepEqual(R.windows(false), ['day']);
  assert.equal(HR.DEFAULTS.rankingWindow, 'week');
  assert.equal(R.normWindow('quatsch'), 'week');
});

test('Die Reihenfolge der Trends bleibt; nur vorhandene Titel; hoechstens zehn', () => {
  const index = new Map(Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => n % 2 === 0).map((n) => [n, `item${n}`]));
  assert.deepEqual(R.match(ranking(Array.from({ length: 40 }, (_, i) => i + 1)), 'movies', index), Array.from({ length: 10 }, (_, i) => `item${(i + 1) * 2}`));
  assert.deepEqual(R.match(ranking([5, 2, 7, 4]), 'movies', index), ['item2', 'item4']);
});

test('Weniger als zehn vorhandene Titel: nur diese; keine vorhandenen: leer', () => {
  assert.deepEqual(R.match(ranking([1, 2, 3]), 'movies', new Map([[2, 'b']])), ['b']);
  assert.deepEqual(R.match(ranking([1, 2, 3]), 'movies', new Map()), []);
  assert.deepEqual(R.match([], 'movies', new Map([[1, 'a']])), []);
});

test('Kein Titel und kein Eintrag doppelt', () => {
  assert.deepEqual(R.match(ranking([7, 7, 8, 9, 8]), 'movies', new Map([[7, 'a'], [8, 'b'], [9, 'a']])), ['a', 'b']);
});

test('Filme und Serien bleiben getrennt, auch bei gleicher TMDB-Nummer', () => {
  const mixed = [...ranking([100, 200], 'movies'), ...ranking([100, 300], 'series')];
  assert.deepEqual(R.match(mixed, 'movies', new Map([[100, 'film100'], [200, 'film200']])), ['film100', 'film200']);
  assert.deepEqual(R.match(mixed, 'series', new Map([[100, 'serie100']])), ['serie100']);
  assert.deepEqual(R.match(ranking([100], 'series'), 'movies', new Map([[100, 'film100']])), []);
});

test('Der Zwischenspeicher gilt je Server, Profil, Seerr und Zeitraum', () => {
  const base = R.cacheKey({ server: 'https://a', user: 'u1', seerrAddress: 'https://seerr-a', window: 'week' });
  assert.notEqual(base, R.cacheKey({ server: 'https://b', user: 'u1', seerrAddress: 'https://seerr-a', window: 'week' }));
  assert.notEqual(base, R.cacheKey({ server: 'https://a', user: 'u2', seerrAddress: 'https://seerr-a', window: 'week' }));
  assert.notEqual(base, R.cacheKey({ server: 'https://a', user: 'u1', seerrAddress: 'https://seerr-b', window: 'week' }));
  assert.notEqual(base, R.cacheKey({ server: 'https://a', user: 'u1', seerrAddress: 'https://seerr-a', window: 'day' }));
  assert.equal(base, R.cacheKey({ server: 'https://a', user: 'u1', seerrAddress: 'https://seerr-a', window: 'week' }));
});

test('Die Beschriftung nennt Zeitraum, Mediathek und Quelle', () => {
  assert.equal(R.caption('week'), 'Im Trend diese Woche · aus deiner Mediathek · Quelle Seerr');
  assert.equal(R.caption('day'), 'Im Trend heute · aus deiner Mediathek · Quelle Seerr');
  assert.equal(R.caption('week', 'en'), 'Trending this week · from your library · source Seerr');
});

test('Die Top-10-Reihen gehoeren zu den Reihen der Startseite und lassen sich ordnen und ausblenden', () => {
  const order = HR.defaultOrder(['lib']);
  assert.deepEqual(order, ['continue', 'nextUp', 'myRequests', 'seerrWatchlist', 'top10Movies', 'top10Series', 'latest:lib', 'favorites', 'trending', 'seerrPopularMovies', 'seerrPopularSeries', 'seerrUpcomingMovies', 'seerrUpcomingSeries']);
  assert.ok(!HR.arrangeRows(order, [], ['top10Series']).includes('top10Series'));
  const moved = HR.moveRow(HR.arrangeAll(order, []), 'top10Movies', 3);
  assert.equal(HR.arrangeRows(order, moved, []).indexOf('top10Movies'), 7);
});

test('Wer seine Reihen schon geordnet hat, findet neue Reihen an ihrem vorgesehenen Platz, nicht am Ende', () => {
  const present = HR.defaultOrder(['a', 'b']);
  assert.deepEqual(HR.arrangeAll(present, ['continue', 'nextUp', 'latest:a', 'latest:b', 'favorites', 'trending']), ['continue', 'nextUp', 'myRequests', 'seerrWatchlist', 'top10Movies', 'top10Series', 'latest:a', 'latest:b', 'favorites', 'trending', 'seerrPopularMovies', 'seerrPopularSeries', 'seerrUpcomingMovies', 'seerrUpcomingSeries']);
  const custom = ['latest:b', 'nextUp', 'continue', 'trending', 'latest:a', 'favorites'];
  assert.deepEqual(HR.arrangeAll(present, custom), ['latest:b', 'nextUp', 'myRequests', 'seerrWatchlist', 'top10Movies', 'top10Series', 'continue', 'trending', 'seerrPopularMovies', 'seerrPopularSeries', 'seerrUpcomingMovies', 'seerrUpcomingSeries', 'latest:a', 'favorites']);
  assert.deepEqual(HR.arrangeAll(present, []), present);
  assert.deepEqual(HR.arrangeAll(HR.defaultOrder(['a', 'c', 'b']), HR.arrangeAll(present, custom)), ['latest:b', 'nextUp', 'myRequests', 'seerrWatchlist', 'top10Movies', 'top10Series', 'continue', 'trending', 'seerrPopularMovies', 'seerrPopularSeries', 'seerrUpcomingMovies', 'seerrUpcomingSeries', 'latest:a', 'latest:c', 'favorites']);
  assert.deepEqual(HR.arrangeAll(['continue', 'favorites'], ['favorites']), ['continue', 'favorites']);
});

// ---------- Seerr: Trends ----------

function seerrStub(answer) {
  const seen = [];
  const fetch = async (url) => {
    seen.push(new URL(url));
    return new Response(JSON.stringify(answer(new URL(url))), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { client: new SeerrClient({ baseUrl: 'https://trend.seerr.test', cookie: 's', fetch, language: 'de' }), seen };
}

test('Seerr befolgt Art und Zeitraum: nur die verlangte Art, Woche gilt', async () => {
  const { client, seen } = seerrStub(() => ({ page: 1, totalPages: 5, results: [{ id: 1, mediaType: 'movie', title: 'A' }, { id: 2, mediaType: 'movie', title: 'B' }] }));
  const page = R.parsePage(await client.trendingPage({ mediaType: 'movie', timeWindow: 'week', page: 1 }), 'movies', 1);
  assert.ok(page.honored);
  assert.ok(page.more);
  assert.deepEqual(page.titles.map((x) => x.tmdbId), [1, 2]);
  assert.equal(seen[0].pathname, '/api/v1/discover/trending');
  assert.equal(seen[0].searchParams.get('mediaType'), 'movie');
  assert.equal(seen[0].searchParams.get('timeWindow'), 'week');
});

test('Aelteres Seerr uebergeht die Angaben: gemischte Liste, nur die verlangte Art zaehlt, es gilt heute', () => {
  const page = R.parsePage({ page: 1, totalPages: 1, results: [{ id: 1, mediaType: 'movie', title: 'Film' }, { id: 9, mediaType: 'tv', name: 'Serie' }, { id: 5, mediaType: 'person', name: 'Jemand' }, { id: 2, mediaType: 'tv', name: 'Serie 2' }] }, 'series', 1);
  assert.equal(page.honored, false);
  assert.equal(page.more, false);
  assert.deepEqual(page.titles.map((x) => x.tmdbId), [9, 2]);
  assert.ok(page.titles.every((x) => x.kind === 'series'));
  // Eine leere Seite sagt nichts darueber, ob der Server die Angaben befolgt (sonst stuende ohne Serien im Trend "heute" statt "diese Woche")
  assert.equal(R.parsePage({ page: 1, totalPages: 1, results: [] }, 'series', 1).honored, null);
  assert.equal(R.parsePage({ results: [{ id: 5, mediaType: 'person', name: 'X' }] }, 'movies', 1).honored, false, 'nur Personen: nicht befolgt');
});

// ---------- Laden: Mediathek, Berechtigungen, Profilwechsel ----------

/** Ein Jellyfin-Stellvertreter: das Verzeichnis (TMDB-Nummer -> Eintrag) dieses Profils; Eintraege nur, die es sehen darf. */
function fakeJellyfin({ movies = {}, series = {}, delay = 0 } = {}) {
  const calls = { index: 0, items: 0 };
  const wait = () => new Promise((r) => setTimeout(r, delay));
  return {
    calls,
    async tmdbIndex(type) {
      calls.index++;
      await wait();
      return new Map(Object.entries(type === 'Series' ? series : movies).map(([k, v]) => [Number(k), v]));
    },
    async itemsInOrder(ids) {
      calls.items++;
      await wait();
      const allowed = new Set([...Object.values(movies), ...Object.values(series)]);
      return ids.filter((id) => allowed.has(id)).map((id) => ({ Id: id, Name: `Titel ${id}` }));
    }
  };
}
/** Ein Seerr, das die Trends je Art seitenweise liefert (befolgt Art und Zeitraum, je Seite 20). */
function fakeSeerr({ movies = [], series = [], fail = false } = {}) {
  const pages = [];
  return {
    pages,
    async rankingPage(kind, window, page) {
      pages.push(`${kind}:${page}`);
      if (fail) throw new Error('Netzwerkfehler: nicht erreichbar');
      const all = kind === 'movies' ? movies : series;
      const slice = all.slice((page - 1) * 20, page * 20);
      return R.parsePage({ page, totalPages: Math.max(1, Math.ceil(all.length / 20)), results: slice.map((id) => ({ id, mediaType: kind === 'movies' ? 'movie' : 'tv', title: `T${id}`, name: `T${id}` })) }, kind, page);
    }
  };
}

test('Zehn vorhandene Titel in der Reihenfolge der Trends, auch wenn sie erst auf spaeteren Seiten stehen; nicht mehr Seiten als noetig', async () => {
  const trend = Array.from({ length: 100 }, (_, i) => i + 1);
  const library = Object.fromEntries(trend.filter((n) => n % 5 === 0).map((n) => [n, `m${n}`]));
  const seerr = fakeSeerr({ movies: trend, series: [777] });
  const top = await R.load({ jellyfin: fakeJellyfin({ movies: library }), seerr, window: 'week' });
  assert.deepEqual(top.movies.map((i) => i.Id), Array.from({ length: 10 }, (_, i) => `m${(i + 1) * 5}`));
  assert.deepEqual(top.series, []);
  assert.equal(top.window, 'week');
  assert.equal(top.honors, true);
  assert.deepEqual(seerr.pages.filter((p) => p.startsWith('movies')), ['movies:1', 'movies:2', 'movies:3']);
});

test('Nie mehr als fuenf Seiten, auch wenn die Mediathek kaum etwas davon hat', async () => {
  const seerr = fakeSeerr({ movies: Array.from({ length: 400 }, (_, i) => i + 1) });
  const top = await R.load({ jellyfin: fakeJellyfin({ movies: { 9999: 'm' } }), seerr, window: 'day' });
  assert.deepEqual(top.movies, []);
  assert.equal(seerr.pages.filter((p) => p.startsWith('movies')).length, R.MAX_PAGES);
});

test('Ein Titel, den das Profil nicht sehen darf, erscheint nicht', async () => {
  const top = await R.load({ jellyfin: fakeJellyfin({ movies: { 1: 'm1', 3: 'm3' } }), seerr: fakeSeerr({ movies: [1, 2, 3], series: [1] }), window: 'week' });
  assert.deepEqual(top.movies.map((i) => i.Id), ['m1', 'm3']);
  assert.deepEqual(top.series, [], 'Serie 1 gibt es nicht, der Film 1 zaehlt dafuer nicht');
});

test('Ein aelteres Seerr liefert gemischt die Trends von heute; die Reihen zeigen das so an', async () => {
  const mixed = { rankingPage: async (kind, w, page) => R.parsePage({ page: 1, totalPages: 1, results: [{ id: 4, mediaType: 'tv', name: 'S' }, { id: 1, mediaType: 'movie', title: 'F' }, { id: 2, mediaType: 'movie', title: 'G' }] }, kind, page) };
  const top = await R.load({ jellyfin: fakeJellyfin({ movies: { 2: 'm2', 1: 'm1' }, series: { 4: 's4' } }), seerr: mixed, window: 'week' });
  assert.deepEqual(top.movies.map((i) => i.Id), ['m1', 'm2']);
  assert.deepEqual(top.series.map((i) => i.Id), ['s4']);
  assert.equal(top.honors, false);
  assert.equal(top.window, 'day', 'gewaehlt war diese Woche, geliefert wird heute: so steht es dann auch da');
});

test('Nicht erreichbares Seerr: das Laden scheitert mit einem Grund, ohne Ersatzinhalte', async () => {
  await assert.rejects(() => R.load({ jellyfin: fakeJellyfin({ movies: { 1: 'm1' } }), seerr: fakeSeerr({ fail: true }), window: 'week' }), /nicht erreichbar/);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Ohne Seerr gibt es keine Quelle: kein Schluessel, keine Anfrage, keine Reihen', async () => {
  const store = R.createStore();
  let asked = false;
  const r = await store.get(null, { full: async () => ((asked = true), {}), items: async () => [] });
  assert.deepEqual(r, { available: false });
  assert.equal(asked, false);
  assert.equal(store.status(null).available, false);
});

test('Profilwechsel: das alte Ergebnis verschwindet sofort, eine verspaetete Antwort des alten Profils wird verworfen', async () => {
  const seerr = fakeSeerr({ movies: [1, 2, 3] });
  const store = R.createStore();
  const slow = fakeJellyfin({ movies: { 1: 'm1', 2: 'm2', 3: 'm3' }, delay: 200 });
  const fast = fakeJellyfin({ movies: { 3: 'm3' } });
  const first = store.get('a|erwachsen', { full: () => R.load({ jellyfin: slow, seerr, window: 'week' }), items: (ids) => slow.itemsInOrder(ids) });
  assert.equal(store.status('a|erwachsen').loading, true);
  const second = await store.get('a|kind', { full: () => R.load({ jellyfin: fast, seerr, window: 'week' }), items: (ids) => fast.itemsInOrder(ids) });
  assert.deepEqual(second.movies.map((i) => i.Id), ['m3']);
  await assert.rejects(first, (e) => e.code === 'RANKINGS_STALE');
  assert.deepEqual(store.status('a|kind').result, { window: 'week', movies: 1, series: 0 }, 'die spaete Antwort ueberschreibt nichts');
});

test('Ein geladenes Ergebnis gilt eine halbe Stunde (die Eintraege werden frisch geholt); erst mit Zwang oder danach wird neu geladen; Fehler behalten die Liste', async () => {
  let clock = 1000;
  const store = R.createStore({ now: () => clock });
  const jf = fakeJellyfin({ movies: { 1: 'm1' } });
  let loads = 0;
  let failing = false;
  const opts = (force) => ({ force, full: async () => { loads++; if (failing) throw new Error('Seerr nicht erreichbar'); return R.load({ jellyfin: jf, seerr: fakeSeerr({ movies: [1] }), window: 'week' }); }, items: (ids) => jf.itemsInOrder(ids) });
  await store.get('k', opts(false));
  const itemsBefore = jf.calls.items;
  await store.get('k', opts(false));
  assert.equal(loads, 1, 'kein neues Laden der Rangfolge');
  assert.equal(jf.calls.items, itemsBefore + 2, 'die Eintraege beider Reihen kommen frisch');
  await store.get('k', opts(true));
  assert.equal(loads, 2, 'mit Zwang neu');
  clock += R.LIFETIME_MS + 1;
  failing = true;
  const kept = await store.get('k', opts(false));
  assert.equal(loads, 3, 'nach einer halben Stunde neu');
  assert.deepEqual(kept.movies.map((i) => i.Id), ['m1'], 'gescheitert: die Liste von vorhin bleibt');
  assert.match(kept.failure, /nicht erreichbar/);
  assert.equal(store.status('k').failure, 'Seerr nicht erreichbar');
  store.reset();
  assert.equal(store.status('k').result, null);
});

test('Zwei gleichzeitige Wuensche fuer dieselbe Anfrage teilen sich ein Laden', async () => {
  const store = R.createStore();
  let loads = 0;
  const o = { full: async () => (loads++, await wait(30), { window: 'week', honors: true, movies: [], series: [] }), items: async () => [] };
  await Promise.all([store.get('k', o), store.get('k', { ...o, force: true })]);
  assert.equal(loads, 1);
});

// ---------- Apple: NumeralAuraTests ----------

const auraOf = (color = 'purple', intensity = 100) => Glow.numeralAura({ enabled: true, rgb: Glow.COLORS[color], rgb2: null, intensity });
const hueOf = (rgb) => {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { degrees: ((h * 60) + 360) % 360, saturation: max ? d / max : 0 };
};
const distance = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

test('Ambient Glow aus: kein farbiger Rand, kein Schein; es bleibt der farblose Rand ohne Schein', () => {
  for (const c of Glow.COLOR_IDS) assert.equal(Glow.numeralAura({ enabled: false, rgb: Glow.COLORS[c], intensity: 100 }), null);
  const plain = Glow.NUMERAL_PLAIN;
  assert.ok(plain.glow === 0 && plain.halo === 0 && plain.rim > 0);
  assert.deepEqual(plain.tone, plain.toneEnd);
  assert.ok(hueOf(plain.tone).saturation < 0.3);
});

test('Der Verlauf liegt im Farbkreis beiderseits der Glow-Farbe, seine Enden sind sichtbar verschieden', () => {
  for (const c of Glow.COLOR_IDS) {
    const rgb = Glow.COLORS[c];
    if (hueOf(rgb).saturation < 0.18) continue;
    const base = hueOf(rgb).degrees;
    const [a, b] = Glow.gradientPair(rgb);
    assert.ok(distance(hueOf(a).degrees, base) <= 40, `${c}: ${a}`);
    assert.ok(distance(hueOf(b).degrees, base) <= 40, `${c}: ${b}`);
    assert.ok(distance(hueOf(a).degrees, hueOf(b).degrees) >= 45, c);
  }
  const [violet, blue] = Glow.gradientPair(Glow.COLORS.purple);
  assert.ok(violet[2] === Math.max(...violet) && violet[0] > violet[1], 'Violett: Blau am staerksten, mehr Rot als Gruen');
  assert.ok(blue[2] === Math.max(...blue) && blue[1] > blue[0], 'Blau: Blau am staerksten, mehr Gruen als Rot');
  const [light, base] = Glow.gradientPair(Glow.COLORS.neutral);
  assert.deepEqual(base, Glow.COLORS.neutral, 'fast farblos: der Verlauf geht ueber die Helligkeit');
  assert.ok(Accent.luminance(light) > Accent.luminance(base));
  for (const rgb of [[0, 0, 0], [255, 255, 255], [128, 128, 128], [255, 0, 0]]) assert.ok(Glow.gradientPair(rgb).flat().every((v) => v >= 0 && v <= 255));
});

test('Beide Enden des Randes haben in jeder Farbe und jedem Design mindestens 4,5:1 Kontrast zum Seitengrund', () => {
  const backgrounds = { midnight: '#08080a', graphite: '#131314', amoled: '#000000', midnightBlue: '#0c1426' }; // --bg in app.css
  for (const [theme, hex] of Object.entries(backgrounds)) {
    const bg = Accent.luminance(Accent.hexToRgb(hex));
    for (const c of Glow.COLOR_IDS) {
      const aura = auraOf(c);
      for (const tone of [aura.tone, aura.toneEnd]) assert.ok(Accent.contrast(Accent.luminance(tone), bg) >= 4.5, `${c} auf ${theme}`);
    }
  }
});

test('Die Intensitaet steuert nur die Scheine: 0 % ohne Schein, mehr Intensitaet mehr Schein, Rand und Farben bleiben', () => {
  const none = auraOf('purple', 0);
  assert.equal(none.glow, 0);
  assert.equal(none.halo, 0);
  assert.ok(none.rim > 0);
  let last = none;
  for (let p = 10; p <= 100; p += 10) {
    const next = auraOf('purple', p);
    assert.ok(next.glow > last.glow && next.halo > last.halo);
    assert.equal(next.rim, none.rim);
    assert.deepEqual([next.tone, next.toneEnd], [none.tone, none.toneEnd]);
    last = next;
  }
  assert.ok(last.glow <= 1 && last.halo <= 1);
});

test('Standard ist 100 %: dort leuchten beide Scheine voll; auch bei 40 % sind sie deutlich zu sehen; der Lichtschein liegt zwischen Glow-Farbe und Randton', () => {
  assert.equal(Glow.defaults().intensity, 100);
  const full = auraOf('purple', 100);
  const medium = auraOf('purple', 40);
  assert.equal(full.glow, 1);
  assert.equal(full.halo, 1);
  assert.ok(medium.glow >= 0.5 && medium.halo >= 0.5);
  assert.ok(auraOf('purple', 10).halo >= 0.2);
  const pair = Glow.gradientPair(Glow.COLORS.purple);
  for (let i = 0; i < 3; i++) {
    assert.ok(full.haloTone[i] >= Math.min(pair[0][i], full.tone[i]) && full.haloTone[i] <= Math.max(pair[0][i], full.tone[i]));
    assert.ok(full.haloToneEnd[i] >= Math.min(pair[1][i], full.toneEnd[i]) && full.haloToneEnd[i] <= Math.max(pair[1][i], full.toneEnd[i]));
  }
  // Ein gewaehlter Verlauf ist der Verlauf des Randes
  const own = Glow.numeralAura({ enabled: true, rgb: [94, 58, 190], rgb2: [20, 140, 142], intensity: 100 });
  assert.deepEqual(own.toneEnd, Glow.outlineTone([20, 140, 142]));
});

test('Der grosse Lichtschein endet genau an der Oberkante der Reihe und reicht seitlich hinter beide Plakate; die 10 ist breiter', () => {
  const m = R.metrics(150);
  for (const rank of [1, 10]) {
    const size = m.haloSize(rank);
    assert.ok(Math.abs(m.haloLift + size.height / 2 - m.posterH) < 0.01);
    assert.ok(size.width > m.numeralWidth(rank) + m.posterW);
  }
  assert.ok(m.numeralWidth(10) > m.numeralWidth(8) * 1.6);
  assert.equal(m.posterW, 168, 'Plakat 1,12 x so breit wie die Reihen');
  assert.equal(m.size, Math.round(m.posterH * 1.2));
  // Stufen des Lichtscheins: Glockenabfall, die Farbe wandert von der ersten zur zweiten
  const stops = Glow.haloStops(auraOf());
  assert.equal(stops.length, 15);
  assert.ok(stops[0].alpha > stops[7].alpha && stops[14].alpha < 0.001);
  assert.deepEqual(stops[14].rgb, auraOf().haloToneEnd);
});

test('Werte ausserhalb von 0 bis 100 % werden begrenzt', () => {
  assert.deepEqual(auraOf('purple', -20), auraOf('purple', 0));
  assert.deepEqual(auraOf('purple', 250), auraOf('purple', 100));
});

test('Texte der Einstellungen: "Aktuell" und der Fusstext', () => {
  assert.equal(R.currentLine({ connected: false }), 'Seerr ist nicht verbunden');
  assert.equal(R.currentLine({ connected: true, result: { window: 'week', movies: 10, series: 1 } }), 'Seerr · diese Woche · 10 Filme, 1 Serie');
  assert.equal(R.currentLine({ connected: true, loading: true }), 'Seerr · wird geladen …');
  assert.equal(R.currentLine({ connected: true, failure: 'x' }), 'Seerr · nicht erreichbar');
  assert.match(R.footer({ connected: false }), /Ohne Seerr bleiben die Reihen aus\./);
  assert.match(R.footer({ connected: true, honors: false }), /nur die Trends von heute/);
  assert.doesNotMatch(R.footer({ connected: true, honors: true }), /Ohne Seerr|nur die Trends/);
  assert.equal(R.detailLine({ ProductionYear: 2024, Genres: ['Science Fiction', 'Drama'] }), '2024 · Science Fiction');
  assert.equal(R.detailLine({}), '');
});

// ---------- Jellyfin: Verzeichnis und Eintraege ----------

test('Verzeichnis der Mediathek: seitenweise, schlank (nur ProviderIds, ohne Bilder und Nutzerdaten), der erste Eintrag gilt', async () => {
  const seen = [];
  const all = Array.from({ length: 5 }, (_, i) => ({ Id: `aaaaaaa${i}`, ProviderIds: i === 3 ? { tmdb: '11' } : { Tmdb: String(10 + (i % 3)) } }));
  const fetch = async (url) => {
    const u = new URL(url);
    seen.push(u);
    const start = Number(u.searchParams.get('startIndex'));
    const limit = Number(u.searchParams.get('limit'));
    return new Response(JSON.stringify({ Items: all.slice(start, start + limit) }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const c = new JellyfinClient({ baseUrl: 'http://jf.test', deviceId: 'dev-top', fetch });
  c.token = 't';
  c.userId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const index = await c.tmdbIndex('Movie', { pageSize: 2 });
  assert.deepEqual([...index.entries()], [[10, 'aaaaaaa0'], [11, 'aaaaaaa1'], [12, 'aaaaaaa2']], 'Nummer 10 kommt zweimal vor: der erste Eintrag gilt');
  assert.equal(seen.length, 3, 'drei Seiten (2, 2, 1)');
  assert.equal(seen[0].searchParams.get('fields'), 'ProviderIds');
  assert.equal(seen[0].searchParams.get('enableImages'), 'false');
  assert.equal(seen[0].searchParams.get('enableUserData'), 'false');
  await assert.rejects(() => c.tmdbIndex('Episode'), /Unbekannte Art/);
});

// ---------- Gegen den Test-Server ----------

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  resetSeerr();
  SEERR.old = false;
  state.log.length = 0;
});
function memoryConfig() {
  const store = { text: null };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  return new ConfigCore({ read: () => store.text, write: (t) => (store.text = t) }, codec, env);
}
const byName = (name) => [...items.values()].find((i) => i.Name === name).Id;
const trendCalls = () => state.log.filter((l) => l.at === 'seerr:GET /discover/trending').length;

test('Test-Server: ohne Seerr keine Anfrage; mit Seerr Filme und Serien der Mediathek in der Reihenfolge der Trends; Woche anders als heute; 30 min gemerkt', async () => {
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.14', locale: () => 'de-DE' });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  assert.deepEqual(await b.topTen({ window: 'week' }), { available: false });
  assert.equal(trendCalls(), 0, 'ohne Seerr geht keine Anfrage hinaus');
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  const day = await b.topTen({ window: 'day' });
  assert.equal(day.available, true);
  assert.equal(day.window, 'day');
  assert.deepEqual(day.movies.map((i) => i.Name), ['Paper Moons', 'Echoes of Tomorrow', 'Iron Meridian', 'Midnight Cartographers', 'Solar Winds', 'Velocity', 'Hollow Crown']);
  assert.deepEqual(day.series.map((i) => i.Name), ['Starfall Station', 'Harbor Lights']);
  const week = await b.topTen({ window: 'week' });
  assert.deepEqual([week.movies[0].Name, week.movies.at(-1).Name], ['Echoes of Tomorrow', 'Paper Moons'], 'die Woche hat eine andere Reihenfolge');
  const calls = trendCalls();
  await b.topTen({ window: 'week' });
  assert.equal(trendCalls(), calls, 'aus dem Speicher: Seerr wird nicht gefragt');
  assert.deepEqual(b.topTenStatus({ window: 'week' }).result, { window: 'week', movies: 7, series: 2 });
  await b.topTen({ window: 'week', force: true });
  assert.ok(trendCalls() > calls, 'Neu laden fragt Seerr wieder');
  assert.ok(day.movies.every((i) => i.Id === byName(i.Name)));
});

test('Test-Server: ein aelteres Seerr liefert nur heute; Seerr nicht erreichbar: Fehler ohne Ersatz', async () => {
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.14', locale: () => 'de-DE' });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  SEERR.old = true;
  const old = await b.topTen({ window: 'week' });
  assert.equal(old.window, 'day');
  assert.equal(old.honors, false);
  assert.ok(old.movies.length >= 1);
  assert.equal(b.topTenStatus({ window: 'week' }).honors, false);
  SEERR.old = false;
  SEERR.mode = 'down';
  await assert.rejects(() => b.topTen({ window: 'day' }));
  SEERR.mode = 'ok';
});
