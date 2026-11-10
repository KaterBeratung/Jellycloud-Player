'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DiscordError } = require('../src/main/discord-ipc');
const { normalizeSettings, clip, episodeCode, buildActivity, sameActivity, isPublicHttpsUrl, createPosterResolver, DiscordPresence } = require('../src/main/discord-presence');

const ID = '123456789012345678';
const NOW = 1_800_000_000_000;
const CFG = { enabled: true, clientId: ID, poster: 'auto', hideTitle: false, button: false };

const movie = { Id: 'a'.repeat(32), Type: 'Movie', Name: 'Paper Moons', ProductionYear: 2021, Genres: ['Drama', 'Romance', 'Krimi'], ProviderIds: { Tmdb: '4242', Imdb: 'tt1234567' }, ImageTags: { Primary: 'tag1' } };
const episode = { Id: 'b'.repeat(32), Type: 'Episode', Name: 'Der Anfang', SeriesName: 'Starfall Station', SeriesId: 'c'.repeat(32), SeriesPrimaryImageTag: 'stag', ParentIndexNumber: 1, IndexNumber: 2, ProviderIds: { Imdb: 'tt7654321' } };
const play = (item, extra = {}) => ({ item, position: 600, duration: 6000, paused: false, speed: 1, ...extra });

test('Einstellungen: ungueltige Werte werden zu Standardwerten, nichts ist von selbst eingeschaltet', () => {
  assert.deepEqual(normalizeSettings(undefined), { enabled: false, clientId: '', poster: 'auto', hideTitle: false, button: false, name: '' });
  assert.deepEqual(normalizeSettings({ enabled: 'ja', clientId: 123, poster: 'irgendwas', hideTitle: 1, button: 'x' }), { enabled: false, clientId: '', poster: 'auto', hideTitle: false, button: false, name: '' });
  assert.deepEqual(normalizeSettings({ enabled: true, clientId: `  ${ID} `, poster: 'tmdb', hideTitle: true, button: true }), { enabled: true, clientId: ID, poster: 'tmdb', hideTitle: true, button: true, name: '' });
});

test('Texte fuer Discord: Leerraum glatt, hoechstens 128 Zeichen, mindestens 2, Zeichen werden nicht mitten im Paar zerschnitten', () => {
  assert.equal(clip('  Paper \n  Moons  '), 'Paper Moons');
  assert.equal(clip(''), '');
  assert.equal(clip(null), '');
  assert.equal(clip('x'), 'x\u00a0', 'ein einzelnes Zeichen lehnt Discord ab');
  const long = clip('ä'.repeat(300));
  assert.equal(Array.from(long).length, 128);
  assert.ok(long.endsWith('…'));
  const emoji = clip('😀'.repeat(200));
  assert.equal(Array.from(emoji).length, 128);
  assert.ok(!/\ufffd/.test(emoji), 'kein zerschnittenes Zeichenpaar');
  assert.equal(Array.from(clip('Label zu lang '.repeat(5), 32)).length, 32);
});

test('Folgenkennung: S1E2, Doppelfolge, ohne Staffel, ohne Nummer', () => {
  assert.equal(episodeCode({ ParentIndexNumber: 1, IndexNumber: 2 }), 'S1E2');
  assert.equal(episodeCode({ ParentIndexNumber: 3, IndexNumber: 4, IndexNumberEnd: 5 }), 'S3E4-5');
  assert.equal(episodeCode({ IndexNumber: 7 }), 'E7');
  assert.equal(episodeCode({ ParentIndexNumber: 2 }), 'S2');
  assert.equal(episodeCode({}), '');
  assert.equal(episodeCode({ ParentIndexNumber: 0, IndexNumber: 1 }), 'S0E1', 'Staffel 0 (Extras) ist eine Staffel');
});

test('Anzeige bei einem Film: Titel, Jahr und zwei Genres, Beobachtungs-Typ, Fortschritt als Beginn und Ende', () => {
  const a = buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de-DE' });
  assert.equal(a.type, 3);
  assert.equal(a.status_display_type, 2);
  assert.equal(a.details, 'Paper Moons');
  assert.equal(a.state, '2021 · Drama, Romance');
  assert.equal(a.timestamps.start, NOW / 1000 - 600, 'der Film laeuft seit 600 s (Unix-Zeit in Sekunden)');
  assert.equal(a.timestamps.end, NOW / 1000 - 600 + 6000);
  assert.equal(a.assets.large_text, 'Paper Moons · 2021 · Drama, Romance');
  assert.equal(a.assets.large_image, undefined, 'ohne Poster kein Bild');
  assert.equal(a.buttons, undefined, 'Knopf nur auf Wunsch');
});

test('Anzeige bei einer Folge: Serie, Staffel und Folge mit Titel der Folge', () => {
  const a = buildActivity({ playing: play(episode), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(a.details, 'Starfall Station');
  assert.equal(a.state, 'S1E2 · Der Anfang');
  const noSeries = buildActivity({ playing: play({ ...episode, SeriesName: undefined }), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(noSeries.details, 'Der Anfang');
  assert.equal(noSeries.state, 'S1E2');
});

test('Pause: kein Fortschrittsbalken, der Zustand steht davor (deutsch und englisch)', () => {
  const de = buildActivity({ playing: play(movie, { paused: true }), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(de.timestamps, undefined);
  assert.equal(de.state, 'Pausiert · 2021 · Drama, Romance');
  const en = buildActivity({ playing: play(episode, { paused: true }), now: NOW, cfg: CFG, lang: 'en-US' });
  assert.equal(en.state, 'Paused · S1E2 · Der Anfang');
});

test('Tempo: bei doppelter Geschwindigkeit ist die Restzeit halb so lang und der Beginn rechnet mit der Geschwindigkeit', () => {
  const a = buildActivity({ playing: play(movie, { position: 600, duration: 6000, speed: 2 }), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(a.timestamps.start, NOW / 1000 - 300);
  assert.equal(a.timestamps.end - a.timestamps.start, 3000);
});

test('Ungewoehnliche Werte: ohne Laufzeit kein Balken, Position wird begrenzt, Tempo wird begrenzt', () => {
  assert.equal(buildActivity({ playing: play(movie, { duration: 0 }), now: NOW, cfg: CFG, lang: 'de' }).timestamps, undefined);
  assert.equal(buildActivity({ playing: play(movie, { duration: NaN }), now: NOW, cfg: CFG, lang: 'de' }).timestamps, undefined);
  const over = buildActivity({ playing: play(movie, { position: 99999, duration: 6000 }), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(over.timestamps.end, NOW / 1000, 'hinter dem Ende: der Balken ist voll, nicht in der Zukunft');
  const neg = buildActivity({ playing: play(movie, { position: -50 }), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(neg.timestamps.start, NOW / 1000);
  const fast = buildActivity({ playing: play(movie, { speed: 100 }), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(fast.timestamps.end - fast.timestamps.start, 1500, 'Tempo hoechstens 4');
  const whole = buildActivity({ playing: play(movie), now: NOW + 400, cfg: CFG, lang: 'de' });
  assert.ok(Number.isInteger(whole.timestamps.start) && Number.isInteger(whole.timestamps.end), 'ganze Sekunden');
});

test('Titel verbergen: nur "Schaut einen Film", kein Titel, kein Poster, kein Knopf, im Status der Name der Anwendung', () => {
  const cfg = { ...CFG, hideTitle: true, button: true };
  const m = buildActivity({ playing: play(movie), now: NOW, cfg, lang: 'de', posterUrl: 'https://image.tmdb.org/t/p/w500/abc12345.jpg' });
  assert.equal(m.details, 'Schaut einen Film');
  assert.equal(m.state, undefined);
  assert.equal(m.assets, undefined);
  assert.equal(m.buttons, undefined);
  assert.equal(m.status_display_type, 0);
  assert.ok(m.timestamps, 'der Fortschritt bleibt');
  assert.equal(buildActivity({ playing: play(episode), now: NOW, cfg, lang: 'en' }).details, 'Watching a show');
  assert.equal(buildActivity({ playing: play({ ...movie, Type: 'Video' }), now: NOW, cfg, lang: 'en' }).details, 'Watching a video');
  assert.ok(!JSON.stringify(m).includes('Paper Moons'), 'der Titel steht nirgends');
});

test('Poster: nur https-Adressen, sonst gar kein Bild', () => {
  const ok = buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de', posterUrl: 'https://image.tmdb.org/t/p/w500/abc12345.jpg' });
  assert.equal(ok.assets.large_image, 'https://image.tmdb.org/t/p/w500/abc12345.jpg');
  for (const bad of ['http://x.example/p.jpg', 'file:///C:/p.jpg', 'javascript:alert(1)', '', null, 42, `https://x.example/${'a'.repeat(600)}`]) {
    assert.equal(buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de', posterUrl: bad }).assets.large_image, undefined, String(bad).slice(0, 30));
  }
});

test('Knopf (auf Wunsch): IMDb zuerst, bei Filmen sonst TMDB, bei Folgen ohne IMDb keiner; nur oeffentliche Seiten', () => {
  const cfg = { ...CFG, button: true };
  assert.deepEqual(buildActivity({ playing: play(movie), now: NOW, cfg, lang: 'de' }).buttons, [{ label: 'Auf IMDb ansehen', url: 'https://www.imdb.com/title/tt1234567/' }]);
  assert.equal(buildActivity({ playing: play(movie), now: NOW, cfg, lang: 'de' }).details_url, 'https://www.imdb.com/title/tt1234567/', 'der Titel ist zusaetzlich ein Link (den eigenen Knopf zeigt Discord einem selbst nicht)');
  assert.equal(buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de' }).details_url, undefined, 'ohne den Schalter kein Link');
  assert.equal(buildActivity({ playing: play({ ...movie, ProviderIds: {} }), now: NOW, cfg, lang: 'de' }).details_url, undefined, 'ohne Kennung kein Link');
  assert.deepEqual(buildActivity({ playing: play({ ...movie, ProviderIds: { tmdb: '4242' } }), now: NOW, cfg, lang: 'en' }).buttons, [{ label: 'View on TMDB', url: 'https://www.themoviedb.org/movie/4242' }]);
  assert.equal(buildActivity({ playing: play({ ...episode, ProviderIds: { Tmdb: '99' } }), now: NOW, cfg, lang: 'de' }).buttons, undefined, 'die TMDB-Nummer einer Folge ist keine Filmnummer');
  assert.equal(buildActivity({ playing: play({ ...movie, ProviderIds: { Imdb: 'tt1"><script>' } }), now: NOW, cfg, lang: 'de' }).buttons, undefined, 'unsinnige Kennung wird nicht verlinkt');
  assert.equal(buildActivity({ playing: play({ ...movie, ProviderIds: {} }), now: NOW, cfg, lang: 'de' }).buttons, undefined);
});

test('Gleiche Anzeige: kleine Abweichung des Fortschritts zaehlt nicht, jede andere Aenderung schon', () => {
  const a = buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de' });
  assert.equal(sameActivity(a, buildActivity({ playing: play(movie, { position: 601.5 }), now: NOW, cfg: CFG, lang: 'de' })), true, '1,5 s Abweichung');
  assert.equal(sameActivity(a, buildActivity({ playing: play(movie, { position: 640 }), now: NOW, cfg: CFG, lang: 'de' })), false, 'Sprung');
  assert.equal(sameActivity(a, buildActivity({ playing: play(movie, { paused: true }), now: NOW, cfg: CFG, lang: 'de' })), false, 'Pause');
  assert.equal(sameActivity(a, buildActivity({ playing: play(episode), now: NOW, cfg: CFG, lang: 'de' })), false, 'anderer Titel');
  assert.equal(sameActivity(a, buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de', posterUrl: 'https://x.example/p.jpg' })), false, 'Poster dazugekommen');
  assert.equal(sameActivity(null, a), false);
});

test('Oeffentliche Adresse: nur https mit oeffentlichem Namen, nichts aus dem Heimnetz', () => {
  const yes = ['https://jellyfin.example.com', 'https://media.example.org:8920/jf', 'https://8.8.8.8', 'https://sub.domain.example.co.uk/'];
  const no = ['http://jellyfin.example.com', 'https://localhost', 'https://localhost:8096', 'https://192.168.1.5', 'https://10.0.0.2', 'https://172.16.0.1', 'https://172.31.255.1', 'https://127.0.0.1', 'https://169.254.1.1', 'https://100.100.1.1',
    'https://jellyfin', 'https://nas.local', 'https://server.lan', 'https://server.home.arpa', 'https://nas.intern.internal', 'https://box.tail1234.ts.net', 'https://[::1]', 'nicht-einmal-eine-adresse', '', 'ftp://x.example.com'];
  for (const u of yes) assert.equal(isPublicHttpsUrl(u), true, u);
  for (const u of no) assert.equal(isPublicHttpsUrl(u), false, u);
  assert.equal(isPublicHttpsUrl('https://172.15.0.1'), true, '172.15 liegt ausserhalb des privaten Bereichs');
  assert.equal(isPublicHttpsUrl('https://172.32.0.1'), true);
});

// ---------- Poster-Quelle ----------

const tmdbImageUrl = (size, file) => `https://image.tmdb.org/t/p/${size}/${file}`;
function resolverWith({ seerr = null, client = null } = {}) {
  return createPosterResolver({ getClient: () => client, getSeerr: () => seerr, tmdbImageUrl });
}
const fakeSeerr = (posters = {}) => ({
  calls: [],
  async details(type, id) {
    this.calls.push(`${type}:${id}`);
    if (posters[`${type}:${id}`] === 'error') throw new Error('Seerr kaputt');
    return { posterPath: posters[`${type}:${id}`] ?? null };
  }
});
const publicClient = (extra = {}) => ({ baseUrl: 'https://jf.example.com/', getItem: async () => ({ ProviderIds: { Tmdb: '1399' } }), ...extra });

test('Poster von TMDB: Film ueber die TMDB-Nummer, Folge ueber die Serie, Bildgroesse w500', async () => {
  const seerr = fakeSeerr({ 'movie:4242': '/mockposter0001.jpg', 'tv:1399': '/serieposter01.jpg' });
  const resolve = resolverWith({ seerr, client: publicClient() });
  assert.equal(await resolve(movie, 'tmdb'), 'https://image.tmdb.org/t/p/w500/mockposter0001.jpg');
  assert.equal(await resolve(episode, 'tmdb'), 'https://image.tmdb.org/t/p/w500/serieposter01.jpg');
  assert.equal(await resolve({ Type: 'Series', ProviderIds: { Tmdb: '1399' } }, 'tmdb'), 'https://image.tmdb.org/t/p/w500/serieposter01.jpg');
  assert.deepEqual(seerr.calls, ['movie:4242', 'tv:1399', 'tv:1399']);
});

test('Poster von TMDB: ohne Seerr, ohne TMDB-Nummer oder bei Fehlern kein Poster (Modus "tmdb")', async () => {
  assert.equal(await resolverWith({ seerr: null, client: publicClient() })(movie, 'tmdb'), null, 'ohne Seerr');
  const seerr = fakeSeerr({ 'movie:4242': 'error' });
  assert.equal(await resolverWith({ seerr })({ ...movie, ProviderIds: {} }, 'tmdb'), null, 'ohne Nummer');
  assert.equal(await resolverWith({ seerr })(movie, 'tmdb'), null, 'Seerr wirft');
  assert.equal(await resolverWith({ seerr: fakeSeerr({ 'movie:4242': 'kein/pfad' }) })(movie, 'tmdb'), 'https://image.tmdb.org/t/p/w500/kein/pfad', 'der Pfad wird hier nicht neu geprueft (Seerr-Antwort ist schon bereinigt)');
});

test('Poster vom Server: nur bei oeffentlichem https, ohne Zugangsdaten in der Adresse; Folgen zeigen das Poster der Serie', async () => {
  const client = publicClient();
  const resolve = resolverWith({ client });
  assert.equal(await resolve(movie, 'server'), `https://jf.example.com/Items/${movie.Id}/Images/Primary?maxWidth=500&quality=90&tag=tag1`);
  assert.equal(await resolve(episode, 'server'), `https://jf.example.com/Items/${episode.SeriesId}/Images/Primary?maxWidth=500&quality=90&tag=stag`);
  assert.ok(!/api_key|token|ApiKey/i.test(await resolve(movie, 'server')));
  assert.equal(await resolve({ ...movie, ImageTags: {} }, 'server'), null, 'ohne Bild kein Poster');
  assert.equal(await resolve({ ...movie, Id: 'x/../y' }, 'server'), null, 'ungueltige Id');
  assert.equal(await resolverWith({ client: { baseUrl: 'http://192.168.1.5:8096' } })(movie, 'server'), null, 'Heimnetz: Discord kommt nicht heran');
  assert.equal(await resolverWith({ client: { baseUrl: 'http://jf.example.com' } })(movie, 'server'), null, 'ohne https');
});

test('Poster "auto": erst TMDB, bei Misserfolg der Server, sonst nichts; "off" fragt nie', async () => {
  const seerr = fakeSeerr({ 'movie:4242': '/mockposter0001.jpg' });
  const client = publicClient();
  assert.match(await resolverWith({ seerr, client })(movie, 'auto'), /image\.tmdb\.org/);
  assert.match(await resolverWith({ seerr: fakeSeerr({}), client })(movie, 'auto'), /jf\.example\.com\/Items/, 'TMDB ohne Poster: Server');
  assert.match(await resolverWith({ seerr: fakeSeerr({ 'movie:4242': 'error' }), client })(movie, 'auto'), /jf\.example\.com/, 'Seerr-Fehler: Server');
  assert.equal(await resolverWith({ seerr: fakeSeerr({}), client: { baseUrl: 'http://nas.local' } })(movie, 'auto'), null);
  const spy = fakeSeerr({ 'movie:4242': '/mockposter0001.jpg' });
  assert.equal(await resolverWith({ seerr: spy, client })(movie, 'off'), null);
  assert.deepEqual(spy.calls, []);
});

// ---------- Verwaltung der Verbindung ----------

function fakeIpcFactory() {
  const create = (opts) => {
    const ipc = new EventEmitter();
    Object.assign(ipc, {
      opts,
      activities: [],
      clears: 0,
      closed: false,
      connected: false,
      user: { username: 'tester', globalName: 'Test Nutzer' },
      async open() {
        if (create.failOpen) throw create.failOpen;
        ipc.connected = true;
        return ipc.user;
      },
      async setActivity(a) {
        if (create.failSet) throw create.failSet;
        if (a && create.rejectIf?.(a)) throw new DiscordError('Invalid activity', { kind: 'rejected', code: 4000 });
        if (!ipc.connected) throw new DiscordError('zu', { kind: 'closed' });
        if (a) ipc.activities.push(a);
        else ipc.clears++;
        return a;
      },
      clearActivity() {
        return ipc.setActivity(null);
      },
      close() {
        ipc.connected = false;
        ipc.closed = true;
      }
    });
    create.made.push(ipc);
    return ipc;
  };
  create.made = [];
  create.failOpen = null;
  create.failSet = null;
  return create;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(10);
  }
  return fn();
}

/** Manager mit kurzen Zeiten; settings und playing lassen sich im Test aendern. */
function setup(over = {}) {
  const ctx = { settings: { ...CFG }, playing: play(movie), clock: NOW, ipcs: fakeIpcFactory(), posterCalls: [], posterUrl: 'https://image.tmdb.org/t/p/w500/mockposter0001.jpg', posterDelay: 0, statuses: [] };
  const p = new DiscordPresence({
    getSettings: () => ctx.settings,
    getPlaying: () => ctx.playing,
    getLanguage: () => 'de',
    now: () => ctx.clock,
    createIpc: ctx.ipcs,
    resolvePoster: async (item, mode) => {
      ctx.posterCalls.push(`${mode}:${item.Id}`);
      if (ctx.posterDelay) await wait(ctx.posterDelay);
      return ctx.posterUrl;
    },
    minIntervalMs: 60,
    graceMs: 80,
    retryMs: 100,
    debounceMs: 10,
    posterWaitMs: 50,
    testMs: 120,
    defaultClientId: '',
    ...over
  });
  p.on('status', (s) => ctx.statuses.push(s.state));
  ctx.p = p;
  ctx.ipc = () => ctx.ipcs.made.at(-1);
  return ctx;
}

test('Ausgeschaltet oder ohne gueltige Application-ID: keine Verbindung, der Grund steht im Status', async () => {
  const a = setup();
  a.settings.enabled = false;
  a.p.refresh();
  await wait(80);
  assert.equal(a.ipcs.made.length, 0);
  assert.equal(a.p.status().state, 'off');
  const b = setup();
  b.settings.clientId = '12345';
  b.p.refresh();
  await until(() => b.p.status().state === 'invalid-id');
  assert.equal(b.ipcs.made.length, 0);
  await a.p.shutdown();
  await b.p.shutdown();
});

test('Wiedergabe beginnt: Verbindung, Anzeige mit Titel und Poster, Status "showing" mit dem Discord-Konto', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const act = a.ipc().activities[0];
  assert.equal(act.details, 'Paper Moons');
  assert.equal(act.assets.large_image, a.posterUrl);
  assert.equal(a.ipc().opts.clientId, ID);
  assert.deepEqual(a.p.status(), { state: 'showing', error: '', user: 'Test Nutzer', builtIn: false });
  await a.p.shutdown();
});

test('Das Poster kommt zu spaet: erst Anzeige ohne Bild, dann mit Bild nachgereicht; je Titel nur eine Anfrage', async () => {
  const a = setup();
  a.posterDelay = 200;
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  assert.equal(a.ipc().activities[0].assets.large_image, undefined, 'nach 50 ms nicht weiter gewartet');
  assert.ok(await until(() => a.ipc().activities.length === 2, 3000));
  assert.equal(a.ipc().activities[1].assets.large_image, a.posterUrl);
  a.p.refresh();
  await wait(150);
  assert.equal(a.ipc().activities.length, 2, 'nichts doppelt');
  assert.equal(a.posterCalls.length, 1);
  await a.p.shutdown();
});

test('Poster "aus" oder Titel verborgen: das Poster wird gar nicht erst angefragt', async () => {
  const a = setup();
  a.settings.poster = 'off';
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const b = setup();
  b.settings.hideTitle = true;
  b.p.refresh();
  assert.ok(await until(() => b.ipc()?.activities.length === 1));
  assert.equal(a.posterCalls.length + b.posterCalls.length, 0);
  assert.equal(b.ipc().activities[0].details, 'Schaut einen Film');
  await a.p.shutdown();
  await b.p.shutdown();
});

test('Pause und Weiterspielen: neue Anzeige ohne bzw. mit Balken, nie dichter als das Mindestintervall', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  a.playing = { ...a.playing, paused: true };
  const t0 = Date.now();
  a.p.refresh();
  assert.ok(await until(() => a.ipc().activities.length === 2));
  assert.equal(a.ipc().activities[1].timestamps, undefined);
  assert.match(a.ipc().activities[1].state, /^Pausiert/);
  a.playing = { ...a.playing, paused: false };
  a.p.refresh();
  assert.ok(await until(() => a.ipc().activities.length === 3));
  assert.ok(a.ipc().activities[2].timestamps);
  assert.ok(Date.now() - t0 >= 100, 'zwei Wechsel hintereinander brauchen mindestens zwei Intervalle (2 x 60 ms), nicht sofort');
  await a.p.shutdown();
});

test('Normales Weiterlaufen sendet nichts, ein Sprung sendet den neuen Stand', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  // 2 Sekunden spaeter: Uhr und Position laufen gleich weiter
  a.clock += 2000;
  a.playing = { ...a.playing, position: a.playing.position + 2 };
  a.p.refresh();
  await wait(150);
  assert.equal(a.ipc().activities.length, 1);
  // Sprung um 20 Minuten
  a.playing = { ...a.playing, position: a.playing.position + 1200 };
  a.p.refresh();
  assert.ok(await until(() => a.ipc().activities.length === 2));
  assert.equal(a.ipc().activities[1].timestamps.start, (NOW + 2000) / 1000 - 1802);
  await a.p.shutdown();
});

test('Ende der Wiedergabe: die Anzeige bleibt kurz (Schonfrist), dann wird sie entfernt', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  a.playing = null;
  a.p.refresh();
  await wait(40);
  assert.equal(a.ipc().clears, 0, 'noch in der Schonfrist');
  assert.ok(await until(() => a.ipc().clears === 1));
  assert.equal(a.p.status().state, 'idle');
  await a.p.shutdown();
});

test('Folgenwechsel innerhalb der Schonfrist: nicht entfernen, gleich die neue Folge zeigen', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  a.playing = null; // naechste Folge laedt
  a.p.refresh();
  await wait(30);
  a.playing = play(episode, { position: 0 });
  a.p.refresh();
  assert.ok(await until(() => a.ipc().activities.length === 2));
  await wait(200);
  assert.equal(a.ipc().clears, 0, 'zwischendurch wurde nichts entfernt');
  assert.equal(a.ipc().activities[1].details, 'Starfall Station');
  await a.p.shutdown();
});

test('Discord laeuft nicht: Status "no-discord", spaeter erneut versucht und angezeigt, sobald es da ist', async () => {
  const a = setup();
  a.ipcs.failOpen = new DiscordError('Discord ist nicht erreichbar', { kind: 'no-discord' });
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'no-discord'));
  assert.match(a.p.status().error, /nicht erreichbar/);
  a.ipcs.failOpen = null; // Discord wurde gestartet
  assert.ok(await until(() => a.p.status().state === 'showing', 3000), 'der naechste Versuch (nach retryMs) klappt');
  assert.equal(a.ipc().activities.length, 1);
  await a.p.shutdown();
});

test('Unbekannte Application-ID: Status "bad-id" und kein endloses Wiederholen', async () => {
  const a = setup();
  a.ipcs.failOpen = new DiscordError('Invalid Client ID', { kind: 'bad-id', code: 4000 });
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'bad-id'));
  const n = a.ipcs.made.length;
  await wait(350);
  assert.equal(a.ipcs.made.length, n, 'kein erneuter Versuch von selbst');
  await a.p.shutdown();
});

test('Discord wird waehrend der Wiedergabe beendet und neu gestartet: Verbindung wird neu aufgebaut, die Anzeige kommt wieder', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const first = a.ipc();
  first.connected = false;
  first.emit('close', new DiscordError('weg', { kind: 'closed' }));
  assert.ok(await until(() => a.ipcs.made.length === 2 && a.ipc().activities.length === 1));
  assert.notEqual(a.ipc(), first);
  await a.p.shutdown();
});

test('Ausschalten waehrend der Wiedergabe: Anzeige entfernt, Verbindung geschlossen, Status "off"', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const ipc = a.ipc();
  a.settings.enabled = false;
  a.p.refresh();
  assert.ok(await until(() => ipc.closed));
  assert.equal(ipc.clears, 1);
  assert.equal(a.p.status().state, 'off');
  await a.p.shutdown();
});

test('Andere Application-ID waehrend der Wiedergabe: alte Verbindung zu, neue mit der neuen ID', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const old = a.ipc();
  a.settings.clientId = '876543210987654321';
  a.p.refresh();
  assert.ok(await until(() => a.ipcs.made.length === 2 && a.ipc().activities.length === 1));
  assert.equal(old.closed, true);
  assert.equal(a.ipc().opts.clientId, '876543210987654321');
  await a.p.shutdown();
});

test('Discord lehnt die Anzeige ab: Status "error" mit der Meldung, die App laeuft weiter', async () => {
  const a = setup();
  a.ipcs.failSet = new DiscordError('Invalid activity', { kind: 'rejected', code: 4000 });
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'error'));
  assert.match(a.p.status().error, /Invalid activity/);
  await a.p.shutdown();
});

test('Verbindungstest: ungueltige ID, laufende Wiedergabe, Erfolg (Testanzeige, danach weg) und Fehler', async () => {
  const a = setup();
  a.playing = null;
  assert.deepEqual(await a.p.test('abc'), { ok: false, kind: 'invalid-id' });
  a.playing = play(movie);
  assert.deepEqual(await a.p.test(ID), { ok: false, kind: 'busy' });
  a.playing = null;
  const r = await a.p.test(` ${ID} `);
  assert.deepEqual(r, { ok: true, user: 'Test Nutzer' });
  const ipc = a.ipc();
  assert.equal(ipc.activities.length, 1);
  assert.equal(ipc.activities[0].details, 'Jellycloud Player');
  assert.match(ipc.activities[0].state, /Alles in Ordnung/);
  assert.equal(ipc.closed, false, 'die Anzeige steht noch');
  assert.ok(await until(() => ipc.closed), 'nach der Testzeit wird getrennt, damit verschwindet die Anzeige');
  a.ipcs.failOpen = new DiscordError('Invalid Client ID', { kind: 'bad-id', code: 4000 });
  const bad = await a.p.test(ID);
  assert.equal(bad.ok, false);
  assert.equal(bad.kind, 'bad-id');
  await a.p.shutdown();
});

test('Beenden der App: Anzeige entfernen und Verbindung schliessen; danach reagiert nichts mehr', async () => {
  const a = setup();
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const ipc = a.ipc();
  await a.p.shutdown();
  assert.equal(ipc.clears, 1);
  assert.equal(ipc.closed, true);
  a.p.refresh();
  await wait(60);
  assert.equal(a.ipcs.made.length, 1, 'keine neue Verbindung nach dem Beenden');
});


test('Abgelehnte ID bleibt abgelehnt, bis sie geaendert wird (ein erneutes Einschalten oder ein bestandener Test zaehlt als neuer Versuch)', async () => {
  const a = setup();
  a.ipcs.failOpen = new DiscordError('Invalid Client ID', { kind: 'bad-id', code: 4000 });
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'bad-id'));
  const n = a.ipcs.made.length;
  a.p.refresh();
  a.p.refresh();
  await wait(120);
  assert.equal(a.ipcs.made.length, n, 'weitere Aenderungen der Wiedergabe fragen Discord nicht erneut mit derselben ID');
  // Die Anwendung wurde inzwischen angelegt: ein Test mit derselben ID klappt und gibt sie wieder frei
  a.ipcs.failOpen = null;
  a.playing = null;
  const r = await a.p.test(ID);
  assert.equal(r.ok, true);
  a.playing = play(movie);
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'showing'), 'danach laeuft die Anzeige wieder');
  // Eine andere ID: sofort neuer Versuch
  const b = setup();
  b.ipcs.failOpen = new DiscordError('Invalid Client ID', { kind: 'bad-id', code: 4000 });
  b.p.refresh();
  assert.ok(await until(() => b.p.status().state === 'bad-id'));
  b.ipcs.failOpen = null;
  b.settings.clientId = '876543210987654321';
  b.p.refresh();
  assert.ok(await until(() => b.p.status().state === 'showing'));
  await a.p.shutdown();
  await b.p.shutdown();
});

test('Aeltere Discord-Version lehnt neue Felder ab: schlichtere Fassung wird versucht und fuer die Zukunft gemerkt', async () => {
  const a = setup();
  a.ipcs.rejectIf = (act) => 'status_display_type' in act; // kennt das Feld nicht
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const sent = a.ipc().activities[0];
  assert.equal('status_display_type' in sent, false, 'angenommen wurde die Fassung ohne das Feld');
  assert.equal(sent.type, 3, 'sonst unveraendert: "Schaut"');
  assert.equal(sent.details, 'Paper Moons');
  assert.equal(a.p.status().state, 'showing');
  // naechste Aenderung: gleich die gemerkte Fassung, kein Umweg ueber die volle
  const rejectedBefore = a.ipcs.made[0].activities.length;
  a.playing = { ...a.playing, paused: true };
  a.p.refresh();
  assert.ok(await until(() => a.ipc().activities.length === rejectedBefore + 1));
  assert.equal('status_display_type' in a.ipc().activities.at(-1), false);
  await a.p.shutdown();
});

test('Discord lehnt jede Fassung ab: Status "error" mit der Meldung, drei Versuche, kein Absturz', async () => {
  const a = setup();
  let tries = 0;
  a.ipcs.rejectIf = () => {
    tries++;
    return true;
  };
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'error'));
  assert.equal(tries, 3, 'voll, ohne Status-Art, schlicht');
  assert.match(a.p.status().error, /Invalid activity/);
  await a.p.shutdown();
});

test('Name der Aktivitaet: eigener Name steht als "name" in der Anzeige, leer = Name der Anwendung; Leerraum und Laenge werden bereinigt', () => {
  assert.equal(normalizeSettings({ name: '  Mein   Kino \n' }).name, 'Mein Kino');
  assert.equal(normalizeSettings({ name: 'x'.repeat(300) }).name.length, 128);
  assert.equal(normalizeSettings({ name: 42 }).name, '');
  assert.equal(normalizeSettings({ name: '   ' }).name, '');
  const named = buildActivity({ playing: play(movie), now: NOW, cfg: { ...CFG, name: 'Mein Kino' }, lang: 'de' });
  assert.equal(named.name, 'Mein Kino');
  assert.equal(named.details, 'Paper Moons', 'der Titel bleibt davon unberuehrt');
  assert.equal('name' in buildActivity({ playing: play(movie), now: NOW, cfg: CFG, lang: 'de' }), false, 'ohne Eintrag kein "name": Discord nimmt den Namen der Anwendung');
  assert.equal(buildActivity({ playing: play(movie), now: NOW, cfg: { ...CFG, name: 'Mein Kino', hideTitle: true }, lang: 'de' }).name, 'Mein Kino', 'auch bei verborgenem Titel');
  assert.equal(buildActivity({ playing: play(movie), now: NOW, cfg: { ...CFG, name: 'K' }, lang: 'de' }).name, 'K\u00a0', 'ein einzelnes Zeichen lehnt Discord ab');
  assert.ok(sameActivity(named, buildActivity({ playing: play(movie), now: NOW, cfg: { ...CFG, name: 'Mein Kino' }, lang: 'de' })));
  assert.equal(sameActivity(named, buildActivity({ playing: play(movie), now: NOW, cfg: { ...CFG, name: 'Anderer' }, lang: 'de' })), false, 'anderer Name: neu senden');
});

test('Eingebaute Anwendung: ohne eigene ID gilt die eingebaute, eine eigene geht vor, eine halb getippte ist ein Fehler (kein stiller Rueckfall)', async () => {
  const BUILT = '111111111111111111';
  const a = setup({ defaultClientId: BUILT });
  a.settings.clientId = '';
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  assert.equal(a.ipc().opts.clientId, BUILT);
  assert.equal(a.p.status().builtIn, true);
  a.settings.clientId = '222222222222222222'; // eine eigene Anwendung
  a.p.refresh();
  assert.ok(await until(() => a.ipcs.made.length === 2 && a.ipc().activities.length === 1));
  assert.equal(a.ipc().opts.clientId, '222222222222222222');
  assert.equal(a.ipcs.made[0].closed, true, 'die eingebaute Verbindung ist zu');
  a.settings.clientId = '2222'; // halb getippt
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'invalid-id'));
  assert.equal(a.ipcs.made.length, 2, 'keine Verbindung mit der eingebauten ID hinter dem Ruecken');
  await a.p.shutdown();
});

test('Ohne eingebaute Anwendung und ohne eigene ID: Status "no-id", keine Verbindung; builtIn ist falsch', async () => {
  const a = setup({ defaultClientId: '' });
  a.settings.clientId = '';
  a.p.refresh();
  assert.ok(await until(() => a.p.status().state === 'no-id'));
  assert.equal(a.ipcs.made.length, 0);
  assert.equal(a.p.status().builtIn, false);
  await a.p.shutdown();
});

test('Verbindungstest mit leerem Feld: nimmt die eingebaute Anwendung und zeigt den eingestellten Namen; ohne beides "no-id"', async () => {
  const BUILT = '111111111111111111';
  const a = setup({ defaultClientId: BUILT });
  a.playing = null;
  a.settings.name = 'Mein Kino';
  const r = await a.p.test('');
  assert.equal(r.ok, true);
  assert.equal(a.ipc().opts.clientId, BUILT);
  assert.equal(a.ipc().activities[0].name, 'Mein Kino');
  const b = setup({ defaultClientId: '' });
  b.playing = null;
  assert.deepEqual(await b.p.test(''), { ok: false, kind: 'no-id' });
  await a.p.shutdown();
  await b.p.shutdown();
});

test('Aelteres Discord kennt den Titel-Link nicht: die Fassung ohne die neueren Felder (auch ohne details_url) wird genommen, der Knopf bleibt', async () => {
  const a = setup();
  a.settings.button = true;
  a.ipcs.rejectIf = (act) => 'details_url' in act;
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const sent = a.ipc().activities[0];
  assert.equal('details_url' in sent, false);
  assert.equal(sent.buttons?.[0]?.label, 'Auf IMDb ansehen');
  await a.p.shutdown();
});

test('Aelteres Discord kennt "name" nicht: die Fassung ohne die neueren Felder wird genommen, der Titel bleibt', async () => {
  const a = setup();
  a.settings.name = 'Mein Kino';
  a.ipcs.rejectIf = (act) => 'name' in act;
  a.p.refresh();
  assert.ok(await until(() => a.ipc()?.activities.length === 1));
  const sent = a.ipc().activities[0];
  assert.equal('name' in sent, false);
  assert.equal('status_display_type' in sent, false);
  assert.equal(sent.details, 'Paper Moons');
  await a.p.shutdown();
});

test('Der eingebaute Wert ist eine gueltige Application-ID (oeffentliche Kennung, keine Zugangsdaten)', () => {
  const { DEFAULT_CLIENT_ID, CLIENT_ID } = require('../src/main/discord-presence');
  assert.match(DEFAULT_CLIENT_ID, CLIENT_ID);
});