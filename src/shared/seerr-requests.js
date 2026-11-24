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
    const R = SeerrState.SEERR_REQUEST;
    const pending = r.status === R.PENDING;
    const own = userId !== null && r.requesterId === userId;
    const out = [];
    if (manage && pending) out.push('approve', 'decline');
    if (manage && r.status === R.FAILED) out.push('retry');
    // Build 94/95 der Apple-App (am Quelltext von Seerr belegt, server/routes/request.ts und media.ts):
    // Staffeln aendern: ausstehende Serienanfrage, eigene oder als Verwalter
    if (pending && r.mediaType === 'tv' && (manage || own)) out.push('seasons');
    // Anfrage aendern (Zielserver, Profil, Ordner, Anfragen als): ausstehend; Verwalter oder der Anfragende mit dem Recht fuer erweiterte Anfragen
    if (pending && (manage || (own && SeerrState.has(permissions, SeerrState.PERMISSIONS.REQUEST_ADVANCED)))) out.push('edit');
    // Als verfuegbar markieren: genehmigte, gescheiterte und abgeschlossene Anfragen, deren Titel noch nicht da ist (Recht "Anfragen verwalten")
    if (manage && [R.APPROVED, R.FAILED, R.COMPLETED].includes(r.status) && r.mediaStatus !== SeerrState.SEERR_MEDIA.AVAILABLE && Number.isInteger(r.seerrMediaId)) out.push('available');
    if (!manage && pending && own) out.push('withdraw');
    if (manage) out.push('remove');
    return out;
  }

  /** Aktionen, die erst nach einer Rueckfrage laufen, ohne destruktiv zu sein (Als verfuegbar markieren aendert den Stand des Titels fuer alle). */
  const CONFIRMED = Object.freeze(['available']);

  /**
   * Einzelheiten einer Anfrage (wie SeerrRequestDetails der Apple-App, Build 94): wer sie wann gestellt hat und, wenn jemand anderes als der Anfragende
   * entschieden hat, wer sie genehmigt oder abgelehnt hat. Eigene heissen "von dir".
   * @param {{userId:number|null, lang:string, t:(key:string, vars?:object)=>string}} o
   */
  function detailLines(r, { userId = null, lang = 'de', t }) {
    if (!r) return [];
    const R = SeerrState.SEERR_REQUEST;
    const me = (id) => userId !== null && id === userId;
    const who = me(r.requesterId) ? t('req.detail.you') : r.requesterName;
    let date = '';
    if (r.created) {
      try {
        date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(r.created));
      } catch {
        date = '';
      }
    }
    const out = [t(who ? (date ? 'req.detail.askedByOn' : 'req.detail.askedBy') : date ? 'req.detail.askedOn' : 'req.detail.asked', { who, date })];
    const verb = r.status === R.APPROVED || r.status === R.COMPLETED ? 'approved' : r.status === R.DECLINED ? 'declined' : null;
    if (verb && r.modifierId !== null && r.modifierId !== r.requesterId) {
      const name = me(r.modifierId) ? t('req.detail.you') : r.modifierName;
      if (name) out.push(t(`req.detail.${verb}`, { who: name }));
    }
    return out;
  }

  /** Staffeln aendern: waehlbar sind die der Anfrage und alle, die weder da noch anderweitig angefragt sind; speichern nur mit mindestens einer und nur geaendert. */
  const seasonEditSelectable = (season, own) => own.includes(season.number) || !SeerrState.isTaken(season.status);
  const seasonEditCanSave = (chosen, own) => chosen.length > 0 && JSON.stringify([...chosen].sort((a, b) => a - b)) !== JSON.stringify([...own].sort((a, b) => a - b));

  /**
   * Anfrage aendern (Build 95, SeerrRequestEdit der Apple-App): der vollstaendige Stand der Anfrage mit dem neuen Ziel, wie Seerr ihn erwartet (bei Filmen
   * setzt Seerr Zielserver, Profil, Ordner und Tags auf genau das Genannte, bei Serien verlangt es die Staffeln). Den Anfragenden nur, wenn er sich aendert.
   * @param {{serverId:number|null, profileId:number|null, rootFolder:string|null, userId:number}} target
   */
  function editBody(r, target) {
    const body = { mediaType: r.mediaType, serverId: target.serverId ?? null, profileId: target.profileId ?? null, rootFolder: target.rootFolder ?? null, tags: r.tags ?? [] };
    if (r.mediaType === 'tv') {
      body.seasons = [...(r.seasons ?? [])].sort((a, b) => a - b);
      if (Number.isInteger(r.languageProfileId)) body.languageProfileId = r.languageProfileId;
    }
    if (Number.isInteger(target.userId) && target.userId !== r.requesterId) body.userId = target.userId;
    return body;
  }
  /** Den Anfragenden aendert nur, wer Anfragen und Benutzer verwalten darf. */
  const canChangeRequester = (permissions) => SeerrState.has(permissions, SeerrState.PERMISSIONS.MANAGE_REQUESTS) && SeerrState.has(permissions, SeerrState.PERMISSIONS.MANAGE_USERS);
  /** Die Zielserver fuer diese Anfrage (gleiche Aufloesung), der Standardserver zuerst, dann nach Namen. */
  const serversFor = (all, r) =>
    (Array.isArray(all) ? all : []).filter((s) => !!s.is4k === !!r.is4k).sort((a, b) => (a.isDefault === b.isDefault ? String(a.name).localeCompare(String(b.name)) : a.isDefault ? -1 : 1));

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

  // ---------- Anfragen auf der Seite eines Titels (SeerrDetailSheet der Apple-App) ----------

  /** Staffeln, die sich noch anfragen lassen: weder da noch angefragt. */
  const openSeasons = (list) => (Array.isArray(list) ? list : []).filter((s) => !SeerrState.isTaken(s.status));

  /**
   * Darf und kann der Benutzer (noch) etwas anfragen? Nur mit dem Recht dazu (aus /auth/me), nie bei gesperrten Titeln; ein Film, solange er anfragbar ist; eine
   * Serie, solange eine Staffel offen ist (bevor ihre Staffeln geladen sind, nach dem Stand der Serie).
   * @param {{mediaType:string, status:number, seasonList?:object[]|null, permissions:number}} o seasonList null: noch nicht geladen
   */
  function canRequestMore({ mediaType, status, seasonList = null, permissions = 0 }) {
    const movie = mediaType === 'movie';
    if (!SeerrState.canRequest(permissions, movie) || SeerrState.isBlocklisted(status)) return false;
    // Film, Staffeln noch nicht geladen oder von Seerr nicht genannt: nach dem Stand des Titels
    if (movie || seasonList === null || !seasonList.length) return SeerrState.isRequestable(status);
    return openSeasons(seasonList).length > 0;
  }

  /** Beschriftung des Anfrage-Knopfs: "movie" (Film anfragen), "series" (Serie anfragen) oder "more" (Weitere Staffeln anfragen, wenn schon etwas da oder angefragt ist). */
  function requestKind({ mediaType, status, seasonList = null }) {
    if (mediaType === 'movie') return 'movie';
    const partial = Number(status) === SeerrState.SEERR_MEDIA.PARTIALLY_AVAILABLE || (seasonList ?? []).some((s) => SeerrState.isTaken(s.status));
    return partial ? 'more' : 'series';
  }

  /** Kontingent der Art erschoepft (Seerr meldet restricted, oder nichts mehr frei)? Ohne Angabe nie. */
  const quotaExhausted = (q) => !!q && (q.restricted === true || (q.remaining !== null && q.remaining !== undefined && q.remaining <= 0));

  /**
   * Ist eine Anfrage, deren Antwort ausblieb, doch angekommen? Bei Staffeln an den gewaehlten Staffeln (der Stand einer schon angefragten Serie aendert sich
   * nicht), beim Film am Stand. Erst danach weiss die Seite, ob sie den Fehler zeigen muss; erneut gesendet wird nie.
   */
  function arrived({ seasons = null, seasonList = [], before, status }) {
    if (Array.isArray(seasons) && seasons.length) return seasons.every((n) => SeerrState.isTaken((seasonList ?? []).find((s) => s.number === n)?.status));
    return Number(status) !== Number(before) && SeerrState.isTaken(status);
  }

  // ---------- Gemeldete Probleme (SeerrIssueRules der Apple-App, Build 94; server/routes/issue.ts von Seerr) ----------
  const P = SeerrState.PERMISSIONS;
  const issues = {
    /** So viele Meldungen holt die Seite in einem Abruf (die zuletzt geaenderten zuerst). */
    PAGE_SIZE: 50,
    /** Die Seite "Gemeldete Probleme": mit einem der drei Rechte (ohne verwalten oder ansehen zeigt Seerr nur die eigenen). */
    shows: (perms) => SeerrState.has(perms, P.MANAGE_ISSUES) || SeerrState.has(perms, P.VIEW_ISSUES) || SeerrState.has(perms, P.CREATE_ISSUES),
    /** "Video · Staffel 2, Folge 5"; ohne Staffel und Folge nur die Art. t: Uebersetzung (issue.type.<Art> wie beim Melden, issues.season, issues.seasonEpisode). */
    subject(issue, t) {
      const kinds = { 1: 'video', 2: 'audio', 3: 'subtitles', 4: 'other' };
      const parts = [kinds[issue.type] ? t(`issue.type.${kinds[issue.type]}`) : t('issues.problem')];
      if (issue.mediaType === 'tv' && issue.season > 0) parts.push(issue.episode > 0 ? t('issues.seasonEpisode', { s: issue.season, e: issue.episode }) : t('issues.season', { s: issue.season }));
      return parts.join(' · ');
    },
    /**
     * Die Zeile am Ende des Verlaufs: "Als gelöst markiert" bzw. "Wieder geöffnet". Seerr fuehrt keinen Verlauf des Stands, nur updatedAt: liegt es spaeter
     * als der letzte Beitrag (mehr als slack Sekunden), war die letzte Aenderung ein Wechsel des Stands. @returns {{key:string, date:string}|null}
     */
    statusNote(issue, slack = 3) {
      const updated = Date.parse(issue.updated ?? '');
      const last = Math.max(...issue.comments.map((c) => Date.parse(c.created ?? '')).filter(Number.isFinite), Date.parse(issue.created ?? '') || -Infinity);
      if (!Number.isFinite(updated) || !Number.isFinite(last) || (updated - last) / 1000 <= slack) return null;
      return { key: issue.open ? 'issues.reopened' : 'issues.resolvedNote', date: issue.updated };
    },
    /** Stand als Tag in vorhandenen Farbpaaren: "Offen" wie "In Bearbeitung", "Gelöst" wie "Verfügbar". */
    stateKind: (issue) => (issue.open ? 'processing' : 'available'),
    /** Antworten und den Stand aendern: wer Probleme verwaltet, und der Meldende selbst (sofern er melden darf). */
    canAnswer: (issue, viewer, perms) => SeerrState.has(perms, P.MANAGE_ISSUES) || (SeerrState.has(perms, P.CREATE_ISSUES) && viewer !== null && issue.creatorId === viewer),
    /** Loeschen: wer Probleme verwaltet; der Meldende nur, solange niemand geantwortet hat (hoechstens sein eigener Kommentar). */
    canDelete: (issue, viewer, perms) => SeerrState.has(perms, P.MANAGE_ISSUES) || (SeerrState.has(perms, P.CREATE_ISSUES) && viewer !== null && issue.creatorId === viewer && issue.comments.length <= 1),
    /** Ein Kommentar laesst sich senden, wenn er nicht leer ist; Seerr bekommt hoechstens 2000 Zeichen. */
    comment: (text) => {
      const s = String(text ?? '').trim();
      return s ? s.slice(0, 2000) : null;
    }
  };

  return { issues, PAGE_SIZE, FILL, DESTRUCTIVE, CONFIRMED, createPaging, matches, actionsFor, detailLine, detailLines, seasonEditSelectable, seasonEditCanSave, editBody, canChangeRequester, serversFor, openSeasons, canRequestMore, requestKind, quotaExhausted, arrived };
});
