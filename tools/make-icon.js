// Erzeugt alle App-Symbole aus der Vorlage build/logo-quelle.webp (2000 x 2000, seit 1.2.27: lila-blaues Glasquadrat mit leuchtender Wolke und
// Play-Symbol, vom Nutzer vorgegeben). Die Ecken um das abgerundete Quadrat sind dort durchsichtig; eine Vorlage mit weissen Ecken wird freigestellt.
//  - build/icon.png (1024 px): Windows (Programm, Taskleiste, Fenster, Installer); abgerundetes Quadrat, Ecken durchsichtig.
//  - Android je Dichte (mipmap-*): ic_launcher.png (altes Symbol: das abgerundete Quadrat), ic_launcher_round.png (Kreis aus der Mitte) und
//    ic_launcher_foreground.png (Vordergrund des adaptiven Symbols, randlos: die Maske des Startbildschirms gibt die Form vor; ausserhalb der sichtbaren
//    72 dp laufen die Randpixel weiter, damit beim Wackeln der Symbole keine Kante erscheint). Der Startbildschirm von Android 12+ nutzt denselben Vordergrund.
//  - Android TV (seit 1.2.28): drawable-xhdpi/tv_banner.png (320 x 180), Symbol und Name auf der Flaeche ohne Glaskante.
// Sichtbar ist beim adaptiven und runden Symbol der innere Teil der Vorlage ohne die leuchtende Glaskante (INNER), die Maske ersetzt sie.
// Start: npm run icon (Electron; Bilder dekodiert und skaliert Chromium mit hoher Qualitaet)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'build', 'logo-quelle.webp');
const RES = path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res');
// Dichte: [Kantenlaenge des alten und runden Symbols, Kantenlaenge des adaptiven Vordergrunds (108 dp)]
const DENSITIES = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
/** Anteil der Vorlage, der im runden und adaptiven Symbol sichtbar ist (ohne die Glaskante am Rand). */
const INNER = 0.84;

// Laeuft in der Seite: Vorlage laden, Ecken freistellen, alle Groessen zeichnen, als PNG (Base64) zurueckgeben.
const PAGE_SCRIPT = String.raw`
async function build(srcBase64, jobs, inner) {
  const bytes = Uint8Array.from(atob(srcBase64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
  const N = bmp.width;
  const base = document.createElement('canvas');
  base.width = base.height = N;
  const bc = base.getContext('2d', { willReadFrequently: true });
  bc.drawImage(bmp, 0, 0);
  const img = bc.getImageData(0, 0, N, N);
  const px = img.data;
  // Hintergrund der Vorlage: durchsichtig (so die Vorlage seit 1.2.27) oder weiss (erste Fassung); "aussen" ist, was dazu gehoert
  const alphaAt = (x, y) => px[(y * N + x) * 4 + 3];
  const transparentCorners = alphaAt(0, 0) < 16 && alphaAt(N - 1, N - 1) < 16;
  const white = (x, y) => {
    const i = (y * N + x) * 4;
    const mn = Math.min(px[i], px[i + 1], px[i + 2]);
    const mx = Math.max(px[i], px[i + 1], px[i + 2]);
    return mn > 232 && mx - mn < 22;
  };
  const outside = (x, y) => (transparentCorners ? alphaAt(x, y) < 128 : white(x, y));
  // Kanten des Quadrats auf der Mittellinie, Eckradius auf der Diagonale (abgerundetes Rechteck: Treffer bei r * (1 - 1/sqrt 2))
  const mid = N >> 1;
  let L = 0; while (L < mid && outside(L, mid)) L++;
  let R = N - 1; while (R > mid && outside(R, mid)) R--;
  let T = 0; while (T < mid && outside(mid, T)) T++;
  let B = N - 1; while (B > mid && outside(mid, B)) B--;
  const diag = (sx, sy, dx, dy) => { let t = 0; while (t < mid && outside(sx + dx * t, sy + dy * t)) t++; return t; };
  const k = 1 - Math.SQRT1_2;
  const radius = Math.max(diag(0, 0, 1, 1) - Math.min(L, T), diag(N - 1, 0, -1, 1) - Math.min(N - 1 - R, T), diag(0, N - 1, 1, -1) - Math.min(L, N - 1 - B), diag(N - 1, N - 1, -1, -1) - Math.min(N - 1 - R, N - 1 - B)) / k;
  // Nur bei weissem Hintergrund freistellen: abgerundetes Rechteck (vorzeichenbehafteter Abstand zum Rand), 3 px nach innen, weiche Kante,
  // dazu faellt Weiss in den aeussersten 10 px weg. Eine durchsichtige Vorlage bleibt, wie sie ist.
  if (!transparentCorners) {
    const inset = 3;
    const hw = (R - L) / 2 - inset, hh = (B - T) / 2 - inset, cx0 = (L + R + 1) / 2, cy0 = (T + B + 1) / 2;
    const rad = Math.max(0, Math.min(radius - inset, hw, hh));
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const qx = Math.abs(x + 0.5 - cx0) - (hw - rad);
        const qy = Math.abs(y + 0.5 - cy0) - (hh - rad);
        const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad; // < 0 innen
        let a = Math.max(0, Math.min(1, 0.5 - dist / 1.5));
        if (a > 0 && dist > -10 && white(x, y)) a = 0;
        const i = (y * N + x) * 4 + 3;
        px[i] = Math.round(px[i] * a);
      }
    }
    bc.putImageData(img, 0, 0);
  }

  // Innerer Teil (ohne Glaskante), quadratisch um die Mitte
  const side = Math.min(R - L, B - T) * inner;
  const cx = (L + R) / 2, cy = (T + B) / 2;
  const ix = cx - side / 2, iy = cy - side / 2;

  // Flaeche ohne Glaskante fuer das adaptive Symbol: alles ausserhalb eines abgerundeten Rechtecks innerhalb der Kante nimmt die Farbe des naechsten
  // Punkts auf dessen Rand an. So zeigt jede Maske des Startbildschirms (Kreis, Squircle, abgerundetes Quadrat) und das Wackeln nur ruhige Farbe.
  // In Koordinaten der Vorlage reicht sie so weit, wie der Vordergrund (108 dp) zeigt; gerechnet in halber Aufloesung.
  const RIM = 0.06 * (R - L);
  const hx = (R - L) / 2 - RIM, hy = (B - T) / 2 - RIM, rr = Math.max(0, radius - RIM);
  const span = side * 108 / 72; // Vorlage, die der ganze Vordergrund zeigt
  const ox = cx - span / 2, oy = cy - span / 2;
  const half = document.createElement('canvas');
  half.width = half.height = N >> 1;
  const hc = half.getContext('2d', { willReadFrequently: true });
  hc.imageSmoothingQuality = 'high';
  hc.drawImage(base, 0, 0, half.width, half.height);
  const hd = hc.getImageData(0, 0, half.width, half.height).data;
  const P = Math.round(span / 2);
  const plate = document.createElement('canvas');
  plate.width = plate.height = P;
  const pc = plate.getContext('2d');
  const pd = pc.createImageData(P, P);
  for (let v = 0; v < P; v++) {
    for (let u = 0; u < P; u++) {
      let x = ox + (u + 0.5) * span / P - cx;
      let y = oy + (v + 0.5) * span / P - cy;
      const sx = Math.sign(x) || 1, sy = Math.sign(y) || 1;
      let qx = Math.abs(x) - (hx - rr), qy = Math.abs(y) - (hy - rr);
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        if (len > rr) { qx = qx / len * rr; qy = qy / len * rr; }
      } else {
        qx = Math.min(qx, rr);
        qy = Math.min(qy, rr);
      }
      x = sx * (qx + (hx - rr));
      y = sy * (qy + (hy - rr));
      const hxp = Math.max(0, Math.min(half.width - 1, Math.round((cx + x) / 2)));
      const hyp = Math.max(0, Math.min(half.height - 1, Math.round((cy + y) / 2)));
      const s = (hyp * half.width + hxp) * 4, o = (v * P + u) * 4;
      pd.data[o] = hd[s]; pd.data[o + 1] = hd[s + 1]; pd.data[o + 2] = hd[s + 2]; pd.data[o + 3] = 255;
    }
  }
  pc.putImageData(pd, 0, 0);

  const out = {};
  for (const job of jobs) {
    const c = document.createElement('canvas');
    c.width = c.height = job.size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const S = job.size;
    if (job.kind === 'rounded') {
      // das freigestellte Quadrat, Rand der Vorlage mit
      const pad = S * (1 - job.scale) / 2;
      g.drawImage(base, L, T, R - L, B - T, pad, pad, S - 2 * pad, S - 2 * pad);
    } else if (job.kind === 'circle') {
      g.beginPath();
      g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
      g.clip();
      g.drawImage(base, ix, iy, side, side, 0, 0, S, S);
    } else if (job.kind === 'banner') {
      // TV-Banner (Android TV, 16:9): die Flaeche ohne Glaskante als Grund, links das Symbol, daneben der Name
      const W = job.width, H = job.size;
      c.width = W;
      c.height = H;
      g.imageSmoothingQuality = 'high';
      // Grund: die Farben der Flaeche, stark weichgezeichnet (die Wolke darin wuerde neben dem Symbol stoeren), etwas abgedunkelt
      const band = P * (H / W);
      g.filter = 'blur(' + Math.round(H * 0.12) + 'px)';
      g.drawImage(plate, 0, (P - band) / 2, P, band, -H * 0.2, -H * 0.2, W + H * 0.4, H + H * 0.4);
      g.filter = 'none';
      const shade = g.createLinearGradient(0, 0, W, 0);
      shade.addColorStop(0, 'rgba(8,6,30,0.2)');
      shade.addColorStop(1, 'rgba(8,6,30,0.5)');
      g.fillStyle = shade;
      g.fillRect(0, 0, W, H);
      const ic = Math.round(H * 0.6);
      const ix0 = Math.round(H * 0.15);
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = H * 0.08;
      g.shadowOffsetY = H * 0.02;
      g.drawImage(base, L, T, R - L, B - T, ix0, (H - ic) / 2, ic, ic);
      // Name: so gross wie moeglich, aber mit Rand rechts
      const tx = ix0 + ic + H * 0.1;
      const room = W - tx - H * 0.12;
      let fs = Math.round(H * 0.2);
      const fontOf = (s) => '700 ' + s + "px 'Segoe UI Variable Display', 'Segoe UI', sans-serif";
      g.font = fontOf(fs);
      while (fs > 10 && g.measureText(job.text).width > room) g.font = fontOf(--fs);
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = H * 0.05;
      g.shadowOffsetY = H * 0.01;
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.fillText(job.text, tx, H / 2 + H * 0.01);
    } else {
      // adaptiver Vordergrund: die mittleren 72 von 108 dp zeigen den inneren Teil, die Flaeche ohne Glaskante fuellt alles
      g.drawImage(plate, 0, 0, P, P, 0, 0, S, S);
    }
    out[job.name] = c.toDataURL('image/png').split(',')[1];
  }
  return { out, frame: { L, R, T, B, radius: Math.round(radius), transparentCorners } };
}`;

app.whenReady().then(async () => {
  if (!fs.existsSync(SOURCE)) throw new Error(`Vorlage fehlt: ${SOURCE}`);
  const jobs = [{ name: 'build/icon.png', kind: 'rounded', size: 1024, scale: 1 }];
  for (const [dpi, [legacy, adaptive]] of Object.entries(DENSITIES)) {
    jobs.push({ name: `mipmap-${dpi}/ic_launcher.png`, kind: 'rounded', size: legacy, scale: 0.92 });
    jobs.push({ name: `mipmap-${dpi}/ic_launcher_round.png`, kind: 'circle', size: legacy });
    jobs.push({ name: `mipmap-${dpi}/ic_launcher_foreground.png`, kind: 'adaptive', size: adaptive });
  }
  // TV-Banner im Startbildschirm von Android TV (320 x 180 dp, hier fuer xhdpi; Google empfiehlt den Namen im Banner)
  jobs.push({ name: 'drawable-xhdpi/tv_banner.png', kind: 'banner', size: 180, width: 320, text: 'Jellycloud' });
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,<!doctype html><title>icon</title>');
  await win.webContents.executeJavaScript(PAGE_SCRIPT);
  const src = fs.readFileSync(SOURCE).toString('base64');
  const { out, frame } = await win.webContents.executeJavaScript(`build(${JSON.stringify(src)}, ${JSON.stringify(jobs)}, ${INNER})`);
  console.log(`Vorlage: Quadrat ${frame.L}..${frame.R} x ${frame.T}..${frame.B}, Eckradius ${frame.radius}, Ecken ${frame.transparentCorners ? 'durchsichtig' : 'weiss (freigestellt)'}`);
  for (const [name, b64] of Object.entries(out)) {
    const file = name.startsWith('build/') ? path.join(ROOT, name) : path.join(RES, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(`geschrieben: ${path.relative(ROOT, file)}`);
  }
  app.quit();
});
