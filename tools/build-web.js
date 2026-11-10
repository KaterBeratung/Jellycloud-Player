'use strict';

/**
 * Baut die Web-/Handy-Fassung nach www/ (oder in den angegebenen Ordner): index.html, renderer/, shared/ und web/ ohne Electron-Teile.
 * Das ist der Ordner, den eine Capacitor-Huelle als "webDir" einbindet (siehe mobile/README.md) und den man auch hinter jedem Webserver ablegen kann.
 *   node tools/build-web.js            -> www/
 *   node tools/build-web.js D:\ziel    -> D:\ziel
 *   node tools/build-web.js www --host mobile/host-capacitor.js   -> mit Huellen-Datei (wird vor jc-web.js geladen und setzt window.JCHost)
 * Ohne npm lauffaehig (nur Node-Module): unter Windows mit dem mitgelieferten Electron als Node, siehe README.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * @param {string} [out] Ausgabeordner
 * @param {{host?: string}} [opts] host: Pfad einer Huellen-Datei (JS), die als web/host.js vor jc-web.js eingebunden wird
 * @returns {string} der Ausgabeordner
 */
function buildWeb(out = path.join(ROOT, 'www'), { host } = {}) {
  const src = path.join(ROOT, 'src');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // Oberflaeche (ohne den Einstieg des Desktop-Programms), gemeinsame Module, Web-Schicht
  fs.cpSync(path.join(src, 'renderer'), path.join(out, 'renderer'), { recursive: true, filter: (s) => path.basename(s) !== 'index.html' });
  fs.cpSync(path.join(src, 'shared'), path.join(out, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(out, 'web'), { recursive: true });
  fs.copyFileSync(path.join(src, 'web', 'jc-web.js'), path.join(out, 'web', 'jc-web.js'));
  // Einstieg: die Pfade zeigen im Quellbaum nach "../", im fertigen Ordner liegt alles darunter
  let html = fs
    .readFileSync(path.join(src, 'web', 'index.html'), 'utf8')
    .replaceAll('../renderer/', 'renderer/')
    .replaceAll('../shared/', 'shared/')
    .replace('src="jc-web.js"', 'src="web/jc-web.js"');
  if (host) {
    // __APP_VERSION__ in der Huellen-Datei wird zur Version aus package.json (die Huelle meldet sie dem Server und zeigt sie unter Einstellungen > Info)
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    fs.writeFileSync(path.join(out, 'web', 'host.js'), fs.readFileSync(path.resolve(host), 'utf8').replaceAll('__APP_VERSION__', version), 'utf8');
    const tag = '<script src="web/jc-web.js"></script>';
    if (!html.includes(tag)) throw new Error('index.html enthaelt das Skript web/jc-web.js nicht');
    html = html.replace(tag, `<script src="web/host.js"></script>\n    ${tag}`);
  }
  fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hostAt = args.indexOf('--host');
  const host = hostAt >= 0 ? args.splice(hostAt, 2)[1] : undefined;
  const out = buildWeb(args[0] ? path.resolve(args[0]) : undefined, { host });
  const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
  console.log(`Web-Fassung gebaut: ${out} (${count(out)} Dateien)`);
}

module.exports = { buildWeb };
