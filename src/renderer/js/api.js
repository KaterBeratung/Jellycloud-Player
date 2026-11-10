// Duenne Schicht ueber window.jc: alle Jellyfin-Aufrufe laufen im Hauptprozess (Token verlaesst ihn nie).
export const api = new Proxy(
  {},
  {
    get:
      (_t, method) =>
      (...args) =>
        window.jc.api(String(method), ...args)
  }
);

/**
 * Bilder werden als jellycloud://-Adressen genannt. Im Desktop-Programm holt sie ein Protokoll im Hauptprozess (mit Zugangsdaten und Bildspeicher),
 * in der Web-/Handy-Fassung macht window.jc.mapImage (src/web/jc-web.js) daraus die Adresse des Servers.
 */
export const mapImage = (url) => (window.jc.mapImage ? window.jc.mapImage(url) : url);

/** Bild-URL ueber das jellycloud://-Protokoll, das im Hauptprozess authentifiziert und cached. */
export function imgUrl(id, type, { w, h, tag, q = 88, idx } = {}) {
  const p = new URLSearchParams();
  if (w) p.set('maxWidth', Math.round(w));
  if (h) p.set('maxHeight', Math.round(h));
  if (tag) p.set('tag', tag);
  p.set('quality', q);
  return mapImage(`jellycloud://img/${id}/${type}${idx != null ? `/${idx}` : ''}?${p}`);
}

function hashOf(item, type, tag) {
  const m = item.ImageBlurHashes?.[type];
  if (!m) return null;
  return (tag && m[tag]) || Object.values(m)[0] || null;
}

export function posterOf(item, w = 360) {
  const tag = item.ImageTags?.Primary;
  if (tag) return { url: imgUrl(item.Id, 'Primary', { w, tag }), hash: hashOf(item, 'Primary', tag) };
  if (item.SeriesId && item.SeriesPrimaryImageTag) return { url: imgUrl(item.SeriesId, 'Primary', { w, tag: item.SeriesPrimaryImageTag }), hash: null };
  return null;
}

/** 16:9-Bild: bei Episoden zuerst der Screenshot, bei Filmen zuerst Thumb/Backdrop. */
export function landscapeOf(item, w = 640) {
  const tags = item.ImageTags ?? {};
  const candidates = {
    primary: () => tags.Primary && { url: imgUrl(item.Id, 'Primary', { w, tag: tags.Primary }), hash: hashOf(item, 'Primary', tags.Primary) },
    thumb: () => tags.Thumb && { url: imgUrl(item.Id, 'Thumb', { w, tag: tags.Thumb }), hash: hashOf(item, 'Thumb', tags.Thumb) },
    backdrop: () => item.BackdropImageTags?.[0] && { url: imgUrl(item.Id, 'Backdrop', { w, tag: item.BackdropImageTags[0] }), hash: hashOf(item, 'Backdrop', item.BackdropImageTags[0]) },
    parentBackdrop: () => item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0] && { url: imgUrl(item.ParentBackdropItemId, 'Backdrop', { w, tag: item.ParentBackdropImageTags[0] }), hash: hashOf(item, 'Backdrop', item.ParentBackdropImageTags[0]) },
    parentThumb: () => item.ParentThumbItemId && item.ParentThumbImageTag && { url: imgUrl(item.ParentThumbItemId, 'Thumb', { w, tag: item.ParentThumbImageTag }), hash: null }
  };
  const order = item.Type === 'Episode' ? ['primary', 'thumb', 'backdrop', 'parentBackdrop', 'parentThumb'] : ['thumb', 'backdrop', 'parentBackdrop', 'parentThumb', 'primary'];
  for (const k of order) {
    const r = candidates[k]();
    if (r) return r;
  }
  return null;
}

export function backdropOf(item, w = 1920) {
  const own = item.BackdropImageTags?.[0];
  if (own) return { url: imgUrl(item.Id, 'Backdrop', { w, tag: own, q: 82 }), hash: hashOf(item, 'Backdrop', own) };
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
    return { url: imgUrl(item.ParentBackdropItemId, 'Backdrop', { w, tag: item.ParentBackdropImageTags[0], q: 82 }), hash: hashOf(item, 'Backdrop', item.ParentBackdropImageTags[0]) };
  }
  return null;
}

export function logoOf(item, w = 640) {
  if (item.ImageTags?.Logo) return { url: imgUrl(item.Id, 'Logo', { w, tag: item.ImageTags.Logo, q: 90 }) };
  if (item.ParentLogoItemId && item.ParentLogoImageTag) return { url: imgUrl(item.ParentLogoItemId, 'Logo', { w, tag: item.ParentLogoImageTag, q: 90 }) };
  return null;
}

export function personImage(person, w = 240) {
  if (!person.PrimaryImageTag) return null;
  return { url: imgUrl(person.Id, 'Primary', { w, tag: person.PrimaryImageTag }) };
}

const FOLDER_TYPES = new Set(['Folder', 'CollectionFolder', 'BoxSet', 'UserView', 'Playlist']);
export const isFolder = (item) => FOLDER_TYPES.has(item.Type);

export function itemHref(item) {
  if (isFolder(item)) return `#/library/${item.Id}`;
  if (item.Type === 'Season') return `#/item/${item.SeriesId ?? item.Id}?season=${item.Id}`;
  return `#/item/${item.Id}`;
}
