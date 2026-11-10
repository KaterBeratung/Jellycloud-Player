import { h, icon } from '../renderer/js/dom.js';
import { installNoDrag } from '../renderer/js/no-drag.js';
import { formatSpan, formatClock, endsAt, chapterAt, isGenericChapter } from './pause.js';

installNoDrag();

// ---------- Texte ----------
const TEXT = {
  de: {
    minimize: 'Minimieren', maximize: 'Maximieren', closeWindow: 'Fenster schließen',
    back: 'Zurück', pause: 'Pause', play: 'Abspielen', rew: '10 Sekunden zurück', fwd: '10 Sekunden vor', volume: 'Lautstärke', mute: 'Stumm',
    tracks: 'Audio & Untertitel', audio: 'Audio', subs: 'Untertitel', off: 'Aus', speed: 'Geschwindigkeit', aspect: 'Bildformat', chapters: 'Kapitel',
    info: 'Technik-Info', fullscreen: 'Vollbild', next: 'Nächste Folge', now: 'Jetzt', nextIn: 'Als Nächstes', skipIntro: 'Intro überspringen',
    skipRecap: 'Rückblick überspringen', skipOutro: 'Abspann überspringen', skipPreview: 'Vorschau überspringen', close: 'Schließen', loading: 'Wird geladen…',
    buffering: 'Puffert…', error: 'Wiedergabefehler', forced: 'Erzwungen', external: 'Extern', delay: 'Verzögerung', size: 'Größe', auto: 'Automatisch',
    fill: 'Füllen', stretch: 'Strecken', directPlay: 'Direct Play', directStream: 'Direct Stream', transcode: 'Transcode', method: 'Methode', container: 'Container',
    video: 'Video', audioSec: 'Audio', output: 'Ausgabe', codec: 'Codec', resolution: 'Auflösung', fps: 'Bilder/s', hdr: 'Dynamikbereich', depth: 'Farbtiefe',
    channels: 'Kanäle', hwdec: 'Hardware-Dekodierung', renderer: 'Renderer', dropped: 'Verworfene Bilder', bitrate: 'Bitrate', cache: 'Puffer', mpv: 'mpv',
    volumeNow: 'Lautstärke {v} %', muted: 'Stumm', unmuted: 'Ton an', speedNow: 'Geschwindigkeit {v}×', chapter: 'Kapitel {n}', noTracks: 'Keine Spuren', remaining: 'Verbleibend', elapsed: 'Laufzeit',
    device: 'Gerät', noAudioOut: 'keine Tonausgabe', bitstream: 'Bitstream', audioFallback: 'Ton-Ausgabe zurückgesetzt auf Stereo', transcodeFallback: 'Direkt nicht abspielbar, der Server transcodiert',
    loadingTranscode: 'Transcodierung wird vorbereitet…', quality: 'Qualität', original: 'Original', mbit: '{n} Mbit/s', qualityHint: 'Weniger Bitrate: der Server transcodiert',
    serverLimit: 'Server-Limit (Internet)', serverLimitNote: 'Server-Limit (Internet): {n} Mbit/s. „Original“ ist darüber nicht möglich.',
    moreLangs: 'Weitere Sprachen ({n})', lessLangs: 'Weniger Sprachen', unknownLang: 'Unbekannte Sprache',
    pauseTag: 'Pausiert', pauseResume: 'Weiter', pauseKey: 'Leertaste', pauseEnds: 'Endet um {t}', pauseLeft: 'noch {d}', pauseOf: '{a} von {b}', season: 'Staffel {n}', episodeN: 'Folge {n}',
    episodes: 'Folgen', specials: 'Specials', playingNow: 'Läuft'
  },
  en: {
    minimize: 'Minimize', maximize: 'Maximize', closeWindow: 'Close window',
    back: 'Back', pause: 'Pause', play: 'Play', rew: 'Back 10 seconds', fwd: 'Forward 10 seconds', volume: 'Volume', mute: 'Mute',
    tracks: 'Audio & Subtitles', audio: 'Audio', subs: 'Subtitles', off: 'Off', speed: 'Speed', aspect: 'Aspect ratio', chapters: 'Chapters',
    info: 'Technical info', fullscreen: 'Fullscreen', next: 'Next episode', now: 'Now', nextIn: 'Up next', skipIntro: 'Skip intro',
    skipRecap: 'Skip recap', skipOutro: 'Skip credits', skipPreview: 'Skip preview', close: 'Close', loading: 'Loading…',
    buffering: 'Buffering…', error: 'Playback error', forced: 'Forced', external: 'External', delay: 'Delay', size: 'Size', auto: 'Auto',
    fill: 'Fill', stretch: 'Stretch', directPlay: 'Direct Play', directStream: 'Direct Stream', transcode: 'Transcode', method: 'Method', container: 'Container',
    video: 'Video', audioSec: 'Audio', output: 'Output', codec: 'Codec', resolution: 'Resolution', fps: 'Frames/s', hdr: 'Dynamic range', depth: 'Bit depth',
    channels: 'Channels', hwdec: 'Hardware decoding', renderer: 'Renderer', dropped: 'Dropped frames', bitrate: 'Bitrate', cache: 'Buffer', mpv: 'mpv',
    volumeNow: 'Volume {v}%', muted: 'Muted', unmuted: 'Sound on', speedNow: 'Speed {v}×', chapter: 'Chapter {n}', noTracks: 'No tracks', remaining: 'Remaining', elapsed: 'Elapsed',
    device: 'Device', noAudioOut: 'no audio output', bitstream: 'Bitstream', audioFallback: 'Audio output reset to stereo', transcodeFallback: 'Cannot play directly, the server is transcoding',
    loadingTranscode: 'Preparing transcode…', quality: 'Quality', original: 'Original', mbit: '{n} Mbit/s', qualityHint: 'Lower bitrate: the server transcodes',
    serverLimit: 'Server limit (internet)', serverLimitNote: 'Server limit (internet): {n} Mbit/s. "Original" is not possible above it.',
    moreLangs: 'More languages ({n})', lessLangs: 'Fewer languages', unknownLang: 'Unknown language',
    pauseTag: 'Paused', pauseResume: 'Resume', pauseKey: 'Space', pauseEnds: 'Ends at {t}', pauseLeft: '{d} left', pauseOf: '{a} of {b}', season: 'Season {n}', episodeN: 'Episode {n}',
    episodes: 'Episodes', specials: 'Specials', playingNow: 'Playing'
  }
};
let lang = 'de';
const tr = (k, vars) => {
  let s = TEXT[lang][k] ?? TEXT.en[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
  return s;
};

// ---------- Zustand ----------
const S = { phase: 'loading', position: 0, duration: 0, paused: false, buffering: false, volume: 100, mute: false, speed: 1, tracks: { audio: [], sub: [] }, chapters: [], jfChapters: [], segments: [], next: null, media: null, stats: {}, aspect: 'auto' };
let shown = { position: 0, at: performance.now() };
let uiVisible = true;
let hideTimer = null;
let hoverBar = false;
let dragging = false;
let infoOpen = false;
let popup = null;
let remainingMode = false;
let lastSentUi = null;

const send = (cmd) => window.player.send(cmd);

// ---------- Aufbau ----------
const root = document.getElementById('ui');
root.classList.add('ui-on');

// Schliessen: sofort sichtbar reagieren (Steuerung weg, Ladekreis), nur einmal senden. Der Hauptprozess wartet nicht auf den Server.
let closing = false;
function requestClose() {
  if (closing) return;
  closing = true;
  closePopup();
  root.classList.add('closing', 'busy');
  send({ type: 'close' });
  // Sicherung: kommt wider Erwarten keine Antwort, ist die Bedienung nicht fuer immer gesperrt.
  setTimeout(() => {
    closing = false;
    root.classList.remove('closing');
    paintPlayState();
  }, 6000);
}
/** "Zurueck": zuerst offene Panels schliessen, dann den Player. */
function goBack() {
  if (popup) return closePopup();
  if (infoOpen) return toggleInfo(false);
  requestClose();
}

const backBtn = h('button', { class: 'round', type: 'button', 'aria-label': tr('back'), onclick: requestClose }, icon('back', 22));
const t1 = h('div', { class: 't1' });
const t2 = h('div', { class: 't2' }, h('span', { class: 'txt' }), h('span', { class: 'badges' }));
const winBtn = (name, label, action, cls = '') => h('button', { class: `wbtn ${cls}`.trim(), type: 'button', title: label, 'aria-label': label, onclick: () => send({ type: 'window', action }) }, icon(name, 18));
const winctl = h('div', { class: 'winctl' }, winBtn('win-min', tr('minimize'), 'minimize'), winBtn('win-max', tr('maximize'), 'maximize'), winBtn('x', tr('closeWindow'), 'close', 'close'));
const top = h('div', { class: 'top' }, backBtn, h('div', { class: 'titles' }, t1, t2), winctl);

// Fenster per Ziehen am Titelbereich verschieben, Doppelklick maximiert (das Overlay liegt ueber der System-Titelleiste).
let dragFrom = null;
top.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button') || S.fullscreen) return;
  dragFrom = { x: e.screenX, y: e.screenY };
  top.setPointerCapture(e.pointerId);
  send({ type: 'window', action: 'drag-start' });
});
top.addEventListener('pointermove', (e) => {
  if (dragFrom) send({ type: 'window', action: 'drag-move', dx: e.screenX - dragFrom.x, dy: e.screenY - dragFrom.y });
});
const endWindowDrag = () => {
  dragFrom = null;
};
top.addEventListener('pointerup', endWindowDrag);
top.addEventListener('pointercancel', endWindowDrag);
top.addEventListener('dblclick', (e) => {
  if (!e.target.closest('button') && !S.fullscreen) send({ type: 'window', action: 'maximize' });
});

const spinner = h('div', { class: 'spinner' });
const pulse = h('div', { class: 'pulse' });
const status = h('div', { class: 'status' });
const flash = h('div', { class: 'flash' });
const center = h('div', { class: 'center' }, spinner, pulse, status);

// Countdown (wie bei Netflix): hinter dem Text fuellt sich der Knopf von links nach rechts (`.cd > i`); ist er voll, geht es von selbst weiter. Ablauf: siehe "Countdown" weiter unten.
const cdFill = () => h('span', { class: 'cd', 'aria-hidden': 'true' }, h('i'));
const skipBtn = h('button', { class: 'skip', type: 'button', hidden: true, onclick: () => (cdMark(cdSkip), send({ type: 'skip' })) }, cdFill(), icon('skip-next', 18), h('span'));
const nextGo = h('button', { class: 'go', type: 'button', onclick: () => (cdMark(cdNext), send({ type: 'next' })) }, cdFill(), icon('skip-next', 16), h('span', null, tr('now')));
const nextCard = h('div', { class: 'nextcard', hidden: true }, h('div', { class: 'txt' }, h('div', { class: 'k' }, tr('nextIn')), h('div', { class: 'n' })), nextGo);
const floaters = h('div', { class: 'floaters' }, nextCard, skipBtn);

const tCur = h('div', { class: 'time' }, '0:00');
const tEnd = h('div', { class: 'time right', title: tr('remaining'), onclick: () => { remainingMode = !remainingMode; paintTimes(); } }, '0:00');
const bufEl = h('i', { class: 'buf' });
const playedEl = h('i', { class: 'played' });
const knob = h('div', { class: 'knob' });
const track = h('div', { class: 'track' }, bufEl, playedEl);
const pvImg = h('div', { class: 'pv-img' });
const pvTime = h('div', { class: 'pv-time' }, '0:00');
const pvChap = h('div', { class: 'pv-chap' });
const preview = h('div', { class: 'preview' }, pvImg, pvChap, pvTime);
const seek = h('div', { class: 'seek', tabindex: '0', role: 'slider', 'aria-label': 'Position' }, track, knob, preview);

const mkBtn = (name, label, onclick, extra = '') => h('button', { class: `ibtn ${extra}`.trim(), type: 'button', title: label, 'aria-label': label, onclick }, icon(name, 24));
const playBtn = mkBtn('pause', tr('pause'), () => send({ type: 'pause' }), 'big');
// Sprungweiten kommen aus den Einstellungen (Standard 5 s / 10 s)
const pb = () => ({ seekSmall: 5, seekBig: 10, wheelAction: 'volume', ...(S.ui?.playback ?? {}) });
const rewBtn = mkBtn('back10', tr('rew'), () => send({ type: 'seek', by: -pb().seekBig }));
const fwdBtn = mkBtn('fwd10', tr('fwd'), () => send({ type: 'seek', by: pb().seekBig }));
/** Zeigt die eingestellte Sprungweite in den Icons und Tooltips. */
function paintSeekButtons() {
  const n = pb().seekBig;
  for (const [btn, name, key] of [[rewBtn, 'back10', 'rew'], [fwdBtn, 'fwd10', 'fwd']]) {
    const ic = icon(name, 24);
    ic.innerHTML = ic.innerHTML.replace('>10<', `>${n}<`);
    btn.replaceChildren(ic);
    btn.title = tr(key).replace('10', String(n));
    btn.setAttribute('aria-label', btn.title);
  }
}
const nextBtn = mkBtn('skip-next', tr('next'), () => send({ type: 'next' }));
nextBtn.hidden = true;
const volBtn = mkBtn('volume', tr('mute'), () => send({ type: 'mute' }));
const volInput = h('input', { type: 'range', min: 0, max: 130, step: 1, value: 100, 'aria-label': tr('volume') });
volInput.addEventListener('input', () => {
  volInput.style.setProperty('--fill', `${(volInput.value / 130) * 100}%`);
  send({ type: 'volume', value: +volInput.value });
});
const vol = h('div', { class: 'vol' }, volBtn, h('div', { class: 'vol-slider' }, volInput));
const tracksBtn = mkBtn('subtitles', tr('tracks'), (e) => togglePopup('tracks', e.currentTarget));
const chapBtn = mkBtn('list', tr('chapters'), (e) => togglePopup('chapters', e.currentTarget));
// Folgen und Staffeln der laufenden Serie (wie bei Netflix): nur bei Serien mit mehr als einer Folge
const epsBtn = mkBtn('layers', tr('episodes'), (e) => togglePopup('episodes', e.currentTarget));
epsBtn.hidden = true;
const speedBtn = h('button', { class: 'chip', type: 'button', title: tr('speed'), onclick: (e) => togglePopup('speed', e.currentTarget) }, '1×');
const aspectBtn = mkBtn('aspect', tr('aspect'), (e) => togglePopup('aspect', e.currentTarget));
// Qualitaet: nur sichtbar, wenn Transcoding erlaubt ist (sonst gibt es nichts zu waehlen)
const qualityBtn = mkBtn('settings', tr('quality'), (e) => togglePopup('quality', e.currentTarget));
qualityBtn.hidden = true;
const infoBtn = mkBtn('info', tr('info'), () => toggleInfo());
const fsBtn = mkBtn('fullscreen', tr('fullscreen'), () => send({ type: 'fullscreen' }));
// Zwei Glas-Kapseln statt loser Knoepfe (wie die Steuerelement-Gruppen in iOS 26)
const ctrls = h('div', { class: 'ctrls' }, h('div', { class: 'cluster' }, playBtn, rewBtn, fwdBtn, nextBtn, vol), h('div', { class: 'sp' }), h('div', { class: 'cluster' }, tracksBtn, epsBtn, chapBtn, speedBtn, aspectBtn, qualityBtn, infoBtn, fsBtn));
const bar = h('div', { class: 'bar' }, h('div', { class: 'seekrow' }, tCur, seek, tEnd), ctrls);

const infoPanel = h('aside', { class: 'info', hidden: true });
const errCard = h('div', { class: 'errcard', hidden: true });

// Pausenbildschirm (Logo, Beschreibung, "Endet um ..."): liegt ganz unten, die Bedienung kommt bei jeder Regung wieder darueber
const pauseCard = h('div', { class: 'pause-card' });
const pauseLayer = h('section', { class: 'pause', hidden: true, 'aria-hidden': 'true', 'aria-label': 'Pause' }, pauseCard);

root.append(pauseLayer, top, center, flash, floaters, infoPanel, bar, errCard);

// ---------- Hilfsfunktionen ----------
const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
const langName = (c) => {
  if (!c || c === 'und') return '';
  try {
    return new Intl.DisplayNames([lang], { type: 'language' }).of(c) ?? c;
  } catch {
    return c;
  }
};
const chaptersList = () => (S.chapters?.length ? S.chapters : S.jfChapters ?? []);

function showFlash(text, ms = 1300) {
  flash.textContent = text;
  flash.classList.add('show');
  clearTimeout(showFlash.t);
  showFlash.t = setTimeout(() => flash.classList.remove('show'), ms);
}
function doPulse(name) {
  pulse.replaceChildren(icon(name, 38));
  pulse.classList.remove('go');
  void pulse.offsetWidth;
  pulse.classList.add('go');
}

// ---------- UI-Sichtbarkeit ----------
function setUi(on) {
  if (uiVisible === on) return;
  uiVisible = on;
  root.classList.toggle('ui-on', on);
  document.body.classList.toggle('idle', !on);
  if (on) {
    // Waehrend die Leiste ausgeblendet war, wurde sie nicht mitgezeichnet: jetzt aufholen
    paintBar();
    paintTimes();
  }
  // Untertitel ueber die Leiste schieben, solange sie sichtbar ist
  if (lastSentUi !== on) {
    lastSentUi = on;
    send({ type: 'ui', visible: on });
  }
}
function wake() {
  setUi(true);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(maybeHide, 3200);
}
function maybeHide() {
  if (S.paused || popup || hoverBar || dragging || S.phase !== 'playing') {
    hideTimer = setTimeout(maybeHide, 1200);
    return;
  }
  setUi(false);
}
bar.addEventListener('pointerenter', () => (hoverBar = true));
bar.addEventListener('pointerleave', () => (hoverBar = false));
top.addEventListener('pointerenter', () => (hoverBar = true));
top.addEventListener('pointerleave', () => (hoverBar = false));
window.addEventListener('pointermove', wake);
window.addEventListener('pointerdown', wake);

// ---------- Pausenbildschirm ----------
// Dauert die Pause einige Sekunden ohne Bedienung, blendet er Logo (sonst den Titel), Folge, Angaben, Beschreibung und "Endet um ..." ein und die Leiste aus.
// Jede Regung (Maus, Taste, Rad) blendet ihn wieder aus und holt die Bedienung zurueck; nach derselben Wartezeit ohne Regung kommt er erneut.
// Gesteuert wird zustandsbasiert (alle 400 ms), nicht ueber einzelne Ereignisse: so greifen auch Menues, Info, Puffern und Schliessen ohne Sonderfaelle.
let lastActivity = performance.now();
let pauseShown = false;
let pauseTick = null;
let pauseTimes = null; // Elemente, die sich waehrend der Pause aendern (Fortschritt, Uhrzeit des Endes)

const pauseCfg = () => ({ on: S.ui?.pauseScreen?.on !== false, sec: Math.min(120, Math.max(2, Number(S.ui?.pauseScreen?.sec) || 6)) });
const pauseEligible = () => !!S.paused && S.phase === 'playing' && !S.buffering && !closing && !popup && !infoOpen && !dragging && !!S.pauseInfo && pauseCfg().on;

function paintPauseTimes() {
  if (!pauseTimes) return;
  const d = S.duration || 0;
  const { at, left } = endsAt(Date.now(), d, shown.position, S.speed);
  pauseTimes.fill.style.width = `${d ? Math.min(100, (shown.position / d) * 100) : 0}%`;
  pauseTimes.pos.textContent = d ? tr('pauseOf', { a: clock(shown.position), b: clock(d) }) : clock(shown.position);
  pauseTimes.end.replaceChildren(...(d ? [h('b', null, tr('pauseEnds', { t: formatClock(at, lang) })), h('span', null, tr('pauseLeft', { d: formatSpan(left, lang) }))] : []));
}

function paintPause() {
  const p = S.pauseInfo;
  if (!p) return;
  const kids = [h('div', { class: 'pause-tag' }, icon('pause', 13), h('span', null, tr('pauseTag')))];
  // Logo; fehlt es oder laesst es sich nicht laden, steht der Titel als Text da
  const heading = h('h2', { class: 'pause-title' }, p.title);
  if (p.logo) {
    const img = h('img', { class: 'pause-logo', alt: p.title, src: p.logo, decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(heading), { once: true });
    kids.push(img);
  } else {
    kids.push(heading);
  }
  if (p.isEpisode) {
    const label = [p.season != null ? tr('season', { n: p.season }) : '', p.episode != null ? tr('episodeN', { n: p.episode }) : ''].filter(Boolean).join(' · ');
    kids.push(h('div', { class: 'pause-ep' }, label ? h('span', { class: 'k' }, label) : null, p.episodeName ? h('span', { class: 'n' }, p.episodeName) : null));
  }
  const meta = [];
  if (p.year) meta.push(h('span', null, String(p.year)));
  if (p.rating) meta.push(h('span', { class: 'pause-rating' }, p.rating));
  if (p.score) meta.push(h('span', { class: 'pause-score' }, icon('star', 13), String(p.score)));
  if (S.duration) meta.push(h('span', null, formatSpan(S.duration, lang)));
  for (const b of S.media?.badges ?? []) meta.push(h('span', { class: `badge ${b.kind}` }, b.text));
  if (meta.length) kids.push(h('div', { class: 'pause-meta' }, ...meta));
  const story = p.overview || p.tagline;
  if (story) kids.push(h('p', { class: 'pause-ov' }, story));
  if (p.genres?.length) kids.push(h('div', { class: 'pause-genres' }, p.genres.join(' · ')));
  const ch = chapterAt(chaptersList(), shown.position);
  const fill = h('i');
  const pos = h('span', { class: 'a' });
  const end = h('span', { class: 'b' });
  pauseTimes = { fill, pos, end };
  kids.push(
    h(
      'div',
      { class: 'pause-progress' },
      ch ? h('div', { class: 'pause-chapter' }, tr('chapter', { n: ch.n }) + (isGenericChapter(ch.title) ? '' : ` · ${ch.title}`)) : null,
      h('div', { class: 'pause-bar' }, fill),
      h('div', { class: 'pause-times' }, pos, end)
    )
  );
  kids.push(h('div', { class: 'pause-actions' }, h('button', { class: 'pause-go', type: 'button', onclick: () => send({ type: 'pause' }) }, icon('play', 18), h('span', null, tr('pauseResume'))), h('span', { class: 'pause-hint' }, h('kbd', null, tr('pauseKey')))));
  kids.forEach((k, i) => k.style.setProperty('--i', String(i))); // gestaffeltes Einblenden
  pauseCard.replaceChildren(...kids);
  paintPauseTimes();
}

function showPause() {
  paintPause();
  pauseShown = true;
  clearTimeout(hidePause.t);
  pauseLayer.hidden = false;
  pauseLayer.setAttribute('aria-hidden', 'false');
  root.classList.add('pause-on');
  setUi(false);
  requestAnimationFrame(() => requestAnimationFrame(() => pauseShown && pauseLayer.classList.add('in')));
  clearInterval(pauseTick);
  pauseTick = setInterval(paintPauseTimes, 15000); // "Endet um" wandert mit, solange man pausiert
}

function hidePause() {
  if (!pauseShown) return;
  pauseShown = false;
  clearInterval(pauseTick);
  root.classList.remove('pause-on');
  pauseLayer.classList.remove('in');
  pauseLayer.setAttribute('aria-hidden', 'true');
  hidePause.t = setTimeout(() => {
    if (!pauseShown) pauseLayer.hidden = true;
  }, 700);
}

function pauseActivity(e) {
  // Ein Mausereignis ohne Bewegung (Fenster verschoben, Zeiger steht still) zaehlt nicht
  if (e.type === 'pointermove' && !e.movementX && !e.movementY) return;
  lastActivity = performance.now();
  if (pauseShown) {
    hidePause();
    wake();
  }
}
for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(type, pauseActivity, { capture: true, passive: true });

setInterval(() => {
  if (pauseShown) {
    if (!pauseEligible()) hidePause();
  } else if (pauseEligible() && performance.now() - lastActivity >= pauseCfg().sec * 1000) {
    showPause();
  }
}, 400);

// ---------- Rendering ----------
function paintTimes() {
  const pos = shown.position;
  tCur.textContent = clock(pos);
  tEnd.textContent = S.duration ? (remainingMode ? `−${clock(S.duration - pos)}` : clock(S.duration)) : '--:--';
}

function paintBar() {
  const d = S.duration || 0;
  const frac = d ? Math.min(1, shown.position / d) : 0;
  // Nur schreiben, was sich sichtbar aendert (bei Pause und im Stillstand kostet das Bild sonst jedes Mal Neuzeichnen)
  const px = Math.round(frac * 4000);
  if (paintBar.px === px && !dragging) return;
  paintBar.px = px;
  playedEl.style.transform = `scaleX(${frac})`;
  if (!dragging) knob.style.left = `${frac * 100}%`;
}

function paintSegments() {
  track.querySelectorAll('.seg, .tick').forEach((n) => n.remove());
  const d = S.duration;
  if (!d) return;
  for (const s of S.segments ?? []) track.append(h('i', { class: 'seg', style: { left: `${(s.start / d) * 100}%`, width: `${((s.end - s.start) / d) * 100}%` } }));
  for (const c of chaptersList().slice(1)) track.append(h('i', { class: 'tick', style: { left: `${(c.time / d) * 100}%` } }));
}

function paintTitle() {
  t1.textContent = S.title ?? '';
  const txt = t2.querySelector('.txt');
  const b = t2.querySelector('.badges');
  txt.textContent = S.subtitle ?? '';
  b.replaceChildren();
  if (S.method) {
    const label = S.method === 'DirectPlay' ? tr('directPlay') : S.method === 'DirectStream' ? tr('directStream') : tr('transcode');
    b.append(h('span', { class: `badge ${S.method === 'Transcode' ? '' : 'play'}` }, label));
  }
  for (const x of S.media?.badges ?? []) b.append(h('span', { class: `badge ${x.kind}` }, x.text));
}

function paintPlayState() {
  const paused = !!S.paused;
  playBtn.replaceChildren(icon(paused ? 'play' : 'pause', 26));
  playBtn.title = paused ? tr('play') : tr('pause');
  root.classList.toggle('busy', closing || S.phase === 'loading' || !!S.buffering);
  status.textContent = closing ? '' : S.phase === 'loading' ? (S.method === 'Transcode' ? tr('loadingTranscode') : tr('loading')) : S.buffering ? tr('buffering') : '';
  if (paused && S.phase === 'playing') wake();
}

function paintVolume() {
  const v = S.mute ? 0 : S.volume ?? 100;
  volBtn.replaceChildren(icon(v === 0 ? 'volume-mute' : v < 50 ? 'volume-low' : 'volume', 24));
  if (document.activeElement !== volInput) volInput.value = S.volume ?? 100;
  volInput.style.setProperty('--fill', `${((S.volume ?? 100) / 130) * 100}%`);
}

function paintSkip() {
  const pos = shown.position;
  const seg = (S.segments ?? []).find((s) => pos >= s.start && pos < s.end - 1);
  const label = { Intro: 'skipIntro', Recap: 'skipRecap', Outro: 'skipOutro', Preview: 'skipPreview' };
  const showSkip = !!(seg && label[seg.type]);
  if (showSkip) {
    skipBtn.querySelector('span:last-child').textContent = tr(label[seg.type]);
    skipBtn.hidden = false;
  } else {
    skipBtn.hidden = true;
  }
  const d = S.duration;
  const nearEnd = d && S.next && d - pos < 30 && d - pos > 0;
  nextCard.hidden = !nearEnd;
  if (nearEnd) nextCard.querySelector('.n').textContent = `${S.next.label ?? ''} ${S.next.title ?? ''}`.trim();
  nextBtn.hidden = !S.next;
  // Countdown: je Segment (Art + Anfang) bzw. je naechster Folge einmal; die naechste Folge nur, wenn sie automatisch abgespielt wird
  cdSync(cdSkip, showSkip ? `${seg.type}:${seg.start}` : null);
  cdSync(cdNext, nearEnd && S.ui?.autoSkip?.next !== false ? `next:${S.next.id}` : null);
}

// ---------- Countdown an "Ueberspringen" und "Naechste Folge" (wie bei Netflix) ----------
// Sekunden kommen aus den Einstellungen (S.ui.autoSkip.sec, 0 = aus). Gezaehlt wird die Wanduhr, aber nur, solange die Wiedergabe wirklich laeuft (Pause, Laden und Puffern halten
// den Countdown an, ein Sprung ueber den Rahmen hinaus bricht ihn ab, weil der Knopf dann verschwindet). Bewusst kein CSS-Ablauf: bei "Animationen aus" liefe der sonst sofort durch.
// Ein Eintrag zaehlt nur ein einziges Mal (`cdDone`): wer nach dem Ueberspringen zurueckspult oder von Hand klickt, bekommt den Knopf ohne zweiten Countdown.
const cdSkip = { el: skipBtn, key: null, t: 0, send: () => send({ type: 'skip' }) };
const cdNext = { el: nextGo, key: null, t: 0, send: () => send({ type: 'next' }) };
const cdDone = new Set();
const cdSec = () => {
  const v = Number(S.ui?.autoSkip?.sec);
  return Number.isFinite(v) && v > 0 ? Math.min(30, v) : 0;
};
function cdPaint(cd, p) {
  const fill = cd.el.querySelector('.cd > i');
  if (fill) fill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
}
function cdSync(cd, key) {
  const want = key && cdSec() > 0 && !cdDone.has(key) ? key : null;
  if (cd.key === want) return;
  cd.key = want;
  cd.t = 0;
  cd.el.classList.toggle('counting', !!want);
  cdPaint(cd, 0);
}
/** Von Hand ausgeloest: dieser Eintrag bekommt keinen zweiten Countdown mehr. */
function cdMark(cd) {
  if (cd.key) cdDone.add(cd.key);
  cdSync(cd, null);
}
function cdReset() {
  cdDone.clear();
  cdSync(cdSkip, null);
  cdSync(cdNext, null);
}
function cdTick(dt) {
  if (S.phase !== 'playing' || S.paused || S.buffering || closing) return;
  const sec = cdSec();
  for (const cd of [cdSkip, cdNext]) {
    if (!cd.key || !sec) continue;
    cd.t += dt;
    cdPaint(cd, cd.t / sec);
    if (cd.t >= sec) {
      cdDone.add(cd.key);
      cdSync(cd, null);
      cd.send();
    }
  }
}

function paintError() {
  const err = S.phase === 'error';
  errCard.hidden = !err;
  if (err) {
    errCard.replaceChildren(h('h3', null, tr('error')), h('p', null, S.error ?? ''), h('button', { class: 'chip', type: 'button', onclick: requestClose }, tr('close')));
    setUi(true);
  }
}

function paintInfo() {
  root.classList.toggle('info-open', infoOpen);
  infoPanel.hidden = !infoOpen;
  if (!infoOpen) return;
  const m = S.media ?? {};
  const st = S.stats ?? {};
  const v = S.video ?? {};
  // Eintrag [Name, Wert, nebensaechlich?]: Nebenzeilen entfallen zuerst, wenn der Platz knapp wird.
  const section = (title, rows) =>
    h(
      'section',
      null,
      h('h4', null, title),
      h(
        'dl',
        null,
        rows
          .filter(([, val]) => val !== undefined && val !== null && val !== '')
          .flatMap(([k, val, minor]) => [h('dt', { class: minor ? 'minor' : '' }, k), h('dd', { class: minor ? 'minor' : '' }, String(val))])
      )
    );
  const methodLabel = S.method === 'DirectPlay' ? tr('directPlay') : S.method === 'DirectStream' ? tr('directStream') : S.method ? tr('transcode') : '';
  const kbps = (b) => (b ? `${(b / 1e6).toFixed(1)} Mbit/s` : '');
  const hw = st['hwdec-current'];
  // Was mpv tatsaechlich an die Tonausgabe gibt: macht sichtbar, ob Surround, Stereo oder Bitstream ankommt
  const ao = S.audioOut;
  const outText = !ao ? '' : !ao.active ? tr('noAudioOut') : [ao.spdif ? tr('bitstream') : ao.layout ?? (ao.channels ? `${ao.channels} ch` : ''), ao.rate ? `${+(ao.rate / 1000).toFixed(1)} kHz` : ''].filter(Boolean).join(' · ');
  infoPanel.replaceChildren(
    h(
      'div',
      { class: 'icol' },
      section(tr('method'), [[tr('method'), methodLabel], [tr('serverLimit'), S.serverLimit ? tr('mbit', { n: S.serverLimit.mbps }) : ''], [tr('container'), m.container ?? st['file-format'], true]]),
      section(tr('video'), [
        [tr('codec'), [m.videoCodec, st['video-codec']].find(Boolean)],
        [tr('resolution'), v.w ? `${v.w}×${v.h}` : m.width ? `${m.width}×${m.height}` : ''],
        [tr('hdr'), m.hdr ?? (v.hdr ? 'SDR' : '')],
        [tr('output'), v.hdr],
        [tr('fps'), st['container-fps'] ? Number(st['container-fps']).toFixed(3).replace(/\.?0+$/, '') : m.fps, true],
        [tr('depth'), m.bitDepth ? `${m.bitDepth} bit` : '', true],
        [tr('bitrate'), kbps(st['video-bitrate']), true]
      ])
    ),
    h(
      'div',
      { class: 'icol' },
      section(tr('audioSec'), [
        [tr('codec'), m.audio?.name ?? st['audio-codec-name']],
        [tr('channels'), m.audio?.channels, true],
        [tr('output'), outText],
        [tr('device'), S.audioCfg?.device, true],
        [tr('bitrate'), kbps(st['audio-bitrate']), true]
      ]),
      section(tr('mpv'), [
        [tr('renderer'), st['current-vo']],
        [tr('hwdec'), hw && hw !== 'no' ? hw : hw === 'no' ? 'software' : ''],
        [tr('dropped'), `${st['frame-drop-count'] ?? 0} / ${st['decoder-frame-drop-count'] ?? 0}`],
        [tr('cache'), st['demuxer-cache-time'] ? `${Math.max(0, st['demuxer-cache-time'] - shown.position).toFixed(0)} s` : '', true],
        ['mpv', S.mpv?.version, true]
      ])
    )
  );
  fit(infoPanel, ['compact', 'minimal']);
}

/**
 * Passt ein Element ohne Scrollen in seinen verfuegbaren Platz ein: nacheinander werden die genannten
 * Verdichtungsstufen (CSS-Klassen) zugeschaltet, bis nichts mehr ueberlaeuft. Scrollen bleibt der letzte Notanker.
 */
function fit(el, levels) {
  el.classList.remove(...levels);
  for (const level of levels) {
    if (el.scrollHeight <= el.clientHeight + 1) return;
    el.classList.add(level);
  }
}

/** Fasst direkte .opt-Kinder in einen Container, damit sie sich bei Bedarf auf zwei Spalten verteilen lassen. */
function groupOpts(container) {
  const opts = [...container.children].filter((n) => n.classList.contains('opt'));
  if (!opts.length) return;
  const wrap = h('div', { class: 'opts' });
  opts[0].before(wrap);
  wrap.append(...opts);
}

function toggleInfo(force) {
  infoOpen = force ?? !infoOpen;
  infoBtn.classList.toggle('on', infoOpen);
  // mpv liefert die Statistik-Werte (Bilder/s, Puffer ...) nur, solange die Info offen ist
  send({ type: 'stats', on: infoOpen });
  paintInfo();
}

// ---------- Popups ----------
function closePopup() {
  if (!popup) return;
  const { el, btn } = popup;
  popup = null;
  root.classList.remove('pop-open');
  btn?.classList.remove('on');
  el.classList.remove('open');
  setTimeout(() => el.remove(), 160);
  document.removeEventListener('pointerdown', onOutside, true);
}
function onOutside(e) {
  if (popup && !popup.el.contains(e.target) && !popup.btn?.contains(e.target)) closePopup();
}
function openPopup(kind, btn, el) {
  closePopup();
  root.append(el);
  for (const c of el.classList.contains('cols') ? el.querySelectorAll('.col') : [el]) groupOpts(c);
  if (kind !== 'episodes') fit(el, ['compact', 'dense', 'tight']); // die Folgenliste scrollt in sich, sie wird nicht verdichtet
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 16));
  el.style.left = `${left}px`;
  btn.classList.add('on');
  root.classList.add('pop-open');
  popup = { kind, el, btn };
  requestAnimationFrame(() => el.classList.add('open'));
  document.addEventListener('pointerdown', onOutside, true);
  if (kind === 'episodes') epsScrollToCurrent();
  wake();
}
function togglePopup(kind, btn) {
  if (popup?.kind === kind) return closePopup();
  const builders = { tracks: buildTracksPopup, chapters: buildChaptersPopup, speed: buildSpeedPopup, aspect: buildAspectPopup, quality: buildQualityPopup, episodes: buildEpisodesPopup };
  openPopup(kind, btn, builders[kind]());
}

const optRow = ({ label, sub, selected, right, onclick }) =>
  h('button', { class: `opt${selected ? ' sel' : ''}`, type: 'button', onclick }, h('span', { class: 'ck' }, selected ? icon('check', 16) : null), h('span', { class: 'tx' }, h('span', { class: 'lb' }, label), sub ? h('span', { class: 'sb' }, sub) : null), right ? h('span', { class: 'rt' }, right) : null);

function stepper(label, value, fmt, onMinus, onPlus) {
  const out = h('output', null, fmt(value));
  return h('div', { class: 'stepper' }, h('span', { class: 'lbl' }, label), h('div', { class: 'ctl' }, h('button', { type: 'button', onclick: () => out.textContent = fmt(onMinus()) }, '−'), out, h('button', { type: 'button', onclick: () => out.textContent = fmt(onPlus()) }, '+')));
}

const MANY_SUBS = 8; // ab mehr Untertitelspuren wird die Liste nach Sprache geordnet und gekuerzt

function buildTracksPopup() {
  const audio = S.tracks?.audio ?? [];
  const subs = S.tracks?.sub ?? [];
  const aCol = h('div', { class: 'col' }, h('h4', null, tr('audio')));
  if (!audio.length) aCol.append(h('div', { class: 'opt' }, h('span', { class: 'ck' }), h('span', { class: 'tx' }, h('span', { class: 'sb' }, tr('noTracks')))));
  for (const a of audio) {
    aCol.append(optRow({ label: a.label, sub: [a.codec?.toUpperCase(), a.channels ? `${a.channels}ch` : ''].filter(Boolean).join(' · '), selected: a.selected, onclick: () => { send({ type: 'audio', id: a.id }); closePopup(); showFlash(`${tr('audio')}: ${a.label}`); } }));
  }
  let ad = S.audioDelay ?? 0;
  aCol.append(stepper(tr('delay'), ad, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} s`, () => (send({ type: 'audio-delay', value: (ad = +(ad - 0.1).toFixed(1)) }), ad), () => (send({ type: 'audio-delay', value: (ad = +(ad + 0.1).toFixed(1)) }), ad)));
  // Kanalmodus waehrend der Wiedergabe: ist nichts zu hoeren (Surround auf Stereo-Anlage), reicht ein Klick auf "Stereo"
  const modes = ['auto', 'stereo', '5.1', '7.1'];
  let cm = S.audioCfg?.mode ?? 'auto';
  const pickMode = (step) => (cm = modes[(modes.indexOf(cm) + step + modes.length) % modes.length], send({ type: 'channels', value: cm }), cm);
  aCol.append(stepper(tr('channels'), cm, (v) => (v === 'auto' ? tr('auto') : v === 'stereo' ? 'Stereo' : v), () => pickMode(-1), () => pickMode(1)));

  const sCol = h('div', { class: 'col' }, h('h4', null, tr('subs')));
  sCol.append(optRow({ label: tr('off'), selected: !subs.some((s) => s.selected), onclick: () => { send({ type: 'sub', id: null }); closePopup(); showFlash(`${tr('subs')}: ${tr('off')}`); } }));
  const pickSub = (s, label) => () => { send({ type: 'sub', id: s.id }); closePopup(); showFlash(`${tr('subs')}: ${label}`); };
  if (subs.length <= MANY_SUBS || !window.JCMedia) {
    for (const s of subs) {
      sCol.append(optRow({ label: s.label, sub: [s.forced ? tr('forced') : '', s.external ? tr('external') : '', s.codec?.toUpperCase()].filter(Boolean).join(' · '), selected: s.selected, onclick: pickSub(s, s.label) }));
    }
  } else {
    // Viele Spuren: nach Sprache geordnet, nur die bevorzugten Sprachen (und die gewaehlte Spur) gleich zu sehen, der Rest hinter "Weitere Sprachen"
    const Media = window.JCMedia;
    const kindOf = (s) => Media.subtitleKind({ IsForced: s.forced, DisplayTitle: s.label });
    const kindText = { full: '', forced: tr('forced'), sdh: 'SDH' };
    const selAudio = (S.tracks?.audio ?? []).find((a) => a.selected);
    const wanted = [S.ui?.subtitleLanguage && S.ui.subtitleLanguage !== 'server' ? S.ui.subtitleLanguage : null, lang, selAudio?.lang, 'en'].filter(Boolean);
    const groups = Media.groupByLanguage(subs, { preferred: wanted, keep: [subs.find((s) => s.selected)], lang: (s) => s.lang, kind: kindOf });
    const rowsOf = (group) => {
      const name = group.code === 'und' ? tr('unknownLang') : langName(group.code) || group.code;
      const kinds = group.tracks.map(kindOf);
      const seen = {};
      return group.tracks.map((s, i) => {
        const kind = kinds[i];
        seen[kind] = (seen[kind] ?? 0) + 1;
        const label = [`${name}${kinds.filter((k) => k === kind).length > 1 ? ` ${seen[kind]}` : ''}`, kindText[kind]].filter(Boolean).join(' · ');
        return optRow({ label, sub: [s.external ? tr('external') : '', s.codec?.toUpperCase()].filter(Boolean).join(' · '), selected: s.selected, onclick: pickSub(s, label) });
      });
    };
    for (const g of groups.shown) sCol.append(...rowsOf(g));
    if (groups.more.length) {
      const rest = [...groups.more].sort((a, b) => (a.code === 'und') - (b.code === 'und') || langName(a.code).localeCompare(langName(b.code), lang)); // ohne Sprachangabe zuletzt
      const more = h('div', { class: 'opts more', hidden: !!groups.shown.length });
      more.append(...rest.flatMap(rowsOf));
      const label = h('span', { class: 'lb' }, tr('moreLangs', { n: groups.more.length }));
      const toggle = h('button', { class: 'opt more-toggle', type: 'button', 'aria-expanded': String(!more.hidden) }, h('span', { class: 'ck' }, icon('chevron-down', 16)), h('span', { class: 'tx' }, label));
      toggle.onclick = () => {
        more.hidden = !more.hidden;
        toggle.setAttribute('aria-expanded', String(!more.hidden));
        toggle.classList.toggle('open', !more.hidden);
        label.textContent = more.hidden ? tr('moreLangs', { n: groups.more.length }) : tr('lessLangs');
        if (!more.hidden) more.scrollIntoView({ block: 'nearest' });
      };
      if (groups.shown.length) sCol.append(toggle, more);
      else sCol.append(more); // keine bevorzugte Sprache vorhanden: gleich alles zeigen
    }
  }
  let sd = S.subDelay ?? 0;
  let sc = S.subScale ?? 1;
  sCol.append(
    stepper(tr('delay'), sd, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} s`, () => (send({ type: 'sub-delay', value: (sd = +(sd - 0.1).toFixed(1)) }), sd), () => (send({ type: 'sub-delay', value: (sd = +(sd + 0.1).toFixed(1)) }), sd)),
    stepper(tr('size'), sc, (v) => `${Math.round(v * 100)}%`, () => (send({ type: 'sub-scale', value: (sc = +Math.max(0.4, sc - 0.1).toFixed(2)) }), sc), () => (send({ type: 'sub-scale', value: (sc = +Math.min(3, sc + 0.1).toFixed(2)) }), sc))
  );
  return h('div', { class: 'pop cols' }, aCol, sCol);
}

function buildChaptersPopup() {
  const list = chaptersList();
  const el = h('div', { class: 'pop' }, h('h4', null, tr('chapters')));
  list.forEach((c, i) => {
    const next = list[i + 1];
    const active = shown.position >= c.time && (!next || shown.position < next.time);
    el.append(optRow({ label: c.title || tr('chapter', { n: i + 1 }), selected: active, right: clock(c.time), onclick: () => { send({ type: 'seek', to: c.time }); closePopup(); } }));
  });
  if (!list.length) el.append(h('div', { class: 'opt' }, h('span', { class: 'ck' }), h('span', { class: 'tx' }, h('span', { class: 'sb' }, tr('noTracks')))));
  return el;
}

// ---------- Folgen und Staffeln (wie bei Netflix) ----------
// Die Liste kommt fertig aus dem Hauptprozess (S.episodes, src/main/episode-list.js); ein Klick auf eine Folge schickt "play-episode", der Hauptprozess wechselt die Folge im laufenden Player.
let epsSeasonKey; // zuletzt gewaehlte Staffel; undefined = die der laufenden Folge (gilt nur fuer diese Folge, beim Folgenwechsel beginnt es wieder dort)

/** Staffeln der Serie in Anzeigereihenfolge: 1, 2, 3 ..., zuletzt die Specials (0) und Folgen ohne Staffel. */
function epsSeasons() {
  const map = new Map();
  for (const e of S.episodes ?? []) {
    const key = e.season ?? -1;
    if (!map.has(key)) map.set(key, { key, name: e.seasonName, items: [] });
    map.get(key).items.push(e);
  }
  const rank = (k) => (k > 0 ? k : 1e6 + (k === 0 ? 0 : 1));
  return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/** Name im Reiter: "Staffel 2" in der Sprache der Oberflaeche; ein eigener Name des Servers ("Buch Eins") bleibt, ein allgemeiner ("Season 2") wird uebersetzt. */
function seasonLabel(s) {
  if (s.key === 0) return tr('specials');
  if (s.key < 0) return tr('episodes');
  return s.name && !/^(season|staffel|saison|temporada|stagione)\s*\d+$/i.test(s.name.trim()) ? s.name : tr('season', { n: s.key });
}

function epsScrollToCurrent() {
  const list = popup?.el.querySelector('.eps-list');
  const cur = list?.querySelector('.ep-row.cur');
  if (list) list.scrollTop = cur ? Math.max(0, cur.offsetTop - 8) : 0;
}

function paintEpisodes() {
  epsBtn.hidden = (S.episodes?.length ?? 0) < 2;
  if (epsBtn.hidden && popup?.kind === 'episodes') closePopup();
}

function buildEpisodesPopup() {
  const seasons = epsSeasons();
  const current = (S.episodes ?? []).find((e) => e.id === S.itemId);
  let active = seasons.find((s) => s.key === epsSeasonKey) ?? seasons.find((s) => s.key === (current ? current.season ?? -1 : NaN)) ?? seasons[0];
  const el = h('div', { class: 'pop eps' }, h('h4', null, S.pauseInfo?.title || tr('episodes')));
  const tabs = h('div', { class: 'eps-tabs', role: 'tablist' });
  const list = h('div', { class: 'eps-list' });

  const row = (e) => {
    const isCur = e.id === S.itemId;
    const th = h('div', { class: `ep-th${e.spoiler && !isCur ? ' spoiler' : ''}` });
    if (e.tag) th.append(h('img', { src: `jellycloud://img/${e.id}/Primary?maxWidth=320&quality=80&tag=${encodeURIComponent(e.tag)}`, alt: '', draggable: 'false' }));
    else th.append(icon('tv', 22));
    if (e.played) th.append(h('span', { class: 'ep-done' }, icon('check', 12)));
    else if (e.runSec > 0 && e.posSec > 0) {
      const fill = h('i');
      fill.style.width = `${Math.min(99, (e.posSec / e.runSec) * 100)}%`;
      th.append(h('div', { class: 'ep-prog' }, fill));
    }
    return h(
      'button',
      { class: `ep-row${isCur ? ' cur' : ''}`, type: 'button', 'aria-current': isCur ? 'true' : null, onclick: () => (closePopup(), isCur ? null : send({ type: 'play-episode', id: e.id })) },
      h('span', { class: 'ep-n' }, e.index != null ? String(e.index) : ''),
      th,
      h('span', { class: 'ep-tx' }, h('span', { class: 'ep-t' }, e.name || tr('episodeN', { n: e.index ?? '' })), h('span', { class: 'ep-m' }, isCur ? tr('playingNow') : e.runSec ? formatSpan(e.runSec, lang) : ''))
    );
  };
  const paint = () => {
    for (const b of tabs.children) {
      const on = b.dataset.key === String(active.key);
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    list.replaceChildren(...active.items.map(row));
  };
  if (seasons.length > 1) {
    for (const s of seasons) {
      tabs.append(
        h('button', { class: 'eps-tab', type: 'button', role: 'tab', 'data-key': String(s.key), onclick: () => ((active = s), (epsSeasonKey = s.key), paint(), epsScrollToCurrent()) }, seasonLabel(s))
      );
    }
    el.append(tabs);
  }
  el.append(list);
  paint();
  return el;
}

function buildSpeedPopup() {
  const el = h('div', { class: 'pop' }, h('h4', null, tr('speed')));
  for (const v of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) el.append(optRow({ label: `${v}×`, selected: Math.abs((S.speed ?? 1) - v) < 0.01, onclick: () => { send({ type: 'speed', value: v }); closePopup(); } }));
  return el;
}

/** Qualitaet = Bitratengrenze: "Original" (Direct Play) oder eine Stufe unterhalb der Quelle (der Server transcodiert). */
function buildQualityPopup() {
  const q = S.quality ?? { mbps: 0, sourceMbps: null };
  const src = q.sourceMbps;
  const cur = q.mbps ?? 0;
  const steps = [20, 10, 8, 6, 4, 2].filter((n) => !src || n < src);
  if (cur > 0 && !steps.includes(cur)) steps.push(cur); // eine in den Einstellungen gewaehlte Grenze bleibt sichtbar
  steps.sort((a, b) => b - a);
  const el = h('div', { class: 'pop' }, h('h4', null, tr('quality')));
  // Begrenzt der Server die Bitrate (Internet) und liegt die Datei darueber, steht es hier: "Original" waere dort Direct Play, der Server erlaubt es nicht
  if (S.serverLimit?.exceeded) el.append(h('div', { class: 'pop-note' }, tr('serverLimitNote', { n: S.serverLimit.mbps })));
  const rows = [[0, tr('original'), src ? tr('mbit', { n: +src.toFixed(1) }) : ''], ...steps.map((n) => [n, tr('mbit', { n }), n === steps[0] ? tr('qualityHint') : ''])];
  for (const [m, label, sub] of rows) {
    el.append(optRow({ label, sub, selected: Math.abs(cur - m) < 0.01, onclick: () => { send({ type: 'quality', mbps: m }); closePopup(); showFlash(`${tr('quality')}: ${label}`); } }));
  }
  return el;
}

function buildAspectPopup() {
  const el = h('div', { class: 'pop' }, h('h4', null, tr('aspect')));
  const modes = [['auto', tr('auto')], ['16:9', '16:9'], ['4:3', '4:3'], ['2.39:1', '2.39:1'], ['fill', tr('fill')], ['stretch', tr('stretch')]];
  for (const [id, label] of modes) el.append(optRow({ label, selected: (S.aspect ?? 'auto') === id, onclick: () => { send({ type: 'aspect', mode: id }); closePopup(); showFlash(`${tr('aspect')}: ${label}`); } }));
  return el;
}

// ---------- Seekbar ----------
const seekPos = (e) => {
  const r = seek.getBoundingClientRect();
  return { frac: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), x: Math.min(r.width, Math.max(0, e.clientX - r.left)), width: r.width };
};

function paintPreview(e) {
  const { frac, x, width } = seekPos(e);
  const d = S.duration || 0;
  const t = frac * d;
  const tp = S.trickplay;
  const half = (tp ? tp.width : 180) / 2;
  preview.style.left = `${Math.min(width - half, Math.max(half, x))}px`;
  pvTime.textContent = clock(t);
  const ch = chaptersList().filter((c) => c.time <= t).pop();
  pvChap.textContent = ch?.title ?? '';
  if (tp && tp.interval) {
    const per = tp.tileWidth * tp.tileHeight;
    const idx = Math.min(tp.count - 1, Math.floor((t * 1000) / tp.interval));
    const sheet = Math.floor(idx / per);
    const inSheet = idx % per;
    const col = inSheet % tp.tileWidth;
    const row = Math.floor(inSheet / tp.tileWidth);
    pvImg.style.width = `${tp.width}px`;
    pvImg.style.height = `${tp.height}px`;
    pvImg.style.backgroundImage = `url(jellycloud://trickplay/${tp.itemId}/${tp.sheetWidth}/${sheet}?ms=${encodeURIComponent(tp.mediaSourceId)})`;
    pvImg.style.backgroundSize = `${tp.width * tp.tileWidth}px ${tp.height * tp.tileHeight}px`;
    pvImg.style.backgroundPosition = `-${col * tp.width}px -${row * tp.height}px`;
    pvImg.hidden = false;
  } else {
    pvImg.hidden = true;
  }
  return t;
}

seek.addEventListener('pointermove', (e) => {
  const t = paintPreview(e);
  if (dragging) {
    shown = { position: t, at: performance.now() };
    knob.style.left = `${seekPos(e).frac * 100}%`;
    paintBar();
    paintTimes();
  }
});
seek.addEventListener('pointerdown', (e) => {
  dragging = true;
  seek.classList.add('drag');
  seek.setPointerCapture(e.pointerId);
  const t = paintPreview(e);
  shown = { position: t, at: performance.now() };
  paintBar();
  paintTimes();
  knob.style.left = `${seekPos(e).frac * 100}%`;
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  seek.classList.remove('drag');
  const { frac } = seekPos(e);
  const t = frac * (S.duration || 0);
  shown = { position: t, at: performance.now() };
  send({ type: 'seek', to: t });
};
seek.addEventListener('pointerup', endDrag);
seek.addEventListener('pointercancel', () => {
  dragging = false;
  seek.classList.remove('drag');
});
seek.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'seek', by: e.key === 'ArrowLeft' ? -5 : 5 });
  }
});

// ---------- Maus auf dem Video ----------
let clickTimer = null;
root.addEventListener('click', (e) => {
  if (e.target !== root && !e.target.classList.contains('center')) return;
  if (popup) return closePopup();
  if (e.detail >= 2) {
    clearTimeout(clickTimer);
    send({ type: 'fullscreen' });
    return;
  }
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    send({ type: 'pause' });
  }, 230);
});
root.addEventListener(
  'wheel',
  (e) => {
    if (popup && popup.el.contains(e.target)) return;
    e.preventDefault();
    const action = pb().wheelAction;
    if (action === 'none') return;
    if (action === 'seek') {
      const s = -Math.sign(e.deltaY) * pb().seekSmall;
      send({ type: 'seek', by: s });
      showFlash(`${s > 0 ? '+' : '−'}${Math.abs(s)} s`);
      return;
    }
    const v = Math.min(130, Math.max(0, Math.round((S.volume ?? 100) - Math.sign(e.deltaY) * 5)));
    send({ type: 'volume', value: v });
    showFlash(tr('volumeNow', { v }));
  },
  { passive: false }
);

// ---------- Tastatur ----------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const seekBy = (s) => {
    send({ type: 'seek', by: s });
    showFlash(`${s > 0 ? '+' : '−'}${Math.abs(s)} s`);
  };
  const vol = (d) => {
    const v = Math.min(130, Math.max(0, Math.round((S.volume ?? 100) + d)));
    send({ type: 'volume', value: v });
    showFlash(tr('volumeNow', { v }));
  };
  wake();
  switch (k) {
    case ' ':
    case 'k':
    case 'K':
      e.preventDefault();
      send({ type: 'pause' });
      doPulse(S.paused ? 'play' : 'pause');
      break;
    case 'ArrowLeft':
      e.preventDefault();
      seekBy(e.shiftKey ? -pb().seekBig * 3 : -pb().seekSmall);
      break;
    case 'ArrowRight':
      e.preventDefault();
      seekBy(e.shiftKey ? pb().seekBig * 3 : pb().seekSmall);
      break;
    case 'j':
    case 'J':
      seekBy(-pb().seekBig);
      break;
    case 'l':
    case 'L':
      seekBy(pb().seekBig);
      break;
    case 'ArrowUp':
      e.preventDefault();
      vol(5);
      break;
    case 'ArrowDown':
      e.preventDefault();
      vol(-5);
      break;
    case 'm':
    case 'M':
      send({ type: 'mute' });
      showFlash(S.mute ? tr('unmuted') : tr('muted'));
      break;
    case 'f':
    case 'F':
    case 'F11':
      e.preventDefault();
      send({ type: 'fullscreen' });
      break;
    case 'a':
    case 'A':
    case 's':
    case 'S':
      togglePopup('tracks', tracksBtn);
      break;
    case 'i':
    case 'I':
      toggleInfo();
      break;
    case 'n':
    case 'N':
      if (S.next) send({ type: 'next' });
      break;
    case 'e':
    case 'E':
      if (!epsBtn.hidden) togglePopup('episodes', epsBtn);
      break;
    case '[':
    case ']': {
      const v = Math.min(4, Math.max(0.25, +((S.speed ?? 1) + (k === ']' ? 0.25 : -0.25)).toFixed(2)));
      send({ type: 'speed', value: v });
      showFlash(tr('speedNow', { v }));
      break;
    }
    case 'Home':
      send({ type: 'seek', to: 0 });
      break;
    case 'End':
      if (S.duration) send({ type: 'seek', to: Math.max(0, S.duration - 5) });
      break;
    case 'Escape':
      e.preventDefault();
      if (popup) closePopup();
      else if (infoOpen) toggleInfo(false);
      else if (document.fullscreenElement || S.fullscreen) send({ type: 'fullscreen', value: false });
      else requestClose();
      break;
    case 'Backspace':
    case 'BrowserBack':
      e.preventDefault();
      goBack();
      break;
    default:
      if (/^[0-9]$/.test(k) && S.duration) send({ type: 'seek', to: (S.duration * +k) / 10 });
  }
});

// Maus-Zurueck-Taste (Seitentaste) wie die Zurueck-Taste der Steuerung
window.addEventListener('mouseup', (e) => {
  if (e.button !== 3) return;
  e.preventDefault();
  goBack();
});

// ---------- Zustand empfangen ----------
function apply(patch) {
  const keys = Object.keys(patch);
  Object.assign(S, patch);
  if (keys.includes('notice') && S.notice?.kind) showFlash(tr(S.notice.kind), 4500);
  if (patch.ui) {
    lang = String(patch.ui.language ?? 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
    document.documentElement.lang = lang;
    const a = patch.ui.appearance ?? {};
    if (a.accent) {
      // Gleiche Regeln wie die Oberflaeche (src/shared/accent.js); Text und Icons auf dem dunklen Video brauchen Kontrast >= 4,5:1
      const c = window.JCAccent.resolveAccent(a.accent, { bg: '#161820' });
      const style = document.documentElement.style;
      style.setProperty('--accent', `rgb(${c.accent.join(' ')})`);
      style.setProperty('--accent-rgb', c.tint.join(' '));
      style.setProperty('--accent-fg', `rgb(${c.fg.join(' ')})`);
      style.setProperty('--accent-ink', c.ink);
    }
    document.documentElement.dataset.anim = a.animations ?? 'full';
    document.documentElement.dataset.blur = a.blur === false ? 'off' : 'on';
    paintSeekButtons();
  }
  if (keys.includes('position') && !dragging) shown = { position: patch.position, at: performance.now() };
  // Pausenbildschirm: die Wartezeit zaehlt ab dem Anhalten; das Logo wird schon geladen, damit es beim Einblenden da ist
  if (keys.includes('paused')) lastActivity = performance.now();
  if (keys.includes('pauseInfo')) {
    if (S.pauseInfo?.logo) Object.assign(new Image(), { src: S.pauseInfo.logo });
    if (pauseShown) paintPause();
  }
  if (keys.includes('itemId') && pauseShown) hidePause();
  if (keys.includes('itemId')) {
    cdReset(); // neue Folge/neuer Film: alle Countdowns beginnen von vorn
    epsSeasonKey = undefined; // die Folgenliste beginnt wieder bei der Staffel der laufenden Folge
    if (popup?.kind === 'episodes') closePopup();
  }
  if (keys.includes('episodes')) paintEpisodes();
  if (keys.includes('fullscreen')) {
    fsBtn.replaceChildren(icon(S.fullscreen ? 'fullscreen-exit' : 'fullscreen', 24));
    winctl.hidden = !!S.fullscreen; // im Vollbild gibt es keine Fensterknoepfe
  }
  if (keys.some((k) => ['title', 'subtitle', 'method', 'media'].includes(k))) paintTitle();
  if (keys.some((k) => ['paused', 'phase', 'buffering'].includes(k))) paintPlayState();
  if (keys.some((k) => ['volume', 'mute'].includes(k))) paintVolume();
  if (keys.includes('speed')) speedBtn.textContent = `${+(S.speed ?? 1).toFixed(2)}×`;
  if (keys.includes('quality')) {
    qualityBtn.hidden = !S.quality?.allowed;
    qualityBtn.classList.toggle('lim', (S.quality?.mbps ?? 0) > 0); // Begrenzung aktiv: Symbol in Akzentfarbe
  }
  if (keys.some((k) => ['segments', 'duration', 'chapters', 'jfChapters'].includes(k))) paintSegments();
  if (keys.some((k) => ['segments', 'next', 'duration', 'position'].includes(k))) paintSkip();
  if (keys.some((k) => ['phase', 'error'].includes(k))) paintError();
  if (infoOpen && keys.some((k) => ['stats', 'video', 'media', 'method', 'mpv', 'audioOut', 'audioCfg'].includes(k))) paintInfo();
  if (keys.includes('tracks') && popup?.kind === 'tracks') {
    const btn = popup.btn;
    closePopup();
    setTimeout(() => togglePopup('tracks', btn), 180);
  }
  if (keys.some((k) => ['phase'].includes(k)) && S.phase === 'playing') wake();
  paintTimes();
}

// Weiche Zeitanzeige zwischen den (seltenen) Positions-Updates. Gezeichnet wird nur, was gerade zu sehen ist:
// bei ausgeblendeter Leiste nur noch einmal pro Sekunde fuer "Intro ueberspringen" / "Naechste Folge".
function frame() {
  // Countdown der Knoepfe: Wanduhr seit dem letzten Bild, hoechstens 0,25 s je Bild (nach einer Pause des Fensters kein Sprung ans Ende)
  const nowMs = performance.now();
  cdTick(Math.min(0.25, Math.max(0, (nowMs - (frame.last ?? nowMs)) / 1000)));
  frame.last = nowMs;
  if (S.phase === 'playing' && !S.paused && !S.buffering && !dragging) {
    const dt = (performance.now() - shown.at) / 1000;
    const pos = Math.min(S.duration || Infinity, shown.position + dt * (S.speed ?? 1));
    shown = { position: pos, at: performance.now() };
  }
  if (uiVisible) paintBar();
  const sec = Math.floor(shown.position);
  if (frame.sec !== sec) {
    frame.sec = sec;
    if (uiVisible) paintTimes();
    paintSkip();
  }
  requestAnimationFrame(frame);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (infoOpen) paintInfo();
    if (popup) {
      fit(popup.el, ['compact', 'dense', 'tight']);
      const r = popup.btn.getBoundingClientRect();
      const w = popup.el.offsetWidth;
      popup.el.style.left = `${Math.max(16, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 16))}px`;
    }
  }, 120);
});

window.player.onState(apply);
window.player.getState().then((s) => {
  if (s) apply(s);
  paintTitle();
  paintPlayState();
  paintVolume();
  paintTimes();
  wake();
});
requestAnimationFrame(frame);
