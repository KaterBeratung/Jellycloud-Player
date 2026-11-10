'use strict';

/**
 * Folgenliste fuer die Steuerung des Players (Knopf "Folgen": Staffeln und Folgen der laufenden Serie, wie bei Netflix).
 * Aus den Folgen, die der Server liefert (Reihenfolge wie dort: Staffel, Folge), wird nur das behalten, was die Liste braucht;
 * so bleibt der Zustand klein, der bei jedem Start einer Folge an die Oberflaeche geht, und es steht nichts darin, was sie nicht anzeigt.
 */

/** Mehr Folgen zeigt die Liste nicht (eine Serie mit mehr als 600 Folgen sprengt jede Anzeige; der Rest faellt weg, statt den Zustand aufzublaehen). */
const MAX_EPISODES = 600;

const sec = (ticks) => {
  const n = Number(ticks) / 1e7;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * @param {object[]} eps Folgen laut Server (Items von /Shows/<Id>/Episodes mit UserData)
 * @param {{spoilerProtection?: boolean}} [o] Spoiler-Schutz: Bild ungesehener Folgen verwischen (`spoiler`), wie auf der Detailseite
 * @returns {{id: string, season: number|null, seasonName: string, index: number|null, name: string, runSec: number, posSec: number, played: boolean, tag: string|null, spoiler: boolean}[]}
 */
function buildEpisodeList(eps, { spoilerProtection = false } = {}) {
  const out = [];
  for (const e of Array.isArray(eps) ? eps : []) {
    if (out.length >= MAX_EPISODES) break;
    if (!e || typeof e.Id !== 'string' || !e.Id) continue;
    const u = e.UserData ?? {};
    const played = !!u.Played;
    const posSec = sec(u.PlaybackPositionTicks);
    out.push({
      id: e.Id,
      season: Number.isFinite(e.ParentIndexNumber) ? e.ParentIndexNumber : null,
      seasonName: typeof e.SeasonName === 'string' ? e.SeasonName.slice(0, 60) : '',
      index: Number.isFinite(e.IndexNumber) ? e.IndexNumber : null,
      name: String(e.Name ?? '').slice(0, 140),
      runSec: sec(e.RunTimeTicks),
      posSec,
      played,
      tag: typeof e.ImageTags?.Primary === 'string' ? e.ImageTags.Primary : null,
      spoiler: !!spoilerProtection && !played && posSec === 0
    });
  }
  return out;
}

/** Die Folge nach `id` in der Liste (die naechste der Serie, auch ueber die Staffelgrenze) oder null. */
function nextEpisode(eps, id) {
  const list = Array.isArray(eps) ? eps : [];
  const i = list.findIndex((e) => e?.Id === id);
  return i >= 0 ? list[i + 1] ?? null : null;
}

module.exports = { buildEpisodeList, nextEpisode, MAX_EPISODES };
