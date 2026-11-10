// Blurhash-Decoder (kompakt). Liefert eine kleine Data-URL als weicher Platzhalter, bis das echte Bild geladen ist.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const decode83 = (str) => {
  let v = 0;
  for (const c of str) v = v * 83 + DIGITS.indexOf(c);
  return v;
};
const toLinear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v) => {
  v = Math.max(0, Math.min(1, v));
  return v <= 0.0031308 ? Math.round(v * 12.92 * 255 + 0.5) : Math.round((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5);
};
const signPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

function decodePixels(hash, width, height) {
  const sizeFlag = decode83(hash[0]);
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  const maxVal = (decode83(hash[1]) + 1) / 166;
  const colors = [];
  for (let i = 0; i < numX * numY; i++) {
    if (i === 0) {
      const v = decode83(hash.substring(2, 6));
      colors.push([toLinear(v >> 16), toLinear((v >> 8) & 255), toLinear(v & 255)]);
    } else {
      const v = decode83(hash.substring(4 + i * 2, 6 + i * 2));
      colors.push([signPow((Math.floor(v / 361) - 9) / 9, 2) * maxVal, signPow(((Math.floor(v / 19) % 19) - 9) / 9, 2) * maxVal, signPow(((v % 19) - 9) / 9, 2) * maxVal]);
    }
  }
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j++) {
        for (let i = 0; i < numX; i++) {
          const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
          const c = colors[i + j * numX];
          r += c[0] * basis;
          g += c[1] * basis;
          b += c[2] * basis;
        }
      }
      const o = 4 * (x + y * width);
      px[o] = toSrgb(r);
      px[o + 1] = toSrgb(g);
      px[o + 2] = toSrgb(b);
      px[o + 3] = 255;
    }
  }
  return px;
}

/**
 * Durchschnittsfarbe (sRGB) eines Blurhash. Sie steckt vollstaendig im DC-Anteil (Zeichen 2 bis 5), das Bild muss nicht dekodiert werden.
 * @returns {[number, number, number]|null}
 */
export function blurhashColor(hash) {
  if (typeof hash !== 'string' || hash.length < 6) return null;
  const dc = hash.substring(2, 6);
  for (const c of dc) if (DIGITS.indexOf(c) < 0) return null;
  const v = decode83(dc);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const cache = new Map();

/** @returns {string|null} Data-URL (PNG) oder null bei ungueltigem Hash */
export function blurhashUrl(hash, w = 24, h = 32) {
  if (!hash || hash.length < 6) return null;
  const key = `${hash}|${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  let url = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(decodePixels(hash, w, h), w, h), 0, 0);
    url = canvas.toDataURL();
  } catch {
    url = null;
  }
  if (cache.size > 800) cache.delete(cache.keys().next().value);
  cache.set(key, url);
  return url;
}
