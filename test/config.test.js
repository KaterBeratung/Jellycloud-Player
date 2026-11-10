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

test('Migration auf Version 2: alter Standard-Radius 14 wird 18, bewusst gewaehlte Werte bleiben', () => {
  const write = (dir, version, radius) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version, deviceId: 'abc', servers: [], settings: { appearance: { radius, accent: '#112233' } } }));
  const a = tmp();
  write(a, 1, 14);
  const ca = new ConfigStore(a, fakeSafe);
  assert.equal(ca.settings.appearance.radius, 18, 'alter Standardwert wird angehoben');
  assert.equal(ca.settings.appearance.accent, '#112233', 'andere Einstellungen bleiben');
  ca.updateSettings({ appearance: { radius: 14 } });
  assert.equal(new ConfigStore(a, fakeSafe).settings.appearance.radius, 14, 'nach der Migration ist 14 eine bewusste Wahl');
  const b = tmp();
  write(b, 1, 22);
  assert.equal(new ConfigStore(b, fakeSafe).settings.appearance.radius, 22, 'eigener Wert bleibt');
  for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
});

test('Migration auf Version 3: alter Standard-Akzent (Koenigsblau) wird neutral, eigene Farben bleiben', () => {
  const write = (dir, version, accent) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version, deviceId: 'abc', servers: [], settings: { appearance: { accent, radius: 18 } } }));
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
  assert.equal(fresh.data.version, 9);
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
    assert.doesNotThrow(() => c.updateSettings({ appearance: { radius: 25 } }));
  } finally {
    fs.renameSync = real;
  }
  assert.equal(new ConfigStore(dir, fakeSafe).settings.appearance.radius, 25, 'die Einstellung ist angekommen');
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