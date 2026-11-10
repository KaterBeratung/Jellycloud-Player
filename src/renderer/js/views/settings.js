import { h, icon } from '../dom.js';
import { t, setLocale, getLocale } from '../i18n.js';
import { state, updateSettings, activeServer } from '../state.js';
import { applyAppearance, THEMES, ACCENTS, DEFAULT_ACCENT, isHexColor } from '../theme.js';
import { openMenu, segmented, slider, toast, toggle } from '../ui.js';
import { debounce, langName, fmtSize } from '../utils.js';
import { trailerTier } from '../trailer.js';
import { invalidate } from '../router.js';
import { playSplash } from '../splash.js';

// Bereiche der Einstellungen (Icon fuer die Seitenleiste)
const SECTIONS = [
  ['appearance', 'palette'],
  ['home', 'home'],
  ['video', 'monitor'],
  ['audio', 'audio'],
  ['subtitles', 'subtitles'],
  ['behavior', 'play'],
  ['network', 'link'],
  ['general', 'settings'],
  ['seerr', 'plus'],
  ['discord', 'tv'],
  ['account', 'user'],
  ['about', 'info']
];
const ALIASES = { playback: 'video' };
// Bereiche, die nur das Desktop-Programm braucht (mpv-Bild, Audio-Ausgabe des Rechners, Discord); auf dem Handy und im Browser entfallen sie
const DESKTOP_ONLY = new Set(['video', 'audio', 'discord']);
// Einstellungen, die Ansichten beim Aufbau lesen (siehe saveSoon): Abschnitt -> Schluessel ('*' = alle)
const LIVE_VIEW_KEYS = { appearance: ['showBadges', 'heroAutoplay', 'homeTrending'], general: ['spoilerProtection'], trailer: '*', home: '*' };
const HomeRows = window.JCHomeRows; // Regeln fuer Reihenfolge und Grenzen der Startseite (src/shared/home-rows.js)

const LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ja', 'ko', 'zh', 'sv', 'da', 'no', 'fi', 'cs', 'hu', 'ar', 'he', 'el', 'uk', 'ro'];
const SUB_COLORS = ['#ffffff', '#ffe066', '#7ee8fa', '#8cff9e', '#ff9ecb'];
const FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Georgia', 'Consolas'];

/** Diagnose fuer Handy und Browser (Einstellungen > Info): Plattform, ob die Huelle der App geladen ist (sonst mit Grund) und die Version der Browser-Engine; hilft beim Melden von Fehlern. */
function diagLine() {
  const engine = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '?';
  const shell = ['android', 'ios'].includes(state.platform) ? (window.JCHost ? 'ok' : `missing${window.JCHostError ? `: ${window.JCHostError}` : ''}`) : '-';
  return t('set.diag', { p: state.platform, h: shell, v: engine });
}

function setting(label, desc, control, { wide = false } = {}) {
  return h('div', { class: `setting${wide ? ' wide' : ''}` }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), desc ? h('div', { class: 'setting-desc' }, desc) : null), h('div', { class: 'setting-control' }, control));
}

/** Vorschau der Startanimation (laeuft ueber der Einstellungsseite; bei Animationen "aus" gibt es nichts zu sehen, dann ein Hinweis). */
function previewSplash() {
  if (state.settings.appearance.animations === 'off') toast(t('set.startAnimationOff'));
  else playSplash(state.settings.appearance, { preview: true });
}

const group = (title, ...rows) => h('div', { class: 'settings-block' }, title ? h('h3', { class: 'group-title' }, title) : null, h('div', { class: 'settings-group' }, rows));

function menuSelect(options, value, onChange) {
  const label = () => options.find((o) => o.value === value)?.label ?? String(value);
  const text = h('span', null, label());
  const b = h('button', { class: 'btn glass sm select', type: 'button' }, text, icon('chevron-down', 14));
  b.addEventListener('click', () =>
    openMenu(
      b,
      options.map((o) => ({ id: o.value, label: o.label, sub: o.sub, selected: o.value === value })),
      {
        align: 'right',
        onPick: (e) => {
          value = e.id;
          text.textContent = label();
          onChange(value);
        }
      }
    )
  );
  return b;
}

const onOff = (labelOn, labelOff) => [
  { value: 'auto', label: t('set.auto') },
  { value: 'yes', label: labelOn },
  { value: 'no', label: labelOff }
];

// Gruppen der Bereichsliste auf dem Handy (kompakte Ansicht): [Titel, Bereiche]. Bereiche, die hier fehlen, landen in der letzten Gruppe.
const MOBILE_GROUPS = [
  ['set.list.account', ['account', 'seerr']],
  ['set.list.look', ['appearance', 'home']],
  ['set.list.playback', ['subtitles', 'behavior', 'network']],
  ['set.list.app', ['general', 'about']]
];

/** Liste der Bereiche fuer das Handy: Zeilen mit Symbol, Name, kurzer Angabe (Benutzer, Version) und Pfeil, nach Themen gruppiert; ein Tipp oeffnet den Bereich. */
function sectionList(sections) {
  const icons = Object.fromEntries(sections);
  const sub = {
    account: activeServer()?.userName ?? '',
    seerr: state.seerr?.userName ?? '',
    about: state.appVersion ? `${t('set.version')} ${state.appVersion}` : ''
  };
  const groups = MOBILE_GROUPS.map(([title, ids]) => [title, ids.filter((id) => id in icons)]);
  const placed = new Set(groups.flatMap(([, ids]) => ids));
  groups[groups.length - 1][1].push(...sections.map(([id]) => id).filter((id) => !placed.has(id)));
  return h(
    'div',
    { class: 'settings-list' },
    groups
      .filter(([, ids]) => ids.length)
      .map(([title, ids]) =>
        h(
          'section',
          { class: 'slist-group' },
          h('h3', null, t(title)),
          h(
            'div',
            { class: 'slist-box' },
            ids.map((id) =>
              h('a', { class: 'slist-row', href: `#/settings/${id}` }, h('span', { class: 'slist-ico' }, icon(icons[id], 18)), h('span', { class: 'slist-txt' }, h('span', { class: 'slist-name' }, t(`set.sec.${id}`)), sub[id] ? h('span', { class: 'slist-sub' }, sub[id]) : null), icon('chevron-right', 18))
            )
          )
        )
      )
  );
}

export function settingsView({ section }) {
  section = ALIASES[section] ?? section;
  const el = h('div', { class: 'page settings' });
  const nav = h('nav', { class: 'settings-nav' });
  const panel = h('div', { class: 'settings-panel' });
  el.append(h('h1', { class: 'page-title' }, t('nav.settings')), h('div', { class: 'settings-layout' }, nav, panel));

  const app = () => state.settings.appearance;
  const pl = () => state.settings.player;
  const gen = () => state.settings.general;
  const cleanups = []; // beim Verlassen der Ansicht abzuraeumen (Ereignis-Abonnements)

  // Aenderungen sofort anwenden, gebuendelt speichern (Slider loesen sehr viele Ereignisse aus).
  let queued = {};
  const flush = debounce(() => {
    const patch = queued;
    queued = {};
    updateSettings(patch).catch((e) => toast(e.message, { type: 'error' }));
  }, 250);
  const saveSoon = (patch) => {
    for (const [sec, values] of Object.entries(patch)) queued[sec] = { ...(queued[sec] ?? {}), ...values };
    flush();
    // Startseite und Bibliothek bleiben beim Verlassen im Speicher des Routers und haben die Einstellungen beim Aufbau gelesen (Banner wechselt, Trailer, Marken, Spoiler-Schutz):
    // sie werden verworfen, damit die naechste Ansicht die neuen Werte zeigt, ohne dass man neu laden muss. Reine Darstellung (Farben, Radius, Postergroesse) wirkt ohnehin sofort per CSS.
    if (Object.entries(patch).some(([sec, values]) => LIVE_VIEW_KEYS[sec] === '*' || Object.keys(values).some((k) => LIVE_VIEW_KEYS[sec]?.includes(k)))) invalidate();
  };
  const setAppearance = (patch) => {
    Object.assign(state.settings.appearance, patch);
    applyAppearance(state.settings.appearance);
    saveSoon({ appearance: patch });
  };
  const setPlayer = (patch) => {
    Object.assign(state.settings.player, patch);
    saveSoon({ player: patch });
  };
  const setGeneral = (patch) => {
    Object.assign(state.settings.general, patch);
    saveSoon({ general: patch });
  };
  const setTrailer = (patch) => {
    state.settings.trailer = { ...state.settings.trailer, ...patch };
    saveSoon({ trailer: patch });
  };
  const langOptions = (first) => [{ value: 'server', label: first }, ...LANGS.map((c) => ({ value: c, label: langName(c) || c }))];

  // ---------- Erscheinungsbild ----------
  function appearancePanel() {
    const themes = h(
      'div',
      { class: 'theme-grid' },
      Object.entries(THEMES).map(([id, th]) => {
        const b = h(
          'button',
          { class: `theme-tile${app().theme === id ? ' on' : ''}`, type: 'button', 'data-theme-id': id, 'aria-pressed': app().theme === id },
          h('span', { class: 'theme-sw', style: { background: th.bg } }, h('i', { style: { background: th.surface } }), h('i', { style: { background: 'var(--accent)' } })),
          h('span', null, th.name)
        );
        b.addEventListener('click', () => {
          themes.querySelectorAll('.theme-tile').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-pressed', x === b);
          });
          setAppearance({ theme: id });
        });
        return b;
      })
    );

    const swatches = h('div', { class: 'swatches' });
    const color = h('input', { type: 'color', class: 'color-input', value: app().accent, 'aria-label': t('set.accentCustom') });
    const hex = h('input', { class: 'field hex', type: 'text', value: app().accent.toUpperCase(), maxlength: 7, spellcheck: 'false', 'aria-label': t('set.accentHex'), placeholder: '#F5F5F7' });
    const mark = () => {
      const cur = app().accent.toLowerCase();
      swatches.querySelectorAll('.swatch[data-color]').forEach((s) => s.classList.toggle('on', s.dataset.color === cur));
      swatches.querySelector('.swatch.custom')?.classList.toggle('on', !ACCENTS.includes(cur));
      swatches.style.setProperty('--cur', cur);
    };
    const setAccent = (c, { fromHex = false } = {}) => {
      color.value = c;
      if (!fromHex) hex.value = c.toUpperCase();
      hex.classList.remove('invalid');
      setAppearance({ accent: c });
      mark();
    };
    ACCENTS.forEach((c) => {
      const b = h('button', { class: 'swatch', type: 'button', 'data-color': c, 'aria-label': c, title: c.toUpperCase() });
      b.style.setProperty('--c', c);
      b.addEventListener('click', () => setAccent(c));
      swatches.append(b);
    });
    color.addEventListener('input', () => setAccent(color.value));
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (v && !v.startsWith('#')) v = `#${v}`;
      if (isHexColor(v)) setAccent(v.toLowerCase(), { fromHex: true });
      else hex.classList.toggle('invalid', v.length >= 7);
    });
    const reset = h('button', { class: 'btn glass sm', type: 'button', title: t('set.reset') }, icon('refresh', 15), h('span', null, t('set.reset')));
    reset.addEventListener('click', () => setAccent(DEFAULT_ACCENT));
    swatches.append(h('label', { class: 'swatch custom', title: t('set.accentCustom') }, icon('plus', 16), color));
    const accentControl = h('div', { class: 'accent-control' }, swatches, h('div', { class: 'accent-hex' }, hex, reset));
    mark();

    return h(
      'div',
      { class: 'settings-stack' },
      group(
        null,
        setting(t('set.theme'), t('set.themeDesc'), themes, { wide: true }),
        setting(t('set.accent'), t('set.accentDesc'), accentControl, { wide: true }),
        setting(t('set.posterSize'), t('set.posterSizeDesc'), slider({ min: 120, max: 260, step: 4, value: app().posterSize, format: (v) => `${v}px`, onInput: (v) => setAppearance({ posterSize: v }) })),
        setting(t('set.radius'), t('set.radiusDesc'), slider({ min: 0, max: 28, step: 1, value: app().radius, format: (v) => `${v}px`, onInput: (v) => setAppearance({ radius: v }) })),
        setting(
          t('set.animations'),
          t('set.animationsDesc'),
          segmented(
            [
              { value: 'full', label: t('set.animFull') },
              { value: 'reduced', label: t('set.animReduced') },
              { value: 'off', label: t('set.animOff') }
            ],
            app().animations,
            (v) => setAppearance({ animations: v })
          )
        ),
        setting(t('set.blur'), t('set.blurDesc'), toggle(app().blur, (v) => setAppearance({ blur: v }), t('set.blur'))),
        setting(
          t('set.startAnimation'),
          t('set.startAnimationDesc'),
          h(
            'div',
            { class: 'ctl-pair' },
            h('button', { class: 'btn glass sm', type: 'button', onclick: previewSplash }, icon('play', 14), h('span', null, t('set.startAnimationPreview'))),
            toggle(app().startAnimation !== false, (v) => setAppearance({ startAnimation: v }), t('set.startAnimation'))
          )
        ),
        setting(t('set.ambient'), t('set.ambientDesc'), toggle(app().ambient, (v) => setAppearance({ ambient: v }), t('set.ambient'))),
        setting(t('set.badges'), t('set.badgesDesc'), toggle(app().showBadges, (v) => setAppearance({ showBadges: v }), t('set.badges'))),
        setting(t('set.cardTitles'), t('set.cardTitlesDesc'), toggle(app().cardTitles, (v) => setAppearance({ cardTitles: v }), t('set.cardTitles'))),
        setting(
          t('set.language'),
          t('set.languageDesc'),
          segmented(
            [
              { value: 'auto', label: t('set.langAuto') },
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' }
            ],
            state.settings.language,
            async (v) => {
              state.settings.language = v;
              await updateSettings({ language: v });
              setLocale(v === 'auto' ? navigator.language : v);
              document.dispatchEvent(new CustomEvent('relocalize'));
            }
          )
        )
      )
    );
  }

  // ---------- Startseite ----------
  function homePanel() {
    const cfg = () => HomeRows.homeConfig(state.settings.home);
    const setHome = (patch) => {
      state.settings.home = HomeRows.homeConfig({ ...state.settings.home, ...patch });
      saveSoon({ home: patch });
    };
    const libs = () => state.views.filter((v) => ['movies', 'tvshows'].includes(v.CollectionType));
    const labelOf = (id) => {
      if (id.startsWith('latest:')) return t('home.latestIn', { name: state.views.find((v) => v.Id === id.slice(7))?.Name ?? '…' });
      return { continue: t('home.continue'), nextUp: t('home.nextUp'), favorites: t('home.favorites'), trending: t('home.trending') }[id] ?? id;
    };
    const presentIds = () => HomeRows.defaultOrder(libs().map((v) => v.Id));
    const arranged = () => HomeRows.arrangeAll(presentIds(), cfg().order);
    // "Filme im Trend" nutzt den bestehenden Schalter (appearance.homeTrending), alle anderen Reihen die Liste "hidden"
    const isOff = (id) => (id === 'trending' ? app().homeTrending === false : cfg().hidden.includes(id));

    const list = h('div', { class: 'home-rows' });
    const move = (id, delta) => {
      setHome({ order: HomeRows.moveRow(arranged(), id, delta) });
      paintRows();
    };
    function paintRows() {
      const ids = arranged();
      list.replaceChildren(
        ...ids.map((id, i) => {
          const name = labelOf(id);
          const line = h('div', { class: `home-row${isOff(id) ? ' off' : ''}`, 'data-row': id });
          const mover = (delta, ic, key) => {
            const b = h('button', { class: 'btn glass icon sm', type: 'button', title: t(key), 'aria-label': `${name}: ${t(key)}`, disabled: delta < 0 ? i === 0 : i === ids.length - 1 }, icon(ic, 16));
            b.addEventListener('click', () => move(id, delta));
            return b;
          };
          const sw = toggle(
            !isOff(id),
            (on) => {
              if (id === 'trending') setAppearance({ homeTrending: on });
              else setHome({ hidden: on ? cfg().hidden.filter((x) => x !== id) : [...cfg().hidden.filter((x) => x !== id), id] });
              line.classList.toggle('off', !on);
            },
            name
          );
          line.append(h('span', { class: 'home-row-pos' }, String(i + 1)), h('span', { class: 'home-row-name' }, name), h('div', { class: 'home-row-move' }, mover(-1, 'chevron-up', 'set.homeRowUp'), mover(1, 'chevron-down', 'set.homeRowDown')), sw);
          return line;
        })
      );
    }
    paintRows();

    const resetBtn = h('button', { class: 'btn glass sm', type: 'button' }, t('set.homeResetBtn'));
    resetBtn.addEventListener('click', () => {
      state.settings.home = HomeRows.homeConfig(HomeRows.DEFAULTS);
      saveSoon({ home: structuredClone(HomeRows.DEFAULTS) });
      setAppearance({ homeTrending: true, heroAutoplay: true });
      toast(t('set.homeResetDone'));
      panel.replaceChildren(homePanel());
    });

    return h(
      'div',
      null,
      group(
        t('set.homeBannerGroup'),
        setting(t('set.homeHero'), t('set.homeHeroDesc'), toggle(cfg().hero, (v) => setHome({ hero: v }), t('set.homeHero'))),
        setting(t('set.heroAutoplay'), t('set.heroAutoplayDesc'), toggle(app().heroAutoplay, (v) => setAppearance({ heroAutoplay: v }), t('set.heroAutoplay'))),
        setting(t('set.homeHeroSlides'), t('set.homeHeroSlidesDesc'), slider({ min: HomeRows.LIMITS.heroSlides[0], max: HomeRows.LIMITS.heroSlides[1], step: 1, value: cfg().heroSlides, onInput: (v) => setHome({ heroSlides: v }) })),
        setting(t('set.homeHeroTrend'), t('set.homeHeroTrendDesc'), slider({ min: HomeRows.LIMITS.heroTrend[0], max: HomeRows.LIMITS.heroTrend[1], step: 1, value: cfg().heroTrend, onInput: (v) => setHome({ heroTrend: v }) }))
      ),
      group(t('set.homeRowsGroup'), h('div', { class: 'home-rows-note' }, t('set.homeRowsDesc')), list),
      group(null, setting(t('set.homeReset'), t('set.homeResetDesc'), resetBtn))
    );
  }

  // ---------- Bild & HDR ----------
  function videoPanel() {
    const pic = (key, label) => setting(label, null, slider({ min: -50, max: 50, step: 1, value: pl()[key], format: (v) => (v > 0 ? `+${v}` : `${v}`), onInput: (v) => setPlayer({ [key]: v }) }));
    return h(
      'div',
      { class: 'settings-stack' },
      group(
        t('set.grp.hdr'),
        setting(
          t('set.hdr'),
          t('set.hdrDesc'),
          segmented(
            [
              { value: 'auto', label: t('set.hdrAuto') },
              { value: 'passthrough', label: t('set.hdrPass') },
              { value: 'tonemap', label: t('set.hdrTone') }
            ],
            pl().hdr,
            (v) => setPlayer({ hdr: v })
          )
        ),
        setting(
          t('set.toneMapping'),
          t('set.toneMappingDesc'),
          menuSelect(
            [
              { value: 'auto', label: t('set.auto') },
              { value: 'bt.2390', label: 'BT.2390', sub: t('set.tmRecommended') },
              { value: 'spline', label: 'Spline' },
              { value: 'mobius', label: 'Mobius' },
              { value: 'reinhard', label: 'Reinhard' },
              { value: 'hable', label: 'Hable' },
              { value: 'clip', label: 'Clip' }
            ],
            pl().toneMapping,
            (v) => setPlayer({ toneMapping: v })
          )
        ),
        setting(t('set.hdrPeak'), t('set.hdrPeakDesc'), menuSelect(onOff(t('set.on'), t('set.off')), pl().hdrPeak, (v) => setPlayer({ hdrPeak: v })))
      ),
      group(
        t('set.grp.decode'),
        setting(
          t('set.hwdec'),
          t('set.hwdecDesc'),
          menuSelect(
            [
              { value: 'auto-safe', label: t('set.hwdecAuto') },
              { value: 'd3d11va', label: 'D3D11VA' },
              { value: 'd3d11va-copy', label: 'D3D11VA (copy)' },
              { value: 'nvdec', label: 'NVDEC' },
              { value: 'no', label: t('set.hwdecOff') }
            ],
            pl().hwdec,
            (v) => setPlayer({ hwdec: v })
          )
        ),
        setting(
          t('set.gpuApi'),
          t('set.gpuApiDesc'),
          segmented(
            [
              { value: 'd3d11', label: 'Direct3D 11' },
              { value: 'vulkan', label: 'Vulkan' }
            ],
            pl().gpuApi,
            (v) => setPlayer({ gpuApi: v })
          )
        ),
        setting(
          t('set.scale'),
          t('set.scaleDesc'),
          segmented(
            [
              { value: 'fast', label: t('set.scaleFast') },
              { value: 'default', label: t('set.scaleDefault') },
              { value: 'high', label: t('set.scaleHigh') }
            ],
            pl().scalePreset,
            (v) => setPlayer({ scalePreset: v })
          )
        ),
        setting(
          t('set.videoSync'),
          t('set.videoSyncDesc'),
          segmented(
            [
              { value: 'audio', label: t('set.syncAudio') },
              { value: 'display-resample', label: t('set.syncDisplay') }
            ],
            pl().videoSync,
            (v) => setPlayer({ videoSync: v })
          )
        ),
        setting(t('set.interpolation'), t('set.interpolationDesc'), toggle(pl().interpolation, (v) => setPlayer({ interpolation: v }), t('set.interpolation'))),
        setting(t('set.deband'), t('set.debandDesc'), toggle(pl().deband, (v) => setPlayer({ deband: v }), t('set.deband'))),
        setting(t('set.deinterlace'), t('set.deinterlaceDesc'), toggle(pl().deinterlace === 'yes', (v) => setPlayer({ deinterlace: v ? 'yes' : 'no' }), t('set.deinterlace')))
      ),
      group(t('set.grp.picture'), pic('brightness', t('set.brightness')), pic('contrast', t('set.contrast')), pic('saturation', t('set.saturation')), pic('gamma', t('set.gamma')))
    );
  }

  // ---------- Ton ----------
  function audioPanel() {
    let devices = null;
    const devLabel = h('span', null, pl().audioDevice === 'auto' ? t('set.auto') : pl().audioDevice);
    const devBtn = h('button', { class: 'btn glass sm select', type: 'button' }, devLabel, icon('chevron-down', 14));
    window.jc.audioDevices().then((list) => {
      devices = list;
      const cur = list.find((d) => d.id === pl().audioDevice);
      if (cur) devLabel.textContent = cur.id === 'auto' ? t('set.auto') : cur.name;
    }).catch(() => {});
    devBtn.addEventListener('click', async () => {
      if (!devices) devices = await window.jc.audioDevices().catch(() => []);
      openMenu(devBtn, devices.map((d) => ({ id: d.id, label: d.id === 'auto' ? t('set.auto') : d.name, selected: d.id === pl().audioDevice })), {
        align: 'right',
        maxHeight: 420,
        onPick: (e) => {
          devLabel.textContent = e.label;
          setPlayer({ audioDevice: e.id });
        }
      });
    });
    // Was die App erkannt hat und wie sie den Ton ausgibt (macht die automatische Wahl nachvollziehbar)
    const detectedText = h('span', { class: 'muted' }, '…');
    const detectedRow = setting(t('set.audioDetected'), t('set.audioDetectedDesc'), detectedText);
    const describeOutput = (o) => {
      const mode = o.channels === 'auto-safe' ? (o.outChannels === 6 ? '5.1' : o.outChannels === 8 ? '7.1' : o.outChannels === 2 ? 'Stereo' : t('set.auto')) : o.channels === 'stereo' ? 'Stereo' : o.channels;
      const parts = [o.device ? `${o.device.name} (${o.device.channels || '?'} ${t('set.channelsShort')}) → ${mode}` : t('set.audioUnknown')];
      if (o.passthroughBlocked) parts.push(t('set.passthroughBlocked'));
      return parts.join(' · ');
    };
    window.jc.audioOutput().then((o) => (detectedText.textContent = describeOutput(o))).catch(() => (detectedRow.hidden = true));
    return h(
      'div',
      { class: 'settings-stack' },
      group(
        t('set.grp.output'),
        setting(t('set.audioDevice'), t('set.audioDeviceDesc'), devBtn),
        detectedRow,
        setting(
          t('set.audioChannels'),
          t('set.audioChannelsDesc'),
          segmented(
            [
              { value: 'auto', label: t('set.auto') },
              { value: 'stereo', label: 'Stereo' },
              { value: '5.1', label: '5.1' },
              { value: '7.1', label: '7.1' }
            ],
            pl().audioChannels,
            (v) => setPlayer({ audioChannels: v })
          )
        ),
        setting(t('set.passthrough'), t('set.passthroughDesc'), toggle(pl().audioPassthrough, (v) => setPlayer({ audioPassthrough: v }), t('set.passthrough'))),
        setting(t('set.exclusive'), t('set.exclusiveDesc'), toggle(pl().audioExclusive, (v) => setPlayer({ audioExclusive: v }), t('set.exclusive')))
      ),
      group(t('set.grp.sound'), setting(t('set.nightMode'), t('set.nightModeDesc'), toggle(pl().nightMode, (v) => setPlayer({ nightMode: v }), t('set.nightMode'))))
    );
  }

  // ---------- Sprache & Untertitel ----------
  function subtitlesPanel() {
    const preview = h('div', { class: 'sub-preview' }, h('span', { class: 'sub-sample' }, t('set.subSample')));
    const sample = preview.firstChild;
    const paint = () => {
      const p = pl();
      sample.style.fontFamily = `"${p.subtitleFont}", sans-serif`;
      sample.style.fontSize = `${Math.round(22 * p.subtitleScale)}px`;
      sample.style.fontWeight = p.subtitleBold ? '800' : '500';
      sample.style.color = p.subtitleColor;
      sample.style.webkitTextStroke = `${p.subtitleOutline * 1.6}px #000`;
      sample.style.background = `rgb(0 0 0 / ${p.subtitleBackground / 100})`;
      preview.style.setProperty('--pos', `${Math.max(2, (100 - p.subtitlePos) * 1.6 + 8)}px`);
    };
    const set = (patch) => {
      setPlayer(patch);
      paint();
    };
    paint();

    const colors = h('div', { class: 'swatches' });
    SUB_COLORS.forEach((c) => {
      const b = h('button', { class: `swatch${pl().subtitleColor.toLowerCase() === c ? ' on' : ''}`, type: 'button', 'data-color': c, 'aria-label': c });
      b.style.setProperty('--c', c);
      b.addEventListener('click', () => {
        colors.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
        set({ subtitleColor: c });
      });
      colors.append(b);
    });

    return h(
      'div',
      { class: 'settings-stack' },
      group(
        t('set.grp.language'),
        setting(t('set.audioLanguage'), t('set.audioLanguageDesc'), menuSelect(langOptions(t('set.langServer')), pl().audioLanguage, (v) => setPlayer({ audioLanguage: v }))),
        setting(
          t('set.subMode'),
          t('set.subModeDesc'),
          menuSelect(
            [
              { value: 'server', label: t('set.langServer') },
              { value: 'off', label: t('set.subOff') },
              { value: 'forced', label: t('set.subForced') },
              { value: 'always', label: t('set.subAlways') },
              { value: 'smart', label: t('set.subSmart') }
            ],
            pl().subtitleMode,
            (v) => setPlayer({ subtitleMode: v })
          )
        ),
        setting(t('set.subLang'), t('set.subLangDesc'), menuSelect(langOptions(t('set.subLangUi')), pl().subtitleLanguage, (v) => setPlayer({ subtitleLanguage: v })))
      ),
      group(
        t('set.grp.style'),
        h('div', { class: 'setting wide' }, preview),
        setting(t('set.subScale'), t('set.subScaleDesc'), slider({ min: 0.5, max: 2, step: 0.05, value: pl().subtitleScale, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => set({ subtitleScale: v }) })),
        setting(t('set.subPos'), t('set.subPosDesc'), slider({ min: 50, max: 100, step: 1, value: pl().subtitlePos, format: (v) => `${v}%`, onInput: (v) => set({ subtitlePos: v }) })),
        setting(t('set.subColor'), null, colors),
        setting(t('set.subOutline'), null, slider({ min: 0, max: 6, step: 0.5, value: pl().subtitleOutline, format: (v) => `${v} px`, onInput: (v) => set({ subtitleOutline: v }) })),
        setting(t('set.subBackground'), t('set.subBackgroundDesc'), slider({ min: 0, max: 80, step: 5, value: pl().subtitleBackground, format: (v) => `${v}%`, onInput: (v) => set({ subtitleBackground: v }) })),
        setting(t('set.subBold'), null, toggle(pl().subtitleBold, (v) => set({ subtitleBold: v }), t('set.subBold'))),
        setting(t('set.subFont'), null, menuSelect(FONTS.map((f) => ({ value: f, label: f })), pl().subtitleFont, (v) => set({ subtitleFont: v }))),
        setting(t('set.subAss'), t('set.subAssDesc'), toggle(pl().subtitleAssStyle, (v) => set({ subtitleAssStyle: v }), t('set.subAss')))
      )
    );
  }

  // ---------- Wiedergabe-Verhalten ----------
  function behaviorPanel() {
    const skipOptions = [
      { value: 'button', label: t('set.skipButton') },
      { value: 'auto', label: t('set.skipAuto') },
      { value: 'off', label: t('set.animOff') }
    ];
    return h(
      'div',
      { class: 'settings-stack' },
      group(
        t('set.grp.start'),
        setting(t('set.autoNext'), t('set.autoNextDesc'), toggle(pl().autoplayNext, (v) => setPlayer({ autoplayNext: v }), t('set.autoNext'))),
        setting(t('set.skipIntro'), t('set.skipIntroDesc'), segmented(skipOptions, pl().skipIntro, (v) => setPlayer({ skipIntro: v }))),
        setting(t('set.skipOutro'), t('set.skipOutroDesc'), segmented(skipOptions, pl().skipOutro, (v) => setPlayer({ skipOutro: v }))),
        setting(
          t('set.skipCountdown'),
          t('set.skipCountdownDesc'),
          menuSelect(
            [0, 3, 6, 10, 15].map((v) => ({ value: v, label: v ? `${v} s` : t('set.off') })),
            pl().skipCountdown ?? 6,
            (v) => setPlayer({ skipCountdown: v })
          )
        ),
        setting(t('set.rewind'), t('set.rewindDesc'), slider({ min: 0, max: 30, step: 1, value: pl().resumeRewindSec, format: (v) => `${v} s`, onInput: (v) => setPlayer({ resumeRewindSec: v }) })),
        setting(t('set.fullscreenOnPlay'), t('set.fullscreenOnPlayDesc'), toggle(pl().fullscreenOnPlay, (v) => setPlayer({ fullscreenOnPlay: v }), t('set.fullscreenOnPlay')))
      ),
      group(
        t('set.grp.trailer'),
        setting(t('set.trailerAuto'), t('set.trailerAutoDesc'), toggle(!!state.settings.trailer?.autoplay, (v) => setTrailer({ autoplay: v }), t('set.trailerAuto'))),
        setting(t('set.trailerHome'), t('set.trailerHomeDesc'), toggle(state.settings.trailer?.home !== false, (v) => setTrailer({ home: v }), t('set.trailerHome'))),
        setting(t('set.trailerMuted'), t('set.trailerMutedDesc'), toggle(state.settings.trailer?.muted !== false, (v) => setTrailer({ muted: v }), t('set.trailerMuted'))),
        setting(t('set.trailerDelay'), t('set.trailerDelayDesc'), slider({ min: 0, max: 10, step: 1, value: state.settings.trailer?.delaySec ?? 0, format: (v) => `${v} s`, onInput: (v) => setTrailer({ delaySec: v }) })),
        setting(t('set.trailerFocus'), t('set.trailerFocusDesc'), slider({ min: 0, max: 60, step: 5, value: state.settings.trailer?.focusSec ?? 10, format: (v) => (v ? `${v} s` : t('set.off')), onInput: (v) => setTrailer({ focusSec: v }) })),
        setting(
          t('set.trailerStyle'),
          t('set.trailerStyleDesc'),
          segmented(
            [
              { value: 'corner', label: t('set.trailerStyleCorner') },
              { value: 'poster', label: t('set.trailerStylePoster') }
            ],
            state.settings.trailer?.focusStyle === 'poster' ? 'poster' : 'corner',
            (v) => setTrailer({ focusStyle: v })
          )
        ),
        setting(t('set.trailerVolume'), t('set.trailerVolumeDesc'), slider({ min: 5, max: 100, step: 5, value: state.settings.trailer?.volume ?? 10, format: (v) => `${v}%`, onInput: (v) => setTrailer({ volume: v }) })),
        setting(
          t('set.trailerQuality'),
          t('set.trailerQualityDesc'),
          segmented(
            [
              { value: '2160', label: t('set.trailerQ2160') },
              { value: '1080', label: 'Full HD' },
              { value: '720', label: '720p' }
            ],
            trailerTier(state.settings.trailer?.quality),
            (v) => setTrailer({ quality: v })
          )
        )
      ),
      group(
        t('set.grp.controls'),
        setting(t('set.seekSmall'), t('set.seekSmallDesc'), slider({ min: 1, max: 30, step: 1, value: pl().seekSmall, format: (v) => `${v} s`, onInput: (v) => setPlayer({ seekSmall: v }) })),
        setting(t('set.seekBig'), t('set.seekBigDesc'), slider({ min: 5, max: 120, step: 5, value: pl().seekBig, format: (v) => `${v} s`, onInput: (v) => setPlayer({ seekBig: v }) })),
        setting(
          t('set.wheel'),
          t('set.wheelDesc'),
          segmented(
            [
              { value: 'volume', label: t('set.wheelVolume') },
              { value: 'seek', label: t('set.wheelSeek') },
              { value: 'none', label: t('set.animOff') }
            ],
            pl().wheelAction,
            (v) => setPlayer({ wheelAction: v })
          )
        )
      ),
      group(
        t('set.grp.pause'),
        setting(t('set.pauseScreen'), t('set.pauseScreenDesc'), toggle(pl().pauseScreen, (v) => setPlayer({ pauseScreen: v }), t('set.pauseScreen'))),
        setting(
          t('set.pauseScreenSec'),
          t('set.pauseScreenSecDesc'),
          menuSelect(
            [3, 6, 10, 20].map((v) => ({ value: v, label: `${v} s` })),
            pl().pauseScreenSec,
            (v) => setPlayer({ pauseScreenSec: v })
          )
        )
      ),
      group(
        t('set.grp.system'),
        setting(t('set.pauseOnMinimize'), t('set.pauseOnMinimizeDesc'), toggle(pl().pauseOnMinimize, (v) => setPlayer({ pauseOnMinimize: v }), t('set.pauseOnMinimize'))),
        setting(t('set.preventSleep'), t('set.preventSleepDesc'), toggle(pl().preventSleep, (v) => setPlayer({ preventSleep: v }), t('set.preventSleep')))
      )
    );
  }

  // ---------- Netzwerk & Qualitaet ----------
  function networkPanel() {
    const bitrate = [0, 80, 40, 20, 12, 8, 4].map((v) => ({ value: v, label: v === 0 ? t('set.qualityOriginal') : `${v} Mbit/s` }));
    const buffers = [64, 128, 256, 512, 1024].map((v) => ({ value: v, label: v >= 1024 ? '1 GB' : `${v} MB` }));

    // Bitratenlimit des Servers: gilt nur ueber das Internet, im lokalen Netz fragt die App nichts weiter ab (siehe JellyfinClient.getStreamingLimits)
    const mbit = (bps) => `${+(bps / 1e6).toFixed(1)} Mbit/s`;
    const describeLimits = (l) => {
      if (!l) return '—';
      if (l.remote === false) return t('set.limitsLocal');
      const parts = [];
      if (l.user > 0) parts.push(`${t('set.limitsUser')} ${mbit(l.user)}`);
      if (l.server > 0) parts.push(`${t('set.limitsServer')} ${mbit(l.server)}`);
      let text = l.limitBps > 0 ? t('set.limitsRemote', { n: mbit(l.limitBps) }) + (parts.length > 1 ? ` (${parts.join(', ')})` : '') : t('set.limitsNone');
      if (!l.serverKnown) text += ` · ${t('set.limitsUnreadable')}`;
      return l.remote === null ? `${t('set.limitsUnknown')} · ${text}` : text;
    };
    const limitText = h('span', { class: 'setting-desc limit-text' }, '…');
    const check = h('button', { class: 'btn glass sm', type: 'button' }, icon('refresh', 16), h('span', null, t('set.limitsCheck')));
    const limitRow = setting(t('set.limits'), t('set.limitsDesc'), h('div', { class: 'row-gap' }, limitText, check));
    const paintLimits = (force) => {
      limitText.textContent = '…';
      return window.jc.streamingLimits(force).then((l) => (limitText.textContent = describeLimits(l))).catch(() => (limitRow.hidden = true));
    };
    check.addEventListener('click', () => paintLimits(true));
    paintLimits(false);

    return h(
      'div',
      { class: 'settings-stack' },
      group(t('set.grp.limits'), limitRow),
      group(
        t('set.grp.quality'),
        setting(t('set.quality'), t('set.qualityDesc'), menuSelect(bitrate, pl().maxBitrateMbps, (v) => setPlayer({ maxBitrateMbps: v }))),
        setting(t('set.allowTranscode'), t('set.allowTranscodeDesc'), toggle(pl().allowTranscode, (v) => setPlayer({ allowTranscode: v }), t('set.allowTranscode')))
      ),
      group(
        t('set.grp.buffer'),
        setting(t('set.buffer'), t('set.bufferDesc'), menuSelect(buffers, pl().bufferMb, (v) => setPlayer({ bufferMb: v }))),
        setting(t('set.readahead'), t('set.readaheadDesc'), slider({ min: 10, max: 120, step: 5, value: pl().readaheadSec, format: (v) => `${v} s`, onInput: (v) => setPlayer({ readaheadSec: v }) }))
      ),
      group(t('set.grp.security'), setting(t('set.selfSigned'), t('set.selfSignedDesc'), toggle(pl().allowSelfSigned, (v) => setPlayer({ allowSelfSigned: v }), t('set.selfSigned'))))
    );
  }

  // ---------- Allgemein ----------
  function generalPanel() {
    // mpv ist fest eingebaut: reine Statusanzeige, keine Auswahl.
    const engine = h('div', { class: 'mpv-status' });
    const paintMpv = (m) => {
      state.mpv = m;
      engine.replaceChildren();
      engine.classList.toggle('bad', !m?.ok);
      if (m?.ok) engine.append(icon('check-circle', 22), h('div', null, h('div', { class: 'setting-label' }, t('set.engineOk', { v: m.versionText })), h('div', { class: 'setting-desc' }, t('set.engineDesc'))));
      else engine.append(icon('info', 22), h('div', null, h('div', { class: 'setting-label' }, t('set.engineMissing')), h('div', { class: 'setting-desc' }, t('set.engineMissingDesc'))));
    };
    paintMpv(state.mpv);
    if (!state.mpv) window.jc.detectMpv().then(paintMpv).catch(() => {});

    const cacheText = h('span', { class: 'setting-desc' }, '…');
    const paintCache = () =>
      window.jc.cacheInfo().then((c) => {
        cacheText.textContent = t('set.cacheInfo', { n: c.images, size: fmtSize(c.bytes) || '0 MB' });
      }).catch(() => {});
    paintCache();
    const clear = h('button', { class: 'btn glass sm', type: 'button' }, icon('trash', 15), h('span', null, t('set.cacheClear')));
    clear.addEventListener('click', async () => {
      await window.jc.clearCache();
      toast(t('set.cacheCleared'));
      paintCache();
    });

    const resetBtn = h('button', { class: 'btn danger sm', type: 'button' }, icon('refresh', 15), h('span', null, t('set.resetAll')));
    let armed = null;
    resetBtn.addEventListener('click', async () => {
      if (!armed) {
        resetBtn.querySelector('span:last-child').textContent = t('set.resetConfirm');
        armed = setTimeout(() => {
          armed = null;
          resetBtn.querySelector('span:last-child').textContent = t('set.resetAll');
        }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      try {
        state.settings = await window.jc.resetSettings();
        toast(t('set.resetDone'));
        document.dispatchEvent(new CustomEvent('relocalize'));
      } catch (e) {
        toast(e.message, { type: 'error' });
      }
    });

    const desktop = state.platform === 'desktop'; // Engine, Autostart, Fensterwahl und Selbst-Aktualisierung gibt es nur im Desktop-Programm
    return h(
      'div',
      { class: 'settings-stack' },
      desktop ? group(t('set.grp.engine'), h('div', { class: 'setting wide' }, engine)) : null,
      group(
        t('set.grp.app'),
        desktop ? setting(t('set.autostart'), state.autostartSupported ? t('set.autostartDesc') : t('set.autostartDev'), toggle(gen().autostart, (v) => setGeneral({ autostart: v }), t('set.autostart'))) : null,
        desktop ? setting(t('set.startMinimized'), t('set.startMinimizedDesc'), toggle(gen().startMinimized, (v) => setGeneral({ startMinimized: v }), t('set.startMinimized'))) : null,
        desktop ? setting(t('set.rememberWindow'), t('set.rememberWindowDesc'), toggle(gen().rememberWindow, (v) => setGeneral({ rememberWindow: v }), t('set.rememberWindow'))) : null,
        setting(t('set.spoiler'), t('set.spoilerDesc'), toggle(gen().spoilerProtection, (v) => setGeneral({ spoilerProtection: v }), t('set.spoiler')))
      ),
      desktop
        ? group(
            t('upd.title'),
            setting(t('set.autoUpdate'), t('set.autoUpdateDesc'), toggle(gen().autoUpdate, (v) => setGeneral({ autoUpdate: v }), t('set.autoUpdate')))
          )
        : null,
      group(t('set.grp.data'), setting(t('set.cache'), null, h('div', { class: 'row-gap' }, cacheText, clear)), setting(t('set.resetAllLabel'), t('set.resetAllDesc'), resetBtn))
    );
  }

  // ---------- Konto ----------
  function accountPanel() {
    const active = activeServer();
    const list = h('div', { class: 'server-list' });
    state.servers.forEach((s) => {
      const isActive = s.id === state.activeServerId;
      const switchBtn = h('button', { class: 'btn glass sm', type: 'button', disabled: isActive }, isActive ? t('set.active') : t('set.switch'));
      switchBtn.addEventListener('click', async () => {
        try {
          await window.jc.switchServer(s.id);
          document.dispatchEvent(new CustomEvent('relogin'));
        } catch (e) {
          toast(e.message, { type: 'error' });
        }
      });
      list.append(h('div', { class: `server-row${isActive ? ' on' : ''}` }, icon('server', 20), h('div', { class: 'grow' }, h('div', { class: 'setting-label' }, s.name || s.url), h('div', { class: 'setting-desc' }, `${s.userName} · ${s.url}`)), switchBtn));
    });
    const add = h('button', { class: 'btn glass', type: 'button' }, icon('plus', 18), h('span', null, t('set.addServer')));
    add.addEventListener('click', () => document.dispatchEvent(new CustomEvent('add-server')));
    const out = h('button', { class: 'btn danger', type: 'button' }, icon('logout', 18), h('span', null, t('set.signOut')));
    out.addEventListener('click', async () => {
      try {
        await window.jc.logout();
        document.dispatchEvent(new CustomEvent('relogin'));
      } catch (e) {
        toast(e.message, { type: 'error' });
      }
    });
    return h(
      'div',
      { class: 'settings-stack' },
      h(
        'div',
        { class: 'settings-group' },
        h('div', { class: 'account-card' }, h('div', { class: 'avatar-lg' }, icon('user', 28)), h('div', null, h('div', { class: 'setting-label' }, active?.userName ?? '—'), h('div', { class: 'setting-desc' }, active ? `${active.name || ''} · ${active.url}` : ''))),
        list,
        h('div', { class: 'btn-row' }, add, out)
      )
    );
  }

  // ---------- Anfragen (Seerr) ----------
  function seerrPanel() {
    const refresh = () => panel.replaceChildren(seerrPanel());
    const info = state.seerr;
    if (info) {
      const out = h('button', { class: 'btn danger', type: 'button' }, icon('logout', 18), h('span', null, t('seerr.disconnect')));
      out.addEventListener('click', async () => {
        try {
          state.seerr = (await window.jc.seerrDisconnect()).seerr;
          invalidate(); // die Startseite im Speicher zeigt noch die Reihe "Filme im Trend"
          toast(t('seerr.disconnected'));
          refresh();
        } catch (e) {
          toast(e.message, { type: 'error' });
        }
      });
      return h('div', { class: 'settings-stack' }, h('div', { class: 'settings-group' }, h('div', { class: 'account-card' }, h('div', { class: 'avatar-lg' }, icon('plus', 28)), h('div', null, h('div', { class: 'setting-label' }, t('seerr.connected')), h('div', { class: 'setting-desc' }, t('seerr.statusLine', { url: info.url, user: info.userName })))), h('div', { class: 'btn-row' }, out)));
    }
    let mode = 'jellyfin';
    const err = h('div', { class: 'form-error', role: 'alert' });
    const url = h('input', { class: 'field', type: 'text', placeholder: 'seerr.example.com', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('seerr.url') });
    const user = h('input', { class: 'field', type: 'text', placeholder: t('login.user'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('login.user') });
    user.value = activeServer()?.userName ?? '';
    const pass = h('input', { class: 'field', type: 'password', placeholder: t('login.password'), autocomplete: 'off', 'aria-label': t('login.password') });
    const key = h('input', { class: 'field', type: 'password', placeholder: t('seerr.apiKey'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('seerr.apiKey') });
    const userRow = setting(t('login.user'), null, user);
    const passRow = setting(t('login.password'), t('seerr.passwordNote'), pass);
    const keyRow = setting(t('seerr.apiKey'), t('seerr.apiKeyDesc'), key);
    const paintMode = () => {
      userRow.hidden = passRow.hidden = mode !== 'jellyfin';
      keyRow.hidden = mode !== 'apikey';
    };
    paintMode();
    const connect = h('button', { class: 'btn primary', type: 'button' }, icon('link', 18), h('span', null, t('seerr.connect')));
    const submit = async () => {
      err.textContent = '';
      connect.disabled = true;
      try {
        state.seerr = (await window.jc.seerrConnect({ url: url.value, mode, username: user.value, password: pass.value, apiKey: key.value })).seerr;
        invalidate(); // die Startseite im Speicher zeigt noch den Hinweis zur Einrichtung
        toast(t('seerr.connected'));
        refresh();
      } catch (e) {
        err.textContent = e.message;
      } finally {
        connect.disabled = false;
      }
    };
    connect.addEventListener('click', submit);
    for (const input of [url, user, pass, key]) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    return h(
      'div',
      { class: 'settings-stack' },
      h('p', { class: 'setting-desc seerr-intro' }, t('seerr.intro')),
      group(
        t('seerr.grpConnection'),
        setting(t('seerr.url'), t('seerr.urlDesc'), url),
        setting(t('seerr.mode'), null, segmented([{ value: 'jellyfin', label: t('seerr.modeJellyfin') }, { value: 'apikey', label: t('seerr.modeKey') }], mode, (v) => {
          mode = v;
          paintMode();
        })),
        userRow,
        passRow,
        keyRow,
        h('div', { class: 'btn-row' }, connect),
        err
      )
    );
  }

  // ---------- Discord Rich Presence ----------
  function discordPanel() {
    const dc = () => state.settings.discord ?? {};
    const setDiscord = (patch) => {
      state.settings.discord = { ...dc(), ...patch };
      saveSoon({ discord: patch });
      setTimeout(paint, 700); // der Hauptprozess braucht einen Augenblick, dann steht der neue Stand
    };
    const status = h('div', { class: 'dc-status', role: 'status', 'aria-live': 'polite' });
    const testOut = h('div', { class: 'dc-test', role: 'status', 'aria-live': 'polite' });
    const statusText = (s) => {
      const who = s.user ? ` (${s.user})` : '';
      switch (s.state) {
        case 'showing':
          return t('dc.st.showing', { who });
        case 'idle':
          return s.user ? t('dc.st.connected', { user: s.user }) : t('dc.st.ready');
        case 'no-discord':
          return t('dc.st.noDiscord');
        case 'bad-id':
          return t('dc.st.badId');
        case 'invalid-id':
          return t('dc.st.invalidId');
        case 'no-id':
          return t('dc.st.noId');
        case 'error':
          return t('dc.st.error', { msg: s.error || '?' });
        default:
          return t('dc.st.off');
      }
    };
    async function paint() {
      try {
        const s = await window.jc.discordStatus();
        status.textContent = statusText(s);
        status.dataset.state = s.state;
      } catch {
        /* Hauptprozess antwortet nicht: Zeile bleibt, wie sie ist */
      }
    }
    paint();
    const poll = setInterval(paint, 2000);
    cleanups.push(() => clearInterval(poll));

    // Ist die Discord-Anwendung eingebaut, braucht niemand eine ID: das Feld ist dann nur fuer eine eigene Anwendung (mit eigenem Symbol) da
    const builtIn = !!state.discordBuiltIn;
    const idInput = h('input', { class: 'field dc-id', type: 'text', inputmode: 'numeric', maxlength: 20, placeholder: builtIn ? t('dc.builtInPh') : '123456789012345678', autocomplete: 'off', spellcheck: 'false', 'aria-label': builtIn ? t('dc.clientIdOptional') : t('dc.clientId') });
    idInput.value = dc().clientId ?? '';
    idInput.addEventListener('input', () => {
      const v = idInput.value.replace(/\D/g, '').slice(0, 20); // die Application-ID besteht nur aus Ziffern
      if (v !== idInput.value) idInput.value = v;
      testOut.textContent = '';
      setDiscord({ clientId: v });
    });
    const portal = h('button', { class: 'btn glass sm', type: 'button' }, icon('external', 15), h('span', null, t('dc.openPortal')));
    portal.addEventListener('click', () => window.jc.openExternal('https://discord.com/developers/applications').catch((e) => toast(e.message, { type: 'error' })));
    const testBtn = h('button', { class: 'btn glass sm', type: 'button' }, icon('refresh', 15), h('span', null, t('dc.test')));
    testBtn.addEventListener('click', async () => {
      testOut.className = 'dc-test';
      testOut.textContent = t('dc.testing');
      testBtn.disabled = true;
      try {
        const r = await window.jc.discordTest(idInput.value);
        const fail = { 'invalid-id': t('dc.st.invalidId'), busy: t('dc.testBusy'), 'no-discord': t('dc.st.noDiscord'), 'bad-id': t('dc.st.badId') };
        testOut.className = `dc-test ${r.ok ? 'ok' : 'fail'}`;
        testOut.textContent = r.ok ? t('dc.testOk', { user: r.user || '?' }) : fail[r.kind] ?? t('dc.st.error', { msg: r.message || r.kind });
        paint();
      } catch (e) {
        testOut.className = 'dc-test fail';
        testOut.textContent = e.message;
      } finally {
        testBtn.disabled = false;
      }
    });

    // Name der Aktivitaet in Discord ("Schaut <Name>"): frei waehlbar, leer = "Jellycloud Player"; der Knopf setzt den Namen des Servers ein
    const nameInput = h('input', { class: 'field dc-name-input', type: 'text', maxlength: 128, placeholder: t('dc.namePh'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('dc.name') });
    nameInput.value = dc().name ?? '';
    nameInput.addEventListener('input', () => setDiscord({ name: nameInput.value }));
    const serverName = (activeServer()?.name ?? '').trim();
    const nameServer = h('button', { class: 'btn glass sm', type: 'button', disabled: !serverName }, h('span', null, t('dc.nameServer')));
    nameServer.addEventListener('click', () => {
      nameInput.value = serverName;
      setDiscord({ name: serverName });
    });
    const nameBox = h('div', { class: 'dc-name' }, nameInput, nameServer);

    const posterOptions = ['auto', 'tmdb', 'server', 'off'].map((v) => ({ value: v, label: t(`dc.poster.${v}`) }));
    const idRow = setting(builtIn ? t('dc.clientIdOptional') : t('dc.clientId'), builtIn ? t('dc.clientIdOptionalDesc') : t('dc.clientIdDesc'), idInput);
    const steps = h('ol', { class: 'dc-steps' }, [1, 2, 3, 4].map((n) => h('li', null, t(`dc.help${n}`))));
    return h(
      'div',
      { class: 'settings-stack' },
      h('p', { class: 'setting-desc dc-intro' }, t('dc.intro')),
      group(
        t('dc.grpMain'),
        setting(t('dc.enable'), t('dc.enableDesc'), toggle(!!dc().enabled, (v) => setDiscord({ enabled: v }), t('dc.enable'))),
        ...(builtIn ? [] : [idRow]),
        h('div', { class: 'btn-row' }, ...(builtIn ? [] : [portal]), testBtn),
        testOut,
        status
      ),
      group(
        t('dc.grpShow'),
        setting(t('dc.name'), t('dc.nameDesc'), nameBox),
        setting(t('dc.poster'), t('dc.posterDesc'), menuSelect(posterOptions, dc().poster ?? 'auto', (v) => setDiscord({ poster: v }))),
        setting(t('dc.hideTitle'), t('dc.hideTitleDesc'), toggle(!!dc().hideTitle, (v) => setDiscord({ hideTitle: v }), t('dc.hideTitle'))),
        setting(t('dc.button'), t('dc.buttonDesc'), toggle(!!dc().button, (v) => setDiscord({ button: v }), t('dc.button')))
      ),
      // Mit eingebauter Anwendung ist die eigene nur ein Zusatz; ohne sie ist die Anleitung die Einrichtung
      builtIn ? group(t('dc.grpOwn'), idRow, h('div', { class: 'btn-row' }, portal), steps) : group(t('dc.grpHelp'), steps)
    );
  }

  // ---------- Updates (unter Info) ----------
  function updatesBlock() {
    const text = h('div', { class: 'setting-desc upd-text', role: 'status', 'aria-live': 'polite' });
    const bar = h('div', { class: 'upd-bar', role: 'progressbar', 'aria-label': t('upd.title'), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i'));
    const notesText = h('div', { class: 'upd-notes-text' });
    const notes = h('div', { class: 'upd-notes' }, h('div', { class: 'setting-label' }, t('upd.notes')), notesText);
    const buttons = h('div', { class: 'upd-buttons' });
    let buttonKey = '';

    const pct = (u) => (u.size ? Math.min(100, Math.floor(((u.received ?? 0) / u.size) * 100)) : 0);
    const describeUpdate = (u) => {
      switch (u.status) {
        case 'checking':
          return t('upd.checking');
        case 'none':
          return t('upd.none', { time: new Date(u.checkedAt).toLocaleString(getLocale()) });
        case 'available':
          return t('upd.available', { v: u.version, size: fmtSize(u.size) });
        case 'downloading':
          return t('upd.downloading', { v: u.version, pct: pct(u) });
        case 'ready':
          return t('upd.ready', { v: u.version }) + (u.supported ? '' : ` ${t('upd.devOnly')}`);
        case 'installing':
          return t('upd.installing');
        case 'error':
          return u.error;
        default:
          return t('upd.idle');
      }
    };

    // Jede Aktion setzt den vom Hauptprozess gemeldeten Stand; Fehler (zum Beispiel "erst nach der Wiedergabe") erscheinen als Hinweis
    const act = (fn) => async () => {
      try {
        const next = await fn();
        if (next && typeof next === 'object') {
          state.update = next;
          paint();
        }
      } catch (e) {
        toast(e.message, { type: 'error' });
      }
    };
    const mk = (label, ic, fn, { primary = false, disabled = false } = {}) => {
      const b = h('button', { class: `btn ${primary ? 'primary' : 'glass'} sm`, type: 'button', disabled }, icon(ic, 16), h('span', null, label));
      b.addEventListener('click', act(fn));
      return b;
    };
    const check = (disabled = false) => mk(t('upd.check'), 'refresh', () => window.jc.checkUpdate(), { disabled });
    const buttonsFor = (u) => {
      switch (u.status) {
        case 'checking':
          return [check(true)];
        case 'available':
          return [mk(t('upd.download'), 'download', () => window.jc.downloadUpdate(), { primary: true }), check()];
        case 'downloading':
          return [mk(t('upd.cancel'), 'x', () => window.jc.cancelUpdate())];
        case 'ready':
          return [mk(t('upd.install'), 'power', () => window.jc.installUpdate(), { primary: true, disabled: !u.supported })];
        case 'installing':
          return [];
        case 'error':
          return [u.version ? mk(t('upd.retry'), 'download', () => window.jc.downloadUpdate(), { primary: true }) : check(), ...(u.version ? [check()] : [])];
        default:
          return [check()];
      }
    };

    function paint() {
      const u = state.update ?? { status: 'idle', supported: false };
      text.textContent = describeUpdate(u);
      text.classList.toggle('bad', u.status === 'error');
      bar.hidden = u.status !== 'downloading';
      if (u.status === 'downloading') {
        bar.firstChild.style.width = `${pct(u)}%`;
        bar.setAttribute('aria-valuenow', String(pct(u)));
      }
      const showNotes = !!u.notes && !!u.version && ['available', 'downloading', 'ready', 'error'].includes(u.status);
      notes.hidden = !showNotes;
      notesText.textContent = showNotes ? u.notes : '';
      // Knoepfe nur neu bauen, wenn sich der Zustand aendert (waehrend des Ladens kommen viele Fortschrittsmeldungen, der Fokus soll bleiben)
      const key = `${u.status}|${u.version ?? ''}|${u.supported ? 1 : 0}`;
      if (key !== buttonKey) {
        buttonKey = key;
        buttons.replaceChildren(...buttonsFor(u));
      }
    }
    paint();
    document.addEventListener('update-state', paint);
    cleanups.push(() => document.removeEventListener('update-state', paint));
    return h('div', { class: 'upd' }, text, bar, notes, buttons);
  }

  // ---------- Info ----------
  function aboutPanel() {
    const keys = [
      ['Space / K', t('key.pause')],
      ['← / →', t('key.seek')],
      ['J / L', t('key.seek10')],
      ['↑ / ↓', t('key.volume')],
      ['M', t('key.mute')],
      ['F / F11', t('key.fullscreen')],
      ['A / S', t('key.tracks')],
      ['I', t('key.info')],
      ['N', t('key.next')],
      ['[ / ]', t('key.speed')],
      ['0 – 9', t('key.jump')],
      ['Esc', t('key.back')]
    ];
    return h(
      'div',
      { class: 'settings-stack' },
      h(
        'div',
        { class: 'settings-group' },
        h('div', { class: 'about-card' }, h('div', { class: 'brand-mark lg' }, icon('cloud-logo', 64)), h('div', null, h('h2', null, 'Jellycloud Player'), h('p', { class: 'setting-desc' }, `${t('set.version')} ${state.appVersion}`), h('p', { class: 'setting-desc' }, t(state.platform === 'desktop' ? 'set.aboutText' : 'set.aboutTextMobile')), state.platform === 'desktop' ? h('p', { class: 'setting-desc' }, t('set.licensesText'), ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => window.jc.openNotices().catch((e) => toast(e.message, { type: 'error' })) }, t('set.licenses'))) : [h('p', { class: 'setting-desc' }, t('set.licensesTextMobile')), h('p', { class: 'setting-desc' }, diagLine())])),
        state.platform === 'desktop' ? [h('h3', { class: 'group-title' }, t('upd.title')), updatesBlock()] : null,
        ['ios', 'android'].includes(state.platform) ? null : [h('h3', { class: 'group-title' }, t('set.shortcuts')), h('dl', { class: 'keys' }, keys.flatMap(([k, d]) => [h('dt', null, h('kbd', null, k)), h('dd', null, d)]))] // Tastenkuerzel: auf dem Handy ohne Tastatur sinnlos
      )
    );
  }

  const panels = { appearance: appearancePanel, home: homePanel, video: videoPanel, audio: audioPanel, subtitles: subtitlesPanel, behavior: behaviorPanel, network: networkPanel, general: generalPanel, seerr: seerrPanel, discord: discordPanel, account: accountPanel, about: aboutPanel };
  const sections = SECTIONS.filter(([id]) => state.platform === 'desktop' || !DESKTOP_ONLY.has(id));
  const known = (id) => !!panels[id] && sections.some(([sid]) => sid === id);
  const active = known(section) ? section : 'appearance';
  if (document.documentElement.dataset.compact === 'on') {
    // Handy: ohne Bereich in der Adresse eine Liste der Bereiche nach Themen, sonst der eine Bereich mit "Zurueck" (keine Chip-Zeile oben, siehe sectionList)
    if (known(section)) {
      el.replaceChildren(h('a', { class: 'settings-back', href: '#/settings' }, icon('chevron-left', 20), h('span', null, t('nav.settings'))), h('h1', { class: 'page-title' }, t(`set.sec.${section}`)), h('div', { class: 'settings-layout' }, panel));
      panel.append(panels[section]());
    } else {
      el.replaceChildren(h('h1', { class: 'page-title' }, t('nav.settings')), sectionList(sections));
    }
  } else {
    sections.forEach(([id, ic]) => {
      nav.append(h('a', { class: `snav${id === active ? ' on' : ''}`, href: `#/settings/${id}` }, icon(ic, 18), h('span', null, t(`set.sec.${id}`))));
    });
    panel.append(panels[active]());
  }

  return {
    el,
    destroy() {
      for (const fn of cleanups) fn();
    }
  };
}
