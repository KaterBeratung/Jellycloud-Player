import { h } from '../dom.js';
import { t, getLocale } from '../i18n.js';
import { openModal, toggle } from '../ui.js';

const SeerrState = window.JCSeerrState;

/**
 * Auswahl der Staffeln beim Anfragen einer Serie (wie SeasonChooser der Apple-App): schon vorhandene oder angefragte Staffeln stehen da, mit ihrem Stand,
 * sind aber nicht waehlbar; vorausgewaehlt sind alle noch offenen. Die Schalter der Einstellungen (feste gruene Bahn). "Anfragen" ist gesperrt, solange
 * keine Staffel gewaehlt ist. Antwortet mit den gewaehlten Nummern (aufsteigend) oder null (abgebrochen, Escape, Klick daneben).
 * @param {{title:string, seasons:{number:number, name:string, episodes:number, status:number}[]}} o
 * @returns {Promise<number[]|null>}
 */
export function chooseSeasons({ title, seasons }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    const chosen = new Set(seasons.filter((s) => !SeerrState.isTaken(s.status)).map((s) => s.number));
    let modal = null;
    const paint = () => {
      if (modal) modal.buttons[1].disabled = chosen.size === 0;
    };
    const rows = seasons.map((s) => {
      const taken = SeerrState.isTaken(s.status);
      const episodes = s.episodes ? t(s.episodes === 1 ? 'seerr.season.oneEpisode' : 'seerr.season.episodes', { n: s.episodes }) : '';
      const detail = taken ? SeerrState.label(SeerrState.titleState(s.status) ?? 'unknown', getLocale()) || episodes : episodes;
      const sw = toggle(taken || chosen.has(s.number), (on) => {
        if (on) chosen.add(s.number);
        else chosen.delete(s.number);
        paint();
      }, s.name);
      sw.disabled = taken;
      return h('div', { class: `setting season-pick${taken ? ' taken' : ''}` }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, s.name), detail ? h('div', { class: 'setting-desc' }, detail) : null), h('div', { class: 'setting-control' }, sw));
    });
    const body = h('div', { class: 'season-chooser' }, h('p', { class: 'season-chooser-sub' }, title), h('div', { class: 'settings-group' }, rows), h('p', { class: 'group-foot' }, t('seerr.season.note')));
    modal = openModal({
      title: t('seerr.season.title'),
      body,
      onCancel: () => answer(null),
      actions: [
        { label: t('action.cancel'), variant: 'glass', onclick: (close) => (close(), answer(null)) },
        { label: t('seerr.season.request'), variant: 'primary', onclick: (close) => {
          if (!chosen.size) return;
          close();
          answer([...chosen].sort((a, b) => a - b));
        } }
      ]
    });
    paint();
    // Fokus auf die erste offene Staffel, nicht auf "Anfragen": ein zweiter schneller Druck auf "Serie anfragen" fragt so nicht gleich alle Staffeln an
    requestAnimationFrame(() => requestAnimationFrame(() => body.querySelector('.switch:not(:disabled)')?.focus()));
  });
}
