/* Gemeinsames Modul: Regeln des Reiters "Anfragen" ohne Oberflaeche. Laeuft als CommonJS (Tests) und als klassisches Skript
   (window.JCSeerrRequests) in der Oberflaeche und in der Web-/Handy-Fassung. Vorlage: Jellycloud/Core/SeerrRequests.swift
   (SeerrRequestPaging, SeerrPermissions) und Features/Requests/RequestsView.swift der Apple-App (Build 92/93).
   - Blaettern zu je 50: was geladen ist, wo die naechste Seite beginnt, ob es weitere gibt, wie viel ein Neuladen holt.
   - Welche Aktionen eine Anfrage anbietet (allein nach den Rechten aus /auth/me; entscheiden tut immer Seerr).
   - Die kurze Angabe unter dem Plakat. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seerr-state'), require('./format'));
  else root.JCSeerrRequests = factory(root.JCSeerrState, root.JCFormat);
})(typeof self !== 'undefined' ? self : this, function (SeerrState, Format) {
  'use strict';

  /** Anfragen je Seite (wie Seerr und die Apple-App). */
  const PAGE_SIZE = 50;
  /** So viele Plakate fuellen einen Bildschirm: zeigt die gewaehlte Anzeige weniger und gibt es aeltere, blaettert der Reiter von selbst weiter. */
  const FILL = 24;

  /**
   * Seitenweise geladene Anfragen (SeerrRequestPaging der Apple-App). Neueste zuerst, jede Anfrage einmal. start ersetzt den Bestand (erste
   * Seite, Neuladen), append haengt eine weitere Seite an. received: bei Seerr schon abgeholte Stellen (dort beginnt die naechste Seite, auch
   * unlesbare Eintraege zaehlen). hasMore: solange Seerr mehr nennt, als abgeholt ist; ohne Zahl, solange die Seite voll war; eine leere Seite
   * oder eine ohne Neues beendet das Blaettern immer (sonst liefe es bei falscher oder fehlender Zahl ohne Ende).
   */
  function createPaging() {
    let requests = [];
    let received = 0;
    let hasMore = false;
    const paging = {
      get requests() {
        return requests;
      },
      get received() {
        return received;
      },
      get hasMore() {
        return hasMore;
      },
      /** So viele holt ein Neuladen in einem Abruf: alles, was schon geladen war (nichts springt), mindestens eine Seite. */
      get reloadSize() {
        return Math.max(PAGE_SIZE, received);
      },
      start(page) {
        requests = [];
        received = 0;
        paging.append(page);
      },
      append(page) {
        const before = requests.length;
        const seen = new Set(requests.map((r) => r.id));
        const fresh = (page?.requests ?? []).filter((r) => r && !seen.has(r.id) && seen.add(r.id));
        requests = requests.concat(fresh);
        const got = Number(page?.received) || 0;
        received += got;
        if (got === 0 || requests.length === before) hasMore = false;
        else if (Number.isInteger(page?.total)) hasMore = received < page.total;
        else hasMore = got >= (Number(page?.asked) || PAGE_SIZE);
      }
    };
    return paging;
  }

  /** Gehoert die Anfrage in die Anzeige "offen" (ausstehend, gescheitert, genehmigt und noch nicht da) bzw. "abgeschlossen"? */
  const matches = (r, filter) => (filter === 'closed' ? !SeerrState.isOpen(r) : SeerrState.isOpen(r));

  /** Destruktive Aktionen: erst nach einer Rueckfrage. */
  const DESTRUCTIVE = Object.freeze(['decline', 'withdraw', 'remove']);

  /**
   * Die Aktionen, die eine Anfrage anbietet, in der Reihenfolge des Menues: mit "Anfragen verwalten" Genehmigen und Ablehnen (wartende),
   * Erneut versuchen (gescheiterte) und Entfernen (jede); ohne das Recht nur Zurueckziehen, und nur eigene wartende.
   * @param {{status:number|null, requesterId:number}} r
   * @param {{permissions:number, userId:number|null}} who
   */
  function actionsFor(r, { permissions = 0, userId = null } = {}) {
    if (!r) return [];
    const manage = SeerrState.canManageRequests(permissions);
    const pending = r.status === SeerrState.SEERR_REQUEST.PENDING;
    const out = [];
    if (manage && pending) out.push('approve', 'decline');
    if (manage && r.status === SeerrState.SEERR_REQUEST.FAILED) out.push('retry');
    if (!manage && pending && userId !== null && r.requesterId === userId) out.push('withdraw');
    if (manage) out.push('remove');
    return out;
  }

  /**
   * Kurze Angabe unter dem Plakat: Jahr, bei Serien die angefragten Staffeln (sonst Film bzw. Serie), 4K, im Verwalten der Anfragende.
   * @param {object} r Anfrage (normalizeRequest)
   * @param {{year?:number|null, manage?:boolean, lang?:string, kinds:{movie:string, tv:string}, by:(name:string)=>string}} o
   */
  function detailLine(r, { year = null, manage = false, lang = 'de', kinds, by }) {
    const parts = [];
    if (year) parts.push(String(year));
    if (r.mediaType !== 'movie' && r.seasons?.length) parts.push(Format.seasonList(r.seasons, lang));
    else parts.push(r.mediaType === 'movie' ? kinds.movie : kinds.tv);
    if (r.is4k) parts.push('4K');
    if (manage && r.requesterName) parts.push(by(r.requesterName));
    return parts.join(' · ');
  }

  return { PAGE_SIZE, FILL, DESTRUCTIVE, createPaging, matches, actionsFor, detailLine };
});
