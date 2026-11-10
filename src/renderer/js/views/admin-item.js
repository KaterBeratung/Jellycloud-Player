import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { toast, confirmDialog, openModal, titleOf } from '../ui.js';

/**
 * Verwalten eines Eintrags auf der Detailseite (nur fuer Administratoren; der Server prueft es auch): Metadaten bearbeiten, online identifizieren, vom Server loeschen.
 * Aenderungen laden die Ansicht danach neu (Ereignis reload-data).
 */

const reload = () => document.dispatchEvent(new CustomEvent('reload-data'));
const list = (text) => String(text ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Felder bearbeiten: Titel, Originaltitel, Slogan, Beschreibung, Jahr, Altersfreigabe, Genres, Tags. Gespeichert wird nur, was sich geaendert hat. */
export async function editMetadata(item) {
  let data;
  try {
    data = await api.getItemForEdit(item.Id);
  } catch (e) {
    toast(e?.message ?? String(e), { type: 'error' });
    return;
  }
  const input = (value, attrs = {}) => h('input', { class: 'field', type: 'text', value: value ?? '', autocomplete: 'off', spellcheck: 'false', ...attrs });
  const f = {
    Name: input(data.Name, { maxlength: 300 }),
    OriginalTitle: input(data.OriginalTitle, { maxlength: 300 }),
    Tagline: input(data.Taglines?.[0] ?? '', { maxlength: 300 }),
    Overview: h('textarea', { class: 'field', rows: 6, maxlength: 10000, spellcheck: 'true' }, data.Overview ?? ''),
    ProductionYear: input(data.ProductionYear ?? '', { type: 'number', min: 1800, max: 2200, inputmode: 'numeric' }),
    OfficialRating: input(data.OfficialRating, { maxlength: 40 }),
    Genres: input((data.Genres ?? []).join(', ')),
    Tags: input((data.Tags ?? []).join(', '))
  };
  const field = (key, label) => h('label', { class: 'mdl-field' }, h('span', null, label), f[key]);
  const err = h('p', { class: 'mdl-error', hidden: true });
  const save = async (close) => {
    err.hidden = true;
    const patch = {};
    if (f.Name.value.trim() !== data.Name) patch.Name = f.Name.value;
    if (f.OriginalTitle.value.trim() !== data.OriginalTitle) patch.OriginalTitle = f.OriginalTitle.value;
    const oldTagline = data.Taglines?.[0] ?? '';
    if (f.Tagline.value.trim() !== oldTagline) patch.Taglines = f.Tagline.value.trim() ? [f.Tagline.value, ...(data.Taglines ?? []).slice(1)] : (data.Taglines ?? []).slice(1);
    if (f.Overview.value.trim() !== (data.Overview ?? '').trim()) patch.Overview = f.Overview.value;
    const year = f.ProductionYear.value.trim() === '' ? null : Number(f.ProductionYear.value);
    if (year !== (data.ProductionYear ?? null)) patch.ProductionYear = year;
    if (f.OfficialRating.value.trim() !== data.OfficialRating) patch.OfficialRating = f.OfficialRating.value;
    if (!same(list(f.Genres.value), data.Genres ?? [])) patch.Genres = list(f.Genres.value);
    if (!same(list(f.Tags.value), data.Tags ?? [])) patch.Tags = list(f.Tags.value);
    if (!Object.keys(patch).length) {
      close();
      toast(t('admin.edit.none'));
      return;
    }
    try {
      await api.updateItem(item.Id, patch);
      close();
      toast(t('admin.edit.saved'));
      reload();
    } catch (e) {
      err.textContent = e?.message ?? String(e);
      err.hidden = false;
    }
  };
  openModal({
    title: t('admin.edit.title'),
    wide: true,
    body: h(
      'div',
      { class: 'mdl-form' },
      field('Name', t('admin.f.name')),
      h('div', { class: 'mdl-two' }, field('OriginalTitle', t('admin.f.original')), field('ProductionYear', t('admin.f.year'))),
      field('Tagline', t('admin.f.tagline')),
      field('Overview', t('admin.f.overview')),
      h('div', { class: 'mdl-two' }, field('OfficialRating', t('admin.f.rating')), field('Genres', t('admin.f.genres'))),
      field('Tags', t('admin.f.tags')),
      err
    ),
    actions: [
      { label: t('action.cancel'), onclick: (close) => close() },
      { label: t('admin.edit.save'), primary: true, onclick: save }
    ]
  });
}

/** Online nach dem richtigen Treffer suchen und ihn uebernehmen (der Server ersetzt Metadaten und Bilder). Nur Filme und Serien. */
export function identifyItem(item) {
  const name = h('input', { class: 'field', type: 'text', value: item.Name ?? '', maxlength: 300, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('admin.f.name') });
  const year = h('input', { class: 'field year', type: 'number', min: 1800, max: 2200, value: item.ProductionYear ?? '', inputmode: 'numeric', 'aria-label': t('admin.f.year') });
  const go = h('button', { class: 'btn primary sm', type: 'button' }, icon('search', 16), h('span', null, t('admin.id.search')));
  const results = h('div', { class: 'mdl-results', 'aria-live': 'polite' });
  const err = h('p', { class: 'mdl-error', hidden: true });
  const dlg = openModal({
    title: t('admin.id.title'),
    wide: true,
    body: h('div', { class: 'mdl-form' }, h('p', { class: 'mdl-hint' }, t('admin.id.hint')), h('div', { class: 'mdl-search' }, name, year, go), err, results),
    actions: [{ label: t('action.cancel'), onclick: (close) => close() }]
  });
  const apply = async (r) => {
    const label = `${r.Name ?? '?'}${r.ProductionYear ? ` (${r.ProductionYear})` : ''}`;
    if (!(await confirmDialog({ title: t('admin.id.confirmTitle', { name: label }), text: t('admin.id.confirmText'), confirmLabel: t('admin.id.pick'), danger: true }))) return;
    try {
      await api.applyRemoteMatch(item.Id, r);
      dlg.close();
      toast(t('admin.id.done'));
      setTimeout(reload, 1500); // der Server uebernimmt im Hintergrund
    } catch (e) {
      toast(e?.message ?? String(e), { type: 'error' });
    }
  };
  const search = async () => {
    err.hidden = true;
    go.disabled = true;
    results.replaceChildren(h('p', { class: 'mdl-hint' }, t('admin.loading')));
    try {
      const found = await api.searchRemote(item.Id, item.Type, { name: name.value, year: year.value });
      results.replaceChildren(
        ...(found.length
          ? found.slice(0, 40).map((r) =>
              h(
                'button',
                { class: 'mdl-result', type: 'button', onclick: () => apply(r) },
                h('span', { class: 'n' }, r.Name ?? '?', r.ProductionYear ? h('em', null, ` (${r.ProductionYear})`) : null),
                h('span', { class: 'p' }, r.SearchProviderName ?? ''),
                r.Overview ? h('span', { class: 'o' }, r.Overview) : null
              )
            )
          : [h('p', { class: 'mdl-hint' }, t('admin.id.none'))])
      );
    } catch (e) {
      results.replaceChildren();
      err.textContent = e?.message ?? String(e);
      err.hidden = false;
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', search);
  for (const i of [name, year]) i.addEventListener('keydown', (e) => e.key === 'Enter' && search());
}

/** Eintrag mit Dateien vom Server loeschen (nach Rueckfrage). Danach geht es zur Startseite. */
export async function deleteItem(item) {
  const name = titleOf(item);
  const series = item.Type === 'Series' || item.Type === 'Season';
  const ok = await confirmDialog({
    title: t('admin.del.title', { name }),
    text: [t(series ? 'admin.del.textSeries' : 'admin.del.text')],
    confirmLabel: t('admin.del.confirm'),
    danger: true
  });
  if (!ok) return;
  try {
    await api.deleteItem(item.Id);
    toast(t('admin.del.done', { name }));
    location.hash = '#/home';
    reload();
  } catch (e) {
    toast(e?.message ?? String(e), { type: 'error' });
  }
}
