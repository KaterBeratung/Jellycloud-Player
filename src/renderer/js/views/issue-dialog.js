import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { openModal, toast, titleOf } from '../ui.js';

// Arten eines Problems (Zahlen wie bei Seerr: IssueType) mit Symbol und Textschluessel
const TYPES = [
  { id: 1, key: 'video', icon: 'monitor' },
  { id: 2, key: 'audio', icon: 'audio' },
  { id: 3, key: 'subtitles', icon: 'subtitles' },
  { id: 4, key: 'other', icon: 'info' }
];

const tmdbOf = (item) => {
  const ids = item?.ProviderIds ?? {};
  const k = Object.keys(ids).find((x) => x.toLowerCase() === 'tmdb');
  const n = Number(k ? ids[k] : NaN);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Kann zu diesem Eintrag ein Problem an Seerr gemeldet werden? Seerr muss verbunden sein; Filme und Serien brauchen ihre TMDB-Nummer, Staffeln und Folgen die der Serie.
 * (Die Nummer der Serie wird erst beim Oeffnen des Fensters geholt, hier genuegt der Verweis auf die Serie.)
 */
export function canReportIssue(item) {
  if (!state.seerr || !item) return false;
  if (item.Type === 'Movie' || item.Type === 'Series') return !!tmdbOf(item);
  if (item.Type === 'Season' || item.Type === 'Episode') return !!item.SeriesId;
  return false;
}

/** Wohin die Meldung bei Seerr gehoert: Art (Film oder Serie), TMDB-Nummer, Staffel und Folge (0 = alle). */
async function issueTarget(item) {
  if (item.Type === 'Movie') return { mediaType: 'movie', tmdbId: tmdbOf(item), season: 0, episode: 0 };
  if (item.Type === 'Series') return { mediaType: 'tv', tmdbId: tmdbOf(item), season: 0, episode: 0 };
  const series = await api.getItem(item.SeriesId);
  return {
    mediaType: 'tv',
    tmdbId: tmdbOf(series),
    season: item.Type === 'Season' ? item.IndexNumber ?? 0 : item.ParentIndexNumber ?? 0,
    episode: item.Type === 'Episode' ? item.IndexNumber ?? 0 : 0
  };
}

/** Wie der Eintrag in der Ueberschrift des Fensters steht: Titel, bei Folgen mit Staffel und Folge. */
function describe(item, target) {
  const name = item.Type === 'Episode' || item.Type === 'Season' ? item.SeriesName ?? titleOf(item) : titleOf(item);
  if (target.mediaType !== 'tv' || !target.season) return name;
  return `${name} · ${target.episode ? t('issue.seasonEpisode', { s: target.season, e: target.episode }) : t('issue.season', { s: target.season })}`;
}

/**
 * Fenster "Problem melden": Art des Problems waehlen (Video, Audio, Untertitel, Sonstiges), optional einen Kommentar schreiben, an Seerr senden.
 * Fehler (kein Recht, Titel Seerr unbekannt, Seerr nicht erreichbar) erscheinen im Fenster, es bleibt offen und der Text geht nicht verloren.
 */
export async function openIssueDialog(item) {
  let target;
  try {
    target = await issueTarget(item);
  } catch (e) {
    return toast(e.message, { type: 'error' });
  }
  if (!target.tmdbId) return toast(t('issue.noTmdb'), { type: 'error' });

  let chosen = 0;
  let gone = false; // Fenster schon geschlossen (Abbrechen, Esc, Klick daneben), waehrend die Meldung noch unterwegs ist
  const err = h('p', { class: 'mdl-error', hidden: true });
  const chips = TYPES.map((ty) => {
    const b = h('button', { class: 'issue-type', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-type': ty.key }, icon(ty.icon, 22), h('span', null, t(`issue.type.${ty.key}`)));
    b.addEventListener('click', () => {
      chosen = ty.id;
      chips.forEach((c) => {
        const on = c === b;
        c.classList.toggle('on', on);
        c.setAttribute('aria-checked', String(on));
      });
      send.disabled = false;
      err.hidden = true;
    });
    return b;
  });
  const comment = h('textarea', { class: 'field issue-comment', rows: 4, maxlength: 2000, placeholder: t('issue.commentPlaceholder'), 'aria-label': t('issue.comment') });
  const body = h(
    'div',
    { class: 'mdl-form issue-form' },
    h('p', { class: 'mdl-hint' }, t('issue.intro')),
    h('div', { class: 'issue-types', role: 'radiogroup', 'aria-label': t('issue.title') }, chips),
    h('label', { class: 'mdl-field' }, h('span', null, t('issue.comment')), comment),
    err
  );
  const modal = openModal({
    title: `${t('issue.title')}: ${describe(item, target)}`,
    body,
    onCancel: () => (gone = true),
    actions: [
      {
        label: t('action.cancel'),
        onclick: (close) => {
          gone = true;
          close();
        }
      },
      {
        label: t('issue.send'),
        primary: true,
        disabled: true,
        onclick: async (close) => {
          if (!chosen) return;
          send.disabled = true;
          err.hidden = true;
          const typeLabel = t(`issue.type.${TYPES.find((x) => x.id === chosen).key}`);
          try {
            await window.jc.seerrIssue({ ...target, issueType: chosen, message: comment.value.trim(), fallbackMessage: t('issue.fallback', { type: typeLabel }) });
            close();
            toast(t('issue.sent'));
          } catch (e) {
            const message = e.code === 'SEERR_AUTH' ? t('seerr.authExpired') : e.message;
            // Hat man das Fenster inzwischen geschlossen, wuerde der Fehler im unsichtbaren Fenster stehen: dann als Hinweis zeigen
            if (gone) return toast(message, { type: 'error' });
            err.textContent = message;
            err.hidden = false;
            send.disabled = false;
          }
        }
      }
    ]
  });
  const send = modal.buttons[1];
  return modal;
}
