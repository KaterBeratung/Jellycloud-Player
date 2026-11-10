// Erzeugt build/icon.png (512x512): das Logo der Startanimation als freistehendes Symbol, eine weisse Wolke als Umriss mit Play-Symbol und Leuchten,
// ohne Platte und ohne dunklen Rand, transparenter Hintergrund. Das Symbol ist hell: auf hellem Grund (Explorer im hellen Design) tritt es zurueck, auf dunklem
// (Taskleiste, Startmenue im dunklen Design) steht es klar. Bis 0.0.43 war es eine silberne Wolke mit dunklem Rand, 0.0.44 bis 0.0.47 sass es auf einer dunklen Platte.
// Start: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Mittellinie des Strichs in einem 512er-Raster: flacher Boden, links grosse Rundung, zwei Woelbungen oben, rechts kleine Rundung.
const CLOUD = 'M126 351H400A64 64 0 0 0 400 223A64 64 0 0 0 312 152A103 103 0 0 0 127 198A77 77 0 0 0 126 351Z';
// Play-Dreieck: Schwerpunkt des Dreiecks liegt auf der optischen Mitte der freien Flaeche der Wolke (x 254, y 232;
// Flaechenschwerpunkt (250, 243), Mitte des Rahmens (256, 219), berechnet). Breite 68, Hoehe 78.
const PLAY = 'M231 193L231 271L299 232Z';
// Das Leuchten ist dieselbe Form, weichgezeichnet und darunter gelegt.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12"/></filter>
</defs>
<g transform="translate(0 37)" stroke-linejoin="round" stroke-linecap="round">
  <g filter="url(#glow)" opacity=".85" stroke="#fff">
    <path d="${CLOUD}" fill="none" stroke-width="40"/>
    <path d="${PLAY}" fill="#fff" stroke-width="24"/>
  </g>
  <path d="${CLOUD}" fill="none" stroke="#fff" stroke-width="34"/>
  <path d="${PLAY}" fill="#fff" stroke="#fff" stroke-width="18"/>
</g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false, frame: false, transparent: true, webPreferences: { zoomFactor: 1 } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${SVG}`)}`);
  await new Promise((r) => setTimeout(r, 400));
  let img = await win.webContents.capturePage();
  const size = img.getSize();
  if (size.width !== 512) img = img.resize({ width: 512, height: 512, quality: 'best' });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log(`Icon geschrieben: ${out} (${img.getSize().width}x${img.getSize().height})`);
  app.quit();
});
