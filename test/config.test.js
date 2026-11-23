'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore, DEFAULT_SETTINGS, deepMerge } = require('../src/main/config');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jc-cfg-'));
const fakeSafe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`ENC(${s})`), decryptString: (b) => b.toString().slice(4, -1) };

test('Neue Konfiguration: Standardwerte und Geraete-ID', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  assert.match(c.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(c.settings.appearance.accent, '#f5f5f7');
  assert.equal(c.settings.player.hwdec, 'auto-safe');
  assert.equal(new ConfigStore(dir, fakeSafe).deviceId, c.deviceId, 'Geraete-ID bleibt stabil');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Konfiguration mit BOM (Notepad, PowerShell 5) wird gelesen, nichts geht verloren', () => {
  const dir = tmp();
  const body = JSON.stringify({ version: 3, deviceId: 'bom-test-id', servers: [{ id: 's1', url: 'http://x' }], settings: { general: { autostart: true } } });
  fs.writeFileSync(path.join(dir, 'config.json'), `﻿${body}`, 'utf8');
  const c = new ConfigStore(dir, fakeSafe);
  assert.equal(c.deviceId, 'bom-test-id');
  assert.equal(c.data.servers.length, 1, 'gespeicherte Server bleiben');
  assert.equal(c.settings.general.autostart, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Migration auf Version 3: alter Standard-Akzent (Koenigsblau) wird neutral, eigene Farben bleiben', () => {
  const write = (dir, version, accent) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version, deviceId: 'abc', servers: [], settings: { appearance: { accent } } }));
  const dirs = [];
  const load = (version, accent) => {
    const d = tmp();
    dirs.push(d);
    write(d, version, accent);
    return new ConfigStore(d, fakeSafe);
  };
  assert.equal(load(2, '#0b2dbf').settings.appearance.accent, '#f5f5f7', 'Version 2 mit altem Standard');
  assert.equal(load(1, '#0B2DBF').settings.appearance.accent, '#f5f5f7', 'Gross-/Kleinschreibung egal');
  assert.equal(load(2, '#ff8a1f').settings.appearance.accent, '#ff8a1f', 'eigene Farbe bleibt');
  assert.equal(load(3, '#0b2dbf').settings.appearance.accent, '#0b2dbf', 'ab Version 3 ist Blau eine bewusste Wahl');
  const again = load(2, '#0b2dbf');
  again.updateSettings({ appearance: { accent: '#0b2dbf' } });
  assert.equal(new ConfigStore(dirs[dirs.length - 1], fakeSafe).settings.appearance.accent, '#0b2dbf', 'nach der Migration bleibt eine erneute Blau-Wahl erhalten');
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('Migration auf Version 4 bis 6: alte Trailer-Standards (Start 2 oder 8 s, Ausblenden 15 oder 20 s, Lautstaerke 100 %) werden 0 s, 10 s und 10 %, eigene Werte bleiben', () => {
  const dirs = [];
  const load = (version, trailer) => {
    const d = tmp();
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ version, deviceId: 'abc', servers: [], settings: { trailer } }));
    return new ConfigStore(d, fakeSafe);
  };
  const old = load(3, { autoplay: true, muted: true, delaySec: 2, focusSec: 15 });
  assert.equal(old.settings.trailer.delaySec, 0, 'alter Standard Start (2 s, danach 8 s) wird 0 s');
  assert.equal(old.settings.trailer.focusSec, 10, 'alter Standard Ausblenden (15 s) wird 10 s');
  assert.equal(old.settings.trailer.volume, 10, 'alte Standard-Lautstaerke (100 %) wird 10 %');
  assert.equal(load(5, { delaySec: 8, volume: 100 }).settings.trailer.delaySec, 0, 'Standard von Version 5 (8 s) wird 0 s');
  assert.equal(load(5, { delaySec: 8, volume: 100 }).settings.trailer.volume, 10, 'Standard von Version 5 (100 %) wird 10 %');
  assert.equal(load(6, { delaySec: 8, volume: 100 }).settings.trailer.delaySec, 8, 'ab Version 6 sind 8 s eine bewusste Wahl');
  assert.equal(load(6, { delaySec: 8, volume: 100 }).settings.trailer.volume, 100, 'ab Version 6 sind 100 % eine bewusste Wahl');
  assert.equal(load(5, { volume: 40 }).settings.trailer.volume, 40, 'eigene Lautstaerke bleibt');
  assert.equal(load(4, { delaySec: 8, focusSec: 20 }).settings.trailer.focusSec, 10, 'der Standard von Version 4 (20 s) wird 10 s');
  assert.equal(load(5, { delaySec: 8, focusSec: 20 }).settings.trailer.focusSec, 20, 'ab Version 5 ist 20 s eine bewusste Wahl');
  const own = load(3, { delaySec: 5, focusSec: 30 });
  assert.equal(own.settings.trailer.delaySec, 5, 'eigener Wert bleibt');
  assert.equal(own.settings.trailer.focusSec, 30, 'eigener Wert bleibt');
  assert.equal(load(4, { delaySec: 2, focusSec: 15 }).settings.trailer.delaySec, 2, 'ab Version 4 ist 2 s eine bewusste Wahl');
  old.updateSettings({ trailer: { delaySec: 2 } });
  assert.equal(new ConfigStore(dirs[0], fakeSafe).settings.trailer.delaySec, 2, 'nach der Migration bleibt eine erneute Wahl von 2 s erhalten');
  assert.equal(new ConfigStore(tmp(), fakeSafe).settings.trailer.delaySec, 0, 'neue Konfiguration: Start sofort (0 s)');
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('Token wird verschluesselt gespeichert und nie an die Oberflaeche gegeben', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const id = c.saveServer({ url: 'http://s', name: 'S', userId: 'u1', userName: 'alex', token: 'geheim-token' });
  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.ok(!raw.includes('geheim-token'));
  assert.equal(c.getServer(id).token, 'geheim-token');
  assert.ok(!JSON.stringify(c.publicState()).includes('geheim-token'));
  assert.equal(new ConfigStore(dir, fakeSafe).getServer(id).token, 'geheim-token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Ohne Windows-Verschluesselung wird sauber auf Base64 zurueckgefallen', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, { isEncryptionAvailable: () => false });
  const id = c.saveServer({ url: 'http://s', name: 'S', userId: 'u', userName: 'a', token: 'tok' });
  assert.equal(c.getServer(id).token, 'tok');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Server: mehrere, wechseln, entfernen', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const a = c.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'x', token: 't1' });
  const b = c.saveServer({ url: 'http://b', name: 'B', userId: '2', userName: 'y', token: 't2' });
  assert.equal(c.data.activeServerId, b);
  assert.ok(c.setActive(a));
  assert.ok(!c.setActive('nope'));
  c.removeServer(a);
  assert.equal(c.data.activeServerId, b);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Einstellungen: nur bekannte Schluessel mit passendem Typ, kein Prototype-Pollution', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  c.updateSettings({ appearance: { accent: '#112233', posterSize: 'gross', unknown: 1 }, player: { hdr: 'tonemap' } });
  assert.equal(c.settings.appearance.accent, '#112233');
  assert.equal(c.settings.appearance.posterSize, DEFAULT_SETTINGS.appearance.posterSize, 'falscher Typ wird verworfen');
  assert.equal(c.settings.appearance.unknown, 1, 'neue Schluessel aus dem Patch duerfen ergaenzt werden');
  assert.equal(c.settings.player.hdr, 'tonemap');
  deepMerge({}, JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Defekte Konfigurationsdatei fuehrt nicht zum Absturz', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ kaputt');
  const c = new ConfigStore(dir, fakeSafe);
  assert.equal(c.settings.player.hwdec, 'auto-safe');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Neue Einstellungen haben sinnvolle Standardwerte, mpv-Interna sind nicht vorhanden', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const p = c.settings.player;
  assert.equal(p.audioLanguage, 'server');
  assert.equal(p.subtitleMode, 'server');
  assert.equal(p.allowTranscode, true);
  assert.equal(p.preventSleep, true);
  assert.equal(p.seekSmall, 5);
  assert.equal(p.seekBig, 10);
  assert.equal(c.settings.general.rememberWindow, true);
  assert.equal(c.settings.general.spoilerProtection, false);
  for (const k of ['mpvPath', 'mode', 'useUserMpvConf', 'extraMpvArgs']) assert.ok(!(k in p), k);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Fensterzustand wird gespeichert und gelesen, Zuruecksetzen behaelt Server', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  assert.equal(c.windowState, null);
  c.saveWindowState({ x: 10, y: 20, width: 1200, height: 800, maximized: true });
  assert.deepEqual(new ConfigStore(dir, fakeSafe).windowState, { x: 10, y: 20, width: 1200, height: 800, maximized: true });
  const id = c.saveServer({ url: 'http://s', name: 'S', userId: 'u', userName: 'a', token: 't' });
  c.updateSettings({ player: { hdr: 'tonemap', seekBig: 30 }, general: { spoilerProtection: true } });
  const s = c.resetSettings();
  assert.equal(s.player.hdr, 'auto');
  assert.equal(s.player.seekBig, 10);
  assert.equal(s.general.spoilerProtection, false);
  assert.equal(c.getServer(id).token, 't', 'Anmeldung bleibt erhalten');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('Version 9: die Update-Quelle ist fest eingebaut und steht in keiner Einstellung, Altwerte fallen weg', () => {
  const { DEFAULT_UPDATE_SOURCE } = require('../src/main/config');
  const dirs = [];
  const load = (version, general) => {
    const d = tmp();
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ version, deviceId: 'abc', servers: [], settings: { general } }));
    return { store: new ConfigStore(d, fakeSafe), dir: d };
  };
  assert.match(DEFAULT_UPDATE_SOURCE, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/$/, 'Adresse der Release-Dateien des neuesten Releases');
  const fresh = new ConfigStore(tmp(), fakeSafe);
  assert.equal(fresh.data.version, 10);
  assert.ok(!('updateSource' in fresh.settings.general) && !('updateCustom' in fresh.settings.general), 'keine Einstellung fuer die Quelle');
  assert.equal(typeof fresh.effectiveUpdateSource, 'undefined', 'die Konfiguration kennt die Quelle nicht mehr');
  assert.equal(fresh.settings.general.updateSeen, '');
  assert.equal(fresh.settings.general.autoUpdate, true);

  // Altwerte der Versionen 7 und 8 werden entfernt, auch eine fremde Adresse
  for (const [version, general] of [[7, { updateSource: DEFAULT_UPDATE_SOURCE }], [8, { updateCustom: true, updateSource: 'https://evil.example/' }], [8, { updateCustom: false, updateSource: '' }], [9, { updateSource: 'https://evil.example/', updateCustom: true }]]) {
    const { store, dir } = load(version, general);
    assert.ok(!('updateSource' in store.settings.general) && !('updateCustom' in store.settings.general), `Version ${version}: Altwerte entfernt`);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).settings.general;
    assert.ok(!('updateSource' in onDisk) && !('updateCustom' in onDisk), `Version ${version}: auch in der Datei`);
    assert.equal(store.settings.general.autoUpdate, true, `Version ${version}: automatische Pruefung bleibt an`);
  }
  // "Keine Updates" von frueher bleibt als ausgeschaltete automatische Pruefung
  assert.equal(load(7, { updateSource: '', autoUpdate: true }).store.settings.general.autoUpdate, false, 'Version 7 geleert: keine automatische Pruefung');
  assert.equal(load(8, { updateCustom: true, updateSource: '', autoUpdate: true }).store.settings.general.autoUpdate, false, 'Version 8 eigene Quelle ohne Eintrag: keine automatische Pruefung');
  assert.equal(load(8, { updateCustom: false, updateSource: '', autoUpdate: true }).store.settings.general.autoUpdate, true, 'Version 8 Standard: bleibt an');
  assert.equal(load(6, { autoUpdate: true }).store.settings.general.autoUpdate, true, 'Version 6 kannte keine Quelle');
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('Defekte config.json: die Datei wird nicht stumm ueberschrieben, sondern als config.json.corrupt gesichert', () => {
  const dir = tmp();
  const kaputt = '{ "version": 9, "deviceId": "abc", "servers": [ { "id": "s1", "url": "http://x", "token": "dpapi:AAAA" } '; // abgeschnitten
  fs.writeFileSync(path.join(dir, 'config.json'), kaputt, 'utf8');
  const c = new ConfigStore(dir, fakeSafe);
  assert.equal(c.data.servers.length, 0, 'die App startet mit Standardwerten');
  assert.equal(fs.readFileSync(path.join(dir, 'config.json.corrupt'), 'utf8'), kaputt, 'der Inhalt der alten Datei ist gesichert (Server und Einstellungen liessen sich von Hand retten)');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')), 'die neue Datei ist gueltig');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Erster Start (keine Datei): keine Sicherung, nichts zu retten', () => {
  const dir = tmp();
  new ConfigStore(dir, fakeSafe);
  assert.equal(fs.existsSync(path.join(dir, 'config.json.corrupt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Speichern: scheitert das Umbenennen (Virenscanner haelt die Datei offen, EPERM), wird direkt geschrieben statt Einstellungen zu verlieren', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const real = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
  };
  try {
    assert.doesNotThrow(() => c.updateSettings({ appearance: { posterSize: 200 } }));
  } finally {
    fs.renameSync = real;
  }
  assert.equal(new ConfigStore(dir, fakeSafe).settings.appearance.posterSize, 200, 'die Einstellung ist angekommen');
  assert.equal(fs.existsSync(path.join(dir, 'config.json.tmp')), false, 'keine Reste');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Discord-Einstellungen: standardmaessig aus und ohne ID, eigene Werte bleiben, falsche Typen werden verworfen', () => {
  assert.deepEqual(DEFAULT_SETTINGS.discord, { enabled: false, clientId: '', name: '', poster: 'auto', hideTitle: false, button: false });
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 9, deviceId: 'abc', servers: [], settings: { discord: { enabled: true, clientId: '123456789012345678', poster: 'tmdb', hideTitle: 'ja', button: 1 } } }));
  const c = new ConfigStore(dir, fakeSafe);
  assert.equal(c.settings.discord.enabled, true);
  assert.equal(c.settings.discord.clientId, '123456789012345678');
  assert.equal(c.settings.discord.poster, 'tmdb');
  assert.equal(c.settings.discord.hideTitle, false, 'ein Text statt ja/nein wird verworfen');
  assert.equal(c.settings.discord.button, false);
  c.updateSettings({ discord: { poster: 'off' } });
  assert.equal(new ConfigStore(dir, fakeSafe).settings.discord.poster, 'off');
  assert.equal(new ConfigStore(dir, fakeSafe).settings.discord.clientId, '123456789012345678', 'die ID bleibt beim Aendern eines anderen Wertes');
  fs.rmSync(dir, { recursive: true, force: true });
});
// ---------- Version 10 (Angleichung an die Apple-App: P3) ----------
const { THEMES, MAX_PROFILES } = require('../src/main/config');
const enc = (s) => `dpapi:${fakeSafe.encryptString(s).toString('base64')}`;
/** Konfiguration der Version 9 (oder aelter) schreiben und laden. */
function loadRaw(raw) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 9, deviceId: 'abc', ...raw }));
  return { c: new ConfigStore(dir, fakeSafe), dir, disk: () => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) };
}
const profile = (id, userName, extra = {}) => ({ id, url: `http://${id}.test`, name: id, userId: `u-${id}`, userName, token: enc(`t-${id}`), ...extra });

test('Version 10: nur dunkle Designs; Daylight wird Midnight Blue, ein unbekanntes wird Midnight, die uebrigen bleiben', () => {
  assert.deepEqual(THEMES, ['midnight', 'graphite', 'amoled', 'midnightBlue']);
  const dirs = [];
  const theme = (t) => {
    const r = loadRaw({ servers: [], settings: { appearance: { theme: t, accent: '#ff8800' } } });
    dirs.push(r.dir);
    assert.equal(r.c.settings.appearance.accent, '#ff8800', `${t}: die Akzentfarbe bleibt`);
    assert.equal(r.disk().settings.appearance.theme, r.c.settings.appearance.theme, `${t}: so auch in der Datei`);
    return r.c.settings.appearance.theme;
  };
  assert.equal(theme('daylight'), 'midnightBlue', 'das helle Design ist weg; Midnight Blue tritt an seine Stelle');
  for (const t of ['midnight', 'graphite', 'amoled', 'midnightBlue']) assert.equal(theme(t), t);
  assert.equal(theme('sepia'), 'midnight', 'ein Design, das diese Version nicht kennt');
  assert.equal(new ConfigStore(tmp(), fakeSafe).settings.appearance.theme, 'midnight', 'Standard');
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('Version 10: Eckenradius, Animationsstufe und Schalter der Startanimation gibt es nicht mehr (E7); gespeicherte Werte zaehlen nicht', () => {
  for (const ver of [1, 2, 9]) {
    const { c, dir, disk } = loadRaw({ version: ver, servers: [], settings: { appearance: { radius: 4, animations: 'off', startAnimation: false, blur: false, posterSize: 200 } } });
    const look = c.settings.appearance;
    for (const k of ['radius', 'animations', 'startAnimation']) {
      assert.ok(!(k in look), `Version ${ver}: ${k} entfernt`);
      assert.ok(!(k in disk().settings.appearance), `Version ${ver}: ${k} auch nicht in der Datei`);
    }
    assert.equal(look.blur, false, 'andere Einstellungen des Erscheinungsbilds bleiben');
    assert.equal(look.posterSize, 200);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const k of ['radius', 'animations', 'startAnimation', 'showBadges']) assert.ok(!(k in DEFAULT_SETTINGS.appearance), `kein Standardwert fuer ${k}`);
});

test('Version 10: Seerr geht an das aktive Profil, wenn der Benutzername passt (gross/klein egal); ein anderes Profil hat keines', () => {
  const { c, dir, disk } = loadRaw({ activeServerId: 'a', servers: [profile('a', 'Alex'), profile('b', 'Sam')], seerr: { url: 'http://seerr.test:5055', mode: 'jellyfin', userName: 'alex ', secret: enc('SID-1') } });
  assert.deepEqual(c.getSeerr(), { url: 'http://seerr.test:5055', userName: 'alex ', jellyfinUserId: '', secret: 'SID-1' });
  assert.deepEqual(c.publicState().seerr, { url: 'http://seerr.test:5055', userName: 'alex ' }, 'ohne Geheimnis');
  assert.equal(c.getSeerr('b'), null, 'das andere Profil ist nicht verbunden');
  const onDisk = disk();
  assert.ok(!('seerr' in onDisk), 'die Verbindung fuer das ganze Geraet ist weg');
  assert.equal(onDisk.servers[0].seerr.url, 'http://seerr.test:5055');
  assert.ok(!JSON.stringify(onDisk).includes('SID-1'), 'die Sitzung steht nur verschluesselt in der Datei');
  assert.ok(!JSON.stringify(c.publicState()).includes('SID-1'), 'und nie im Zustand der Oberflaeche');
  // Ein zweites Laden uebernimmt nichts noch einmal (Version 10 hat kein seerr auf oberster Ebene)
  assert.deepEqual(new ConfigStore(dir, fakeSafe).getSeerr(), c.getSeerr());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Version 10: Seerr mit anderem Benutzernamen, mit API-Schluessel oder ohne aktives Profil: keine Verbindung, nur die Adresse vorbelegt', () => {
  const cases = [
    ['anderer Name', { activeServerId: 'a', servers: [profile('a', 'Alex')], seerr: { url: 'http://s1.test', mode: 'jellyfin', userName: 'Sam', secret: enc('SID') } }],
    ['API-Schluessel', { activeServerId: 'a', servers: [profile('a', 'Alex')], seerr: { url: 'http://s2.test', mode: 'apikey', userName: 'Alex', secret: enc('KEY') } }],
    ['kein aktives Profil', { servers: [profile('a', 'Alex')], seerr: { url: 'http://s3.test', mode: 'jellyfin', userName: 'Alex', secret: enc('SID') } }],
    ['ohne Sitzung', { activeServerId: 'a', servers: [profile('a', 'Alex')], seerr: { url: 'http://s4.test', mode: 'jellyfin', userName: 'Alex' } }]
  ];
  for (const [name, raw] of cases) {
    const { c, dir, disk } = loadRaw(raw);
    assert.equal(c.getSeerr('a'), null, `${name}: nicht verbunden`);
    assert.equal(c.publicState().seerr, null, name);
    assert.equal(c.data.seerrAddress, raw.seerr.url, `${name}: die Adresse ist gemerkt`);
    if (c.data.activeServerId) assert.equal(c.publicState().seerrAddress, raw.seerr.url, `${name}: und vorbelegt`);
    assert.ok(!JSON.stringify(disk()).includes(raw.seerr.secret ?? 'nichts'), `${name}: Schluessel bzw. Sitzung verworfen`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Seerr je Profil: verbinden, Profil wechseln, trennen (Adresse bleibt vorbelegt), erneut anmelden behaelt die Verbindung, Entfernen nimmt sie mit', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  assert.throws(() => c.saveSeerr({ url: 'http://seerr', userName: 'x', secret: 's' }), (e) => e.code === 'NO_PROFILE', 'ohne Profil kein Seerr');
  const a = c.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'Alex', token: 't1' });
  c.saveSeerr({ url: 'http://seerr', userName: 'Alex', jellyfinUserId: 'jf-1', secret: 'SID-A' });
  const b = c.saveServer({ url: 'http://b', name: 'B', userId: '2', userName: 'Sam', token: 't2' });
  assert.equal(c.getSeerr(), null, 'das neue Profil hat kein Seerr');
  assert.equal(c.publicState().seerr, null);
  c.setActive(a);
  assert.deepEqual(c.getSeerr(), { url: 'http://seerr', userName: 'Alex', jellyfinUserId: 'jf-1', secret: 'SID-A' });
  // Erneut anmelden (neues Token): Seerr und eigener Name bleiben
  c.setProfileLabel(a, 'Wohnzimmer');
  c.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'Alex', token: 't1-neu' });
  assert.equal(c.getSeerr()?.secret, 'SID-A');
  assert.equal(c.getServer(a).label, 'Wohnzimmer');
  assert.equal(c.getServer(a).token, 't1-neu');
  // Trennen: die Adresse bleibt zum erneuten Verbinden
  c.clearSeerr();
  assert.equal(c.getSeerr(), null);
  assert.equal(c.publicState().seerrAddress, 'http://seerr');
  // Entfernen nimmt die Sitzung mit
  c.saveSeerr({ url: 'http://seerr', userName: 'Alex', secret: 'SID-A2' });
  c.removeServer(a);
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes(enc('SID-A2')));
  assert.equal(c.data.activeServerId, b);
  assert.equal(c.getSeerr(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Profile: hoechstens vier, ueber alle Server zusammen; ein gemerktes darf sich immer neu anmelden; nach dem Entfernen wieder moeglich', () => {
  assert.equal(MAX_PROFILES, 4);
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const ids = [0, 1, 2, 3].map((i) => c.saveServer({ url: `http://s${i % 2}.test`, name: 'S', userId: `u${i}`, userName: `u${i}`, token: 't' }));
  assert.equal(c.data.servers.length, 4);
  assert.equal(c.mayAddProfile(c.profileId('http://neu.test', 'x')), false);
  assert.equal(c.mayAddProfile(c.profileId('http://s0.test', 'x')), false, 'gleicher Server, neuer Benutzer');
  assert.throws(() => c.saveServer({ url: 'http://neu.test', name: 'N', userId: 'x', userName: 'x', token: 't' }), (e) => e.code === 'PROFILE_LIMIT');
  assert.equal(c.data.servers.length, 4, 'nichts gespeichert');
  assert.equal(c.data.activeServerId, ids[3], 'das aktive Profil bleibt');
  assert.doesNotThrow(() => c.saveServer({ url: 'http://s0.test', name: 'S', userId: 'u0', userName: 'u0', token: 't-neu' }), 'gemerktes Profil meldet sich neu an');
  c.removeServer(ids[1]);
  assert.ok(c.mayAddProfile(c.profileId('http://neu.test', 'x')));
  assert.doesNotThrow(() => c.saveServer({ url: 'http://neu.test', name: 'N', userId: 'x', userName: 'x', token: 't' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Profile ueber der Grenze (aeltere Version, E13) bleiben alle; es kommt nur keines dazu', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => profile(id, id));
  const { c, dir } = loadRaw({ activeServerId: 'f', servers: six });
  assert.equal(c.data.servers.length, 6, 'nichts geloescht');
  assert.ok(c.mayAddProfile('f'), 'ein gemerktes darf sich neu anmelden');
  assert.equal(c.mayAddProfile('neu'), false);
  assert.equal(c.publicState().maxProfiles, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Eigener Name je Profil: gekuerzt (40 Zeichen), ohne Steuerzeichen, tolerant gelesen, im Zustand der Oberflaeche', () => {
  const { c, dir } = loadRaw({ activeServerId: 'a', servers: [profile('a', 'Alex', { label: 5 }), profile('b', 'Sam', { label: '  Kino  ' })] });
  assert.equal(c.getServer('a').label, '', 'falscher Typ: leer');
  assert.equal(c.getServer('b').label, 'Kino');
  assert.ok(c.setProfileLabel('a', `  Wohn\nzimmer${'x'.repeat(60)}`));
  assert.equal(c.getServer('a').label.length, 40);
  assert.ok(!/\n/.test(c.getServer('a').label));
  assert.equal(c.setProfileLabel('nope', 'x'), false);
  assert.deepEqual(c.publicState().servers.map((s) => s.label), [c.getServer('a').label, 'Kino']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Reihen der Startseite je Profil (nach JellycloudTests/HomeRowsProfileTests.swift der Apple-App)
const deviceRows = { order: ['favorites', 'continue'], hidden: ['nextUp'] };
test('Reihen je Profil: die des Geraets werden die jedes gemerkten Profils; ein spaeter hinzugefuegtes beginnt mit der Standardfolge; nur einmal', () => {
  const { c, dir, disk } = loadRaw({ activeServerId: 'a', servers: [profile('a', 'A'), profile('b', 'B')], settings: { home: { ...deviceRows, heroSlides: 7 }, appearance: { theme: 'graphite' } } });
  assert.ok(c.data.homeRowsAdopted);
  assert.deepEqual(c.homeRows('a'), deviceRows);
  assert.deepEqual(c.homeRows('b'), deviceRows);
  assert.deepEqual(c.homeRows('c'), { order: [], hidden: [] }, 'ein neues Profil erbt die Reihen des Geraets nicht');
  assert.deepEqual(c.homeRows(null), { order: [], hidden: [] });
  // Die Felder des Geraets bleiben gespeichert, wie sie waren; die uebrigen Einstellungen auch
  assert.deepEqual({ order: disk().settings.home.order, hidden: disk().settings.home.hidden }, deviceRows);
  assert.equal(c.settings.home.heroSlides, 7);
  assert.equal(c.settings.appearance.theme, 'graphite');
  // Nur einmal: Aendern, neu laden, weiteres Profil
  c.setHomeRows({ order: ['latest:x'] }, 'a');
  const again = new ConfigStore(dir, fakeSafe);
  again.saveServer({ url: 'http://c.test', name: 'C', userId: 'u-c', userName: 'C', token: 't' });
  assert.deepEqual(again.homeRows('a'), { order: ['latest:x'], hidden: [] });
  assert.deepEqual(again.homeRows(again.data.activeServerId), { order: [], hidden: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Reihen je Profil: ohne gemerktes Profil wird nichts uebernommen; das erste Profil bekommt sie', () => {
  const { c, dir } = loadRaw({ servers: [], settings: { home: deviceRows } });
  assert.equal(c.data.homeRowsAdopted, false, 'ohne Profil als uebernommen markiert waeren die Reihen des Geraets verloren');
  assert.deepEqual(c.homeRows('a'), deviceRows, 'bis dahin gelten die des Geraets');
  assert.equal(new ConfigStore(dir, fakeSafe).data.homeRowsAdopted, false, 'auch nach einem weiteren Start ohne Profil');
  const a = c.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'A', token: 't' });
  assert.ok(c.data.homeRowsAdopted);
  assert.deepEqual(c.homeRows(a), deviceRows);
  const b = c.saveServer({ url: 'http://b', name: 'B', userId: '2', userName: 'B', token: 't' });
  assert.deepEqual(c.homeRows(b), { order: [], hidden: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Reihen je Profil: ohne eigene Reihen des Geraets nichts zu uebernehmen, auch ohne Profil', () => {
  const empty = new ConfigStore(tmp(), fakeSafe);
  assert.ok(empty.data.homeRowsAdopted);
  assert.deepEqual(empty.data.homeRowsByProfile, {});
  const { c, dir } = loadRaw({ activeServerId: 'a', servers: [profile('a', 'A'), profile('b', 'B')] });
  assert.ok(c.data.homeRowsAdopted);
  assert.deepEqual(c.data.homeRowsByProfile, {});
  assert.deepEqual(c.homeRows('a'), { order: [], hidden: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Reihen je Profil: zwei Profile beeinflussen sich nicht (Verschieben, Ausblenden, Zuruecksetzen); die Oberflaeche sieht die des aktiven', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const a = c.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'A', token: 't' });
  const b = c.saveServer({ url: 'http://b', name: 'B', userId: '2', userName: 'B', token: 't' });
  c.setActive(a);
  // So aendert die Oberflaeche die Reihen: ueber updateSettings({ home: ... }); Banner und Folien bleiben beim Geraet
  const s = c.updateSettings({ home: { order: ['latest:serien', 'continue'], hidden: ['nextUp'], heroSlides: 8 } });
  assert.deepEqual([s.home.order, s.home.hidden, s.home.heroSlides], [['latest:serien', 'continue'], ['nextUp'], 8]);
  assert.deepEqual(c.settings.home.order, [], 'die Reihen des Geraets bleiben unberuehrt');
  c.setActive(b);
  assert.deepEqual(c.publicState().settings.home.order, [], 'Profil b sieht davon nichts');
  assert.equal(c.publicState().settings.home.heroSlides, 8, 'die Folien gelten fuer das Geraet');
  c.updateSettings({ home: { hidden: ['favorites'] } });
  assert.deepEqual(c.homeRows(a), { order: ['latest:serien', 'continue'], hidden: ['nextUp'] }, 'a bleibt, wie es war');
  assert.deepEqual(c.homeRows(b), { order: [], hidden: ['favorites'] });
  // Nur die Reihenfolge aendern behaelt die ausgeblendeten (und umgekehrt)
  c.updateSettings({ home: { order: ['continue'] } });
  assert.deepEqual(c.homeRows(b), { order: ['continue'], hidden: ['favorites'] });
  // Alle Einstellungen zuruecksetzen bei b: a bleibt
  c.resetSettings();
  assert.deepEqual(c.homeRows(b), { order: [], hidden: [] });
  assert.deepEqual(c.homeRows(a), { order: ['latest:serien', 'continue'], hidden: ['nextUp'] });
  c.setActive(a);
  assert.deepEqual(c.publicState().settings.home.hidden, ['nextUp']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Reihen je Profil: bleiben beim Abmelden (Profil entfernt) und sind nach erneuter Anmeldung wieder da; gespeichert und wieder gelesen', () => {
  const dir = tmp();
  const c = new ConfigStore(dir, fakeSafe);
  const a = c.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'A', token: 't' });
  c.updateSettings({ home: { hidden: ['continue'] } });
  c.removeServer(a);
  assert.equal(c.data.servers.length, 0);
  const read = new ConfigStore(dir, fakeSafe);
  assert.deepEqual(read.homeRows(a), { order: [], hidden: ['continue'] });
  assert.equal(read.saveServer({ url: 'http://a', name: 'A', userId: '1', userName: 'A', token: 't2' }), a);
  assert.deepEqual(read.publicState().settings.home.hidden, ['continue']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Reihen je Profil: Unlesbares faellt einzeln weg', () => {
  const { c, dir } = loadRaw({
    version: 10,
    servers: [],
    homeRowsAdopted: true,
    homeRowsByProfile: { a: { order: ['favorites'], hidden: ['nextUp'] }, b: 'kaputt', c: { order: 5, hidden: ['continue'] }, __proto__: { order: ['x'] } },
    settings: { home: { heroSlides: 8 } }
  });
  assert.deepEqual(c.homeRows('a'), { order: ['favorites'], hidden: ['nextUp'] });
  assert.ok(!('b' in c.data.homeRowsByProfile));
  assert.deepEqual(c.homeRows('b'), { order: [], hidden: [] });
  assert.deepEqual(c.homeRows('c'), { order: [], hidden: ['continue'] });
  assert.deepEqual(c.homeRows('toString'), { order: [], hidden: [] }, 'kein Eintrag aus dem Prototyp');
  const odd = loadRaw({ version: 10, servers: [profile('a', 'A')], homeRowsByProfile: [1, 2], homeRowsAdopted: 'ja', settings: { home: { heroSlides: 8, ...deviceRows } } });
  assert.deepEqual(odd.c.homeRows('a'), deviceRows, '"ja" ist nicht uebernommen: die Uebernahme laeuft jetzt');
  assert.equal(odd.c.settings.home.heroSlides, 8);
  for (const d of [dir, odd.dir]) fs.rmSync(d, { recursive: true, force: true });
});

// Tolerantes Lesen (nach JellycloudTests/SettingsReadingTests.swift): ein unlesbarer Wert faellt auf seinen Standard, alle uebrigen bleiben
const custom = {
  language: 'en',
  appearance: { theme: 'graphite', accent: '#ff8800', posterSize: 200, blur: false, heroAutoplay: false, ambient: false, cardTitles: false },
  home: { hero: false, heroSlides: 9, rankingWindow: 'day' },
  player: { hwdec: 'no', subtitleMode: 'always', skipIntro: 'auto', skipRecap: 'auto', skipDelay: 8, videoFormat: 'fill', volume: 40, subtitleScale: 1.5, autoplayNext: false, maxBitrateMbps: 20 },
  trailer: { autoplay: false, quality: '1080', muted: false },
  general: { spoilerProtection: true, autoUpdate: false },
  discord: { enabled: true, poster: 'tmdb' }
};
const leaves = (o, pre = []) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, [...pre, k]) : [[...pre, k]]));
const at = (o, p) => p.reduce((x, k) => x?.[k], o);
function setAt(o, p, v) {
  const copy = structuredClone(o);
  p.slice(0, -1).reduce((x, k) => x[k], copy)[p[p.length - 1]] = v;
  return copy;
}

test('Tolerantes Lesen: ein Feld mit falschem Typ faellt auf seinen Standard, alle uebrigen bleiben (jedes Feld einzeln)', () => {
  const all = leaves(custom);
  const base = loadRaw({ servers: [], language: undefined, settings: custom });
  for (const p of all) assert.deepEqual(at(base.c.settings, p), at(custom, p), `unverfaelscht: ${p.join('.')}`);
  fs.rmSync(base.dir, { recursive: true, force: true });
  for (const p of all) {
    const { c, dir } = loadRaw({ servers: [], settings: setAt(custom, p, { kaputt: true }) });
    for (const q of all) {
      const want = q.join('.') === p.join('.') ? at(DEFAULT_SETTINGS, q) : at(custom, q);
      assert.deepEqual(at(c.settings, q), want, `${p.join('.')} kaputt: ${q.join('.')}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Tolerantes Lesen: mehrere unlesbare zugleich, unbekannte Auswahl, Bereiche aus falschem Typ', () => {
  const broken = setAt(setAt(setAt(custom, ['appearance', 'theme'], 'sepia'), ['home', 'heroSlides'], 'acht'), ['player', 'volume'], '40');
  const { c, dir } = loadRaw({ servers: [], settings: { ...broken, trailer: 'kaputt', glow: 7 } });
  assert.equal(c.settings.appearance.theme, 'midnight');
  assert.equal(c.settings.home.heroSlides, DEFAULT_SETTINGS.home.heroSlides);
  assert.equal(c.settings.player.volume, DEFAULT_SETTINGS.player.volume);
  assert.deepEqual(c.settings.trailer, DEFAULT_SETTINGS.trailer, 'ein ganzer Bereich unlesbar: sein Standard');
  assert.deepEqual(c.settings.glow, DEFAULT_SETTINGS.glow);
  assert.equal(c.settings.appearance.accent, '#ff8800', 'der Rest bleibt');
  assert.equal(c.settings.player.subtitleScale, 1.5);
  assert.equal(c.settings.home.hero, false);
  fs.rmSync(dir, { recursive: true, force: true });
  // Ein leerer Stand und Unsinn auf oberster Ebene: alles im Standard, kein Absturz
  for (const raw of [{}, { servers: 'kaputt', settings: [1, 2], seerr: 'x', activeServerId: 5 }]) {
    const r = loadRaw(raw);
    assert.deepEqual(r.c.settings, DEFAULT_SETTINGS);
    assert.deepEqual(r.c.data.servers, []);
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});