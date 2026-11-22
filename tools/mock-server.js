#!/usr/bin/env node
'use strict';

/**
 * Lokaler Mock eines Jellyfin-Servers fuer Entwicklung und Tests.
 * Start: node tools/mock-server.js [port]     Zugang: Benutzer "demo", Passwort "demo"
 * Bilder werden als SVG erzeugt, Videodaten gibt es nicht (der Mock liefert nur API-Antworten).
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Optionales Testvideo (z. B. mit mpv erzeugt, siehe README); ohne Datei liefert der Mock nur API-Antworten.
const VIDEO = process.env.MOCK_VIDEO || path.join(__dirname, 'sample', 'test.mkv');

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8097);
const TOKEN = 'mock-token-0123456789abcdef';
const USER = { Id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', Name: 'demo' };
const SERVER_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
const TICKS = 10_000_000;

const id32 = (s) => crypto.createHash('md5').update(s).digest('hex');
const hue = (s) => parseInt(id32(s).slice(0, 4), 16) % 360;

const MOVIE_DATA = [
  ['Aurora Protocol', 2024, ['Science Fiction', 'Thriller'], '4k-dv'],
  ['The Last Lighthouse', 2023, ['Drama', 'Mystery'], '4k-hdr'],
  ['Neon Harbor', 2022, ['Action', 'Crime'], '4k-hdr'],
  ['Paper Moons', 2021, ['Romance', 'Drama'], 'hd'],
  ['Echoes of Tomorrow', 2024, ['Science Fiction'], '4k-dv'],
  ['Iron Meridian', 2020, ['Action', 'Adventure'], '4k-hdr'],
  ['A Quiet Orbit', 2019, ['Drama'], 'hd'],
  ['The Glass Garden', 2023, ['Fantasy'], '4k-dv'],
  ['Crimson Tide Rising', 2018, ['War', 'Drama'], 'hd'],
  ['Midnight Cartographers', 2022, ['Mystery', 'Adventure'], '4k-hdr'],
  ['Saltwater Hearts', 2017, ['Romance', 'Comedy'], 'hd'],
  ['Velocity', 2024, ['Action', 'Thriller'], '4k-dv'],
  ['Hollow Crown', 2021, ['History', 'Drama'], 'hd'],
  ['Skyline Drifters', 2020, ['Comedy', 'Adventure'], 'hd'],
  ['Ghost in the Orchard', 2016, ['Horror'], 'hd'],
  ['Solar Winds', 2025, ['Science Fiction', 'Adventure'], '4k-dv'],
  ['The Clockmaker’s Daughter', 2015, ['Fantasy', 'Drama'], 'hd'],
  ['Brightwater', 2019, ['Documentary'], '4k-hdr'],
  ['Last Train to Elysium', 2022, ['Thriller', 'Mystery'], '4k-hdr'],
  ['Marble Sky', 2018, ['Drama'], 'hd'],
  ['Wild Frequencies', 2023, ['Music', 'Documentary'], 'hd'],
  ['Operation Daybreak', 2014, ['War', 'Action'], 'hd']
];
const SERIES_DATA = [
  ['Starfall Station', 2023, ['Science Fiction', 'Drama'], 3, 6],
  ['The Winter Archive', 2021, ['Mystery', 'Thriller'], 2, 8],
  ['Harbor Lights', 2019, ['Drama'], 4, 5],
  ['Code of the Wild', 2024, ['Adventure'], 1, 10]
];
const LOREM = 'A tense, beautifully shot story that follows an unlikely group as they uncover a secret hidden for decades. Every choice has a cost, and the closer they get to the truth, the more it threatens everything they know. Featuring stunning visuals, a haunting score and unforgettable performances.';

const people = [
  ['Mara Ellison', 'Actor', 'Captain Reyes'],
  ['Jonas Whitfield', 'Actor', 'Dr. Calder'],
  ['Priya Nandakumar', 'Actor', 'Lena'],
  ['Tomas Berg', 'Actor', 'Marek'],
  ['Elise Fontaine', 'Director', ''],
  ['Daniel Okafor', 'Writer', '']
].map(([Name, Type, Role]) => ({ Id: id32(Name), Name, Type, Role }));

function streamsFor(kind) {
  const uhd = kind.startsWith('4k');
  const video = uhd
    ? { Index: 0, Type: 'Video', Codec: 'hevc', Profile: 'Main 10', Width: 3840, Height: 2160, BitDepth: 10, RealFrameRate: 23.976, VideoRange: 'HDR', VideoRangeType: kind === '4k-dv' ? 'DOVIWithHDR10' : 'HDR10', DvProfile: kind === '4k-dv' ? 8 : undefined, BitRate: 48_000_000, DisplayTitle: '4K HEVC Main 10 HDR10', IsDefault: true }
    : { Index: 0, Type: 'Video', Codec: 'h264', Profile: 'High', Width: 1920, Height: 1080, BitDepth: 8, RealFrameRate: 24, VideoRange: 'SDR', VideoRangeType: 'SDR', BitRate: 12_000_000, DisplayTitle: '1080p H264', IsDefault: true };
  const audio = uhd
    ? [
        { Index: 1, Type: 'Audio', Codec: 'truehd', Profile: 'Dolby TrueHD + Dolby Atmos', Language: 'eng', Channels: 8, ChannelLayout: '7.1', BitRate: 4_500_000, SampleRate: 48000, DisplayTitle: 'English - Dolby TrueHD Atmos - 7.1', IsDefault: true },
        { Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'ger', Channels: 6, ChannelLayout: '5.1', BitRate: 640_000, SampleRate: 48000, DisplayTitle: 'Deutsch - Dolby Digital - 5.1' }
      ]
    : [{ Index: 1, Type: 'Audio', Codec: 'aac', Language: 'eng', Channels: 2, ChannelLayout: 'stereo', BitRate: 192_000, SampleRate: 48000, DisplayTitle: 'English - AAC - Stereo', IsDefault: true }];
  const subs = [
    { Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', DisplayTitle: 'English - SubRip', IsDefault: false },
    { Index: 4, Type: 'Subtitle', Codec: 'pgssub', Language: 'ger', DisplayTitle: 'Deutsch - PGSSUB', IsDefault: false },
    { Index: 5, Type: 'Subtitle', Codec: 'subrip', Language: 'ger', IsForced: true, DisplayTitle: 'Deutsch - Erzwungen - SubRip' }
  ];
  return [video, ...audio, ...subs];
}

/** Externer deutscher SRT-Untertitel (Index 6), wie ihn Jellyfin mit DeliveryUrl ausliefert. */
const extSub = (id) => ({ Index: 6, Type: 'Subtitle', Codec: 'srt', Language: 'ger', IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: `/Videos/${id}/${id}/Subtitles/6/0/Stream.srt`, DisplayTitle: 'Deutsch - Extern - SRT' });

function srt() {
  const t = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
  return Array.from({ length: 12 }, (_, i) => `${i + 1}\n${t(i * 5)} --> ${t(i * 5 + 4)}\nExterner Untertitel ${i + 1}: Jellycloud Player\n`).join('\n');
}

function serveVideo(req, res) {
  if (!fs.existsSync(VIDEO)) return send(res, 404, { Message: 'Kein Testvideo vorhanden' });
  const size = fs.statSync(VIDEO).size;
  const range = req.headers.range;
  state.log.push({ at: 'stream', range: range ?? null, hasAuthHeader: /Token="/.test(req.headers.authorization ?? ''), query: req.url.split('?')[1] ?? '' });
  const headers = { 'content-type': 'video/x-matroska', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(VIDEO, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'content-length': size });
    fs.createReadStream(VIDEO).pipe(res);
  }
}

// delays: kuenstliche Antwortzeiten in ms (Tests fuer langsame Server): { stopped, playbackInfo, items }; dazu wie beim Apple-Testserver
//   lists (alle Listen: /Items, Neu, Weiterschauen, Als Naechstes), images, auth (Anmeldung mit Passwort), gesetzt ueber POST /__debug/delay in Sekunden
// bytes: gesendete JSON-Antworten (items = Listen von /Items), fuer Leistungsmessungen
// limits: Verbindungsart und Bitratengrenzen wie bei einem echten Server (bit/s): local = Client liegt im LAN (dann gilt keine Grenze),
// user/server = Fern-Grenze der Benutzer-Richtlinie bzw. serverweit, serverForbidden = /System/Configuration nur fuer Administratoren, endpointMissing = /System/Endpoint fehlt
// faults: gestellte Fehler je Art (lists, images): { how: '500'|'invalid'|'empty'|'drop', left: Zahl oder null = bis abgeschaltet } (POST /__debug/fault)
// expired: Sitzung abgelaufen, jede angemeldete Anfrage bekommt 401 bis zur naechsten Anmeldung (POST /__debug/expire)
// qc: Quick Connect wie beim Apple-Testserver (POST /__debug/quickconnect): hold = Bestaetigung zurueckhalten, gone = Code abgelaufen (404),
//   disabled = am Server aus, authorized = von einem anderen Geraet bestaetigt (POST /QuickConnect/Authorize), started = Zeit von Initiate
// remote: gestellte Wiedergaben anderer Geraete (POST /__debug/session), fuer "Auf diesem Geraet fortsetzen"
const state = { played: new Set(), fav: new Set(), progress: new Map(), log: [], qcPolls: 0, delays: { stopped: 0, playbackInfo: 0, items: 0, lists: 0, images: 0, auth: 0 }, bytes: { total: 0, items: 0 }, limits: { local: true, user: 0, server: 0, serverForbidden: false, endpointMissing: false }, admin: false, faults: {}, expired: false, qc: { hold: false, gone: false, disabled: false, authorized: false, started: 0 }, remote: [], extraViews: [] };

/** Tor fuer "festhalten, bis der Test freigibt" (delay=hold): wait() wartet, solange es zu ist, hoechstens 120 s. */
function makeGate() {
  let open = true;
  const waiters = [];
  return {
    get held() {
      return !open;
    },
    hold() {
      open = false;
    },
    release() {
      open = true;
      for (const w of waiters.splice(0)) w();
    },
    wait(ms = 120000) {
      if (open) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        t.unref?.();
        waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  };
}
const listGate = makeGate();
const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Naechster gestellter Fehler dieser Art (lists, images) oder null; zaehlt "count" herunter. */
function takeFault(kind) {
  const f = state.faults[kind];
  if (!f) return null;
  if (f.left != null) {
    f.left--;
    if (f.left <= 0) delete state.faults[kind];
  }
  return f.how;
}
/** Antwortet mit dem gestellten Fehler: HTTP-Status, unlesbares JSON, leere Antwort oder abgebrochene Verbindung. */
function sendFault(how, req, res) {
  state.log.push({ at: `fault ${how} ${req.url}` });
  if (how === 'drop') return req.socket.destroy();
  if (how === 'invalid') return send(res, 200, '{"Items": [', 'application/json');
  if (how === 'empty') return send(res, 200, '', 'application/json');
  return send(res, Number(how), { Message: `Mock: gestellter Fehler ${how}` });
}
/** Vorspann jeder Liste (Start, Bibliothek): festhalten, verzoegern, gestellter Fehler. Wahr, wenn die Anfrage damit beantwortet ist. */
async function listPrelude(req, res) {
  await listGate.wait();
  await sleep(state.delays.lists);
  const how = takeFault('lists');
  if (how) {
    sendFault(how, req, res);
    return true;
  }
  return false;
}

/** Daten fuer die Verwaltung (state.admin = true schaltet sie frei, sonst antwortet der Mock mit 403): Aufgaben, Sitzungen, Protokoll, Benutzer. */
function freshAdminData() {
  const day = 864e5;
  return {
    tasks: [
      { Id: id32('task-scan'), Name: 'Medienbibliothek durchsuchen', Description: 'Durchsucht die Medienbibliothek nach neuen Dateien.', Category: 'Library', State: 'Idle', IsHidden: false, LastExecutionResult: { StartTimeUtc: new Date(Date.now() - 3 * 3600e3).toISOString(), EndTimeUtc: new Date(Date.now() - 3 * 3600e3 + 95e3).toISOString(), Status: 'Completed' }, Triggers: [{ Type: 'IntervalTrigger', IntervalTicks: 12 * 3600 * TICKS }] },
      { Id: id32('task-images'), Name: 'Bilder extrahieren', Description: 'Extrahiert Kapitelbilder aus Videodateien.', Category: 'Library', State: 'Idle', IsHidden: false, LastExecutionResult: { StartTimeUtc: new Date(Date.now() - day).toISOString(), EndTimeUtc: new Date(Date.now() - day + 41e3).toISOString(), Status: 'Failed' }, Triggers: [] },
      { Id: id32('task-clean'), Name: 'Cache bereinigen', Description: 'Loescht alte Cache-Dateien.', Category: 'Maintenance', State: 'Idle', IsHidden: false, LastExecutionResult: null, Triggers: [{ Type: 'DailyTrigger', TimeOfDayTicks: 3 * 3600 * TICKS }] },
      { Id: id32('task-update'), Name: 'Plugin-Updates', Description: 'Sucht nach Plugin-Updates.', Category: 'Application', State: 'Running', CurrentProgressPercentage: 42.5, IsHidden: false, LastExecutionResult: null, Triggers: [] }
    ],
    sessions: [
      { Id: 'sess-1', UserId: USER.Id, UserName: 'demo', Client: 'Jellycloud Player', DeviceName: 'WIN-KI', LastActivityDate: new Date().toISOString(), NowPlayingItem: null, PlayState: {} },
      { Id: 'sess-2', UserId: id32('user-lena'), UserName: 'lena', Client: 'Jellyfin Web', DeviceName: 'Wohnzimmer-TV', LastActivityDate: new Date(Date.now() - 20e3).toISOString(), NowPlayingItem: { Id: id32('movie:Neon Harbor'), Name: 'Neon Harbor', Type: 'Movie', RunTimeTicks: 6000 * TICKS }, PlayState: { PositionTicks: 1500 * TICKS, IsPaused: false } },
      { Id: 'sess-3', UserId: id32('user-max'), UserName: 'max', Client: 'Jellyfin Android', DeviceName: 'Pixel 8', LastActivityDate: new Date(Date.now() - 300e3).toISOString(), NowPlayingItem: null, PlayState: {} }
    ],
    activity: [
      { Id: 1, Name: 'lena hat die Wiedergabe von Neon Harbor gestartet', Type: 'VideoPlayback', Date: new Date(Date.now() - 60e3).toISOString(), Severity: 'Info', UserId: id32('user-lena') },
      { Id: 2, Name: 'Authentifizierung von max fehlgeschlagen', ShortOverview: 'IP 10.0.0.12', Type: 'AuthenticationFailed', Date: new Date(Date.now() - 3600e3).toISOString(), Severity: 'Error', UserId: id32('user-max') },
      { Id: 3, Name: 'Aufgabe Medienbibliothek durchsuchen abgeschlossen', Type: 'ScheduledTaskCompleted', Date: new Date(Date.now() - 3 * 3600e3).toISOString(), Severity: 'Info' },
      { Id: 4, Name: 'Plugin-Update verfuegbar', Type: 'PluginUpdateInstalled', Date: new Date(Date.now() - day).toISOString(), Severity: 'Warning' }
    ],
    users: [
      { Id: USER.Id, Name: 'demo', HasPassword: true, LastLoginDate: new Date().toISOString(), LastActivityDate: new Date().toISOString(), Policy: { IsAdministrator: true, IsDisabled: false, EnableMediaPlayback: true } },
      { Id: id32('user-lena'), Name: 'lena', HasPassword: true, LastLoginDate: new Date(Date.now() - day).toISOString(), LastActivityDate: new Date(Date.now() - 20e3).toISOString(), Policy: { IsAdministrator: false, IsDisabled: false, EnableMediaPlayback: true } },
      { Id: id32('user-max'), Name: 'max', HasPassword: false, LastLoginDate: new Date(Date.now() - 9 * day).toISOString(), LastActivityDate: new Date(Date.now() - 300e3).toISOString(), Policy: { IsAdministrator: false, IsDisabled: true, EnableMediaPlayback: true } }
    ],
    refreshes: 0,
    restarts: 0,
    shutdowns: 0,
    deleted: [],
    remoteResults: [
      { Name: 'Mock Treffer Eins', ProductionYear: 2019, SearchProviderName: 'TheMovieDb', ProviderIds: { Tmdb: '101' }, ImageUrl: null, Overview: 'Der erste Treffer.' },
      { Name: 'Mock Treffer Zwei', ProductionYear: 2021, SearchProviderName: 'TheMovieDb', ProviderIds: { Tmdb: '202' }, ImageUrl: null, Overview: 'Der zweite Treffer.' }
    ]
  };
}
state.adminData = null;

/** Wirksame Grenze fuer den Client in bit/s (0 = keine): nur wenn er nicht lokal ist, dann die kleinere von Benutzer und Server. */
function effectiveRemoteLimit() {
  const l = state.limits;
  if (l.local) return 0;
  const active = [l.user, l.server].filter((n) => n > 0);
  return active.length ? Math.min(...active) : 0;
}
const items = new Map();
const children = new Map();

function add(item, parentId) {
  items.set(item.Id, item);
  if (parentId) {
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(item.Id);
  }
  return item;
}

const MOVIES_VIEW = add({ Id: id32('view-movies'), Name: 'Filme', Type: 'CollectionFolder', CollectionType: 'movies', ImageTags: {} });
const SHOWS_VIEW = add({ Id: id32('view-shows'), Name: 'Serien', Type: 'CollectionFolder', CollectionType: 'tvshows', ImageTags: {} });

function baseDto(name, year, genres, kind) {
  const id = id32(`${kind}:${name}`);
  return {
    Id: id,
    Name: name,
    ServerId: SERVER_ID,
    ProductionYear: year,
    PremiereDate: `${year}-0${(hue(name) % 9) + 1}-1${hue(name) % 9}T00:00:00.0000000Z`,
    Genres: genres,
    GenreItems: genres.map((g) => ({ Name: g, Id: id32(g) })),
    OfficialRating: ['PG-13', 'R', 'FSK 12', 'FSK 16'][hue(name) % 4],
    CommunityRating: 5.8 + (hue(name) % 36) / 10,
    CriticRating: 55 + (hue(name) % 40),
    Overview: LOREM,
    Taglines: [`Some stories never end. ${name}.`],
    ImageTags: { Primary: id.slice(0, 8) },
    BackdropImageTags: [id.slice(8, 16)],
    PrimaryImageAspectRatio: 0.6667,
    People: people.map((p) => ({ ...p, PrimaryImageTag: undefined })),
    Studios: [{ Name: 'Northlight Pictures' }],
    RemoteTrailers: [{ Url: 'https://example.com/trailer' }]
  };
}

function addMovie([name, year, genres, quality], i) {
  const m = baseDto(name, year, genres, 'movie');
  Object.assign(m, { Type: 'Movie', MediaType: 'Video', RunTimeTicks: (5400 + (hue(name) % 5400)) * TICKS, Container: 'mkv', DateCreated: new Date(Date.now() - i * 864e5).toISOString(), ParentId: MOVIES_VIEW.Id });
  m.MediaStreams = [...streamsFor(quality), extSub(m.Id)];
  m.MediaSources = [{ Id: m.Id, Name: `${name} - ${quality === 'hd' ? '1080p' : '2160p'}`, Container: 'mkv', Size: quality === 'hd' ? 8_500_000_000 : 62_000_000_000, Bitrate: quality === 'hd' ? 12_000_000 : 52_000_000, SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, ETag: m.Id.slice(0, 12), RunTimeTicks: m.RunTimeTicks, DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1, MediaStreams: m.MediaStreams }];
  if (i === 0) m.ImageTags.Logo = 'logo0001';
  m.Chapters = Array.from({ length: 8 }, (_, c) => ({ StartPositionTicks: c * 700 * TICKS, Name: `Kapitel ${c + 1}` }));
  add(m, MOVIES_VIEW.Id);
}
MOVIE_DATA.forEach((entry, i) => addMovie(entry, i));
// Bibliotheksfilm mit der TMDB-Nummer von "Mock Arrival" (Seerr-Trend 4242): das Banner ordnet verfuegbare Trend-Titel so ihrem Bibliothekseintrag zu (anyProviderIdEquals)
items.get(id32('movie:Paper Moons')).ProviderIds = { Tmdb: '4242' };

/** Fuer Leistungstests: haengt n weitere Filme an (grosse Bibliothek). */
function addMovies(n) {
  const genres = ['Drama', 'Action', 'Comedy', 'Thriller', 'Science Fiction', 'Fantasy'];
  const base = MOVIE_DATA.length;
  for (let k = 0; k < n; k++) addMovie([`Testfilm ${String(k).padStart(5, '0')}`, 1980 + (k % 45), [genres[k % 6], genres[(k + 2) % 6]], ['hd', '4k-hdr', '4k-dv'][k % 3]], base + k);
}

SERIES_DATA.forEach(([name, year, genres, seasons, eps], si) => {
  const s = baseDto(name, year, genres, 'series');
  Object.assign(s, { Type: 'Series', Status: si % 2 ? 'Ended' : 'Continuing', DateCreated: new Date(Date.now() - si * 2 * 864e5).toISOString(), ParentId: SHOWS_VIEW.Id, RunTimeTicks: 2700 * TICKS });
  add(s, SHOWS_VIEW.Id);
  for (let sn = 1; sn <= seasons; sn++) {
    const season = { Id: id32(`season:${name}:${sn}`), Name: `Staffel ${sn}`, Type: 'Season', IndexNumber: sn, SeriesId: s.Id, SeriesName: name, ImageTags: {}, ParentId: s.Id };
    add(season, s.Id);
    for (let e = 1; e <= eps; e++) {
      const ep = baseDto(`${name} Episode ${e}`, year, genres, 'ep');
      Object.assign(ep, { Id: id32(`ep:${name}:${sn}:${e}`), Name: `Episode ${e}: ${['Arrival', 'Fault Lines', 'Silent Signal', 'The Return', 'Undertow', 'Breaking Point', 'Homecoming', 'Afterglow', 'Zero Hour', 'Finale'][(e - 1) % 10]}`, Type: 'Episode', MediaType: 'Video', IndexNumber: e, ParentIndexNumber: sn, SeriesId: s.Id, SeriesName: name, SeasonId: season.Id, SeasonName: season.Name, RunTimeTicks: (2400 + (hue(`${sn}${e}`) % 1200)) * TICKS, Container: 'mkv' });
      ep.ImageTags = { Primary: ep.Id.slice(0, 8) };
      ep.BackdropImageTags = [];
      ep.ParentBackdropItemId = s.Id;
      ep.ParentBackdropImageTags = [s.BackdropImageTags[0]];
      ep.SeriesPrimaryImageTag = s.ImageTags.Primary;
      ep.MediaStreams = [...streamsFor(si === 0 ? '4k-hdr' : 'hd'), extSub(ep.Id)];
      ep.MediaSources = [{ Id: ep.Id, Name: ep.Name, Container: 'mkv', Size: 3_000_000_000, Bitrate: 9_000_000, SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: true, ETag: ep.Id.slice(0, 12), RunTimeTicks: ep.RunTimeTicks, DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1, MediaStreams: ep.MediaStreams }];
      add(ep, season.Id);
    }
  }
});

// Blurhashes wie bei einem echten Server (ImageBlurHashes). Eine einzige Komponente (6 Zeichen) genuegt: Der Client nimmt daraus die
// Durchschnittsfarbe fuer den Hintergrundton. Die Farbe passt zu den erzeugten Bildern (Verlauf aus hue(...) und hue(...)+50).
const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const enc83 = (n, len) => {
  let s = '';
  for (let i = 0; i < len; i++) {
    s = B83[n % 83] + s;
    n = Math.floor(n / 83);
  }
  return s;
};
function flatBlurhash(h) {
  const s = 0.7;
  const l = 0.32;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + (((h + 20) % 360) / 30)) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `00${enc83((f(0) << 16) | (f(8) << 8) | f(4), 4)}`;
}
for (const it of items.values()) {
  const hash = flatBlurhash(hue(it.SeriesName ?? it.Name ?? ''));
  const hashes = {};
  if (it.ImageTags?.Primary) hashes.Primary = { [it.ImageTags.Primary]: hash };
  const bdTags = [...(it.BackdropImageTags ?? []), ...(it.ParentBackdropImageTags ?? [])];
  if (bdTags.length) hashes.Backdrop = Object.fromEntries(bdTags.map((t) => [t, hash]));
  if (Object.keys(hashes).length) it.ImageBlurHashes = hashes;
}

// Fortschritt vorbelegen, damit "Weiterschauen" und "Als Naechstes" gefuellt sind
const firstMovie = items.get(children.get(MOVIES_VIEW.Id)[0]);
state.progress.set(firstMovie.Id, Math.floor(firstMovie.RunTimeTicks * 0.37));
const thirdMovie = items.get(children.get(MOVIES_VIEW.Id)[2]);
state.progress.set(thirdMovie.Id, Math.floor(thirdMovie.RunTimeTicks * 0.12));
const showA = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
const showAEps = [...items.values()].filter((i) => i.Type === 'Episode' && i.SeriesId === showA.Id);
showAEps.slice(0, 3).forEach((e) => state.played.add(e.Id));
state.progress.set(showAEps[3].Id, Math.floor(showAEps[3].RunTimeTicks * 0.5));
state.fav.add(children.get(MOVIES_VIEW.Id)[1]);

function decorate(item, { detail = false } = {}) {
  const out = { ...item };
  const played = state.played.has(item.Id);
  const pos = state.progress.get(item.Id) ?? 0;
  out.UserData = { Played: played, IsFavorite: state.fav.has(item.Id), PlaybackPositionTicks: pos, PlayedPercentage: item.RunTimeTicks && pos ? (pos / item.RunTimeTicks) * 100 : 0, PlayCount: played ? 1 : 0 };
  if (item.Type === 'Series') out.UserData.UnplayedItemCount = [...items.values()].filter((e) => e.Type === 'Episode' && e.SeriesId === item.Id && !state.played.has(e.Id)).length;
  if (!detail) {
    delete out.MediaSources;
    delete out.People;
    delete out.Chapters;
  }
  return out;
}

/** Wie Jellyfin: nur die Bildarten liefern, die der Client mit enableImageTypes verlangt (ohne Angabe alle). */
function limitImages(item, q) {
  const wanted = (q.get('enableImageTypes') ?? '').split(',').filter(Boolean);
  if (!wanted.length || !item.ImageTags) return item;
  const tags = {};
  for (const k of wanted) if (item.ImageTags[k]) tags[k] = item.ImageTags[k];
  const out = { ...item, ImageTags: tags };
  if (!wanted.includes('Backdrop')) out.BackdropImageTags = [];
  return out;
}
// ---------- Bilder (SVG) ----------
function wrap(text, max) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      lines.push(line);
      line = w;
    } else line = `${line} ${w}`.trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

function imageSvg(item, type) {
  const h = hue(item.SeriesName ?? item.Name);
  const h2 = (h + 50) % 360;
  const title = item.Type === 'Episode' ? item.Name : item.Name;
  const dims = { Primary: item.Type === 'Episode' ? [640, 360] : [400, 600], Backdrop: [1920, 1080], Thumb: [640, 360], Logo: [600, 200] }[type] ?? [400, 600];
  const [w, hgt] = dims;
  if (type === 'Logo') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><text x="0" y="130" font-family="Segoe UI, sans-serif" font-weight="800" font-size="86" letter-spacing="-3" fill="#fff">${esc(item.Name.toUpperCase().slice(0, 14))}</text></svg>`;
  }
  const big = type === 'Backdrop';
  const lines = wrap(title, big ? 26 : w > 500 ? 22 : 14);
  const fs = big ? 84 : w > 500 ? 40 : 44;
  const text = big ? '' : lines.map((l, i) => `<text x="${w / 2}" y="${hgt * 0.62 + i * (fs + 6)}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="800" font-size="${fs}" fill="#fff" fill-opacity=".92">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 38%)"/><stop offset="1" stop-color="hsl(${h2} 75% 14%)"/></linearGradient>
<radialGradient id="r" cx=".72" cy=".25" r=".6"><stop offset="0" stop-color="hsl(${h2} 90% 62%)" stop-opacity=".8"/><stop offset="1" stop-color="hsl(${h2} 90% 62%)" stop-opacity="0"/></radialGradient>
<filter id="b"><feGaussianBlur stdDeviation="${big ? 40 : 14}"/></filter></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>
<circle cx="${w * 0.2}" cy="${hgt * 0.85}" r="${Math.min(w, hgt) * 0.4}" fill="hsl(${h} 80% 55%)" fill-opacity=".35" filter="url(#b)"/>
<path d="M0 ${hgt * 0.78} L${w * 0.22} ${hgt * 0.56} L${w * 0.4} ${hgt * 0.72} L${w * 0.62} ${hgt * 0.5} L${w * 0.82} ${hgt * 0.7} L${w} ${hgt * 0.6} L${w} ${hgt} L0 ${hgt}Z" fill="#000" fill-opacity=".38"/>${text}</svg>`;
}

// ---------- HTTP ----------
function send(res, status, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}
const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });

function authed(req) {
  if (state.expired) return false; // POST /__debug/expire: Sitzung abgelaufen bis zur naechsten Anmeldung
  const h = req.headers.authorization ?? '';
  return h.includes(`Token="${TOKEN}"`) || req.headers['x-emby-token'] === TOKEN;
}

function authResult() {
  return { User: { Id: USER.Id, Name: USER.Name, ServerId: SERVER_ID }, AccessToken: TOKEN, ServerId: SERVER_ID };
}

function listItems(q) {
  let list = [...items.values()].filter((i) => !['CollectionFolder'].includes(i.Type));
  if (q.get('ids')) {
    const ids = q.get('ids').split(',');
    list = ids.map((i) => items.get(i)).filter(Boolean);
    return { Items: list.map((i) => decorate(i, { detail: true })), TotalRecordCount: list.length };
  }
  const parentId = q.get('parentId');
  if (parentId) {
    const recursive = q.get('recursive') === 'true';
    list = recursive ? list.filter((i) => i.ParentId === parentId || i.SeriesId) : (children.get(parentId) ?? []).map((i) => items.get(i));
    if (recursive) list = list.filter((i) => i.ParentId === parentId);
  }
  const types = q.get('includeItemTypes')?.split(',');
  if (types) list = list.filter((i) => types.includes(i.Type));
  const pid = q.get('anyProviderIdEquals'); // "tmdb.4242": Anbieter und Nummer, ohne Beachtung der Gross-/Kleinschreibung des Anbieters
  if (pid) {
    const [prov, val] = pid.split('.');
    list = list.filter((i) => Object.entries(i.ProviderIds ?? {}).some(([k, v]) => k.toLowerCase() === prov.toLowerCase() && String(v) === val));
  }
  const term = q.get('searchTerm')?.toLowerCase();
  if (term) list = list.filter((i) => i.Name.toLowerCase().includes(term) || (i.SeriesName ?? '').toLowerCase().includes(term));
  const filters = q.get('filters')?.split(',') ?? [];
  if (filters.includes('IsFavorite')) list = list.filter((i) => state.fav.has(i.Id));
  if (filters.includes('IsUnplayed')) list = list.filter((i) => !state.played.has(i.Id));
  const genres = q.get('genres')?.split('|');
  if (genres) list = list.filter((i) => genres.some((g) => (i.Genres ?? []).includes(g)));
  const sortBy = (q.get('sortBy') ?? 'SortName').split(',')[0];
  const dir = q.get('sortOrder') === 'Descending' ? -1 : 1;
  const key = { SortName: (i) => i.Name, DateCreated: (i) => i.DateCreated ?? '', PremiereDate: (i) => i.PremiereDate ?? '', CommunityRating: (i) => i.CommunityRating ?? 0, Runtime: (i) => i.RunTimeTicks ?? 0, Random: () => Math.random() }[sortBy] ?? ((i) => i.Name);
  list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);
  const total = list.length;
  const start = Number(q.get('startIndex') ?? 0);
  const limit = Number(q.get('limit') ?? 100);
  list = list.slice(start, limit ? start + limit : undefined);
  return { Items: list.map((i) => decorate(i)), TotalRecordCount: total, StartIndex: start };
}

// Serie mit der TMDB-Nummer von "Mock Thrones" (Seerr 1399): daran haengt "Problem melden" bei Serien und Folgen
{
  const show = [...items.values()].find((i) => i.Type === 'Series' && i.Name === 'Starfall Station');
  if (show) show.ProviderIds = { Tmdb: '1399' };
}

// ---------- Mock-Seerr (/api/v1): Anmeldung per Jellyfin-Konto oder API-Schluessel, Suche, Anfragen ----------
const SEERR = {
  sid: 'mock-seerr-sid',
  apiKey: 'mock-seerr-key',
  expired: false, // true: jede Anfrage bekommt 401 (Sitzung abgelaufen)
  statuses: new Map([['movie:4242', 5], ['movie:5151', 2], ['movie:7004', 6]]), // bereits bekannte Titel: verfuegbar, angefragt bzw. gesperrt (Seerr 3.5.1: 6 gesperrt, 7 geloescht)
  // Anfragen: { id, status (1 wartet, 2 genehmigt, 3 abgelehnt, 4 gescheitert, 5 abgeschlossen), mediaType, mediaId, seasons, readySeasons,
  // deleted, modifiedBy, requestedBy, createdAt, updatedAt, media }; GET /request liefert sie wie Seerr (neueste zuerst, take/skip/filter/sort)
  requests: [],
  // Steuerung wie beim Apple-Testserver (Tools/mock_server.py, Seerr-Port); hier auf demselben Port unter /__debug/...
  permissions: null, // Rechte des Benutzers zur Laufzeit (POST /__debug/permissions?set=<Bits>); null: MOCK_SEERR_PERMISSIONS, sonst 1072
  mode: 'ok', // 'down': jede Anfrage endet mit 503 (POST /__debug/mode?set=ok|down|expired; expired macht alle Sitzungen ungueltig)
  old: !!process.env.MOCK_SEERR_OLD, // aelteres Seerr: /discover/trending uebergeht mediaType und timeWindow und liefert gemischt
  identity: null, // Jellyfin-Kennung, die /auth/me nennt (POST /__debug/identity?jellyfin=...); null: die des Testbenutzers
  media: new Map(), // gestellter Stand eines Titels ("movie:<tmdb>" -> Stand), geht allem vor (POST /__debug/media?tmdb=&status=&type=)
  requestDelay: 0, // ms, Antwortzeit der Liste der Anfragen (POST /__debug/delay?requests=<s>|hold)
  quota: { movie: { limit: 0, days: 7, used: 0 }, tv: { limit: 0, days: 7, used: 0 } }, // Kontingent (limit 0 = unbegrenzt), GET /user/<id>/quota
  counters: { apiRequests: 0, listRequests: 0, tmdbRequests: 0, sessionRequests: 0, logouts: 0, trendRequests: 0 },
  // Probleme melden (POST /issue): Seerr kennt Titel unter einer eigenen Nummer (mediaInfo.id der Detailabfrage); nur diese Titel lassen sich melden (sonst 404 wie bei Seerr).
  mediaIds: new Map([['movie:4242', 42], ['tv:1399', 13]]),
  issues: [],
  issueForbidden: false, // true: das Konto darf keine Probleme melden (403)
  issueDelay: 0, // Antwortzeit auf eine Meldung in ms
  catalog: [
    { id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', overview: 'Ein Testfilm aus dem Mock-Katalog.' },
    { id: 1399, mediaType: 'tv', name: 'Mock Thrones', firstAirDate: '2011-04-17', posterPath: '/mockposter0002.jpg', overview: 'Eine Testserie.' },
    { id: 4242, mediaType: 'movie', title: 'Mock Arrival', releaseDate: '2016-11-10', posterPath: '/mockposter0003.jpg' },
    { id: 5151, mediaType: 'movie', title: 'Mock Pending Story', releaseDate: '2020-01-01', posterPath: null },
    { id: 9999, mediaType: 'movie', title: 'Mock Quota Exceeded', releaseDate: '2019-05-05', posterPath: '/mockposter0005.jpg' },
    { id: 777, mediaType: 'person', name: 'Mock Person', profilePath: '/mockperson0001.jpg' },
    { id: 2468, mediaType: 'movie', title: 'Dialog Anfrage Film', releaseDate: '2018-03-03', posterPath: '/mockposter0006.jpg', overview: 'Wird im Detailfenster angefragt.' }
  ],
  // Trend-Liste (GET /discover/trending?page=n): Filme, Serien und Personen gemischt, zwei Seiten zu je vier Eintraegen. Ein Film steht zweimal drin,
  // Id 4242 ist verfuegbar, 5151 angefragt, 7004 gesperrt (Stand 6: darf nicht erscheinen). trendingError: Seerr antwortet mit 500.
  trendingError: false,
  trendingDelay: 0, // ms: Seerr antwortet auf die Trend-Liste erst nach dieser Zeit (das Banner der Startseite wartet nicht darauf)
  trending: [
    // voteAverage/backdropPath: Bewertung und Hintergrundbild (gut bewertete Titel kommen ins Banner: 7001 und 7003 gut, 7002 zu schlecht, 5151 ohne beides, 4242 gut und in der Bibliothek)
    { id: 7001, mediaType: 'movie', title: 'Trend Film Eins', releaseDate: '2026-02-01', posterPath: '/trendposter0001.jpg', overview: 'Der erste Trend-Film.', voteAverage: 7.94, backdropPath: '/trendbackdrop0001.jpg' },
    { id: 1399, mediaType: 'tv', name: 'Mock Thrones', firstAirDate: '2011-04-17', posterPath: '/mockposter0002.jpg', voteAverage: 9.1, backdropPath: '/mockbackdrop002.jpg' },
    { id: 777, mediaType: 'person', name: 'Mock Person', profilePath: '/mockperson0001.jpg' },
    { id: 4242, mediaType: 'movie', title: 'Mock Arrival', releaseDate: '2016-11-10', posterPath: '/mockposter0003.jpg', voteAverage: 8.1, backdropPath: '/trendbackdrop4242.jpg' },
    { id: 7002, mediaType: 'movie', title: 'Trend Film Zwei', releaseDate: '2025-11-20', posterPath: '/trendposter0002.jpg', voteAverage: 6.4, backdropPath: '/trendbackdrop0002.jpg' },
    { id: 7001, mediaType: 'movie', title: 'Trend Film Eins', releaseDate: '2026-02-01', posterPath: '/trendposter0001.jpg' },
    { id: 5151, mediaType: 'movie', title: 'Mock Pending Story', releaseDate: '2020-01-01', posterPath: null },
    { id: 7004, mediaType: 'movie', title: 'Trend Gesperrt', releaseDate: '2024-04-04', posterPath: '/trendposter0004.jpg', voteAverage: 9.5, backdropPath: '/trendbackdrop0004.jpg' },
    { id: 7003, mediaType: 'movie', title: 'Trend Film Drei', releaseDate: '2026-01-15', posterPath: '/trendposter0003.jpg', voteAverage: 8.2, backdropPath: '/trendbackdrop0003.jpg' }
  ],
  // Zusatzfelder der Detail-Abfragen (GET /movie/{id}, /tv/{id}); Id 9999 antwortet absichtlich mit 500
  details: {
    'movie:603': {
      tagline: 'Zurueck im Mock.', runtime: 148, voteAverage: 7.34, voteCount: 1234, originalTitle: 'Mock Matrix Resurrection', backdropPath: '/mockbackdrop001.jpg',
      genres: [{ id: 1, name: 'Science Fiction' }, { id: 2, name: 'Action' }],
      credits: {
        cast: [
          { id: 9101, name: 'Mock Actor Eins', character: 'Neo', profilePath: '/mockprofile001.jpg' },
          { id: 9102, name: 'Mock Actor Zwei', character: 'Trinity', profilePath: null },
          { id: 9103, name: 'Mock Actor Drei', character: 'Morpheus', profilePath: '/mockprofile003.jpg' }
        ],
        crew: [{ id: 9104, name: 'Mock Regisseurin', job: 'Director', department: 'Directing' }, { id: 9105, name: 'Mock Kamera', job: 'Director of Photography', department: 'Camera' }]
      }
    },
    'tv:1399': {
      tagline: 'Der Winter naht.', episodeRunTime: [57], voteAverage: 8.4, numberOfSeasons: 8, numberOfEpisodes: 73, status: 'Ended', backdropPath: '/mockbackdrop002.jpg',
      createdBy: [{ name: 'Mock Erfinder' }, { name: 'Mock Erfinderin' }], genres: [{ id: 3, name: 'Drama' }],
      credits: { cast: [{ id: 9106, name: 'Mock Darsteller', character: 'Held', profilePath: '/mockprofile101.jpg' }], crew: [] }
    },
    'movie:5151': { overview: 'Wartet schon auf Freigabe.', runtime: 90, genres: [], credits: { cast: [], crew: [] } },
    // Trailer aus den "relatedVideos" (Banner der Startseite): erst ein Teaser, dann der Trailer (der Trailer gewinnt), dazu ein Eintrag mit kaputtem Schluessel
    'movie:7001': {
      runtime: 118, genres: [], credits: { cast: [], crew: [] },
      relatedVideos: [{ site: 'YouTube', type: 'Teaser', key: 'abcdefghijk' }, { site: 'Vimeo', type: 'Trailer', key: 'aqz-KE-bpKQ' }, { site: 'YouTube', type: 'Trailer', key: 'kaputt' }, { site: 'YouTube', type: 'Trailer', key: 'aqz-KE-bpKQ' }]
    }
  }
};

// Personen (GET /person/<id>, /person/<id>/combined_credits): die Besetzung der Detailseiten und "Mock Person" aus Suche und Trends
SEERR.people = new Map(
  [
    [777, 'Mock Person', 'Acting', [{ id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', character: 'Agentin' }, { id: 1399, mediaType: 'tv', name: 'Mock Thrones', firstAirDate: '2011-04-17', posterPath: '/mockposter0002.jpg', character: 'Ritterin' }, { id: 4242, mediaType: 'movie', title: 'Mock Arrival', releaseDate: '2016-11-10', posterPath: '/mockposter0003.jpg', character: 'Linguistin' }], [{ id: 7001, mediaType: 'movie', title: 'Trend Film Eins', releaseDate: '2026-02-01', posterPath: '/trendposter0001.jpg', job: 'Producer', department: 'Production' }]],
    [9101, 'Mock Actor Eins', 'Acting', [{ id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', character: 'Neo' }], []],
    [9102, 'Mock Actor Zwei', 'Acting', [{ id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', character: 'Trinity' }], []],
    [9103, 'Mock Actor Drei', 'Acting', [{ id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', character: 'Morpheus' }], []],
    [9104, 'Mock Regisseurin', 'Directing', [], [{ id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', job: 'Director', department: 'Directing' }]],
    [9105, 'Mock Kamera', 'Camera', [], [{ id: 603, mediaType: 'movie', title: 'Mock Matrix Resurrection', releaseDate: '2021-12-16', posterPath: '/mockposter0001.jpg', job: 'Director of Photography', department: 'Camera' }]],
    [9106, 'Mock Darsteller', 'Acting', [{ id: 1399, mediaType: 'tv', name: 'Mock Thrones', firstAirDate: '2011-04-17', posterPath: '/mockposter0002.jpg', character: 'Held' }], []]
  ].map(([id, name, dept, cast, crew]) => [id, { id, name, knownForDepartment: dept, biography: `${name} ist eine Testperson des Mock-Seerr.`, birthday: '1980-05-01', deathday: null, placeOfBirth: 'Mockstadt', profilePath: id === 777 ? '/mockperson0001.jpg' : null, cast, crew }])
);

// Trendlisten je Art (aktuelles Seerr: /discover/trending?mediaType=movie|tv&timeWindow=day|week, 20 je Seite): Grundlage der Top 10.
// Die ersten Titel gibt es auch in der Mediathek (4242 = Paper Moons, 1399 = Starfall Station); "week" liefert eine andere Reihenfolge.
{
  const known = (type, id) => SEERR.trending.find((r) => r.mediaType === type && r.id === id) ?? SEERR.catalog.find((r) => r.mediaType === type && r.id === id);
  const extra = (type, n) =>
    Array.from({ length: n }, (_, i) =>
      type === 'movie'
        ? { id: 8101 + i, mediaType: 'movie', title: `Top Film ${i + 1}`, releaseDate: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`, posterPath: `/topposter${8101 + i}.jpg`, voteAverage: 7 + (i % 3) / 2, backdropPath: `/topbackdrop${8101 + i}.jpg` }
        : { id: 8201 + i, mediaType: 'tv', name: `Top Serie ${i + 1}`, firstAirDate: `2024-${String((i % 12) + 1).padStart(2, '0')}-01`, posterPath: `/topposter${8201 + i}.jpg`, voteAverage: 7.5, backdropPath: `/topbackdrop${8201 + i}.jpg` }
    );
  const movie = [...[4242, 7001, 7003, 603, 7002, 5151, 2468, 7004].map((id) => known('movie', id)), ...extra('movie', 6)];
  const tv = [known('tv', 1399), ...extra('tv', 11)];
  const week = (list) => [...list.slice(3), ...list.slice(0, 3)];
  SEERR.trendLists = { movie: { day: movie, week: week(movie) }, tv: { day: tv, week: week(tv) } };
}

const seerrPermissions = () => SEERR.permissions ?? (Number(process.env.MOCK_SEERR_PERMISSIONS) || 1072); // 1072 = anfragen (32) + verwalten (16) + 4K (1024)
/**
 * Seerr-Benutzer einer Sitzung wie /auth/me: "demo" gehoert zum Jellyfin-Testbenutzer (oder zu der Kennung, die /__debug/identity stellt: eine
 * fremde Sitzung), "demo2" zu einem zweiten Jellyfin-Konto.
 */
const seerrMe = (user) =>
  user === 'demo2'
    ? { id: 2, displayName: 'Demo Zwei', jellyfinUserId: 'jf-demo2', jellyfinUsername: 'demo2', permissions: seerrPermissions() }
    : { id: 1, displayName: 'Demo', jellyfinUserId: SEERR.identity ?? USER.Id, jellyfinUsername: USER.Name, permissions: seerrPermissions() };
const SEERR_SID = SEERR.sid;
const SEERR_INITIAL = { statuses: [...SEERR.statuses], quota: JSON.stringify(SEERR.quota) };

/**
 * Stand eines Titels wie bei Seerr 3.5.1 aus seinen Anfragen: gestellter Stand (SEERR.media) geht vor; 4 bis 6 (teilweise da, da, gesperrt)
 * gilt fest; sonst (auch geloescht, 7) die letzte lebende Anfrage (nicht entfernt, nicht abgelehnt): wartet 2, genehmigt 3, gescheitert 3,
 * abgeschlossen 5; ohne Anfrage der feste Stand (SEERR.statuses, undefined = unbekannt).
 */
function seerrMediaStatus(type, id) {
  const key = `${type}:${id}`;
  if (SEERR.media.has(key)) return SEERR.media.get(key);
  const base = SEERR.statuses.get(key);
  const live = SEERR.requests.filter((r) => r.mediaType === type && r.mediaId === id && !r.deleted && r.status !== 3);
  if (!live.length || (base >= 4 && base !== 7)) return base; // ein geloeschter Titel (7) ist nach einer neuen Anfrage wieder "angefragt"
  return { 1: 2, 2: 3, 4: 3, 5: 5 }[live[live.length - 1].status] ?? base;
}
const withMediaInfo = (r) => {
  const st = seerrMediaStatus(r.mediaType, r.id);
  return st ? { ...r, mediaInfo: { status: st } } : { ...r };
};
const seerrUserName = (id) => ({ 1: 'Demo', 2: 'Demo Zwei' })[id] ?? 'ben';
/** Seerr-Benutzer einer Sitzung: demo 1, demo2 2. */
const seerrUserId = (sessionUser) => (sessionUser === 'demo2' ? 2 : 1);
/** Rechte: Administrator (2), Anfragen verwalten (16) oder Anfragen ansehen (16384) sehen alle Anfragen; ohne nur die eigenen (wie Seerr). */
const seesAllRequests = () => (seerrPermissions() & (2 | 16 | 16384)) !== 0;
/** Eine Anfrage, wie Seerr sie in GET /request und als Antwort auf POST /request liefert. */
function seerrRequestDto(r) {
  return {
    id: r.id,
    status: r.status,
    is4k: false,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    type: r.mediaType,
    media: { id: r.media.id, tmdbId: r.mediaId, mediaType: r.mediaType, status: seerrMediaStatus(r.mediaType, r.mediaId) ?? 1, status4k: 1 },
    seasons: (Array.isArray(r.seasons) ? r.seasons : []).map((n) => ({ seasonNumber: n, status: r.readySeasons.includes(n) ? 5 : r.status })),
    modifiedBy: r.modifiedBy ? { id: r.modifiedBy, displayName: seerrUserName(r.modifiedBy) } : null,
    requestedBy: { id: r.requestedBy, displayName: seerrUserName(r.requestedBy) }
  };
}
/** Neue Anfrage im Testserver (POST /request und /__debug/requests); Zeitstempel steigen je Anfrage um eine Minute. */
function addSeerrRequest({ mediaType, mediaId, seasons, status = 1, requestedBy = 1 }) {
  const id = SEERR.requests.length + 1;
  const at = new Date(Date.UTC(2026, 10, 16, 12, 0) + id * 60000).toISOString();
  const r = { id, status, mediaType, mediaId, seasons: seasons ?? null, readySeasons: [], deleted: false, modifiedBy: null, requestedBy, createdAt: at, updatedAt: at, media: { id: mediaId, tmdbId: mediaId, mediaType, status: 2 } };
  SEERR.requests.push(r);
  return r;
}
/** Anfrage geaendert: updatedAt nach allen bisherigen Zeitstempeln (Sortierung "zuletzt geaendert"). */
function touchSeerrRequest(r) {
  const latest = Math.max(...SEERR.requests.map((x) => Date.parse(x.updatedAt)));
  r.updatedAt = new Date(latest + 1000).toISOString();
}
// Filter der Liste wie bei Seerr (GET /request?filter=...): Stand der Anfrage bzw. des Titels
const REQUEST_FILTERS = {
  all: () => true,
  pending: (r) => r.status === 1,
  approved: (r) => r.status === 2,
  declined: (r) => r.status === 3,
  failed: (r) => r.status === 4,
  completed: (r) => r.status === 5,
  processing: (r, ms) => r.status === 2 && ms === 3,
  available: (r, ms) => ms === 5 || ms === 4,
  unavailable: (r, ms) => r.status === 2 && ms !== 5 && ms !== 4,
  deleted: (r, ms) => ms === 7
};

/** Seerr wie beim Start (POST /__debug/reset?seerr=1): Anfragen, Staende, Zaehler, Ausfall, Rechte, Sitzung, Kontingent. */
function resetSeerr() {
  SEERR.requests.length = 0;
  SEERR.statuses = new Map(SEERR_INITIAL.statuses);
  SEERR.media.clear();
  SEERR.mode = 'ok';
  SEERR.expired = false;
  SEERR.permissions = null;
  SEERR.identity = null;
  SEERR.sid = SEERR_SID;
  SEERR.requestDelay = 0;
  SEERR.quota = JSON.parse(SEERR_INITIAL.quota);
  for (const k of Object.keys(SEERR.counters)) SEERR.counters[k] = 0;
  seerrGate.release();
}
const seerrGate = makeGate();

/** Steuerung der Seerr-Seite (Namen wie beim Apple-Testserver); null, wenn der Pfad keine Seerr-Steuerung ist. */
function seerrDebug(p, q) {
  const int = (k) => (/^\d+$/.test(q.get(k) ?? '') ? Number(q.get(k)) : null);
  if (p === '/__debug/mode') {
    const want = ['ok', 'down', 'expired'].includes(q.get('set')) ? q.get('set') : 'ok';
    if (want === 'expired') SEERR.sid = `mock-seerr-sid-${Date.now().toString(36)}`; // alle bisherigen Sitzungen ungueltig, erst eine neue Anmeldung gilt
    SEERR.mode = want === 'down' ? 'down' : 'ok';
    return [200, { mode: SEERR.mode }];
  }
  if (p === '/__debug/permissions') {
    SEERR.permissions = int('set');
    return [200, { permissions: seerrPermissions() }];
  }
  if (p === '/__debug/identity') {
    SEERR.identity = q.get('jellyfin') === 'none' ? '' : q.get('jellyfin') || null; // "none": der Seerr-Benutzer hat kein Jellyfin-Konto
    return [200, { jellyfinUserId: SEERR.identity ?? USER.Id }];
  }
  if (p === '/__debug/request') {
    const r = SEERR.requests[(int('id') ?? 0) - 1];
    if (!r || int('status') == null) return [400, { message: 'id und status angeben' }];
    r.status = int('status');
    touchSeerrRequest(r);
    return [200, { id: r.id, status: r.status }];
  }
  if (p === '/__debug/requests') {
    const n = Math.max(0, Math.min(2000, int('count') ?? 0));
    const k = Math.max(0, Math.min(n, int('open') ?? 0));
    const first = SEERR.requests.length;
    const by = int('by') ?? 1; // Anfragender: 1 demo, 2 demo2, 3 ein anderer Benutzer ("ben")
    for (let i = 0; i < n; i++) addSeerrRequest({ mediaType: 'movie', mediaId: 90001 + first + i, status: i < k ? 1 : 5, requestedBy: by });
    return [200, { requests: SEERR.requests.length }];
  }
  if (p === '/__debug/season') {
    const r = SEERR.requests[(int('id') ?? 0) - 1];
    if (!r || int('season') == null) return [400, { message: 'id und season angeben' }];
    if (!r.readySeasons.includes(int('season'))) r.readySeasons.push(int('season'));
    if (Array.isArray(r.seasons) && r.seasons.length && r.seasons.every((s) => r.readySeasons.includes(s))) r.status = 5;
    return [200, { id: r.id, status: r.status, readySeasons: r.readySeasons }];
  }
  if (p === '/__debug/media') {
    if (int('tmdb') == null) return [400, { message: 'tmdb angeben' }];
    const key = `${q.get('type') === 'tv' ? 'tv' : 'movie'}:${int('tmdb')}`;
    if (int('status') != null) SEERR.media.set(key, int('status'));
    else SEERR.media.delete(key);
    return [200, { media: Object.fromEntries(SEERR.media) }];
  }
  return null;
}

async function handleSeerr(req, res, p, q, method) {
  const sub = p.slice('/api/v1'.length);
  const json = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  state.log.push({ at: `seerr:${method} ${sub}`, ...(q.get('language') ? { language: q.get('language') } : {}) });
  SEERR.counters.apiRequests++;
  const cookie = req.headers.cookie ?? '';
  // Jede Anmeldung hat ihre eigene Sitzung: "demo" die Grundsitzung, "demo2" eine zweite (anderer Seerr-Benutzer, anderes Jellyfin-Konto)
  const sidValue = /(?:^|;\s*)connect\.sid=([^;]+)/.exec(cookie)?.[1] ?? '';
  const sessionUser = sidValue === SEERR.sid ? 'demo' : sidValue === `${SEERR.sid}-zwei` ? 'demo2' : null;
  const sessionOk = !!sessionUser;
  if (sessionOk && sub !== '/auth/logout') SEERR.counters.sessionRequests++;
  if (SEERR.mode === 'down') return json(503, { message: 'Service Unavailable' });
  if (sub === '/status') return json(200, { version: '2.7.0-mock', commitTag: 'mock', updateAvailable: false });
  if (sub === '/auth/jellyfin' && method === 'POST') {
    const b = await readBody(req);
    // "demo" (das Konto des Testbenutzers) und "demo2" (ein zweites Jellyfin-Konto, etwa fuer ein anderes Profil), Passwort jeweils "demo"
    if ((b.username === 'demo' || b.username === 'demo2') && b.password === 'demo') {
      const second = b.username === 'demo2';
      return json(200, seerrMe(b.username), { 'set-cookie': `connect.sid=${SEERR.sid}${second ? '-zwei' : ''}; Path=/; HttpOnly` });
    }
    return json(401, { message: 'Invalid credentials' });
  }
  if (SEERR.expired) return json(401, { message: 'Unauthorized' });
  const viaKey = req.headers['x-api-key'] === SEERR.apiKey;
  const authed = viaKey || sessionOk;
  // Eine Sitzung, die /__debug/mode?set=expired ungueltig gemacht hat, ist abgelaufen (401); ohne jede Anmeldung 403 wie bisher
  if (!authed) return /connect\.sid=mock-seerr-sid/.test(cookie) ? json(401, { message: 'Unauthorized' }) : json(403, { message: 'You do not have permission to access this endpoint' });
  if (sub === '/auth/logout' && method === 'POST') {
    SEERR.counters.logouts++;
    return json(200, { status: 'ok' });
  }
  if (sub === '/auth/me') return json(200, viaKey ? { id: 1, displayName: 'Schluessel-Konto', permissions: seerrPermissions() } : seerrMe(sessionUser));
  let um;
  if ((um = /^\/user\/(\d+)\/quota$/.exec(sub)) && method === 'GET') {
    const part = (k) => {
      const qq = SEERR.quota[k];
      return { days: qq.days, limit: qq.limit, used: qq.used, remaining: qq.limit ? Math.max(0, qq.limit - qq.used) : undefined, restricted: !!qq.limit && qq.used >= qq.limit };
    };
    return json(200, { movie: part('movie'), tv: part('tv') });
  }
  if (sub === '/search') {
    const term = (q.get('query') ?? '').toLowerCase();
    const results = SEERR.catalog.filter((r) => (r.title ?? r.name ?? '').toLowerCase().includes(term)).map(withMediaInfo);
    return json(200, { page: 1, totalPages: 1, totalResults: results.length, results });
  }
  if (sub === '/discover/trending' && method === 'GET') {
    SEERR.counters.trendRequests++;
    if (SEERR.trendingDelay) await new Promise((r) => setTimeout(r, SEERR.trendingDelay));
    if (SEERR.trendingError) return json(500, { message: 'Mock: Trends nicht verfuegbar' });
    const page = Math.max(1, Number(q.get('page')) || 1);
    const kind = q.get('mediaType');
    // Aktuelles Seerr nimmt mediaType (movie|tv) und timeWindow (day|week) entgegen; aelteres (SEERR.old, MOCK_SEERR_OLD) uebergeht beides
    if ((kind === 'movie' || kind === 'tv') && !SEERR.old) {
      const full = SEERR.trendLists[kind][q.get('timeWindow') === 'week' ? 'week' : 'day'];
      const results = full.slice((page - 1) * 20, page * 20).map(withMediaInfo);
      return json(200, { page, totalPages: Math.max(1, Math.ceil(full.length / 20)), totalResults: full.length, results });
    }
    const per = 4;
    const results = SEERR.trending.slice((page - 1) * per, page * per).map(withMediaInfo);
    return json(200, { page, totalPages: Math.ceil(SEERR.trending.length / per), totalResults: SEERR.trending.length, results });
  }
  if ((um = /^\/person\/(\d+)(\/combined_credits)?$/.exec(sub)) && method === 'GET') {
    const person = SEERR.people.get(Number(um[1]));
    if (!person) return json(404, { message: 'Unable to retrieve person.' });
    const { cast, crew, ...info } = person;
    if (!um[2]) return json(200, info);
    return json(200, { id: person.id, cast: cast.map(withMediaInfo), crew: crew.map(withMediaInfo) });
  }
  const dm = /^\/(movie|tv)\/(\d+)$/.exec(sub);
  if (dm && method === 'GET') {
    // Titel der Anfragen, die /__debug/requests anlegt (TMDB 90001 und folgende): ein erfundener Eintrag mit Namen und Jahr
    const made = Number(dm[2]) >= 90001 && Number(dm[2]) <= 99999 ? { id: Number(dm[2]), mediaType: dm[1], [dm[1] === 'movie' ? 'title' : 'name']: `Anfrage ${dm[2]}`, [dm[1] === 'movie' ? 'releaseDate' : 'firstAirDate']: '2025-05-01', overview: 'Ein Titel aus den gestellten Anfragen.' } : null;
    const entry = SEERR.catalog.find((r) => r.mediaType === dm[1] && String(r.id) === dm[2]) ?? SEERR.trending.find((r) => r.mediaType === dm[1] && String(r.id) === dm[2]) ?? made;
    if (!entry) return json(404, { message: 'Not found' });
    if (entry.id === 9999) return json(500, { message: 'Mock: Details nicht verfuegbar' });
    const key = `${entry.mediaType}:${entry.id}`;
    const st = seerrMediaStatus(entry.mediaType, entry.id);
    const mediaInfo = SEERR.mediaIds.has(key) ? { id: SEERR.mediaIds.get(key), status: st ?? 1 } : st ? { status: st } : null;
    return json(200, { ...entry, ...(SEERR.details[key] ?? {}), ...(mediaInfo ? { mediaInfo } : {}) });
  }
  if (sub === '/issue' && method === 'POST') {
    const b = await readBody(req);
    state.log.push({ at: 'seerr:issue-body', ...b });
    if (SEERR.issueDelay) await new Promise((r) => setTimeout(r, SEERR.issueDelay)); // langsames Seerr: Antwort erst nach so vielen ms
    if (SEERR.issueForbidden) return json(403, { message: 'You do not have permission to access this endpoint' });
    if (![1, 2, 3, 4].includes(b.issueType) || !Number.isInteger(b.mediaId) || typeof b.message !== 'string' || !b.message) return json(400, { message: 'Invalid issue body' });
    if (![...SEERR.mediaIds.values()].includes(b.mediaId)) return json(404, { message: 'Media does not exist.' });
    const created = { id: SEERR.issues.length + 1, issueType: b.issueType, status: 1, problemSeason: b.problemSeason ?? 0, problemEpisode: b.problemEpisode ?? 0, message: b.message, media: { id: b.mediaId } };
    SEERR.issues.push(created);
    return json(201, created);
  }
  if (sub === '/request' && method === 'POST') {
    const b = await readBody(req);
    state.log.push({ at: 'seerr:request-body', ...b });
    if (!['movie', 'tv'].includes(b.mediaType) || !Number.isFinite(b.mediaId)) return json(400, { message: 'Invalid request body' });
    if (b.mediaId === 9999) return json(403, { message: 'Quota exceeded' });
    const st = seerrMediaStatus(b.mediaType, b.mediaId);
    // Wie Seerr: gesperrte Titel (6) nicht anfragbar; wartende, bearbeitete und vorhandene schon angefragt (409); geloeschte (7) wieder anfragbar
    if (st === 6) return json(403, { message: 'This media is blocklisted.' });
    if ([2, 3, 5].includes(st)) return json(409, { message: 'Request for this media already exists' });
    const kindQuota = SEERR.quota[b.mediaType];
    if (kindQuota.limit && kindQuota.used >= kindQuota.limit) return json(403, { message: 'Quota exceeded' });
    if (kindQuota.limit) kindQuota.used++;
    const created = addSeerrRequest({ mediaType: b.mediaType, mediaId: b.mediaId, seasons: b.mediaType === 'tv' ? (Array.isArray(b.seasons) ? b.seasons : b.seasons === 'all' ? 'all' : null) : null, requestedBy: seerrUserId(sessionUser) });
    return json(201, seerrRequestDto(created));
  }
  if (sub === '/request' && method === 'GET') {
    SEERR.counters.listRequests++;
    await seerrGate.wait(); // festgehalten bis zur Freigabe (POST /__debug/delay?requests=<s> oder /__debug/reset?seerr=1)
    await sleep(SEERR.requestDelay);
    const filter = REQUEST_FILTERS[q.get('filter') ?? 'all'] ?? REQUEST_FILTERS.all;
    // Ohne das Recht, alle zu sehen, liefert Seerr nur die eigenen, gleich was verlangt ist
    const by = seesAllRequests() ? Number(q.get('requestedBy')) || null : seerrUserId(sessionUser);
    const sortKey = q.get('sort') === 'modified' ? 'updatedAt' : 'createdAt';
    const list = SEERR.requests
      .filter((r) => !r.deleted && (!by || r.requestedBy === by) && filter(r, seerrMediaStatus(r.mediaType, r.mediaId)))
      .sort((a, b) => (a[sortKey] < b[sortKey] ? 1 : a[sortKey] > b[sortKey] ? -1 : b.id - a.id))
      .map(seerrRequestDto);
    const take = Math.max(1, Number(q.get('take')) || 10); // wie Seerr: ohne Angabe 10
    const skip = Math.max(0, Number(q.get('skip')) || 0);
    return json(200, { pageInfo: { pages: Math.ceil(list.length / take), pageSize: take, results: list.length, page: Math.floor(skip / take) + 1 }, results: list.slice(skip, skip + take) });
  }
  if ((um = /^\/request\/(\d+)(?:\/(approve|decline|retry))?$/.exec(sub)) && (method === 'POST' || method === 'DELETE')) {
    const r = SEERR.requests[Number(um[1]) - 1];
    if (!r || r.deleted) return json(404, { message: 'Request not found.' });
    const manage = (seerrPermissions() & (2 | 16)) !== 0; // Administrator oder Anfragen verwalten
    if (method === 'DELETE') {
      // Ohne "verwalten" nur eigene, solange sie warten (Seerr antwortet sonst mit 401, wie am echten Seerr 3.5.1 gemessen)
      if (!manage && (r.status !== 1 || r.requestedBy !== seerrUserId(sessionUser))) return json(401, { message: 'You do not have permission to delete this request.' });
      r.deleted = true;
      res.writeHead(204);
      return res.end();
    }
    if (!um[2]) return json(404, { message: 'Unknown action.' });
    if (!manage) return json(403, { message: 'You do not have permission to do this.' });
    r.status = { approve: 2, decline: 3, retry: 2 }[um[2]];
    touchSeerrRequest(r);
    // Wer entschieden hat (modifiedBy): der Benutzer der Sitzung (1) oder, im Test, ein anderer Verwalter aus der Kopfzeile X-Mock-Actor
    if (um[2] !== 'retry') r.modifiedBy = /^\d+$/.test(req.headers['x-mock-actor'] ?? '') ? Number(req.headers['x-mock-actor']) : seerrUserId(sessionUser);
    return json(200, seerrRequestDto(r));
  }
  return json(404, { message: `Mock-Seerr: ${method} ${sub} nicht implementiert` });
}

// ---------- Steuerung fuer Tests (/__debug/...), Namen und Bedeutung wie beim Apple-Testserver ----------
// Anfangsstand von Gesehen, Favoriten und Positionen fuer /__debug/reset?all=1
const INITIAL = { played: new Set(state.played), fav: new Set(state.fav), progress: new Map(state.progress) };
const remoteTicks = (r) => Math.round((r.at + (Date.now() - r.since) / 1000) * TICKS);
/** Gestellte Sitzungen anderer Geraete in der Form von GET /Sessions. */
function remoteSessions() {
  return state.remote.map((r) => {
    const it = items.get(r.item) ?? {};
    const playing = Object.fromEntries(['Id', 'Name', 'Type', 'SeriesName', 'SeriesId', 'IndexNumber', 'ParentIndexNumber', 'RunTimeTicks'].filter((k) => k in it).map((k) => [k, it[k]]));
    return {
      Id: r.id,
      UserId: r.user,
      UserName: 'demo',
      Client: r.client,
      DeviceName: r.device,
      DeviceId: `dev-${r.id}`,
      LastActivityDate: new Date(Date.now() - r.idle * 1000).toISOString(),
      SupportsRemoteControl: r.control,
      SupportsMediaControl: r.control,
      NowPlayingItem: Object.keys(playing).length ? playing : null,
      PlayState: { PositionTicks: remoteTicks(r), IsPaused: false, PlayMethod: 'DirectPlay' }
    };
  });
}

/**
 * Steuerung der Tests: liefert [Status, Antwort]. Zeiten in Sekunden wie beim Apple-Testserver.
 *   GET  /__debug/state                       Protokoll (letzte 60), Gesehen, Positionen, Stoerungen, Quick Connect, Sitzungen, Seerr-Zaehler
 *   POST /__debug/reset[?all=1][&seerr=1]     Protokoll leeren, Sitzung gueltig, Quick Connect aus; all: Gesehen/Favoriten/Positionen; seerr: Seerr wie beim Start
 *   POST /__debug/delay?lists=<s>|hold&images=<s>&plan=<s>&reports=<s>&auth=<s>&requests=<s>|hold
 *        lists: alle Listen (hold: festhalten bis zur Freigabe, hoechstens 120 s), plan: PlaybackInfo, reports: Ende der Wiedergabe (/Stopped),
 *        auth: Anmeldung mit Passwort (hoechstens 30 s), requests: Liste der Seerr-Anfragen (hoechstens 30 s; hold wie bei lists)
 *   POST /__debug/fault?lists=<400-599|invalid|empty|drop|off>&images=<...>&count=<n>   naechste n Antworten (ohne count alle) scheitern
 *   POST /__debug/fault?clear=1               alle Stoerungen, Verzoegerungen von Listen/Bildern/Anmeldung und Quick-Connect-Schalter aus
 *   POST /__debug/expire                      Sitzung abgelaufen (401) bis zur naechsten Anmeldung
 *   POST /__debug/quickconnect?hold=1|0&gone=1|0&disabled=1|0
 *   POST /__debug/session?device=&item=&at=<s>&user=other&control=0&idle=<s>&client=   bzw. ?clear=1
 *   Seerr: /__debug/mode?set=ok|down|expired, /__debug/permissions?set=<Bits>, /__debug/identity?jellyfin=<Kennung>,
 *          /__debug/request?id=&status=, /__debug/requests?count=&open=, /__debug/season?id=&season=, /__debug/media?tmdb=&status=[&type=tv]
 */
function debugControl(p, q) {
  const seerr = seerrDebug(p, q);
  if (seerr) return seerr;
  const secs = (v, max = Infinity) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n < 0) throw new Error(`keine Sekundenangabe: ${v}`);
    return Math.round(Math.min(n, max) * 1000);
  };
  if (p === '/__debug/state') {
    return [200, {
      log: state.log.slice(-60),
      played: [...state.played],
      fav: [...state.fav],
      progress: Object.fromEntries(state.progress),
      expired: state.expired,
      qc: { ...state.qc },
      faults: Object.fromEntries(Object.entries(state.faults).map(([k, v]) => [k, v.how])),
      delays: { ...state.delays },
      listsHeld: listGate.held,
      sessions: remoteSessions(),
      seerr: { mode: SEERR.mode, permissions: seerrPermissions(), requestsHeld: seerrGate.held, requests: SEERR.requests.filter((r) => !r.deleted).map(seerrRequestDto), issues: SEERR.issues, ...SEERR.counters }
    }];
  }
  if (p === '/__debug/reset') {
    state.log.length = 0;
    state.expired = false;
    Object.assign(state.qc, { hold: false, gone: false, disabled: false, authorized: false });
    if (q.get('all')) {
      state.played = new Set(INITIAL.played);
      state.fav = new Set(INITIAL.fav);
      state.progress = new Map(INITIAL.progress);
      state.remote.length = 0;
    }
    if (q.get('seerr')) resetSeerr();
    return [200, { ok: true }];
  }
  if (p === '/__debug/delay') {
    try {
      if (q.has('reports')) state.delays.stopped = secs(q.get('reports'));
      if (q.has('plan')) state.delays.playbackInfo = secs(q.get('plan'));
      if (q.has('images')) state.delays.images = secs(q.get('images'));
      if (q.has('auth')) state.delays.auth = secs(q.get('auth'), 30);
      if (q.has('lists')) {
        if (q.get('lists') === 'hold') listGate.hold();
        else {
          state.delays.lists = secs(q.get('lists'));
          listGate.release();
        }
      }
      if (q.has('requests')) {
        if (q.get('requests') === 'hold') seerrGate.hold();
        else {
          SEERR.requestDelay = secs(q.get('requests'), 30);
          seerrGate.release();
        }
      }
    } catch (e) {
      return [400, { error: `${e.message}; lists, images, plan, reports, auth, requests: je <Sekunden>, lists und requests auch hold` }];
    }
    return [200, { ok: true, delays: { ...state.delays }, listsHeld: listGate.held, requests: SEERR.requestDelay, requestsHeld: seerrGate.held }];
  }
  if (p === '/__debug/fault') {
    if (q.get('clear')) {
      state.faults = {};
      Object.assign(state.delays, { lists: 0, images: 0, auth: 0 });
      Object.assign(state.qc, { hold: false, gone: false, disabled: false, authorized: false });
      listGate.release();
      return [200, { ok: true, faults: {} }];
    }
    const count = /^\d+$/.test(q.get('count') ?? '') ? Number(q.get('count')) : null;
    for (const kind of ['lists', 'images']) {
      const how = q.get(kind);
      if (how == null) continue;
      if (how === 'off' || count === 0) delete state.faults[kind];
      else if (['invalid', 'empty', 'drop'].includes(how) || (/^\d{3}$/.test(how) && Number(how) >= 400 && Number(how) <= 599)) state.faults[kind] = { how, left: count };
      else return [400, { error: 'lists/images: <HTTP-Status 400-599>, invalid, empty, drop oder off' }];
    }
    return [200, { ok: true, faults: Object.fromEntries(Object.entries(state.faults).map(([k, v]) => [k, v.how])) }];
  }
  if (p === '/__debug/expire') {
    state.expired = true;
    return [200, { ok: true }];
  }
  if (p === '/__debug/quickconnect') {
    for (const k of ['hold', 'gone', 'disabled']) if (q.has(k)) state.qc[k] = q.get(k) === '1';
    return [200, { ok: true, hold: state.qc.hold, gone: state.qc.gone, disabled: state.qc.disabled, authorized: state.qc.authorized }];
  }
  if (p === '/__debug/session') {
    if (q.get('clear')) {
      state.remote.length = 0;
      return [200, { ok: true, sessions: 0 }];
    }
    const item = q.get('item') || [...items.values()].find((i) => i.Type === 'Movie')?.Id;
    if (!items.has(item)) return [400, { error: 'item: Id eines Eintrags' }];
    state.remote.push({ id: `remote${state.remote.length + 1}`, device: q.get('device') || 'Wohnzimmer Apple TV', item, at: Number(q.get('at')) || 600, since: Date.now(), user: q.get('user') === 'other' ? 'someone-else' : USER.Id, control: q.get('control') !== '0', idle: Number(q.get('idle')) || 0, client: q.get('client') || 'Jellycloud' });
    return [200, { ok: true, sessions: state.remote.length, item }];
  }
  return [404, { error: `Mock: ${p} ist keine Steuerung` }];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const q = url.searchParams;
  const method = req.method;
  let m;

  // CORS wie ein echter Jellyfin-Server (Standard: alle Quellen erlaubt): die Web-/Handy-Fassung ruft den Server direkt aus der Seite auf (tools/shots/web-mode.js)
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-emby-authorization, x-emby-token, x-api-key');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Steuerung fuer Tests (ohne Anmeldung, Namen wie beim Apple-Testserver Tools/mock_server.py; GET oder POST)
  if (p.startsWith('/__debug/')) {
    const [status, body] = debugControl(p, q);
    return send(res, status, body);
  }
  if (p.startsWith('/api/v1/')) return handleSeerr(req, res, p, q, method);
  // Die App spricht TMDB nie direkt an (Vorgabe: Top 10 und Bilder nur ueber Seerr); jede Anfrage an die TMDB-API wird gezaehlt (tmdbRequests, muss 0 bleiben)
  if (p.startsWith('/3/')) {
    SEERR.counters.tmdbRequests++;
    return send(res, 410, { status_message: 'TMDB-API im Testserver nicht vorhanden' });
  }

  // Oeffentlich
  if (p === '/System/Info/Public') return send(res, 200, { ServerName: 'Mock Jellyfin', Version: '10.10.3', Id: SERVER_ID, ProductName: 'Jellyfin Server' });
  if (p === '/QuickConnect/Enabled') return send(res, 200, !state.qc.disabled);
  if (p === '/QuickConnect/Initiate' && method === 'POST') {
    if (state.qc.disabled) return send(res, 401, 'Quick connect is disabled');
    state.qcPolls = 0;
    state.qc.started = Date.now();
    state.qc.authorized = false;
    return send(res, 200, { Secret: 'mock-secret', Code: '482913', Authenticated: false });
  }
  if (p === '/QuickConnect/Connect') {
    if (state.qc.gone) return send(res, 404, { title: 'Not Found' });
    // bestaetigt von einem anderen Geraet (Authorize) oder, ohne hold, von selbst bei der zweiten Abfrage
    const polls = ++state.qcPolls;
    return send(res, 200, { Authenticated: state.qc.authorized || (!state.qc.hold && polls >= 2), Secret: 'mock-secret' });
  }
  if (p === '/Users/AuthenticateWithQuickConnect' && method === 'POST') {
    state.expired = false;
    return send(res, 200, authResult());
  }
  if (p === '/Users/AuthenticateByName' && method === 'POST') {
    const b = await readBody(req);
    await sleep(state.delays.auth);
    if (b.Username === 'demo' && b.Pw === 'demo') {
      state.expired = false;
      return send(res, 200, authResult());
    }
    return send(res, 401, { Message: 'Invalid username or password' });
  }
  // Bilder sind bei Jellyfin ohne Anmeldung abrufbar
  if ((m = /^\/Items\/([0-9a-f]+)\/Images\/(\w+)/.exec(p))) {
    await sleep(state.delays.images);
    const how = takeFault('images');
    if (how) return sendFault(how, req, res);
    const item = items.get(m[1]);
    if (!item) return send(res, 404, '');
    return send(res, 200, imageSvg(item, m[2]), 'image/svg+xml');
  }
  if ((m = /^\/Users\/[0-9a-f]+\/Images\/Primary/.exec(p))) return send(res, 404, '');

  // Test-Hilfen ohne Anmeldung
  if (p === '/__log') return send(res, 200, state.log);
  if (p === '/__reset') {
    state.log.length = 0;
    return send(res, 200, {});
  }

  if (!authed(req)) return send(res, 401, { Message: 'Unauthorized' });

  // Ein anderes Geraet bestaetigt den Code, wie Jellyfin (QuickConnectController): angemeldet noetig; ausgeschaltet 401; Code unbekannt oder
  // aelter als zehn Minuten "Unable to find request" (404); schon bestaetigt "Request is already authorized" (500); sonst true
  if (p === '/QuickConnect/Authorize' && method === 'POST') {
    state.log.push({ at: 'QuickConnect/Authorize', userId: q.get('userId') }); // der Code selbst wird nicht protokolliert
    if (state.qc.disabled) return send(res, 401, 'Quick connect is disabled');
    const known = state.qc.started && Date.now() - state.qc.started <= 600000 && !state.qc.gone;
    if (!known || q.get('code') !== '482913') return send(res, 404, 'Unable to find request');
    if (state.qc.authorized) return send(res, 500, 'Request is already authorized');
    state.qc.authorized = true;
    return send(res, 200, true);
  }
  // Bandbreitenmessung wie Jellyfin (GET /Playback/BitrateTest?Size=<Bytes>); MOCK_BITRATE_MBPS bremst wie eine langsame Leitung
  if (p === '/Playback/BitrateTest' && method === 'GET') {
    const size = Math.max(0, Math.min(Number(q.get('Size')) || 0, 100_000_000));
    state.log.push({ at: 'BitrateTest', size });
    const mbps = Number(process.env.MOCK_BITRATE_MBPS) || 0;
    if (mbps) await sleep(Math.round((size * 8) / (mbps * 1000)));
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size, 'cache-control': 'no-store' });
    return res.end(Buffer.alloc(size));
  }
  // "Auf diesem Geraet fortsetzen": Sitzungen anderer Geraete desselben Kontos (gestellt mit /__debug/session). Ohne Verwaltungsrechte nur diese,
  // mit Verwaltung wie bisher die Sitzungsliste der Verwaltung; der Stopp merkt sich die Stelle am Eintrag und beendet die Sitzung.
  if (p === '/Sessions' && method === 'GET' && !state.admin && state.remote.length) return send(res, 200, remoteSessions());
  if ((m = /^\/Sessions\/([\w-]+)\/Playing\/Stop$/.exec(p)) && method === 'POST' && state.remote.some((r) => r.id === m[1])) {
    const r = state.remote.find((x) => x.id === m[1]);
    state.remote.splice(state.remote.indexOf(r), 1);
    const ticks = remoteTicks(r);
    state.progress.set(r.item, ticks);
    state.log.push({ at: 'RemoteStop', SessionId: r.id, ItemId: r.item, PositionTicks: ticks });
    return send(res, 204, '');
  }

  if (p === '/System/Endpoint') {
    state.log.push({ at: '/System/Endpoint' });
    if (state.limits.endpointMissing) return send(res, 404, { Message: 'nicht vorhanden' });
    return send(res, 200, { IsLocal: false, IsInNetwork: state.limits.local });
  }
  if (p === '/System/Configuration') {
    state.log.push({ at: '/System/Configuration' });
    if (state.limits.serverForbidden) return send(res, 403, { Message: 'Forbidden' });
    return send(res, 200, { ServerName: 'Mock Jellyfin', RemoteClientBitrateLimit: state.limits.server });
  }
  // Abmelden am Server (wie Jellyfin: 204); protokolliert, damit sich "Profil entfernen meldet es am Server ab" pruefen laesst
  if (p === '/Sessions/Logout' && method === 'POST') {
    state.log.push({ at: '/Sessions/Logout' });
    return send(res, 204, '');
  }
  if (p === '/Users/Me') {
    state.log.push({ at: '/Users/Me' });
    return send(res, 200, { ...USER, ServerId: SERVER_ID, Policy: { IsAdministrator: !!state.admin, RemoteClientBitrateLimit: state.limits.user }, Configuration: { AudioLanguagePreference: 'ger', SubtitleMode: 'Default' } });
  }
  // weitere Bibliotheken (state.extraViews, von Szenarien gesetzt: zweite Film-Bibliothek, Kollektionen), hinter den beiden festen
  if (p === '/UserViews' || /^\/Users\/[0-9a-f]+\/Views$/.test(p)) return send(res, 200, { Items: [MOVIES_VIEW, SHOWS_VIEW, ...state.extraViews], TotalRecordCount: 2 + state.extraViews.length });
  if (p === '/Items' && method === 'GET') {
    if (await listPrelude(req, res)) return;
    if (state.delays.items) await new Promise((r) => setTimeout(r, state.delays.items));
    const body = JSON.stringify(listItems(q));
    state.bytes.items += Buffer.byteLength(body);
    return send(res, 200, body);
  }
  if (p === '/Items/Latest') {
    if (await listPrelude(req, res)) return;
    const parent = q.get('parentId');
    const list = (children.get(parent) ?? []).map((i) => items.get(i)).sort((a, b) => (a.DateCreated < b.DateCreated ? 1 : -1)).slice(0, Number(q.get('limit') ?? 20));
    return send(res, 200, list.map((i) => limitImages(decorate(i), q)));
  }
  if (p === '/UserItems/Resume' || /\/Items\/Resume$/.test(p)) {
    if (await listPrelude(req, res)) return;
    const list = [...state.progress.entries()].filter(([id, v]) => v > 0 && !state.played.has(id)).map(([id]) => items.get(id)).filter(Boolean);
    return send(res, 200, { Items: list.map((i) => limitImages(decorate(i), q)), TotalRecordCount: list.length });
  }
  if (p === '/Shows/NextUp') {
    if (await listPrelude(req, res)) return;
    const sid = q.get('seriesId');
    const eps = [...items.values()].filter((i) => i.Type === 'Episode' && (!sid || i.SeriesId === sid) && !state.played.has(i.Id));
    const bySeries = new Map();
    for (const e of eps) if (!bySeries.has(e.SeriesId)) bySeries.set(e.SeriesId, e);
    const list = [...bySeries.values()].slice(0, Number(q.get('limit') ?? 16));
    return send(res, 200, { Items: list.map((i) => limitImages(decorate(i), q)), TotalRecordCount: list.length });
  }
  if ((m = /^\/Shows\/([0-9a-f]+)\/Seasons$/.exec(p))) return send(res, 200, { Items: (children.get(m[1]) ?? []).map((i) => decorate(items.get(i))), TotalRecordCount: 1 });
  if ((m = /^\/Shows\/([0-9a-f]+)\/Episodes$/.exec(p))) {
    const seasonId = q.get('seasonId');
    let eps = [...items.values()].filter((i) => i.Type === 'Episode' && i.SeriesId === m[1]);
    if (seasonId) eps = eps.filter((e) => e.SeasonId === seasonId);
    return send(res, 200, { Items: eps.map((i) => decorate(i)), TotalRecordCount: eps.length });
  }
  if ((m = /^\/Items\/([0-9a-f]+)\/Similar$/.exec(p))) {
    const it = items.get(m[1]);
    const list = [...items.values()].filter((i) => i.Type === it?.Type && i.Id !== m[1]).slice(0, 12);
    return send(res, 200, { Items: list.map((i) => decorate(i)), TotalRecordCount: list.length });
  }
  if (p === '/Genres') {
    const set = new Set();
    for (const i of items.values()) (i.Genres ?? []).forEach((g) => set.add(g));
    return send(res, 200, { Items: [...set].sort().map((Name) => ({ Name, Id: id32(Name) })) });
  }
  if ((m = /^\/(?:UserPlayedItems|Users\/[0-9a-f]+\/PlayedItems)\/([0-9a-f]+)$/.exec(p))) {
    if (method === 'POST') state.played.add(m[1]);
    else state.played.delete(m[1]);
    state.progress.delete(m[1]);
    return send(res, 200, { Played: method === 'POST' });
  }
  if ((m = /^\/(?:UserFavoriteItems|Users\/[0-9a-f]+\/FavoriteItems)\/([0-9a-f]+)$/.exec(p))) {
    if (method === 'POST') state.fav.add(m[1]);
    else state.fav.delete(m[1]);
    return send(res, 200, { IsFavorite: method === 'POST' });
  }
  if ((m = /^\/Items\/([0-9a-f]+)\/PlaybackInfo$/.exec(p)) && method === 'POST') {
    const b = await readBody(req);
    if (state.delays.playbackInfo) await new Promise((r) => setTimeout(r, state.delays.playbackInfo));
    const item = items.get(m[1]);
    if (!item?.MediaSources) return send(res, 200, { MediaSources: [], ErrorCode: 'NoCompatibleStream' });
    const src = { ...item.MediaSources[0] };
    // Wie Jellyfin: die Fern-Grenze des Servers gilt zusaetzlich zu dem, was der Client verlangt (die kleinere zaehlt), sonst kein Direct Play
    const remoteLimit = effectiveRemoteLimit();
    const maxBitrate = remoteLimit > 0 ? Math.min(b.MaxStreamingBitrate ?? remoteLimit, remoteLimit) : b.MaxStreamingBitrate;
    const limited = maxBitrate && maxBitrate < src.Bitrate;
    const forced = b.EnableDirectPlay === false && b.EnableTranscoding !== false;
    if (limited || forced) {
      src.SupportsDirectPlay = false;
      src.SupportsDirectStream = false;
      src.TranscodingUrl = `/videos/${item.Id}/master.m3u8?MediaSourceId=${src.Id}&PlaySessionId=mock-session&VideoBitrate=${maxBitrate ?? b.MaxStreamingBitrate}`;
      src.TranscodingSubProtocol = 'hls';
      // Wie Jellyfin: gewaehlte Spuren werden zur Vorgabe, ein gewaehlter Textuntertitel kommt als eigene Datei
      if (b.AudioStreamIndex != null) src.DefaultAudioStreamIndex = b.AudioStreamIndex;
      if (b.SubtitleStreamIndex != null) src.DefaultSubtitleStreamIndex = b.SubtitleStreamIndex;
      src.MediaStreams = src.MediaStreams.map((s) =>
        s.Type === 'Subtitle' && s.Index === b.SubtitleStreamIndex && !/pgs/i.test(s.Codec) && !s.DeliveryUrl
          ? { ...s, DeliveryMethod: 'External', DeliveryUrl: `/Videos/${item.Id}/${item.Id}/Subtitles/${s.Index}/0/Stream.srt` }
          : s
      );
    }
    state.log.push({
      at: 'PlaybackInfo',
      itemId: item.Id,
      hasProfile: !!b.DeviceProfile,
      directPlayProfiles: b.DeviceProfile?.DirectPlayProfiles,
      maxBitrate: b.MaxStreamingBitrate,
      startTicks: b.StartTimeTicks,
      audioIndex: b.AudioStreamIndex,
      subtitleIndex: b.SubtitleStreamIndex,
      enableDirectPlay: b.EnableDirectPlay,
      maxAudioChannels: b.DeviceProfile?.TranscodingProfiles?.[0]?.MaxAudioChannels
    });
    return send(res, 200, { MediaSources: [src], PlaySessionId: 'mock-session' });
  }
  if ((m = /^\/MediaSegments\/([0-9a-f]+)$/.exec(p))) {
    const it = items.get(m[1]);
    const segs = it?.Type === 'Episode' ? [{ Id: id32(`seg${m[1]}`), ItemId: m[1], Type: 'Intro', StartTicks: 20 * TICKS, EndTicks: 85 * TICKS }] : [];
    return send(res, 200, { Items: segs, TotalRecordCount: segs.length });
  }
  // ---------- Verwaltung: nur mit state.admin, sonst 403 wie bei einem normalen Benutzer ----------
  const adminPath =
    p === '/System/Info' ||
    p === '/Library/Refresh' ||
    p === '/System/Restart' ||
    p === '/System/Shutdown' ||
    p === '/ScheduledTasks' ||
    p === '/Sessions' ||
    p === '/System/ActivityLog/Entries' ||
    p === '/Users' ||
    p === '/Users/New' ||
    /^\/ScheduledTasks\/Running\/[0-9a-f]+$/.test(p) ||
    /^\/Users\/[0-9a-f]+(\/Policy|\/Password)?$/.test(p) ||
    /^\/Items\/RemoteSearch\//.test(p) ||
    (/^\/Items\/[0-9a-f]+$/.test(p) && method !== 'GET');
  if (adminPath) {
    if (!state.admin) {
      state.log.push({ at: `admin-denied ${method} ${p}` });
      return send(res, 403, { Message: 'Forbidden' });
    }
    const ad = (state.adminData ??= freshAdminData());
    const log = (extra = {}) => state.log.push({ at: `admin ${method} ${p}`, ...extra });
    if (p === '/System/Info') return send(res, 200, { ServerName: 'Mock Jellyfin', Version: '10.10.3', ProductName: 'Jellyfin Server', OperatingSystem: 'Windows', OperatingSystemDisplayName: 'Windows 11', Id: SERVER_ID, LocalAddress: 'http://127.0.0.1:8097', HasPendingRestart: false, CanSelfRestart: true, StartupWizardCompleted: true });
    if (p === '/Library/Refresh' && method === 'POST') {
      ad.refreshes++;
      log();
      return send(res, 204, '');
    }
    if (p === '/System/Restart' && method === 'POST') {
      ad.restarts++;
      log();
      return send(res, 204, '');
    }
    if (p === '/System/Shutdown' && method === 'POST') {
      ad.shutdowns++;
      log();
      return send(res, 204, '');
    }
    if (p === '/ScheduledTasks') return send(res, 200, ad.tasks.filter((x) => !x.IsHidden || q.get('isHidden') !== 'false'));
    if ((m = /^\/ScheduledTasks\/Running\/([0-9a-f]+)$/.exec(p))) {
      const task = ad.tasks.find((x) => x.Id === m[1]);
      if (!task) return send(res, 404, { Message: 'Task not found' });
      task.State = method === 'POST' ? 'Running' : 'Idle';
      task.CurrentProgressPercentage = method === 'POST' ? 1 : undefined;
      log();
      return send(res, 204, '');
    }
    if (p === '/Sessions') return send(res, 200, ad.sessions);
    if (p === '/System/ActivityLog/Entries') return send(res, 200, { Items: ad.activity.slice(0, Number(q.get('limit') ?? 50)), TotalRecordCount: ad.activity.length, StartIndex: 0 });
    if (p === '/Users' && method === 'GET') return send(res, 200, ad.users);
    if (p === '/Users/New' && method === 'POST') {
      const b = await readBody(req);
      if (!b.Name || ad.users.some((u) => u.Name.toLowerCase() === String(b.Name).toLowerCase())) return send(res, 400, { Message: 'Benutzername existiert schon' });
      const u = { Id: id32(`user-${b.Name}`), Name: b.Name, HasPassword: !!b.Password, LastLoginDate: null, LastActivityDate: null, Policy: { IsAdministrator: false, IsDisabled: false, EnableMediaPlayback: true } };
      ad.users.push(u);
      log({ name: b.Name, hasPassword: !!b.Password });
      return send(res, 200, u);
    }
    if ((m = /^\/Users\/([0-9a-f]+)$/.exec(p))) {
      const u = ad.users.find((x) => x.Id === m[1]);
      if (!u) return send(res, 404, { Message: 'User not found' });
      if (method === 'DELETE') {
        ad.users.splice(ad.users.indexOf(u), 1);
        log({ userId: u.Id });
        return send(res, 204, '');
      }
      return send(res, 200, u);
    }
    if ((m = /^\/Users\/([0-9a-f]+)\/Policy$/.exec(p)) && method === 'POST') {
      const u = ad.users.find((x) => x.Id === m[1]);
      if (!u) return send(res, 404, { Message: 'User not found' });
      const b = await readBody(req);
      u.Policy = { ...u.Policy, ...b };
      log({ userId: u.Id, isDisabled: b.IsDisabled, keepsOtherFields: 'EnableMediaPlayback' in b });
      return send(res, 204, '');
    }
    if ((m = /^\/Users\/([0-9a-f]+)\/Password$/.exec(p)) && method === 'POST') {
      const u = ad.users.find((x) => x.Id === m[1]);
      if (!u) return send(res, 404, { Message: 'User not found' });
      const b = await readBody(req);
      if (b.ResetPassword) u.HasPassword = false;
      else if (b.NewPw) u.HasPassword = true;
      log({ userId: u.Id, reset: !!b.ResetPassword, newPw: b.NewPw ? '(gesetzt)' : undefined });
      return send(res, 204, '');
    }
    if ((m = /^\/Items\/RemoteSearch\/(Movie|Series)$/.exec(p)) && method === 'POST') {
      const b = await readBody(req);
      log({ type: m[1], name: b.SearchInfo?.Name, year: b.SearchInfo?.Year, itemId: b.ItemId });
      return send(res, 200, ad.remoteResults);
    }
    if ((m = /^\/Items\/RemoteSearch\/Apply\/([0-9a-f]+)$/.exec(p)) && method === 'POST') {
      const b = await readBody(req);
      const it = items.get(m[1]);
      if (!it) return send(res, 404, { Message: 'Item not found' });
      it.Name = b.Name || it.Name;
      if (b.ProductionYear) it.ProductionYear = b.ProductionYear;
      log({ itemId: m[1], name: b.Name, query: Object.fromEntries(q) });
      return send(res, 204, '');
    }
    if ((m = /^\/Items\/([0-9a-f]+)$/.exec(p))) {
      const it = items.get(m[1]);
      if (!it) return send(res, 404, { Message: 'Item not found' });
      if (method === 'POST') {
        const b = await readBody(req);
        for (const k of ['Name', 'OriginalTitle', 'Overview', 'OfficialRating', 'ProductionYear', 'Taglines', 'Genres', 'Tags']) if (k in b) it[k] = b[k];
        log({ itemId: m[1], fields: Object.keys(b).length, name: b.Name, keepsPeople: Array.isArray(b.People) && b.People.length > 0 });
        return send(res, 204, '');
      }
      if (method === 'DELETE') {
        items.delete(m[1]);
        for (const list of children.values()) {
          const i = list.indexOf(m[1]);
          if (i >= 0) list.splice(i, 1);
        }
        ad.deleted.push(m[1]);
        log({ itemId: m[1] });
        return send(res, 204, '');
      }
    }
  }
  // Einen Eintrag zum Bearbeiten laden (wie Jellyfin: der ganze Eintrag; nur Administratoren duerfen ihn bearbeiten, lesen darf jeder)
  if ((m = /^\/(?:Users\/[0-9a-f]+\/)?Items\/([0-9a-f]+)$/.exec(p)) && method === 'GET') {
    const it = items.get(m[1]);
    if (!it) return send(res, 404, { Message: 'Item not found' });
    return send(res, 200, decorate(it, { detail: true }));
  }
  if ((m = /^\/Items\/([0-9a-f]+)\/Refresh$/.exec(p)) && method === 'POST') {
    state.log.push({ at: 'Refresh', itemId: m[1], query: Object.fromEntries(q) });
    if (state.refreshForbidden) return send(res, 403, { Message: 'Forbidden' });
    return send(res, 204, '');
  }
  if (p.startsWith('/Sessions/')) {
    const b = method === 'POST' ? await readBody(req) : {};
    state.log.push({ at: p, ...b });
    if (b.ItemId && p.endsWith('/Stopped') && b.PositionTicks) state.progress.set(b.ItemId, b.PositionTicks);
    if (p.endsWith('/Stopped') && state.delays.stopped) await new Promise((r) => setTimeout(r, state.delays.stopped));
    return send(res, 204, '');
  }
  if (/^\/Videos\/[0-9a-f]+\/stream(\.\w+)?$/.test(p)) return serveVideo(req, res);
  if (/^\/Videos\/[0-9a-f]+\/[0-9a-f]+\/Subtitles\/\d+\/\d+\/Stream\.\w+$/.test(p)) {
    state.log.push({ at: 'subtitle', hasAuthHeader: /Token="/.test(req.headers.authorization ?? '') });
    return send(res, 200, srt(), 'application/x-subrip');
  }
  if (p === '/Videos/ActiveEncodings') return send(res, 204, '');
  return send(res, 404, { Message: `Mock: ${method} ${p} nicht implementiert` });
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Mock-Jellyfin laeuft auf http://127.0.0.1:${PORT}  (Benutzer: demo / Passwort: demo)`));
}

/** Setzt die Verwaltungsdaten zurueck (Benutzer, Aufgaben ...) und schaltet sie frei oder aus. */
function setAdmin(on) {
  state.admin = !!on;
  state.adminData = on ? freshAdminData() : null;
}

module.exports = { server, TOKEN, USER, PORT, state, items, children, add, MOVIES_VIEW, SHOWS_VIEW, addMovies, SEERR, effectiveRemoteLimit, setAdmin, resetSeerr };
