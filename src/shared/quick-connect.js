/* Gemeinsames Modul: Quick Connect fuer ANDERE Geraete (wie die Apple-App, Core/QuickConnectAuthorization.swift und QuickConnectAuthorizer).
   Ein anderes Geraet zeigt einen sechsstelligen Code ("Mit Quick Connect anmelden"); hier wird er eingegeben und mit dem Konto des Profils bestaetigt:
   POST /QuickConnect/Authorize?code=<Code>&userId=<Benutzer>, Antwort true. Der Code gilt beim Server zehn Minuten.
   Jellyfin (am Quelltext nachgelesen, Notiz der Apple-App vom 20.11.2026): ausgeschaltet 401 "Quick connect is disabled"; Code unbekannt oder abgelaufen
   404 "Unable to find request"; schon bestaetigt "Request is already authorized" (erwartet 500).
   Der Code wird nirgends gespeichert oder protokolliert: er lebt nur im Zustand der offenen Maske und in der einen Anfrage.
   Laeuft als CommonJS (Hauptprozess, Tests) und als klassisches Skript (window.JCQuickConnect). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCQuickConnect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LENGTH = 6;

  /** Nur die Ziffern 0 bis 9, hoechstens sechs: Leerzeichen, Bindestriche und alles andere (auch beim Einfuegen, auch Ziffern anderer Schriften) fallen weg. */
  function clean(input) {
    return String(input ?? '').replace(/[^0-9]/g, '').slice(0, LENGTH);
  }

  function isComplete(code) {
    return typeof code === 'string' && code.length === LENGTH && code === clean(code);
  }

  /**
   * Hinweise aus der Antwort des Servers, die ueber die IPC-Grenze gehen (dort kommen nur message, status und code an, nie der Text der Antwort):
   * die Rueckseite setzt sie als code (hintOf), die Oberflaeche liest sie wieder (classify).
   */
  const HINT = Object.freeze({ disabled: 'QC_DISABLED', already: 'QC_ALREADY' });

  /** Hinweis aus dem Text einer Antwort von Jellyfin (nur Rueckseite: dort ist der Text noch da). */
  function hintOf(error) {
    const text = String(error?.body ?? '').toLowerCase();
    if (text.includes('already authorized')) return HINT.already;
    if (text.includes('disabled') || text.includes('not active')) return HINT.disabled;
    return null;
  }

  /**
   * Ordnet einen Fehler der Bestaetigung ein (Apple: QuickConnectAuthorizeError(_:enabled:)). enabled: ob der Server Quick Connect gerade anbietet;
   * zaehlt nur bei 401, dort antwortet Jellyfin sowohl bei ausgeschaltetem Quick Connect als auch bei einem ungueltigen Token.
   * @returns {{kind:'disabled'|'unknownCode'|'alreadyAuthorized'|'rejected'|'forbidden'|'signedOut'|'unreachable'|'timedOut'|'failed', status?:number, text?:string}}
   */
  function classify(error, enabled = true) {
    const status = Number(error?.status) || 0;
    const hint = error?.code === HINT.already || error?.code === HINT.disabled ? error.code : hintOf(error);
    if (!status) {
      if (error?.code === 'TIMEOUT') return { kind: 'timedOut' };
      if (error?.code === 'OFFLINE') return { kind: 'unreachable' };
      return { kind: 'failed', text: String(error?.message ?? '') };
    }
    if (hint === HINT.already) return { kind: 'alreadyAuthorized' };
    if (status === 401) return !enabled || hint === HINT.disabled ? { kind: 'disabled' } : { kind: 'signedOut' };
    if (status === 404) return { kind: 'unknownCode' };
    if (status === 403) return { kind: 'forbidden' };
    // die einzige Ausnahme auf diesem Weg ohne eigenen Status ist "schon bestaetigt"; ohne den Text bleibt es eine Vermutung
    if (status === 500) return { kind: 'rejected', status };
    // ein Proxy vor dem Server oder der Server startet neu: nicht der Code ist das Problem
    if (status >= 502 && status <= 504) return { kind: 'unreachable' };
    return { kind: 'failed', status };
  }

  /** 401 ohne Hinweis im Text: erst beim Server nachfragen, ob Quick Connect noch an ist, bevor es "Anmeldung abgelaufen" heisst. */
  const needsEnabledCheck = (error) => Number(error?.status) === 401 && classify(error).kind === 'signedOut';

  /** Der Code selbst ist das Problem: die Kacheln werden als fehlerhaft gezeigt, und die Meldung geht mit der naechsten Eingabe. */
  const concernsCode = (reason) => ['unknownCode', 'alreadyAuthorized', 'rejected'].includes(reason?.kind);

  /**
   * Zustand der Maske "Quick Connect" (Apple: QuickConnectAuthorizer): eine Bestaetigung zur Zeit, nichts mehr nach dem Schliessen, der Code bleibt nirgends stehen.
   * Phasen: checking (Verbindung wird geprueft) -> ready (Eingabe) -> working (Bestaetigung laeuft) -> done; disabled (am Server ausgeschaltet).
   * @param {{isEnabled: () => Promise<boolean>, authorize: (code: string) => Promise<unknown>, onChange?: (view: object) => void}} o
   */
  function createAuthorizer({ isEnabled, authorize, onChange = () => {} }) {
    let phase = 'checking';
    let code = '';
    let error = null;
    // Jede Bestaetigung und jede Pruefung hat ihre Nummer; Abbrechen und Schliessen zaehlen weiter, ein spaetes Ergebnis aendert dann nichts mehr
    let epoch = 0;
    const canSubmit = () => phase === 'ready' && isComplete(code);
    const emit = () => onChange({ phase, code, error, canSubmit: canSubmit() });

    return {
      get phase() {
        return phase;
      },
      get code() {
        return code;
      },
      get error() {
        return error;
      },
      get canSubmit() {
        return canSubmit();
      },

      /** Beim Oeffnen und "Erneut pruefen": bietet der Server Quick Connect an? Nicht erreichbar heisst: die Eingabe bleibt offen (die Bestaetigung meldet den Fehler). */
      async prepare() {
        if (phase === 'working') return;
        const mine = ++epoch;
        phase = 'checking';
        error = null;
        emit();
        let on = true;
        try {
          on = (await isEnabled()) !== false;
        } catch {
          on = true;
        }
        if (mine !== epoch) return;
        phase = on ? 'ready' : 'disabled';
        if (!on) code = '';
        emit();
      },

      /** Eingabe (Tippen, Einfuegen): bereinigt; waehrend einer Bestaetigung und ohne Feld (ausgeschaltet) wird nichts angenommen. */
      enter(input) {
        if (phase !== 'ready') return;
        const next = clean(input);
        if (next === code) return;
        code = next;
        error = null;
        emit();
      },

      async submit() {
        if (!canSubmit()) return;
        const mine = ++epoch;
        const sent = code;
        phase = 'working';
        error = null;
        emit();
        try {
          await authorize(sent);
          if (mine !== epoch) return;
          phase = 'done';
          code = '';
          emit();
        } catch (e) {
          if (mine !== epoch) return;
          let reason = null;
          if (needsEnabledCheck(e)) {
            // Antwortet der Server auf die Nachfrage nicht, laesst sich "ausgeschaltet" nicht von "Anmeldung abgelaufen" trennen: dann gilt "nicht erreichbar"
            try {
              reason = classify(e, (await isEnabled()) !== false);
            } catch (err) {
              reason = Number(err?.status) ? classify(e) : { kind: 'unreachable' };
            }
            if (mine !== epoch) return;
          }
          reason ??= classify(e);
          if (reason.kind === 'disabled') {
            phase = 'disabled';
            code = '';
            error = null;
          } else {
            phase = 'ready';
            error = reason;
          }
          emit();
        }
      },

      /** Abbrechen: was die Maske zeigt, bleibt stehen, bis sie aus dem Bild ist; ein spaetes Ergebnis aendert nichts mehr. */
      cancel() {
        epoch++;
      },

      /** Die Maske ist zu: der Code ist weg, ein spaetes Ergebnis aendert nichts mehr. */
      close() {
        epoch++;
        phase = 'checking';
        code = '';
        error = null;
      }
    };
  }

  return { LENGTH, HINT, clean, isComplete, hintOf, classify, needsEnabledCheck, concernsCode, createAuthorizer };
});
