/* Gemeinsames Modul: der Informationsblock am Ende der Detailseite der Mediathek (Allgemein, Sprachen, Datei mit der Wiedergabe), immer offen und kurz
   gehalten wie in der Apple-TV-App; er ersetzt die aufklappbaren "Technischen Details". Dazu die Namen von Ton- und Untertitelspuren und die Groesse
   einer Datei. Laeuft als CommonJS (Tests) und als klassisches Skript (window.JCDetailFacts). Vorlage: DetailView+Information.swift und TrackLabel
   (Design/Format.swift) der Apple-App (Build 92). Sprache: 'de' (Standard) oder 'en'. Gegenstueck fuer Seerr-Titel: seerr-facts.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./format'), require('./media'), require('./media-tags'));
  else root.JCDetailFacts = factory(root.JCFormat, root.JCMedia, root.JCMediaTags);
})(typeof self !== 'undefined' ? self : this, function (Format, Media, Tags) {
  'use strict';

  const WORDS = {
    de: {
      general: 'Allgemein', languages: 'Sprachen', file: 'Datei',
      genre: 'Genre', released: 'Erschienen', runtime: 'Laufzeit', certification: 'Freigabe', studio: 'Studio',
      audio: 'Ton', subtitles: 'Untertitel', version: 'Version', video: 'Video', container: 'Datei', playback: 'Wiedergabe',
      pending: 'Wird ermittelt …', failed: 'Nicht ermittelt', mono: 'Mono', stereo: 'Stereo', channels: 'Kanäle'
    },
    en: {
      general: 'General', languages: 'Languages', file: 'File',
      genre: 'Genre', released: 'Released', runtime: 'Runtime', certification: 'Rating', studio: 'Studio',
      audio: 'Audio', subtitles: 'Subtitles', version: 'Version', video: 'Video', container: 'File', playback: 'Playback',
      pending: 'Checking …', failed: 'Unknown', mono: 'Mono', stereo: 'Stereo', channels: 'channels'
    }
  };
  const langOf = (lang) => (String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de');
  const localeOf = (lang) => (langOf(lang) === 'en' ? 'en-US' : 'de-DE');
  const PLAYABLE = ['Movie', 'Episode', 'Video', 'MusicVideo'];

  /** Ausgeschriebene Sprache einer Spur ("Deutsch"), null ohne oder mit unbekannter Angabe. */
  function trackLanguage(stream, lang) {
    const code = Media.langCode(stream && stream.Language);
    if (!code || code === 'und') return null;
    try {
      const name = new Intl.DisplayNames([localeOf(lang)], { type: 'language' }).of(code);
      return name && name.toLowerCase() !== code ? name : null;
    } catch {
      return null;
    }
  }

  /** Der Titel einer Spur, wenn er etwas sagt: keine Namen von Programmen, die ihn beim Erzeugen der Datei eingetragen haben ("SoundHandler", "GPAC ISO Audio Handler"). */
  function usefulTitle(stream) {
    const title = String((stream && stream.Title) || '').trim();
    if (!title) return null;
    return /handler|gpac|mainconcept|lavf|mediainfo/i.test(title) ? null : title;
  }

  /**
   * Hauptzeile einer Spur: die Sprache, sonst ihr Titel, sonst "Ton 1" bzw. "Untertitel 1" (gezaehlt unter tracks, den Spuren dieser Art; nicht die
   * Nummer des Stroms in der Datei).
   */
  function trackName(stream, type, tracks, lang) {
    const lg = trackLanguage(stream, lang);
    if (lg) return lg;
    const title = usefulTitle(stream);
    if (title) return title;
    const w = WORDS[langOf(lang)];
    const kind = type === 'Subtitle' ? w.subtitles : w.audio;
    const i = (Array.isArray(tracks) ? tracks : []).findIndex((t) => t && stream && t.Index === stream.Index);
    return `${kind} ${i >= 0 ? i + 1 : (stream && stream.Index) ?? 1}`;
  }

  /** Format und Kanaele einer Tonspur ("Dolby TrueHD", "7.1"). */
  function audioDetails(stream, lang) {
    const w = WORDS[langOf(lang)];
    const out = [];
    const name = Media.audioLabel(stream) && Media.audioLabel(stream).name;
    if (name) out.push(name);
    const n = Number(stream && stream.Channels);
    if (n > 0) out.push(n === 1 ? w.mono : n === 2 ? w.stereo : n === 6 ? '5.1' : n === 8 ? '7.1' : `${n} ${w.channels}`);
    return out;
  }

  /** Groesse einer Datei in der Einheit, die auch der Explorer zeigt (1 GB = 1024 MB), mit dem Dezimalzeichen der Sprache; null ohne Angabe. */
  function size(bytes, lang) {
    const b = Number(bytes);
    if (!Number.isFinite(b) || b <= 0) return null;
    const fmt = (v, digits) => new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    const gb = b / 1024 ** 3;
    if (gb >= 1) return `${fmt(gb, gb >= 10 ? 1 : 2)} GB`;
    const mb = b / 1024 ** 2;
    return mb >= 1 ? `${fmt(Math.round(mb), 0)} MB` : `${fmt(Math.max(1, Math.round(b / 1024)), 0)} KB`;
  }

  /** Name des Containers: Jellyfin nennt fuer MP4 eine Liste ("mov,mp4,m4a,3gp,3g2,mj2"); daraus "MP4". */
  function containerName(raw) {
    const parts = String(raw || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    if (parts.includes('mp4')) return 'MP4';
    if (parts.includes('mkv') || parts.includes('matroska')) return 'MKV';
    return parts[0].toUpperCase();
  }

  /** Ein Tag ohne Uhrzeit aus einer Angabe von Jellyfin ("2021-03-12T00:00:00Z") in der Schreibweise der Sprache; mittags, damit das Datum in jeder Zeitzone stimmt. */
  function day(text, lang) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }

  /**
   * Die Gruppen des Informationsblocks; leere Zeilen und Gruppen entfallen. Bewusst ohne Datenrate, Farbtiefe, Bildrate und Pixelmasse.
   * - Allgemein: Genre (hoechstens drei), Erschienen (Datum, sonst Jahr), Laufzeit, Freigabe, Studio.
   * - Sprachen: je Tonspur eine Zeile (Sprache, Format, Kanaele); die Untertitel als Sprachen, jede einmal.
   * - Datei (die gewaehlte Version): Version (nur bei mehreren), Video, Datei (Container, Groesse) und bei Filmen und Folgen die Wiedergabe. Die Zeile
   *   "Wiedergabe" steht von Anfang an da ("Wird ermittelt …"), damit das Feld beim Eintreffen der Antwort nicht waechst.
   * @param {object} item Eintrag von Jellyfin (getItem)
   * @param {{source?: object|null, playback?: {method?: string|null, failed?: boolean}|null, lang?: string}} [o]
   * @returns {{title: string, rows: {label: string, value: string}[]}[]}
   */
  function informationGroups(item, o) {
    const opts = o || {};
    const lang = opts.lang;
    const w = WORDS[langOf(lang)];
    const it = item || {};
    const add = (list, label, value) => value && list.push({ label, value: String(value) });

    const general = [];
    add(general, w.genre, (Array.isArray(it.Genres) ? it.Genres : []).slice(0, 3).join(', '));
    add(general, w.released, day(it.PremiereDate, lang) || (it.ProductionYear ? String(it.ProductionYear) : null));
    add(general, w.runtime, Format.runtime(Number(it.RunTimeTicks) / 1e7, lang));
    add(general, w.certification, it.OfficialRating);
    add(general, w.studio, (Array.isArray(it.Studios) ? it.Studios : []).map((s) => s && s.Name).filter(Boolean).slice(0, 3).join(', '));

    const source = opts.source || null;
    const streams = (source && Array.isArray(source.MediaStreams) ? source.MediaStreams : []).filter(Boolean);
    const audio = streams.filter((s) => s.Type === 'Audio');
    const subs = streams.filter((s) => s.Type === 'Subtitle');
    const languages = [];
    add(languages, w.audio, audio.map((s) => [trackName(s, 'Audio', audio, lang), ...audioDetails(s, lang)].join(' · ')).join('\n'));
    add(languages, w.subtitles, [...new Set(subs.map((s) => trackName(s, 'Subtitle', subs, lang)))].join(', '));

    const file = [];
    if (source) {
      if ((Array.isArray(it.MediaSources) ? it.MediaSources.length : 0) > 1) add(file, w.version, source.Name);
      const m = Media.describeMedia(source);
      add(file, w.video, [m.videoCodec, m.resolution, m.hdrLabel].filter(Boolean).join(' · '));
      add(file, w.container, [containerName(source.Container), size(source.Size, lang)].filter(Boolean).join(' · '));
      if (PLAYABLE.includes(it.Type)) {
        const p = opts.playback || {};
        const tag = p.method ? Tags.playback(p.method) : null;
        add(file, w.playback, tag ? tag.text : p.failed ? w.failed : w.pending);
      }
    }

    return [
      { title: w.general, rows: general },
      { title: w.languages, rows: languages },
      { title: w.file, rows: file }
    ].filter((g) => g.rows.length);
  }

  return { trackLanguage, trackName, audioDetails, size, containerName, day, informationGroups };
});
