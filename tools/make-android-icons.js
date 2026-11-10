// Erzeugt die Startsymbole der Android-App aus build/icon.png (die weisse Wolke): je Dichte ic_launcher.png (abgerundetes Quadrat), ic_launcher_round.png (Kreis) und
// ic_launcher_foreground.png (Vordergrund des adaptiven Symbols, durchsichtig; Hintergrund = Farbe ic_launcher_background in values/). Dunkler Grund wie beim Symbol der Startanimation.
// Start (ohne node): electron.exe tools/make-android-icons.js
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res');
const BG = [0x0a, 0x0b, 0x10];
// Dichte: [Kantenlaenge des alten Symbols, Kantenlaenge des adaptiven Vordergrunds (108 dp)]
const DENSITIES = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA (gerade, nicht vormultipliziert) als PNG. */
function png(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bits
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const src = nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png'));
if (src.isEmpty()) throw new Error('build/icon.png fehlt');

/** Das Symbol auf iconSize skaliert als gerade RGBA-Pixel (BGRA aus Electron umgeordnet, bei Bedarf entvormultipliziert). */
function iconPixels(iconSize) {
  const bmp = src.resize({ width: iconSize, height: iconSize, quality: 'best' }).toBitmap();
  let premult = false;
  for (let i = 0; i < bmp.length; i += 4) {
    const a = bmp[i + 3];
    if (a > 20 && a < 235) {
      premult = Math.max(bmp[i], bmp[i + 1], bmp[i + 2]) <= a + 3; // eine weisse Wolke hat bei geradem Alpha ueberall Farbe 255
      break;
    }
  }
  const out = Buffer.alloc(iconSize * iconSize * 4);
  for (let i = 0; i < bmp.length; i += 4) {
    const a = bmp[i + 3];
    const k = premult && a > 0 ? 255 / a : 1;
    out[i] = Math.min(255, bmp[i + 2] * k);
    out[i + 1] = Math.min(255, bmp[i + 1] * k);
    out[i + 2] = Math.min(255, bmp[i] * k);
    out[i + 3] = a;
  }
  return out;
}

/** Deckung (0..1) der Form am Punkt (x, y) einer size*size-Flaeche; Kante mit etwa einem Bildpunkt Verlauf. */
function coverage(shape, size, x, y) {
  if (shape === 'none') return 0;
  if (shape === 'circle') return Math.max(0, Math.min(1, size / 2 - Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) + 0.5));
  // abgerundetes Quadrat, Radius 22 % der Kante
  const r = size * 0.22;
  const dx = Math.max(Math.abs(x + 0.5 - size / 2) - (size / 2 - r), 0);
  const dy = Math.max(Math.abs(y + 0.5 - size / 2) - (size / 2 - r), 0);
  return Math.max(0, Math.min(1, r - Math.hypot(dx, dy) + 0.5));
}

/** shape: 'square' | 'circle' (mit dunklem Grund) | 'none' (durchsichtig, Vordergrund); scale: Anteil der Kante, den das 512er-Symbol einnimmt */
function render(size, shape, scale) {
  const iconSize = Math.round(size * scale);
  const icon = iconPixels(iconSize);
  const off = Math.floor((size - iconSize) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = coverage(shape, size, x, y);
      let ca = 0;
      let c = [0, 0, 0];
      const ix = x - off;
      const iy = y - off;
      if (ix >= 0 && iy >= 0 && ix < iconSize && iy < iconSize) {
        const p = (iy * iconSize + ix) * 4;
        ca = icon[p + 3] / 255;
        c = [icon[p], icon[p + 1], icon[p + 2]];
      }
      const a = ca + m * (1 - ca);
      const o = (y * size + x) * 4;
      if (a > 0) {
        for (let k = 0; k < 3; k++) out[o + k] = Math.round((c[k] * ca + BG[k] * m * (1 - ca)) / a);
        out[o + 3] = Math.round(a * 255);
      }
    }
  }
  return png(out, size);
}

app.whenReady().then(() => {
  for (const [dpi, [legacy, adaptive]] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${dpi}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), render(legacy, 'square', 0.92));
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), render(legacy, 'circle', 0.86));
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), render(adaptive, 'none', 0.74));
    console.log(`mipmap-${dpi}: ${legacy} px und ${adaptive} px`);
  }
  app.quit();
});
