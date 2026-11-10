import { t } from './i18n.js';
import { toast } from './ui.js';
import { api } from './api.js';
import { navigate } from './router.js';

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

export async function toggleWatched(item) {
  const next = !item.UserData?.Played;
  try {
    await api.setPlayed(item.Id, next);
    item.UserData = { ...(item.UserData ?? {}), Played: next, PlaybackPositionTicks: 0, PlayedPercentage: 0 };
    toast(next ? t('toast.markedWatched') : t('toast.markedUnwatched'));
    return next;
  } catch (e) {
    toast(e.message, { type: 'error' });
    return !next;
  }
}

export async function toggleFavorite(item) {
  const next = !item.UserData?.IsFavorite;
  try {
    await api.setFavorite(item.Id, next);
    item.UserData = { ...(item.UserData ?? {}), IsFavorite: next };
    toast(next ? t('toast.favAdded') : t('toast.favRemoved'));
    return next;
  } catch (e) {
    toast(e.message, { type: 'error' });
    return !next;
  }
}

/** Nutzt die naechste ungesehene Folge einer Serie (oder die erste Folge). */
export async function resolveSeriesTarget(seriesId) {
  const next = await api.getNextUp(1, seriesId).catch(() => []);
  if (next[0]) return { episode: next[0], resume: true };
  const seasons = await api.getSeasons(seriesId).catch(() => []);
  const first = seasons.find((s) => s.IndexNumber > 0) ?? seasons[0];
  const eps = first ? await api.getEpisodes(seriesId, first.Id).catch(() => []) : [];
  return { episode: eps[0] ?? null, resume: false };
}
