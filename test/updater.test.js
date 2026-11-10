'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { Updater, UpdateError, normalizeSource, cleanSource, parseManifest, compareVersions, parseVersion } = require('../src/main/updater');

const sha = (buf) => crypto.createHash('sha512').update(buf).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jc-upd-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

/** Legt latest.json und einen Schein-Installer in `root` ab. */
function publish(root, version, { bytes = 300_000, notes = 'Neu: Updater', mutate } = {}) {
  const data = crypto.randomBytes(bytes);
  const file = `Jellycloud-Player-Setup-${version}.exe`;
  fs.writeFileSync(path.join(root, file), data);
  const manifest = { version, file, size: data.length, sha512: sha(data), date: '2026-11-04T10:00:00Z', notes };
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify(mutate ? mutate(manifest) : manifest));
  return { data, manifest, file };
}

/** Kleiner Webserver für einen Ordner. hooks.handle(name, req, res) kann eine Anfrage selbst beantworten (true zurückgeben). */
async function serve(root, hooks = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].slice(1));
    hits.push(name);
    if (hooks.handle?.(name, req, res)) return;
    const file = path.join(root, path.basename(name));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'content-length': buf.length, 'content-type': 'application/octet-stream' }).end(buf);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, hits, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))) };
}

function make({ source, version = '0.0.26', ...extra } = {}) {
  const base = tmp();
  const dir = path.join(base, 'updates');
  const calls = { launch: [], quit: 0 };
  const u = new Updater({
    currentVersion: version,
    getSource: () => source,
    dir,
    launch: (file, args) => {
      calls.launch.push({ file, args });
    },
    quit: () => {
      calls.quit++;
    },
    installDelayMs: 0,
    ...extra
  });
  return { u, calls, dir };
}

const leftovers = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

test('Versionen: lesen und vergleichen', () => {
  assert.deepEqual(parseVersion('0.0.27'), [0, 0, 27]);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('1.2.3-beta'), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(compareVersions('0.0.27', '0.0.26'), 1);
  assert.equal(compareVersions('0.0.26', '0.0.26'), 0);
  assert.equal(compareVersions('0.0.9', '0.0.10'), -1, 'numerisch, nicht als Text');
  assert.equal(compareVersions('0.0.50', '1.1.0'), -1);
  assert.ok(Number.isNaN(compareVersions('x', '1.0.0')));
});

test('Quelle: https-Adressen, Ordner und abgelehnte Eingaben', () => {
  assert.equal(normalizeSource(''), null);
  assert.equal(normalizeSource('   '), null);
  assert.equal(cleanSource(''), '');
  assert.equal(normalizeSource('https://example.com/updates').base, 'https://example.com/updates/', 'Schrägstrich wird ergänzt');
  assert.equal(normalizeSource('https://example.com/updates/latest.json').base, 'https://example.com/updates/', 'latest.json wird abgeschnitten');
  assert.equal(normalizeSource('https://example.com/u/?x=1#frag').base, 'https://example.com/u/', 'Abfrage und Anker entfallen');
  assert.equal(normalizeSource('http://127.0.0.1:8123').kind, 'http', 'http nur für den eigenen Rechner');
  assert.equal(normalizeSource('http://localhost:8123/x').base, 'http://localhost:8123/x/');
  assert.throws(() => normalizeSource('http://example.com/updates'), UpdateError, 'http über das Netz ist verboten');
  assert.throws(() => normalizeSource('ftp://example.com/updates'), UpdateError);
  assert.throws(() => normalizeSource('file:///C:/updates'), UpdateError);
  assert.throws(() => normalizeSource('https://user:pw@example.com/'), /Zugangsdaten/);
  assert.throws(() => normalizeSource('https://'), UpdateError);
  assert.throws(() => normalizeSource('updates\\neu'), /vollständigen Pfad/, 'relative Pfade sind mehrdeutig');
  assert.throws(() => normalizeSource('irgendwas'), UpdateError);
  if (WIN) {
    assert.deepEqual(normalizeSource('C:\\Updates\\Jellycloud'), { kind: 'dir', dir: 'C:\\Updates\\Jellycloud', display: 'C:\\Updates\\Jellycloud' });
    assert.equal(normalizeSource('C:\\Updates\\latest.json').dir, 'C:\\Updates', 'auch hier: latest.json meint den Ordner');
    assert.equal(normalizeSource('\\\\nas\\freigabe\\updates').kind, 'dir', 'Netzwerkfreigabe');
  }
});

test('latest.json: gültig, mit BOM, unbekannte Felder fallen weg', () => {
  const good = { version: '0.0.27', file: 'Jellycloud-Player-Setup-0.0.27.exe', size: 1234, sha512: 'a'.repeat(128), notes: ' Neu \u0007 und besser ', date: '2026-11-04', evil: '<script>' };
  const m = parseManifest(`\uFEFF${JSON.stringify(good)}`);
  assert.deepEqual(m, { version: '0.0.27', file: good.file, size: 1234, sha512: 'a'.repeat(128), notes: 'Neu  und besser', date: '2026-11-04' });
  assert.equal(parseManifest(JSON.stringify({ ...good, sha512: 'A'.repeat(128) })).sha512, 'a'.repeat(128), 'Großbuchstaben werden vereinheitlicht');
  assert.equal(parseManifest(JSON.stringify({ ...good, notes: 'x'.repeat(5000) })).notes.length, 2000);
  assert.equal(parseManifest(JSON.stringify({ ...good, date: 'kein datum' })).date, '');
});

test('latest.json: ungültige Angaben werden abgelehnt', () => {
  const good = { version: '0.0.27', file: 'Jellycloud-Player-Setup-0.0.27.exe', size: 1234, sha512: 'a'.repeat(128) };
  const bad = (patch, re) => assert.throws(() => parseManifest(JSON.stringify({ ...good, ...patch })), re ?? UpdateError, JSON.stringify(patch));
  bad({ version: '0.0' });
  bad({ version: 27 });
  bad({ file: '..\\evil.exe' });
  bad({ file: '../Jellycloud-Player-Setup-0.0.27.exe' });
  bad({ file: 'C:\\Windows\\Jellycloud-Player-Setup-0.0.27.exe' });
  bad({ file: 'https://evil.example/Jellycloud-Player-Setup-0.0.27.exe' });
  bad({ file: 'Jellycloud-Player-Setup-0.0.27.msi' });
  bad({ file: 'Jellycloud-Player-Setup-0.0.28.exe' }, /passen nicht zusammen/);
  bad({ size: 0 });
  bad({ size: -5 });
  bad({ size: 12.5 });
  bad({ size: '1234' });
  bad({ size: 2 * 1024 ** 3 });
  bad({ sha512: 'abc' });
  bad({ sha512: 'g'.repeat(128) });
  bad({ sha512: undefined }, /sha512/);
  assert.throws(() => parseManifest('kein json'), /kein gültiges JSON/);
  assert.throws(() => parseManifest('[]'), UpdateError);
  assert.throws(() => parseManifest('null'), UpdateError);
});

test('Prüfen: neuere Version wird angeboten, gleiche und ältere nicht', async () => {
  const root = tmp();
  const srv = await serve(root);
  try {
    const { manifest } = publish(root, '0.0.27', { notes: 'Neu: Updater' });
    const { u } = make({ source: srv.url });
    const seen = [];
    u.on('state', (s) => seen.push(s.status));
    const s = await u.check({ manual: true });
    assert.equal(s.status, 'available');
    assert.equal(s.version, '0.0.27');
    assert.equal(s.size, manifest.size);
    assert.equal(s.notes, 'Neu: Updater');
    assert.equal(s.current, '0.0.26');
    assert.ok(s.checkedAt > 0);
    assert.deepEqual(seen, ['checking', 'available']);
    assert.equal(srv.hits.filter((n) => n === 'latest.json').length, 1);

    publish(root, '0.0.26');
    assert.equal((await u.check({ manual: true })).status, 'none', 'gleiche Version');
    publish(root, '0.0.20');
    assert.equal((await u.check({ manual: true })).status, 'none', 'ältere Version wird nie angeboten (kein Zurück)');
  } finally {
    await srv.close();
  }
});

test('Prüfen: ohne Quelle bleibt die automatische Prüfung stumm, die manuelle meldet es', async () => {
  const { u } = make({ source: '', fetch: () => assert.fail('darf nichts abrufen') });
  const states = [];
  u.on('state', (s) => states.push(s));
  assert.equal((await u.check({ manual: false })).status, 'idle');
  assert.equal(states.length, 0);
  const s = await u.check({ manual: true });
  assert.equal(s.status, 'error');
  assert.equal(s.noSource, true);
  assert.match(s.error, /keine Update-Quelle/);
});

test('Prüfen: eine ungültige Quelle meldet nur die manuelle Prüfung', async () => {
  const { u } = make({ source: 'http://example.com/x', fetch: () => assert.fail('darf nichts abrufen') });
  assert.equal((await u.check({ manual: false })).status, 'idle');
  const s = await u.check({ manual: true });
  assert.equal(s.status, 'error');
  assert.match(s.error, /https/);
});

test('Prüfen: Fehlerfälle haben lesbare Meldungen', async () => {
  const root = tmp();
  const srv = await serve(root);
  const { u } = make({ source: srv.url });
  assert.match((await u.check({ manual: true })).error, /keine latest\.json.*404/, 'Quelle ohne latest.json');

  fs.writeFileSync(path.join(root, 'latest.json'), 'das ist kein json');
  assert.match((await u.check({ manual: true })).error, /kein gültiges JSON/);

  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ version: '0.0.30', pad: 'x'.repeat(70_000) }));
  assert.match((await u.check({ manual: true })).error, /zu groß/);

  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ version: '0.0.30' }));
  assert.match((await u.check({ manual: true })).error, /unvollständig/);

  await srv.close();
  const down = await u.check({ manual: true });
  assert.equal(down.status, 'error');
  assert.match(down.error, /nicht erreichbar/);
});

test('Prüfen: zwei Aufrufe gleichzeitig ergeben eine Anfrage', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const { u } = make({ source: srv.url });
    const [a, b] = await Promise.all([u.check({ manual: true }), u.check({ manual: true })]);
    assert.equal(a, b);
    assert.equal(srv.hits.filter((n) => n === 'latest.json').length, 1);
  } finally {
    await srv.close();
  }
});

test('Herunterladen: Fortschritt, geprüfte Datei, keine Reste', async () => {
  const root = tmp();
  const { data, file } = publish(root, '0.0.27', { bytes: 2_000_000 });
  const srv = await serve(root);
  try {
    const { u, dir } = make({ source: srv.url });
    await u.check({ manual: true });
    const progress = [];
    u.on('state', (s) => s.status === 'downloading' && progress.push(s.received));
    const s = await u.download();
    assert.equal(s.status, 'ready');
    assert.equal(s.version, '0.0.27');
    assert.ok(progress.length >= 1 && progress[0] === 0, 'beginnt bei 0');
    assert.ok(progress.every((v, i) => i === 0 || v >= progress[i - 1]), 'Fortschritt wird nie kleiner');
    assert.deepEqual(leftovers(dir), [file], 'nur der fertige Installer, keine .part-Datei');
    assert.ok(fs.readFileSync(path.join(dir, file)).equals(data));
  } finally {
    await srv.close();
  }
});

test('Herunterladen: falsche Prüfsumme verwirft die Datei', async () => {
  const root = tmp();
  publish(root, '0.0.27', { mutate: (m) => ({ ...m, sha512: 'b'.repeat(128) }) });
  const srv = await serve(root);
  try {
    const { u, dir } = make({ source: srv.url });
    await u.check({ manual: true });
    const s = await u.download();
    assert.equal(s.status, 'error');
    assert.match(s.error, /Prüfsumme/);
    assert.equal(s.version, '0.0.27', 'Version bleibt stehen: "erneut versuchen" ist möglich');
    assert.deepEqual(leftovers(dir), []);
  } finally {
    await srv.close();
  }
});

test('Herunterladen: zu kleine und zu große Dateien werden abgelehnt', async () => {
  const root = tmp();
  const { manifest } = publish(root, '0.0.27', { bytes: 100_000 });
  const srv = await serve(root);
  try {
    const { u, dir } = make({ source: srv.url });
    await u.check({ manual: true });
    // Der Server liefert weniger, als latest.json verspricht
    fs.writeFileSync(path.join(root, manifest.file), crypto.randomBytes(60_000));
    let s = await u.download();
    assert.equal(s.status, 'error');
    assert.match(s.error, /unvollständig/);
    // ... und mehr
    fs.writeFileSync(path.join(root, manifest.file), crypto.randomBytes(150_000));
    s = await u.download();
    assert.equal(s.status, 'error');
    assert.match(s.error, /größer/);
    assert.deepEqual(leftovers(dir), []);
  } finally {
    await srv.close();
  }
});

test('Herunterladen: Verbindungsabbruch mitten im Download, danach läuft ein neuer Versuch durch', async () => {
  const root = tmp();
  const { data, file } = publish(root, '0.0.27', { bytes: 600_000 });
  let breakIt = true;
  const srv = await serve(root, {
    handle: (name, _req, res) => {
      if (name !== file || !breakIt) return false;
      res.writeHead(200, { 'content-length': data.length });
      res.write(data.subarray(0, 200_000));
      setTimeout(() => res.destroy(), 30);
      return true;
    }
  });
  try {
    const { u, dir } = make({ source: srv.url });
    await u.check({ manual: true });
    let s = await u.download();
    assert.equal(s.status, 'error');
    assert.deepEqual(leftovers(dir), [], 'keine halbe Datei');
    breakIt = false;
    s = await u.download();
    assert.equal(s.status, 'ready');
    assert.deepEqual(leftovers(dir), [file]);
  } finally {
    await srv.close();
  }
});

test('Herunterladen: Abbrechen räumt auf, das Update bleibt verfügbar', async () => {
  const root = tmp();
  const { data, file } = publish(root, '0.0.27', { bytes: 400_000 });
  let slow = true;
  const srv = await serve(root, {
    handle: (name, _req, res) => {
      if (name !== file || !slow) return false;
      res.writeHead(200, { 'content-length': data.length });
      let at = 0;
      const timer = setInterval(() => {
        if (res.destroyed || at >= data.length) return clearInterval(timer);
        res.write(data.subarray(at, at + 20_000));
        at += 20_000;
        if (at >= data.length) res.end();
      }, 15);
      res.on('close', () => clearInterval(timer));
      return true;
    }
  });
  try {
    const { u, dir } = make({ source: srv.url });
    await u.check({ manual: true });
    const run = u.download();
    const got = new Promise((r) => u.on('state', (s) => s.status === 'downloading' && s.received > 0 && r()));
    await got;
    await u.cancel();
    const s = await run;
    assert.equal(s.status, 'available', 'zurück auf "verfügbar", kein Fehler');
    assert.equal(s.error, undefined);
    assert.deepEqual(leftovers(dir), []);
    slow = false;
    assert.equal((await u.download()).status, 'ready');
  } finally {
    await srv.close();
  }
});

test('Herunterladen: ein schon vollständig vorhandener Installer wird nicht noch einmal geholt', async () => {
  const root = tmp();
  const { file } = publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const first = make({ source: srv.url });
    await first.u.check({ manual: true });
    await first.u.download();
    assert.equal(srv.hits.filter((n) => n === file).length, 1);
    // Zweiter Start der App mit demselben Download-Ordner
    const again = new Updater({ currentVersion: '0.0.26', getSource: () => srv.url, dir: first.dir, launch() {}, quit() {} });
    await again.check({ manual: true });
    assert.equal((await again.download()).status, 'ready');
    assert.equal(srv.hits.filter((n) => n === file).length, 1, 'kein zweiter Abruf');
  } finally {
    await srv.close();
  }
});

test('Herunterladen: ohne gefundenes Update gibt es nichts zu laden', async () => {
  const { u } = make({ source: '' });
  await assert.rejects(() => u.download(), /kein Update/);
});

test('Installieren: Installer startet still mit den richtigen Angaben, danach beendet sich die App', async () => {
  const root = tmp();
  const { file } = publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const { u, dir, calls } = make({ source: srv.url });
    await u.check({ manual: true });
    await assert.rejects(() => u.install(), /kein heruntergeladenes Update/, 'vor dem Download nicht möglich');
    await u.download();
    const states = [];
    u.on('state', (s) => states.push(s.status));
    await u.install();
    assert.equal(calls.launch.length, 1);
    assert.equal(calls.launch[0].file, path.join(dir, file));
    assert.deepEqual(calls.launch[0].args, ['--updated', '/S', '--force-run']);
    assert.equal(calls.quit, 1);
    assert.deepEqual(states, ['installing']);
  } finally {
    await srv.close();
  }
});

test('Installieren: nicht während der Wiedergabe und nicht in der Entwicklung', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    let playing = true;
    const { u, calls } = make({ source: srv.url, canInstall: () => !playing });
    await u.check({ manual: true });
    await u.download();
    await assert.rejects(() => u.install(), /nach der Wiedergabe/);
    assert.equal(calls.launch.length, 0);
    assert.equal(calls.quit, 0);
    assert.equal(u.state.status, 'ready', 'bleibt bereit');
    playing = false;
    await u.install();
    assert.equal(calls.launch.length, 1);

    const dev = make({ source: srv.url, packaged: false });
    await dev.u.check({ manual: true });
    await dev.u.download();
    await assert.rejects(() => dev.u.install(), /installierten App/);
    assert.equal(dev.calls.launch.length, 0);
  } finally {
    await srv.close();
  }
});

test('Installieren: eine veränderte Datei wird nicht gestartet', async () => {
  const root = tmp();
  const { file } = publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const { u, dir, calls } = make({ source: srv.url });
    await u.check({ manual: true });
    await u.download();
    fs.appendFileSync(path.join(dir, file), 'x'); // jemand tauscht die Datei aus
    await assert.rejects(() => u.install(), /beschädigt/);
    assert.equal(calls.launch.length, 0);
    assert.equal(calls.quit, 0);
    assert.equal(u.state.status, 'error');
    assert.ok(!fs.existsSync(path.join(dir, file)), 'die Datei wurde gelöscht');
    assert.equal((await u.download()).status, 'ready', 'neuer Versuch holt sie sauber');
  } finally {
    await srv.close();
  }
});

test('Installieren: lässt sich der Installer nicht starten, bleibt die App offen', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const { u, calls } = make({
      source: srv.url,
      launch: () => {
        throw Object.assign(new Error('spawn'), { code: 'EACCES' });
      }
    });
    await u.check({ manual: true });
    await u.download();
    await assert.rejects(() => u.install(), /nicht gestartet werden \(EACCES\)/);
    assert.equal(calls.quit, 0);
    assert.equal(u.state.status, 'error');
  } finally {
    await srv.close();
  }
});

test('Ordner als Quelle: prüfen, laden, installieren', { skip: !WIN && 'Pfadform nur unter Windows' }, async () => {
  const root = tmp();
  const { data, file } = publish(root, '0.0.27', { bytes: 500_000 });
  const { u, dir, calls } = make({ source: root });
  assert.equal((await u.check({ manual: true })).status, 'available');
  assert.equal((await u.download()).status, 'ready');
  assert.ok(fs.readFileSync(path.join(dir, file)).equals(data));
  await u.install();
  assert.equal(calls.launch.length, 1);

  const empty = make({ source: tmp() });
  assert.match((await empty.u.check({ manual: true })).error, /keine latest\.json/);
  const missing = make({ source: path.join(tmp(), 'gibt-es-nicht') });
  assert.match((await missing.u.check({ manual: true })).error, /keine latest\.json/);
});

test('Ordner als Quelle: fehlt der Installer, kommt eine klare Meldung', { skip: !WIN && 'Pfadform nur unter Windows' }, async () => {
  const root = tmp();
  const { file } = publish(root, '0.0.27');
  const { u } = make({ source: root });
  await u.check({ manual: true });
  fs.rmSync(path.join(root, file));
  const s = await u.download();
  assert.equal(s.status, 'error');
  assert.match(s.error, new RegExp(`fehlt ${file.replace(/\./g, '\\.')}`));
});

test('Automatische Prüfung lässt ein heruntergeladenes Update in Ruhe', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const { u } = make({ source: srv.url });
    await u.check({ manual: true });
    await u.download();
    const before = srv.hits.length;
    assert.equal((await u.check({ manual: false })).status, 'ready');
    assert.equal((await u.check({ manual: true })).status, 'ready');
    assert.equal(srv.hits.length, before, 'keine neue Anfrage');
  } finally {
    await srv.close();
  }
});

test('Quelle gewechselt: bisheriges Ergebnis verfällt', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    const { u } = make({ source: srv.url });
    await u.check({ manual: true });
    assert.equal(u.state.status, 'available');
    u.sourceChanged();
    assert.equal(u.state.status, 'idle');
    assert.equal(u.state.checkedAt, 0);
    await assert.rejects(() => u.download(), /kein Update/);
  } finally {
    await srv.close();
  }
});

test('Aufräumen: alte und halbe Installer verschwinden, neuere und fremde Dateien bleiben', () => {
  const { u, dir } = make({ source: '', version: '0.0.26' });
  fs.mkdirSync(dir, { recursive: true });
  const names = ['Jellycloud-Player-Setup-0.0.20.exe', 'Jellycloud-Player-Setup-0.0.26.exe', 'Jellycloud-Player-Setup-0.0.30.exe.part', 'Jellycloud-Player-Setup-0.0.30.exe', 'notiz.txt'];
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
  u.purge();
  assert.deepEqual(leftovers(dir).sort(), ['Jellycloud-Player-Setup-0.0.30.exe', 'notiz.txt']);
  u.purge('nichts-bestimmtes'); // beim Herunterladen: alles andere des Musters weg
  assert.deepEqual(leftovers(dir), ['notiz.txt']);
  assert.doesNotThrow(() => make({ source: '' }).u.purge(), 'Ordner existiert noch nicht');
});

test('Aufräumen: eine Datei, die sich nicht löschen lässt, wirft keinen Fehler und hält die übrigen nicht auf', () => {
  // Nach einem Update läuft der Installer noch aus seiner Datei (Windows sperrt sie); ein Fehler hier hat den Start der App abgebrochen
  const { u, dir } = make({ source: '', version: '0.0.26' });
  fs.mkdirSync(dir, { recursive: true });
  const blocked = path.join(dir, 'Jellycloud-Player-Setup-0.0.20.exe');
  fs.mkdirSync(blocked); // Ersatz für eine gesperrte Datei: rmSync ohne recursive scheitert daran
  assert.throws(() => fs.rmSync(blocked, { force: true }), 'Ersatz lässt sich wirklich nicht löschen');
  fs.writeFileSync(path.join(dir, 'Jellycloud-Player-Setup-0.0.25.exe.part'), 'x');
  fs.writeFileSync(path.join(dir, 'Jellycloud-Player-Setup-0.0.26.exe'), 'x');
  assert.doesNotThrow(() => u.purge());
  assert.deepEqual(leftovers(dir), ['Jellycloud-Player-Setup-0.0.20.exe'], 'die löschbaren sind trotzdem weg');
  assert.doesNotThrow(() => u.purge('anderer-name'), 'auch beim Herunterladen');
});

test('Aufräumen: der Installer, der gerade noch läuft, bleibt stehen, ohne dass der Start scheitert', { skip: process.platform !== 'win32' }, async () => {
  const { spawn } = require('node:child_process');
  const { u, dir } = make({ source: '', version: '0.0.40' });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Jellycloud-Player-Setup-0.0.40.exe');
  fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), file);
  const child = spawn(file, ['-n', '30', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
  try {
    await sleep(400);
    assert.doesNotThrow(() => u.purge());
    assert.ok(fs.existsSync(file), 'gesperrt: bleibt bis zum nächsten Start');
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  u.purge();
  assert.deepEqual(leftovers(dir), [], 'beim nächsten Start (Installer beendet) ist sie weg');
});

test('Zeitplan: prüft nur, wenn es eingeschaltet ist', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  const srv = await serve(root);
  try {
    let on = false;
    const { u } = make({ source: srv.url });
    u.schedule({ enabled: () => on, firstMs: 20, everyMs: 60 });
    await sleep(150);
    assert.equal(srv.hits.length, 0, 'ausgeschaltet: keine Anfrage');
    on = true;
    await sleep(200);
    u.stop();
    assert.equal(u.state.status, 'available');
    assert.ok(srv.hits.length >= 1);
    const n = srv.hits.length;
    await sleep(150);
    assert.equal(srv.hits.length, n, 'nach stop() kommt nichts mehr');
  } finally {
    await srv.close();
  }
});

test('GitHub: Seiten des Repos werden zu den Release-Dateien (neuestes Release oder genau eines), Kurzform github:NAME/REPO', () => {
  const latest = 'https://github.com/KaterBeratung/jellycloud-releases/releases/latest/download/';
  for (const input of [
    'https://github.com/KaterBeratung/jellycloud-releases',
    'https://github.com/KaterBeratung/jellycloud-releases/',
    'https://github.com/KaterBeratung/jellycloud-releases.git',
    'https://github.com/KaterBeratung/jellycloud-releases/releases',
    'https://github.com/KaterBeratung/jellycloud-releases/releases/',
    'https://github.com/KaterBeratung/jellycloud-releases/releases/latest',
    'https://github.com/KaterBeratung/jellycloud-releases/releases/latest/download',
    'https://github.com/KaterBeratung/jellycloud-releases/releases/latest/download/latest.json',
    'https://github.com/KaterBeratung/jellycloud-releases/releases?q=x#y',
    'github:KaterBeratung/jellycloud-releases',
    'GitHub:KaterBeratung/jellycloud-releases.git'
  ]) {
    assert.equal(normalizeSource(input).base, latest, input);
  }
  assert.equal(normalizeSource('https://github.com/KaterBeratung/jellycloud-releases/releases/tag/v0.0.30').base, 'https://github.com/KaterBeratung/jellycloud-releases/releases/download/v0.0.30/', 'ein bestimmtes Release');
  assert.equal(normalizeSource('https://github.com/KaterBeratung/jellycloud-releases/releases/download/v0.0.30/').base, 'https://github.com/KaterBeratung/jellycloud-releases/releases/download/v0.0.30/', 'schon die Download-Adresse: unveraendert');
  assert.equal(normalizeSource('https://github.com/orgs/foo/').base, 'https://github.com/orgs/foo/', 'keine Repo-Seite: unveraendert');
  assert.equal(normalizeSource('https://github.com/KaterBeratung/jellycloud-releases/blob/main/x/').base, 'https://github.com/KaterBeratung/jellycloud-releases/blob/main/x/', 'andere Seiten bleiben');
  assert.equal(normalizeSource('https://example.com/KaterBeratung/jellycloud-releases').base, 'https://example.com/KaterBeratung/jellycloud-releases/', 'nur bei github.com');
  assert.equal(cleanSource('github:a/b'), 'https://github.com/a/b/releases/latest/download/', 'das Feld zeigt danach die richtige Adresse');
  assert.throws(() => normalizeSource('github:nurname'), UpdateError);
});

test('Eine Webseite statt der Datei wird klar gemeldet (falsche Adresse, Sperr- oder Anmeldeseite)', async () => {
  const root = tmp();
  publish(root, '0.0.27');
  // Der Server liefert fuer alles eine grosse HTML-Seite, wie github.com/.../releases/latest.json
  const srv = await serve(root, {
    handle: (_name, _req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<html>${'x'.repeat(157_000)}</html>`);
      return true;
    }
  });
  try {
    const { u } = make({ source: srv.url });
    const s = await u.check({ manual: true });
    assert.equal(s.status, 'error');
    assert.match(s.error, /Webseite statt der Datei latest\.json/);
    assert.match(s.error, /releases\/latest\/download/, 'mit Hinweis auf die richtige Adresse');
    // Auch ohne HTML-Kennung: zu gross ist zu gross, mit Erklaerung
    const big = await serve(root, { handle: (_n, _q, res) => (res.writeHead(200, { 'content-type': 'application/octet-stream' }).end('y'.repeat(70_000)), true) });
    const t2 = make({ source: big.url });
    assert.match((await t2.u.check({ manual: true })).error, /zu groß.*falsche Adresse/);
    await big.close();
  } finally {
    await srv.close();
  }
});