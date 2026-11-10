'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SeerrClient, SeerrError, normalizeSeerrUrl, candidateSeerrUrls, probeSeerr, loginWithJellyfin, normalizeResult, normalizeDetails, tmdbImageUrl, MEDIA_STATUS } = require('../src/main/seerr');
const { ConfigStore } = require('../src/main/config');
const { server, state, SEERR } = require('../tools/mock-server');

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  SEERR.expired = false;
  state.log.length = 0;
});

const cookieClient = async () => new SeerrClient({ baseUrl: base, cookie: (await loginWithJellyfin(base, 'demo', 'demo')).cookie });

test('Adressen: Pfadreste und Schraegstriche werden entfernt, ohne Schema wird https, http und Port 5055 probiert', () => {
  assert.equal(normalizeSeerrUrl('http://srv:5055/'), 'http://srv:5055');
  assert.equal(normalizeSeerrUrl('https://seerr.example.com/api/v1'), 'https://seerr.example.com');
  assert.equal(normalizeSeerrUrl('seerr.local:5055/api'), 'http://seerr.local:5055');
  assert.equal(normalizeSeerrUrl('https://example.com/seerr/'), 'https://example.com/seerr');
  assert.throws(() => normalizeSeerrUrl('  '), SeerrError);
  assert.deepEqual(candidateSeerrUrls('seerr.example.com'), ['https://seerr.example.com', 'http://seerr.example.com', 'http://seerr.example.com:5055']);
  assert.deepEqual(candidateSeerrUrls('http://a:1'), ['http://a:1']);
});

test('Server finden: ohne Schema, mit Version; kein Seerr -> verstaendlicher Fehler', async () => {
  const r = await probeSeerr(base.replace('http://', ''));
  assert.equal(r.url, base);
  assert.match(r.version, /mock/);
  await assert.rejects(() => probeSeerr('127.0.0.1:1'), /nicht erreichbar|Zeitueberschreitung/);
});

test('Anmeldung mit dem Jellyfin-Konto liefert das Session-Cookie; falsches Passwort wird abgelehnt', async () => {
  const r = await loginWithJellyfin(base, 'demo', 'demo');
  assert.equal(r.cookie, SEERR.sid);
  assert.equal(r.user.displayName, 'Demo');
  await assert.rejects(() => loginWithJellyfin(base, 'demo', 'falsch'), (e) => e instanceof SeerrError && e.status === 401 && /abgelehnt/.test(e.message));
});

test('Suche: nur Filme und Serien (Personen fallen weg), Status aus mediaInfo, Jahr, Poster', async () => {
  const c = await cookieClient();
  const list = await c.search('mock');
  assert.equal(list.some((r) => r.mediaType === 'person'), false);
  const by = Object.fromEntries(list.map((r) => [r.id, r]));
  assert.deepEqual([by[603].mediaType, by[603].title, by[603].year, by[603].status, by[603].posterPath], ['movie', 'Mock Matrix Resurrection', 2021, 0, '/mockposter0001.jpg']);
  assert.deepEqual([by[1399].mediaType, by[1399].title, by[1399].year], ['tv', 'Mock Thrones', 2011], 'Serien tragen "name" und "firstAirDate"');
  assert.equal(by[4242].status, MEDIA_STATUS.AVAILABLE);
  assert.equal(by[5151].status, MEDIA_STATUS.PENDING);
  assert.equal(by[5151].posterPath, null);
  assert.deepEqual(await c.search('gibtesnicht'), []);
  const sent = state.log.filter((l) => l.at === 'seerr:GET /search');
  assert.ok(sent.length >= 2);
});

test('Trend: nur Filme (keine Serien, Personen, Doppelten, gesperrten Titel), ueber mehrere Seiten, mit Stand', async () => {
  const c = await cookieClient();
  const list = await c.trending();
  assert.deepEqual(list.map((r) => r.id), [7001, 4242, 7002, 5151, 7003], 'Reihenfolge von Seerr bleibt, Serie 1399, Person 777, Doppelter 7001 und gesperrter 7004 fehlen');
  assert.ok(list.every((r) => r.mediaType === 'movie'));
  const by = Object.fromEntries(list.map((r) => [r.id, r]));
  assert.deepEqual([by[7001].title, by[7001].year, by[7001].status, by[7001].posterPath], ['Trend Film Eins', 2026, 0, '/trendposter0001.jpg']);
  assert.equal(by[4242].status, MEDIA_STATUS.AVAILABLE);
  assert.equal(by[5151].status, MEDIA_STATUS.PENDING);
  const pages = state.log.filter((l) => l.at === 'seerr:GET /discover/trending');
  assert.equal(pages.length, 3, 'drei Seiten gelesen, bis die Liste zu Ende ist');
  assert.equal((await c.trending({ limit: 2 })).length, 2, 'limit begrenzt die Liste');
});

test('Trend: Bewertung (eine Nachkommastelle) und Hintergrundbild kommen mit, fehlende Angaben werden null', async () => {
  const c = await cookieClient();
  const by = Object.fromEntries((await c.trending()).map((r) => [r.id, r]));
  assert.deepEqual([by[7001].rating, by[7001].backdropPath], [7.9, '/trendbackdrop0001.jpg'], '7,94 wird 7,9');
  assert.deepEqual([by[4242].rating, by[7002].rating, by[7003].rating], [8.1, 6.4, 8.2]);
  assert.deepEqual([by[5151].rating, by[5151].backdropPath], [null, null], 'ohne Angabe null');
});

test('Trend: ein unbrauchbarer Bildpfad wird null (nichts Unerwartetes gelangt in die Oberflaeche)', async () => {
  const entry = { id: 7099, mediaType: 'movie', title: 'Pfad', releaseDate: '2026-01-01', voteAverage: '8.46', backdropPath: '../../x.png' };
  SEERR.trending.push(entry);
  try {
    const r = (await (await cookieClient()).trending({ limit: 40 })).find((x) => x.id === 7099);
    assert.deepEqual([r?.rating, r?.backdropPath], [8.5, null]);
  } finally {
    SEERR.trending.pop();
  }
});

test('Trend: Fehler auf der ersten Seite kommt an, eine abgelaufene Anmeldung als 401', async () => {
  const c = await cookieClient();
  SEERR.trendingError = true;
  try {
    await assert.rejects(() => c.trending(), (e) => e instanceof SeerrError && /Trends nicht verfuegbar/.test(e.message));
  } finally {
    SEERR.trendingError = false;
  }
  SEERR.expired = true;
  await assert.rejects(() => c.trending(), (e) => e instanceof SeerrError && e.status === 401);
});

test('Normalisierung: kaputte Eintraege ergeben null, nichts Unerwartetes gelangt durch', () => {
  assert.equal(normalizeResult(null), null);
  assert.equal(normalizeResult({ mediaType: 'person', id: 1, name: 'X' }), null);
  assert.equal(normalizeResult({ mediaType: 'movie', id: 'abc', title: 'X' }), null);
  assert.equal(normalizeResult({ mediaType: 'movie', id: 5 }), null, 'ohne Titel');
  const r = normalizeResult({ mediaType: 'movie', id: 5, title: 'T', releaseDate: '', posterPath: 42, overview: { x: 1 }, mediaInfo: { status: 'x' }, extra: '<script>' });
  assert.deepEqual(r, { mediaType: 'movie', id: 5, title: 'T', year: null, overview: '', posterPath: null, status: 0 });
});

test('Details: Film mit Besetzung, Regie, Laufzeit, Bewertung; Serie mit Staffeln und Schoepfern; Status aus mediaInfo', async () => {
  const c = await cookieClient();
  const m = await c.details('movie', 603);
  assert.deepEqual([m.mediaType, m.id, m.title, m.year, m.releaseDate, m.runtime, m.rating, m.tagline], ['movie', 603, 'Mock Matrix Resurrection', 2021, '2021-12-16', 148, 7.3, 'Zurueck im Mock.']);
  assert.equal(m.originalTitle, '', 'gleicher Originaltitel wird nicht doppelt gefuehrt');
  assert.deepEqual(m.genres, ['Science Fiction', 'Action']);
  assert.deepEqual(m.directors, ['Mock Regisseurin'], 'nur "Director", nicht jede Rolle im Stab');
  assert.deepEqual(m.cast.map((x) => [x.name, x.character, x.profilePath]), [['Mock Actor Eins', 'Neo', '/mockprofile001.jpg'], ['Mock Actor Zwei', 'Trinity', null], ['Mock Actor Drei', 'Morpheus', '/mockprofile003.jpg']]);
  assert.equal(m.posterPath, '/mockposter0001.jpg');
  assert.equal(m.backdropPath, '/mockbackdrop001.jpg');
  assert.equal(m.status, 0);
  assert.deepEqual([m.seasons, m.episodes, m.seriesStatus], [null, null, ''], 'Filme haben keine Staffeln');
  const t = await c.details('tv', 1399);
  assert.deepEqual([t.mediaType, t.title, t.year, t.runtime, t.rating, t.seasons, t.episodes, t.seriesStatus], ['tv', 'Mock Thrones', 2011, 57, 8.4, 8, 73, 'Ended']);
  assert.deepEqual(t.directors, ['Mock Erfinder', 'Mock Erfinderin'], 'bei Serien "Erstellt von"');
  const p = await c.details('movie', 5151);
  assert.equal(p.status, MEDIA_STATUS.PENDING, 'Status kommt aus mediaInfo');
  assert.equal(p.posterPath, null);
  assert.deepEqual([p.cast, p.genres], [[], []]);
  assert.ok(state.log.some((l) => l.at === 'seerr:GET /movie/603') && state.log.some((l) => l.at === 'seerr:GET /tv/1399'));
});

test('Details: Trailer-Schluessel aus relatedVideos (Trailer vor Teaser, nur YouTube mit echtem Schluessel)', async () => {
  const c = await cookieClient();
  assert.equal((await c.details('movie', 7001)).trailerKey, 'aqz-KE-bpKQ', 'Teaser, anderer Anbieter und kaputter Schluessel werden uebergangen');
  assert.equal((await c.details('movie', 603)).trailerKey, null, 'ohne Videos null');
  const key = (vids) => normalizeDetails('movie', { id: 1, title: 'T', relatedVideos: vids }).trailerKey;
  assert.equal(key([{ site: 'YouTube', type: 'Teaser', key: 'abcdefghijk' }]), 'abcdefghijk', 'ein Teaser genuegt, wenn es keinen Trailer gibt');
  assert.equal(key([{ site: 'YouTube', type: 'Clip', key: 'abcdefghijk' }]), null, 'nur Trailer und Teaser');
  assert.equal(key([{ site: 'YouTube', type: 'Trailer', key: '../../evil..' }, { site: 'YouTube', type: 'Trailer', key: 'abc' }]), null, 'kein Schluessel mit 11 harmlosen Zeichen');
  assert.equal(key('x'), null);
  assert.equal(key(undefined), null);
});

test('Details: Fehler werden verstaendlich (500 mit Meldung, 404, ungueltige Eingaben, abgelaufene Sitzung)', async () => {
  const c = await cookieClient();
  await assert.rejects(() => c.details('movie', 9999), (e) => e instanceof SeerrError && e.status === 500 && /Details nicht verfuegbar/.test(e.message));
  await assert.rejects(() => c.details('movie', 424242), (e) => e.status === 404 && /Not found|Nicht gefunden/.test(e.message));
  await assert.rejects(() => c.details('person', 1), /Medientyp/);
  await assert.rejects(() => c.details('movie', -3), /Titel-ID/);
  await assert.rejects(() => c.details('movie', '../etc'), /Titel-ID/);
  SEERR.expired = true;
  await assert.rejects(() => c.details('movie', 603), (e) => e.status === 401);
});

test('Details-Normalisierung: kaputte Eintraege ergeben null, Typen und Laengen sind begrenzt, fremde Bildpfade fallen weg', () => {
  assert.equal(normalizeDetails('movie', null), null);
  assert.equal(normalizeDetails('person', { id: 1, title: 'X' }), null);
  assert.equal(normalizeDetails('movie', { id: 'abc', title: 'X' }), null);
  assert.equal(normalizeDetails('movie', { id: 5 }), null, 'ohne Titel');
  const d = normalizeDetails('movie', {
    id: 5, title: 'T', overview: 'x'.repeat(9000), runtime: 'abc', voteAverage: 0, releaseDate: 'bald', tagline: { x: 1 },
    posterPath: 'https://boese.example/p.jpg', backdropPath: '/../../geheim.jpg', genres: [{ name: 'A' }, null, { name: 7 }, ...Array.from({ length: 20 }, (_, i) => ({ name: `G${i}` }))],
    credits: { cast: Array.from({ length: 40 }, (_, i) => ({ name: `Darsteller ${i}`, character: 'c', profilePath: i === 0 ? '/gueltig01.jpg' : 'http://x/y.png' })).concat([{ name: '' }, null]), crew: [{ job: 'Director', name: 'R1' }] },
    mediaInfo: { status: 'x' }, unbekannt: '<script>'
  });
  assert.equal(d.overview.length, 4000);
  assert.deepEqual([d.runtime, d.rating, d.releaseDate, d.year, d.tagline, d.posterPath, d.backdropPath, d.status], [null, null, '', null, '', null, null, 0]);
  assert.equal(d.genres.length, 6);
  assert.deepEqual(d.genres.slice(0, 1), ['A']);
  assert.equal(d.cast.length, 12);
  assert.equal(d.cast[0].profilePath, '/gueltig01.jpg');
  assert.equal(d.cast[1].profilePath, null);
  assert.deepEqual(d.directors, ['R1']);
  assert.ok(!('unbekannt' in d));
});

test('API-Schluessel statt Anmeldung; falscher Schluessel -> 403', async () => {
  const ok = new SeerrClient({ baseUrl: base, apiKey: SEERR.apiKey });
  assert.equal((await ok.me()).displayName, 'Schluessel-Konto');
  await assert.rejects(() => new SeerrClient({ baseUrl: base, apiKey: 'falsch' }).me(), (e) => e.status === 403);
  await assert.rejects(() => new SeerrClient({ baseUrl: base }).search('mock'), (e) => e.status === 403, 'ohne Zugang');
});

test('Anfragen: Film ohne Staffeln, Serie komplett; Antwort mit Status', async () => {
  const c = await cookieClient();
  const movie = await c.requestMedia({ mediaType: 'movie', mediaId: 603 });
  assert.deepEqual(movie, { id: 1, requestStatus: 1, mediaStatus: MEDIA_STATUS.PENDING });
  const tv = await c.requestMedia({ mediaType: 'tv', mediaId: 1399 });
  assert.equal(tv.id, 2);
  const bodies = state.log.filter((l) => l.at === 'seerr:request-body');
  assert.deepEqual(bodies.map(({ at, ...b }) => b), [{ mediaType: 'movie', mediaId: 603 }, { mediaType: 'tv', mediaId: 1399, seasons: 'all' }]);
  const after = await c.search('thrones');
  assert.equal(after[0].status, MEDIA_STATUS.PENDING, 'danach steht der Titel als angefragt in der Suche');
});

test('Anfragen: Fehler werden verstaendlich (409 schon angefragt, 403 Kontingent, 401 Sitzung abgelaufen, ungueltige Eingaben)', async () => {
  const c = await cookieClient();
  await assert.rejects(() => c.requestMedia({ mediaType: 'movie', mediaId: 5151 }), (e) => e.status === 409 && /Bereits angefragt/.test(e.message));
  await assert.rejects(() => c.requestMedia({ mediaType: 'movie', mediaId: 9999 }), (e) => e.status === 403 && /Kontingent/.test(e.message));
  await assert.rejects(() => c.requestMedia({ mediaType: 'person', mediaId: 1 }), /Unbekannter Medientyp/);
  await assert.rejects(() => c.requestMedia({ mediaType: 'movie', mediaId: -3 }), /Ungueltige/);
  await assert.rejects(() => c.requestMedia({ mediaType: 'movie', mediaId: 'abc' }), /Ungueltige/);
  assert.equal(state.log.filter((l) => l.at === 'seerr:request-body').length, 2, 'ungueltige Eingaben erreichen den Server nicht');
  SEERR.expired = true;
  await assert.rejects(() => c.search('mock'), (e) => e.status === 401 && /abgelaufen/.test(e.message));
});

test('Kein Cookie-Speicher des Browser-Stacks: alle Anfragen gehen mit credentials "omit" raus', async () => {
  const seen = [];
  const spy = async (url, init) => {
    seen.push({ url: String(url), credentials: init.credentials, cookie: init.headers?.Cookie ?? null, key: init.headers?.['X-Api-Key'] ?? null });
    return new Response(JSON.stringify({ version: '2.7.0', results: [] }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'connect.sid=abc; Path=/' } });
  };
  await probeSeerr('http://seerr.test:5055', spy);
  await loginWithJellyfin('http://seerr.test:5055', 'u', 'p', spy);
  await new SeerrClient({ baseUrl: 'http://seerr.test:5055', cookie: 'abc', fetch: spy }).search('x');
  await new SeerrClient({ baseUrl: 'http://seerr.test:5055', apiKey: 'k', fetch: spy }).search('x');
  assert.equal(seen.length, 4);
  assert.ok(seen.every((s) => s.credentials === 'omit'), JSON.stringify(seen));
  assert.equal(seen[2].cookie, 'connect.sid=abc');
  assert.equal(seen[3].key, 'k');
  assert.equal(seen[3].cookie, null, 'mit API-Schluessel kein Cookie');
});

test('Poster: nur bekannte Groessen und harmlose Dateinamen werden zu einer TMDB-Adresse', () => {
  assert.equal(tmdbImageUrl('w342', 'mockposter0001.jpg'), 'https://image.tmdb.org/t/p/w342/mockposter0001.jpg');
  assert.equal(tmdbImageUrl('w500', 'aB3-_x9Qz.webp'), 'https://image.tmdb.org/t/p/w500/aB3-_x9Qz.webp');
  assert.equal(tmdbImageUrl('w1280', 'trendbackdrop0001.jpg'), 'https://image.tmdb.org/t/p/w1280/trendbackdrop0001.jpg', 'grosse Stufe fuer das Banner der Startseite');
  for (const [size, file] of [['original', 'mockposter0001.jpg'], ['w342', '../secret.jpg'], ['w342', 'a/b.jpg'], ['w342', 'x.jpg'], ['w342', 'mockposter0001.exe'], ['w342', 'mockposter0001.jpg?x=1'], ['w342', undefined], [undefined, 'mockposter0001.jpg'], ['https://evil', 'mockposter0001.jpg']]) {
    assert.equal(tmdbImageUrl(size, file), null, `${size} ${file}`);
  }
});

test('Zugangsdaten werden verschluesselt gespeichert, die Oberflaeche bekommt sie nie', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-seerr-'));
  const safe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`ENC(${s})`), decryptString: (b) => b.toString().slice(4, -1) };
  const c = new ConfigStore(dir, safe);
  assert.equal(c.getSeerr(), null);
  assert.equal(c.publicState().seerr, null);
  c.saveSeerr({ url: 'http://seerr:5055', mode: 'apikey', userName: 'Demo', secret: 'GEHEIMER-SCHLUESSEL' });
  assert.deepEqual(c.getSeerr(), { url: 'http://seerr:5055', mode: 'apikey', userName: 'Demo', secret: 'GEHEIMER-SCHLUESSEL' });
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('GEHEIMER-SCHLUESSEL'), 'nicht im Klartext auf der Platte');
  assert.deepEqual(c.publicState().seerr, { url: 'http://seerr:5055', mode: 'apikey', userName: 'Demo' }, 'ohne Geheimnis');
  assert.ok(!JSON.stringify(c.publicState()).includes('GEHEIMER'));
  assert.deepEqual(new ConfigStore(dir, safe).getSeerr().secret, 'GEHEIMER-SCHLUESSEL', 'bleibt nach einem Neustart');
  c.clearSeerr();
  assert.equal(new ConfigStore(dir, safe).getSeerr(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Probleme melden (Seerr "Issues") ----------

test.beforeEach(() => {
  SEERR.issues.length = 0;
  SEERR.issueForbidden = false;
});

test('Problem melden: Film mit Art und Kommentar, Seerr bekommt seine eigene Medien-Nummer (nicht die TMDB-Nummer)', async () => {
  const c = await cookieClient();
  const r = await c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 3, message: '  Untertitel fehlen ab Minute 10  ' });
  assert.equal(r.id, 1);
  assert.equal(SEERR.issues.length, 1);
  const sent = SEERR.issues[0];
  assert.equal(sent.issueType, 3);
  assert.equal(sent.message, 'Untertitel fehlen ab Minute 10', 'Kommentar ohne Leerraum am Rand');
  assert.equal(sent.media.id, 42, 'die Medien-Nummer von Seerr, nicht 4242');
  assert.equal('problemSeason' in state.log.find((l) => l.at === 'seerr:issue-body'), false, 'bei Filmen keine Staffel und Folge');
});

test('Problem melden: ohne Kommentar geht der Ersatztext, nie ein leerer Text (Seerr verlangt einen)', async () => {
  const c = await cookieClient();
  await c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 1, message: '   ', fallbackMessage: 'Problem mit Video (ohne Beschreibung)' });
  assert.equal(SEERR.issues[0].message, 'Problem mit Video (ohne Beschreibung)');
  await c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 2 });
  assert.equal(SEERR.issues[1].message, '-', 'ganz ohne Text ein Strich statt eines leeren Textes');
});

test('Problem melden: Serien tragen Staffel und Folge (0 = alle), ungueltige Werte werden 0', async () => {
  const c = await cookieClient();
  await c.reportIssue({ mediaType: 'tv', tmdbId: 1399, issueType: 2, message: 'Ton leise', season: 2, episode: 5 });
  assert.equal(SEERR.issues[0].problemSeason, 2);
  assert.equal(SEERR.issues[0].problemEpisode, 5);
  await c.reportIssue({ mediaType: 'tv', tmdbId: 1399, issueType: 4, message: 'x', season: -3, episode: 'abc' });
  assert.equal(SEERR.issues[1].problemSeason, 0);
  assert.equal(SEERR.issues[1].problemEpisode, 0);
});

test('Problem melden: lange Kommentare werden gekuerzt', async () => {
  const c = await cookieClient();
  await c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 4, message: 'a'.repeat(5000) });
  assert.equal(SEERR.issues[0].message.length, 2000);
});

test('Problem melden: ungueltige Eingaben scheitern, bevor etwas an Seerr geht', async () => {
  const c = await cookieClient();
  state.log.length = 0;
  await assert.rejects(() => c.reportIssue({ mediaType: 'person', tmdbId: 1, issueType: 1 }), /Medientyp/);
  await assert.rejects(() => c.reportIssue({ mediaType: 'movie', tmdbId: 0, issueType: 1 }), /Titel-ID/);
  await assert.rejects(() => c.reportIssue({ mediaType: 'movie', tmdbId: 1.5, issueType: 1 }), /Titel-ID/);
  await assert.rejects(() => c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 9 }), /Art des Problems/);
  await assert.rejects(() => c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 0 }), /Art des Problems/);
  assert.equal(state.log.filter((l) => l.at.startsWith('seerr:')).length, 0, 'keine Anfrage an Seerr');
});

test('Problem melden: ein Titel, den Seerr nicht kennt, gibt eine verstaendliche Meldung (Bibliothek synchronisieren)', async () => {
  const c = await cookieClient();
  await assert.rejects(
    () => c.reportIssue({ mediaType: 'movie', tmdbId: 603, issueType: 1, message: 'x' }),
    (e) => e instanceof SeerrError && e.status === 404 && /kennt diesen Titel noch nicht/.test(e.message) && /synchronisiere/i.test(e.message)
  );
  assert.equal(SEERR.issues.length, 0);
});

test('Problem melden: ohne Recht (403) sagt es das Konto-Problem, nicht "Kontingent"; abgelaufene Anmeldung bleibt 401', async () => {
  const c = await cookieClient();
  SEERR.issueForbidden = true;
  await assert.rejects(
    () => c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 1, message: 'x' }),
    (e) => e.status === 403 && /darf keine Probleme melden/.test(e.message) && !/Kontingent/.test(e.message)
  );
  SEERR.issueForbidden = false;
  SEERR.expired = true;
  await assert.rejects(() => c.reportIssue({ mediaType: 'movie', tmdbId: 4242, issueType: 1, message: 'x' }), (e) => e.status === 401);
});
