'use strict';
/**
 * Ambient Glow (src/shared/glow.js). Faelle aus JellycloudTests/GlowStyleTests.swift der Apple-App: Standard, getrennt gemerkte
 * Einzelfarbe und Verlauf, tolerantes Lesen, Bereiche, Zuruecksetzen, eigene Farben (Begrenzung auf 4,5:1), Reichweite, Startseite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Glow = require('../src/shared/glow');
const { luminance, contrast } = require('../src/shared/accent');

const STD = Glow.defaults();

test('Standard in jedem Bereich: an, Verlauf Lila zu Blau, 100 %', () => {
  for (const scope of Glow.SCOPES) {
    const s = Glow.resolve(STD, scope);
    assert.deepEqual([s.enabled, s.rgb, s.rgb2, s.intensity], [true, [94, 58, 190], [38, 78, 190], 100], scope);
  }
  assert.deepEqual(Glow.resolve(undefined, 'home').rgb, [94, 58, 190], 'nichts gespeichert = Standard');
  assert.ok(Glow.isStandard(STD) && Glow.isStandard({}));
  assert.deepEqual(Glow.SCOPES, ['home', 'movies', 'series', 'search', 'requests', 'libraries', 'signIn', 'settings']);
});

test('Einzelfarbe und Verlauf sind getrennt gemerkt: wer hin und her wechselt, findet beide Wahlen wieder', () => {
  let g = Glow.set.preset(STD, 'general', 'ember');
  g = Glow.set.color(g, 'general', 'teal');
  assert.deepEqual([Glow.resolve(g, 'movies').rgb, Glow.resolve(g, 'movies').rgb2], [[20, 140, 142], null], 'Einzelfarbe gilt');
  g = Glow.set.gradient(g, 'general', true);
  assert.deepEqual([Glow.resolve(g, 'movies').rgb, Glow.resolve(g, 'movies').rgb2], [[176, 40, 56], [186, 98, 34]], 'der Verlauf ist noch da');
  g = Glow.set.gradient(g, 'general', false);
  assert.equal(Glow.presetColor(g, 'general'), 'teal', 'die Einzelfarbe auch');
  assert.equal(Glow.presetGradient(g, 'general').id, 'ember');
});

test('Unlesbare oder unbekannte Werte verwerfen nicht die uebrigen Einstellungen; nur Abweichendes bleibt gespeichert', () => {
  const g = Glow.normalize({ enabled: 'ja', intensity: 140, color: 'pink', firstHex: 'nix', secondHex: '#ABCDEF', gradient: 'x', areas: { movies: 'kaputt', series: { enabled: false }, mars: { enabled: false }, search: { own: true, intensity: -5, color: 'red', gradient: false } } });
  assert.equal(g.enabled, true);
  assert.equal(g.intensity, 100, 'auf 0..100 begrenzt');
  assert.equal(g.color, 'purple');
  assert.equal(g.firstHex, '#5e3abe');
  assert.equal(g.secondHex, '#abcdef');
  assert.equal(g.gradient, true);
  assert.deepEqual(Object.keys(g.areas).sort(), ['search', 'series'], 'kaputter und unbekannter Bereich fallen weg');
  assert.equal(g.areas.series.enabled, false);
  assert.equal(g.areas.search.intensity, 0);
  assert.deepEqual(Glow.normalize({ areas: { movies: { enabled: true, own: false, color: 'red' } } }).areas, {}, 'ohne eigene Einstellung zaehlt die Farbe nicht, nichts weicht ab');
  assert.deepEqual(Glow.normalize(JSON.parse(JSON.stringify(g))), g, 'Speichern und Lesen ergibt dasselbe');
});

test('Ohne eigene Einstellung folgt jeder Bereich der allgemeinen; allgemeine Aenderungen lassen eigene in Ruhe', () => {
  let g = Glow.set.areaOwn(STD, 'series', true);
  assert.deepEqual(Glow.resolve(g, 'series').rgb, Glow.resolve(g, 'movies').rgb, 'eigene beginnt mit der allgemeinen');
  g = Glow.set.color(g, 'series', 'red');
  g = Glow.set.intensity(g, 'series', 40);
  g = Glow.set.preset(g, 'general', 'tide');
  assert.deepEqual([Glow.resolve(g, 'series').rgb, Glow.resolve(g, 'series').intensity], [[176, 40, 56], 40]);
  assert.deepEqual(Glow.resolve(g, 'movies').rgb, [38, 78, 190], 'Filme folgen der allgemeinen');
  g = Glow.set.areaOwn(g, 'series', false);
  assert.deepEqual(Glow.resolve(g, 'series').rgb, [38, 78, 190], 'ausgeschaltet gilt wieder die allgemeine');
  assert.ok(!('series' in g.areas), 'die eigene ist verworfen');
});

test('Jeder Bereich laesst sich ausschalten; insgesamt aus schaltet alle aus, ohne die Wahl je Bereich zu vergessen', () => {
  let g = Glow.set.areaEnabled(STD, 'search', false);
  assert.equal(Glow.resolve(g, 'search').enabled, false);
  assert.equal(Glow.resolve(g, 'home').enabled, true);
  g = Glow.set.enabled(g, false);
  assert.ok(Glow.SCOPES.every((s) => !Glow.resolve(g, s).enabled));
  g = Glow.set.enabled(g, true);
  assert.equal(Glow.resolve(g, 'search').enabled, false, 'die Wahl des Bereichs ist geblieben');
  assert.equal(Glow.resolve(g, 'home').enabled, true);
});

test('Zuruecksetzen: ein Bereich auf Standard, oder alles', () => {
  let g = Glow.set.areaOwn(STD, 'home', true);
  g = Glow.set.color(g, 'home', 'red');
  g = Glow.set.areaEnabled(g, 'search', false);
  g = Glow.set.intensity(g, 'general', 30);
  g = Glow.set.resetArea(g, 'home');
  assert.ok(!('home' in g.areas) && 'search' in g.areas);
  assert.equal(Glow.isStandard(g), false);
  assert.ok(Glow.isStandard(Glow.set.reset(g)));
});

test('Eigene Farbe mit oder ohne Raute, gross oder klein; eine feste loest sie ab; eine eigene gleich einer festen gilt als die feste', () => {
  for (const v of ['#2C5A8F', '2c5a8f', ' #2c5a8f ']) assert.equal(Glow.fields(Glow.set.customHex(STD, 'general', v), 'general').customHex, '#2c5a8f');
  assert.deepEqual(Glow.set.customHex(STD, 'general', 'nicht'), Glow.normalize(STD), 'Unsinn wird nicht uebernommen');
  let g = Glow.set.customHex(STD, 'general', '#2c5a8f');
  assert.equal(Glow.presetColor(g, 'general'), null);
  g = Glow.set.color(g, 'general', 'blue');
  assert.deepEqual([Glow.fields(g, 'general').customHex, Glow.presetColor(g, 'general')], ['', 'blue']);
  assert.equal(Glow.presetColor(Glow.set.customHex(STD, 'general', '#148c8e'), 'general'), 'teal');
});

test('Zu helle eigene Farben werden fuer die Flaeche abgedunkelt (4,5:1 fuer weisse Schrift bei 100 %), der Farbton bleibt', () => {
  for (const hex of ['#ffffff', '#ffe600', '#00ff66', '#ff8a00', '#66ccff', '#ff66cc', '#c0c0c0']) {
    let g = Glow.set.firstHex(STD, 'general', hex);
    g = Glow.set.secondHex(g, 'general', hex);
    const chosen = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const s = Glow.resolve(g, 'movies');
    for (const used of [s.rgb, s.rgb2]) {
      const onPage = used.map((v) => Math.round(v * Glow.peak(1)));
      assert.ok(contrast(1, luminance(onPage)) >= 4.5, `${hex} -> ${used}`);
      for (let i = 0; i < 3; i++) assert.ok(used[i] <= chosen[i]);
    }
    assert.equal(Glow.fields(g, 'general').firstHex, hex, 'gespeichert bleibt die gewaehlte Farbe');
  }
  assert.deepEqual(Glow.resolve(Glow.set.customHex(STD, 'general', '#2c5a8f'), 'movies').rgb, [44, 90, 143], 'dunkle eigene Farben bleiben');
  for (const id of Glow.COLOR_IDS) assert.deepEqual(Glow.surface(Glow.COLORS[id]), Glow.COLORS[id], id);
  for (const p of Glow.GRADIENTS) assert.ok(String(Glow.surface(p.from)) === String(p.from) && String(Glow.surface(p.to)) === String(p.to), p.id);
  assert.equal(new Set(Glow.GRADIENTS.map((p) => p.id)).size, 14);
});

test('Von oben und unten: jeder Schein reicht 58 % der Hoehe (hoechstens 760); in der Mitte zusammen hoechstens ein Sechstel', () => {
  for (const h of [568, 667, 844, 956, 640, 900, 1080, 1180, 1366]) {
    const reach = Glow.edgeReach(h);
    assert.ok(reach <= 760 && reach <= h * 0.58 + 0.001);
    const middle = h / 2;
    const share = middle < reach ? Glow.bellShare(Math.round((middle / reach) * 14), 15) : 0;
    assert.ok(2 * share <= 1 / 6, `Hoehe ${h}: ${2 * share}`);
  }
  assert.equal(Glow.edgeReach(2000, 600), 600, 'Telefon: hoechstens 600');
  assert.equal(Glow.bellShare(0, 15), 1);
  assert.equal(Glow.bellShare(14, 15), 0);
  assert.equal(Glow.bellStops(0.85).length, 15);
  assert.equal(Glow.peak(1), 0.85);
});

test('Startseite: mit Banner reicht der Schein von unten bis unter dessen Unterkante, ohne Banner so weit wie sonst', () => {
  assert.equal(Glow.homeReach(956, 694, 600), 262);
  assert.equal(Glow.homeReach(956, null, 600), 600);
  assert.equal(Glow.homeReach(2000, 300, 600), 600);
  assert.equal(Glow.homeReach(700, 690, 600), 160);
});

test('CSS: einfarbig ein elliptischer Verlauf, mit Verlauf Farben quer in der Form des Lichtflecks; aus = nichts', () => {
  const single = Glow.css(Glow.resolve(Glow.set.color(STD, 'general', 'teal'), 'home'), 'top');
  assert.match(single.background, /^radial-gradient\(100% 100% at 50% -8%, rgb\(20 140 142 \/ 0\.85\) 0%/);
  assert.equal(single.mask, 'none');
  const two = Glow.css(Glow.resolve(STD, 'home'), 'bottom');
  assert.equal(two.background, 'linear-gradient(90deg, rgb(94 58 190), rgb(38 78 190))');
  assert.match(two.mask, /at 50% 108%/);
  assert.match(two.mask, /rgb\(0 0 0 \/ 0\) 100%\)$/, 'laeuft am Rand auf null');
  assert.equal(Glow.css(Glow.resolve(Glow.set.enabled(STD, false), 'home'), 'top'), null);
  const half = Glow.css(Glow.resolve(Glow.set.intensity(Glow.set.color(STD, 'general', 'teal'), 'general', 50), 'home'), 'top');
  assert.match(half.background, /\/ 0\.425\) 0%/, '50 %: staerkste Stelle 0,425');
});
