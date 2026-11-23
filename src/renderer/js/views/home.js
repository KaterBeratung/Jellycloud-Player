import { h, icon } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { api, backdropOf, landscapeOf, logoOf, itemHref } from '../api.js';
import { state, updateSettings, SUPPORTED_COLLECTIONS } from '../state.js';
import { lazyImage, pageStatus, row, showPageStatus, skeletonRow, titleOf } from '../ui.js';
import { cardTags } from '../tags.js';
import { fmtDuration, ticksToSec } from '../utils.js';
import { playItem, playSeries } from '../actions.js';
import { refreshGlow } from '../glow.js';
import { createTrailer } from '../trailer.js';
import { requestCard } from './request-card.js';
import { topTenRow } from './top-ten.js';
import { seerrState } from '../connection.js';

const Media = window.JCMedia;
const Format = window.JCFormat; // Schreibweisen der Angabenzeilen (src/shared/format.js)
const HomeRows = window.JCHomeRows; // Anpassung der Startseite (src/shared/home-rows.js); Folien im Banner kommen aus den Einstellungen
const Rankings = window.JCRankings; // Top 10 (src/shared/rankings.js)
const HERO_MS = 9000; // so lange bleibt eine Folie ohne Trailer stehen
const HERO_AFTER_TRAILER_MS = 1200; // nach dem Ende eines Trailers noch kurz das Bild, dann geht es weiter
const LATEST_PER_ROW = 30;
const TREND_TTL_MS = 10 * 60 * 1000; // so lange gilt die Liste der Trend-Filme, bevor Seerr wieder gefragt wird

/**
 * Was die Startseite zuletzt von den Top 10 wusste, je Profil, Seerr und Zeitraum: steht es schon fest (oder ist das Laden schon einmal gescheitert),
 * baut sich die Startseite ohne Platzhalter auf; Platzhalter gibt es nur beim ersten Laden (sonst erschienen die Reihen nach einem Fehler der Quelle bei
 * jedem Aufbau kurz und verschwaenden wieder). Die Rangfolge selbst merkt sich die Rueckseite (30 min).
 */
let topMemory = null; // { key, result: { window, movies, series } | null }
let forceTopTen = false; // "Neu laden": auch die Rangfolge neu holen
document.addEventListener('reload-requested', () => (forceTopTen = true));
const topWindow = () => HomeRows.homeConfig(state.settings.home).rankingWindow;
const topKey = () => `${state.activeServerId}|${state.seerr?.url ?? ''}|${topWindow()}`;

/**
 * Filme im Trend von Seerr. Die Startseite wird oft neu aufgebaut (etwa nach jedem Film): innerhalb von TREND_TTL_MS kommt die Liste aus dem Speicher. Gemerkt wird das laufende
 * Versprechen (nicht erst das Ergebnis): fragt die Startseite waehrenddessen noch einmal, gilt dieselbe Antwort; ein Fehlschlag wird nicht gemerkt.
 */
let trendCache = null; // { key, at, list: Promise }
const trendKey = () => `${state.activeServerId}|${state.seerr?.url}|${state.seerr?.userName}`; // Seerr gilt je Profil
/**
 * Die gemerkte Liste gehoert zu genau einem Profil und seiner Seerr-Sitzung: baut sich die Startseite fuer ein anderes Profil auf (auch eines ohne Seerr),
 * ist sie weg, ebenso nach dem Verbinden oder Trennen von Seerr (wie die Apple-App: der Zwischenspeicher des vorigen Profils gilt sofort nicht mehr).
 */
function dropForeignTrend() {
  if (trendCache && trendCache.key !== trendKey()) trendCache = null;
}
document.addEventListener('seerr-changed', () => (trendCache = null));
function loadTrending() {
  dropForeignTrend();
  const key = trendKey();
  if (trendCache && Date.now() - trendCache.at < TREND_TTL_MS) return trendCache.list;
  const entry = { key, at: Date.now(), list: window.jc.seerrTrending() };
  trendCache = entry;
  entry.list.catch(() => {
    if (trendCache === entry) trendCache = null;
  });
  return entry.list;
}

function metaLine(item) {
  const bits = [];
  if (item.Type === 'Episode') bits.push(Format.episodeLabel(item));
  else if (item.ProductionYear) bits.push(String(item.ProductionYear));
  if (item.OfficialRating) bits.push(h('span', { class: 'rating-box' }, item.OfficialRating));
  if (item.RunTimeTicks) bits.push(fmtDuration(ticksToSec(item.RunTimeTicks)));
  if (Format.score(item.CommunityRating)) bits.push(h('span', { class: 'score' }, icon('star', 14), Format.score(item.CommunityRating)));
  return bits;
}

function heroSlide(entry, first) {
  const { item, kind } = entry;
  const bd = backdropOf(item, 1920) ?? landscapeOf(item, 1280);
  const logo = logoOf(item, 640);
  const label = kind === 'series' ? t('home.newSeries') : t('home.newMovies');
  const hasProgress = (item.UserData?.PlaybackPositionTicks ?? 0) > 0;
  const playText = h('span', null, hasProgress ? t('action.resume') : t('action.play'));

  const slide = h('article', { class: 'hero-slide' });
  slide._playText = playText; // "Fortsetzen" bzw. "Abspielen", folgt dem Stand (createHero refresh)
  slide._hash = bd?.hash ?? null; // Hintergrundton der Seite (ambient.js)
  const bg = lazyImage(bd, { cls: 'hero-bg', eager: first });
  slide.append(bg, h('div', { class: 'hero-shade' }));

  const content = h('div', { class: 'hero-content' });
  content.append(h('span', { class: 'hero-label' }, label));
  if (logo) {
    const l = h('img', { class: 'hero-logo', alt: titleOf(item), decoding: 'async', src: logo.url });
    l.addEventListener('error', () => {
      l.replaceWith(h('h1', { class: 'hero-title' }, titleOf(item)));
    });
    content.append(l);
  } else {
    content.append(h('h1', { class: 'hero-title' }, titleOf(item)));
  }
  const meta = h('div', { class: 'hero-meta' }, metaLine(item).map((b) => (typeof b === 'string' ? h('span', null, b) : b)));
  const tags = cardTags(item, { max: 3 }); // Banner: bis zu drei (4K, HDR, Premium-Ton, HD)
  if (tags) meta.append(tags);
  content.append(meta);
  if (item.Overview) content.append(h('p', { class: 'hero-overview' }, item.Overview));
  content.append(
    h(
      'div',
      { class: 'hero-actions' },
      h(
        'button',
        {
          class: 'btn primary lg',
          type: 'button',
          onclick: () => playItem({ itemId: item.Id, resume: true })
        },
        icon('play', 20),
        playText
      ),
      h('a', { class: 'btn glass lg', href: itemHref(item) }, icon('info', 20), h('span', null, t('action.details')))
    )
  );
  slide.append(content);
  return slide;
}

/**
 * Hero-Banner mit automatischem Wechsel. Mit `trailers` (die Trailer-Einstellungen) spielt die aktive Folie ihren Trailer im Hintergrund ab (wie auf der
 * Detailseite): das Banner bleibt dann stehen, bis der Trailer zu Ende ist, und geht danach weiter. Laesst er sich nicht abspielen, gilt wieder die normale Zeit.
 */
function createHero(entries, { autoplay, onActive, trailers = null }) {
  const el = h('section', { class: 'hero', 'aria-roledescription': 'carousel' });
  const slides = entries.map((e, i) => heroSlide(e, i === 0));
  const dots = h('div', { class: 'hero-dots' });
  let index = 0;
  let timer = null;
  let hovering = false;
  let destroyed = false;
  let paused = false; // die Startseite ist gerade nicht zu sehen (im Speicher des Routers): kein Wechsel, kein Trailer
  let trailer = null; // Trailer der aktiven Folie
  let hold = false; // ein Trailer startet oder laeuft: nicht von selbst weiterschalten
  const videoIds = new Map(); // Folie -> YouTube-ID (aus dem vollstaendigen Eintrag, bei Folgen von der Serie), jeweils nur einmal geholt
  const played = new Set(); // Folien, deren Trailer in diesem Besuch der Startseite schon zu Ende gelaufen ist: beim naechsten Durchlauf des Banners bleibt es beim Bild (keine Dauerschleife)

  const videoIdOf = (i) => {
    if (!videoIds.has(i)) {
      const { item } = entries[i];
      // Der Trailer steht im vollstaendigen Eintrag (bei Folgen in dem der Serie)
      videoIds.set(i, api.getItem(item.SeriesId ?? item.Id).then((full) => Media.trailerVideoId(full)).catch(() => null));
    }
    return videoIds.get(i);
  };

  function stopTrailer() {
    clearTimeout(timer);
    trailer?.destroy();
    trailer = null;
    hold = false;
  }

  async function startTrailer(i) {
    const id = await videoIdOf(i);
    if (destroyed || paused || index !== i || trailer) return; // inzwischen weitergeschaltet (go hat den Halt fuer die neue Folie gesetzt), pausiert oder weg
    if (!id) {
      hold = false;
      schedule();
      return;
    }
    const ctl = createTrailer({
      host: slides[i],
      videoId: id,
      muted: trailers.muted !== false,
      delaySec: trailers.delaySec,
      quality: String(trailers.quality) === '2160' ? '1080' : trailers.quality, // das Banner ist nie groesser als Full HD: 4K waere nur Rechen- und Netzlast
      volume: trailers.volume,
      onVolume: (v) => updateSettings({ trailer: { volume: v } }).catch(() => {}),
      // kein "freier Blick" im Banner: Titel, Angaben und Knoepfe bleiben stehen (nur die Detailseite blendet nach einer Weile aus)
      onDone: (why) => {
        if (why === 'ended') played.add(i);
        if (destroyed || index !== i) return;
        ctl.destroy();
        trailer = null;
        hold = false;
        if (why === 'ended' && autoplay && slides.length > 1) timer = setTimeout(() => go((i + 1) % slides.length), HERO_AFTER_TRAILER_MS);
        else schedule();
      }
    });
    trailer = ctl;
    ctl.mountControls(slides[i].querySelector('.hero-actions')); // Ton-Knopf am Ende der Knopfleiste
  }

  const dotEls = entries.map((_, i) => {
    const d = h('button', { class: 'dot', type: 'button', 'aria-label': `${i + 1}`, onclick: () => go(i, true) }, h('i'));
    dots.append(d);
    return d;
  });
  el.append(...slides, dots);

  function schedule() {
    clearTimeout(timer);
    dotEls.forEach((d, i) => d.classList.toggle('run', i === index && autoplay && slides.length > 1 && !hovering && !hold));
    if (!autoplay || slides.length < 2 || hovering || hold) return;
    timer = setTimeout(() => go((index + 1) % slides.length), HERO_MS);
  }
  function go(i, manual = false) {
    stopTrailer();
    index = i;
    const again = !!trailers && !played.has(i); // ein schon gespielter Trailer laeuft in diesem Besuch nicht noch einmal
    hold = again; // bis sich zeigt, ob die Folie einen Trailer hat und ob er laeuft
    if (again) startTrailer(i);
    slides.forEach((s, k) => {
      s.classList.toggle('active', k === i);
      s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    });
    dotEls.forEach((d, k) => d.classList.toggle('on', k === i));
    onActive?.(slides[i]._hash);
    // Animation der aktiven Markierung neu starten
    dotEls.forEach((d) => {
      d.classList.remove('run');
    });
    void el.offsetWidth;
    schedule();
    if (manual) hovering = false;
  }
  el.addEventListener('pointerenter', () => {
    hovering = true;
    schedule();
  });
  el.addEventListener('pointerleave', () => {
    hovering = false;
    schedule();
  });
  go(0);
  return {
    el,
    /** Neuer Stand der Eintraege (Neu laden nach einer Aenderung): nur die Beschriftung von Abspielen/Fortsetzen, das Banner selbst bleibt (Folie, Trailer). */
    refresh(byId) {
      entries.forEach((e, i) => {
        const fresh = byId.get(e.item.Id);
        if (!fresh) return;
        e.item.UserData = fresh.UserData;
        const text = (fresh.UserData?.PlaybackPositionTicks ?? 0) > 0 ? t('action.resume') : t('action.play');
        if (slides[i]._playText.textContent !== text) slides[i]._playText.textContent = text;
      });
    },
    /** Die Startseite verschwindet aus dem Bild, bleibt aber im Speicher: Trailer beenden, nicht weiterschalten. */
    pause() {
      paused = true;
      stopTrailer();
    },
    /** Zurueck auf der Startseite: die aktive Folie beginnt von vorn (mit ihrem Trailer, falls sie einen hat). */
    resume() {
      if (!paused || destroyed) return;
      paused = false;
      played.clear(); // neuer Besuch der Startseite: die aktive Folie spielt ihren Trailer wieder
      go(index);
    },
    destroy() {
      destroyed = true;
      stopTrailer();
    }
  };
}

export function homeView() {
  const el = h('div', { class: 'page home', 'data-glow': 'home' }); // Ambient Glow der Startseite (glow.js)
  const heroHost = h('div', { class: 'hero-host' });
  const rows = h('div', { class: 'rows' });
  el.append(heroHost, rows);
  const heroOn = HomeRows.homeConfig(state.settings.home).hero; // ohne Banner gibt es auch keinen Platzhalter dafuer
  /** Platzhalter, bis die Startseite steht (beim ersten Aufbau und nach "Erneut versuchen") */
  const placeholders = () => {
    rows.replaceChildren(skeletonRow('poster', 9), skeletonRow('landscape', 5));
    heroHost.replaceChildren(...(heroOn ? [h('div', { class: 'hero hero-skeleton' }, h('div', { class: 'sk' }))] : []));
    el.classList.toggle('no-hero', !heroOn);
  };
  placeholders();

  let destroyed = false;
  let away = false; // die Startseite liegt gerade im Speicher des Routers (nicht im Bild)
  let hero = null;
  const onPlay = (item) => playItem({ itemId: item.Id, resume: true });
  const onPlaySeries = (item) => playSeries(item);
  let loadSeq = 0; // juengstes Laden: ein ueberholtes (zwei Aenderungen kurz hintereinander) setzt nichts mehr ein
  let stale = false; // der Stand eines Eintrags hat sich geaendert, waehrend die Startseite im Speicher lag
  let loadedOnce = false; // die Reihen standen schon einmal (erst dann gibt es ein Banner, das beim Neuladen stehen bleiben kann)
  const reload = () => load({ soft: loadedOnce }).catch(() => {}); // scheitert es, bleibt die Startseite, wie sie war

  /**
   * Reihe "Filme im Trend" (Seerr) an der Stelle von `slot`: nur mit Seerr und nur mit Titeln (Entscheidung E8 wie die Apple-App: kein Hinweis zum Einrichten,
   * bei einem Ausfall oder einer abgelaufenen Anmeldung keine leere Reihe). Die Reihen der Mediathek warten nicht darauf.
   */
  function fillTrending(slot) {
    dropForeignTrend();
    loadTrending()
      .then((list) => {
        if (destroyed) return;
        if (!list.length) return slot.remove();
        const sec = row(t('home.trending'), list, { sub: t('home.trendingSub'), render: (r, i) => requestCard(r, i) });
        sec.classList.add('trend-row');
        takePlace(slot, sec);
        syncEmpty();
      })
      .catch(() => {
        if (!destroyed) slot.remove();
      });
  }

  /**
   * Platz einer Top-10-Reihe (rankings.js, wie RankingStore der Apple-App): die Reihe von vorhin, beim ersten Laden Platzhalter, sonst nichts Sichtbares. Die
   * Startseite wartet nie auf die Rangliste.
   */
  function topSlot(kind, memo, first) {
    const items = memo?.result?.[kind] ?? [];
    if (items.length) return topTenRow(kind, { items, caption: Rankings.caption(memo.result.window, getLocale()), onPlay });
    if (first) return topTenRow(kind, { loading: true, caption: Rankings.caption(topWindow(), getLocale()) });
    return h('div', { class: 'top10-slot', hidden: true });
  }

  /** Fuellt die Plaetze der Top 10, sobald die Rueckseite antwortet. Ohne Quelle oder ohne passende Titel fehlt die Reihe; scheitert es, bleibt, was dastand. */
  function fillTopTen(slots) {
    const key = topKey();
    const force = forceTopTen;
    forceTopTen = false;
    const put = (kind, next) => {
      takePlace(slots[kind], next);
      slots[kind] = next;
    };
    window.jc
      .topTen({ window: topWindow(), force })
      .then((r) => {
        const result = r?.available ? { window: r.window, movies: r.movies ?? [], series: r.series ?? [] } : null;
        topMemory = { key, result };
        if (destroyed) return;
        for (const kind of Object.keys(slots)) {
          const items = result?.[kind] ?? [];
          put(kind, items.length ? topTenRow(kind, { items, caption: Rankings.caption(result.window, getLocale()), onPlay }) : h('div', { class: 'top10-slot', hidden: true }));
        }
        syncEmpty();
      })
      .catch((e) => {
        if (e?.code === 'RANKINGS_STALE') return; // gehoert zu einem vorigen Profil
        // Gescheitert: die Reihen von vorhin bleiben stehen; Platzhalter gehen, und beim naechsten Aufbau kommen keine mehr
        if (topMemory?.key !== key) topMemory = { key, result: null };
        if (destroyed) return;
        for (const kind of Object.keys(slots)) if (slots[kind].classList.contains('loading')) put(kind, h('div', { class: 'top10-slot', hidden: true }));
      });
  }

  /**
   * Stelle jeder Reihe, solange sie neu aufgebaut wird (Neu laden nach einer Aenderung): eine Reihe, die wiederkommt, steht an derselben Stelle wie vorher,
   * auch wenn sie erst spaeter kommt (Top 10, Trends).
   */
  let keptScroll = new Map();
  const restoreScroll = (node) => {
    const left = keptScroll.get(node.dataset?.row);
    const scroller = node.querySelector?.(':scope > .row-body > .scroller');
    if (left && scroller) scroller.scrollTo({ left, behavior: 'instant' });
  };
  /** Ein Platz (Seerr-Reihe) wird zur Reihe oder verschwindet: die Reihe uebernimmt seine Kennung und ihre alte Stelle. */
  function takePlace(slot, next) {
    if (slot.dataset.row) next.dataset.row = slot.dataset.row;
    slot.replaceWith(next);
    restoreScroll(next);
  }

  /** "Noch nichts da" gilt nur, solange weder Banner noch eine Reihe dasteht: kommt eine Reihe von Seerr dazu, geht der Hinweis (wie die Apple-App). */
  let emptyShown = false;
  function syncEmpty() {
    if (!emptyShown || destroyed) return;
    if ([...rows.children].some((c) => !c.hidden && c.matches('section.row:not(.loading)'))) {
      showPageStatus(el, null);
      emptyShown = false;
    }
  }

  /**
   * Startseite laden. soft: neu laden, nachdem sich der Stand eines Eintrags geaendert hat (Kontextmenue, Detailseite): das Banner bleibt stehen, die Reihen
   * wechseln in einem Zug ohne Platzhalter und ohne Einblenden, jede an ihrer Stelle.
   */
  async function load({ soft = false } = {}) {
    const mine = ++loadSeq;
    const cfg = HomeRows.homeConfig(state.settings.home); // Anpassung der Startseite (Einstellungen > Startseite)
    const libs = state.views.filter((v) => SUPPORTED_COLLECTIONS.has(v.CollectionType));
    // Die Neuzugaenge je Bibliothek laufen gleichzeitig mit den anderen Abfragen (frueher erst danach: eine Wartezeit mehr bis zur fertigen Startseite)
    const latestAll = Promise.all(libs.filter((v) => ['movies', 'tvshows'].includes(v.CollectionType)).map(async (v) => ({ view: v, items: await api.getLatest(v.Id, LATEST_PER_ROW).catch(() => []) })));
    const [resume, nextUp, favorites] = await Promise.all([
      api.getResume(16).catch(() => []),
      api.getNextUp(16).catch(() => []),
      api.getItems({ filters: 'IsFavorite', recursive: true, includeItemTypes: 'Movie,Series', limit: 20, sortBy: 'DateCreated', sortOrder: 'Descending' }).then((r) => r.Items ?? []).catch(() => [])
    ]);
    const latestPerLib = await latestAll;
    if (destroyed || mine !== loadSeq) return;

    keptScroll = soft ? new Map([...rows.querySelectorAll(':scope > [data-row]')].map((r) => [r.dataset.row, r.querySelector(':scope > .row-body > .scroller')?.scrollLeft ?? 0])) : new Map();
    rows.replaceChildren();
    rows.classList.toggle('settled', soft); // nur beim ersten Aufbau steigen die Karten ein
    showPageStatus(el, null);
    emptyShown = false;
    if (!soft) {
      heroHost.replaceChildren();
      el.classList.toggle('no-hero', !cfg.hero);
    }

    // Banner (wie die Apple-App, Entscheidung E8): nur Neues aus der Mediathek, Filme und Serien abwechselnd, jeweils die neuesten zuerst, nur mit
    // Hintergrundbild, so viele Folien wie eingestellt. Keine Titel aus Seerr und kein Weiterschauen darin.
    const entries = [];
    if (cfg.hero && !soft) {
      const withBackdrop = (list) => list.filter((i) => backdropOf(i));
      const movies = withBackdrop(latestPerLib.filter((l) => l.view.CollectionType !== 'tvshows').flatMap((l) => l.items));
      const shows = withBackdrop(latestPerLib.filter((l) => l.view.CollectionType === 'tvshows').flatMap((l) => l.items));
      const seen = new Set();
      const add = (item, kind) => {
        const key = item.SeriesId ?? item.Id;
        if (entries.length >= cfg.heroSlides || seen.has(key)) return;
        seen.add(key);
        entries.push({ item, kind });
      };
      for (let i = 0; i < Math.max(movies.length, shows.length) && entries.length < cfg.heroSlides; i++) {
        if (movies[i]) add(movies[i], 'movies');
        if (shows[i]) add(shows[i], 'series');
      }
    }
    if (soft) {
      // Neu laden nach einer Aenderung: das Banner bleibt stehen, nur "Fortsetzen"/"Abspielen" folgt dem neuen Stand
      hero?.refresh(new Map(latestPerLib.flatMap((l) => l.items).map((i) => [i.Id, i])));
    } else if (!cfg.hero) {
      /* Banner ausgeschaltet: kein Platzhalter, die Reihen beginnen unter der Kopfleiste (.home.no-hero) */
    } else if (entries.length) {
      const tr = state.settings.trailer ?? {};
      hero = createHero(entries, {
        autoplay: state.settings.appearance.heroAutoplay,
        // Trailer im Banner: Einstellungen "Trailer automatisch abspielen" und "Auch auf der Startseite"; ohne Netz gar nicht erst versuchen (sonst wartete jede Folie auf den Zeitablauf)
        trailers: tr.autoplay && tr.home !== false && navigator.onLine !== false ? tr : null
      });
      heroHost.append(hero.el);
      if (away) hero.pause(); // schon wieder weg, bevor die Daten da waren: nichts starten
    } else {
      heroHost.append(h('div', { class: 'hero-empty' }));
    }
    if (!soft) refreshGlow(); // Ambient Glow: das Banner steht jetzt (Reichweite von unten, oberer Schein erst ohne Banner)

    // Reihen in der Standardreihenfolge aus HomeRows.defaultOrder (Weiterschauen, Als Naechstes, Top 10, Neuzugaenge je Bibliothek, Favoriten, Filme im Trend);
    // der Nutzer kann sie umordnen und ausblenden (Einstellungen > Startseite, je Profil). Die Reihen von Seerr (Top 10, Filme im Trend) gibt es nur mit
    // Seerr; sie kommen als Platz an ihre Stelle und fuellen sich, sobald Seerr geantwortet hat.
    const builders = new Map();
    const offer = (id, build) => builders.set(id, build);
    if (resume.length) offer('continue', () => row(t('home.continue'), resume, { variant: 'landscape', onPlay }));
    for (const { view, items } of latestPerLib) {
      if (items.length) offer(`latest:${view.Id}`, () => row(t('home.latestIn', { name: view.Name }), items, { href: `#/library/${view.Id}`, onPlay: onPlaySeries }));
    }
    if (nextUp.length) offer('nextUp', () => row(t('home.nextUp'), nextUp, { variant: 'landscape', onPlay }));
    if (favorites.length) offer('favorites', () => row(t('home.favorites'), favorites, { onPlay: onPlaySeries }));
    const contentRows = builders.size;
    let trendSlot = null;
    const topSlots = {};
    if (state.seerr) {
      offer('trending', () => (trendSlot = h('div', { class: 'trend-slot', hidden: true })));
      // Top 10 nur mit Titeln der Mediathek: ist sie leer, gibt es nichts zu ordnen. Platzhalter nur beim ersten Laden und nur, wenn Seerr nicht
      // gerade als nicht erreichbar oder abgemeldet bekannt ist
      if (contentRows) {
        const memo = topMemory?.key === topKey() ? topMemory : null;
        const first = !memo && ['connected', 'checking'].includes(seerrState());
        for (const kind of ['movies', 'series']) offer(Rankings.KINDS[kind].row, () => (topSlots[kind] = topSlot(kind, memo, first)));
      }
    }
    const present = HomeRows.defaultOrder(latestPerLib.map((l) => l.view.Id)).filter((id) => builders.has(id));
    const shown = HomeRows.arrangeRows(present, cfg.order, cfg.hidden);
    for (const id of shown) {
      const node = builders.get(id)();
      node.dataset.row = id;
      rows.append(node);
      restoreScroll(node);
    }
    loadedOnce = true;
    if (!contentRows) {
      // Nichts aus der Mediathek (und damit auch kein Banner): "Noch nichts da" fuer die ganze Seite; kommt eine Reihe von Seerr, geht der Hinweis
      showPageStatus(el, pageStatus({ symbol: 'film', title: t('home.emptyTitle'), text: t('home.emptyText') }));
      emptyShown = true;
    } else if (!shown.length) {
      // Alles ausgeblendet: der Weg in die Einstellungen, fuer die ganze Seite oder unter dem Banner
      const status = pageStatus({ kind: 'action', symbol: 'settings', title: t('home.allHiddenTitle'), text: t('home.allHiddenText'), action: { label: t('toast.openSettings'), href: '#/settings/home' }, inline: !!hero });
      if (hero) rows.prepend(status);
      else showPageStatus(el, status);
    }
    if (trendSlot) fillTrending(trendSlot);
    if (Object.keys(topSlots).length) fillTopTen(topSlots);
  }

  /** Startseite laden; scheitert es, steht der Fehler fuer die ganze Seite da (ohne Banner und Platzhalter), "Erneut versuchen" baut sie neu auf. */
  function start() {
    return load().catch((e) => {
      if (destroyed) return;
      hero?.destroy();
      hero = null;
      heroHost.replaceChildren();
      rows.replaceChildren();
      el.classList.add('no-hero');
      showPageStatus(el, pageStatus({ kind: 'failed', text: e.message, retry: () => {
        showPageStatus(el, null);
        placeholders();
        return start();
      } }));
      if (e.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
    });
  }
  start();

  return {
    el,
    deactivate() {
      away = true;
      hero?.pause();
    },
    activate() {
      away = false;
      hero?.resume();
      if (stale) {
        stale = false;
        reload();
      }
    },
    /** Der Stand eines Eintrags hat sich geaendert (actions.js itemStateChanged): Weiterschauen, Als Naechstes, Favoriten und die Haken neu vom Server. */
    itemChanged() {
      if (destroyed) return;
      if (away) stale = true;
      else reload();
    },
    destroy() {
      destroyed = true;
      hero?.destroy();
    }
  };
}
