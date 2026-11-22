import { api } from './api.js';
import { navigate } from './router.js';

const SeerrState = window.JCSeerrState;

/**
 * Einen Seerr-Titel oeffnen, an allen Stellen gleich (wie SeerrTitleOpening der Apple-App): liegt er in der Mediathek (Abgleich ueber die TMDB-Nummer, nie ueber
 * den Titel), seine Detailseite dort, zum Abspielen; sonst seine Seite bei Seerr (#/seerr/<art>/<nummer>, im Verlauf wie jede Seite). Ein Oeffnen zur Zeit:
 * wer eine andere Karte antippt, bevor die erste Seite da ist, bekommt nur die zweite; ist man inzwischen woanders, bleibt es ohne Wirkung.
 * Was die Karte schon weiss (Titel, Bild, Stand), nimmt die Seite mit und zeigt es sofort (known).
 */
const knownTitles = new Map(); // "movie-603" -> Suchergebnis
let opening = 0;

/** Was eine Karte ueber den Titel weiss, fuer die Seite, die gleich aufgeht (sie liest es einmal). */
export const takeKnownTitle = (mediaType, tmdbId) => {
  const k = `${mediaType}-${tmdbId}`;
  const v = knownTitles.get(k) ?? null;
  knownTitles.delete(k);
  return v;
};

/**
 * @param {{mediaType:'movie'|'tv', tmdbId:number, known?:object|null, checkLibrary?:boolean}} o checkLibrary: zuerst in der Mediathek nachsehen (Standard: nur,
 *   wenn der Titel laut Seerr ganz oder teilweise da ist; ohne bekannten Stand immer)
 */
export async function openSeerrTitle({ mediaType, tmdbId, known = null, checkLibrary }) {
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isInteger(+tmdbId) || +tmdbId <= 0) return;
  const mine = ++opening;
  const from = location.hash;
  const lookUp = checkLibrary ?? (known ? SeerrState.isPresent(known.status) : true);
  if (lookUp) {
    const res = await api.getItems({ anyProviderIdEquals: `tmdb.${Number(tmdbId)}`, includeItemTypes: mediaType === 'movie' ? 'Movie' : 'Series', recursive: true, limit: 1 }).catch(() => null);
    if (mine !== opening || location.hash !== from) return; // ueberholt oder inzwischen woanders
    const item = res?.Items?.[0];
    if (item) return navigate(`/item/${item.Id}`);
  }
  if (known) knownTitles.set(`${mediaType}-${Number(tmdbId)}`, known);
  navigate(`/seerr/${mediaType}/${Number(tmdbId)}`);
}
