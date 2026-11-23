'use strict';
// Bitratensteuerung (Plan P21, src/shared/bitrate.js). Die Faelle 1 bis 13, 19 bis 21 stammen aus BitrateRulesTests der Apple-App (Werte aus dem Auftrag
// des Nutzers, Grenze 15 Mbit/s, und aus Messungen an Jellyfin 12.4). Nicht uebernommen: die drei Faelle zum verlustfreien Ton (FLAC gibt es hier nicht:
// Windows dekodiert mit mpv selbst, Android erst nach dem Geraetetest Q7) und die zwei zu kleineren Aufloesungen beim Neukodieren (fittingLimits, hier
// nicht gebaut). Die Schnittstellennamen der Apple-Geraete (utun, pdp_ip ...) gibt es unter Windows und Android nicht; an ihrer Stelle steht die
// Verbindungsart (Mobilfunk).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/shared/bitrate');
const { JellyfinClient, withoutAccessToken } = require('../src/shared/jellyfin');
const { buildDeviceProfile } = require('../src/main/profile');

const MBIT = 1_000_000;

/** Die Obergrenze, wie Player und Detailseite sie bilden: Wahl (bei "Automatisch" aus der Messung), dann die Grenze des Servers. */
const ceiling = ({ quality, measured = null, serverLimit = null, sourceMbps = 80 }) =>
  B.bitrateCeiling({ chosenMbps: B.effectiveQuality(quality, measured).mbps, serverLimit, sourceBitrate: sourceMbps == null ? null : sourceMbps * MBIT });

// ---------- Extern: die Grenze des Servers hat Vorrang ----------

test('1 Extern, Grenze des Servers 15 Mbit/s (Tabelle des Nutzers)', () => {
  for (const [quality, measured, expected] of [
    [0, 100, 15], // Automatisch, Leitung 100 gemessen (75 abgeleitet)
    [0, null, 15], // Automatisch ohne Messung, Original 80
    [40, null, 15],
    [20, null, 15],
    [15, null, 15],
    [8, null, 8],
    [2, null, 2],
    [0, 10, 7] // Automatisch, Leitung 10 (75 %: 7): die langsamere Leitung gilt
  ]) {
    assert.equal(ceiling({ quality, measured, serverLimit: 15 * MBIT }), expected * MBIT, `Wahl ${quality}, gemessen ${measured}`);
  }
});

test('2 Extern: keine Wahl der App fuehrt ueber die Grenze des Servers', () => {
  for (const quality of [0, 1, 2, 4, 5, 8, 10, 20, 40, 120, 400, 2000]) {
    for (const limit of [1_500_000, 11_500_000, 15_000_000, 100_000_000]) {
      for (const measured of [null, 3, 50, 900]) {
        for (const sourceMbps of [null, 4, 80, 600]) assert.ok(ceiling({ quality, measured, serverLimit: limit, sourceMbps }) <= limit, `${quality}/${limit}/${measured}/${sourceMbps}`);
      }
    }
  }
});

test('3 Eine Grenze mit Nachkommastellen gilt genau (11,5 Mbit/s)', () => {
  assert.equal(ceiling({ quality: 20, serverLimit: 11_500_000 }), 11_500_000);
  assert.equal(ceiling({ quality: 0, serverLimit: 11_500_000 }), 11_500_000);
});

test('4 Der Server nennt 0 fuer "keine Grenze": dann gilt die Wahl der App', () => {
  assert.equal(ceiling({ quality: 40, serverLimit: 0 }), 40 * MBIT);
  assert.equal(ceiling({ quality: 40, serverLimit: null }), 40 * MBIT);
});

// ---------- Heimnetz: kein eigenes Maximum ----------

test('5 Heimnetz, Automatisch: die Obergrenze liegt nie unter der Datenrate der Datei', () => {
  for (const sourceMbps of [null, 1, 15, 63, 80, 144, 399, 400, 401, 500, 900]) {
    const v = ceiling({ quality: 0, sourceMbps });
    assert.ok(v >= (sourceMbps ?? 0) * MBIT, `${sourceMbps}`);
    assert.ok(v >= 400 * MBIT);
    assert.ok(v <= Math.floor(2147483647 / 2), 'der Server rechnet mit 32-Bit-Zahlen');
  }
});

test('6 Heimnetz: eine von Hand gewaehlte niedrigere Stufe gilt', () => {
  for (const quality of [2, 4, 8, 20, 40]) assert.equal(ceiling({ quality }), quality * MBIT);
});

test('7 Automatisch ausserhalb: 75 % der gemessenen Bandbreite, mindestens 1, hoechstens 120 Mbit/s', () => {
  assert.equal(B.effectiveQuality(0, 20).autoMbps, 15);
  assert.equal(B.effectiveQuality(0, 0.4).autoMbps, 1);
  assert.equal(B.effectiveQuality(0, null).autoMbps, null);
  assert.equal(B.effectiveQuality(0, 900).autoMbps, 120);
  assert.equal(B.effectiveQuality(8, 100).mbps, 8, 'eine feste Stufe bleibt, auch wenn gemessen wurde');
});

// ---------- Heimnetz oder extern ----------

test('8 Sagt der Server "nicht im Heimnetz", ist die Verbindung extern, gleich was die App sieht', () => {
  for (const addressLooksLocal of [true, false]) {
    for (const viaLocalInterface of [true, false, null]) {
      for (const homeAddressAnswers of [true, false]) assert.equal(B.isHome({ serverInNetwork: false, addressLooksLocal, viaLocalInterface, homeAddressAnswers }), false);
    }
  }
});

test('9 Private Adresse: Heimnetz, ausser ueber Mobilfunk; ohne Antwort des Servers bleibt es beim Heimnetz', () => {
  assert.equal(B.isHome({ serverInNetwork: true, addressLooksLocal: true, viaLocalInterface: true }), true);
  assert.equal(B.isHome({ serverInNetwork: true, addressLooksLocal: true, viaLocalInterface: false }), false);
  assert.equal(B.isHome({ serverInNetwork: null, addressLooksLocal: true, viaLocalInterface: null }), true);
  assert.equal(B.isHome({ serverInNetwork: null, addressLooksLocal: true, viaLocalInterface: false }), false);
});

test('10 (statt der Schnittstellennamen) Unbekannte Verbindungsart zaehlt wie das Netz vor Ort, Mobilfunk nie', () => {
  assert.equal(B.isHome({ serverInNetwork: true, addressLooksLocal: true, viaLocalInterface: null }), true, 'Windows kennt die Schnittstelle nicht');
  assert.equal(B.isHome({ serverInNetwork: true, addressLooksLocal: false, viaLocalInterface: false, homeAddressAnswers: true }), true, 'die Probe selbst laesst die Pruefung ueber Mobilfunk gar nicht zu (getStreamingLimits)');
});

test('11 Oeffentliche Adresse: die Einstufung des Servers allein reicht nicht (Reverse Proxy), es braucht die Heimadresse', () => {
  assert.equal(B.isHome({ serverInNetwork: true, addressLooksLocal: false, viaLocalInterface: true, homeAddressAnswers: false }), false);
  assert.equal(B.isHome({ serverInNetwork: true, addressLooksLocal: false, viaLocalInterface: true, homeAddressAnswers: true }), true);
  assert.equal(B.isHome({ serverInNetwork: null, addressLooksLocal: false, viaLocalInterface: null, homeAddressAnswers: false }), false);
});

// ---------- Grenze des Servers nicht lesbar ----------

test('12 Scheitert das Lesen der Grenze, gilt die zuletzt bekannte weiter; "keine Grenze" des Servers gilt auch gegen eine fruehere', () => {
  assert.equal(B.resolveLimit(15_000_000, null), 15_000_000);
  assert.equal(B.resolveLimit(undefined, 15_000_000), 15_000_000);
  assert.equal(B.resolveLimit(undefined, null), null);
  assert.equal(B.resolveLimit(null, 15_000_000), null);
});

test('13 Grenze lesen wie Jellyfin: die des Kontos, ohne sie die des Servers; nicht lesbar ist nicht "keine"', () => {
  const me = (n) => ({ Policy: { RemoteClientBitrateLimit: n } });
  assert.equal(B.readServerLimit({ me: me(8 * MBIT), config: { RemoteClientBitrateLimit: 15 * MBIT } }), 8 * MBIT, 'Konto 8, Server 15: 8');
  assert.equal(B.readServerLimit({ me: me(20 * MBIT), config: { RemoteClientBitrateLimit: 15 * MBIT } }), 20 * MBIT, 'Konto 20, Server 15: 20 (das Konto hat Vorrang, nicht das Kleinere)');
  assert.equal(B.readServerLimit({ me: me(0), config: { RemoteClientBitrateLimit: 15 * MBIT } }), 15 * MBIT);
  assert.equal(B.readServerLimit({ me: me(0), config: { RemoteClientBitrateLimit: 0 } }), null);
  assert.equal(B.readServerLimit({ me: me(6 * MBIT), config: null }), 6 * MBIT, 'Server-Einstellung nicht lesbar, Konto reicht');
  assert.equal(B.readServerLimit({ me: me(0), config: null }), undefined, 'ohne Konto-Grenze und ohne Server-Einstellung: nicht lesbar');
  assert.equal(B.readServerLimit({ me: null, config: { RemoteClientBitrateLimit: 15 * MBIT } }), undefined, 'Konto nicht lesbar');
  for (const bad of [-5, 'x', NaN, undefined]) assert.equal(B.readServerLimit({ me: me(bad), config: { RemoteClientBitrateLimit: bad } }), null, `Wert ${bad}`);
});

// ---------- Was die Anfrage nennt ----------

test('19 Das Geraeteprofil nennt die Obergrenze; Dateien, die unveraendert laufen, sind nie enger begrenzt', () => {
  const limited = buildDeviceProfile({ maxBitrate: 15 * MBIT, maxAudioChannels: 8 });
  assert.equal(limited.MaxStreamingBitrate, 15 * MBIT);
  assert.ok(limited.MaxStaticBitrate >= 15 * MBIT);
  const unlimited = B.unlimitedBitrate(600 * MBIT);
  const open = buildDeviceProfile({ maxBitrate: unlimited });
  assert.equal(open.MaxStreamingBitrate, unlimited);
  assert.ok(open.MaxStaticBitrate >= unlimited);
});

test('20 Kanaele beim Umwandeln (Android): 8 an einer 7.1-Ausgabe, sonst 6, nie weniger; Windows nach der Tonausgabe', () => {
  for (const [out, expected] of [[2, 6], [0, 6], [6, 6], [7, 6], [8, 8], [12, 8], ['x', 6]]) assert.equal(B.outputChannelLimit(out), expected, `Ausgabe ${out}`);
  assert.equal(buildDeviceProfile({ maxAudioChannels: 8 }).TranscodingProfiles[0].MaxAudioChannels, '8');
  assert.equal(buildDeviceProfile({ maxAudioChannels: 2 }).TranscodingProfiles[0].MaxAudioChannels, '2');
});

test('21 Die Antwort des Servers auf die Frage nach der Verbindung wird gelesen (IsLocal zaehlt nicht)', async () => {
  const stub = (body, status = 200) => async () => ({ ok: status === 200, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  const make = (fetch) => new JellyfinClient({ baseUrl: 'http://srv', deviceId: 'd', token: 't', fetch });
  assert.deepEqual(await make(stub({ IsLocal: true, IsInNetwork: false })).getEndpoint(), { inNetwork: false });
  assert.deepEqual(await make(stub({ IsInNetwork: true })).getEndpoint(), { inNetwork: true });
  assert.deepEqual(await make(stub({})).getEndpoint(), { inNetwork: null }, 'aelterer Server ohne das Feld: geantwortet, aber nicht eingestuft');
  assert.equal(await make(stub({ Message: 'x' }, 404)).getEndpoint(), null, 'keine Antwort');
});

// ---------- Weitere Regeln dieser Fassung ----------

test('Adresse dem Namen nach privat: IPv4-Bereiche, .local/.lan/.home.arpa/.internal, Rechnername, IPv6 nur als Adresse', () => {
  for (const u of ['http://10.0.0.5:8096', 'http://127.0.0.1', 'http://192.168.1.2', 'http://172.16.0.1', 'http://172.31.255.1', 'http://169.254.1.1', 'http://nas:8096', 'http://jellyfin.local', 'https://media.lan', 'http://x.home.arpa', 'http://srv.internal', 'http://localhost:8096', 'http://[fd00::1]:8096', 'http://[fe80::1]', 'http://[::1]'])
    assert.equal(B.addressLooksLocal(u), true, u);
  for (const u of ['https://jellyfin.example.com', 'http://172.32.0.1', 'http://172.15.0.1', 'http://8.8.8.8', 'http://100.64.0.1', 'http://fdserver.example.com', 'http://[2001:db8::1]', 'kein url', ''])
    assert.equal(B.addressLooksLocal(u), false, u);
});

test('Planung: Grenze des Servers nur extern; ohne Transcoding keine eigene Grenze; Messung nur bei Automatisch extern', () => {
  const home = { home: true, limitBps: 0 };
  const remote = { home: false, limitBps: 15 * MBIT };
  assert.equal(B.planBitrate({ quality: 0, network: home, sourceBitrate: 80 * MBIT }).ceiling, B.unlimitedBitrate(80 * MBIT));
  assert.equal(B.planBitrate({ quality: 0, network: { home: true, limitBps: 8 * MBIT } }).ceiling, 400 * MBIT, 'im Heimnetz zaehlt keine Grenze, auch wenn eine mitkaeme');
  assert.deepEqual(B.planBitrate({ quality: 0, network: remote, measured: 100 }), { ceiling: 15 * MBIT, chosenMbps: 75, autoMbps: 15, serverLimit: 15 * MBIT });
  assert.deepEqual(B.planBitrate({ quality: 0, network: remote }), { ceiling: 15 * MBIT, chosenMbps: 0, autoMbps: 15, serverLimit: 15 * MBIT }, 'ohne Messung: Automatisch ist die Grenze');
  assert.equal(B.planBitrate({ quality: 0, network: home, measured: 3 }).ceiling, 400 * MBIT, 'eine Messung zaehlt im Heimnetz nicht');
  assert.equal(B.planBitrate({ quality: 8, allowTranscode: false, network: { home: false, limitBps: 0 } }).ceiling, 400 * MBIT, 'Transcoding aus: die Wahl der App gilt nicht');
  assert.equal(B.planBitrate({ quality: 8, allowTranscode: false, network: remote }).ceiling, 15 * MBIT, '...die Grenze des Servers trotzdem');
  assert.equal(B.planBitrate({ quality: 0, network: null }).ceiling, 400 * MBIT, 'unbekannt: keine eigene Grenze (der Server setzt seine fuer Entfernte selbst durch)');
  assert.equal(B.needsMeasurement({ quality: 0, network: remote }), true);
  for (const o of [{ quality: 8, network: remote }, { quality: 0, network: home }, { quality: 0, network: null }, { quality: 0, allowTranscode: false, network: remote }]) assert.equal(B.needsMeasurement(o), false, JSON.stringify(o));
});

test('Qualitaetsmenue des Players: Automatisch und Stufen; die Grenze des Servers beendet die Liste; eine Einstellung ausserhalb kommt dazu', () => {
  const names = (o) => B.qualityChoices(o).map((c) => `${c.name}:${c.mbps}`);
  assert.deepEqual(names({}), ['auto:0', '4k:40', '1080high:20', '1080:8', '720:4', '480:2']);
  assert.deepEqual(names({ serverLimit: 15 * MBIT }), ['auto:0', 'server:15', '1080:8', '720:4', '480:2']);
  assert.deepEqual(names({ serverLimit: 20 * MBIT }), ['auto:0', '1080high:20', '1080:8', '720:4', '480:2'], 'die Grenze ist selbst eine Stufe');
  const frac = B.qualityChoices({ serverLimit: 11_500_000 });
  assert.deepEqual([frac[1].mbps, frac[1].detailMbps], [12, 11.5], 'aufgerundete Stufe, genaue Angabe');
  assert.deepEqual(names({ qualityMbps: 10 }), ['auto:0', 'setting:10', '4k:40', '1080high:20', '1080:8', '720:4', '480:2']);
  assert.equal(B.qualityChoices({ autoMbps: 37 })[0].detailMbps, 37);
});

test('Einstellung: Automatisch, 40, 20, 10, 5, 2; ein frueher gewaehlter Wert bleibt waehlbar', () => {
  assert.deepEqual(B.settingChoices(0), [0, 40, 20, 10, 5, 2]);
  assert.deepEqual(B.settingChoices(20), [0, 40, 20, 10, 5, 2]);
  assert.deepEqual(B.settingChoices(80), [0, 80, 40, 20, 10, 5, 2]);
  assert.deepEqual(B.settingChoices(8), [0, 40, 20, 10, 8, 5, 2]);
});

test('Tonspur (Android): Stereo-Spur an Lautsprecher und Kopfhoerer, Mehrkanal an einer Mehrkanal-Ausgabe oder mit "Mehrkanalton behalten"', () => {
  assert.equal(B.trackChannels({ outputChannels: 2 }), 2);
  assert.equal(B.trackChannels({ outputChannels: 6 }), 6);
  assert.equal(B.trackChannels({ outputChannels: 8 }), 8);
  assert.equal(B.trackChannels({ keepSurround: true, outputChannels: 2 }), 6);
  assert.equal(B.trackChannels({}), 2);
});

test('Token aus der Adresse: ApiKey und api_key in jeder Schreibweise, an jeder Stelle; sonst bleibt alles gleich', () => {
  assert.equal(withoutAccessToken('http://s/v/master.m3u8?A=1&ApiKey=t&B=x,y'), 'http://s/v/master.m3u8?A=1&B=x,y');
  assert.equal(withoutAccessToken('http://s/x.srt?api_key=t'), 'http://s/x.srt');
  assert.equal(withoutAccessToken('http://s/x?APIKEY=t&c=%2F#frag'), 'http://s/x?c=%2F#frag');
  assert.equal(withoutAccessToken('http://s/x?ApiKeyX=1'), 'http://s/x?ApiKeyX=1', 'nur genau dieser Name');
  assert.equal(withoutAccessToken('http://s/x'), 'http://s/x');
  assert.equal(withoutAccessToken(null), null);
});

// ---------- Messung und Zwischenspeicher ----------

test('Bandbreite: erst 1 MB, zwischen 6 und 60 Mbit/s ein zweiter Test mit 3 MB (1:2), 30 min gemerkt, gleichzeitige Fragen teilen eine Messung', async () => {
  let t = 0;
  const calls = [];
  const meter = B.createBandwidthMeter({ now: () => t, test: async (bytes) => (calls.push(bytes), bytes === 1_000_000 ? 30 : 60) });
  const [a, b] = await Promise.all([meter.measure(), meter.measure()]);
  assert.deepEqual([a, b], [30, 30]);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [1_000_000, 3_000_000], 'eine Messung, dann die genauere');
  assert.equal(await meter.measure(), 50, '(30 + 2 * 60) / 3');
  t += B.BANDWIDTH_TTL_MS + 1;
  await meter.measure();
  assert.equal(calls.length, 4, 'nach 30 min neu');
  const slow = B.createBandwidthMeter({ test: async () => 3 });
  assert.equal(await slow.measure(), 3);
  const none = B.createBandwidthMeter({ test: async () => null });
  assert.equal(await none.measure(), null, 'Server ohne Test');
});

test('Bandbreite beim Start (quick): hoechstens die kurze Frist warten, die Messung laeuft weiter und fuellt den Speicher', { timeout: 5000 }, async () => {
  let release;
  const meter = B.createBandwidthMeter({ quickMs: 40, test: () => new Promise((r) => (release = r)) });
  const t0 = Date.now();
  assert.equal(await meter.measure({ quick: true }), null);
  assert.ok(Date.now() - t0 < 1000);
  release(4);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(meter.value, 4);
  meter.reset();
  assert.equal(meter.value, null, 'neuer Server: nichts Gemerktes');
});

test('Merker je Netz: zehn Minuten, gleichzeitige Fragen teilen eine Pruefung, ein anderes Netz fragt neu', async () => {
  let t = 0;
  let n = 0;
  const memo = B.createNetworkMemo({ now: () => t });
  const run = async () => ++n;
  assert.deepEqual(await Promise.all([memo.get('a', run), memo.get('a', run)]), [1, 1]);
  assert.equal(await memo.get('a', run), 1);
  assert.equal(await memo.get('b', run), 2, 'Netzwechsel');
  t += B.HOME_TTL_MS + 1;
  assert.equal(await memo.get('b', run), 3, 'nach zehn Minuten');
  memo.reset();
  assert.equal(await memo.get('b', run), 4);
});

// ---------- Heimadresse und Pruefung am Client ----------

const answer = (body, status = 200) => ({ ok: status === 200, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => body, text: async () => JSON.stringify(body) });

test('Heimadresse: antwortet derselbe Server darunter, ist das Geraet zu Hause; die Frage dort geht ohne Token', async () => {
  const log = [];
  const servers = { 'jf.example.com': 'srv', '192.168.1.5:8096': 'srv', '192.168.1.6:8096': 'fremd' };
  let local = 'http://192.168.1.5:8096';
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    log.push({ host: u.host, auth: !!init.headers?.Authorization });
    if (u.host === '10.9.9.9') return new Promise(() => {}); // antwortet nie (von unterwegs)
    return u.pathname === '/System/Info/Public' ? answer({ Id: servers[u.host], LocalAddress: local }) : answer({}, 404);
  };
  const c = new JellyfinClient({ baseUrl: 'https://jf.example.com', deviceId: 'd', token: 'geheim', fetch });
  assert.equal(await c.homeAddressAnswers(), true);
  assert.deepEqual(log.at(-1), { host: '192.168.1.5:8096', auth: false }, 'ohne Token an die Heimadresse');
  local = 'http://192.168.1.6:8096';
  assert.equal(await c.homeAddressAnswers(), false, 'ein anderer Server');
  local = 'https://jf.example.com/';
  log.length = 0;
  assert.equal(await c.homeAddressAnswers(), false, 'dieselbe Adresse hilft nicht weiter');
  assert.equal(log.length, 1, '...und wird nicht noch einmal gefragt');
  local = 'http://10.9.9.9';
  const t0 = Date.now();
  assert.equal(await c.homeAddressAnswers(), false, 'keine Antwort');
  assert.ok(Date.now() - t0 < 4500, 'kurze Frist, auch wenn die Abruffunktion den Abbruch nicht kennt');
});

test('Pruefung am Client: private Adresse und Server "im Netz" ohne weitere Fragen; oeffentliche Adresse mit Probe; Mobilfunk ohne Probe', async () => {
  const log = [];
  const make = (baseUrl, { inNetwork = true, localAddress = null } = {}) =>
    new JellyfinClient({
      baseUrl,
      deviceId: 'd',
      token: 't',
      fetch: async (url) => {
        const u = new URL(url);
        log.push(u.pathname);
        if (u.pathname === '/System/Endpoint') return answer({ IsInNetwork: inNetwork });
        if (u.pathname === '/System/Info/Public') return answer({ Id: 'srv', LocalAddress: localAddress });
        if (u.pathname === '/Users/Me') return answer({ Policy: { RemoteClientBitrateLimit: 15 * MBIT } });
        if (u.pathname === '/System/Configuration') return answer({ RemoteClientBitrateLimit: 0 });
        return answer({}, 404);
      }
    });
  const home = await make('http://192.168.1.5:8096').getStreamingLimits();
  assert.deepEqual([home.home, home.limitBps, log], [true, 0, ['/System/Endpoint']]);
  log.length = 0;
  const proxy = await make('https://jf.example.com').getStreamingLimits();
  assert.deepEqual([proxy.home, proxy.limitBps], [false, 15 * MBIT], 'Reverse Proxy: der Server sagt "im Netz", die Heimadresse ist unbekannt');
  assert.ok(log.includes('/System/Info/Public') && log.includes('/Users/Me'));
  log.length = 0;
  const atHome = await make('https://jf.example.com', { localAddress: 'https://jf.example.com' }).getStreamingLimits();
  assert.equal(atHome.home, false, 'Heimadresse = eingetragene Adresse: kein Beleg');
  log.length = 0;
  const cellular = await make('http://192.168.1.5:8096').getStreamingLimits({ viaLocalInterface: false });
  assert.deepEqual([cellular.home, cellular.limitBps], [false, 15 * MBIT], 'private Adresse ueber Mobilfunk: nur ueber ein VPN erreichbar, also extern');
  log.length = 0;
  await make('https://jf.example.com').getStreamingLimits({ viaLocalInterface: false });
  assert.ok(!log.includes('/System/Info/Public'), 'ueber Mobilfunk keine Probe der Heimadresse');
  const remote = await make('http://192.168.1.5:8096', { inNetwork: false }).getStreamingLimits();
  assert.deepEqual([remote.home, remote.serverView, remote.limitBps], [false, false, 15 * MBIT], 'Server sagt "entfernt": extern, auch unter privater Adresse');
});

test('Frist einer Anfrage gilt auch, wenn die Abruffunktion das Abbruchsignal nicht kennt (native Anfrage der Android-Huelle)', async () => {
  const c = new JellyfinClient({ baseUrl: 'http://srv', deviceId: 'd', token: 't', fetch: () => new Promise(() => {}) });
  const t0 = Date.now();
  await assert.rejects(() => c.request('GET', '/System/Endpoint', { timeout: 60 }), (e) => e.code === 'TIMEOUT');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await c.getEndpoint(), null);
});
