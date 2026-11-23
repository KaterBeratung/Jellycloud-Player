// Einstellungen > Erscheinungsbild > Ambient Glow, in der Reihenfolge der Apple-App: Vorschau, Ein/Aus, Intensitaet, Farbverlauf; dann die
// Zeilen der gewaehlten Art (Verlauf: 14 vorgegebene und zwei eigene Farben; Einzelfarbe: sechs feste und eine eigene); dann die Bereiche
// (je Bereich "Allgemein", "Eigene" oder "Aus", bei "Eigene" dieselben Zeilen fuer den Bereich und "Bereich zuruecksetzen"); zuletzt
// "Ambient Glow zuruecksetzen" mit Rueckfrage. Gelesen und geaendert wird nur ueber src/shared/glow.js (resolve, set.*).
import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { confirmDialog, segmented, slider, toggle } from '../ui.js';
import { paintPreview, refreshGlow } from '../glow.js';

const Glow = window.JCGlow;
const css = (rgb) => `rgb(${rgb.join(' ')})`;

/**
 * Baut den Abschnitt. save(glow): speichert die ganze Einstellung (Einstellungen-Seite: saveSoon). Gibt { el } zurueck; der Abschnitt baut
 * sich nach jeder Aenderung selbst neu, ausser waehrend ein Regler gezogen wird (dann folgen nur Vorschau und Ebene).
 */
export function glowSection({ save, setting, group }) {
  const host = h('div', { class: 'glow-settings' });
  const now = () => Glow.normalize(state.settings.glow);
  const apply = (next, { rebuild = true } = {}) => {
    state.settings.glow = next;
    save(next);
    refreshGlow();
    document.dispatchEvent(new CustomEvent('glow-settings')); // Rangziffern der Top 10 nehmen die neue Farbe an (views/top-ten.js)
    if (rebuild) render();
  };

  /** Zeilen fuer Farbe, Verlauf und Intensitaet eines Ziels ('general' oder ein Bereich). */
  function colorRows(target) {
    const g = now();
    const f = Glow.fields(g, target);
    const rows = [];
    if (target !== 'general') {
      rows.push(setting(t('set.glowIntensity'), t('set.glowIntensityDesc'), intensitySlider(target, f.intensity)));
      rows.push(setting(t('set.glowGradient'), t('set.glowGradientDesc'), toggle(f.gradient, (v) => apply(Glow.set.gradient(now(), target, v)), t('set.glowGradient'))));
    }
    if (f.gradient) {
      const current = Glow.presetGradient(g, target)?.id ?? null;
      const grid = h('div', { class: 'swatches glow-swatches' });
      for (const p of Glow.GRADIENTS) {
        const b = h('button', { class: `swatch two${p.id === current ? ' on' : ''}`, type: 'button', 'data-glow-gradient': p.id, title: t(`glow.g.${p.id}`), 'aria-label': t(`glow.g.${p.id}`), 'aria-pressed': p.id === current });
        b.style.setProperty('--c', css(p.from));
        b.style.setProperty('--c2', css(p.to));
        b.addEventListener('click', () => apply(Glow.set.preset(now(), target, p.id)));
        grid.append(b);
      }
      rows.push(setting(t('set.glowGradients'), current ? t(`glow.g.${current}`) : t('set.glowCustomGradient'), grid, { wide: true }));
      rows.push(setting(t('set.glowFirst'), t('set.glowCustomDesc'), colorInput(f.firstHex, (v) => apply(Glow.set.firstHex(now(), target, v)))));
      rows.push(setting(t('set.glowSecond'), t('set.glowCustomDesc'), colorInput(f.secondHex, (v) => apply(Glow.set.secondHex(now(), target, v)))));
    } else {
      const current = Glow.presetColor(g, target);
      const grid = h('div', { class: 'swatches glow-swatches' });
      for (const id of Glow.COLOR_IDS) {
        const b = h('button', { class: `swatch${id === current ? ' on' : ''}`, type: 'button', 'data-glow-color': id, title: t(`glow.c.${id}`), 'aria-label': t(`glow.c.${id}`), 'aria-pressed': id === current });
        b.style.setProperty('--c', css(Glow.COLORS[id]));
        b.addEventListener('click', () => apply(Glow.set.color(now(), target, id)));
        grid.append(b);
      }
      rows.push(setting(t('set.glowColors'), current ? t(`glow.c.${current}`) : t('set.glowCustom'), grid, { wide: true }));
      rows.push(setting(t('set.glowCustom'), t('set.glowCustomDesc'), colorInput(f.customHex || Glow.hex(Glow.COLORS[f.color]), (v) => apply(Glow.set.customHex(now(), target, v)))));
    }
    return rows;
  }

  /** Farbwaehler als Farbfeld in der gewaehlten Farbe (wie das eigene Feld der Akzentfarbe); uebernimmt beim Loslassen (change). */
  function colorInput(value, onPick) {
    const input = h('input', { type: 'color', class: 'color-input glow-color', value, 'aria-label': t('set.glowCustom') });
    const pick = h('label', { class: 'swatch custom glow-pick', title: value.toUpperCase() }, input);
    pick.style.setProperty('--c', value);
    input.addEventListener('change', () => onPick(input.value));
    return pick;
  }

  /** Intensitaet: Vorschau und Ebene folgen sofort, gespeichert wird gebuendelt (saveSoon); der Abschnitt baut sich dabei nicht neu. */
  function intensitySlider(target, value) {
    return slider({ min: 0, max: 100, step: 1, value, format: (v) => `${v} %`, onInput: (v) => apply(Glow.set.intensity(now(), target, v), { rebuild: false }) });
  }

  function render() {
    const g = now();
    const general = Glow.fields(g, 'general');
    const preview = h('div', { class: 'glow-preview', 'aria-hidden': 'true' });
    paintPreview(preview, Glow.general(g));
    const generalSlider = slider({
      min: 0, max: 100, step: 1, value: general.intensity, format: (v) => `${v} %`,
      onInput: (v) => {
        apply(Glow.set.intensity(now(), 'general', v), { rebuild: false });
        paintPreview(preview, Glow.general(now()));
      }
    });

    const areaRows = Glow.SCOPES.map((scope) => {
      const a = Glow.area(g, scope);
      const value = !a.enabled ? 'off' : a.own ? 'own' : 'general';
      const choice = segmented(
        [
          { value: 'general', label: t('set.glowGeneral') },
          { value: 'own', label: t('set.glowOwn') },
          { value: 'off', label: t('set.glowOff') }
        ],
        value,
        (v) => {
          let next = Glow.set.areaEnabled(now(), scope, v !== 'off');
          if (v !== 'off') next = Glow.set.areaOwn(next, scope, v === 'own');
          apply(next);
        }
      );
      const row = setting(t(`glow.s.${scope}`), t(`glow.d.${scope}`), choice);
      row.dataset.glowScope = scope;
      if (!a.own || !a.enabled) return [row];
      const reset = h('button', { class: 'btn glass sm', type: 'button' }, icon('refresh', 15), h('span', null, t('set.glowAreaReset')));
      reset.addEventListener('click', () => apply(Glow.set.resetArea(now(), scope)));
      return [row, h('div', { class: 'glow-own', 'data-glow-own': scope }, ...colorRows(scope), setting('', '', reset))];
    }).flat();

    const resetAll = h('button', { class: 'btn glass sm', type: 'button', disabled: Glow.isStandard(g) }, icon('refresh', 15), h('span', null, t('set.glowReset')));
    resetAll.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: t('set.glowReset'), text: t('set.glowResetConfirm'), confirmLabel: t('set.glowReset') });
      if (ok) apply(Glow.set.reset());
    });

    host.replaceChildren(
      group(
        t('set.glow'),
        setting('', '', preview, { wide: true }),
        setting(t('set.glow'), t('set.glowDesc'), toggle(g.enabled, (v) => apply(Glow.set.enabled(now(), v)), t('set.glow'))),
        setting(t('set.glowIntensity'), t('set.glowIntensityDesc'), generalSlider),
        setting(t('set.glowGradient'), t('set.glowGradientDesc'), toggle(general.gradient, (v) => apply(Glow.set.gradient(now(), 'general', v)), t('set.glowGradient')))
      ),
      group(general.gradient ? t('set.glowGradients') : t('set.glowColors'), ...colorRows('general')),
      group(t('set.glowAreas'), ...areaRows),
      group(null, setting(t('set.glowReset'), t('set.glowResetDesc'), resetAll))
    );
  }

  render();
  return { el: host };
}
