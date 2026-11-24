import { h, icon, $ } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { api, backdropOf, landscapeOf, posterOf, logoOf, isFolder } from '../api.js';
import { state, updateSettings } from '../state.js';
import { infoBlock, lazyImage, openMenu, pageStatus, refreshCards, row, showPageStatus, titleOf, toast, closeMenu } from '../ui.js';
import { mediaTagRow } from '../tags.js';
import { richText, looksLikeHtml } from '../rich-text.js';
import { setAmbient } from '../ambient.js';
import { endsAt, fmtBitrate, fmtDuration, fmtSize, langName, ticksToSec } from '../utils.js';
import { attachItemMenu, itemStateChanged, playItem, toggleFavorite, toggleWatched } from '../actions.js';
import { navigate } from '../router.js';
import { createTrailer } from '../trailer.js';
import { editMetadata, identifyItem, deleteItem as deleteItemAdmin } from './admin-item.js';
import { canReportIssue, openIssueDialog } from './issue-dialog.js';
import { castRow } from './cast-row.js';

const Media = window.JCMedia;
const Tags = window.JCMediaTags; // Tags der Datei in der Reihenfolge der Detailseite (src/shared/media-tags.js)
const Format = window.JCFormat; // Schreibweisen der Angabenzeilen und von "Abspielen" (src/shared/format.js)
const SeasonChoice = window.JCSeasonChoice; // welche Staffel zuerst (src/shared/season-choice.js)
const DetailFacts = window.JCDetailFacts; // Informationsblock (src/shared/detail-facts.js)

function streamLabel(s) {
  const parts = [];
  const lang = langName(s.Language);
  if (s.DisplayTitle) return s.DisplayTitle;
  if (lang) parts.push(lang);
  if (s.Codec) parts.push(String(s.Codec).toUpperCase());
  if (s.Channels) parts.push(`${s.Channels}ch`);
  return parts.join(' · ') || `#${s.Index}`;
}

const MANY_SUBS = 8; // ab mehr Untertitelspuren wird die Liste nach Sprache geordnet und gekuerzt

/** Sprachen, die man bei den Untertiteln wahrscheinlich will: die eingestellte Untertitelsprache, die Sprache der Oberflaeche, die der gewaehlten Tonspur, zuletzt Englisch. */
function wantedSubLanguages(audioLanguage) {
  const p = state.settings.player ?? {};
  return [p.subtitleLanguage && p.subtitleLanguage !== 'server' ? p.subtitleLanguage : null, getLocale(), audioLanguage, 'en'].filter(Boolean);
}

/** Der Titel einer normalen Spur, wenn er mehr verraet als die Sprache (etwa "Signs & Songs", "Kommentar"); sonst leer. */
function informativeTitle(s) {
  const title = String(s.Title ?? '').trim();
  if (!title || title.length > 40) return '';
  const english = (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(Media.langCode(s.Language)) ?? '';
    } catch {
      return '';
    }
  })();
  let rest = title.toLowerCase();
  for (const w of [langName(s.Language), english, String(s.Language ?? ''), Media.langCode(s.Language), 'forced', 'erzwungen', 'sdh', 'full', 'vollständig', 'voll', 'default', 'standard', 'subtitles', 'untertitel']) {
    if (w) rest = rest.split(w.toLowerCase()).join(' ');
  }
  return rest.replace(/[^\p{L}\p{N}]+/gu, '') ? title : '';
}

/** Sprachgruppen nach Name sortieren, die ohne Sprachangabe zuletzt. */
const byLanguageName = (a, b) => (a.code === 'und') - (b.code === 'und') || langName(a.code).localeCompare(langName(b.code), getLocale());

/** Eintraege der Untertitelliste bei vielen Spuren: Sprache (mit Art und Nummer) je Zeile; Weitere Sprachen eingeklappt (expanded: aufgeklappt, nach Name sortiert). */
function groupedSubtitleEntries(streams, selectedIndex, off, expanded) {
  const selected = streams.find((s) => s.Index === selectedIndex);
  const groups = Media.groupByLanguage(streams, { preferred: wantedSubLanguages(selected && selected.Language), keep: [selected] });
  const kindText = { full: '', forced: t('detail.forced'), sdh: 'SDH' };
  const entriesOf = (group) => {
    const lang = group.code === 'und' ? t('detail.langUnknown') : langName(group.code);
    const kinds = group.tracks.map((s) => Media.subtitleKind(s));
    const seen = {};
    return group.tracks.map((s, i) => {
      const kind = kinds[i];
      const same = kinds.filter((k) => k === kind).length;
      seen[kind] = (seen[kind] ?? 0) + 1;
      const label = [`${lang}${same > 1 ? ` ${seen[kind]}` : ''}`, kindText[kind]].filter(Boolean).join(' · ');
      const detail = [kind === 'full' && informativeTitle(s), s.IsExternal && t('detail.external'), s.Codec && String(s.Codec).toUpperCase()].filter(Boolean).join(' · ');
      return { id: s.Index, label, sub: detail, selected: s.Index === selectedIndex };
    });
  };
  const entries = [off, ...groups.shown.flatMap(entriesOf)];
  if (!groups.more.length) return entries;
  if (expanded || !groups.shown.length) {
    return [...entries, { header: true, label: t('detail.subMoreHead') }, ...[...groups.more].sort(byLanguageName).flatMap(entriesOf)];
  }
  return [...entries, { id: 'more', more: true, label: t('detail.subMore', { n: groups.more.length }), sub: t('detail.subMoreSub', { n: groups.more.reduce((n, g) => n + g.tracks.length, 0) }) }];
}

/** Platzhalter der Detailseite, solange der Titel laedt (Plakat, Titel, zwei Zeilen). */
const loadingPlaceholder = () => h('div', { class: 'detail-loading' }, h('div', { class: 'sk sk-poster' }), h('div', { class: 'sk-stack' }, h('div', { class: 'sk sk-title-lg' }), h('div', { class: 'sk sk-line' }), h('div', { class: 'sk sk-line short' })));

/** Eine richtige Staffel (Nummer ueber 0 oder ohne Nummer), keine Extras: so zaehlt die Angabe "3 Staffeln". */
const realSeason = (s) => s.IndexNumber === null || s.IndexNumber === undefined || Number(s.IndexNumber) > 0;
const resumes = (it) => Format.resumeSeconds(it) !== null;

/**
 * Detailseite eines Films, einer Serie oder einer Folge (wie DetailView der Apple-App): Bildkopf mit Trailer, Titel oder Logo, Angabenzeile, Tags (Gesehen,
 * Formate, Wiedergabe), Knoepfe (Abspielen mit "S1 E3 Fortsetzen ab 12:40", Favorit, Gesehen, Problem melden, Mehr; darunter Von vorn und Trailer), Auswahl
 * von Version, Ton und Untertiteln, Handlung und Genres, Staffeln und Folgen, Besetzung, Aehnliche, Informationen.
 */
export function detailView({ id, query }) {
  const el = h('div', { class: 'page detail' });
  const bd = h('div', { class: 'detail-bd' });
  const body = h('div', { class: 'detail-body' });
  el.append(bd, body);
  body.append(loadingPlaceholder());

  let destroyed = false;
  let trailerCtl = null; // Trailer im Hintergrund (trailer.js)
  let page = null; // was die gezeigte Seite weiss (render): fuer Aenderungen am Stand eines Eintrags (itemChanged)
  const scroller = () => $('#view');
  const onScroll = () => {
    const y = scroller()?.scrollTop ?? 0;
    if (y < 1400) bd.style.setProperty('--sy', y);
  };
  scroller()?.addEventListener('scroll', onScroll, { passive: true });

  /** Titel nicht geladen: der Fehler fuer die ganze Seite; "Erneut versuchen" zeigt wieder den Platzhalter und laedt neu. */
  const failed = (e) => {
    body.replaceChildren();
    showPageStatus(el, pageStatus({ kind: 'failed', text: e.message, retry: () => {
      showPageStatus(el, null);
      body.replaceChildren(loadingPlaceholder());
      return load();
    } }));
  };

  async function load() {
    let item;
    try {
      item = await api.getItem(id);
    } catch (e) {
      if (destroyed) return;
      failed(e);
      if (e.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
      return;
    }
    if (destroyed) return;
    if (item.Type === 'Season') return location.replace(`#/item/${item.SeriesId}?season=${item.Id}`);
    if (isFolder(item)) return location.replace(`#/library/${item.Id}`);
    try {
      await render(item);
    } catch (e) {
      if (!destroyed) failed(e);
    }
  }

  async function render(item) {
    const isSeries = item.Type === 'Series';
    const isEpisode = item.Type === 'Episode';
    const sources = item.MediaSources ?? [];
    const sel = { source: 0, audio: undefined, sub: undefined };
    const cur = () => sources[sel.source] ?? null;
    // Vorauswahl wie im Player: Sprach-Einstellungen, sonst Server-Vorgabe (gleiche Funktion)
    const picks = () => Media.pickStreams(cur(), state.settings.player, getLocale(), state.audioOut?.outChannels);

    // Hintergrund
    const bdImg = backdropOf(item, 1920);
    bd.replaceChildren(lazyImage(bdImg, { cls: 'detail-bd-img', eager: true }), h('div', { class: 'detail-bd-shade' }));
    // Trailer: nach kurzer Verzoegerung ueber dem Hintergrundbild (Einstellungen: Wiedergabe > Trailer)
    trailerCtl?.destroy();
    trailerCtl = null;
    const trailerId = Media.trailerVideoId(item);
    const tr = state.settings.trailer ?? {};
    if (tr.autoplay && trailerId && !isEpisode) trailerCtl = createTrailer({ host: bd, videoId: trailerId, muted: tr.muted !== false, delaySec: tr.delaySec, quality: tr.quality, focusSec: tr.focusSec, focusStyle: tr.focusStyle, volume: tr.volume, onVolume: (v) => updateSettings({ trailer: { volume: v } }).catch(() => {}) });
    setAmbient(el, bdImg?.hash ?? posterOf(item, 560)?.hash); // Hintergrundton der Seite (ambient.js)

    // Serien: naechste Folge und Staffeln zugleich (vorher nacheinander, und die Staffeln wurden zweimal geholt). Die Staffel beim Oeffnen: die gewaehlte
    // (Karte einer Staffel), sonst die der naechsten Folge, sonst die erste richtige, nicht die Extras (SeasonChoice wie die Apple-App)
    let nextUp = null;
    let seasons = [];
    let season = null;
    let seasonEpisodes = null;
    if (isSeries) {
      [nextUp, seasons] = await Promise.all([api.getNextUp(1, item.Id).then((r) => r[0] ?? null, () => null), api.getSeasons(item.Id).catch(() => [])]);
      if (destroyed) return;
      season = seasons.find((s) => s.Id === query?.get('season')) ?? SeasonChoice.initial(seasons, nextUp);
      if (!nextUp && season) {
        seasonEpisodes = await api.getEpisodes(item.Id, season.Id).catch(() => null);
        if (destroyed) return;
      }
    }
    // Was "Abspielen" startet (wie die Apple-App): Film und Folge sich selbst; eine Serie die naechste Folge, sonst die erste Folge der gezeigten Staffel
    let target = isSeries ? nextUp ?? seasonEpisodes?.[0] ?? null : item;

    // Informationen am Ende der Seite: folgen der gewaehlten Version und der ermittelten Wiedergabe (paintInfo)
    const infoHost = h('div', { class: 'detail-information' });

    // ----- Kopf -----
    const poster = isEpisode ? lazyImage(landscapeOf(item, 720), { cls: 'detail-poster landscape', eager: true, fallback: titleOf(item) }) : lazyImage(posterOf(item, 560), { cls: 'detail-poster', eager: true, fallback: titleOf(item) });

    const info = h('div', { class: 'detail-info' });
    // Folge: der Weg zur Serie ist ihr Name vorn in der Angabenzeile (Apple-App Build 95, statt Pfeil bzw. Brotkrume ueber dem Titel)
    const logo = !isEpisode ? logoOf(item, 720) : null;
    if (logo) {
      const l = h('img', { class: 'detail-logo', alt: item.Name, src: logo.url, decoding: 'async' });
      l.addEventListener('error', () => l.replaceWith(h('h1', { class: 'detail-title' }, item.Name)));
      info.append(l);
    } else {
      // Folge: nur ihr Name; "S1 · E3" steht in der Angabenzeile darunter (wie die Apple-App)
      info.append(h('h1', { class: 'detail-title' }, item.Name));
    }
    if (item.Taglines?.[0] && !isEpisode) info.append(h('p', { class: 'tagline' }, item.Taglines[0]));

    // Angabenzeile: alle Schreibweisen aus format.js (Folge, Jahr, Freigabe, Laufzeit, Staffeln, Bewertung); "Endet um" nach der gemerkten Stelle
    const meta = h('div', { class: 'detail-meta' });
    const seasonText = isSeries ? Format.seasonCount(seasons.filter(realSeason).length, getLocale()) : '';
    const paintMeta = () => {
      const parts = [];
      const span = (text, attrs = null) => h('span', attrs, text);
      if (isEpisode && item.SeriesId && item.SeriesName) parts.push(h('a', { class: 'meta-series', href: `#/item/${item.SeriesId}`, 'data-action': 'series-name', 'aria-label': t('detail.toSeries', { name: item.SeriesName }) }, item.SeriesName));
      if (isEpisode && Format.episodeNumbers(item)) parts.push(span(Format.episodeNumbers(item)));
      if (item.ProductionYear) parts.push(span(String(item.ProductionYear)));
      if (item.OfficialRating) parts.push(span(item.OfficialRating, { class: 'rating-box' }));
      if (item.RunTimeTicks) parts.push(span(fmtDuration(ticksToSec(item.RunTimeTicks))));
      if (seasonText) parts.push(span(seasonText));
      if (isSeries && item.Status) parts.push(span(item.Status === 'Continuing' ? t('detail.continuing') : t('detail.ended')));
      if (Format.score(item.CommunityRating)) parts.push(h('span', { class: 'score' }, icon('star', 14), Format.score(item.CommunityRating)));
      if (item.CriticRating) parts.push(h('span', { class: 'score critic', title: t('detail.critic') }, `${Math.round(item.CriticRating)}%`));
      if (item.RunTimeTicks && !isSeries) parts.push(span(t('detail.endsAt', { time: endsAt(ticksToSec(item.RunTimeTicks - (resumes(item) ? item.UserData.PlaybackPositionTicks : 0))) }), { class: 'muted' }));
      meta.replaceChildren(...parts);
    };
    paintMeta();
    info.append(meta);

    // Tags wie in der Apple-App: vorn "Gesehen" in der Akzentfarbe, dann Premium-Aufloesung, HDR-Format, Premium-Ton der gewaehlten Spur, wie der Server
    // liefern wuerde (Direct Play, Direct Stream, Transcoding; ruhiger als die Formate), dann die weitere Technik; reicht die Zeile nicht, fallen die hinteren
    // weg. Die Wiedergabe wird ohne abzuspielen erfragt (window.jc.playbackOutlook) fuer die gewaehlte Version und Spuren, nur bei Filmen und Folgen; bis
    // zur Antwort haelt ein unsichtbarer Platzhalter den Platz.
    const tagHost = h('div', { class: 'detail-tags' });
    const outlook = { key: null, method: null, pending: false, failed: false };
    const selection = () => {
      const s = cur();
      if (!s) return { mediaSourceId: undefined, audioIndex: undefined, subtitleIndex: undefined };
      const p = picks();
      return { mediaSourceId: s.Id, audioIndex: sel.audio ?? p.audioIndex ?? undefined, subtitleIndex: sel.sub ?? p.subtitleIndex ?? undefined };
    };
    const refreshOutlook = () => {
      if (isSeries) return; // eine Serie hat keine Datei
      if (typeof window.jc.playbackOutlook !== 'function') {
        outlook.failed = true;
        return;
      }
      const req = { itemId: item.Id, ...selection() };
      const key = JSON.stringify(req);
      if (key === outlook.key) return;
      Object.assign(outlook, { key, method: null, pending: true, failed: false });
      window.jc
        .playbackOutlook(req)
        .then((r) => r?.method ?? null, () => null)
        .then((method) => {
          if (destroyed || outlook.key !== key) return; // inzwischen anders gewaehlt
          Object.assign(outlook, { method, pending: false, failed: !method });
          paintBadges();
          paintInfo();
        });
    };
    const paintBadges = () => {
      refreshOutlook();
      const s = cur();
      let audio = null;
      if (s) {
        const ai = selection().audioIndex;
        audio = (s.MediaStreams ?? []).find((x) => x.Type === 'Audio' && x.Index === ai) ?? null;
      }
      const playback = outlook.method ?? (outlook.pending ? 'DirectStream' : undefined); // Platzhalter in der breitesten Fassung
      const tags = s ? Tags.source(s, { audio, playback, lang: getLocale().slice(0, 2) }) : [];
      let tagRow = mediaTagRow(tags, { size: 'regular', surface: 'page', fit: true });
      if (tagRow && !outlook.method && outlook.pending) {
        const ph = tagRow.querySelector('.tag[data-kind="directStream"]');
        if (ph) ph.style.visibility = 'hidden';
      }
      if (item.UserData?.Played) {
        tagRow ??= h('div', { class: 'tags regular on-page' });
        tagRow.prepend(h('span', { class: 'tag regular on-page watched', 'data-kind': 'watched' }, icon('check', 13), t('detail.watchedTag')));
      }
      tagHost.replaceChildren(...(tagRow ? [tagRow] : []));
      tagHost.hidden = !tagRow;
    };
    const paintInfo = () => {
      const groups = DetailFacts.informationGroups(item, { source: cur(), playback: { method: outlook.method, failed: outlook.failed }, lang: getLocale() });
      infoHost.replaceChildren(...(groups.length ? [infoBlock(t('detail.information'), groups)] : []));
    };
    paintBadges();
    info.append(tagHost);

    // ----- Knoepfe (wie die Apple-App auf iPad und Mac): Abspielen mit Favorit, Gesehen, Problem melden und Mehr in einer Zeile, darunter Von vorn und
    // Trailer zu gleichen Teilen, so bleibt die Spalte der Knoepfe ruhig -----
    const actions = h('div', { class: 'detail-actions stacked' });
    const mainRow = h('div', { class: 'detail-actions-row' });
    const moreRow = h('div', { class: 'detail-actions-row fill' });
    const startPlay = (fromStart) => {
      if (!target) return;
      const s = cur();
      playItem({
        itemId: target.Id,
        mediaSourceId: !isSeries && s ? s.Id : undefined,
        audioIndex: !isSeries ? sel.audio : undefined,
        subtitleIndex: !isSeries ? sel.sub : undefined,
        resume: !fromStart,
        startTicks: fromStart ? 0 : undefined
      });
    };
    const playText = h('span', null);
    const playBtn = h('button', { class: 'btn primary xl', type: 'button', 'data-action': 'play', onclick: () => startPlay(false) }, icon('play', 22), playText);
    /** "Abspielen", "Fortsetzen ab 12:40", bei Serien mit der Folge davor ("S1 E3 Fortsetzen ab 12:40"; Format.playLabel wie PlayAction der Apple-App). */
    const paintPlay = () => {
      const label = Format.playLabel(target, item, getLocale());
      if (playText.textContent !== label) playText.textContent = label;
      playBtn.disabled = !target;
    };
    const restartBtn = h('button', { class: 'btn glass lg', type: 'button', 'data-action': 'restart', onclick: () => startPlay(true) }, icon('refresh', 18), h('span', null, t('action.fromStart')));
    const trailerUrl = item.RemoteTrailers?.[0]?.Url;
    const trailerBtn = trailerUrl ? h('button', { class: 'btn glass lg', type: 'button', 'data-action': 'trailer', onclick: () => window.jc.openExternal(trailerUrl).catch((e) => toast(e.message, { type: 'error' })) }, icon('external', 18), h('span', null, t('action.trailer'))) : null;
    moreRow.append(restartBtn, ...(trailerBtn ? [trailerBtn] : []));
    /** Von vorn nur bei angefangenen Filmen und Folgen (bei einer Serie startet "Abspielen" die Folge an ihrer Stelle). */
    const paintRestart = () => {
      restartBtn.hidden = isSeries || !resumes(item);
      moreRow.hidden = restartBtn.hidden && !trailerBtn;
    };

    const watchedBtn = h('button', { class: 'btn icon glass lg', type: 'button', 'data-action': 'played' });
    const favBtn = h('button', { class: 'btn icon glass lg', type: 'button', 'data-action': 'favorite' });
    const paintToggles = () => {
      const played = !!item.UserData?.Played;
      const fav = !!item.UserData?.IsFavorite;
      const wl = played ? t('action.markUnwatched') : t('action.markWatched');
      const fl = fav ? t('action.unfavorite') : t('action.favorite');
      watchedBtn.classList.toggle('on', played);
      favBtn.classList.toggle('on', fav);
      watchedBtn.title = wl;
      watchedBtn.setAttribute('aria-label', wl);
      favBtn.title = fl;
      favBtn.setAttribute('aria-label', fl);
      watchedBtn.replaceChildren(icon(played ? 'check-circle-fill' : 'check-circle', 22));
      favBtn.replaceChildren(icon(fav ? 'heart-fill' : 'heart', 22));
    };
    // Ein zweiter Klick waehrend der Antwort zaehlt nicht. Danach zeigen alle Seiten den neuen Stand (auch die im Speicher: Startseite, Mediathek)
    let toggling = false;
    const toggle = async (fn) => {
      if (toggling) return;
      toggling = true;
      try {
        const ok = await fn(item);
        if (destroyed) return;
        paintToggles();
        paintBadges();
        paintMeta();
        paintRestart();
        paintPlay();
        if (ok) itemStateChanged(item.Id);
      } finally {
        toggling = false;
      }
    };
    watchedBtn.addEventListener('click', () => toggle(toggleWatched));
    favBtn.addEventListener('click', () => toggle(toggleFavorite));
    // Mehr: Ansicht neu laden oder den Server die Metadaten neu holen lassen, Verwalten fuer Administratoren
    const moreBtn = h('button', { class: 'btn icon glass lg', type: 'button', title: t('action.more'), 'aria-label': t('action.more') }, icon('more', 22));
    const refreshMeta = async (replaceAll) => {
      try {
        await api.refreshItem(item.Id, { replaceAll });
        toast(t('toast.metaRefreshing'));
        // Der Server arbeitet im Hintergrund: nach kurzer Zeit die Seite neu laden (bei grossen Serien bleibt "Neu laden")
        setTimeout(() => !destroyed && load(), 3500);
      } catch (e) {
        toast(e.status === 403 ? t('toast.metaForbidden') : e.message, { type: 'error' });
      }
    };
    moreBtn.addEventListener('click', () =>
      openMenu(
        moreBtn,
        [
          ...(trailerCtl?.isPlaying() ? [{ id: 'hideTrailer', label: t('trailer.hide') }] : []),
          { id: 'reload', label: t('action.reload') },
          { id: 'meta', label: t('action.refreshMeta'), sub: t('action.refreshMetaSub') },
          { id: 'metaAll', label: t('action.refreshMetaAll'), sub: t('action.refreshMetaAllSub') },
          // Verwalten: nur fuer Administratoren (Richtlinie des Kontos); Folgen und Staffeln lassen sich ebenfalls bearbeiten und loeschen
          ...(state.isAdmin
            ? [
                { header: true, label: t('admin.manage') },
                { id: 'adminEdit', label: t('admin.item.edit') },
                ...(['Movie', 'Series'].includes(item.Type) ? [{ id: 'adminIdentify', label: t('admin.item.identify'), sub: t('admin.item.identifySub') }] : []),
                { id: 'adminDelete', label: t('admin.item.delete') }
              ]
            : [])
        ],
        {
          align: 'right',
          onPick: (e) => {
            if (e.id === 'hideTrailer') {
              trailerCtl?.destroy();
              trailerCtl = null;
            } else if (e.id === 'reload') document.dispatchEvent(new CustomEvent('reload-data'));
            else if (e.id === 'adminEdit') editMetadata(item);
            else if (e.id === 'adminIdentify') identifyItem(item);
            else if (e.id === 'adminDelete') deleteItemAdmin(item);
            else refreshMeta(e.id === 'metaAll');
          }
        }
      )
    );
    // Problem melden: als Warnschild bei den anderen Knoepfen (wie die Apple-App, nicht mehr zusaetzlich im Menue "Mehr"), sobald Seerr verbunden ist und der
    // Titel sich dort zuordnen laesst (Art Video / Audio / Untertitel / Sonstiges, Kommentar freiwillig)
    const issueBtn = canReportIssue(item)
      ? h('button', { class: 'btn icon glass lg issue-btn', type: 'button', title: t('issue.title'), 'aria-label': t('issue.title'), 'data-action': 'issue', onclick: () => openIssueDialog(item) }, icon('warning', 22))
      : null;
    mainRow.append(playBtn, favBtn, watchedBtn, ...(issueBtn ? [issueBtn] : []), moreBtn);
    trailerCtl?.mountControls(mainRow); // Ton und Ausblenden des Trailers: am Ende der Zeile, erst sichtbar, wenn der Trailer laeuft
    actions.append(mainRow, moreRow);
    paintPlay();
    paintRestart();
    paintToggles();
    info.append(actions);

    // ----- Version / Audio / Untertitel (Infuse-aehnlich vor dem Start waehlbar) -----
    if (!isSeries && sources.length) {
      const opts = h('div', { class: 'detail-options' });
      const optBtn = (iconName, labelKey) => {
        const value = h('span', { class: 'val' });
        const b = h('button', { class: 'opt', type: 'button' }, icon(iconName, 18), h('span', { class: 'lbl' }, t(labelKey)), value, icon('chevron-down', 14));
        return { b, value };
      };
      const audioStreams = () => (cur()?.MediaStreams ?? []).filter((s) => s.Type === 'Audio');
      const subStreams = () => (cur()?.MediaStreams ?? []).filter((s) => s.Type === 'Subtitle');
      const ver = optBtn('layers', 'detail.version');
      const aud = optBtn('audio', 'detail.audio');
      const sub = optBtn('subtitles', 'detail.subtitles');

      const paintOpts = () => {
        const s = cur();
        ver.value.textContent = s?.Name || `${sel.source + 1}`;
        const ai = sel.audio ?? picks().audioIndex;
        const a = audioStreams().find((x) => x.Index === ai) ?? audioStreams()[0];
        aud.value.textContent = a ? streamLabel(a) : t('detail.none');
        const si = sel.sub ?? picks().subtitleIndex;
        const sb = si === undefined || si === null || si < 0 ? null : subStreams().find((x) => x.Index === si);
        sub.value.textContent = sb ? streamLabel(sb) : t('detail.off');
        paintBadges();
        paintInfo();
      };
      ver.b.addEventListener('click', () =>
        openMenu(
          ver.b,
          sources.map((s, i) => {
            const m = Media.describeMedia(s);
            return { id: i, label: s.Name || `${t('detail.version')} ${i + 1}`, sub: [m.resolution, m.hdrLabel, m.videoCodec, fmtSize(s.Size)].filter(Boolean).join(' · '), selected: i === sel.source };
          }),
          {
            onPick: (e) => {
              sel.source = e.id;
              sel.audio = undefined;
              sel.sub = undefined;
              paintOpts();
            }
          }
        )
      );
      aud.b.addEventListener('click', () =>
        openMenu(
          aud.b,
          audioStreams().map((s) => ({ id: s.Index, label: streamLabel(s), sub: [s.Codec && String(s.Codec).toUpperCase(), s.ChannelLayout, s.BitRate && fmtBitrate(s.BitRate)].filter(Boolean).join(' · '), selected: s.Index === (sel.audio ?? picks().audioIndex) })),
          {
            maxHeight: 420,
            onPick: (e) => {
              sel.audio = e.id;
              paintOpts();
            }
          }
        )
      );
      // Wenige Spuren: eine einfache Liste. Viele: nach Sprache geordnet, nur die bevorzugten Sprachen (und die gewaehlte Spur) gleich zu sehen, der Rest hinter "Weitere Sprachen".
      const openSubMenu = (expanded = false) => {
        const curSub = sel.sub ?? picks().subtitleIndex;
        const streams = subStreams();
        const off = { id: -1, label: t('detail.off'), selected: curSub === undefined || curSub === null || curSub < 0 };
        const entries =
          streams.length <= MANY_SUBS
            ? [
                off,
                ...streams.map((s) => ({
                  id: s.Index,
                  label: streamLabel(s),
                  sub: [s.IsForced && t('detail.forced'), s.IsExternal && t('detail.external'), s.Codec && String(s.Codec).toUpperCase()].filter(Boolean).join(' · '),
                  selected: s.Index === curSub
                }))
              ]
            : groupedSubtitleEntries(streams, curSub, off, expanded);
        openMenu(sub.b, entries, {
          maxHeight: 420,
          onPick: (e) => {
            if (e.more) return openSubMenu(true);
            sel.sub = e.id;
            paintOpts();
          }
        });
      };
      sub.b.addEventListener('click', () => openSubMenu());
      if (sources.length > 1) opts.append(ver.b);
      if (audioStreams().length) opts.append(aud.b);
      opts.append(sub.b);
      paintOpts();
      info.append(opts);
    }

    // ----- Handlung und Genres (wie die Apple-App: die Genres in einer Zeile unter der Handlung; Regie steht in der Besetzung, das Studio bei den Informationen) -----
    const hideSpoiler = isEpisode && state.settings.general.spoilerProtection && !item.UserData?.Played && !(item.UserData?.PlaybackPositionTicks > 0);
    if (item.Overview) {
      // Handlung mit HTML formatiert (Absaetze, Listen, fett, kursiv, Links; rich-text.js), sonst wie bisher als Text
      const rich = !hideSpoiler && looksLikeHtml(item.Overview);
      const p = h(rich ? 'div' : 'p', { class: `overview clamp${rich ? ' rich' : ''}` }, hideSpoiler ? t('detail.spoilerHidden') : richText(item.Overview));
      const more = h('button', { class: 'link-btn', type: 'button', hidden: true }, t('action.more'));
      more.addEventListener('click', () => {
        const open = p.classList.toggle('clamp');
        more.textContent = open ? t('action.more') : t('action.less');
      });
      info.append(p, more);
      requestAnimationFrame(() => {
        if (p.scrollHeight > p.clientHeight + 2) more.hidden = false;
      });
    }
    if (item.Genres?.length) info.append(h('p', { class: 'detail-genres' }, item.Genres.join(' · ')));

    // Die Buehne steht still und schneidet ab, der Kopf darin gleitet im Trailer-Fokus als ein Block nach unten (siehe "Trailer im Vordergrund" in app.css)
    const head = h('section', { class: 'detail-head' }, poster, info);
    body.replaceChildren(h('div', { class: 'detail-stage' }, head));

    // ----- Serien: Staffeln & Folgen / Folge: die Folgen ihrer Staffel -----
    let seasonCtl = null;
    if (isSeries) {
      if (season) {
        // Ohne naechste Folge startet "Abspielen" die erste Folge der gezeigten Staffel (auch nach dem Wechsel der Staffel)
        seasonCtl = seasonSection(item, seasons, season.Id, null, {
          preloaded: seasonEpisodes,
          onEpisodes: (eps) => {
            if (nextUp) return;
            target = eps[0] ?? null;
            paintPlay();
          }
        });
        body.append(seasonCtl.el);
      }
    } else if (isEpisode && item.SeasonId) {
      seasonCtl = seasonSection({ Id: item.SeriesId }, [], item.SeasonId, item.Id, { singleName: item.SeasonName });
      body.append(seasonCtl.el);
    }

    // ----- Besetzung: Schauspiel, Regie und Gastrollen; jede Person fuehrt auf ihre Seite (views/person.js, wie auf der Seite eines Seerr-Titels) -----
    const cast = castRow(window.JCPerson.libraryCast(item.People ?? []));
    if (cast) body.append(cast);

    // ----- Informationen (immer offen, ersetzt die aufklappbaren "Technischen Details"); die Aehnlichen Titel kommen davor, sobald sie da sind -----
    body.append(infoHost);
    paintInfo();
    if (!isEpisode) {
      api.getSimilar(item.Id, 14).then((items) => {
        if (destroyed || !items.length || !infoHost.isConnected) return;
        infoHost.before(row(t('detail.similar'), items, { onPlay: (it) => playItem({ itemId: it.Id, resume: true }) }));
      });
    }

    /**
     * Der Stand hat sich geaendert (Kontextmenue einer Folge, Gesehen oder Favorit hier oder auf einer anderen Seite): Eintrag und naechste Folge neu vom
     * Server, dann Haken, Tags, "Abspielen" und die Folgen der gezeigten Staffel, ohne die Seite neu aufzubauen (der Trailer laeuft weiter).
     */
    let stateSeq = 0;
    const refreshState = async () => {
      const mine = ++stateSeq;
      const [fresh, next] = await Promise.all([api.getItem(item.Id).catch(() => null), isSeries ? api.getNextUp(1, item.Id).then((r) => r[0] ?? null, () => undefined) : undefined]);
      if (destroyed || mine !== stateSeq) return;
      if (fresh) item.UserData = fresh.UserData;
      if (isSeries && next !== undefined) nextUp = next;
      if (isSeries && nextUp) target = nextUp;
      paintMeta();
      paintBadges();
      paintToggles();
      paintRestart();
      paintPlay();
      seasonCtl?.reload(); // ohne naechste Folge bestimmt danach die erste Folge der Staffel "Abspielen" (onEpisodes)
    };
    page = { concerns: (changed) => changed === item.Id || changed === target?.Id || !!seasonCtl?.has(changed), refresh: refreshState };
  }

  /**
   * Staffel-Reiter und Folgenliste. preloaded: die Folgen der ersten Staffel, schon geholt; onEpisodes(folgen): nach jedem Laden einer Staffel.
   * reload(): die gezeigte Staffel still neu (ohne Platzhalter und ohne Einblenden, der Fokus bleibt auf seiner Folge); has(id): steht diese Folge in der Liste?
   */
  function seasonSection(series, seasons, seasonId, currentId, { singleName = '', preloaded = null, onEpisodes = null } = {}) {
    const sec = h('section', { class: 'seasons' });
    const tabs = h('div', { class: 'season-tabs' });
    const list = h('div', { class: 'episodes' });
    let active = seasonId;
    let token = 0;
    let shown = [];

    async function showSeason(sid, { quiet = false, given = null } = {}) {
      active = sid;
      tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.id === sid));
      const my = ++token;
      if (!quiet && !given) list.replaceChildren(h('div', { class: 'sk sk-ep' }), h('div', { class: 'sk sk-ep' }), h('div', { class: 'sk sk-ep' }));
      let eps = given;
      if (!eps) {
        try {
          eps = await api.getEpisodes(series.Id, sid);
        } catch (e) {
          if (my === token && !destroyed && !quiet) list.replaceChildren(pageStatus({ kind: 'failed', text: e.message, inline: true, retry: () => showSeason(sid) }));
          return;
        }
      }
      if (destroyed || my !== token) return;
      const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('.ep')?.dataset.id : null;
      shown = eps;
      list.replaceChildren(...eps.map((ep, i) => episodeRow(ep, i, ep.Id === currentId, quiet)));
      if (focusedId) list.querySelector(`.ep[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
      onEpisodes?.(eps);
      const cur = !quiet && list.querySelector('.ep.current');
      if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'nearest' }));
    }

    if (seasons.length) {
      for (const s of seasons) {
        const b = h('button', { class: 'tab', type: 'button', 'data-id': s.Id, onclick: () => showSeason(s.Id) }, s.Name);
        tabs.append(b);
      }
      sec.append(tabs);
    } else {
      sec.append(h('div', { class: 'row-head' }, h('h2', null, singleName || t('detail.episodes'))));
    }
    sec.append(list);
    showSeason(active, { given: preloaded });
    return { el: sec, reload: () => showSeason(active, { quiet: true }), has: (epId) => shown.some((ep) => ep.Id === epId) };
  }

  function episodeRow(ep, i, isCurrent, settled = false) {
    const img = landscapeOf(ep, 520);
    const watched = !!ep.UserData?.Played || ep.UserData?.PlaybackPositionTicks > 0;
    const spoiler = state.settings.general.spoilerProtection && !watched;
    const thumb = h('div', { class: `ep-thumb${spoiler ? ' spoiler' : ''}` }, lazyImage(img, {}));
    const u = ep.UserData ?? {};
    if (u.Played) thumb.append(h('span', { class: 'corner played' }, icon('check', 14)));
    const prog = u.PlayedPercentage > 0 && u.PlayedPercentage < 100 ? u.PlayedPercentage : u.PlaybackPositionTicks && ep.RunTimeTicks ? (u.PlaybackPositionTicks / ep.RunTimeTicks) * 100 : 0;
    if (prog > 0) {
      const bar = h('div', { class: 'progress' }, h('i'));
      bar.firstChild.style.width = `${Math.min(99, prog)}%`;
      thumb.append(bar);
    }
    thumb.append(h('span', { class: 'play-fab' }, icon('play', 20)));
    const a = h(
      'article',
      { class: `ep${isCurrent ? ' current' : ''}${settled ? ' settled' : ''}`, tabindex: '0', 'data-id': ep.Id },
      thumb,
      h(
        'div',
        { class: 'ep-info' },
        h('div', { class: 'ep-head' }, h('span', { class: 'ep-no' }, ep.IndexNumber != null ? String(ep.IndexNumber) : ''), h('a', { class: 'ep-title', href: `#/item/${ep.Id}` }, ep.Name), h('span', { class: 'ep-rt' }, ep.RunTimeTicks ? fmtDuration(ticksToSec(ep.RunTimeTicks)) : '')),
        ep.Overview ? h('p', { class: 'ep-ov' }, spoiler ? t('detail.spoilerHidden') : richText(ep.Overview, { compact: true })) : null
      )
    );
    a.style.setProperty('--i', Math.min(i, 14));
    thumb.addEventListener('click', () => playItem({ itemId: ep.Id, resume: true }));
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === a) playItem({ itemId: ep.Id, resume: true });
    });
    attachItemMenu(a, () => ep, { anchor: thumb }); // Kontextmenue wie auf den Karten (Apple: EpisodeRow mit itemActions)
    return a;
  }

  load();

  return {
    el,
    /** Der Stand eines Eintrags hat sich geaendert (actions.js itemStateChanged): Aehnliche an ihrem Platz, die Seite selbst, wenn es sie betrifft. */
    itemChanged(changed) {
      if (destroyed) return;
      refreshCards(changed, [el]);
      if (page?.concerns(changed)) page.refresh();
    },
    destroy() {
      destroyed = true;
      trailerCtl?.destroy();
      closeMenu();
      scroller()?.removeEventListener('scroll', onScroll);
    }
  };
}

export { navigate };
