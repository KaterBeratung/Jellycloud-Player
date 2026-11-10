'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { coverBounds, FULLSCREEN_MARGIN } = require('../src/main/fullscreen-bounds');

test('coverBounds: ringsum vergroessert, die Eingabe bleibt unveraendert', () => {
  const b = { x: 0, y: 0, width: 1536, height: 864 };
  assert.deepEqual(coverBounds(b), { x: -FULLSCREEN_MARGIN, y: -FULLSCREEN_MARGIN, width: 1536 + 2 * FULLSCREEN_MARGIN, height: 864 + 2 * FULLSCREEN_MARGIN });
  assert.deepEqual(b, { x: 0, y: 0, width: 1536, height: 864 });
  assert.deepEqual(coverBounds({ x: 1920, y: 100, width: 10, height: 20 }, 1), { x: 1919, y: 99, width: 12, height: 22 }, 'auch auf einem zweiten Bildschirm (x > 0) und mit anderem Rand');
});

/**
 * Nachgestellt: Electron arbeitet in geraeumigen Einheiten (DIP), rundet auf ganze Werte, und das Fenster belegt dann round/floor/ceil(Einheit * Skalierung) Bildpunkte.
 * Ohne Rand bleibt dabei bei gebrochener Skalierung manchmal eine Zeile oder Spalte des Bildschirms frei (dort sitzt der Taskleistenstreifen), mit Rand nie.
 */
function shortfalls(margin) {
  const out = [];
  const screens = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200], [2560, 1080], [2560, 1440], [2560, 1600], [3440, 1440], [3840, 2160]];
  const scales = [1, 1.1, 1.25, 1.33, 1.5, 1.75, 2, 2.25, 2.5, 3];
  const modes = { round: Math.round, floor: Math.floor, ceil: Math.ceil };
  for (const [W, H] of screens) {
    for (const s of scales) {
      // Bildschirm in Einheiten (gebrochen), Fenster = auf ganze Einheiten gerundet, mit Rand
      const dip = { x: Math.round(0 / s) - margin, y: Math.round(0 / s) - margin, width: Math.round(W / s) + 2 * margin, height: Math.round(H / s) + 2 * margin };
      for (const [name, fn] of Object.entries(modes)) {
        const left = fn(dip.x * s);
        const top = fn(dip.y * s);
        const right = fn((dip.x + dip.width) * s);
        const bottom = fn((dip.y + dip.height) * s);
        if (left > 0 || top > 0 || right < W || bottom < H) out.push(`${W}x${H}@${s} ${name}`);
      }
    }
  }
  return out;
}

test('Rundung: ohne Rand bleibt bei gebrochener Skalierung eine Bildpunktzeile frei, mit dem Rand des Overlays nie', () => {
  assert.ok(shortfalls(0).length > 0, 'ohne Rand gibt es Faelle, in denen das Fenster kuerzer als der Bildschirm ist (so entsteht der Streifen)');
  assert.deepEqual(shortfalls(FULLSCREEN_MARGIN), [], 'mit Rand bedeckt das Fenster den Bildschirm immer ganz');
});
