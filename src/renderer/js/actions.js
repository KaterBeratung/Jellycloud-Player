import { t } from './i18n.js';
import { toast, openMenu, refreshCards } from './ui.js';
import { api } from './api.js';
import { navigate, liveViews } from './router.js';

const SeasonChoice = window.JCSeasonChoice; // welche Staffel zuerst (src/shared/season-choice.js)

let starting = false;

/** Startet die Wiedergabe im Hauptprozess (mpv) und zeigt verstaendliche Fehler. */
export async function playItem(req) {
  if (starting) return false;
  starting = true;
  document.documentElement.classList.add('is-starting');
  try {
    await window.jc.play(req);
    return true;
  } catch (e) {
    if (e.code === 'MPV_NOT_FOUND') {
      toast(t('toast.mpvMissing'), { type: 'error', duration: 9000, action: { label: t('toast.openSettings'), run: () => navigate('/settings/general') } });
    } else if (e.status === 401) {
      toast(t('toast.sessionExpired'), { type: 'error' });
    } else {
      toast(e.message || t('toast.playFailed'), { type: 'error', duration: 7000 });
    }
    return false;
  } finally {
    starting = false;
    document.documentElement.classList.remove('is-starting');
  }
}

/** Gesehen umschalten. true, wenn der Server es uebernommen hat (dann steht der neue Stand in item.UserData). */
export async function toggleWatched(item) {
  const next = !item.UserData?.Played;
  try {
    await api.setPlayed(item.Id, next);
    item.UserData = { ...(item.UserData ?? {}), Played: next, PlaybackPositionTicks: 0, PlayedPercentage: 0 };
    toast(next ? t('toast.markedWatched') : t('toast.markedUnwatched'));
    return true;
  } catch (e) {
    toast(e.message, { type: 'error' });
    return false;
  }
}

/** Favorit umschalten. true, wenn der Server es uebernommen hat. */
export async function toggleFavorite(item) {
  const next = !item.UserData?.IsFavorite;
  try {
    await api.setFavorite(item.Id, next);
    item.UserData = { ...(item.UserData ?? {}), IsFavorite: next };
    toast(next ? t('toast.favAdded') : t('toast.favRemoved'));
    return true;
  } catch (e) {
    toast(e.message, { type: 'error' });
    return false;
  }
}

/**
 * Was "Abspielen" einer Serie startet: die naechste Folge, sonst die erste Folge der ersten richtigen Staffel, nicht der Extras (SeasonChoice.seriesTarget,
 * wie JellyfinClient.playTarget der Apple-App). { episode, resume }: resume, ob an der gemerkten Stelle begonnen wird.
 */
export const resolveSeriesTarget = (seriesId) => SeasonChoice.seriesTarget(api, seriesId);

let seriesSeq = 0;
/**
 * Serie abspielen (Karten, Banner, Kontextmenue). Die Folge steht erst nach einer Antwort des Servers fest: sie startet nur, wenn der Nutzer inzwischen
 * nichts anderes getan hat (dieselbe Seite, kein neuerer Start; wie DeferredAction der Apple-App).
 */
export async function playSeries(item) {
  if (item.Type !== 'Series') return playItem({ itemId: item.Id, resume: true });
  const mine = ++seriesSeq;
  const where = location.hash;
  const { episode, resume } = await resolveSeriesTarget(item.Id);
  if (mine !== seriesSeq || location.hash !== where) return false;
  if (!episode) {
    toast(t('toast.noEpisodes'), { type: 'error' });
    return false;
  }
  return playItem({ itemId: episode.Id, resume });
}

// ---------- Stand eines Eintrags hat sich geaendert ----------

/**
 * Nach einer Aenderung am Stand eines Eintrags (Gesehen, Favorit, aus "Weiterschauen" entfernt; wie AppModel.itemStateChanged der Apple-App): jede
 * lebende Ansicht, die sichtbare und die im Speicher des Routers, zeigt danach den Stand des Servers. Eine Ansicht mit itemChanged(id) laedt selbst nach
 * (die Startseite ihre Reihen, die Detailseite Folgen und "Abspielen"); in allen anderen werden die Karten dieses Eintrags an ihrem Platz neu gebaut.
 * Die Seiten bleiben stehen, wo sie sind (keine Platzhalter, kein Sprung an den Anfang).
 */
export function itemStateChanged(id) {
  const plain = [];
  for (const view of liveViews()) {
    if (typeof view.itemChanged === 'function') view.itemChanged(id);
    else if (view.el) plain.push(view.el);
  }
  return refreshCards(id, plain);
}

// ---------- Kontextmenue einer Karte ----------

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
const NO_MENU = new Set(['Folder', 'CollectionFolder', 'UserView', 'Playlist', 'Person']);

/**
 * Eintraege des Kontextmenues einer Karte (wie ItemActions der Apple-App): Abspielen bzw. Fortsetzen (Filme, Folgen, Serien), bei angefangenen Titeln
 * Von vorn und Aus "Weiterschauen" entfernen, dann Gesehen und Favorit. Ordner und Personen haben keines.
 */
export function itemMenuEntries(item) {
  if (!item?.Id || NO_MENU.has(item.Type)) return [];
  const u = item.UserData ?? {};
  const playable = PLAYABLE.has(item.Type);
  const resume = playable && (u.PlaybackPositionTicks ?? 0) > 0;
  const entries = [];
  if (playable || item.Type === 'Series') entries.push({ id: 'play', label: resume ? t('action.resume') : t('action.play'), icon: 'play' });
  if (resume) {
    entries.push({ id: 'restart', label: t('action.fromStart'), icon: 'refresh' });
    // Jellyfin kennt kein eigenes "Entfernen": als ungesehen markiert verliert der Eintrag seine gemerkte Stelle und faellt aus der Reihe
    entries.push({ id: 'removeContinue', label: t('menu.removeContinue'), icon: 'x' });
  }
  entries.push({ id: 'played', label: u.Played ? t('action.markUnwatched') : t('action.markWatched'), icon: u.Played ? 'circle' : 'check-circle' });
  entries.push({ id: 'favorite', label: u.IsFavorite ? t('action.unfavorite') : t('action.favorite'), icon: u.IsFavorite ? 'heart-off' : 'heart' });
  return entries;
}

const busyItems = new Set(); // Eintraege, deren Aenderung gerade laeuft: ein zweiter Klick zaehlt nicht

async function runItemAction(item, action) {
  if (action === 'play') return item.Type === 'Series' ? playSeries(item) : playItem({ itemId: item.Id, resume: true });
  if (action === 'restart') return playItem({ itemId: item.Id, resume: false, startTicks: 0 });
  if (busyItems.has(item.Id)) return;
  busyItems.add(item.Id);
  try {
    let ok = false;
    if (action === 'played') ok = await toggleWatched(item);
    else if (action === 'favorite') ok = await toggleFavorite(item);
    else if (action === 'removeContinue') {
      try {
        await api.setPlayed(item.Id, false);
        toast(t('toast.removedContinue'));
        ok = true;
      } catch (e) {
        toast(e.message, { type: 'error' });
      }
    }
    // Scheitert die Aenderung (kein Netz), bleibt alles, wie es war
    if (ok) await itemStateChanged(item.Id);
  } finally {
    busyItems.delete(item.Id);
  }
}

/** Oeffnet das Kontextmenue eines Eintrags; at: { x, y } am Mauszeiger, sonst unter anchor (dem Plakat). */
export function openItemMenu(item, anchor, { at = null } = {}) {
  const entries = itemMenuEntries(item);
  if (!entries.length) return null;
  return openMenu(anchor, entries, { at, columns: false, minWidth: 230, onPick: (e) => runItemAction(item, e.id) });
}

/**
 * Kontextmenue an einer Karte: Rechtsklick (am Mauszeiger, wie ein Menue des Systems), langes Druecken (Android, unter dem Plakat) und die Menue-Taste
 * bzw. Umschalt+F10 der Tastatur (unter dem Plakat). anchor: was sich hebt und woran das Menue haengt (Top 10: das Plakat, nicht die Ziffer).
 * getItem: der aktuelle Stand des Eintrags (Karten, die an ihrem Platz neu gebaut werden, tragen den neuen).
 */
export function attachItemMenu(el, getItem, { anchor = el } = {}) {
  el.addEventListener('contextmenu', (e) => {
    const item = getItem();
    if (!itemMenuEntries(item).length) return;
    e.preventDefault();
    e.stopPropagation();
    // Maus: am Zeiger. Finger (pointerType touch) und Tastatur (ohne Zeiger): unter dem Plakat
    const atPointer = e.pointerType === 'mouse' || e.pointerType === 'pen' || (e.pointerType === undefined && e.button === 2);
    openItemMenu(item, anchor, atPointer ? { at: { x: e.clientX, y: e.clientY } } : {});
  });
}
