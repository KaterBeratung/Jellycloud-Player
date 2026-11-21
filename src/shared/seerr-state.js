/* Gemeinsames Modul: Staende bei Seerr. Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCSeerrState) in der
   Oberflaeche und in der Web-/Handy-Fassung. Ohne Abhaengigkeiten. Vorlage: Jellycloud/Core/SeerrMediaState.swift und SeerrRequests.swift
   der Apple-App (Build 92/93).

   Die eine Stelle, die bestimmt, welchen Stand die Oberflaeche zu einem Titel oder einer Anfrage zeigt und wie er heisst. Gezeichnet wird
   er als Tag (Farbe aus der Art, src/shared/media-tags.js `seerr`); keine Ansicht waehlt Text oder Farbe selbst. In der Apple-App standen
   vorher zwei Zuordnungen nebeneinander: "In Bearbeitung" war im Reiter Anfragen blau und auf der Seite des Titels orange. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCSeerrState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Stand eines Titels bei Seerr (mediaInfo.status), Werte nach server/constants/media.ts von Seerr 3.5.1. 0 steht fuer einen Titel, den
   * Seerr noch nicht fuehrt (keine mediaInfo). Bis 1.1.6 hielt die App 6 fuer "geloescht": ein gesperrter Titel liess sich so anfragen,
   * ein geloeschter nicht.
   */
  const SEERR_MEDIA = Object.freeze({
    NONE: 0,
    UNKNOWN: 1,
    PENDING: 2,
    PROCESSING: 3,
    PARTIALLY_AVAILABLE: 4,
    AVAILABLE: 5,
    /** Gesperrt: Seerr nimmt fuer diesen Titel keine Anfragen an. */
    BLOCKLISTED: 6,
    /** War vorhanden und ist aus der Mediathek entfernt: laesst sich wieder anfragen. */
    DELETED: 7
  });

  /** Stand einer Anfrage (MediaRequestStatus von Seerr). */
  const SEERR_REQUEST = Object.freeze({ PENDING: 1, APPROVED: 2, DECLINED: 3, FAILED: 4, COMPLETED: 5 });

  /**
   * Die Staende, die die Oberflaeche zeigt: genau eine Bezeichnung und genau eine Art (und damit Farbe) je Stand, an jeder Stelle.
   * requested: wartet auf die Genehmigung; approved: genehmigt, Seerr meldet die Beschaffung noch nicht; processing: wird beschafft;
   * failed: Seerr konnte die genehmigte Anfrage nicht weitergeben.
   */
  const STATES = Object.freeze(['requested', 'approved', 'processing', 'partiallyAvailable', 'available', 'declined', 'failed']);

  /** Art des Tags je Stand (Farbe in media-tags.js): keine eigene Palette, die Farbpaare der Wiedergabe-Tags nach ihrer Bedeutung. */
  const TAG_KIND = Object.freeze({
    requested: 'seerrRequested',
    approved: 'seerrApproved',
    processing: 'seerrProcessing',
    partiallyAvailable: 'seerrPartial',
    available: 'seerrAvailable',
    declined: 'seerrDeclined',
    failed: 'seerrFailed'
  });

  /** Bezeichnungen (DE, EN). short: schmale Plakate, damit Tags nie abgeschnitten werden. completed/unknown: neutrale Tags ohne Stand. */
  const LABELS = {
    de: { requested: 'Angefragt', approved: 'Genehmigt', processing: 'In Bearbeitung', partiallyAvailable: 'Teilweise verfügbar', available: 'Verfügbar', declined: 'Abgelehnt', failed: 'Fehlgeschlagen', completed: 'Abgeschlossen', unknown: 'Unbekannt' },
    en: { requested: 'Requested', approved: 'Approved', processing: 'Processing', partiallyAvailable: 'Partially available', available: 'Available', declined: 'Declined', failed: 'Failed', completed: 'Completed', unknown: 'Unknown' }
  };
  const SHORT = { de: { partiallyAvailable: 'Teilweise' }, en: { partiallyAvailable: 'Partial' } };
  const langOf = (lang) => (String(lang || '').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'de');
  /** Bezeichnung eines Stands (oder von completed/unknown) in der Sprache der Oberflaeche. */
  const label = (state, lang) => LABELS[langOf(lang)][state] || '';
  /** Kurzform fuer schmale Plakate (sonst die Bezeichnung). */
  const shortLabel = (state, lang) => SHORT[langOf(lang)][state] || label(state, lang);

  const asStatus = (s) => (Number.isInteger(Number(s)) ? Number(s) : NaN);
  const media = (s) => (s == null ? 0 : asStatus(s));
  /** Ein Anfragestand, den die App kennt (1 bis 5), sonst null. */
  const asRequest = (s) => {
    const n = asStatus(s);
    return n >= SEERR_REQUEST.PENDING && n <= SEERR_REQUEST.COMPLETED ? n : null;
  };

  /**
   * Laesst sich der Titel (noch oder wieder) anfragen? Nur ohne Stand (0, 1) und nach dem Loeschen (7); nie bei gesperrten Titeln und
   * nie bei einem Wert, den die App nicht kennt (dann entscheidet niemand fuer Seerr). Fehlender Stand (null, undefined) gilt als 0.
   */
  function isRequestable(status) {
    const s = media(status);
    return s === SEERR_MEDIA.NONE || s === SEERR_MEDIA.UNKNOWN || s === SEERR_MEDIA.DELETED;
  }

  /** Ganz oder teilweise in der Mediathek. */
  function isPresent(status) {
    const s = asStatus(status);
    return s === SEERR_MEDIA.AVAILABLE || s === SEERR_MEDIA.PARTIALLY_AVAILABLE;
  }

  /** Schon da oder schon angefragt (2 bis 5): nicht noch einmal anfragen. */
  function isTaken(status) {
    const s = asStatus(status);
    return s >= SEERR_MEDIA.PENDING && s <= SEERR_MEDIA.AVAILABLE;
  }

  /** Gesperrt: erscheint nicht in Trends und bietet nie "Anfragen" an. */
  function isBlocklisted(status) {
    return asStatus(status) === SEERR_MEDIA.BLOCKLISTED;
  }

  /**
   * Stand einer Anfrage aus ihrem Stand und dem Stand des Titels. Ist der Titel da, "verfuegbar" (kein zweiter Stand mit derselben
   * Aussage); sonst der Stand der Anfrage, bei einer genehmigten der Fortschritt des Titels. null: kein Stand, den die App kennt
   * (unbekannter Wert), oder eine erledigte Anfrage, deren Titel nicht mehr da ist.
   */
  function requestState(status, mediaStatus) {
    const m = media(mediaStatus);
    if (m === SEERR_MEDIA.AVAILABLE) return 'available';
    switch (asRequest(status)) {
      case SEERR_REQUEST.PENDING:
        return 'requested';
      case SEERR_REQUEST.DECLINED:
        return 'declined';
      case SEERR_REQUEST.FAILED:
        return 'failed';
      case SEERR_REQUEST.APPROVED:
        if (m === SEERR_MEDIA.PARTIALLY_AVAILABLE) return 'partiallyAvailable';
        return m === SEERR_MEDIA.PROCESSING ? 'processing' : 'approved';
      case SEERR_REQUEST.COMPLETED:
        return m === SEERR_MEDIA.PARTIALLY_AVAILABLE ? 'partiallyAvailable' : null;
      default:
        return null;
    }
  }

  /**
   * Stand einer Anfrage, wie Plakat und Mitteilung ihn zeigen. r: { status, mediaStatus, mediaType, seasons: [Nummern], readySeasons }.
   * Bei einer Anfrage fuer Staffeln zaehlen die angefragten Staffeln, nicht der Stand der ganzen Serie: Seerr schliesst die Anfrage ab,
   * sobald ihre Staffeln da sind, und laesst die Serie auf "teilweise verfuegbar", wenn ihr andere fehlen.
   */
  function requestOf(r) {
    if (!r) return null;
    const seasons = Array.isArray(r.seasons) ? r.seasons : [];
    const status = asRequest(r.status);
    if (r.mediaType !== 'movie' && seasons.length) {
      const ready = Number(r.readySeasons) || 0;
      const allReady = status === SEERR_REQUEST.COMPLETED || (status === SEERR_REQUEST.APPROVED && ready >= seasons.length);
      if (allReady) return isPresent(r.mediaStatus) ? 'available' : requestState(status, r.mediaStatus);
      if (status === SEERR_REQUEST.APPROVED && ready > 0) return 'partiallyAvailable';
    }
    return requestState(status, r.mediaStatus);
  }

  /** Noch offen: wartet auf Genehmigung, ist genehmigt und noch nicht da, oder gescheitert. */
  function isOpen(r) {
    const status = asRequest(r && r.status);
    if (status === SEERR_REQUEST.PENDING || status === SEERR_REQUEST.FAILED) return true;
    return status === SEERR_REQUEST.APPROVED && requestOf(r) !== 'available';
  }

  /**
   * Stand eines Titels. request: der Stand seiner neuesten Anfrage, wenn bekannt (Seite des Titels); ohne ihn zaehlt allein der Stand des
   * Titels (Plakate, Staffeln). Was da ist, geht vor; eine gescheiterte Anfrage vor dem Stand "in Bearbeitung", den Seerr dem Titel dabei
   * laesst; eine abgelehnte zaehlt nur, solange keine andere laeuft. null: nichts zu zeigen (nicht angefragt, geloescht, gesperrt, unbekannt).
   */
  function titleState(mediaStatus, request) {
    const m = media(mediaStatus);
    const rq = asRequest(request);
    if (m === SEERR_MEDIA.AVAILABLE) return 'available';
    if (m === SEERR_MEDIA.PARTIALLY_AVAILABLE) return 'partiallyAvailable';
    if (rq === SEERR_REQUEST.FAILED) return 'failed';
    if (m === SEERR_MEDIA.PROCESSING) return 'processing';
    if (m === SEERR_MEDIA.PENDING) return rq === SEERR_REQUEST.APPROVED ? 'approved' : 'requested';
    if (rq === SEERR_REQUEST.PENDING) return 'requested';
    if (rq === SEERR_REQUEST.APPROVED) return 'approved';
    if (rq === SEERR_REQUEST.DECLINED) return 'declined';
    return null;
  }

  /**
   * Stand eines Titels, der zu diesem Stand passt, solange eine Seite ihre Angaben noch nicht geladen hat (aus einer Mitteilung geoeffnet):
   * damit dort nicht fuer einen Augenblick "Anfragen" angeboten wird.
   */
  function placeholderMediaStatus(state) {
    switch (state) {
      case 'available':
        return SEERR_MEDIA.AVAILABLE;
      case 'partiallyAvailable':
        return SEERR_MEDIA.PARTIALLY_AVAILABLE;
      case 'approved':
      case 'processing':
      case 'failed':
        return SEERR_MEDIA.PROCESSING;
      case 'requested':
        return SEERR_MEDIA.PENDING;
      default:
        return SEERR_MEDIA.UNKNOWN;
    }
  }

  /**
   * Rechte eines Seerr-Benutzers, wie Seerr sie meldet (/auth/me, permissions als Bitfeld; server/lib/permissions.ts). Administrator gilt
   * fuer alles. Die Oberflaeche zeigt nur, was erlaubt ist; entscheiden tut immer Seerr (eine abgelehnte Aktion erscheint als Fehler).
   */
  const PERMISSIONS = Object.freeze({ ADMIN: 2, MANAGE_REQUESTS: 16, REQUEST: 32, REQUEST_VIEW: 16384, REQUEST_MOVIE: 262144, REQUEST_TV: 524288 });
  const bits = (perms) => (Number.isFinite(Number(perms)) && Number(perms) > 0 ? Math.trunc(Number(perms)) : 0);
  /** Hat der Benutzer das Recht p (oder ist er Administrator)? */
  const has = (perms, p) => ((bits(perms) & PERMISSIONS.ADMIN) !== 0) || (bits(perms) & p) === p;
  /** Anfragen genehmigen, ablehnen, erneut versuchen und entfernen. */
  const canManageRequests = (perms) => has(perms, PERMISSIONS.MANAGE_REQUESTS);
  /** Die Anfragen aller Benutzer ansehen (ohne dieses Recht liefert Seerr nur die eigenen). */
  const canViewAllRequests = (perms) => has(perms, PERMISSIONS.MANAGE_REQUESTS) || has(perms, PERMISSIONS.REQUEST_VIEW);
  /** Allgemeine Anfragen (4K-Anfragen bietet die App nicht an, wie die Apple-App). */
  const canRequest = (perms, movie) => has(perms, PERMISSIONS.REQUEST) || has(perms, movie ? PERMISSIONS.REQUEST_MOVIE : PERMISSIONS.REQUEST_TV);

  return {
    SEERR_MEDIA, SEERR_REQUEST, STATES, TAG_KIND, PERMISSIONS,
    isRequestable, isPresent, isTaken, isBlocklisted,
    requestState, requestOf, titleState, isOpen, placeholderMediaStatus, label, shortLabel,
    has, canManageRequests, canViewAllRequests, canRequest
  };
});
