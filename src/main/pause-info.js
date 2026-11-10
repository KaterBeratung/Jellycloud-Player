'use strict';

/**
 * Angaben fuer den Pausenbildschirm des Players: Logo, Titel, Folge, Beschreibung, Bewertung.
 * Alles kommt aus dem Eintrag, den der Player ohnehin geladen hat; das Logo wird ueber das jellycloud://-Protokoll
 * der Oberflaeche geholt (Token bleibt im Hauptprozess). Bei Folgen kommt das Logo von der Serie.
 */

/** Logo-Adresse des Eintrags (bei Folgen das der Serie) oder null. */
function logoUrl(item) {
  const own = item.ImageTags?.Logo;
  const id = own ? item.Id : item.ParentLogoItemId && item.ParentLogoImageTag ? item.ParentLogoItemId : null;
  if (!id) return null;
  const q = new URLSearchParams({ maxWidth: '800', quality: '90' });
  const tag = own || item.ParentLogoImageTag;
  if (tag) q.set('tag', String(tag));
  return `jellycloud://img/${id}/Logo?${q}`;
}

/** Beschreibung als reiner Text: manche Server liefern <br> und andere Auszeichnungen mit. */
function plainText(s, max = 1200) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * @param {object} item Jellyfin-Eintrag (Film oder Folge)
 * @param {{spoilerProtection?: boolean}} [o] Spoiler-Schutz: die Beschreibung einer ungesehenen Folge bleibt weg
 */
function buildPauseInfo(item, { spoilerProtection = false } = {}) {
  const isEpisode = item.Type === 'Episode';
  const hideStory = spoilerProtection && isEpisode && !item.UserData?.Played;
  const score = Number(item.CommunityRating);
  return {
    logo: logoUrl(item),
    title: String((isEpisode ? item.SeriesName ?? item.Name : item.Name) ?? ''),
    isEpisode,
    season: isEpisode && Number.isFinite(item.ParentIndexNumber) ? item.ParentIndexNumber : null,
    episode: isEpisode && Number.isFinite(item.IndexNumber) ? item.IndexNumber : null,
    episodeName: isEpisode ? String(item.Name ?? '') : '',
    tagline: isEpisode ? '' : plainText(item.Taglines?.[0], 200),
    overview: hideStory ? '' : plainText(item.Overview),
    year: Number.isFinite(item.ProductionYear) ? item.ProductionYear : null,
    rating: String(item.OfficialRating ?? ''),
    score: Number.isFinite(score) && score > 0 ? +score.toFixed(1) : null,
    genres: (Array.isArray(item.Genres) ? item.Genres : []).filter((g) => typeof g === 'string' && g.trim()).slice(0, 3)
  };
}

module.exports = { buildPauseInfo, logoUrl, plainText };
