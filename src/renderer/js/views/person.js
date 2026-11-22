import { h } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { state } from '../state.js';
import { api, imgUrl, mapImage } from '../api.js';
import { lazyImage, pageStatus, row, initialsOf, skeletonRow } from '../ui.js';
import { playItem } from '../actions.js';
import { runSeerrCheck, seerrState } from '../connection.js';
import { requestCard, setCardStatus } from './request-card.js';
import { roleText, takeKnownPerson } from './cast-row.js';

const Person = window.JCPerson; // Lebensdaten, Reihen, Abgleich (src/shared/person.js)

const TMDB_PATH = /^\/[\w-]{8,64}\.(?:jpg|jpeg|png|webp)$/;
const tmdb = (size, file) => (typeof file === 'string' && TMDB_PATH.test(file) ? { url: mapImage(`jellycloud://tmdb/${size}${file}`), hash: null } : null);
const libraryImage = (p) => (p?.ImageTags?.Primary ? { url: imgUrl(p.Id, 'Primary', { w: 420, tag: p.ImageTags.Primary }), hash: null } : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Personen, deren Angaben der Server in dieser Sitzung schon nachladen sollte (einmal je Person, nicht bei jedem Besuch). */
const refreshAsked = new Set();

/**
 * Seite einer Person (wie PersonView der Apple-App): Foto oder Initialen, Name, Lebensdaten, Zahl der Titel der Mediathek, Biografie; darunter die Titel der
 * Mediathek (Filme, Serien, Folgen mit Gastrollen) und, mit Seerr, die uebrige Filmografie mit dem Stand jedes Titels ("Weitere Filme", "Weitere Serien",
 * "Hinter der Kamera").
 * Eine Seite fuer beide Wege: #/person/<Kennung> (Besetzung eines Titels der Mediathek) und #/person/tmdb/<Nummer> (Besetzung eines Seerr-Titels). Verbunden werden
 * die Quellen nur ueber die TMDB-Nummer der Person, nie ueber ihren Namen. Fehlen der Mediathek Biografie und Daten, ergaenzt Seerr sie; ein Administrator bittet
 * den Server ausserdem einmal, sie nachzuladen (Jellyfin holt sie erst bei Bedarf).
 */
export function personView({ id = null, tmdb: tmdbParam = null }) {
  const route = id ? { library: id } : { seerr: Number(tmdbParam) };
  const known = takeKnownPerson(Person.routeKey(route)); // was die Besetzung schon wusste (Name, Bild): sofort zeigen
  const el = h('div', { class: 'page person-page', 'data-glow': 'movies' }); // Hintergrund wie die Mediatheken (Ambient Glow des Bereichs Filme)

  let profile = null;
  let items = [];
  let filmography = null;
  let personTmdb = route.seerr ?? null;
  let loaded = false;
  let loadError = null;
  let destroyed = false;
  let generation = 0;

  const name = () => profile?.name || known?.name || '';

  // ---------- Kopf ----------
  const photo = h('div', { class: 'person-photo' });
  const nameEl = h('h1', { class: 'person-name' });
  const factsEl = h('div', { class: 'person-facts' });
  const badge = h('span', { class: 'person-badge', hidden: true });
  const head = h('section', { class: 'person-head' }, photo, h('div', { class: 'person-info' }, nameEl, factsEl, badge));
  const bioText = h('p', { class: 'overview clamp' });
  const bioMore = h('button', { class: 'link-btn', type: 'button', hidden: true }, t('action.more'));
  bioMore.addEventListener('click', () => {
    const open = bioText.classList.toggle('clamp');
    bioMore.textContent = open ? t('action.more') : t('action.less');
  });
  const bio = h('section', { class: 'person-bio', hidden: true }, h('h2', null, t('person.biography')), bioText, bioMore);
  const content = h('div', { class: 'person-rows' });
  el.append(head, bio, content);

  let shownPhoto = undefined;
  function paintPhoto(image) {
    const k = image?.url ?? '';
    if (k !== shownPhoto) {
      shownPhoto = k;
      // Ohne Foto die Initialen wie in der Besetzung, nicht das Film-Symbol
      const box = lazyImage(image, { cls: 'person-photo-img', eager: true });
      box.append(h('span', { class: 'initial', 'aria-hidden': 'true' }));
      const old = photo.lastElementChild;
      const img = box.querySelector('img');
      if (old && img && !old.classList.contains('noimg')) {
        // Das schaerfere Bild (Seite statt Besetzung) legt sich darueber; das alte geht erst, wenn das neue da ist (kein leerer Augenblick)
        img.addEventListener('load', () => photo.querySelectorAll('.person-photo-img').forEach((b) => b !== box && b.remove()), { once: true });
        img.addEventListener('error', () => box.remove(), { once: true });
        photo.append(box);
      } else {
        photo.replaceChildren(box);
      }
    }
    for (const s of photo.querySelectorAll('.initial')) s.textContent = initialsOf(name());
  }

  function paintBio(text) {
    if (bioText.textContent === text && !bio.hidden === !!text) return;
    bioText.textContent = text;
    bioText.classList.add('clamp');
    bioMore.textContent = t('action.more');
    bio.hidden = !text;
    requestAnimationFrame(() => (bioMore.hidden = !(bioText.scrollHeight > bioText.clientHeight + 2)));
  }

  // ---------- Reihen ----------
  /** Je Reihe ein Element, solange sich ihre Titel nicht aendern (sonst bliebe beim Nachladen der Filmografie keine Reihe stehen: Ruckeln, Scrollstand weg). */
  let rowEls = new Map(); // Signatur -> { el, cards }
  let statusEl = null;
  let statusSig = '';
  const skeleton = skeletonRow('poster', 8);

  /** Unter dem Titel einer Karte der Filmografie: Jahr und Rolle bzw. Aufgabe (ohne Rolle die Art). */
  const creditLine = (c) => [c.year, roleText(c.roles) || t(`seerr.${c.mediaType}`)].filter(Boolean).join(' · ');

  function rowElement(r) {
    const sig = `${r.kind}:${r.key}:${(r.items ?? r.credits).map((x) => x.Id ?? `${x.mediaType}-${x.id}`).join(',')}`;
    const have = rowEls.get(sig);
    if (have) {
      // Dieselben Titel: nur die Staende (etwa nach einer Anfrage)
      if (r.kind === 'credits') for (const c of r.credits) {
        const shown = have.cards.get(`${c.mediaType}-${c.id}`);
        if (shown && shown.status !== c.status) setCardStatus(shown, c.status);
      }
      return [sig, have];
    }
    const cards = new Map();
    const title = t(`person.row.${r.key}`);
    const el =
      r.kind === 'library'
        ? row(title, r.items, { variant: r.thumbs ? 'landscape' : 'poster', onPlay: (it) => playItem({ itemId: it.Id, resume: true }) })
        : row(title, r.credits, {
            render: (c, i) => {
              cards.set(`${c.mediaType}-${c.id}`, c);
              return requestCard(c, i, { detail: creditLine(c) });
            }
          });
    return [sig, { el, cards }];
  }

  /** Setzt die Kinder in die gewuenschte Folge, ohne stehende Elemente herauszunehmen (sonst begaennen ihre Karten von vorn). */
  function arrange(host, nodes) {
    let cur = host.firstChild;
    for (const n of nodes) {
      if (n === cur) {
        cur = cur.nextSibling;
        continue;
      }
      host.insertBefore(n, cur);
    }
    while (cur) {
      const next = cur.nextSibling;
      cur.remove();
      cur = next;
    }
  }

  function paintRows() {
    if (!loaded) return arrange(content, [skeleton]);
    const list = Person.rows({ items, filmography });
    const next = new Map();
    const nodes = [];
    for (const r of list) {
      const [sig, entry] = rowElement(r);
      next.set(sig, entry);
      nodes.push(entry.el);
    }
    rowEls = next;
    if (!list.length) {
      const sig = loadError ? `error:${loadError}` : `${filmography ? 'all' : 'lib'}:${name()}`;
      if (sig !== statusSig || !statusEl) {
        statusSig = sig;
        statusEl = loadError
          ? pageStatus({ kind: 'failed', title: t('person.failed'), text: loadError, retry: () => load(), inline: true })
          : h('p', { class: 'person-empty' }, t(filmography ? 'person.emptyAll' : 'person.emptyLibrary', { name: name() }));
      }
      nodes.push(statusEl);
    }
    arrange(content, nodes);
  }

  function paint() {
    if (destroyed) return;
    // Ohne Namen (unbekannte Person, direkt aufgerufen) kein leerer Kopf ueber dem Hinweis
    head.hidden = loaded && !name();
    nameEl.textContent = name();
    paintPhoto(profile?.image ?? known?.image ?? null);
    factsEl.replaceChildren(...Person.facts(profile, { lang: getLocale() }).map((f) => h('p', { class: 'person-fact' }, f)));
    const b = loaded ? Person.libraryBadge(items, getLocale()) : null;
    badge.textContent = b ?? '';
    badge.hidden = !b;
    paintBio(profile?.biography ?? '');
    paintRows();
  }

  // ---------- Laden ----------
  /** Person der Mediathek: Angaben und Titel von Jellyfin; dazu, mit Seerr und einer TMDB-Nummer der Person, die uebrige Filmografie und was der Mediathek fehlt. */
  async function loadFromLibrary(stale) {
    const [p, list] = await Promise.all([api.getPerson(route.library).catch((error) => ({ error })), api.getPersonItems(route.library).catch((error) => ({ error }))]);
    if (stale()) return;
    const person = p?.error ? null : p;
    if (person) profile = Person.fillGaps(Person.fromLibrary(person, libraryImage(person)), profile);
    items = Array.isArray(list) ? list : items;
    loadError = person || Array.isArray(list) ? null : p.error?.message || t('error.loadFailed');
    loaded = true;
    paint();
    if (!person) return;
    personTmdb = Number(Person.tmdbOf(person)) || null;
    const extras = loadSeerrExtras(stale);
    // Keine Biografie und keine Daten: einmal nachladen lassen (nur mit Rechten eines Administrators), dann neu lesen; der Server fragt dafuer TMDB
    if (state.isAdmin && !person.Overview && !person.PremiereDate && !refreshAsked.has(person.Id)) {
      refreshAsked.add(person.Id);
      if (await api.refreshPerson(person.Id).catch(() => false)) {
        for (let i = 0; i < 8 && !stale(); i++) {
          await sleep(1500);
          const fresh = stale() ? null : await api.getPerson(person.Id).catch(() => null);
          if (stale()) break;
          if (fresh && (fresh.Overview || fresh.PremiereDate)) {
            profile = Person.fillGaps(Person.fromLibrary(fresh, libraryImage(fresh)), profile);
            paint();
            break;
          }
        }
      }
    }
    await extras;
  }

  /** Ergaenzt die Seite aus Seerr: die Filmografie, und Biografie, Daten und Bild nur, wo sie fehlen. Ohne Seerr oder ohne Nummer der Person geschieht nichts. */
  async function loadSeerrExtras(stale) {
    if (!state.seerr || !personTmdb) return;
    const [credits, sp] = await Promise.all([window.jc.seerrFilmography(personTmdb).catch(() => null), Person.hasGaps(profile) ? window.jc.seerrPerson(personTmdb).catch(() => null) : null]);
    if (stale()) return;
    if (credits) filmography = credits;
    if (sp && profile) profile = Person.fillGaps(profile, Person.fromSeerr(sp, tmdb('w500', sp.profilePath)));
    paint();
  }

  /** Person eines Seerr-Titels: Angaben und Filmografie von Seerr; dazu, wenn die Mediathek dieselbe Person kennt (TMDB-Nummer), ihre Titel dort. */
  async function loadFromSeerr(stale) {
    if (!state.seerr) {
      loadError = t('person.noSeerr');
      loaded = true;
      return paint();
    }
    const [sp, credits] = await Promise.all([window.jc.seerrPerson(route.seerr).catch((error) => ({ error })), window.jc.seerrFilmography(route.seerr).catch(() => null)]);
    if (stale()) return;
    if (sp?.error?.code === 'SEERR_STALE') return; // Profil gewechselt: die Seite baut ohnehin neu
    if (!sp?.error) profile = Person.fromSeerr(sp, tmdb('w500', sp.profilePath));
    if (credits) filmography = credits;
    // Bei einem kurzen Netzfehler bleibt stehen, was schon da ist
    loadError = sp?.error && !profile ? (sp.error.code === 'SEERR_AUTH' ? t('seerr.authExpired') : sp.error.status === 404 ? t('person.notFound') : sp.error.message) : null;
    if (sp?.error?.code === 'SEERR_AUTH') runSeerrCheck();
    loaded = true;
    paint();
    const lp = await api.personByTmdb(route.seerr, name()).catch(() => null);
    if (stale() || !lp?.Id) return;
    const list = await api.getPersonItems(lp.Id).catch(() => null);
    if (stale() || !list) return;
    items = list;
    paint();
  }

  async function load() {
    const gen = ++generation;
    const stale = () => destroyed || gen !== generation;
    if (route.library) await loadFromLibrary(stale);
    else await loadFromSeerr(stale);
  }

  // Nach einer Anfrage (auf einer Karte dieser Seite): nur die Staende der Filmografie neu
  const onSeerrChanged = async () => {
    if (!filmography || !personTmdb) return;
    const gen = generation;
    const fresh = await window.jc.seerrFilmography(personTmdb).catch(() => null);
    if (destroyed || gen !== generation || !fresh) return;
    filmography = fresh;
    paint();
  };
  document.addEventListener('seerr-changed', onSeerrChanged);

  // Seerr erst jetzt bestaetigt (Pruefung beim Start, erneute Anmeldung): was dazu fehlte, nachholen
  const onConnection = () => {
    if (destroyed || !loaded || seerrState() !== 'connected') return;
    if (route.seerr && loadError) load();
    else if (route.library && !filmography && personTmdb) {
      const gen = generation;
      loadSeerrExtras(() => destroyed || gen !== generation);
    }
  };
  document.addEventListener('connection-state', onConnection);

  paint();
  load();

  return {
    el,
    destroy() {
      destroyed = true;
      document.removeEventListener('seerr-changed', onSeerrChanged);
      document.removeEventListener('connection-state', onConnection);
    }
  };
}
