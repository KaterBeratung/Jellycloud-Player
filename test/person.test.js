'use strict';

// Seite einer Person (Plan P13): die Faelle der Apple-App (JellycloudTests/SeerrPeopleTests.swift, 7) mit denselben Antworten, dazu die Regeln der Seite
// (Lebensdaten, Reihen, Abgleich nur ueber die TMDB-Nummer, Besetzungsreihen) und die Person der Mediathek gegen den Test-Server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SeerrClient, crewRole } = require('../src/shared/seerr');
const Person = require('../src/shared/person');
const { createBackend } = require('../src/shared/backend');
const { ConfigCore } = require('../src/shared/config-core');
const { server, state, persons, items, resetSeerr, setAdmin } = require('../tools/mock-server');

/** Ersatz-Seerr hinter fetch: answer(url) liefert den Koerper; seen haelt die Adressen fest. */
function stub(answer) {
  const seen = [];
  const fetch = async (url) => {
    seen.push(new URL(url));
    return new Response(JSON.stringify(answer(new URL(url))), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { client: new SeerrClient({ baseUrl: 'https://personen.seerr.test', cookie: 's', fetch, language: 'de' }), seen };
}
const movie = (id, title, votes, status = null, extra = {}) => ({ id, mediaType: 'movie', title, releaseDate: '2020-05-01', voteCount: votes, posterPath: '/abcdefgh.jpg', ...(status ? { mediaInfo: { status } } : {}), ...extra });

/** Die Texte der Oberflaeche (src/renderer/js/i18n.js ist ein ES-Modul fuer den Browser): Schluessel und Text je Sprache aus der Datei gelesen. */
const i18nText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'i18n.js'), 'utf8');
const enStart = i18nText.indexOf('\nconst en');
const textOf = (key, lang = 'de') => {
  const part = lang === 'en' ? i18nText.slice(enStart) : i18nText.slice(0, enStart);
  const m = new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`).exec(part);
  return m ? m[1] : null;
};
const label = (roles, lang = 'de') => roles.map((r) => (r.key ? textOf(`seerr.crew.${r.key}`, lang) : r.text)).join(', ');

// ---------- Apple: SeerrPeopleTests ----------

test('Die Besetzung eines Titels behaelt die Nummern der Personen; Regie und Idee stehen mit ihrer Aufgabe da', async () => {
  const { client } = stub(() => ({
    id: 1004, title: 'Glass Orchard', releaseDate: '2026-01-09',
    credits: {
      cast: [{ id: 11, name: 'Mara Ellison', character: 'Captain Reyes', profilePath: '/maraelli.jpg' }, { name: 'Ohne Nummer', character: '' }],
      crew: [{ id: 12, name: 'Ines Berger', job: 'Director', department: 'Directing' }, { id: 13, name: 'Jo Kim', job: 'Screenplay', department: 'Writing' }]
    }
  }));
  const d = await client.details('movie', 1004);
  const cast = Person.seerrCast({ ...d, crew: [], furtherCrew: [] });
  assert.deepEqual(cast.map((c) => c.route), [{ seerr: 11 }, null], 'ohne Nummer keine Seite (nur angezeigt)');
  assert.equal(label(cast[0].roles), 'Captain Reyes');
  assert.equal(label(cast[1].roles), 'Schauspiel', 'ohne Rolle "Schauspiel"');
  assert.equal(cast[0].profilePath, '/maraelli.jpg');
  const all = Person.seerrCast(d);
  assert.deepEqual(all[0], { name: 'Ines Berger', roles: [{ key: 'director' }], route: { seerr: 12 }, profilePath: null });
  assert.equal(label(all[0].roles), 'Regie');
  assert.deepEqual(all.map((c) => c.name), ['Ines Berger', 'Jo Kim', 'Mara Ellison', 'Ohne Nummer'], 'vorn Regie und Drehbuch, dann die Darsteller');
});

test('Person: Angaben, wie Seerr sie nennt; Fehlendes bleibt leer', async () => {
  const { client } = stub(() => ({ id: 11, name: 'Mara Ellison', birthday: '1980-04-07', deathday: null, placeOfBirth: 'Norwood, London, England, UK', biography: 'Eine Biografie.', profilePath: '/maraelli.jpg', knownForDepartment: 'Acting' }));
  assert.deepEqual(await client.person(11), { id: 11, name: 'Mara Ellison', biography: 'Eine Biografie.', birthday: '1980-04-07', deathday: null, placeOfBirth: 'Norwood, London, England, UK', profilePath: '/maraelli.jpg', department: 'Acting' });
  await assert.rejects(() => stub(() => ({ id: 11 })).client.person(11), /Unerwartete Antwort/);
  await assert.rejects(() => client.person(0), /Ungueltige Person/);
});

test('Filmografie: gleiche Titel zusammengefasst, Bekanntes zuerst, Filme, Serien und Mitwirkung getrennt, Stand des Titels dabei', async () => {
  const { client } = stub(() => ({
    id: 11,
    cast: [
      movie(1, 'Wenig bekannt', 10, null, { character: 'Wirtin' }),
      movie(2, 'Sehr bekannt', 900, 5, { character: 'Captain Reyes' }),
      movie(2, 'Sehr bekannt', 900, 5, { character: 'Erzählerin' }),
      { id: 7, mediaType: 'tv', name: 'Eine Serie', firstAirDate: '2019-01-01', voteCount: 50, character: 'Ärztin', mediaInfo: { status: 4 } },
      { id: 8, name: 'Ohne Art', character: '?' }
    ],
    crew: [movie(3, 'Selbst gedreht', 40, 2, { job: 'Director', department: 'Directing' }), movie(3, 'Selbst gedreht', 40, 2, { job: 'Screenplay', department: 'Writing' })]
  }));
  const f = await client.filmography(11);
  assert.deepEqual(f.movies.map((c) => c.title), ['Sehr bekannt', 'Wenig bekannt']);
  assert.equal(label(f.movies[0].roles), 'Captain Reyes, Erzählerin');
  assert.equal(f.movies[0].status, 5, 'verfuegbar');
  assert.deepEqual(f.series.map((c) => c.title), ['Eine Serie']);
  assert.equal(f.series[0].status, 4, 'teilweise verfuegbar');
  assert.deepEqual(f.crew.map((c) => c.title), ['Selbst gedreht']);
  assert.equal(label(f.crew[0].roles), 'Regie, Drehbuch');
  assert.equal(f.crew[0].status, 2, 'angefragt');
  assert.ok(!('votes' in f.movies[0]), 'die Stimmen dienen nur der Reihenfolge');
});

test('Aufgaben im Stab in der Sprache der Oberflaeche; Unbekanntes bleibt, wie Seerr es nennt', () => {
  const de = (job, dept) => label([crewRole(job, dept)]);
  assert.equal(de('Director', 'Directing'), 'Regie');
  assert.equal(de('Screenplay', 'Writing'), 'Drehbuch');
  assert.equal(de('Executive Producer', 'Production'), 'Produktion');
  assert.equal(de('Original Music Composer', 'Sound'), 'Musik');
  assert.equal(de('Stunt Coordinator', 'Crew'), 'Stunt Coordinator');
  assert.equal(de('', 'Camera'), 'Kamera');
  assert.equal(crewRole('', ''), null);
  assert.deepEqual(crewRole('constructor', ''), { text: 'constructor' }, 'kein Schluessel aus dem Objekt-Prototyp');
  // Jeder Schluessel hat Texte in beiden Sprachen
  const keys = ['director', 'writer', 'source', 'producer', 'music', 'camera', 'editing', 'creator', 'sound', 'art', 'costume', 'effects', 'lighting', 'acting', 'crew', 'guestStar'];
  for (const k of keys) for (const lang of ['de', 'en']) assert.ok(textOf(`seerr.crew.${k}`, lang), `seerr.crew.${k} (${lang})`);
  assert.equal(label([{ key: 'director' }], 'en'), 'Director');
});

test('Texte in der Sprache des Geraets: Personen und Suche mit language, Anmeldung und Anfragen ohne', async () => {
  // Mit Biografie: ohne sie fragte die Seite noch einmal auf Englisch (Ersatz, Apple-App Build 95; eigener Test in seerr-discover.test.js)
  const { client, seen } = stub((u) => (u.pathname.endsWith('/auth/me') ? { id: 1, permissions: 32 } : { id: 11, name: 'x', biography: 'Text', results: [], cast: [], crew: [] }));
  await client.person(11);
  await client.filmography(11);
  await client.search('orbit');
  await client.me();
  await client.requestPage({ userId: 1 });
  assert.equal(seen.length, 5);
  for (const u of seen) {
    const content = u.pathname.includes('/person/') || u.pathname.endsWith('/search');
    assert.equal(u.searchParams.get('language'), content ? 'de' : null, u.pathname);
  }
});

test('Ziel einer Person: Mediathek und Seerr sind verschiedene Ziele, auch bei gleicher Zahl', () => {
  const lib = { library: '00000011' };
  const tm = { seerr: 11 };
  assert.notEqual(Person.routeKey(lib), Person.routeKey({ seerr: 11 }));
  assert.equal(Person.routeKey(tm), Person.routeKey({ seerr: 11 }));
  assert.equal(Person.href(lib), '#/person/00000011');
  assert.equal(Person.href(tm), '#/person/tmdb/11');
  assert.equal(Person.href({ library: '../x' }), null, 'nur gueltige Kennungen');
  assert.equal(Person.href({ seerr: 0 }), null);
  assert.equal(Person.href(null), null);
});

test('Lebensdaten aus Seerr: Tag ohne Uhrzeit, in jeder Zeitzone derselbe Tag; Unlesbares ergibt nichts', () => {
  assert.equal(Person.seerrDay('1980-04-07'), '1980-04-07');
  assert.equal(Person.seerrDay(null), null);
  assert.equal(Person.seerrDay(''), null);
  assert.equal(Person.seerrDay('unbekannt'), null);
  assert.equal(Person.seerrDay('1980-02-30'), null, 'kein 30. Februar');
  // Mediathek: Mitternacht beim Server, in UTC geliefert
  assert.equal(Person.libraryDay('1918-04-06T23:00:00.0000000Z'), '1918-04-07', 'Server in Mitteleuropa');
  assert.equal(Person.libraryDay('1918-04-07T05:00:00.0000000Z'), '1918-04-07', 'Server in New York');
  assert.equal(Person.libraryDay('1918-04-07'), '1918-04-07');
  assert.equal(Person.libraryDay('kaputt'), null);
  assert.equal(Person.libraryDay(undefined), null);
});

// ---------- Regeln der Seite ----------

test('Zeilen unter dem Namen: geboren mit Ort, Alter; gestorben mit Alter beim Tod; nur ein Ort; nichts', () => {
  const now = new Date(2026, 10, 22);
  assert.deepEqual(Person.facts({ born: '1980-04-07', birthplace: 'Norwood, London' }, { now }), ['Geboren am 7. April 1980 in Norwood, London', '46 Jahre alt']);
  assert.deepEqual(Person.facts({ born: '1980-12-01' }, { now }), ['Geboren am 1. Dezember 1980', '45 Jahre alt'], 'Geburtstag erst im Dezember');
  assert.deepEqual(Person.facts({ born: '1918-04-07', died: '1996-12-19' }, { now }), ['Geboren am 7. April 1918', 'Gestorben am 19. Dezember 1996 (78 Jahre)']);
  assert.deepEqual(Person.facts({ died: '1996-12-19', birthplace: 'Lyon' }, { now }), ['Geboren in Lyon', 'Gestorben am 19. Dezember 1996']);
  assert.deepEqual(Person.facts({}, { now }), []);
  assert.deepEqual(Person.facts(null), []);
  assert.deepEqual(Person.facts({ born: '1980-04-07', birthplace: 'Norwood, London' }, { now, lang: 'en' }), ['Born April 7, 1980 in Norwood, London', '46 years old']);
  assert.equal(Person.shortPlace('Norwood, London, England, UK'), 'Norwood, London');
  assert.equal(Person.shortPlace('Lyon'), 'Lyon');
});

test('Zwei Quellen: Fehlendes wird ergaenzt, Vorhandenes bleibt; Luecken sind Biografie, Geburtstag oder Bild', () => {
  const lib = Person.fromLibrary({ Name: 'Mara Ellison', Overview: '', PremiereDate: '1980-04-06T23:00:00.0000000Z', ProductionLocations: ['Norwood, London, England, UK'] }, { url: 'jellycloud://img/x' });
  assert.deepEqual(lib, { name: 'Mara Ellison', biography: '', born: '1980-04-07', died: null, birthplace: 'Norwood, London', image: { url: 'jellycloud://img/x' } });
  assert.ok(Person.hasGaps(lib), 'ohne Biografie');
  const seerr = Person.fromSeerr({ name: 'Mara E.', biography: 'Aus Seerr.', birthday: '1980-04-08', deathday: null, placeOfBirth: 'Mockstadt' }, { url: 'jellycloud://tmdb/w500/x.jpg' });
  const both = Person.fillGaps(lib, seerr);
  assert.equal(both.name, 'Mara Ellison', 'der Name der Mediathek bleibt');
  assert.equal(both.biography, 'Aus Seerr.');
  assert.equal(both.born, '1980-04-07', 'der Tag der Mediathek bleibt');
  assert.equal(both.birthplace, 'Norwood, London');
  assert.deepEqual(both.image, { url: 'jellycloud://img/x' });
  assert.ok(!Person.hasGaps(both));
  assert.equal(Person.fillGaps(null, seerr), seerr);
});

test('Reihen: Mediathek zuerst (Folgen nur aus Serien, die nicht ganz dastehen), darunter die Filmografie ohne diese Titel (nur ueber die TMDB-Nummer)', () => {
  const items = [
    { Id: 'm1', Type: 'Movie', Name: 'Paper Moons', ProviderIds: { Tmdb: '4242' } },
    { Id: 'm2', Type: 'Movie', Name: 'Mock Matrix Resurrection', ProviderIds: {} }, // gleicher Titel wie bei Seerr, aber ohne Nummer: bleibt in der Filmografie
    { Id: 's1', Type: 'Series', Name: 'Starfall', ProviderIds: { tmdb: '1399' } },
    { Id: 'e1', Type: 'Episode', SeriesId: 's1' },
    { Id: 'e2', Type: 'Episode', SeriesId: 's9' }
  ];
  const filmography = {
    movies: [{ mediaType: 'movie', id: 603, title: 'Mock Matrix Resurrection' }, { mediaType: 'movie', id: 4242, title: 'Mock Arrival' }],
    series: [{ mediaType: 'tv', id: 1399, title: 'Mock Thrones' }, { mediaType: 'tv', id: 4242, title: 'Gleiche Zahl, andere Art' }],
    crew: []
  };
  const r = Person.rows({ items, filmography });
  assert.deepEqual(r.map((x) => [x.kind, x.key]), [['library', 'movies'], ['library', 'series'], ['library', 'episodes'], ['credits', 'moreMovies'], ['credits', 'moreSeries']]);
  assert.deepEqual(r[2].items.map((i) => i.Id), ['e2'], 'Folge einer Serie, die schon dasteht, nicht noch einmal');
  assert.ok(r[2].thumbs, 'Folgen als breite Karten');
  assert.deepEqual(r[3].credits.map((c) => c.id), [603]);
  assert.deepEqual(r[4].credits.map((c) => c.id), [4242], 'Serie 4242 ist nicht der Film 4242');
  // Ohne Titel der Mediathek heissen die Reihen "Filme" und "Serien"; leere fallen weg
  assert.deepEqual(Person.rows({ items: [], filmography }).map((x) => x.key), ['movies', 'series']);
  assert.deepEqual(Person.rows({ items: [], filmography: { movies: [], series: [], crew: [] } }), []);
  assert.deepEqual(Person.rows({ items, filmography: null }).map((x) => x.key), ['movies', 'series', 'episodes'], 'ohne Seerr nur die Mediathek');
});

test('Kapsel der Mediathek: ein Titel, Filme und Serien (Folgen zaehlen zu ihrer Serie), Englisch', () => {
  assert.equal(Person.libraryBadge([]), null);
  assert.equal(Person.libraryBadge([{ Type: 'Episode', SeriesId: 's1' }]), '1 Titel in deiner Bibliothek');
  assert.equal(Person.libraryBadge([{ Type: 'Movie' }, { Type: 'Movie' }, { Type: 'Series', Id: 's1' }, { Type: 'Episode', SeriesId: 's1' }, { Type: 'Episode', SeriesId: 's2' }]), '2 Filme und 2 Serien in deiner Bibliothek');
  assert.equal(Person.libraryBadge([{ Type: 'Movie' }, { Type: 'Movie' }]), '2 Filme in deiner Bibliothek');
  assert.equal(Person.libraryBadge([{ Type: 'Movie' }, { Type: 'Series', Id: 's1' }], 'en'), '1 movie and 1 show in your library');
});

test('Besetzung der Mediathek: Schauspiel, Regie und Gastrollen (hoechstens 30), Rolle oder Taetigkeit, Seite nur mit Kennung', () => {
  const id = (n) => String(n).padStart(32, 'a');
  const people = [
    { Id: id(1), Name: 'Mara Ellison', Type: 'Actor', Role: 'Captain Reyes' },
    { Id: id(2), Name: 'Elise Fontaine', Type: 'Director', Role: 'Director' },
    { Id: id(3), Name: 'Daniel Okafor', Type: 'Writer' },
    { Id: id(4), Name: 'Nadia Gast', Type: 'GuestStar', Role: '' },
    { Id: 'kaputt', Name: 'Ohne Kennung', Type: 'Actor' },
    ...Array.from({ length: 40 }, (_, i) => ({ Id: id(100 + i), Name: `Statist ${i}`, Type: 'Actor' }))
  ];
  const cast = Person.libraryCast(people);
  assert.equal(cast.length, 30);
  assert.deepEqual(cast.slice(0, 4).map((c) => [c.name, label(c.roles)]), [['Mara Ellison', 'Captain Reyes'], ['Elise Fontaine', 'Regie'], ['Nadia Gast', 'Gaststar'], ['Ohne Kennung', 'Schauspiel']]);
  assert.deepEqual(cast[0].route, { library: id(1) });
  assert.equal(cast[3].route, null, 'ohne gueltige Kennung nur angezeigt');
  assert.ok(!cast.some((c) => c.name === 'Daniel Okafor'), 'Drehbuch steht bei den Angaben, nicht in der Besetzung');
});

// ---------- Gegen den Test-Server: Person der Mediathek ----------

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${server.address().port}`), r()))));
test.after(() => server.close());
test.beforeEach(() => {
  resetSeerr();
  state.log.length = 0;
});

function memoryConfig() {
  const store = { text: null };
  const codec = { encode: (t) => `plain:${Buffer.from(t, 'utf8').toString('base64')}`, decode: (s) => (s.startsWith('plain:') ? Buffer.from(s.slice(6), 'base64').toString('utf8') : null) };
  let n = 0;
  const env = { uuid: () => `dev-${++n}`, hashId: (t) => require('node:crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) };
  return new ConfigCore({ read: () => store.text, write: (t) => (store.text = t) }, codec, env);
}
async function signedIn() {
  const b = createBackend({ config: memoryConfig(), fetch: globalThis.fetch, appVersion: () => '1.2.12', locale: () => 'de-DE' });
  await b.login({ url: base, username: 'demo', password: 'demo' });
  await b.seerrConnect({ url: base, username: 'demo', password: 'demo' });
  await b.checkConnection();
  return b;
}
const personNamed = (name) => [...persons.values()].find((p) => p.Name === name);

test('Person der Mediathek: Angaben mit TMDB-Nummer, ihre Titel mit TMDB-Nummern; nur gueltige Kennungen', async () => {
  const b = await signedIn();
  const mara = personNamed('Mara Ellison');
  const p = await b.api('getPerson', [mara.Id]);
  assert.equal(p.Name, 'Mara Ellison');
  assert.equal(Person.tmdbOf(p), '9202');
  assert.equal(Person.fromLibrary(p).born, '1980-04-07');
  const list = await b.api('getPersonItems', [mara.Id]);
  assert.equal(list.length, [...items.values()].filter((i) => ['Movie', 'Series', 'Episode'].includes(i.Type)).length, 'Filme, Serien und Folgen');
  assert.ok(list.find((i) => i.Name === 'Paper Moons')?.ProviderIds?.Tmdb === '4242', 'mit den Nummern fuer den Abgleich');
  await assert.rejects(() => b.api('getPerson', ['../Users']), /Ungueltige Kennung/);
  const paper = [...items.values()].find((i) => i.Name === 'Paper Moons');
  await assert.rejects(() => b.api('getPerson', [paper.Id]), (e) => e.status === 404, 'die Kennung eines Films ist keine Person');
  const nadia = await b.api('getPersonItems', [personNamed('Nadia Gast').Id]);
  assert.deepEqual(nadia.map((i) => i.Type), ['Episode'], 'nur eine Gastrolle');
});

test('Person der Mediathek zu einer Seerr-Person: ueber den Namen gesucht, nur ueber die TMDB-Nummer zugeordnet', async () => {
  const b = await signedIn();
  const found = await b.api('personByTmdb', [9202, 'Mara Ellison']);
  assert.equal(found?.Id, personNamed('Mara Ellison').Id);
  assert.equal(await b.api('personByTmdb', [9999, 'Mara Ellison']), null, 'gleicher Name, andere Nummer: nicht dieselbe Person');
  assert.equal(await b.api('personByTmdb', [9202, '']), null, 'ohne Namen keine Suche');
  assert.deepEqual(state.log.filter((l) => l.at === '/Persons').map((l) => [l.searchTerm, l.fields]), [['Mara Ellison', 'ProviderIds'], ['Mara Ellison', 'ProviderIds']]);
});

test('Fehlende Angaben nachladen lassen: vorhandenes bleibt, danach sind sie da; ohne Recht lehnt der Server ab', async () => {
  const b = await signedIn();
  const jonas = personNamed('Jonas Whitfield');
  const backup = { ...jonas };
  try {
    state.refreshForbidden = true;
    assert.equal(await b.api('refreshPerson', [jonas.Id]), false);
    state.refreshForbidden = false;
    setAdmin(true);
    assert.equal(await b.api('refreshPerson', [jonas.Id]), true);
    const q = state.log.filter((l) => l.at === 'Refresh').at(-1).query;
    assert.deepEqual([q.metadataRefreshMode, q.imageRefreshMode, q.replaceAllMetadata, q.replaceAllImages], ['FullRefresh', 'Default', 'false', 'false']);
    const fresh = await b.api('getPerson', [jonas.Id]);
    assert.equal(fresh.Overview, 'Vom Server nachgeladen.');
    assert.equal(Person.fromLibrary(fresh).born, '1975-10-01');
  } finally {
    setAdmin(false);
    state.refreshForbidden = false;
    for (const k of Object.keys(jonas)) delete jonas[k];
    Object.assign(jonas, backup);
  }
});

test('Seerr-Person gegen den Test-Seerr: Angaben und Filmografie; die Titel der Mediathek fallen auf der Seite weg', async () => {
  const b = await signedIn();
  const p = await b.seerrPerson(9202);
  assert.equal(p.name, 'Mara Ellison');
  const f = await b.seerrFilmography(9202);
  assert.deepEqual(f.movies.map((c) => c.id), [603, 4242, 7003], 'Bekanntes zuerst, 603 einmal mit zwei Rollen');
  assert.deepEqual(f.series.map((c) => c.id), [1399, 2001]);
  assert.deepEqual(f.crew.map((c) => [c.id, c.roles]), [[7001, [{ key: 'director' }, { key: 'writer' }]]]);
  const list = await b.api('getPersonItems', [personNamed('Mara Ellison').Id]);
  const r = Person.rows({ items: list, filmography: f });
  assert.deepEqual(r.filter((x) => x.kind === 'credits').map((x) => [x.key, x.credits.map((c) => c.id)]), [['moreMovies', [603, 7003]], ['moreSeries', [2001]], ['crew', [7001]]]);
  await assert.rejects(() => b.seerrPerson(424242), (e) => e.status === 404);
  assert.ok(state.log.some((l) => l.at === 'seerr:GET /person/9202' && l.language === 'de'), 'in der Sprache des Geraets');
});
