// Updater (JC_DEV=1, JC_FAKE_MPV=1): Die Update-Quelle ist fest eingebaut, weder zu sehen noch zu aendern (auch nicht ueber die Schnittstelle). Pruefen, Hinweis (Toast, Punkt am Zahnrad), Herunterladen mit Fortschritt,
// Abbrechen, Installieren (Installer und Beenden sind ersetzt), automatische Pruefung. Echter Weg durch Electron: net.fetch gegen einen lokalen Webserver.
//   Mit zusaetzlichem Startargument --updated prueft es auch den Hinweis "Aktualisiert auf Version ...".
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { server } = require('../mock-server');
const { DEFAULT_UPDATE_SOURCE } = require('../../src/main/config');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  };
  const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await ctx.wait(80);
    }
    return false;
  };
  const page = (js) => ctx.run(js);
  const updater = ctx.updater;
  const errors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || e.level >= 2) errors.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });

  // ---------- Update-Quelle: lokaler Webserver mit latest.json und einem 6-MB-Schein-Installer (langsam, damit der Fortschritt sichtbar wird) ----------
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-upd-ui-'));
  const publish = (version, notes) => {
    const data = crypto.randomBytes(6 * 1024 * 1024);
    const file = `Jellycloud-Player-Setup-${version}.exe`;
    fs.writeFileSync(path.join(root, file), data);
    fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ version, file, size: data.length, sha512: crypto.createHash('sha512').update(data).digest('hex'), date: '2026-11-04T10:00:00Z', notes }));
    return { data, file };
  };
  let { file } = publish('0.0.99', 'Neu: Updater\nBehoben: Streifen am Rand');
  let slow = true;
  const src = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].slice(1));
    const f = path.join(root, path.basename(name));
    if (!fs.existsSync(f)) return res.writeHead(404).end();
    const buf = fs.readFileSync(f);
    res.writeHead(200, { 'content-length': buf.length });
    if (!slow || name === 'latest.json') return res.end(buf);
    let at = 0;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      res.write(buf.subarray(at, at + 131072));
      at += 131072;
      if (at >= buf.length) {
        clearInterval(timer);
        res.end();
      }
    }, 40);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise((r) => src.listen(8099, '127.0.0.1', r));
  const SRC = 'http://127.0.0.1:8099/';

  // Installer und Beenden sind ersetzt: nichts wird wirklich gestartet. "Installiert" wird so, als laefe die gepackte App.
  const launched = [];
  let quits = 0;
  updater.launch = (f, args) => launched.push({ f, args });
  updater.quit = () => quits++;
  updater.packaged = true;
  updater.sourceChanged();

  await new Promise((r) => server.listen(8097, '127.0.0.1', r));
  await ctx.wait(500);
  await ctx.run(`window.jc.login({url:'http://127.0.0.1:8097', username:'demo', password:'demo'}).then(() => document.dispatchEvent(new CustomEvent('relogin')))`);
  await ctx.wait(2500);

  const toasts = () => page(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.trim())`);
  const upd = () => page(`document.querySelector('.upd-text')?.textContent ?? ''`);
  const btns = () => page(`[...document.querySelectorAll('.upd-buttons button')].map((b) => b.textContent.trim() + (b.disabled ? ' (aus)' : ''))`);
  const dot = () => page(`(() => { const a = document.querySelector('.tool.has-update'); return a ? a.title : ''; })()`);
  const clickBtn = (label) => page(`[...document.querySelectorAll('.upd-buttons button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);

  // ---------- Hinweis nach einem Update (Start durch den Installer mit --updated) ----------
  const flagged = process.argv.includes('--updated');
  const hello = (await toasts()).join(' | ');
  check(flagged ? 'Start mit --updated: "Aktualisiert auf Version ..." wird gezeigt' : 'Normaler Start: kein Hinweis auf ein Update', flagged ? /Aktualisiert auf Version \d/.test(hello) : !/Aktualisiert/.test(hello), hello);

  // ---------- Allgemein: die Update-Quelle ist weder zu sehen noch zu aendern ----------
  await page(`location.hash = '#/settings/general'`);
  const autoSwitch = `document.querySelector('.settings-panel .switch[aria-label="Automatisch nach Updates suchen"]')`;
  await waitFor(() => page(`!!${autoSwitch}`));
  check('Allgemein: Schalter "Automatisch nach Updates suchen" ist standardmaessig an', (await page(`${autoSwitch}.getAttribute('aria-checked')`)) === 'true');
  check('Von der Update-Quelle ist nichts zu sehen: die Gruppe Updates hat genau eine Zeile, kein Eingabefeld, kein Text "Quelle"', await page(`(() => {
    const g = [...document.querySelectorAll('.settings-block')].find((b) => b.querySelector('.group-title')?.textContent.trim().toLowerCase() === 'updates');
    const panel = document.querySelector('.settings-panel');
    return !!g && g.querySelectorAll('.setting').length === 1 && !g.querySelector('input, select') && !/quelle|source/i.test(g.innerText) && !panel.querySelector('.upd-source');
  })()`));
  check('Die Quelle ist fest eingebaut (GitHub-Releases) und steht in keiner Einstellung', updater.getSource() === DEFAULT_UPDATE_SOURCE && !('updateSource' in ctx.config.settings.general) && !('updateCustom' in ctx.config.settings.general), `${updater.getSource()} / ${JSON.stringify(Object.keys(ctx.config.settings.general))}`);
  // Auch ueber die Schnittstelle laesst sie sich nicht setzen: der Versuch wird verworfen, der Rest wird gespeichert
  await page(`window.jc.setSettings({ general: { updateSource: 'https://evil.example/', updateCustom: true, autoUpdate: true } })`);
  await ctx.wait(300);
  check('Ein Versuch, die Quelle ueber die Oberflaeche zu setzen, wird verworfen (nichts gespeichert, Quelle unveraendert)', !('updateSource' in ctx.config.settings.general) && !('updateCustom' in ctx.config.settings.general) && updater.getSource() === DEFAULT_UPDATE_SOURCE, JSON.stringify(ctx.config.settings.general));
  check('Die automatische Pruefung laeuft in den Szenarien nicht (kein Zeitplan, kein Netz)', updater._timer === null);

  // Ab hier laeuft der Updater gegen Testquellen (die feste Quelle bleibt unberuehrt)
  updater.getSource = () => 'http://127.0.0.1:9/';

  // ---------- Info: Quelle nicht erreichbar ----------
  await page(`location.hash = '#/settings/about'`);
  await waitFor(async () => (await upd()) !== '');
  check('Info: "Noch nicht nach Updates gesucht" und Knopf zum Suchen', /Noch nicht nach Updates gesucht/.test(await upd()) && (await btns()).join() === 'Nach Updates suchen', `${await upd()} / ${(await btns()).join()}`);
  await clickBtn('Nach Updates suchen');
  await waitFor(async () => /nicht erreichbar/.test(await upd()), 8000);
  check('Quelle nicht erreichbar: Fehlertext, als Fehler gekennzeichnet, nur der Knopf zum erneuten Suchen (kein "Quelle einstellen")', /nicht erreichbar/.test(await upd()) && (await page(`document.querySelector('.upd-text').classList.contains('bad')`)) && (await btns()).join() === 'Nach Updates suchen', `${await upd()} / ${(await btns()).join()}`);
  check('Kein Punkt am Zahnrad ohne Update', (await dot()) === '');

  // ---------- Update im Hintergrund gefunden (nicht auf der Info-Seite) ----------
  updater.getSource = () => SRC;
  await page(`location.hash = '#/settings/general'`);
  await ctx.wait(500);
  await updater.check({ manual: false });
  await ctx.capture(path.join(out, 'U-01-general-source.png'));
  // ---------- Hinweis: Toast und Punkt am Zahnrad ----------
  await waitFor(async () => (await toasts()).some((t) => /Version 0\.0\.99 ist verfügbar/.test(t)), 3000);
  const t1 = await toasts();
  check('Toast "Version 0.0.99 ist verfuegbar" mit Knopf "Anzeigen"', t1.some((t) => /Version 0\.0\.99 ist verfügbar.*Anzeigen/.test(t)), t1.join(' | '));
  check('Punkt am Zahnrad mit Tooltip "Update 0.0.99 verfuegbar"', /Update 0\.0\.99 verfügbar/.test(await dot()), await dot());
  // Punkt auf dem Rand des Zahnrad-Knopfs (Mitte des Punkts auf dem Kreis, nicht innen) und gruen; Versionshinweis in Gruen rechtsbuendig unter der Kapsel mit dem Konto
  const dotGeo = await page(`(() => { const b = document.querySelector('.tool.has-update'); const r0 = b.getBoundingClientRect(); const cs = getComputedStyle(b, '::after'); const bw = parseFloat(getComputedStyle(b).borderTopWidth); const w = parseFloat(cs.width);
    const cx = r0.left + r0.width - bw - parseFloat(cs.right) - w / 2, cy = r0.top + bw + parseFloat(cs.top) + w / 2;
    const c = cs.backgroundColor.match(/\\d+/g).map(Number);
    return { dist: Math.hypot(cx - (r0.left + r0.width / 2), cy - (r0.top + r0.height / 2)), radius: r0.width / 2, green: c[1] > c[0] + 60 && c[1] > c[2] }; })()`);
  check('Punkt sitzt auf dem Rand des Zahnrad-Knopfs (Mitte auf dem Kreis, nicht weiter innen) und ist gruen', Math.abs(dotGeo.dist - dotGeo.radius) <= 1.5 && dotGeo.green, JSON.stringify(dotGeo));
  const noteInfo = () => page(`(() => { const n = document.querySelector('.update-note'); if (!n || n.hidden) return null; const pill = document.querySelector('.toolpill').getBoundingClientRect(); const r = n.getBoundingClientRect(); const m = getComputedStyle(n).color.match(/\\d+/g).map(Number);
    return { text: n.textContent.trim(), title: n.title, href: n.getAttribute('href'), rightDiff: Math.abs(r.right - pill.right), gap: r.top - pill.bottom, green: m[1] > m[0] + 40 && m[1] > m[2], status: n.dataset.status }; })()`);
  const n1 = await noteInfo();
  check('Hinweis unter dem Konto: nur "Update verfuegbar" (ohne Versionsnummer, die steht im Tooltip), gruen, rechtsbuendig unter der Kapsel, fuehrt zu Einstellungen > Info', !!n1 && n1.text === 'Update verfügbar' && /0\.0\.99/.test(n1.title) && n1.green && n1.rightDiff <= 1 && n1.gap >= 0 && n1.gap <= 16 && n1.href === '#/settings/about', JSON.stringify(n1));
  check('Die Version gilt danach als angekuendigt (dauerhaft in den Einstellungen gemerkt)', (await waitFor(() => ctx.config.settings.general.updateSeen === '0.0.99', 3000)) && ctx.config.settings.general.updateSeen === '0.0.99', ctx.config.settings.general.updateSeen);
  await page(`document.querySelector('#toasts .toast-action')?.click()`);
  await waitFor(() => page(`location.hash === '#/settings/about'`));
  check('"Anzeigen" fuehrt zu Einstellungen > Info', (await page(`location.hash`)) === '#/settings/about');
  check('Auf der Info-Seite ist der Versionshinweis weg (dort steht alles ausfuehrlich), der Punkt bleibt', (await noteInfo()) === null && /0\.0\.99/.test(await dot()));

  // ---------- Info: verfuegbar ----------
  await waitFor(async () => /ist verfügbar/.test(await upd()));
  check('Info: "Version 0.0.99 ist verfuegbar (6 MB)"', /Version 0\.0\.99 ist verfügbar \(6 MB\)/.test(await upd()), await upd());
  check('Info: Neuigkeiten aus latest.json (mehrzeilig)', await page(`(() => { const n = document.querySelector('.upd-notes'); return !n.hidden && /Neu: Updater/.test(n.textContent) && /Behoben: Streifen am Rand/.test(n.textContent); })()`));
  check('Info: Knoepfe "Herunterladen" und "Nach Updates suchen"', (await btns()).join() === 'Herunterladen,Nach Updates suchen', (await btns()).join());
  await ctx.capture(path.join(out, 'U-02-about-available.png'));

  // ---------- Herunterladen mit Fortschritt, dann Abbrechen ----------
  await clickBtn('Herunterladen');
  await waitFor(() => page(`!document.querySelector('.upd-bar').hidden && parseInt(document.querySelector('.upd-bar i').style.width) >= 8`), 6000);
  await page(`window.__cancelBtn = document.querySelector('.upd-buttons button')`);
  const w1 = await page(`parseInt(document.querySelector('.upd-bar i').style.width)`);
  check('Fortschrittsbalken sichtbar, Text nennt Version und Prozent', (await page(`!document.querySelector('.upd-bar').hidden`)) && /Lade Version 0\.0\.99 … \d+ %/.test(await upd()), `${w1} % / ${await upd()}`);
  check('Waehrend des Ladens nur der Knopf "Abbrechen"', (await btns()).join() === 'Abbrechen', (await btns()).join());
  await ctx.capture(path.join(out, 'U-03-about-downloading.png'));
  await waitFor(() => page(`parseInt(document.querySelector('.upd-bar i').style.width) > ${w1}`), 4000);
  const w2 = await page(`parseInt(document.querySelector('.upd-bar i').style.width)`);
  check('Der Balken waechst', w2 > w1, `${w1} -> ${w2} %`);
  check('Der Knopf bleibt derselbe Knoten (Fokus geht beim Fortschritt nicht verloren)', await page(`document.querySelector('.upd-buttons button') === window.__cancelBtn`));
  await clickBtn('Abbrechen');
  await waitFor(async () => /ist verfügbar/.test(await upd()), 4000);
  check('Abbrechen: zurueck auf "verfuegbar", Balken weg, kein Fehler', /Version 0\.0\.99 ist verfügbar/.test(await upd()) && (await page(`document.querySelector('.upd-bar').hidden`)) && !(await page(`document.querySelector('.upd-text').classList.contains('bad')`)), await upd());
  check('...keine halbe Datei im Download-Ordner', !fs.existsSync(updater.dir) || fs.readdirSync(updater.dir).length === 0, JSON.stringify(fs.existsSync(updater.dir) ? fs.readdirSync(updater.dir) : []));

  // ---------- Herunterladen bis zum Ende ----------
  slow = false;
  await clickBtn('Herunterladen');
  await waitFor(async () => /heruntergeladen und geprüft/.test(await upd()), 15000);
  check('Fertig: "heruntergeladen und geprueft", Knopf "Installieren und neu starten"', /Version 0\.0\.99 ist heruntergeladen und geprüft/.test(await upd()) && (await btns()).join() === 'Installieren und neu starten', `${await upd()} / ${(await btns()).join()}`);
  const done = path.join(updater.dir, file);
  check('Installer liegt vollstaendig und unveraendert im Download-Ordner', fs.existsSync(done) && fs.statSync(done).size === 6 * 1024 * 1024 && fs.readdirSync(updater.dir).length === 1, JSON.stringify(fs.readdirSync(updater.dir)));
  await ctx.capture(path.join(out, 'U-04-about-ready.png'));

  // ---------- Installieren: nicht waehrend der Wiedergabe, dann wirklich ----------
  updater.canInstall = () => false;
  await clickBtn('Installieren und neu starten');
  await waitFor(async () => (await toasts()).some((t) => /nach der Wiedergabe/.test(t)), 3000);
  check('Waehrend der Wiedergabe: Hinweis "erst nach der Wiedergabe", nichts gestartet', (await toasts()).some((t) => /nach der Wiedergabe/.test(t)) && launched.length === 0 && quits === 0, (await toasts()).join(' | '));
  check('...das Update bleibt bereit', /heruntergeladen und geprüft/.test(await upd()));
  updater.canInstall = () => true;
  await clickBtn('Installieren und neu starten');
  await waitFor(() => launched.length === 1 && quits === 1, 4000);
  check('Installieren: Installer mit --updated /S --force-run gestartet, danach beendet sich die App', launched.length === 1 && quits === 1 && launched[0].f === done && launched[0].args.join(' ') === '--updated /S --force-run', JSON.stringify({ launched, quits }));
  check('...Anzeige "Installiere ..." ohne Knoepfe', /Installiere/.test(await upd()) && (await btns()).length === 0, await upd());

  // ---------- Automatische Pruefung: neue Version, Hinweis genau einmal ----------
  updater._publish({ status: 'idle' }); // der Test-Installer hat die App nicht beendet: Zustand zuruecksetzen
  fs.rmSync(done, { force: true });
  ({ file } = publish('0.1.00', 'Neu: noch mehr'));
  await page(`location.hash = '#/home'`);
  await ctx.wait(800);
  const before = (await toasts()).filter((t) => /0\.1\.00/.test(t)).length;
  await updater.check({ manual: false });
  await waitFor(async () => (await toasts()).some((t) => /Version 0\.1\.00 ist verfügbar/.test(t)), 3000);
  check('Automatische Pruefung: Toast fuer die neue Version 0.1.00', before === 0 && (await toasts()).some((t) => /Version 0\.1\.00 ist verfügbar/.test(t)), (await toasts()).join(' | '));
  check('...Punkt am Zahnrad nennt 0.1.00', /0\.1\.00/.test(await dot()), await dot());
  await updater.check({ manual: false });
  await ctx.wait(500);
  check('...zweite Pruefung zeigt keinen weiteren Toast fuer dieselbe Version', (await toasts()).filter((t) => /0\.1\.00/.test(t)).length === 1, (await toasts()).join(' | '));
  const n2 = await noteInfo();
  check('Auf der Startseite steht "Update verfuegbar", der Tooltip nennt die neue Version 0.1.00', !!n2 && n2.text === 'Update verfügbar' && /0\.1\.00/.test(n2.title) && n2.status === 'available', JSON.stringify(n2));
  await ctx.capture(path.join(out, 'U-05-home-dot.png'));
  // Zustaende laden/bereit: der Text folgt dem Zustand, beim Installieren oder ohne Update verschwindet der Hinweis
  updater._publish(updater._found({ status: 'downloading', received: 100 }));
  await ctx.wait(200);
  const n3 = await noteInfo();
  updater._publish(updater._found({ status: 'ready' }));
  await ctx.wait(200);
  const n4 = await noteInfo();
  updater._publish({ status: 'none' });
  await ctx.wait(200);
  const n5 = await noteInfo();
  check('Der Hinweis bleibt bei Laden und Bereit "Update verfuegbar" (nur der Zustand wechselt), ohne Update ist er weg', n3?.text === 'Update verfügbar' && n3?.status === 'downloading' && n4?.text === 'Update verfügbar' && n4?.status === 'ready' && n5 === null && (await dot()) === '', JSON.stringify({ n3, n4, n5 }));
  await updater.check({ manual: false }); // zurueck auf "verfuegbar" (derselbe Hinweis-Toast kommt nicht noch einmal)
  await waitFor(async () => !!(await noteInfo()), 3000);
  check('...die Version ist als angekuendigt gemerkt', ctx.config.settings.general.updateSeen === '0.1.00', ctx.config.settings.general.updateSeen);
  // Neustart der Oberflaeche (so wie ein App-Neustart mit demselben gefundenen Update): derselbe Hinweis kommt NICHT noch einmal
  await page(`document.dispatchEvent(new CustomEvent('relogin'))`);
  await ctx.wait(4000);
  check('Nach einem Neustart der Oberflaeche kommt der Hinweis fuer dieselbe Version nicht noch einmal (nur der Punkt bleibt)', (await toasts()).filter((t) => /0\.1\.00/.test(t)).length === 1 && /0\.1\.00/.test(await dot()), `${(await toasts()).join(' | ')} / dot=${await dot()}`);

  // ---------- Nicht stoeren: waehrend der Wiedergabe kein Hinweis, er kommt danach ----------
  await page(`document.documentElement.classList.add('playing')`);
  ({ file } = publish('0.1.01', 'Neu: Feinschliff'));
  await updater.check({ manual: false });
  await ctx.wait(1000);
  check('Waehrend der Wiedergabe (Klasse "playing") kein Hinweis, der Punkt ist trotzdem da', !(await toasts()).some((t) => /0\.1\.01/.test(t)) && /0\.1\.01/.test(await dot()) && ctx.config.settings.general.updateSeen === '0.1.00', `${(await toasts()).join(' | ')} / dot=${await dot()} / seen=${ctx.config.settings.general.updateSeen}`);
  await page(`document.documentElement.classList.remove('playing'); document.dispatchEvent(new Event('visibilitychange'))`);
  check('Nach der Wiedergabe meldet sich der Hinweis (einmal)', await waitFor(async () => (await toasts()).some((t) => /Version 0\.1\.01 ist verfügbar/.test(t)), 4000) && ctx.config.settings.general.updateSeen === '0.1.01');
  // Fenster nicht sichtbar (minimiert): der Hinweis wartet, bis man es wieder sieht. Das Minimieren selbst ist in der VM unzuverlaessig, deshalb meldet die Seite
  // hier "hidden" ueber document.visibilityState (das liest der Hinweis) und danach wieder "visible" mit dem Ereignis visibilitychange.
  ({ file } = publish('0.1.02', 'Neu: noch ein Stueck'));
  await page(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`);
  await updater.check({ manual: false });
  await ctx.wait(1200);
  check('Bei nicht sichtbarem Fenster kommt kein Hinweis (er waere unsichtbar und verbraucht)', !(await toasts()).some((t) => /0\.1\.02/.test(t)) && ctx.config.settings.general.updateSeen === '0.1.01' && /0\.1\.02/.test(await dot()), `seen=${ctx.config.settings.general.updateSeen} / dot=${await dot()}`);
  await page(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))`);
  check('...er kommt, sobald das Fenster wieder sichtbar ist', await waitFor(async () => (await toasts()).some((t) => /Version 0\.1\.02 ist verfügbar/.test(t)), 5000) && ctx.config.settings.general.updateSeen === '0.1.02');
  // ---------- Automatische Suche ausschalten ----------
  await page(`location.hash = '#/settings/general'`);
  await waitFor(() => page(`!!${autoSwitch}`));
  await page(`${autoSwitch}.click()`);
  await ctx.wait(700);
  check('Schalter "Automatisch nach Updates suchen" aus: gespeichert (die Quelle bleibt trotzdem unveraendert und unsichtbar)', ctx.config.settings.general.autoUpdate === false && !('updateSource' in ctx.config.settings.general));
  // ---------- Konsole sauber? ----------
  check('Konsole ohne Fehler und Warnungen', errors.length === 0, errors.slice(0, 4).join(' | '));

  src.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  const pass = results.filter(Boolean).length;
  console.log(`\nErgebnis: ${pass}/${results.length} Pruefungen bestanden`);
  if (pass !== results.length) process.exitCode = 1;
};
