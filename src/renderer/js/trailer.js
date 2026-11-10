import { h, icon } from './dom.js';
import { t } from './i18n.js';

const ORIGIN = 'https://www.youtube-nocookie.com';
const START_TIMEOUT_MS = 15000;
const PLAY_HANDOVER_MS = 320; // so lange bleibt die Seite nach dem Start der Wiedergabe unveraendert (der Vorhang braucht gut 170 ms), bevor der Trailer abgebaut wird
const REVEAL_MAX_MS = 9000; // so lange wartet das Einblenden hoechstens auf eine gute Qualitaetsstufe (YouTube braucht dafuer meist 5 bis 6 s)
// So lange darf der Trailer verdeckt oder aus dem Blick sein, bevor sein Player ganz abgebaut wird. Der Rahmen ist ein eigener Prozess und kostet im Hintergrund weiter Arbeitsspeicher
// (angehalten rund 230 MB bei Full HD, bei 4K mehr); nach der Rueckkehr beginnt der Trailer von vorn. Kuerzere Pausen (Fenstertausch, kurz gescrollt) setzen denselben Player fort.
const REST_RELEASE_MS = 60000;
// Lautstaerkeleiste neben dem Ton-Knopf: so lange nach dem Wegfahren der Maus bzw. nach der letzten Bedienung (Mausrad, Tasten, Klick) bleibt sie noch stehen, dann blendet sie von selbst aus
const POP_LEAVE_MS = 700;
const POP_IDLE_MS = 2200;
const POP_CLOSE_MS = 300; // so lange faehrt die Kapsel ein (CSS: 260 ms)

// Qualitaetsstufen der Einbettung, aufsteigend (so meldet und verlangt sie YouTube)
const RANKS = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres'];
const rank = (q) => RANKS.indexOf(q);

/**
 * Einstellbare Hoechststufen. YouTube waehlt die Qualitaet nach der Groesse des Players, deshalb hat der Rahmen je Stufe eine feste Groesse
 * (w x h) und wird auf die Flaeche skaliert. cap: hoechste angeforderte Stufe, min: ab dieser Stufe gilt das Bild als gut genug zum Einblenden.
 */
export const TRAILER_TIERS = {
  2160: { w: 3840, h: 2160, cap: 'hd2160', min: 'hd1080' },
  1080: { w: 1920, h: 1080, cap: 'hd1080', min: 'hd720' },
  720: { w: 1280, h: 720, cap: 'hd720', min: 'hd720' }
};
/** Eingestellte Stufe als gueltiger Schluessel ("2160", "1080", "720"); alles Unbekannte ergibt 4K (Standard). */
export const trailerTier = (v) => (String(v) in TRAILER_TIERS ? String(v) : '2160');

/**
 * Trailer im Hintergrund der Detailseite (YouTube-Einbettung ohne Cookies). Der Trailer startet nach einer Verzoegerung, auf Wunsch
 * stumm, und blendet sich ueber das Hintergrundbild ein, sobald er wirklich laeuft. Er pausiert, wenn die Seite aus dem Blick scrollt oder
 * das Fenster verdeckt ist, und endet, sobald die Wiedergabe eines Films beginnt (sonst liefen zwei Tonquellen gleichzeitig).
 * Gesteuert wird der Player ueber die postMessage-Schnittstelle der Einbettung (kein fremdes Skript noetig, die CSP erlaubt nur den Rahmen).
 *
 * @param {{ host: HTMLElement, controlsHost?: HTMLElement|null, videoId: string, muted?: boolean, delaySec?: number, quality?: string|number, volume?: number, onVolume?: (v: number) => void }} o
 *   host: Hintergrund-Container (.detail-bd), controlsHost: optional, Container fuer die Knoepfe (Ton, Ausblenden); sonst spaeter mit mountControls,
 *   quality: Hoechststufe ("2160" = bis 4K, "1080", "720"; siehe TRAILER_TIERS), volume: Lautstaerke 5 bis 100 (Regler und Mausrad aendern sie, onVolume
 *   meldet den neuen Wert zum Speichern), focusSec: nach so vielen Sekunden ohne Bedienung bekommt host die Klasse "tr-focus" (die Seite senkt Poster, Titel und
 *   Angaben langsam ab und blendet sie aus, Poster und Titel bis auf die Haelfte, damit der Trailer frei zu sehen ist; 0 = nie), fadeSec: Dauer dieses Ausblendens
 *   (Standard 4 s); Mausbewegung, Taste, Mausrad oder Scrollen bringen alles zurueck,
 *   onDone: wird einmal gerufen, wenn der Trailer zu Ende ist ("ended") oder sich nicht abspielen laesst ("failed"; nicht, wenn der Aufrufer ihn mit destroy beendet),
 *   restMs: so lange darf er verdeckt oder aus dem Blick sein, bevor der Player abgebaut wird (danach startet er beim Zurueckkommen von vorn; Standard REST_RELEASE_MS).
 *   host ist auf der Detailseite .detail-bd, im Banner der Startseite die aktive Folie (.hero-slide)
 * @returns {{ destroy: () => void, isPlaying: () => boolean, mountControls: (parent: HTMLElement) => void }}
 */
export function createTrailer({ host, controlsHost = null, videoId, muted = true, delaySec = 0, quality = '2160', volume = 10, onVolume = null, focusSec = 0, fadeSec = 4, focusStyle = 'corner', onDone = null, restMs = REST_RELEASE_MS }) {
  const tier = TRAILER_TIERS[trailerTier(quality)];
  const clampVol = (v) => Math.min(100, Math.max(5, Math.round(Number(v) / 5) * 5 || 10));
  let vol = clampVol(volume); // Lautstaerke, wenn der Ton an ist (der Regler ganz links schaltet stumm, aendert sie aber nicht)
  let target = tier.cap; // angeforderte Stufe; sinkt auf die beste, die das Video wirklich hat (nicht jedes Video gibt es in 4K)
  let frame = null;
  let startTimer = null;
  let giveUpTimer = null;
  let handoverTimer = null; // nach dem Start der Wiedergabe: Abbau des Trailers erst hinter dem geschlossenen Vorhang
  let releaseTimer = null; // laenger verdeckt oder aus dem Blick: der Player wird abgebaut (release)
  let destroyed = false;
  let isMuted = !!muted;
  let inView = true;
  let playing = false;
  let finished = false; // der Trailer ist einmal zu Ende gelaufen: er wird nicht wiederholt (kein Dauerlauf, auch nicht durch Scrollen, Fensterwechsel oder Wiederkehr)
  let ready = false; // die Verzoegerung ist abgelaufen: erst dann darf der Trailer starten (auch nicht durch den Sichtbarkeits-Beobachter)
  let revealed = false; // der Trailer ist eingeblendet
  let revealTimer = null;

  // Zwischen Bild und Abdunklung, damit der Verlauf auch ueber dem Trailer liegt (Detailseite: .detail-bd-shade, Banner der Startseite: .hero-shade)
  const layer = h('div', { class: 'trailer', 'aria-hidden': 'true' });
  host.insertBefore(layer, host.querySelector('.detail-bd-shade, .hero-shade'));

  // YouTube waehlt die Qualitaet nach der Groesse des Players. Der Rahmen hat deshalb immer die feste Groesse der Stufe (4K: 3840x2160) und wird
  // auf die Flaeche skaliert (wie object-fit: cover, leicht vergroessert: das schneidet Titel- und Verlaufsleisten der Einbettung ab).
  layer.style.setProperty('--tr-w', `${tier.w}px`);
  layer.style.setProperty('--tr-h', `${tier.h}px`);
  // Naht in der Bildmitte: Der Player liegt in der Einbettung in mehreren Ebenen, die genau in der Mitte des Rahmens aneinanderstossen (zum Beispiel, wenn YouTube beim Fortsetzen sein Pausen-Symbol
  // einblendet). Faellt diese Kante bei der Skalierung zwischen zwei Bildpunkte, bleibt dort eine duenne dunkle Linie quer durchs Bild. Deshalb wird der Massstab auf ein Raster gelegt, bei dem
  // die halbe Rahmenbreite und -hoehe auf ganze Bildpunkte fallen (4K: Vielfache von 1/120), und der Rahmen auf einen ganzen Bildpunkt mittig gesetzt.
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const GRID = gcd(tier.w / 2, tier.h / 2);
  const fit = () => {
    const w = layer.clientWidth;
    const hgt = layer.clientHeight;
    if (!w || !hgt) return;
    const dpr = window.devicePixelRatio || 1;
    // Deckend (wie object-fit: cover) und etwas groesser (Titel- und Verlaufsleisten der Einbettung liegen aussen). Viele Trailer sind mit schwarzen Balken oben und unten gedreht (Kino-Format 2,39 : 1 im 16:9-Bild, je 13 % Balken):
    // die sichtbare Hoehe darf hoechstens 74 % der Bildhoehe sein, dann sind die Balken weg und stehen nicht als dunkler Streifen unten am Banner.
    const want = Math.max((w / tier.w) * 1.12, hgt / (tier.h * 0.74)) * dpr; // Bildpunkte je Rahmenpixel
    const device = Math.ceil(want * GRID - 1e-6) / GRID; // aufgerundet auf das Raster (hoechstens rund 2 % mehr, das Bild bleibt deckend)
    layer.style.setProperty('--tr-scale', (device / dpr).toFixed(8));
    layer.style.setProperty('--tr-cx', `${(Math.round((w * dpr) / 2) / dpr).toFixed(4)}px`);
    layer.style.setProperty('--tr-cy', `${(Math.round((hgt * dpr) / 2) / dpr).toFixed(4)}px`);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(layer);
  fit();

  // Nur ein runder Glas-Knopf wie "Gesehen", "Favorit" und "Mehr" in der Aktionsleiste (mountControls): Ton an/aus. Die Lautstaerke klappt beim Daruebergehen
  // als kleine Leiste darueber auf (liegt frei ueber dem Bild, nichts springt), auch per Mausrad. "Trailer ausblenden" steht im Menue "Mehr".
  const muteBtn = h('button', { class: 'btn icon glass lg', type: 'button', onclick: () => (toggleMute(), openPop(POP_IDLE_MS)) });
  const volInput = h('input', { type: 'range', min: 0, max: 100, step: 5, value: vol, title: t('trailer.volume'), 'aria-label': t('trailer.volume') });
  const pop = h('div', { class: 'tr-pop' }, h('div', { class: 'tr-pop-in slider' }, volInput));
  const sound = h('div', { class: 'tr-sound' }, muteBtn, pop);
  // Die Leiste faehrt rechts neben dem Knopf heraus (Klasse "open", CSS) und blendet von selbst wieder aus: Solange die Maus auf Knopf oder Leiste steht oder der Regler gezogen wird,
  // bleibt sie; danach noch POP_LEAVE_MS. Nach Mausrad, Tasten oder einem Klick auf den Knopf schliesst sie nach POP_IDLE_MS ohne weitere Bedienung.
  let popTimer = null;
  let closingTimer = null;
  let dragging = false;
  const closePop = () => {
    popTimer = null;
    if (dragging || sound.matches(':hover')) return; // steht noch jemand drauf, bleibt sie (beim Wegfahren schliesst pointerleave)
    if (!sound.classList.contains('open')) return;
    // "closing": die Kapsel faehrt ein, der Knopf bleibt solange durchsichtig, sonst lagen kurz zwei Glasschichten uebereinander
    sound.classList.remove('open');
    sound.classList.add('closing');
    clearTimeout(closingTimer);
    closingTimer = setTimeout(() => sound.classList.remove('closing'), POP_CLOSE_MS);
  };
  const openPop = (idleMs = 0) => {
    clearTimeout(popTimer);
    clearTimeout(closingTimer);
    popTimer = null;
    sound.classList.remove('closing');
    if (!sound.classList.contains('open')) {
      const r = sound.getBoundingClientRect();
      if (r.width) sound.style.setProperty('--tr-bw', `${Math.round(r.width)}px`); // Breite des Knopfes: die Kapsel waechst von ihr aus
      // Reicht rechts der Platz nicht (schmales Fenster, Knopf weit rechts), waechst sie nach links
      sound.classList.toggle('flip', r.right + 140 > window.innerWidth - 8);
    }
    sound.classList.add('open');
    if (idleMs) popTimer = setTimeout(closePop, idleMs);
  };
  sound.addEventListener('pointerenter', () => openPop());
  sound.addEventListener('pointerleave', () => {
    if (dragging) return;
    clearTimeout(popTimer);
    popTimer = setTimeout(closePop, POP_LEAVE_MS);
  });
  volInput.addEventListener('pointerdown', () => {
    dragging = true;
    clearTimeout(popTimer);
    const up = () => {
      dragging = false;
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      clearTimeout(popTimer);
      popTimer = setTimeout(closePop, sound.matches(':hover') ? POP_IDLE_MS : POP_LEAVE_MS);
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  });
  // Tastatur: Tab auf den Knopf oder den Regler zeigt die Leiste (nur bei Tastatur-Fokus, ein Mausklick auf den Knopf laesst sie nicht stehen), Pfeiltasten am Regler halten sie offen
  sound.addEventListener('focusin', () => {
    if (sound.querySelector(':focus-visible')) openPop(POP_IDLE_MS);
  });
  volInput.addEventListener('input', () => openPop(POP_IDLE_MS));
  const controls = h('div', { class: 'trailer-ctl', hidden: true }, sound);
  controlsHost?.append(controls);
  const paintMute = () => {
    muteBtn.replaceChildren(icon(isMuted ? 'volume-mute' : 'volume', 22));
    muteBtn.title = isMuted ? t('trailer.unmute') : t('trailer.mute');
    muteBtn.setAttribute('aria-label', muteBtn.title);
    const shown = isMuted ? 0 : vol;
    volInput.value = String(shown);
    volInput.style.setProperty('--fill', `${shown}%`);
    sound.classList.toggle('muted', isMuted);
  };
  paintMute();

  const post = (func, args = []) => {
    try {
      frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch {
      /* Rahmen schon weg */
    }
  };

  function toggleMute() {
    isMuted = !isMuted;
    post(isMuted ? 'mute' : 'unMute');
    if (!isMuted) post('setVolume', [vol]);
    paintMute();
  }

  /** Neue Lautstaerke (0 = stumm schalten, sonst Ton an mit diesem Wert); persist: dem Aufrufer zum Speichern melden. */
  function setVolume(v, persist) {
    v = Math.min(100, Math.max(0, Math.round(Number(v) / 5) * 5 || 0));
    if (v === 0) {
      isMuted = true;
      post('mute');
    } else {
      vol = v;
      if (isMuted) {
        isMuted = false;
        post('unMute');
      }
      post('setVolume', [v]);
    }
    paintMute();
    if (persist && v > 0) onVolume?.(vol);
  }
  volInput.addEventListener('input', () => setVolume(volInput.value, false));
  volInput.addEventListener('change', () => onVolume?.(vol));
  sound.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setVolume((isMuted ? 0 : vol) + (e.deltaY < 0 ? 5 : -5), true);
      openPop(POP_IDLE_MS); // man sieht, was das Mausrad tut, und sie geht danach von selbst zu
    },
    { passive: false }
  );

  /** Laeuft gerade etwas, das den Ton des Trailers stoeren wuerde (mpv ueber der Oberflaeche)? */
  const blocked = () => document.hidden || document.documentElement.classList.contains('playing');

  // ---------- Trailer im Vordergrund: nach einer Weile ohne Bedienung sinken Poster, Titel und Angaben langsam ab und blenden aus ----------
  const idleSec = Math.max(0, Number(focusSec) || 0);
  let focusTimer = null;
  let anchor = null; // Mausposition der letzten Bedienung: erst eine echte Bewegung zaehlt (nachgeschobene Mausereignisse nach einem Layout nicht)
  // tr-focus: der Kopfbereich der Seite (Poster und Angaben) gleitet als ein Block nach unten, Angaben und Knoepfe blenden dabei aus, Poster und Titel/Logo bleiben unten links
  // zur Haelfte stehen (unten abgeschnitten), der Titel rutscht dabei noch ein Stueck weiter bis etwa zur Mitte des sichtbaren Posters; die Dauer steht in --tr-fade, die Strecken in --tr-dy (Block) und --tr-ty (Titel).
  // tr-focus-out: beim Zurueckkommen noch kurz dabei, damit die Abschneidekante mit nach unten wandert, statt dass das Poster ploetzlich ganz erscheint.
  const fadeHost = host.closest('.detail') ?? host; // Poster und Angaben sind Geschwister des Hintergrunds, die Variablen muessen also eine Ebene hoeher liegen
  fadeHost.style.setProperty('--tr-fade', `${Math.max(0.2, Number(fadeSec) || 4)}s`);
  const style = focusStyle === 'poster' ? 'poster' : 'corner'; // corner: das Poster blendet aus, Titel/Logo gleitet in die linke untere Ecke; poster: Poster und Titel bleiben zur Haelfte unten stehen
  fadeHost.dataset.trStyle = style;
  /**
   * Strecken beim Absinken (null: kein Poster da): dy fuer den ganzen Kopfbereich, so dass die Oberkante des Posters um seine halbe Hoehe ueber der Kante bei 82 % der
   * Fensterhoehe liegt; ty zusaetzlich fuer Titel/Logo, das dann noch ein Stueck weiter rutscht, bis es etwa in der Mitte des sichtbaren Posters steht (zwischen
   * Oberkante des Posters und 78 % der Hoehe, hoechstens so tief, dass es noch vor dem Abschneiden bei 76 % endet).
   */
  const slideDistances = () => {
    const poster = fadeHost.querySelector('.detail-poster');
    const head = poster?.closest('.detail-head');
    if (!poster || !head) return null;
    const shifted = (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42; // falls etwas gerade noch zurueckgleitet
    const hostTop = host.getBoundingClientRect().top;
    const headMoved = shifted(head);
    const p = poster.getBoundingClientRect();
    const posterTop = p.top - hostTop - headMoved;
    const dy = Math.max(0, Math.round(innerHeight * 0.82 - p.height / 2 - posterTop));
    let ty = 0;
    const title = head.querySelector('.detail-title, .detail-logo');
    if (title) {
      const t = title.getBoundingClientRect();
      const titleTop = t.top - hostTop - headMoved - shifted(title) + dy; // Lage nach dem Gleiten des Blocks
      const wanted = Math.min((posterTop + dy + innerHeight * 0.78) / 2 - t.height / 2, innerHeight * 0.76 - t.height);
      ty = Math.max(0, Math.round(wanted - titleTop));
    }
    return { dy, ty };
  };
  /**
   * Strecken fuer den Stil "corner": der Kopf bleibt stehen (dy 0), der Titel/das Logo gleitet nach links an die Stelle des Posters (tx: linke Kante auf die des Posters) und nach unten
   * (ty: so, dass seine Unterkante nach dem Verkleinern auf 80 % bei 80 % der Fensterhoehe liegt). Skaliert wird um die linke Mitte, daher aendert sich dabei nur die Hoehe um die Mitte.
   */
  const cornerDistances = () => {
    const poster = fadeHost.querySelector('.detail-poster');
    const head = poster?.closest('.detail-head');
    if (!poster || !head) return null;
    const title = head.querySelector('.detail-title, .detail-logo');
    if (!title) return { dy: 0, ty: 0, tx: 0 };
    const m = new DOMMatrixReadOnly(getComputedStyle(title).transform); // falls es gerade noch zurueckgleitet
    const t = title.getBoundingClientRect();
    const p = poster.getBoundingClientRect();
    const hostTop = host.getBoundingClientRect().top;
    const naturalLeft = t.left - m.m41;
    const naturalCenter = (t.top + t.bottom) / 2 - hostTop - m.m42;
    const targetCenter = innerHeight * 0.8 - (t.height * 0.8) / 2;
    return { dy: 0, tx: Math.round(p.left - naturalLeft), ty: Math.max(0, Math.round(targetCenter - naturalCenter)) };
  };
  let outTimer = null;
  const setFocus = (on) => {
    clearTimeout(outTimer);
    const was = host.classList.contains('tr-focus');
    if (on && !was) {
      const d = style === 'corner' ? cornerDistances() : slideDistances();
      if (d) {
        fadeHost.style.setProperty('--tr-dy', `${d.dy}px`);
        fadeHost.style.setProperty('--tr-ty', `${d.ty}px`);
        if (d.tx !== undefined) fadeHost.style.setProperty('--tr-tx', `${d.tx}px`);
        else fadeHost.style.removeProperty('--tr-tx');
      }
    }
    host.classList.toggle('tr-focus', on);
    if (on) host.classList.remove('tr-focus-out');
    else if (was) {
      host.classList.add('tr-focus-out');
      outTimer = setTimeout(() => host.classList.remove('tr-focus-out'), 650);
    }
  };
  const atTop = () => host.getBoundingClientRect().top > -30; // der Hintergrund liegt oben an der Seite: steht seine Oberkante nicht oben, ist weitergescrollt
  const armFocus = () => {
    clearTimeout(focusTimer);
    // Nur wenn die Seite ganz oben steht und der Trailer zu sehen ist: wer weiter unten die Besetzung oder aehnliche Titel ansieht, soll nichts verschwinden sehen.
    // Scrollen zaehlt als Bedienung und setzt den Zeitgeber neu, wer zurueck nach oben scrollt, bekommt den freien Blick also nach der Ruhezeit.
    if (idleSec > 0 && revealed && !destroyed) focusTimer = setTimeout(() => atTop() && inView && setFocus(true), idleSec * 1000);
  };
  const onActivity = (e) => {
    if (e.type === 'mousemove') {
      if (!anchor) anchor = { x: e.clientX, y: e.clientY };
      if (Math.abs(e.clientX - anchor.x) + Math.abs(e.clientY - anchor.y) < 8) return;
      anchor = { x: e.clientX, y: e.clientY };
    }
    setFocus(false);
    armFocus();
  };
  const ACTIVITY = ['mousemove', 'keydown', 'pointerdown', 'wheel'];
  if (idleSec > 0) {
    for (const type of ACTIVITY) document.addEventListener(type, onActivity, { passive: true });
    document.addEventListener('scroll', onActivity, { passive: true, capture: true });
  }

  /** Zeigt den Trailer (blendet ihn ueber das Hintergrundbild ein) und die Knoepfe. */
  function reveal() {
    if (revealed || destroyed || !playing) return;
    revealed = true;
    clearTimeout(revealTimer);
    layer.classList.add('on');
    host.classList.add('has-trailer');
    controls.hidden = false;
    armFocus();
  }

  /** YouTube beginnt mit niedriger Qualitaet (360p) und steigert sie erst nach und nach: die hoechste Stufe gleich anfordern. */
  const askForBestQuality = () => {
    post('setPlaybackQualityRange', [target, target]);
    post('setPlaybackQuality', [target]);
  };

  /** Das Video meldet, welche Stufen es hat: die beste bis zur eingestellten Hoechststufe anfordern (ein Video ohne 4K bekommt sein Bestes). */
  function onAvailableLevels(levels) {
    const best = RANKS.filter((q) => levels.includes(q) && rank(q) <= rank(tier.cap)).pop();
    if (!best || best === target) return;
    target = best;
    askForBestQuality();
  }

  /** Ist das gemeldete Bild gut genug zum Einblenden? Bei Videos, die nichts Besseres haben, reicht deren beste Stufe. */
  const goodEnough = (q) => rank(q) >= 0 && rank(q) >= Math.min(rank(tier.min), rank(target));

  function setState(s) {
    // YouTube-Zustaende: 1 laeuft, 0 zu Ende, 2 pausiert, 3 puffert, 5 bereit
    if (finished) return;
    if (s === 1) {
      if (playing) return;
      playing = true;
      clearTimeout(giveUpTimer);
      askForBestQuality();
      post('setVolume', [vol]);
      // Den Trailer erst einblenden, wenn eine gute Stufe laeuft (spaetestens nach REVEAL_MAX_MS), damit kein unscharfer Anfang zu sehen ist
      revealTimer = setTimeout(reveal, REVEAL_MAX_MS);
    } else if (s === 0) {
      finished = true;
      playing = false;
      revealed = false;
      clearTimeout(revealTimer);
      clearTimeout(giveUpTimer);
      frame?.remove(); // der beendete Player bleibt nicht liegen: sonst koennte ihn "playVideo" beim Zurueckscrollen oder Wiederoeffnen des Fensters neu starten (und er zeigt Vorschlaege)
      frame = null;
      layer.classList.remove('on'); // zu Ende: das Hintergrundbild ist wieder zu sehen
      host.classList.remove('has-trailer');
      clearTimeout(focusTimer);
      setFocus(false);
      controls.hidden = true;
      onDone?.('ended');
    }
  }

  /** Der Trailer laesst sich nicht abspielen (Einbettung gesperrt, Video entfernt, nichts kam rechtzeitig): still aufgeben und dem Aufrufer Bescheid geben. */
  function giveUp() {
    if (destroyed) return;
    api.destroy();
    if (!finished) onDone?.('failed'); // war er schon zu Ende ("ended" gemeldet), kein zweites Mal Bescheid geben
  }

  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    let data = e.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;
    if (data.event === 'onReady') {
      askForBestQuality(); // schon vor dem ersten Bild: die ersten Abschnitte sollen nicht in 360p kommen
      post('setVolume', [vol]);
    }
    if (Array.isArray(data.info?.availableQualityLevels)) onAvailableLevels(data.info.availableQualityLevels);
    if (data.event === 'onStateChange') setState(data.info);
    else if (data.event === 'infoDelivery') {
      if (typeof data.info?.playerState === 'number') setState(data.info.playerState);
      if (goodEnough(data.info?.playbackQuality)) reveal(); // hohe Stufe erreicht: jetzt zeigen
    } else if (data.event === 'onError') giveUp(); // Einbettung nicht erlaubt, Video entfernt ...
  }

  function start() {
    if (destroyed || finished || frame || blocked() || !inView) return;
    const params = { autoplay: '1', mute: isMuted ? '1' : '0', controls: '0', rel: '0', modestbranding: '1', playsinline: '1', iv_load_policy: '3', disablekb: '1', fs: '0', enablejsapi: '1' };
    const q = new URLSearchParams(params);
    frame = h('iframe', {
      src: `${ORIGIN}/embed/${videoId}?${q}`,
      allow: 'autoplay; encrypted-media',
      referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      tabindex: '-1',
      title: ''
    });
    // Ohne diesen Handschlag schickt die Einbettung keine Zustandsmeldungen
    frame.addEventListener('load', () => {
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      } catch {
        /* Rahmen schon weg */
      }
    });
    layer.append(frame);
    // Kommt nichts Abspielbares, den Rahmen wieder entfernen (spart Daten und Arbeit)
    giveUpTimer = setTimeout(giveUp, START_TIMEOUT_MS);
  }

  /** Lange verdeckt oder aus dem Blick: den Player ganz abbauen (Arbeitsspeicher), das Hintergrundbild ist wieder zu sehen. Beim Zurueckkommen startet onVisibility einen neuen. */
  function release() {
    releaseTimer = null;
    if (destroyed || finished || !frame || !(document.hidden || !inView)) return;
    clearTimeout(giveUpTimer);
    clearTimeout(revealTimer);
    clearTimeout(focusTimer);
    setFocus(false);
    frame.remove();
    frame = null;
    playing = false;
    revealed = false;
    layer.classList.remove('on');
    host.classList.remove('has-trailer');
    controls.hidden = true;
  }

  // Fenster verdeckt oder Trailer aus dem Blick gescrollt: anhalten (der Ton ist weg, der Player arbeitet nicht); wieder da: fortsetzen. Das Symbol, das die Einbettung dabei einblenden wuerde (grauer Kreis
  // mit Pause-Zeichen in der Bildmitte, dazu der Ladekreis), blendet der Hauptprozess im Rahmen aus (main.js: quietEmbedFrame), von hier aus kommt man an den fremden Rahmen nicht heran.
  function onVisibility() {
    if (destroyed || finished) return;
    if (document.hidden || !inView) {
      if (frame && !releaseTimer) releaseTimer = setTimeout(release, Math.max(0, Number(restMs) || 0));
    } else {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    if (blocked() || !inView) {
      if (frame && !document.documentElement.classList.contains('playing')) post('pauseVideo'); // laeuft die Uebergabe an den Player, haelt der Beobachter unten ihn an
    } else if (frame) post('playVideo');
    else if (ready) start();
  }

  // Aus dem Blick gescrollt: pausieren; zurueck: weiter
  const io = new IntersectionObserver(
    (entries) => {
      inView = entries.some((x) => x.isIntersecting);
      onVisibility();
    },
    { threshold: 0.15 }
  );
  io.observe(host);

  // Beginnt ein Film (Klasse "playing" an der Wurzel, gesetzt vom Hauptprozess), endet der Trailer. Der Ton ist sofort aus, das Bild aber bleibt stehen und die Seite unveraendert:
  // der Abbau (Trailer-Ebene weg, Hintergrundbild und Normalzustand der Seite kommen zurueck) geschieht erst, wenn der schwarze Vorhang (#play-curtain) zu ist. Sonst sah man beim Klick auf
  // "Abspielen" kurz das Hintergrundbild, solange mpv noch nichts gezeichnet hatte.
  const mo = new MutationObserver(() => {
    if (handoverTimer || !document.documentElement.classList.contains('playing')) return;
    post('pauseVideo');
    handoverTimer = setTimeout(giveUp, PLAY_HANDOVER_MS);
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onVisibility);
  // Der Rahmen wird erst nach der Einblendanimation der Seite angelegt (.page-enter bewegt die Seite 0,4 s lang): ein fremder Rahmen (YouTube laeuft in einem eigenen Prozess) wird waehrend einer
  // Bewegung der Seite nicht immer sauber beschnitten und blitzte dann unten am Banner als dunkler Streifen ueber den Rand.
  startTimer = setTimeout(() => {
    const page = host.closest('.page');
    Promise.allSettled((page?.getAnimations?.() ?? []).map((a) => a.finished)).then(() => {
      if (destroyed) return;
      ready = true;
      start();
    });
  }, Math.max(0, Number(delaySec) || 0) * 1000);

  const api = {
    isPlaying: () => playing && !destroyed,
    /** Haengt die Knoepfe (Ton, Ausblenden) in einen Container, etwa die Aktionsleiste; sie erscheinen erst, wenn der Trailer sichtbar ist. */
    mountControls(parent) {
      if (!destroyed && parent) parent.append(controls);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(startTimer);
      clearTimeout(giveUpTimer);
      clearTimeout(revealTimer);
      clearTimeout(focusTimer);
      clearTimeout(handoverTimer);
      clearTimeout(releaseTimer);
      clearTimeout(popTimer);
      clearTimeout(closingTimer);
      for (const type of ACTIVITY) document.removeEventListener(type, onActivity);
      document.removeEventListener('scroll', onActivity, true);
      clearTimeout(outTimer);
      host.classList.remove('has-trailer', 'tr-focus', 'tr-focus-out');
      fadeHost.style.removeProperty('--tr-fade');
      fadeHost.style.removeProperty('--tr-dy');
      fadeHost.style.removeProperty('--tr-ty');
      fadeHost.style.removeProperty('--tr-tx');
      delete fadeHost.dataset.trStyle;
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      frame?.remove();
      frame = null;
      layer.remove();
      controls.remove();
    }
  };
  return api;
}
