import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api, backdropOf, landscapeOf, logoOf, itemHref, mapImage } from '../api.js';
import { state, updateSettings, SUPPORTED_COLLECTIONS } from '../state.js';
import { lazyImage, row, skeletonRow, badges, mediaBadges, titleOf, toast } from '../ui.js';
import { fmtDuration, ticksToSec } from '../utils.js';
import { playItem, resolveSeriesTarget } from '../actions.js';
import { setAmbient } from '../ambient.js';
import { createTrailer } from '../trailer.js';
import { navigate } from '../router.js';
import { requestCard, requestOne } from './request-card.js';
import { openRequestDetail } from './request-detail.js';

const Media = window.JCMedia;
const HomeRows = window.JCHomeRows; // Anpassung der Startseite (src/shared/home-rows.js); Folien im Banner und Trend-Folien kommen aus den Einstellungen
const HERO_MS = 9000; // so lange bleibt eine Folie ohne Trailer stehen
const HERO_AFTER_TRAILER_MS = 1200; // nach dem Ende eines Trailers noch kurz das Bild, dann geht es weiter
const LATEST_PER_ROW = 30;
const TREND_TTL_MS = 10 * 60 * 1000; // so lange gilt die Liste der Trend-Filme, bevor Seerr wieder gefragt wird

const TREND_MIN_RATING = 7; // ab dieser TMDB-Bewertung (0 bis 10) gilt ein Trend-Film als gut bewertet
const TREND_WAIT_MS = 1500; // so lange wartet der Aufbau des Banners hoechstens auf die Trend-Liste (danach ohne Trend-Folien, die Reihe darunter kommt trotzdem)

/**
 * Filme im Trend von Seerr. Die Startseite wird oft neu aufgebaut (etwa nach jedem Film): innerhalb von TREND_TTL_MS kommt die Liste aus dem Speicher. Gemerkt wird das laufende
 * Versprechen (nicht erst das Ergebnis): Banner und Reihe fragen so nur einmal, auch wenn Seerr langsam ist; ein Fehlschlag wird nicht gemerkt.
 */
let trendCache = null; // { key, at, list: Promise }
function loadTrending() {
  const key = `${state.seerr?.url}|${state.seerr?.userName}`;
  if (trendCache && trendCache.key === key && Date.now() - trendCache.at < TREND_TTL_MS) return trendCache.list;
  const entry = { key, at: Date.now(), list: window.jc.seerrTrending() };
  trendCache = entry;
  entry.list.catch(() => {
    if (trendCache === entry) trendCache = null;
  });
  return entry.list;
}

/** Wartet hoechstens `ms` auf ein Versprechen; danach kommt `fallback` (das Versprechen selbst laeuft weiter). */
function within(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]).finally(() => clearTimeout(timer));
}

/** Bibliothekseintrag (Film mit Bild) zu einem Seerr-Titel ueber die TMDB-Nummer, sonst null. */
async function libraryMatch(r) {
  try {
    const res = await api.getItems({ anyProviderIdEquals: `tmdb.${r.id}`, includeItemTypes: 'Movie', recursive: true, limit: 1 });
    const item = res.Items?.[0];
    return item && (backdropOf(item) || landscapeOf(item)) ? item : null;
  } catch {
    return null;
  }
}

/**
 * Bis zu `count` (Einstellung "Trend-Filme im Banner") gut bewertete Filme aus dem Trend fuers Banner, in der Reihenfolge von Seerr: Bewertung ab TREND_MIN_RATING und ein Hintergrundbild. Ist ein Titel
 * laut Seerr schon da (verfuegbar oder teilweise) und in der Bibliothek zu finden, kommt dessen Bibliotheksfolie mit "Abspielen" statt der Folie mit "Details" (Anfrage).
 * Leer: ohne Seerr, bei ausgeschaltetem Schalter, ohne Treffer oder wenn Seerr nicht binnen TREND_WAIT_MS antwortet.
 * @returns {Promise<({ kind: 'trend', item: object } | { kind: 'trend', seerr: object })[]>}
 */
async function trendEntries(count) {
  if (!state.seerr || state.settings.appearance.homeTrending === false || !(count > 0)) return [];
  try {
    const list = await within(loadTrending(), TREND_WAIT_MS, []);
    const picks = list.filter((r) => r.rating >= TREND_MIN_RATING && r.backdropPath).slice(0, count);
    return await Promise.all(
      picks.map(async (r) => {
        const item = r.status === 4 || r.status === 5 ? await libraryMatch(r) : null;
        return item ? { kind: 'trend', item } : { kind: 'trend', seerr: r };
      })
    );
  } catch {
    return []; // Seerr nicht erreichbar oder Anmeldung abgelaufen: das Banner bleibt wie es war (die Reihe darunter zeigt den Hinweis)
  }
}

function metaLine(item) {
  const bits = [];
  if (item.Type === 'Episode') bits.push(`${item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}:` : ''}E${item.IndexNumber ?? '?'} · ${item.Name}`);
  else if (item.ProductionYear) bits.push(String(item.ProductionYear));
  if (item.OfficialRating) bits.push(h('span', { class: 'rating-box' }, item.OfficialRating));
  if (item.RunTimeTicks) bits.push(fmtDuration(ticksToSec(item.RunTimeTicks)));
  if (item.CommunityRating) bits.push(h('span', { class: 'score' }, icon('star', 14), item.CommunityRating.toFixed(1)));
  return bits;
}

function heroSlide(entry, first) {
  const { item, kind } = entry;
  const bd = backdropOf(item, 1920) ?? landscapeOf(item, 1280);
  const logo = logoOf(item, 640);
  const label = kind === 'resume' ? t('home.continue') : kind === 'next' ? t('home.nextUp') : kind === 'trend' ? t('home.trendLabel') : t('home.new');
  const hasProgress = (item.UserData?.PlaybackPositionTicks ?? 0) > 0;

  const slide = h('article', { class: 'hero-slide' });
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
  const b = badges(mediaBadges(item), { max: 3 });
  if (b) meta.append(b);
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
        h('span', null, hasProgress ? t('action.resume') : t('action.play'))
      ),
      h('a', { class: 'btn glass lg', href: itemHref(item) }, icon('info', 20), h('span', null, t('action.details')))
    )
  );
  slide.append(content);
  return slide;
}

/**
 * Folie fuer einen gut bewerteten Trend-Film von Seerr, der nicht in der Bibliothek liegt: Hintergrundbild von TMDB (ueber das App-Protokoll), Angaben aus der Trend-Liste,
 * "Details" oeffnet das Fenster zum Anfragen (wie bei den Karten der Reihe), "Anfragen" fragt gleich an. Der Titel steht als Text (kein Logo).
 */
function seerrSlide(entry, first) {
  const r = entry.seerr;
  const slide = h('article', { class: 'hero-slide' });
  slide._hash = null; // kein Hintergrundton bekannt (er kommt sonst aus dem Bild der Bibliothek)
  slide.append(lazyImage({ url: mapImage(`jellycloud://tmdb/w1280${r.backdropPath}`), hash: null }, { cls: 'hero-bg', eager: first }), h('div', { class: 'hero-shade' }));

  const content = h('div', { class: 'hero-content' }, h('span', { class: 'hero-label' }, t('home.trendLabel')), h('h1', { class: 'hero-title' }, r.title));
  const standTag = h('span', { class: 'rating-box' }); // Stand bei Seerr (Angefragt, Verfuegbar ...), nur wenn schon etwas angefragt ist
  const bits = [r.year ? String(r.year) : null, h('span', { class: 'score' }, icon('star', 14), r.rating.toFixed(1)), t('seerr.movie'), standTag].filter(Boolean);
  content.append(h('div', { class: 'hero-meta' }, bits.map((b) => (typeof b === 'string' ? h('span', null, b) : b))));
  if (r.overview) content.append(h('p', { class: 'hero-overview' }, r.overview));

  const details = h('button', { class: 'btn primary lg', type: 'button' }, icon('info', 20), h('span', null, t('action.details')));
  const ask = h('button', { class: 'btn glass lg', type: 'button' }, icon('plus', 20), h('span', null, t('seerr.request')));
  const paint = () => {
    const open = r.status <= 1 || r.status === 6; // unbekannt oder geloescht: anfragen moeglich
    ask.hidden = !open;
    standTag.hidden = open;
    standTag.textContent = open ? '' : t(`seerr.status.${r.status}`);
  };
  paint();
  const askFromDetails = async () => {
    await requestOne(r);
    paint();
  };
  details.addEventListener('click', () => openRequestDetail({ item: r, request: askFromDetails, onStatus: paint, returnTo: details }));
  ask.addEventListener('click', async () => {
    ask.disabled = true;
    try {
      await requestOne(r);
    } finally {
      ask.disabled = false;
      paint();
    }
  });
  content.append(h('div', { class: 'hero-actions' }, details, ask));
  slide.append(content);
  return slide;
}

/**
 * Hero-Banner mit automatischem Wechsel. Mit `trailers` (die Trailer-Einstellungen) spielt die aktive Folie ihren Trailer im Hintergrund ab (wie auf der
 * Detailseite): das Banner bleibt dann stehen, bis der Trailer zu Ende ist, und geht danach weiter. Laesst er sich nicht abspielen, gilt wieder die normale Zeit.
 */
function createHero(entries, { autoplay, onActive, trailers = null }) {
  const el = h('section', { class: 'hero', 'aria-roledescription': 'carousel' });
  const slides = entries.map((e, i) => (e.seerr ? seerrSlide(e, i === 0) : heroSlide(e, i === 0)));
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
      const { item, seerr } = entries[i];
      // Seerr-Folie: der Trailer steht in den Details bei Seerr (relatedVideos, nur ein YouTube-Schluessel); Bibliotheksfolie: aus dem vollstaendigen Eintrag
      videoIds.set(
        i,
        seerr
          ? window.jc.seerrDetails({ mediaType: seerr.mediaType, mediaId: seerr.id }).then((d) => d?.trailerKey ?? null).catch(() => null)
          : api.getItem(item.SeriesId ?? item.Id).then((full) => Media.trailerVideoId(full)).catch(() => null)
      );
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
  const el = h('div', { class: 'page home' });
  const heroHost = h('div', { class: 'hero-host' });
  const rows = h('div', { class: 'rows' });
  el.append(heroHost, rows);
  rows.append(skeletonRow('poster', 9), skeletonRow('landscape', 5));
  const heroOn = HomeRows.homeConfig(state.settings.home).hero; // ohne Banner gibt es auch keinen Platzhalter dafuer
  el.classList.toggle('no-hero', !heroOn);
  if (heroOn) heroHost.append(h('div', { class: 'hero hero-skeleton' }, h('div', { class: 'sk' })));

  let destroyed = false;
  let away = false; // die Startseite liegt gerade im Speicher des Routers (nicht im Bild)
  let hero = null;
  const showBadges = state.settings.appearance.showBadges;
  const onPlay = (item) => playItem({ itemId: item.Id, resume: true });
  const onPlaySeries = async (item) => {
    if (item.Type !== 'Series') return onPlay(item);
    const { episode, resume } = await resolveSeriesTarget(item.Id);
    if (episode) playItem({ itemId: episode.Id, resume });
    else toast(t('toast.noEpisodes'), { type: 'error' });
  };

  /**
   * Reihe "Filme im Trend" (Seerr) an der Stelle von `slot` (ein Platzhalter an der gewuenschten Position in der Reihenfolge). Ohne Verbindung ein Hinweis, wie man sie bekommt;
   * die Bibliotheks-Reihen warten nicht darauf. Gibt es nichts zu zeigen, verschwindet der Platzhalter.
   */
  function fillTrending(slot) {
    if (!state.seerr) {
      slot.replaceWith(trendingHint());
      return;
    }
    loadTrending()
      .then((list) => {
        if (destroyed) return;
        if (!list.length) return slot.remove();
        const sec = row(t('home.trending'), list, { sub: t('home.trendingSub'), render: (r, i) => requestCard(r, i) });
        sec.classList.add('trend-row');
        slot.replaceWith(sec);
      })
      .catch((e) => {
        if (destroyed) return;
        // Abgelaufene Seerr-Anmeldung sagt es und zeigt den Weg; sonst (Seerr gerade nicht erreichbar) bleibt die Startseite ohne die Reihe
        if (e.code !== 'SEERR_AUTH') return slot.remove();
        slot.replaceWith(h('section', { class: 'row trend-row' }, h('div', { class: 'row-head' }, h('h2', null, t('home.trending'))), h('p', { class: 'seerr-note' }, t('seerr.authExpired'), h('a', { class: 'link-btn', href: '#/settings/seerr' }, ` ${t('toast.openSettings')}`))));
      });
  }

  function trendingHint() {
    const hide = h('button', { class: 'btn glass', type: 'button' }, t('home.trendingHide'));
    const sec = h(
      'section',
      { class: 'row trend-row trend-hint' },
      h('div', { class: 'row-head' }, h('h2', null, t('home.trending')), h('span', { class: 'sub' }, t('home.trendingSub'))),
      h(
        'div',
        { class: 'trend-hint-box' },
        h(
          'div',
          { class: 'trend-hint-text' },
          h('h3', null, t('home.trendingHintTitle')),
          h('p', null, t('home.trendingHintText')),
          h('div', { class: 'trend-hint-actions' }, h('a', { class: 'btn primary', href: '#/settings/seerr' }, icon('plus', 18), h('span', null, t('home.trendingSetup'))), hide)
        ),
        h('div', { class: 'trend-ghosts', 'aria-hidden': 'true' }, Array.from({ length: 6 }, () => h('i')))
      )
    );
    hide.addEventListener('click', async () => {
      sec.remove();
      try {
        await updateSettings({ appearance: { homeTrending: false } });
      } catch {
        /* bleibt bis zum naechsten Aufbau weg */
      }
      toast(t('home.trendingHidden'), { action: { label: t('toast.openSettings'), run: () => navigate('/settings/home') } });
    });
    return sec;
  }

  (async () => {
    const cfg = HomeRows.homeConfig(state.settings.home); // Anpassung der Startseite (Einstellungen > Startseite)
    const libs = state.views.filter((v) => SUPPORTED_COLLECTIONS.has(v.CollectionType));
    // Die Neuzugaenge je Bibliothek laufen gleichzeitig mit den anderen Abfragen (frueher erst danach: eine Wartezeit mehr bis zur fertigen Startseite)
    const latestAll = Promise.all(libs.filter((v) => ['movies', 'tvshows'].includes(v.CollectionType)).map(async (v) => ({ view: v, items: await api.getLatest(v.Id, LATEST_PER_ROW).catch(() => []) })));
    const [resume, nextUp, favorites, trend] = await Promise.all([
      api.getResume(16).catch(() => []),
      api.getNextUp(16).catch(() => []),
      api.getItems({ filters: 'IsFavorite', recursive: true, includeItemTypes: 'Movie,Series', limit: 20, sortBy: 'DateCreated', sortOrder: 'Descending' }).then((r) => r.Items ?? []).catch(() => []),
      cfg.hero ? trendEntries(cfg.heroTrend) : [] // laeuft gleichzeitig mit den Bibliotheksabfragen (Seerr, hoechstens TREND_WAIT_MS) und wirft nie
    ]);
    const latestPerLib = await latestAll;
    if (destroyed) return;

    rows.replaceChildren();
    heroHost.replaceChildren();
    el.classList.toggle('no-hero', !cfg.hero);

    // Hero: vor allem Neuzugaenge (Filme und Serien abwechselnd, jeweils die neuesten zuerst, nur mit Hintergrundbild). Nur wenn es kaum Neues gibt,
    // kommen Weiterschauen und Als Naechstes dazu, damit das Banner nicht fast leer ist. Dazwischen (an dritter und fuenfter Stelle) stehen bis zu so viele gut bewertete
    // Trend-Filme (Seerr, siehe trendEntries), wie eingestellt sind; sie nehmen Platz von den Neuzugaengen, das Banner hat weiter cfg.heroSlides Folien. Ein Trend-Film aus der
    // Bibliothek steht nur einmal im Banner (als Trend-Folie, nicht noch einmal als Neuzugang). Ist das Banner ausgeschaltet, gibt es nichts davon.
    const seen = new Set(trend.filter((e) => e.item).map((e) => e.item.SeriesId ?? e.item.Id));
    const libEntries = [];
    const add = (item, kind) => {
      const key = item.SeriesId ?? item.Id;
      if (libEntries.length >= cfg.heroSlides - trend.length || seen.has(key) || (!backdropOf(item) && !landscapeOf(item))) return;
      seen.add(key);
      libEntries.push({ item, kind });
    };
    const longest = Math.max(0, ...latestPerLib.map(({ items }) => items.length));
    if (cfg.hero) {
      for (let k = 0; k < longest; k++) latestPerLib.forEach(({ items }) => items[k] && add(items[k], 'new'));
      if (libEntries.length < Math.min(3, cfg.heroSlides)) {
        resume.slice(0, 3).forEach((i) => add(i, 'resume'));
        nextUp.slice(0, 2).forEach((i) => add(i, 'next'));
      }
    }
    const entries = [...libEntries];
    trend.forEach((e, k) => entries.splice(Math.min(2 + 2 * k, entries.length), 0, e));
    if (!cfg.hero) {
      /* Banner ausgeschaltet: kein Platzhalter, die Reihen beginnen unter der Kopfleiste (.home.no-hero) */
    } else if (entries.length) {
      const tr = state.settings.trailer ?? {};
      hero = createHero(entries, {
        autoplay: state.settings.appearance.heroAutoplay,
        onActive: (hash) => setAmbient(el, hash),
        // Trailer im Banner: Einstellungen "Trailer automatisch abspielen" und "Auch auf der Startseite"; ohne Netz gar nicht erst versuchen (sonst wartete jede Folie auf den Zeitablauf)
        trailers: tr.autoplay && tr.home !== false && navigator.onLine !== false ? tr : null
      });
      heroHost.append(hero.el);
      if (away) hero.pause(); // schon wieder weg, bevor die Daten da waren: nichts starten
    } else {
      heroHost.append(h('div', { class: 'hero-empty' }));
    }

    // Reihen: Standardreihenfolge ist Weiterschauen (ganz oben), Neuzugaenge je Bibliothek, Als Naechstes, Favoriten, Filme im Trend (wie HomeRows.defaultOrder); der Nutzer kann sie umordnen und ausblenden
    // (Einstellungen > Startseite). "Filme im Trend" kommt als Platzhalter an seinen Platz und fuellt sich, sobald Seerr geantwortet hat.
    const builders = new Map();
    const present = [];
    const offer = (id, build) => {
      present.push(id);
      builders.set(id, build);
    };
    if (resume.length) offer('continue', () => row(t('home.continue'), resume, { variant: 'landscape', onPlay }));
    for (const { view, items } of latestPerLib) {
      if (items.length) offer(`latest:${view.Id}`, () => row(t('home.latestIn', { name: view.Name }), items, { href: `#/library/${view.Id}`, showBadges, onPlay: onPlaySeries }));
    }
    if (nextUp.length) offer('nextUp', () => row(t('home.nextUp'), nextUp, { variant: 'landscape', onPlay }));
    if (favorites.length) offer('favorites', () => row(t('home.favorites'), favorites, { showBadges, onPlay: onPlaySeries }));
    const contentRows = present.length;
    let trendSlot = null;
    offer('trending', () => (trendSlot = h('div', { class: 'trend-slot', hidden: true })));
    const hidden = state.settings.appearance.homeTrending === false ? [...cfg.hidden, 'trending'] : cfg.hidden; // "Filme im Trend" schaltet die Einstellung aus Erscheinungsbild/Startseite
    const shown = HomeRows.arrangeRows(present, cfg.order, hidden);
    for (const id of shown) rows.append(builders.get(id)());
    if (!contentRows) {
      rows.prepend(h('div', { class: 'empty' }, icon('film', 40), h('h3', null, t('home.emptyTitle')), h('p', null, t('home.emptyText'))));
    } else if (!rows.children.length) {
      rows.append(h('div', { class: 'empty' }, icon('settings', 40), h('h3', null, t('home.allHiddenTitle')), h('p', null, t('home.allHiddenText')), h('a', { class: 'btn primary', href: '#/settings/home' }, t('toast.openSettings'))));
    }
    if (trendSlot) fillTrending(trendSlot);
  })().catch((e) => {
    if (destroyed) return;
    rows.replaceChildren(h('div', { class: 'empty error' }, icon('info', 40), h('h3', null, t('error.loadFailed')), h('p', null, e.message)));
    if (e.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
  });

  return {
    el,
    deactivate() {
      away = true;
      hero?.pause();
    },
    activate() {
      away = false;
      hero?.resume();
    },
    destroy() {
      destroyed = true;
      hero?.destroy();
    }
  };
}
