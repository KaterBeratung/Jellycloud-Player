/* Gemeinsames Modul: Ambient Glow, ein weicher Lichtschein vom oberen und unteren Rand hinter dem Inhalt (wie in der Apple-App).
   Reine Regeln ohne Oberflaeche: Farben, Verlaeufe, Bereiche, Standard, tolerantes Lesen, Aendern der Einstellung, Aufloesen je Bereich
   (EINE Lesestelle: resolve), Begrenzen eigener Farben, Glockenabfall und Reichweite. Gezeichnet wird in src/renderer/js/glow.js.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCGlow); braucht src/shared/accent.js.
   Vorlage: Jellycloud/Design/AmbientGlow.swift der Apple-App (Build 87 bis 93), Werte aus Notizen/design-system.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./accent'));
  else root.JCGlow = factory(root.JCAccent);
})(typeof self !== 'undefined' ? self : this, function (Accent) {
  'use strict';

  /** Feste Einzelfarben (gedeckt: weisse Schrift bleibt auf der staerksten Stelle lesbar). */
  var COLORS = { purple: [94, 58, 190], blue: [38, 78, 190], violet: [148, 62, 200], teal: [20, 140, 142], red: [176, 40, 56], neutral: [132, 138, 156] };
  var COLOR_IDS = ['purple', 'blue', 'violet', 'teal', 'red', 'neutral'];

  /** Vorgegebene Verlaeufe (erste -> zweite Farbe), der erste ist der Standard. Gespeichert wird ein Verlauf als seine zwei Farben. */
  var GRADIENTS = [
    { id: 'aurora', from: [94, 58, 190], to: [38, 78, 190] }, // Lila zu Blau (Standard)
    { id: 'tide', from: [38, 78, 190], to: [18, 132, 178] }, // Blau zu Cyan
    { id: 'night', from: [30, 48, 140], to: [124, 58, 196] }, // Dunkelblau zu Violett
    { id: 'orchid', from: [120, 56, 196], to: [176, 44, 150] }, // Violett zu Magenta
    { id: 'dusk', from: [148, 62, 200], to: [190, 52, 128] }, // Lila zu Pink
    { id: 'rose', from: [186, 50, 124], to: [176, 40, 56] }, // Pink zu Rot
    { id: 'ember', from: [176, 40, 56], to: [186, 98, 34] }, // Rot zu Orange
    { id: 'amber', from: [184, 92, 30], to: [160, 124, 32] }, // Orange zu Gold
    { id: 'lagoon', from: [20, 140, 142], to: [38, 78, 190] }, // Tuerkis zu Blau
    { id: 'reef', from: [20, 136, 138], to: [34, 138, 72] }, // Tuerkis zu Gruen
    { id: 'meadow', from: [36, 132, 64], to: [40, 148, 118] }, // Gruen zu Mint
    { id: 'emerald', from: [16, 122, 88], to: [30, 48, 140] }, // Smaragdgruen zu Dunkelblau
    { id: 'gilt', from: [160, 124, 32], to: [150, 128, 92] }, // Gold zu Champagner
    { id: 'frost', from: [128, 134, 150], to: [30, 48, 140] } // Silber zu Dunkelblau
  ];

  /**
   * Bereiche mit eigenem Ambient Glow. Kein Ambient Glow im Player, auf Detailseiten, in Menues und Dialogen.
   * home Startseite; movies Seite Filme (und Bibliotheken mit Filmen); series Serien; search Suche; requests Anfragen (mit Seerr);
   * libraries andere Mediatheken; signIn Anmeldung und Server hinzufuegen; settings alle Seiten der Einstellungen (und Verwaltung).
   */
  var SCOPES = ['home', 'movies', 'series', 'search', 'requests', 'libraries', 'signIn', 'settings'];

  var hex = function (rgb) { return '#' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); };
  /** Eine eingegebene Farbe in der gespeicherten Form ("#rrggbb", klein), sonst ''. */
  function normHex(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (s && s.charAt(0) !== '#') s = '#' + s;
    return /^#[0-9a-f]{6}$/.test(s) ? s : '';
  }
  var parse = function (v) { var s = normHex(v); return s ? Accent.hexToRgb(s) : null; };
  var same = function (a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; };

  /** Felder einer Einstellung (allgemein und je Bereich dieselben). */
  function fieldsDefaults() {
    return { color: 'purple', customHex: '', gradient: true, firstHex: hex(GRADIENTS[0].from), secondHex: hex(GRADIENTS[0].to), intensity: 100 };
  }
  /** Standard ueberall: an, Verlauf Lila zu Blau, 100 %, alle Bereiche an und ohne eigene Einstellung. */
  function defaults() {
    var d = fieldsDefaults();
    d.enabled = true;
    d.areas = {};
    return d;
  }

  /** Einzelfarbe in gespeicherter Form: gleicht die eigene Farbe einer festen, gilt die feste. */
  function normalizedSingle(color, customHex) {
    var rgb = parse(customHex);
    var c = COLOR_IDS.indexOf(color) >= 0 ? color : 'purple';
    if (!rgb) return { color: c, customHex: '' };
    for (var i = 0; i < COLOR_IDS.length; i++) if (same(COLORS[COLOR_IDS[i]], rgb)) return { color: COLOR_IDS[i], customHex: '' };
    return { color: c, customHex: hex(rgb) };
  }

  /** Felder tolerant lesen: Unlesbares bekommt seinen Standard, ein Feld zieht kein anderes mit. */
  function readFields(raw) {
    var d = fieldsDefaults();
    var r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var single = normalizedSingle(r.color, r.customHex);
    var n = Number(r.intensity);
    return {
      color: single.color,
      customHex: single.customHex,
      gradient: typeof r.gradient === 'boolean' ? r.gradient : d.gradient,
      firstHex: normHex(r.firstHex) || d.firstHex,
      secondHex: normHex(r.secondHex) || d.secondHex,
      intensity: r.intensity !== null && r.intensity !== '' && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d.intensity
    };
  }

  var isDefaultArea = function (a) { return JSON.stringify(a) === JSON.stringify(areaDefaults()); };
  function areaDefaults() {
    var a = fieldsDefaults();
    a.enabled = true;
    a.own = false;
    return a;
  }
  /** Ein Bereich tolerant: ohne eigene Einstellung zaehlen nur an/aus (Farben bleiben im Standard, sie wirken nicht). */
  function readArea(raw) {
    var r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var a = r.own === true ? readFields(r) : fieldsDefaults();
    a.enabled = typeof r.enabled === 'boolean' ? r.enabled : true;
    a.own = r.own === true;
    return a;
  }

  /** Die ganze Einstellung tolerant lesen (gespeicherte Datei, Oberflaeche). Bereiche, die dem Standard gleichen, entfallen. */
  function normalize(raw) {
    var r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var g = readFields(r);
    g.enabled = typeof r.enabled === 'boolean' ? r.enabled : true;
    g.areas = {};
    var areas = r.areas && typeof r.areas === 'object' && !Array.isArray(r.areas) ? r.areas : {};
    SCOPES.forEach(function (s) {
      if (!(s in areas)) return;
      var a = readArea(areas[s]);
      if (!isDefaultArea(a)) g.areas[s] = a;
    });
    return g;
  }

  /** Die Einstellung eines Bereichs (Standard, wenn nichts abweicht). */
  function area(glow, scope) { return glow.areas && glow.areas[scope] ? readArea(glow.areas[scope]) : areaDefaults(); }
  var fieldsOf = function (glow, target) { return target === 'general' ? readFields(glow) : area(glow, target); };

  /** Staerkste Deckkraft der Flaeche bei dieser Intensitaet (0 bis 1): 85 %. */
  function peak(intensity) { return Math.min(Math.max(intensity, 0), 1) * 0.85; }

  /**
   * Eine Farbe als Flaechenfarbe: so weit abgedunkelt (alle Kanaele im selben Verhaeltnis, in 2-%-Schritten), dass weisse Schrift auf
   * der staerksten Stelle bei 100 % mindestens 4,5:1 hat. Die festen Farben und Verlaeufe liegen darunter und bleiben, wie sie sind.
   */
  function surface(rgb) {
    var strongest = peak(1);
    for (var step = 0; step <= 45; step++) {
      var share = 1 - step * 0.02;
      var shade = rgb.map(function (v) { return Math.round(v * share); });
      var onPage = shade.map(function (v) { return Math.round(v * strongest); });
      if (Accent.contrast(1, Accent.luminance(onPage)) >= 4.5) return shade;
    }
    return rgb.map(function (v) { return Math.floor(v / 10); });
  }

  function chosenSingle(f) { return parse(f.customHex) || COLORS[f.color] || COLORS.purple; }
  function gradientRgb(f) { return [parse(f.firstHex) || GRADIENTS[0].from, parse(f.secondHex) || GRADIENTS[0].to]; }
  function colorName(rgb) {
    for (var i = 0; i < COLOR_IDS.length; i++) if (same(COLORS[COLOR_IDS[i]], rgb)) return COLOR_IDS[i];
    return 'custom-' + hex(rgb).slice(1);
  }

  /** Stil einer gespeicherten Einstellung: { enabled, rgb, rgb2 (bei Verlauf, sonst null), intensity, name }. */
  function style(glow, target, enabled) {
    var f = fieldsOf(glow, target);
    if (f.gradient) {
      var g = gradientRgb(f);
      return { enabled: enabled, rgb: surface(g[0]), rgb2: surface(g[1]), intensity: f.intensity, name: colorName(g[0]) + '+' + hex(surface(g[1])).slice(1) };
    }
    var single = chosenSingle(f);
    return { enabled: enabled, rgb: surface(single), rgb2: null, intensity: f.intensity, name: colorName(single) };
  }

  /**
   * DIE Lesestelle: die Einstellung eines Bereichs. An, wenn der Ambient Glow insgesamt und in diesem Bereich an ist; Farbe und
   * Intensitaet aus der eigenen Einstellung des Bereichs, sonst aus der allgemeinen.
   */
  function resolve(glow, scope) {
    var g = normalize(glow);
    var a = area(g, scope);
    return style(g, a.own ? scope : 'general', g.enabled && a.enabled);
  }
  /** Die allgemeine Einstellung (Vorschau). */
  function general(glow) { var g = normalize(glow); return style(g, 'general', g.enabled); }
  /** Die Einstellung, wie sie unter einem Ziel gespeichert ist (Vorschau eines Bereichs, auch wenn er sie gerade nicht verwendet). */
  function styleOf(glow, target) { var g = normalize(glow); return style(g, target, true); }

  // ---------- Aendern (rein: liefert eine neue Einstellung) ----------
  function editFields(glow, target, change) {
    var g = normalize(glow);
    if (target === 'general') {
      var f = readFields(g);
      change(f);
      var out = readFields(f);
      out.enabled = g.enabled;
      out.areas = g.areas;
      return normalize(out);
    }
    var a = area(g, target);
    change(a);
    g.areas[target] = a;
    return normalize(g);
  }
  var targetOk = function (t) { return t === 'general' || SCOPES.indexOf(t) >= 0; };

  var set = {
    /** Insgesamt an/aus: aus schaltet jeden Bereich aus, die Wahl je Bereich bleibt gemerkt. */
    enabled: function (glow, on) { var g = normalize(glow); g.enabled = !!on; return g; },
    /** Einen Bereich zeigen oder nicht. */
    areaEnabled: function (glow, scope, on) { if (SCOPES.indexOf(scope) < 0) return normalize(glow); var g = normalize(glow); var a = area(g, scope); a.enabled = !!on; g.areas[scope] = a; return normalize(g); },
    /** Eigene Einstellung fuer einen Bereich: beim Einschalten beginnt sie mit der allgemeinen, beim Ausschalten wird sie verworfen. */
    areaOwn: function (glow, scope, own) {
      var g = normalize(glow);
      if (SCOPES.indexOf(scope) < 0 || area(g, scope).own === !!own) return g;
      var enabled = area(g, scope).enabled;
      var a = own ? readFields(g) : fieldsDefaults();
      a.enabled = enabled;
      a.own = !!own;
      g.areas[scope] = a;
      return normalize(g);
    },
    /** Einen Bereich auf den Standard: an, allgemeine Einstellung. */
    resetArea: function (glow, scope) { var g = normalize(glow); delete g.areas[scope]; return g; },
    /** Alles auf den Standard. */
    reset: function () { return defaults(); },
    /** Feste Einzelfarbe; es gilt die Einzelfarbe, die Farben des Verlaufs bleiben gemerkt. */
    color: function (glow, target, id) { if (!targetOk(target) || COLOR_IDS.indexOf(id) < 0) return normalize(glow); return editFields(glow, target, function (f) { f.color = id; f.customHex = ''; f.gradient = false; }); },
    /** Eigene Einzelfarbe ("#rrggbb"; anderes wird nicht uebernommen). */
    customHex: function (glow, target, v) { if (!targetOk(target) || !normHex(v)) return normalize(glow); return editFields(glow, target, function (f) { var s = normalizedSingle(f.color, v); f.color = s.color; f.customHex = s.customHex; f.gradient = false; }); },
    /** Farbverlauf an oder aus; Verlauf und Einzelfarbe bleiben beide gemerkt. */
    gradient: function (glow, target, on) { if (!targetOk(target)) return normalize(glow); return editFields(glow, target, function (f) { f.gradient = !!on; }); },
    /** Vorgegebener Verlauf; es gilt der Verlauf. */
    preset: function (glow, target, id) {
      var p = GRADIENTS.filter(function (x) { return x.id === id; })[0];
      if (!targetOk(target) || !p) return normalize(glow);
      return editFields(glow, target, function (f) { f.firstHex = hex(p.from); f.secondHex = hex(p.to); f.gradient = true; });
    },
    /** Erste oder zweite Farbe des Verlaufs ("#rrggbb"); es gilt der Verlauf. */
    firstHex: function (glow, target, v) { if (!targetOk(target) || !normHex(v)) return normalize(glow); return editFields(glow, target, function (f) { f.firstHex = normHex(v); f.gradient = true; }); },
    secondHex: function (glow, target, v) { if (!targetOk(target) || !normHex(v)) return normalize(glow); return editFields(glow, target, function (f) { f.secondHex = normHex(v); f.gradient = true; }); },
    intensity: function (glow, target, n) { if (!targetOk(target) || !Number.isFinite(Number(n))) return normalize(glow); return editFields(glow, target, function (f) { f.intensity = Math.min(100, Math.max(0, Math.round(Number(n)))); }); }
  };

  /** Ob irgendetwas vom Standard abweicht (der Knopf zum Zuruecksetzen hat sonst nichts zu tun). */
  function isStandard(glow) { return JSON.stringify(normalize(glow)) === JSON.stringify(defaults()); }
  /** Die gewaehlte feste Einzelfarbe (null bei einer eigenen) und der vorgegebene Verlauf, dem die Farben gleichen (null bei einem eigenen). */
  function presetColor(glow, target) { var f = fieldsOf(normalize(glow), target); return parse(f.customHex) ? null : f.color; }
  function presetGradient(glow, target) {
    var g = gradientRgb(fieldsOf(normalize(glow), target));
    return GRADIENTS.filter(function (p) { return same(p.from, g[0]) && same(p.to, g[1]); })[0] || null;
  }
  function fields(glow, target) { return fieldsOf(normalize(glow), target); }

  // ---------- Form des Lichts ----------
  /** Anteil der Deckkraft an Stufe index von count Stufen des Glockenabfalls (1 in der Mitte, 0 am Rand). */
  function bellShare(index, count) {
    var floor = Math.exp(-3.4);
    var t = index / Math.max(count - 1, 1);
    return (Math.exp(-3.4 * t * t) - floor) / (1 - floor);
  }
  /** Die 15 Stufen eines Lichtflecks: [{ alpha, at (0..1) }]. */
  function bellStops(pk) {
    var out = [];
    for (var i = 0; i <= 14; i++) out.push({ alpha: pk * bellShare(i, 15), at: i / 14 });
    return out;
  }
  /** Reichweite jedes der beiden Scheine von oben und unten: 58 % der Hoehe, hoechstens limit (Telefon 600, sonst 760). */
  function edgeReach(height, limit) { return Math.max(0, Math.min(limit == null ? 760 : limit, height * 0.58)); }
  /**
   * Startseite: mit Banner reicht der Schein von unten nur bis unter dessen Unterkante in Ruhelage (mindestens 160), nie weiter als auf den
   * anderen Seiten; ohne Banner so weit wie dort (HomeView.homeGlowReach der Apple-App). bannerBottom null: kein Banner.
   */
  function homeReach(screen, bannerBottom, limit) {
    var page = limit == null ? 760 : limit;
    if (bannerBottom == null) return page;
    return Math.min(page, Math.max(160, screen - bannerBottom));
  }

  /**
   * CSS fuer einen der beiden Scheine (edge 'top' | 'bottom'): ein elliptischer Verlauf, Mittelpunkt waagerecht mittig und 8 % der Hoehe
   * ausserhalb des Randes, Radien so breit und so hoch wie die Flaeche. Einfarbig: der Verlauf selbst; mit zwei Farben: die Farben
   * nebeneinander (background) in der Form des Lichtflecks (mask). Keine Unschaerfe, keine Bewegung.
   */
  function css(st, edge) {
    if (!st || !st.enabled) return null;
    var at = edge === 'bottom' ? '50% 108%' : '50% -8%';
    var stops = bellStops(peak(st.intensity / 100));
    var shape = function (rgb) {
      return 'radial-gradient(100% 100% at ' + at + ', ' + stops.map(function (s) { return 'rgb(' + rgb.join(' ') + ' / ' + (Math.round(s.alpha * 10000) / 10000) + ') ' + (Math.round(s.at * 10000) / 100) + '%'; }).join(', ') + ')';
    };
    if (!st.rgb2) return { background: shape(st.rgb), mask: 'none' };
    return { background: 'linear-gradient(90deg, rgb(' + st.rgb.join(' ') + '), rgb(' + st.rgb2.join(' ') + '))', mask: shape([0, 0, 0]) };
  }

  // ---------- Rangziffern der Top 10 (Rand und Schein in der Farbe des Ambient Glow; Apple: Features/Home/TopTenAura.swift) ----------
  /**
   * Die zwei Farben eines harmonischen Verlaufs zu einer Farbe: ihre Nachbarn im Farbkreis, 28 Grad zur einen und 34 Grad zur anderen Seite, bei gleicher
   * Saettigung und Helligkeit (Dunkles Lila: Violett und Blau). Eine fast farblose Farbe (Saettigung unter 18 %) hat keinen Farbton zum Drehen: ihr Verlauf geht
   * von einer 30 % helleren zur gewaehlten Stufe.
   */
  function gradientPair(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var high = Math.max(r, g, b), low = Math.min(r, g, b), span = high - low;
    var saturation = high === 0 ? 0 : span / high;
    if (saturation < 0.18 || span <= 0) return [rgb.map(function (v) { return v + Math.trunc((255 - v) * 3 / 10); }), rgb.slice()];
    var hue = high === r ? ((g - b) / span) % 6 : high === g ? (b - r) / span + 2 : (r - g) / span + 4;
    hue *= 60;
    var color = function (degrees) {
      var hh = (((degrees % 360) + 360) % 360) / 60;
      var c = high * saturation, x = c * (1 - Math.abs((hh % 2) - 1)), m = high - c;
      var parts = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(hh))];
      return parts.map(function (v) { return Math.round((v + m) * 255); });
    };
    return [color(hue + 28), color(hue - 34)];
  }
  /**
   * Eine Glow-Farbe als Linienfarbe: die Farben sind fuer grosse, weiche Flaechen gewaehlt und dunkel; als feine Linie waeren sie auf dem dunklen Seitengrund
   * kaum zu sehen. Der Ton geht in Schritten auf Weiss zu, bis seine Helligkeit fuer 4,5:1 zum Seitengrund reicht; der Farbcharakter bleibt.
   */
  function outlineTone(rgb) {
    for (var step = 0; step <= 20; step++) {
      var tone = rgb.map(function (v) { return Math.round(v + (255 - v) * step / 20); });
      if (Accent.luminance(tone) >= 0.21) return tone;
    }
    return [255, 255, 255];
  }
  /**
   * Was um eine Rangziffer gezeichnet wird, aus der Glow-Einstellung ihres Bereichs (resolve: "Top 10 Filme" die der Filme, "Top 10 Serien" die der
   * Serien): die zwei Farben des Randes (von oben links nach unten rechts), seine Deckkraft, die Staerke des Scheins an der Kontur und des grossen
   * Lichtscheins dahinter (beide wachsen mit der Wurzel der Intensitaet) und dessen Farben. Ist ein Verlauf gewaehlt, ist er der Verlauf des Randes.
   * Ambient Glow aus: null (dann NUMERAL_PLAIN).
   */
  function numeralAura(st) {
    if (!st || !st.enabled) return null;
    var share = Math.min(Math.max(Number(st.intensity) || 0, 0), 100) / 100;
    var pair = st.rgb2 ? [st.rgb, st.rgb2] : gradientPair(st.rgb);
    var tone = outlineTone(pair[0]), toneEnd = outlineTone(pair[1]);
    var mid = function (a, b) { return a.map(function (v, i) { return Math.trunc((v + b[i]) / 2); }); };
    return { tone: tone, toneEnd: toneEnd, rim: 1, glow: Math.sqrt(share), haloTone: mid(pair[0], tone), haloToneEnd: mid(pair[1], toneEnd), halo: Math.sqrt(share) };
  }
  /** Ohne Ambient Glow: die dunkle Ziffer mit einem ruhigen, farblosen Rand, ohne Schein. */
  var NUMERAL_PLAIN = { tone: [120, 120, 130], toneEnd: [120, 120, 130], rim: 0.7, glow: 0, haloTone: [120, 120, 130], haloToneEnd: [120, 120, 130], halo: 0 };
  /** Stufen des grossen Lichtscheins: Glockenabfall der Deckkraft wie beim Ambient Glow, die Farbe wandert dabei von der ersten zur zweiten des Verlaufs. */
  function haloStops(aura) {
    var count = 15;
    var out = [];
    for (var i = 0; i < count; i++) {
      var t = Math.min(i / (count - 1) * 1.6, 1);
      out.push({ rgb: aura.haloTone.map(function (v, k) { return Math.round(v + (aura.haloToneEnd[k] - v) * t); }), alpha: bellShare(i, count) * aura.halo, at: i / (count - 1) });
    }
    return out;
  }

  return {
    gradientPair: gradientPair, outlineTone: outlineTone, numeralAura: numeralAura, NUMERAL_PLAIN: NUMERAL_PLAIN, haloStops: haloStops,
    COLORS: COLORS, COLOR_IDS: COLOR_IDS, GRADIENTS: GRADIENTS, SCOPES: SCOPES,
    defaults: defaults, normalize: normalize, area: area, fields: fields, resolve: resolve, general: general, styleOf: styleOf, set: set,
    isStandard: isStandard, presetColor: presetColor, presetGradient: presetGradient,
    surface: surface, peak: peak, bellShare: bellShare, bellStops: bellStops, edgeReach: edgeReach, homeReach: homeReach, css: css, hex: hex, normHex: normHex
  };
});
