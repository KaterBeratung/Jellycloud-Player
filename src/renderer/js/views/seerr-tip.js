// Hinweis "Seerr verbinden" auf der Startseite (wie SeerrConnectTip der Apple-App, Build 94): eine Glaskarte unter der Kopfleiste, je Profil
// einmal und nur, solange fuer das Profil kein Seerr eingerichtet ist. "Verbinden" fuehrt zur Seite Einstellungen > Anfragen (Seerr), wo der Weg
// ohne Passwort oben steht; das Schliessen merkt sich der Hinweis auf diesem Geraet (je Profil). Nie ueber der Startanimation oder dem Player
// (die Startseite ist dann nicht vorne).
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { store } from '../utils.js';
import { navigate } from '../router.js';

const keyOf = (profile) => `tip:seerrConnect:${profile}`;

/** Die Karte fuer die Startseite, oder null, wenn sie nicht (mehr) zu zeigen ist. */
export function seerrConnectTip() {
  const profile = state.activeServerId;
  if (!profile || state.seerr || store.get(keyOf(profile), false)) return null;
  const done = () => store.set(keyOf(profile), true);
  const close = h('button', { class: 'seerr-tip-close', type: 'button', 'aria-label': t('action.close'), title: t('action.close') }, icon('x', 16));
  const go = h('button', { class: 'btn primary sm', type: 'button', 'data-action': 'seerr-tip-connect' }, t('seerr.tip.connect'));
  const el = h(
    'aside',
    { class: 'seerr-tip', role: 'note', 'aria-label': t('seerr.tip.title') },
    h('span', { class: 'seerr-tip-icon', 'aria-hidden': 'true' }, icon('sparkle', 20)),
    h('div', { class: 'seerr-tip-text' }, h('strong', null, t('seerr.tip.title')), h('span', null, t('seerr.tip.text')), go),
    close
  );
  const remove = () => {
    el.classList.add('out');
    el.inert = true;
    setTimeout(() => el.remove(), 220);
  };
  close.addEventListener('click', () => {
    done();
    remove();
  });
  go.addEventListener('click', () => {
    done();
    remove();
    navigate('/settings/seerr');
  });
  // Seerr anderswo verbunden (oder Profil gewechselt): der Hinweis geht ohne Zutun
  const onSeerr = () => {
    if (state.seerr || state.activeServerId !== profile) {
      document.removeEventListener('seerr-changed', onSeerr);
      remove();
    }
  };
  document.addEventListener('seerr-changed', onSeerr);
  return el;
}
