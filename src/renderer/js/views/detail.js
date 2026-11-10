import { h, icon, $ } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { api, backdropOf, landscapeOf, posterOf, logoOf, personImage, isFolder } from '../api.js';
import { state, updateSettings } from '../state.js';
import { badges, card, initialsOf, lazyImage, openMenu, row, titleOf, toast, closeMenu } from '../ui.js';
import { setAmbient } from '../ambient.js';
import { endsAt, fmtBitrate, fmtDate, fmtDuration, fmtSize, langName, ticksToSec } from '../utils.js';
import { playItem, resolveSeriesTarget, toggleFavorite, toggleWatched } from '../actions.js';
import { navigate } from '../router.js';
import { createTrailer } from '../trailer.js';
import { editMetadata, identifyItem, deleteItem as deleteItemAdmin } from './admin-item.js';
import { canReportIssue, openIssueDialog } from './issue-dialog.js';

const Media = window.JCMedia;

const epLabel = (it) => `${it.ParentIndexNumber != null ? `S${it.ParentIndexNumber}:` : ''}E${it.IndexNumber ?? '?'}`;

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

function errorBox(e, retry) {
  return h(
    'div',
    { class: 'empty error' },
    icon('info', 40),
    h('h3', null, t('error.loadFailed')),
    h('p', null, e.message),
    retry ? h('button', { class: 'btn primary', type: 'button', onclick: retry }, t('action.retry')) : null
  );
}

export function detailView({ id, query }) {
  const el = h('div', { class: 'page detail' });
  const bd = h('div', { class: 'detail-bd' });
  const body = h('div', { class: 'detail-body' });
  el.append(bd, body);
  body.append(h('div', { class: 'detail-loading' }, h('div', { class: 'sk sk-poster' }), h('div', { class: 'sk-stack' }, h('div', { class: 'sk sk-title-lg' }), h('div', { class: 'sk sk-line' }), h('div', { class: 'sk sk-line short' }))));

  let destroyed = false;
  let trailerCtl = null; // Trailer im Hintergrund (trailer.js)
  const scroller = () => $('#view');
  const onScroll = () => {
    const y = scroller()?.scrollTop ?? 0;
    if (y < 1400) bd.style.setProperty('--sy', y);
  };
  scroller()?.addEventListener('scroll', onScroll, { passive: true });

  async function load() {
    let item;
    try {
      item = await api.getItem(id);
    } catch (e) {
      if (destroyed) return;
      body.replaceChildren(errorBox(e, load));
      if (e.status === 401) document.dispatchEvent(new CustomEvent('session-expired'));
      return;
    }
    if (destroyed) return;
    if (item.Type === 'Season') return location.replace(`#/item/${item.SeriesId}?season=${item.Id}`);
    if (isFolder(item)) return location.replace(`#/library/${item.Id}`);
    try {
      await render(item);
    } catch (e) {
      if (!destroyed) body.replaceChildren(errorBox(e, load));
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

    // Fuer Serien: naechste Folge bestimmen (Play-Ziel)
    const target = isSeries ? await resolveSeriesTarget(item.Id) : { episode: item, resume: true };
    if (destroyed) return;
    const playItemObj = target.episode;
    const pos = playItemObj?.UserData?.PlaybackPositionTicks ?? 0;
    const canResume = pos > 0 && !!playItemObj?.RunTimeTicks;

    // ----- Kopf -----
    const poster = isEpisode ? lazyImage(landscapeOf(item, 720), { cls: 'detail-poster landscape', eager: true, fallback: titleOf(item) }) : lazyImage(posterOf(item, 560), { cls: 'detail-poster', eager: true, fallback: titleOf(item) });

    const info = h('div', { class: 'detail-info' });
    if (isEpisode) {
      info.append(h('a', { class: 'crumb', href: `#/item/${item.SeriesId}` }, icon('chevron-left', 16), item.SeriesName, item.SeasonName ? ` · ${item.SeasonName}` : ''));
    }
    const logo = !isEpisode ? logoOf(item, 720) : null;
    if (logo) {
      const l = h('img', { class: 'detail-logo', alt: item.Name, src: logo.url, decoding: 'async' });
      l.addEventListener('error', () => l.replaceWith(h('h1', { class: 'detail-title' }, item.Name)));
      info.append(l);
    } else {
      info.append(h('h1', { class: 'detail-title' }, isEpisode ? `${epLabel(item)} · ${item.Name}` : item.Name));
    }
    if (item.Taglines?.[0] && !isEpisode) info.append(h('p', { class: 'tagline' }, item.Taglines[0]));

    const meta = h('div', { class: 'detail-meta' });
    const addMeta = (node) => meta.append(node);
    if (item.ProductionYear) addMeta(h('span', null, String(item.ProductionYear)));
    if (item.OfficialRating) addMeta(h('span', { class: 'rating-box' }, item.OfficialRating));
    if (item.RunTimeTicks) addMeta(h('span', null, fmtDuration(ticksToSec(item.RunTimeTicks))));
    if (isSeries && item.Status) addMeta(h('span', null, item.Status === 'Continuing' ? t('detail.continuing') : t('detail.ended')));
    if (item.CommunityRating) addMeta(h('span', { class: 'score' }, icon('star', 14), item.CommunityRating.toFixed(1)));
    if (item.CriticRating) addMeta(h('span', { class: 'score critic', title: t('detail.critic') }, `${Math.round(item.CriticRating)}%`));
    if (item.RunTimeTicks && !isSeries) addMeta(h('span', { class: 'muted' }, t('detail.endsAt', { time: endsAt(ticksToSec(item.RunTimeTicks - (canResume ? pos : 0))) })));
    info.append(meta);

    const badgeHost = h('div', { class: 'badge-host' });
    const paintBadges = () => {
      badgeHost.replaceChildren();
      const s = cur() ?? playItemObj?.MediaSources?.[0];
      if (s) {
        const media = Media.describeMedia(s);
        const b = badges(media, { max: 6 });
        const extra = [media.videoCodec, media.audio?.name && `${media.audio.name}${media.audio.channels ? ` ${media.audio.channels}` : ''}`].filter(Boolean);
        if (b) badgeHost.append(b);
        if (extra.length) badgeHost.append(h('span', { class: 'tech-line' }, extra.join(' · ')));
      }
    };
    paintBadges();
    info.append(badgeHost);

    // ----- Aktionen -----
    const actions = h('div', { class: 'detail-actions' });
    const startPlay = (fromStart) => {
      const target0 = playItemObj ?? item;
      const s = cur();
      playItem({
        itemId: target0.Id,
        mediaSourceId: !isSeries && s ? s.Id : undefined,
        audioIndex: !isSeries ? sel.audio : undefined,
        subtitleIndex: !isSeries ? sel.sub : undefined,
        resume: !fromStart,
        startTicks: fromStart ? 0 : undefined
      });
    };
    const playLabel = isSeries ? (playItemObj ? (canResume || target.resume ? t('detail.continueEp', { ep: epLabel(playItemObj) }) : t('detail.playEp', { ep: epLabel(playItemObj) })) : t('action.play')) : canResume ? t('action.resume') : t('action.play');
    const playBtn = h('button', { class: 'btn primary xl', type: 'button', disabled: !playItemObj, onclick: () => startPlay(false) }, icon('play', 22), h('span', null, playLabel));
    if (canResume && playItemObj?.RunTimeTicks) {
      playBtn.append(h('small', null, t('card.remaining', { time: fmtDuration(ticksToSec(playItemObj.RunTimeTicks - pos)) })));
    }
    actions.append(playBtn);
    if (canResume) actions.append(h('button', { class: 'btn glass lg', type: 'button', onclick: () => startPlay(true) }, icon('refresh', 18), h('span', null, t('action.fromStart'))));
    const trailer = item.RemoteTrailers?.[0]?.Url;
    if (trailer) actions.append(h('button', { class: 'btn glass lg', type: 'button', onclick: () => window.jc.openExternal(trailer).catch((e) => toast(e.message, { type: 'error' })) }, icon('external', 18), h('span', null, t('action.trailer'))));

    const watchedBtn = h('button', { class: 'btn icon glass lg', type: 'button', title: t('action.toggleWatched') }, icon('check-circle', 22));
    const favBtn = h('button', { class: 'btn icon glass lg', type: 'button', title: t('action.toggleFav') });
    const paintToggles = () => {
      watchedBtn.classList.toggle('on', !!item.UserData?.Played);
      favBtn.classList.toggle('on', !!item.UserData?.IsFavorite);
      favBtn.replaceChildren(icon(item.UserData?.IsFavorite ? 'heart-fill' : 'heart', 22));
    };
    watchedBtn.addEventListener('click', async () => {
      await toggleWatched(item);
      paintToggles();
    });
    favBtn.addEventListener('click', async () => {
      await toggleFavorite(item);
      paintToggles();
    });
    paintToggles();
    // Mehr: Ansicht neu laden oder den Server die Metadaten neu holen lassen (nur Administratoren)
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
          // Problem melden: nur mit Seerr-Verbindung (die Meldung geht als "Issue" an Seerr, Art Video / Audio / Untertitel / Sonstiges, Kommentar freiwillig)
          ...(canReportIssue(item) ? [{ id: 'issue', label: t('issue.menu'), sub: t('issue.menuSub') }] : []),
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
            else if (e.id === 'issue') openIssueDialog(item);
            else if (e.id === 'adminEdit') editMetadata(item);
            else if (e.id === 'adminIdentify') identifyItem(item);
            else if (e.id === 'adminDelete') deleteItemAdmin(item);
            else refreshMeta(e.id === 'metaAll');
          }
        }
      )
    );
    // Problem melden: als Warnschild gleich in der Leiste (nicht nur im Menue "Mehr"), sobald Seerr verbunden ist und der Titel sich dort zuordnen laesst
    const issueBtn = canReportIssue(item)
      ? h('button', { class: 'btn icon glass lg issue-btn', type: 'button', title: t('issue.title'), 'aria-label': t('issue.title'), 'data-action': 'issue', onclick: () => openIssueDialog(item) }, icon('warning', 22))
      : null;
    actions.append(watchedBtn, favBtn, ...(issueBtn ? [issueBtn] : []), moreBtn);
    trailerCtl?.mountControls(actions); // Ton und Ausblenden des Trailers: am Ende der Leiste, erst sichtbar, wenn der Trailer laeuft
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

    // ----- Beschreibung & Fakten -----
    const hideSpoiler = isEpisode && state.settings.general.spoilerProtection && !item.UserData?.Played && !(item.UserData?.PlaybackPositionTicks > 0);
    if (item.Overview) {
      const p = h('p', { class: 'overview clamp' }, hideSpoiler ? t('detail.spoilerHidden') : item.Overview);
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
    const facts = h('dl', { class: 'facts' });
    const addFact = (k, v) => {
      if (!v || (Array.isArray(v) && !v.length)) return;
      facts.append(h('dt', null, k), h('dd', null, v));
    };
    const people = item.People ?? [];
    const names = (type) => people.filter((p) => p.Type === type).slice(0, 4).map((p) => p.Name).join(', ');
    addFact(t('detail.genres'), (item.Genres ?? []).join(', '));
    addFact(t('detail.director'), names('Director'));
    addFact(t('detail.writer'), names('Writer'));
    addFact(t('detail.studio'), (item.Studios ?? []).map((s) => s.Name).slice(0, 3).join(', '));
    addFact(t('detail.released'), fmtDate(item.PremiereDate));
    if (facts.children.length) info.append(facts);

    // Die Buehne steht still und schneidet ab, der Kopf darin gleitet im Trailer-Fokus als ein Block nach unten (siehe "Trailer im Vordergrund" in app.css)
    const head = h('section', { class: 'detail-head' }, poster, info);
    body.replaceChildren(h('div', { class: 'detail-stage' }, head));

    // ----- Serien: Staffeln & Folgen / Episode: Geschwister -----
    if (isSeries) {
      const seasons = await api.getSeasons(item.Id).catch(() => []);
      if (destroyed) return;
      if (seasons.length) {
        const wanted = query?.get('season') ?? playItemObj?.SeasonId;
        const first = seasons.find((s) => s.Id === wanted) ?? seasons.find((s) => s.IndexNumber > 0) ?? seasons[0];
        body.append(seasonSection(item, seasons, first.Id, null));
      }
    } else if (isEpisode && item.SeasonId) {
      body.append(seasonSection({ Id: item.SeriesId }, [], item.SeasonId, item.Id, item.SeasonName));
    }

    // ----- Besetzung -----
    const cast = people.filter((p) => ['Actor', 'GuestStar'].includes(p.Type)).slice(0, 24);
    if (cast.length) {
      const scroller = h('div', { class: 'scroller people' });
      cast.forEach((p, i) => {
        const img = personImage(p);
        const a = h('a', { class: 'person', href: `#/search?q=${encodeURIComponent(p.Name)}` });
        a.style.setProperty('--i', Math.min(i, 14));
        const av = lazyImage(img, { cls: 'avatar' });
        // Initialen immer anlegen; sichtbar sind sie nur, wenn kein Bild da ist oder es nicht geladen werden kann (siehe .avatar .initial)
        av.append(h('span', { class: 'initial', 'aria-hidden': 'true' }, initialsOf(p.Name)));
        a.append(av, h('div', { class: 'l1' }, p.Name), p.Role ? h('div', { class: 'l2' }, p.Role) : null);
        scroller.append(a);
      });
      body.append(h('section', { class: 'row' }, h('div', { class: 'row-head' }, h('h2', null, t('detail.cast'))), scroller));
    }

    // ----- Aehnliche Titel -----
    if (!isEpisode) {
      api.getSimilar(item.Id, 14).then((items) => {
        if (destroyed || !items.length) return;
        body.append(row(t('detail.similar'), items, { showBadges: state.settings.appearance.showBadges, onPlay: (it) => playItem({ itemId: it.Id, resume: true }) }));
      });
    }

    // ----- Technische Details -----
    if (!isSeries && sources.length) body.append(techSection(sources));
  }

  /** Staffel-Reiter + Folgenliste. */
  function seasonSection(series, seasons, seasonId, currentId, singleName) {
    const sec = h('section', { class: 'seasons' });
    const tabs = h('div', { class: 'season-tabs' });
    const list = h('div', { class: 'episodes' });
    let active = seasonId;
    let token = 0;

    async function showSeason(sid) {
      active = sid;
      tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.id === sid));
      const my = ++token;
      list.replaceChildren(h('div', { class: 'sk sk-ep' }), h('div', { class: 'sk sk-ep' }), h('div', { class: 'sk sk-ep' }));
      let eps = [];
      try {
        eps = await api.getEpisodes(series.Id, sid);
      } catch (e) {
        if (my === token) list.replaceChildren(errorBox(e));
        return;
      }
      if (destroyed || my !== token) return;
      list.replaceChildren();
      eps.forEach((ep, i) => list.append(episodeRow(ep, i, ep.Id === currentId)));
      const cur = list.querySelector('.ep.current');
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
    showSeason(active);
    return sec;
  }

  function episodeRow(ep, i, isCurrent) {
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
      { class: `ep${isCurrent ? ' current' : ''}`, tabindex: '0' },
      thumb,
      h(
        'div',
        { class: 'ep-info' },
        h('div', { class: 'ep-head' }, h('span', { class: 'ep-no' }, ep.IndexNumber != null ? String(ep.IndexNumber) : ''), h('a', { class: 'ep-title', href: `#/item/${ep.Id}` }, ep.Name), h('span', { class: 'ep-rt' }, ep.RunTimeTicks ? fmtDuration(ticksToSec(ep.RunTimeTicks)) : '')),
        ep.Overview ? h('p', { class: 'ep-ov' }, spoiler ? t('detail.spoilerHidden') : ep.Overview) : null
      )
    );
    a.style.setProperty('--i', Math.min(i, 14));
    thumb.addEventListener('click', () => playItem({ itemId: ep.Id, resume: true }));
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === a) playItem({ itemId: ep.Id, resume: true });
    });
    return a;
  }

  function techSection(sources) {
    const wrap = h('details', { class: 'tech' }, h('summary', null, icon('monitor', 18), h('span', null, t('detail.techInfo')), icon('chevron-down', 16)));
    const s = sources[0];
    const grid = h('div', { class: 'tech-grid' });
    const block = (title, rows) => {
      const dl = h('dl', null);
      rows.filter(([, v]) => v).forEach(([k, v]) => dl.append(h('dt', null, k), h('dd', null, String(v))));
      grid.append(h('div', { class: 'tech-card' }, h('h4', null, title), dl));
    };
    const m = Media.describeMedia(s);
    block(t('detail.file'), [
      [t('tech.container'), s.Container],
      [t('tech.size'), fmtSize(s.Size)],
      [t('tech.bitrate'), fmtBitrate(s.Bitrate)]
    ]);
    for (const v of s.MediaStreams.filter((x) => x.Type === 'Video')) {
      block(t('detail.video'), [
        [t('tech.codec'), `${m.videoCodec ?? v.Codec}${v.Profile ? ` (${v.Profile})` : ''}`],
        [t('tech.resolution'), v.Width && `${v.Width}×${v.Height}`],
        [t('tech.hdr'), m.hdr ?? 'SDR'],
        [t('tech.bitDepth'), v.BitDepth && `${v.BitDepth} bit`],
        [t('tech.fps'), (v.RealFrameRate ?? v.AverageFrameRate) && `${Math.round((v.RealFrameRate ?? v.AverageFrameRate) * 100) / 100}`],
        [t('tech.bitrate'), fmtBitrate(v.BitRate)]
      ]);
    }
    for (const a of s.MediaStreams.filter((x) => x.Type === 'Audio')) {
      const d = Media.audioLabel(a);
      block(`${t('detail.audio')} · ${langName(a.Language) || '?'}`, [
        [t('tech.codec'), d?.name],
        [t('tech.channels'), a.ChannelLayout || d?.channels],
        [t('tech.spatial'), d?.atmos ? 'Dolby Atmos' : d?.dtsx ? 'DTS:X' : ''],
        [t('tech.bitrate'), fmtBitrate(a.BitRate)],
        [t('tech.sampleRate'), a.SampleRate && `${a.SampleRate} Hz`]
      ]);
    }
    const subs = s.MediaStreams.filter((x) => x.Type === 'Subtitle');
    if (subs.length <= MANY_SUBS && subs.length) {
      block(
        t('detail.subtitles'),
        subs.map((x) => [langName(x.Language) || `#${x.Index}`, [String(x.Codec ?? '').toUpperCase(), x.IsForced && t('detail.forced'), x.IsExternal && t('detail.external')].filter(Boolean).join(' · ')])
      );
    } else if (subs.length) {
      // Viele Spuren: eine Zeile je Sprache, die Spuren darin kommagetrennt (Format, erzwungen, SDH, extern)
      const kindText = { full: '', forced: t('detail.forced'), sdh: 'SDH' };
      const byLang = Media.groupByLanguage(subs, {}).more;
      block(
        t('detail.subtitles'),
        byLang.map((g) => [
          `${g.code === 'und' ? t('detail.langUnknown') : langName(g.code)}${g.tracks.length > 1 ? ` (${g.tracks.length})` : ''}`,
          g.tracks.map((x) => [String(x.Codec ?? '').toUpperCase(), kindText[Media.subtitleKind(x)], x.IsExternal && t('detail.external')].filter(Boolean).join(' ')).join(', ')
        ])
      );
    }
    wrap.append(grid);
    return wrap;
  }

  load();

  return {
    el,
    destroy() {
      destroyed = true;
      trailerCtl?.destroy();
      closeMenu();
      scroller()?.removeEventListener('scroll', onScroll);
    }
  };
}

export { navigate };
