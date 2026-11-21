/* Gemeinsames Modul: Staende bei Seerr. Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCSeerrState) in der
   Oberflaeche und in der Web-/Handy-Fassung. Ohne Abhaengigkeiten. Vorlage: Jellycloud/Core/SeerrMediaState.swift der Apple-App (Build 92). */
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

  const asStatus = (s) => (Number.isInteger(Number(s)) ? Number(s) : NaN);

  /**
   * Laesst sich der Titel (noch oder wieder) anfragen? Nur ohne Stand (0, 1) und nach dem Loeschen (7); nie bei gesperrten Titeln und
   * nie bei einem Wert, den die App nicht kennt (dann entscheidet niemand fuer Seerr). Fehlender Stand (null, undefined) gilt als 0.
   */
  function isRequestable(status) {
    const s = status == null ? 0 : asStatus(status);
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

  return { SEERR_MEDIA, isRequestable, isPresent, isTaken, isBlocklisted };
});
