// Erzeugt alle App-Symbole aus den Ebenen des Symbols der iOS-App (seit 1.2.30; Wunsch des Nutzers: ueberall dasselbe Logo wie auf iPhone, Mac und
// Apple TV). Die Ebenen stammen aus dem Apple-TV-Symbol der iOS-App (Assets.xcassets > App Icon - App Store, je 1280 x 768) und liegen in build/symbol/:
//   hintergrund.png  lila-blauer Verlauf (oben Lila, Mitte dunkel, unten Blau)
//   wolke.png        die weisse Glaswolke mit Schatten, durchsichtig
//   play.png         das Play-Dreieck, durchsichtig
// Ein Quadrat zeigt den Verlauf auf der ganzen Flaeche und Wolke und Play so gross wie im Symbol der iOS-App (Wolke etwa 55 % der Breite).
//  - build/icon.png (1024 px): Windows (Programm, Taskleiste, Fenster, Installer); abgerundetes Quadrat, Ecken durchsichtig.
//  - Android je Dichte (mipmap-*): ic_launcher.png (altes Symbol: abgerundetes Quadrat), ic_launcher_round.png (Kreis) und das adaptive Symbol aus zwei
//    Ebenen wie unter iOS: ic_launcher_background.png (Verlauf) und ic_launcher_foreground.png (Wolke und Play, durchsichtig). Sichtbar sind die mittleren
//    72 von 108 dp, dort steht genau das Quadrat; ausserhalb laufen die Randfarben des Verlaufs weiter (Masken und Wackeln zeigen keine Kante). Der
//    Startbildschirm von Android 12+ zeigt den Vordergrund (weisse Wolke) auf dunklem Grund.
//  - Android TV: drawable-xhdpi/tv_banner.png (320 x 180), Verlauf, Wolke und Name.
// Start: npm run icon (Electron; Chromium skaliert mit hoher Qualitaet)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LAYERS = path.join(ROOT, 'build', 'symbol');
const RES = path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res');
// Dichte: [Kantenlaenge des alten und runden Symbols, Kantenlaenge einer Ebene des adaptiven Symbols (108 dp)]
const DENSITIES = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };

// Laeuft in der Seite: Ebenen laden, alle Groessen zeichnen, als PNG (Base64) zurueckgeben.
const PAGE_SCRIPT = String.raw`
async function build(srcs, jobs) {
  const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
  const back = await load(srcs.back), cloud = await load(srcs.cloud), play = await load(srcs.play);
  const LW = cloud.width, LH = cloud.height; // 1280 x 768
  // Breite der Symbol-Ebenen im Quadrat der Kante S: S * K, wie im Symbol der iOS-App (Wolke etwa 55 % der Breite)
  const K = 0.93 * LW / 1024;

  // Umriss der Wolke in der Ebene (fuer das Banner)
  const probe = document.createElement('canvas');
  probe.width = LW; probe.height = LH;
  const pc = probe.getContext('2d', { willReadFrequently: true });
  pc.drawImage(cloud, 0, 0);
  const pd = pc.getImageData(0, 0, LW, LH).data;
  let x0 = LW, y0 = LH, x1 = 0, y1 = 0;
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    if (pd[(y * LW + x) * 4 + 3] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };

  const quality = (g) => { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; };
  /** Wolke und Play in ein Quadrat (ox, oy, S) */
  const symbol = (g, ox, oy, S) => {
    const ww = S * K, hh = ww * LH / LW;
    g.drawImage(cloud, ox + (S - ww) / 2, oy + (S - hh) / 2, ww, hh);
    g.drawImage(play, ox + (S - ww) / 2, oy + (S - hh) / 2, ww, hh);
  };
  /** Verlauf in ein Quadrat (ox, oy, S); extend: die Randfarben laufen bis an die Kanten der Flaeche weiter (Raender 1 px gedehnt) */
  const gradient = (g, ox, oy, S, extend, W, H) => {
    g.drawImage(back, ox, oy, S, S);
    if (!extend) return;
    const bw = back.width, bh = back.height;
    g.drawImage(back, 0, 0, bw, 1, ox, 0, S, oy);                       // oben
    g.drawImage(back, 0, bh - 1, bw, 1, ox, oy + S, S, H - oy - S);     // unten
    g.drawImage(back, 0, 0, 1, bh, 0, oy, ox, S);                       // links
    g.drawImage(back, bw - 1, 0, 1, bh, ox + S, oy, W - ox - S, S);     // rechts
    g.drawImage(back, 0, 0, 1, 1, 0, 0, ox, oy);                        // Ecken
    g.drawImage(back, bw - 1, 0, 1, 1, ox + S, 0, W - ox - S, oy);
    g.drawImage(back, 0, bh - 1, 1, 1, 0, oy + S, ox, H - oy - S);
    g.drawImage(back, bw - 1, bh - 1, 1, 1, ox + S, oy + S, W - ox - S, H - oy - S);
  };
  /** Abgerundetes Quadrat (Radius 22,5 % wie unter iOS) */
  const roundRect = (g, x, y, S) => {
    const r = S * 0.225;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + S, y, x + S, y + S, r);
    g.arcTo(x + S, y + S, x, y + S, r);
    g.arcTo(x, y + S, x, y, r);
    g.arcTo(x, y, x + S, y, r);
    g.closePath();
  };

  const out = {};
  for (const job of jobs) {
    const c = document.createElement('canvas');
    const W = job.width || job.size, H = job.size;
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    quality(g);
    if (job.kind === 'rounded') {
      const pad = Math.round(W * (1 - job.scale) / 2), S = W - 2 * pad;
      roundRect(g, pad, pad, S);
      g.clip();
      gradient(g, pad, pad, S);
      symbol(g, pad, pad, S);
    } else if (job.kind === 'circle') {
      g.beginPath();
      g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
      g.clip();
      gradient(g, 0, 0, W);
      symbol(g, 0, 0, W);
    } else if (job.kind === 'adaptive-back' || job.kind === 'adaptive-front') {
      // die mittleren 72 von 108 dp zeigen das Quadrat
      const S = W * 72 / 108, o = (W - S) / 2;
      if (job.kind === 'adaptive-back') gradient(g, o, o, S, true, W, H);
      else symbol(g, o, o, S);
    } else if (job.kind === 'banner') {
      // TV-Banner (16:9): Verlauf fuellend, links die Wolke mit Play, daneben der Name
      const cover = Math.max(W / back.width, H / back.height);
      g.drawImage(back, (W - back.width * cover) / 2, (H - back.height * cover) / 2, back.width * cover, back.height * cover);
      const ch = H * 0.42, scale = ch / box.h, cw = box.w * scale;
      const cx = H * 0.2, cy = (H - ch) / 2;
      g.drawImage(cloud, cx - box.x * scale, cy - box.y * scale, LW * scale, LH * scale);
      g.drawImage(play, cx - box.x * scale, cy - box.y * scale, LW * scale, LH * scale);
      const tx = cx + cw + H * 0.1;
      const room = W - tx - H * 0.14;
      let fs = Math.round(H * 0.2);
      const fontOf = (s) => '600 ' + s + "px 'Segoe UI Variable Display', 'Segoe UI', sans-serif";
      g.font = fontOf(fs);
      while (fs > 10 && g.measureText(job.text).width > room) g.font = fontOf(--fs);
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = H * 0.04;
      g.shadowOffsetY = H * 0.01;
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.fillText(job.text, tx, H / 2 + H * 0.01);
    }
    out[job.name] = c.toDataURL('image/png').split(',')[1];
  }
  return { out, box };
}`;

app.whenReady().then(async () => {
  const read = (name) => {
    const file = path.join(LAYERS, name);
    if (!fs.existsSync(file)) throw new Error(`Ebene fehlt: ${file}`);
    return fs.readFileSync(file).toString('base64');
  };
  const srcs = { back: read('hintergrund.png'), cloud: read('wolke.png'), play: read('play.png') };
  const jobs = [{ name: 'build/icon.png', kind: 'rounded', size: 1024, scale: 1 }];
  for (const [dpi, [legacy, adaptive]] of Object.entries(DENSITIES)) {
    jobs.push({ name: `mipmap-${dpi}/ic_launcher.png`, kind: 'rounded', size: legacy, scale: 0.92 });
    jobs.push({ name: `mipmap-${dpi}/ic_launcher_round.png`, kind: 'circle', size: legacy });
    jobs.push({ name: `mipmap-${dpi}/ic_launcher_background.png`, kind: 'adaptive-back', size: adaptive });
    jobs.push({ name: `mipmap-${dpi}/ic_launcher_foreground.png`, kind: 'adaptive-front', size: adaptive });
  }
  // TV-Banner im Startbildschirm von Android TV (320 x 180 dp, hier fuer xhdpi; Google empfiehlt den Namen im Banner)
  jobs.push({ name: 'drawable-xhdpi/tv_banner.png', kind: 'banner', size: 180, width: 320, text: 'Jellycloud' });
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,<!doctype html><title>icon</title>');
  await win.webContents.executeJavaScript(PAGE_SCRIPT);
  const { out, box } = await win.webContents.executeJavaScript(`build(${JSON.stringify(srcs)}, ${JSON.stringify(jobs)})`);
  console.log(`Wolke in der Ebene: ${box.x},${box.y} ${box.w} x ${box.h}`);
  for (const [name, b64] of Object.entries(out)) {
    const file = name.startsWith('build/') ? path.join(ROOT, name) : path.join(RES, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(`geschrieben: ${path.relative(ROOT, file)}`);
  }
  app.quit();
});
