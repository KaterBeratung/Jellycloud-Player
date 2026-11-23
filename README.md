# Jellycloud Player

Jellyfin-Client für Windows im Stil von Infuse. Die Oberfläche läuft in Electron, abgespielt wird mit **mpv**:
Direct Play ohne Transcoding, HDR10 / HLG / Dolby Vision, Audio-Passthrough (Dolby Digital, DTS, TrueHD, Atmos),
PGS-/ASS-Untertitel.

## Funktionen

- **Direct Play zuerst:** Das Geräteprofil meldet dem Server „alles abspielbar“. Nur bei einem eingestellten Bitratenlimit
  (oder wenn der Server nicht liefern kann) fällt der Client auf HLS-Transcode zurück.
- **HDR:** mpv mit `gpu-next` (libplacebo) und D3D11. HDR-Ausgabe: Automatisch, Durchreichen oder Tone-Mapping nach SDR.
  Dolby Vision (Profil 5/8) wird über die RPU-Daten abgebildet, Profil 7 FEL nur als Basisschicht.
- **Audio:** WASAPI-Passthrough für AC3/E-AC3/DTS/DTS-HD/TrueHD, optional exklusiv (für Bitstream von TrueHD/DTS-HD).
  Die App erkennt das Ausgabegerät (Kanalzahl, Bauart) und wählt danach Stereo oder Surround, siehe *Ton-Ausgabe und Kanalerkennung*.
- **Infuse-ähnliche Oberfläche:** Hero-Banner und Reihen vor allem mit **Neuzugängen** (Banner: nur Neues, Filme und Serien abwechselnd; darunter ganz oben *Weiterschauen* und *Als Nächstes*, dann *Neu in Filme*, *Neu in Serien*, Favoriten), Poster-Raster mit **Tags wie in der Apple-App** (4K, HDR-Format, Premium-Ton, siehe *Tags*),
  Detailseite mit Version, Audio und Untertiteln vor dem Start, Staffeln und Folgen, Besetzung, Informationen; jede Karte hat ein **Kontextmenü**
  (Rechtsklick, langes Drücken; siehe *Detailseite und Kontextmenü*).
- **Player:** eigene Steuerung im Liquid-Glass-Stil (Seekbar mit Trickplay-Vorschau, Kapitel, Intro/Abspann überspringen,
  nächste Folge, **Folgen und Staffeln der Serie** zum Wechseln, Countdown an Überspringen und Nächste Folge, Tempo, Bildformat, Audio-/Untertitel-Panel mit Verzögerung und Größe, Technik-Info). Untertitel
  weichen der Steuerleiste aus. Alle Panels passen ohne Scrollen (zweispaltig bzw. verdichtet).
- **Anpassbar:** Designs wie in der Apple-App (Midnight, Graphite, AMOLED, Midnight Blue; nur dunkle), **Akzentfarbe für Buttons usw.** (Farbfelder,
  Farbwähler, Hex-Code), Postergröße, Glas-Effekte, Sprache (DE/EN). Ecken (18 px) und Bewegung sind fest: Bewegung nimmt allein die Systemeinstellung *Bewegung reduzieren* (Windows: *Animationseffekte*) zurück (src/renderer/js/motion.js).
- **Konto:** Anmeldung mit Benutzer/Passwort oder Quick Connect, mehrere Server, Token per Windows-DPAPI verschlüsselt.
  Seit 1.2.7 wie die Apple-App: Anmeldung mit Marke (Logo, Schriftzug), Kapselfeldern und dem Quick-Connect-Code in Ziffernkacheln; **Quick Connect für
  andere Geräte** (den Code eines anderen Geräts eingeben und bestätigen, ohne Passwort); Profile mit eigenem Namen, neuer Serveradresse (nur derselbe
  Server, das Profil bleibt angemeldet) und Entfernen; **Verbindungsprüfung** beim Start, Profilwechsel und bei der Rückkehr in die App.
  Fortschritt, „gesehen“ und Favoriten werden mit dem Server synchronisiert.
- **Trailer:** Auf der Detailseite und im Banner der Startseite läuft der Trailer im Hintergrund, sofort und leise (siehe *Trailer*).
- **Verwaltung für Administratoren:** Server (Info, Bibliotheken durchsuchen, Neustart, Herunterfahren), Aufgaben, Aktivität, Benutzer, Metadaten bearbeiten, identifizieren, Einträge löschen (siehe *Verwaltung*).
- **Lange Untertitel-Listen:** Ab 9 Spuren ordnet die Auswahl auf der Detailseite und das Spur-Panel im Player die Untertitel nach Sprache: gleich zu sehen sind die bevorzugten Sprachen (eingestellte Untertitelsprache, Oberfläche, Tonspur, Englisch) und die gewählte Spur, der Rest steckt hinter *Weitere Sprachen*.
- **Anfragen:** Titel, die es noch nicht gibt, lassen sich über Seerr anfragen (siehe *Anfragen mit Seerr*). Mit Seerr zeigt die Startseite die Reihen *Top 10 Filme*, *Top 10 Serien* und *Filme im Trend*; ohne Seerr gibt es sie nicht (seit 1.2.14, siehe *Anfragen mit Seerr*).
- **Mitteilungen:** Mit Seerr meldet die App, wenn sich bei deinen Anfragen etwas tut (genehmigt, abgelehnt, fehlgeschlagen, erste Folgen, verfügbar; als Verwalter auch neue Anfragen anderer): ein roter Punkt am Profilsymbol, im Profilmenü „Mitteilungen“ mit „n neue“ (siehe *Mitteilungen*).
- **Probleme melden:** Auf der Detailseite zeigt ein **Warnschild** in der Knopfleiste (nach Herz und Gesehen, vor „Mehr“) ein Fenster, in dem sich zu Video, Audio, Untertiteln oder Sonstigem ein Problem an Seerr melden lässt, der Kommentar ist freiwillig (siehe *Probleme an Seerr melden*).
- **Discord Rich Presence:** Zeigt in Discord, was du gerade schaust, mit Poster, Folge und Fortschritt und einem Namen, den du selbst wählst (siehe *Discord Rich Presence*). Aus, bis du es einschaltest; die Discord-Anwendung ist eingebaut, es ist keine Einrichtung nötig.
- **Startseite anpassen:** *Einstellungen > Startseite*: Banner an oder aus, Zahl der Folien, Zeitraum der Top 10, Reihen ein- und ausschalten und umsortieren (siehe *Startseite anpassen*).
- **Neu laden:** F5, Knopf in der Kopfzeile, Metadaten vom Server aktualisieren lassen (siehe *Neu laden und Metadaten*).
- **Autostart:** Optional mit Windows starten, auf Wunsch minimiert.
- **Startanimation:** Beim Start zeichnet sich das Logo, dann fährt die Kamera durch es hindurch in die Oberfläche (siehe *Startanimation*). Immer an (wie in der Apple-App), bei *Bewegung reduzieren* eine ruhige Fassung.

## Starten (Entwicklung)

```bash
npm install
npm start
```

## mpv

mpv ist **fest in die App eingebaut** und nicht einstellbar: Es gibt keine Pfadauswahl, keinen Suchlauf im `PATH`, keine eigene `mpv.conf`
und keine freien mpv-Optionen. Im Projekt liegt unter `vendor\mpv\` ein mpv-Windows-Build (shinchiro, mpv 0.41.0 vom 2026-11-01, von
<https://mpv.io/installation/> verlinkt, SHA-256 `7a887a10…ba110` gegen die GitHub-Angabe geprüft). Der Installer packt ihn mit ein (`resources\mpv`).
Die Einstellungen steuern nur sinnvolle Optionen (HDR, Hardware-Dekodierung, Ton, Untertitel usw.); die App übersetzt sie in mpv-Parameter.
Eine andere mpv-Version einzubauen ist Entwicklersache: `mpv.exe` samt DLLs in `vendor\mpv\` ersetzen und den Installer neu bauen.

mpv steht unter GPL/LGPL (<https://github.com/mpv-player/mpv>). Wer den Installer weitergibt, muss die Lizenzbedingungen von mpv und seinen
Bibliotheken einhalten.

## Aussehen

- **Icon und Logo:** eine weiße Wolke als Umriss mit Play-Symbol und Leuchten, wie das Logo der Startanimation. Das **App-Symbol** (`build/icon.png`: Taskleiste, Fenster, Installer, Verknüpfung)
  ist dieselbe Wolke **freistehend**, ohne Platte und ohne dunklen Rand, auf transparentem Grund; es entsteht mit `npm run icon` (`tools/make-icon.js`). Weil es weiß ist, steht es auf dunklem Grund (Taskleiste und Startmenü im dunklen Design) klar,
  auf hellem Grund (Explorer im hellen Design) tritt es zurück und ist nur noch schwach zu sehen; das ist gewollt, die dunkle Platte (0.0.44 bis 0.0.47) und der dunkle Rand (bis 0.0.43) waren unerwünscht. In der Oberfläche steht dieselbe Form als Logo in der Kopfzeile, auf dem Anmeldebildschirm und unter *Info*, jeweils mit Leuchten in der Akzentfarbe (`.brand-mark`);
  (Bis 0.0.43 war das App-Symbol eine silberne Wolke mit dunklem Rand ohne Leuchten.)
- **Standardfarbe:** neutrales Silberweiß (`#f5f5f7`) wie bei Apple TV für Buttons, Navigation, Fortschritt und Markierungen. Die Farbe ist unter *Erscheinungsbild* frei wählbar: seit 1.2.6 dieselben acht Farbfelder wie in der
  Apple-App (Silber, Königsblau, Violett, Rosa, Rot, Orange, Grün, Türkis; `SWATCHES` in `accent.js`, Namen DE/EN), dazu Farbwähler und Hex-Code; eine früher gewählte Farbe, die kein Feld mehr ist, bleibt als eigene Farbe. Die Regeln stehen in `src/shared/accent.js`
  und gelten für Oberfläche und Player gleich: Weiß, Grau und Schwarz passen sich dem Theme an (auf einem hellen Grund würde Weiß zu Fast-Schwarz, sonst wären
  Buttons unsichtbar); helle Akzente bekommen dunkle Schrift und eine abgedunkelte Tönung für durchscheinende Auswahlzustände (`--accent-rgb`);
  Text und Icons in Akzentfarbe werden so weit aufgehellt bzw. abgedunkelt, dass der Kontrast mindestens 4,5:1 beträgt (`--accent-fg`).
  Bestehende Installationen mit dem alten Standard-Blau bekommen einmalig das neue Silberweiß (Konfigurationsversion 3); eine danach bewusst
  gewählte Farbe bleibt.
- **Hintergrundton:** Die Seite nimmt auf Start (aktuelles Banner) und Detailseite dezent die Farbe des gezeigten Bilds auf (13 % bei Midnight, bei
  AMOLED weniger) und blendet sie bei anderen Seiten wieder aus. Die Farbe kommt aus dem Blurhash des Servers
  (`ImageBlurHashes`, ohne Bild zu laden); fehlt er, bleibt der Hintergrund neutral. Abschaltbar unter *Erscheinungsbild*
  („Hintergrund passt sich dem Bild an“). Umsetzung: `ambient.js`, `color.js`, CSS-Eigenschaften `--tint`, `--tint-amt`, `--page`.
- **Kopfzeile:** ganz oben eine schmale Titelzeile (Ziehfläche und Windows-Fensterknöpfe), darunter links die **Marke „Jellycloud“** als eigene Glas-Kapsel (44 px, bei schmalen
  Fenstern nur die Wolke), gestaltet wie das Logo der Startanimation: Wolkenumriss mit Leuchten in der Akzentfarbe und der Schriftzug in Großbuchstaben mit weitem Buchstabenabstand (`.brand-mark`, `.brand-name` in `app.css`), die Navigation als Kapsel **mittig** (wie die Tab-Leiste in Apple TV) und rechts eine Kapsel gleicher Höhe mit Neu laden,
  Verwaltung (nur Administratoren), Einstellungen und dem Profilsymbol als identische 36-px-Scheiben. Die Ziehfläche sind die Titelzeile und der freie Platz neben den Kapseln: Eine ganze Leiste als Ziehfläche zu markieren
  und Knöpfe auszunehmen verschluckt unter Windows die Klicks.
- **Fünf Reiter wie die Apple-App (seit 1.2.8, Plan P9):** *Start, Filme, Serien, Anfragen, Suche*, immer alle fünf, auch ohne Seerr (die Leiste ändert ihre Breite nicht
  beim Einrichten oder Ausfall von Seerr); am Desktop in der Kapsel, in der kompakten Ansicht unten (ohne Reiter *Einstellungen*). **Strg+1** bis **Strg+5** wählen sie,
  ein Klick auf den gewählten Reiter führt an den Anfang seiner Seite, auf Detailseiten und in den Einstellungen bleibt der Reiter gewählt, aus dem man kam.
  Reihenfolge und Regeln stehen an einer Stelle (`src/shared/nav.js`).
  - *Filme* und *Serien* zeigen **alle Bibliotheken ihrer Art** mit einer Wahl neben dem Titel (nur bei mehr als einer; gemerkt je Reiter): Filme mit Bibliotheken
    ohne Art und gemischten, dahinter Heim- und Musikvideos (bleiben unter Windows und Android erreichbar, Entscheidung E6) und zuletzt die **Kollektionen**; Serien mit
    gemischten. Eine von der Startseite geöffnete Mediathek („Neu in …“) zeigt weiter genau diese, mit dem Ambient Glow der Mediatheken.
  - *Anfragen* zeigt ohne Seerr „Seerr nicht verbunden“ mit *Seerr verbinden*, sonst die Übersicht der Anfragen (seit 1.2.10) bzw. den Stand von Seerr
    (siehe *Anfragen mit Seerr*).
  - *Suche* (seit 1.2.13, Plan P14, wie die Apple-App): ein **zweiter Klick** auf den gewählten Reiter gibt dem Suchfeld den Fokus (auf dem Handy die Tastatur), der
    Suchtext bleibt; der erste Tipp öffnet auf dem Handy keine Tastatur (am Desktop steht der Fokus wie bisher gleich im Feld). Ist aus der Suche eine Detailseite
    offen, führt der Reiter mit dem Suchtext zur Suche zurück. **Strg+K** und **/** springen ins Suchfeld, in der offenen Suche ohne den Text zu verlieren.
- **Suche (seit 1.2.13, Plan P14, wie `SearchView` der Apple-App):** gesucht wird, wenn die Eingabe **350 ms** ruht (Enter sofort); eine veraltete Antwort wird
  verworfen (die Anfrage selbst läuft am Server zu Ende). Zuerst die Treffer der Mediathek (nach Art), darunter **unabhängig** die Treffer von Seerr unter
  *Nicht in der Bibliothek* („Über Seerr anfragen“): abgeglichen über **TMDB-Nummer und Art**, nie über den Titel (die Suche fragt dafür `ProviderIds` mit ab);
  was Seerr als vorhanden kennt oder unter den Treffern der Mediathek steht, fehlt, **teilweise vorhandene Serien bleiben** anfragbar. Was die Seite ohne Treffer
  sagt, entscheidet eine Stelle (`src/shared/search-status.js`): „Keine Ergebnisse für …“ und ein Fehler gelten **nur für den beantworteten Text**, beim
  Weitertippen heißt es „Suche läuft …“; Treffer bleiben stehen, bis die neue Suche antwortet. Ein Ausfall von Seerr oder der Mediathek ersetzt die Treffer der
  anderen Seite nie durch eine Fehlerseite (kleiner Hinweis darüber, bei der Mediathek mit *Erneut versuchen*). Nach einer Anfrage aus der Suche lädt nur Seerr neu.
  Tests: `test/search.test.js` (die sechs Fälle aus `SearchStatusTests`, Abgleichfälle), Szenario `search-page.js` (Port 8988), `web-mode.js` (Reiter auf dem Handy).
  - **Profilmenü** am Profilsymbol: Profile (Haken beim aktiven, darunter „Aktiv · Adresse“; ein Tipp auf ein anderes wechselt), *Quick Connect*,
    *Server oder Profil hinzufügen*, *Einstellungen*, zuletzt *Abmelden* in Rot mit Rückfrage. Haken und Symbole stehen in einer Spalte.
  - Szenario `nav-shell.js`; die kompakten Größen 412 × 891, 360 × 740 und 800 × 411 prüft `web-mode.js`.
- **Apple-TV-Stil:** neutrales Dunkel ohne Blaustich (Apple-Grautöne), großer Hero mit dem Inhalt unten links und Seitenpunkten in einer Glaskapsel
  unten mittig, Reihentitel mit Pfeil (führt zur ganzen Bibliothek), Karten mit größerem Radius, die sich beim Zeigen heben, zur Maus neigen
  reduziert halb so stark, bei aus gar nicht)„reduziert“ halb so stark, bei „aus“ gar nicht) und einen Glanzpunkt bekommen (`attachTilt` in `ui.js`), Fokusring weiß statt in
  der Akzentfarbe. Die Akzentfarbe bleibt für Buttons, Fortschritt und Markierungen. Bestehende Installationen mit dem alten Standard-Radius 14
  bekommen einmalig den neuen Standard 18 (Konfigurationsversion 2); eigene Werte bleiben.
- **Kein Scrollbalken (seit 1.1.4):** Die Oberfläche hat nirgends einen sichtbaren Scrollbalken (weder am Fensterrand noch in Menüs, Dialogen und Listen), wie bei Netflix und Apple TV; es bleibt auch kein 12-px-Streifen reserviert, der Inhalt nutzt die volle Breite.
  Gescrollt wird mit Mausrad, Touchpad, Fingern und Tastatur (Bild hoch/runter, Pos1/Ende, Leertaste; `#view` ist fokussierbar). Umsetzung: `* { scrollbar-width: none; }` und `::-webkit-scrollbar { display: none; }` am Anfang von `app.css`; wer eine eigene Breite braucht, muss `scrollbar-width: none` selbst setzen (Klassenregeln schlagen die allgemeine).
  Ausnahme: die Popups im Player-Overlay (Spuren, Info, Folgenliste) haben noch ihren schmalen, durchscheinenden Balken. Szenario `no-scrollbar.js`.
- **Personen ohne Foto:** runde Scheibe in der Akzentfarbe mit Initialen (Klasse `noimg`).
- **Design-Grundlagen wie in der Apple-App (seit 1.2.6, Paket P5):** Werte als Tokens am Anfang von `app.css` (und für den Player in `player.css`):
  - *Feste Farben:* Fehler und Gefahr `--danger-fg` #ff6b86, Punkt für Ungelesenes `--badge` #ff453a (für die Mitteilungen), **Schalter „an“ fest grün** `--switch-on`
    #34c759 mit weißem Knopf, nie in der Akzentfarbe (Silberweiß wäre vom Knopf nicht zu unterscheiden).
  - *Bewegung:* keine Kurve mit Überschwinger mehr (`--ease-spring` entfällt, Verschieben mit `--ease`); lange, gestaltete Bewegungen (Startanimation) behalten ihre Werte.
  - *Drücken:* eine Reaktion für jeden Knopf (`PressFeedback`): sofort 0,94 und Deckkraft 0,72 (0,1 s), weich zurück (0,3 s); breite Knöpfe und Menüzeilen 0,97;
    Karten federn auf 0,95 ein und dunkeln kurz ab. Eigene CSS-Eigenschaft `scale` (verträgt sich mit Hebung und Einblenden), Übergang `--press-tr` am Knopf;
    während des Drückens wächst der unsichtbare Trefferstreifen (`::before`) so weit, wie der Knopf schrumpft, damit ein Klick am Rand nicht verloren geht.
  - *Knöpfe und Felder:* Kapseln, 48 hoch (`--control-h`), 20 seitlich; Hauptknopf in der Akzentfarbe, zweiter Knopf als Glasfläche, Symbolknopf rund 46, gesperrt 50 %;
    `.sm` nur in Werkzeugleisten, `.xl` nur für *Abspielen*. Felder gleich hoch wie die Knöpfe (Anmeldung, Seerr), mehrzeilige behalten ihre Form;
    fehlerhafte Eingabe (`.invalid` oder `aria-invalid`) mit Kontur 1,5 in der Fehlerfarbe.
  - *Glas mit Weichzeichner nur an schwebenden Bedienelementen* (Kopfleiste, Navigation, Menüs, Hinweise, Pfeile der Reihen, Seitenpunkte, Tab-Leiste; Entscheidung E11):
    Segment-Schalter, Suchfeld, Felder, Knöpfe und die Abdunklung hinter Fenstern sind ohne `backdrop-filter`.
  - *Zustände:* ein Baustein `pageStatus()` in `ui.js` für Leer, Fehler (mit *Erneut versuchen*, während des Versuchs gesperrt) und Hinweis mit Hauptaktion; als ganze
    Seite in der Mitte des Inhaltsbereichs, der Knopf 18 darunter verschiebt den Hinweis nicht, die Fläche fängt keine Klicks ab; `inline` im Inhalt. Keine Seite baut
    ihren Leer- oder Fehlerzustand selbst (Startseite, Mediathek, Suche, Detailseite, Verwaltung). Laden zeigen die Seiten weiter mit Platzhaltern in Form des Inhalts.
    Mediathek: scheitert das Nachladen, bleibt das Geladene und der Fehler steht am Ende der Liste; nach einem Fehler lädt nichts von selbst nach.
  - Szenario `page-status.js`; Farbfelder und Schalter in `accent-look.js`.

## Konto, Profile und Quick Connect (seit 1.2.7)

Angeglichen an die Apple-App (Plan P8; Regeln in `src/shared/quick-connect.js` und `src/shared/backend.js`, Oberfläche in `views/login.js`, `views/quick-connect.js`,
`views/connect-parts.js` und *Einstellungen › Konto*):

- **Anmeldung:** Marke (Logo 132, Schriftzug *JELLYCLOUD*, ein Satz), drei Kapselfelder ohne Beschriftung darüber, *Anmelden* erst mit Adresse und Benutzer,
  *Mit Quick Connect anmelden* als zweiter Knopf. Ein Fehler markiert das betroffene Feld (Adresse oder Benutzer und Passwort). Quick Connect ersetzt die Maske:
  Glaskarte (Rundung 22) mit dem Code in sechs Ziffernkacheln (42 × 54), „Warte auf Bestätigung …“, *Zurück* bringt die Maske mit den Eingaben wieder.
  Beim Hinzufügen steht *Abbrechen* oben links.
- **Quick Connect für andere Geräte** (im **Profilmenü** am Profilsymbol, seit 1.2.8; in 1.2.7 unter *Einstellungen › Konto*): den sechsstelligen Code eingeben, den ein anderes Gerät
  unter „Mit Quick Connect anmelden“ zeigt, und *Bestätigen* (`POST /QuickConnect/Authorize?code=&userId=`). Die Maske liegt über der ganzen App (darunter
  verdeckt, gesperrt und ohne Tastenkürzel, der Trailer der Startseite hält an), zeigt immer, **als wer und wo** angemeldet wird, und meldet: Code ungültig oder
  abgelaufen, schon bestätigt, Quick Connect am Server aus (mit *Erneut prüfen*), Server nicht erreichbar, keine Antwort in der Frist, Anmeldung abgelaufen.
  Eine Bestätigung zur Zeit; ein spätes Ergebnis nach dem Schließen ändert nichts. **Der Code wird nirgends gespeichert oder protokolliert** und ist nach dem
  Erfolg und beim Schließen weg.
- **Profile:** eigener Name (nur auf diesem Gerät), neue Serveradresse nur für **denselben** Server (gleiche Kennung aus `/System/Info/Public`, die Anmeldung gilt
  dort; die Anmeldung geht nie an einen Server mit anderer Kennung); Name, Seerr-Sitzung und Reihen der Startseite ziehen mit. Entfernen meldet das Profil mit
  seiner eigenen Anmeldung am Server ab (Rückfrage). *Abmelden* fragt nach und erklärt, dass nur dieses Profil mit seiner Seerr-Anmeldung geht.
- **Verbindungsprüfung** (`checkConnection`): Jellyfin `/Users/Me` und Seerr `/status` + `/auth/me` nebeneinander, je Dienst **eine** Frist von 30 s, kein
  Wiederholen, keine Doppelanfragen; bei Netzfehlern wird nichts gelöscht. Anlässe: Start, Profilwechsel, Rückkehr in die App (Fenster wieder sichtbar).
  Seit 1.2.9 wartet der Start nur auf Jellyfin (`checkConnection({ seerr: false })`), Seerr meldet sich über `seerrCheck` nach.
  Der Stand steht unter *Konto › Verbindung*; eine abgelehnte Anmeldung führt zur Anmeldung wie jedes 401.
- **Start ohne Server:** statt der Anmeldung „Server nicht erreichbar“ mit *Erneut versuchen* und dem Weg zu einem anderen Profil; die Anmeldung bleibt.
- Szenario `quick-connect.js`; Unit-Tests `quick-connect.test.js` (13 Fälle der Apple-App), `profiles.test.js`, `server-address.test.js` (7 Fälle der Apple-App).

## Einstellungen

Elf Bereiche, orientiert an dem, was Infuse, VLC, Plex und mpv-Frontends anbieten:

| Bereich | Auswahl |
| --- | --- |
| Erscheinungsbild | Design (Midnight, Graphite, AMOLED, Midnight Blue), Akzentfarbe (Farbfelder, Farbwähler, Hex), **Ambient Glow**, Postergröße, Glas-Effekte, Sprache |
| Startseite | **Banner** (an/aus, wechselt automatisch, Folien 3 bis 10), **Top 10** (Zeitraum, „Aktuell“) und **Reihen** (jede ein- und ausschaltbar, mit Pfeilen umsortieren, je Profil; ohne Seerr stehen die Seerr-Reihen gesperrt da), Zurücksetzen |
| Bild & HDR | HDR-Ausgabe, Tone-Mapping-Verfahren, Spitzenhelligkeit, Hardware-Dekodierung, Grafik-API (D3D11/Vulkan), Skalierungsqualität, Video-Sync, Bewegungsglättung, Debanding, Zeilensprung, Helligkeit/Kontrast/Sättigung/Gamma |
| Ton | Ausgabegerät (mit Anzeige des erkannten Geräts), Kanäle (Auto/Stereo/5.1/7.1), Passthrough (nur digitale Ausgänge), WASAPI exklusiv, Nachtmodus |
| Sprache & Untertitel | Audiosprache, Untertitel-Modus (Server/Aus/Erzwungen/Immer/Smart), Untertitelsprache, Größe, Position, Farbe, Umrandung, Hintergrundkasten, Fett, Schriftart, ASS-Stil, Live-Vorschau |
| Wiedergabe | **Trailer** (automatisch, stumm starten, Verzögerung, Text ausblenden, Lautstärke, Qualität bis 4K), nächste Folge automatisch, Intro/Abspann überspringen (Button/Auto/Aus), Countdown an den Knöpfen (6 s), Rücksprung beim Fortsetzen, Vollbild beim Start, Sprungweiten, Mausrad, Pause beim Minimieren, Bildschirm anlassen |
| Netzwerk | Qualitätsgrenze, Transcoding erlauben, Puffergröße, Vorausladen, selbstsignierte Zertifikate |
| Anfragen (Seerr) | Verbindung zu Seerr **für das aktive Profil**: Stand mit Hinweis, Adresse (vorbelegt), Anmeldung mit einem Jellyfin-Konto (vorbelegt, änderbar), *Erneut prüfen*, *Trennen* mit Rückfrage, *Erneut anmelden* bei abgelaufener Sitzung |
| Discord | **Rich Presence** (zeigt, was du schaust): Schalter, Verbindung testen, Statuszeile, **Name in Discord** (frei wählbar, Knopf *Servername*), Poster-Quelle (Automatisch/TMDB/Server/Kein), Titel verbergen, Link zur Titelseite (Knopf und anklickbarer Titel), optional eine eigene Application-ID mit Anleitung |
| Allgemein | mpv-Status (nur Anzeige), **mit Windows starten**, **minimiert starten**, Fenster merken, Spoiler-Schutz, Bildcache leeren, alles zurücksetzen |
| Konto, Info | **Aktuelles Profil** (Server, Benutzer, Adresse, *Verbindung*), **Profile** (höchstens **vier** je Gerät wie in der Apple-App; ein gemerktes Profil meldet sich immer neu an, ältere über der Grenze bleiben; ein Tipp öffnet *Name*, *Serveradresse*, *Wechseln*, *Entfernen*), *Server oder Profil hinzufügen*, *Abmelden* mit Rückfrage (Quick Connect für andere Geräte liegt im Profilmenü); Tastenkürzel |

## Ton-Ausgabe und Kanalerkennung

Surround-Ton auf einer Stereo-Anlage führte früher zu Stille: Ein Bitstream (AC3/DTS) kommt bei Geräten ohne Decoder nicht an, und Mittel-/Surround-Kanäle
landen auf nicht vorhandenen Lautsprechern. `src/main/audio-output.js` fragt deshalb beim Start im Hintergrund die Windows-Wiedergabegeräte ab
(Core Audio über einen einmaligen PowerShell-Aufruf, ohne Native-Modul): Kanalzahl des Mixers und Bauart des Ausgangs (Lautsprecher, Kopfhörer, HDMI, S/PDIF ...).
Daraus ergibt sich bei **Kanäle: Auto**:

| Gerät | Ergebnis |
| --- | --- |
| Kopfhörer, Headset, Stereo-Mixer (2 Kanäle) | Stereo-Downmix |
| 6 oder 8 Kanäle (AV-Receiver per HDMI, Surround-Klinke) | Kanalzahl des Geräts |
| Gerät nicht erkannt | wie bisher `auto-safe` (Windows entscheidet) |

Weitere Regeln:

- **Passthrough nur an digitalen Ausgängen** (HDMI, S/PDIF). An Kopfhörern und Lautsprechern bleibt er aus, auch wenn er eingeschaltet ist
  (die Einstellungen zeigen das an). Gewählte Kanäle (Stereo/5.1/7.1) gelten immer.
- **Spurwahl:** Bei Stereo-Ausgabe wird, wenn vorhanden, die Stereo-Spur derselben Sprache genommen (kein Kommentar), sonst die Surround-Spur heruntergemischt.
- **Transcode:** Der Server bekommt bei Stereo-Ausgabe `MaxAudioChannels: 2` und mischt selbst herunter.
- **Rückfall:** Öffnet mpv die Tonausgabe nicht (Gerät lehnt Bitstream, exklusiven Modus oder die Kanalzahl ab) und das Bild läuft trotzdem, schaltet der Player nach
  wenigen Sekunden selbst auf PCM-Stereo im gemeinsamen Modus um und zeigt einen Hinweis.
- **Im Player umschaltbar:** *Audio & Untertitel → Kanäle* (Auto / Stereo / 5.1 / 7.1) wirkt sofort und gilt bis zum Ende der Wiedergabe. Die Technik-Info zeigt, was mpv
  tatsächlich ausgibt (z. B. „stereo · 48 kHz“ oder „Bitstream“).

Grenze: Ob die in Windows eingestellte Lautsprecherkonfiguration der angeschlossenen Anlage entspricht (z. B. 5.1 eingestellt, aber nur zwei Lautsprecher), kann die App nicht wissen.
Dann hilft der Umschalter im Player oder die feste Wahl *Stereo* in den Einstellungen.

## Transcoding

Direct Play bleibt der Normalfall. Läuft über den Server ein HLS-Transcode (Bitratenlimit oder Rückfall), gilt:

- **Spuren und Untertitel wechseln:** Im Transcode steckt nur die angeforderte Tonspur im Strom. Die Spurliste kommt daher vom Server; ein Wechsel lädt den Eintrag an der
  aktuellen Position neu (neue PlaybackInfo, der alte Transcode wird beendet). Die beim Start gewählte Sprache wird gleich mit angefragt, sodass Anzeige und Ton übereinstimmen.
  Textuntertitel liefert der Server als eigene Datei, Bilduntertitel brennt er ein.
- **Qualität im Player:** Der Reglerknopf in der rechten Leiste öffnet *Qualität*: *Original* (Direct Play) oder eine Bitratenstufe unterhalb der Quelle (20, 10, 8, 6, 4, 2 Mbit/s).
  Die Wahl lädt an der aktuellen Position neu, der Server liefert dann einen Transcode. Sie gilt bis zum Ende der Wiedergabe (auch für folgende Folgen);
  die Einstellung *Qualitätsgrenze* bleibt der Standard für den nächsten Start. Ist *Transcoding erlauben* aus, fehlt der Knopf.
- **Automatischer Rückfall:** Scheitert Direct Play beim Öffnen (Format, Server, Netz), fordert der Player einmal einen Transcode an derselben Stelle an
  (nur wenn *Transcoding erlauben* an ist), sonst erscheint die Fehlermeldung.
- **Schnelle Sprünge** (Pfeiltasten, Sprungknöpfe) werden im Transcode zu einem Sprung zusammengefasst, weil jeder Sprung beim Server eine neue Codierung startet.
- **Kurze Netzabbrüche** überbrückt mpv per Reconnect, statt mit einem Fehler zu enden (und so unnötig einen Transcode auszulösen).

## Zurück-Taste und Beenden

Die Bedienung wartet nie auf den Server. *Zurück* (Knopf, Esc, Backspace, Maus-Seitentaste) zeigt sofort einen Ladekreis und beendet mpv, die „Stopped“-Meldung mit der
Position geht im Hintergrund an den Server (Zeitgrenze 8 s). Die Listen „Weiterschauen“ und „Als Nächstes“ laden erst neu, wenn die Position angekommen ist (höchstens 1,5 s Wartezeit,
bei langsamem Server ein zweites Mal danach). Ein Start, der beim Schließen noch lädt, wird still abgebrochen. Beim Beenden der App wartet sie kurz auf die letzte Meldung.

## Detailseite und Kontextmenü

**Seit 1.2.15 (Plan P16, wie `DetailView`, `PlayAction`, `SeasonChoice` und `ItemActions` der Apple-App).**

- **Abspielen:** die Beschriftung sagt, was startet: „Abspielen“, angefangen „Fortsetzen ab 12:40“, bei Serien mit der Folge davor („S1 E4 Fortsetzen ab
  21:09“, „S1 E5 Abspielen“). Dieselbe Regel gilt auf der Seite eines Seerr-Titels, der in der Mediathek liegt (`Format.playLabel` in `src/shared/format.js`).
  Eine Serie startet ihre nächste Folge, sonst die erste Folge der gezeigten Staffel.
- **Staffel beim Öffnen:** die der nächsten Folge (nach Id, sonst nach Nummer), sonst die erste richtige Staffel, nicht die Extras (Staffel 0 steht beim
  Server vorn). Dieselbe Regel nimmt „Abspielen“ einer Serie auf Karten, im Banner und im Kontextmenü (`src/shared/season-choice.js`). Nächste Folge und
  Staffeln lädt die Seite gleichzeitig (vorher nacheinander, die Staffeln zweimal).
- **Knöpfe:** oben Abspielen mit Favorit, Gesehen, dem Warnschild (nur mit Seerr) und *Mehr*; darunter *Von vorn* (nur bei angefangenen Filmen und Folgen)
  und *Trailer* zu gleichen Teilen, so breit wie die Zeile darüber. Favorit und Gesehen nennen, was sie tun („Als ungesehen markieren“).
- **Tags:** vorn **Gesehen** in der Akzentfarbe, dann die Formate und die Wiedergabe (siehe *Tags*). Die Angabenzeile schreibt nur `format.js` (bei Folgen
  „S1 · E3“ vor dem Jahr, bei Serien die Zahl der Staffeln ohne Extras); unter der Handlung stehen die Genres.
- **Informationen** am Ende der Seite, immer offen, statt der aufklappbaren *Technischen Details*: *Allgemein* (Genre, Erschienen, Laufzeit, Freigabe,
  Studio), *Sprachen* (je Tonspur Sprache, Format, Kanäle; Untertitel als Sprachen, jede einmal) und *Datei* der gewählten Version (Version, Video,
  Container und Größe, *Wiedergabe* wie das Tag). Bewusst ohne Datenrate, Farbtiefe und Bildrate (`src/shared/detail-facts.js`).
- **Kontextmenü auf jeder Karte** (Startseite, Mediathek, Suche, Personen, Ähnliche, Folgen der Detailseite; Top 10 am Plakat, nicht an der Ziffer):
  Rechtsklick öffnet es am Mauszeiger, langes Drücken (Android) und die Kontextmenü-Taste bzw. Umschalt+F10 unter dem Plakat. Einträge: *Fortsetzen* bzw.
  *Abspielen*, bei angefangenen Titeln *Von vorn* und *Aus „Weiterschauen“ entfernen* (als ungesehen markiert, Jellyfin kennt kein eigenes Entfernen),
  *Als gesehen/ungesehen markieren*, *Zu Favoriten*/*Favorit entfernen*. Ordner und Personen haben keines. Ein Klick daneben, Escape, das Mausrad und ein
  Seitenwechsel schließen es.
- **Danach stimmt der Stand überall, ohne Neuaufbau** (`itemStateChanged` in `actions.js`): die Startseite holt ihre Reihen neu und tauscht sie in einem
  Zug (Banner, Scrollstelle und die Stelle jeder Reihe bleiben, keine Platzhalter, kein Einsteigen; im Banner folgt nur „Fortsetzen“/„Abspielen“); andere Seiten bauen die Karten des Eintrags an ihrem
  Platz neu; die Detailseite lädt Haken, Tags, *Abspielen* und die Folgen der gezeigten Staffel neu (der Trailer läuft weiter). Seiten im Speicher des
  Routers ziehen nach, die Startseite beim Zurückkehren. Das gilt auch für Gesehen und Favorit auf der Detailseite selbst. Scheitert die Änderung, bleibt alles.
- Tests: `test/season-choice.test.js` (Fälle aus `SeasonChoiceTests`, „Abspielen“ einer Serie gegen einen Server), `test/format.test.js` (dazu
  `PlayAction.label`), `test/detail-facts.test.js` (Informationsblock); 17 Gegenproben. Szenario `item-menu.js` (Port 8986, echte Mausklicks), angepasst
  `subtitles.js`, `trailer.js`, `seerr-issue.js`, `compact-audit.js`. Nur gegen den Mock-Server geprüft; langes Drücken auf einem echten Android-Gerät
  ist nicht geprüft (im Test ein nachgebildetes Ereignis).

## Trailer

Hat ein Eintrag einen YouTube-Link bei den Trailern (Metadaten des Servers), startet auf der Detailseite nach einer Verzögerung der Trailer über dem Hintergrundbild
(*Einstellungen > Wiedergabe > Trailer*: automatisch an/aus, **auch auf der Startseite**, **stumm starten**, Verzögerung 0 bis 10 s, **Text ausblenden nach** 0 bis 60 s, **Lautstärke**, **Qualität**; Standard: an, auch auf der Startseite, stumm, Start **sofort (0 s)**, Ausblenden ab 10 s, Lautstärke **10 %**, bis 4K; bei einem Update ziehen die alten Standardwerte (Start nach 2 oder 8 s, Ausblenden nach 15 oder 20 s, 100 %) mit, eigene Werte bleiben). Die Steuerung ist bewusst schlank: Am Ende der Aktionsleiste (hinter *Abspielen*, *Trailer*, *Gesehen*, *Favorit*, *…*) sitzt nur **ein** runder Lautsprecher-Knopf. Fährt die Maus darüber, **wächst der Knopf nach rechts zu einer Glaskapsel mit dem Lautstärkeregler** (Knopf und Regler sind **ein** Glasteil: die Kapsel hat genau das Glas der Knöpfe, der Knopf selbst ist solange durchsichtig, es gibt keine Naht und keine doppelte Schicht; sie liegt frei über dem Bild,
die Aktionsleiste springt nicht; reicht rechts der Platz nicht, wächst sie nach links). Sie **blendet von selbst wieder ein**: 0,7 s nachdem die Maus weg ist, 2,2 s nach der letzten Bedienung mit Mausrad, Tasten oder Klick (solange die Maus darauf steht oder der Regler gezogen wird, bleibt sie; mit Tastatur: Tab zeigt sie, Pfeiltasten am Regler halten sie offen).
Das Mausrad über dem Knopf stellt die Lautstärke ebenfalls ein (Schritte von 5 %, ganz links = stumm). *Trailer ausblenden*
steht im Menü *…*. Die eingestellte Lautstärke wird gemerkt und gilt für jeden Trailer; stumm schalten ändert sie nicht. Scrollt die Seite aus dem Blick (oder ist das Fenster verdeckt), hält der Trailer an und läuft beim Zurückkommen sofort weiter (dauert es länger als eine Minute, wird der Player ganz abgebaut, um Arbeitsspeicher freizugeben, und beginnt beim Zurückkommen von vorn), und er endet,
sobald ein Film startet oder die Seite verlassen wird. Der Knopf *Trailer* öffnet den Link weiterhin extern.

Freier Blick (wie bei Netflix): Läuft der Trailer sichtbar und es passiert 10 s nichts (einstellbar, 0 = nie), **gleitet der ganze Kopfbereich als ein Block nach unten**: Poster, Titel, Angaben, Beschreibung und Knöpfe
behalten dabei ihren Abstand zueinander, es ist eine einzige Verschiebung auf einem Element (`transform`, läuft auf der Grafikkarte; die Strecke misst `trailer.js` aus der Lage des Posters). Währenddessen blenden Angaben,
Beschreibung, Auswahl und Knöpfe aus, **übrig bleiben nur Poster und Titel/Logo** in dem Streifen am unteren Rand des Bildes (Oberkante des Posters bei rund 60 % der Fensterhöhe, Poster links am Seitenrand, Titel rechts daneben).
Der **Titel rutscht im letzten Teil der Zeit noch ein Stück weiter** (`--tr-ty`, ebenfalls von `trailer.js` gemessen), bis er etwa in der Mitte des sichtbaren Posters steht und noch vor der Abschneidekante endet; die Zeile
direkt unter dem Titel (Tagline) blendet dafür als erste aus, damit er nicht durch ihren Text fährt. Unten
schneidet die stehende Bühne (`.detail-stage`) weich ab (Kante bei 76 bis 84 % der Höhe), vom Poster ist also etwa die Hälfte zu sehen, der Rest des Blocks versinkt wie hinter einem Vorhang, und nichts ragt in die Besetzung
darunter. Das dauert **rund 4 Sekunden** und läuft **wie bei Netflix**: Die Texte gehen schnell (Angaben, Beschreibung, Auswahl und Knöpfe in 1,8 s, die Zeile unter dem Titel in 1,2 s), der Block sinkt in der ganzen Zeit (sanfter Start, abgebremstes Ende, Kante in derselben Zeit), der Titel/das Logo wird dabei **auf 80 % kleiner** (links und mittig bleibt er stehen) und rutscht ab 1,4 s zur Mitte des Posters, und **alles unterhalb der Bühne** (Staffeln, Folgen, Besetzung, Technik) blendet mit den Texten aus; bei Serien lagen die Staffel-Knöpfe sonst über dem abgesunkenen Poster. Der Trailer ist also nach rund 14 s frei. Die Abschneidekante ist eine Maske auf der Bühne
mit zwei registrierten Längen (`@property`), nur in diesem Zustand: sie startet unterhalb des Fensters und fährt in derselben Zeit und Kurve hoch, so springt nichts; beim Zurückkommen geht alles schnell zurück. Das Polster der
Bühne (60 vh) wird durch einen negativen Rand ausgeglichen, die Seite wird dadurch nicht länger. Die Abdunklung links geht ebenfalls, die Kopfzeile bleibt. Mausbewegung (ab etwa 8 Pixeln, kleines Zittern zählt nicht), eine Taste, das Mausrad oder Scrollen
bringt alles zurück, auch mitten im Ausblenden und ohne Sprung (schneller, in 0,45 s); nach weiteren 10 s Ruhe beginnt es von vorn. Das Ausblenden des Trailers oder sein Ende zeigt sofort alles wieder. Die Dauer ist in
`trailer.js` (`fadeSec`) einstellbar, nicht in den Einstellungen.

**Stil beim Ausblenden** (*Einstellungen > Wiedergabe > Trailer*, `trailer.focusStyle`): Der Absatz oben beschreibt *Poster bleibt* (`poster`). Der Standard ist **Logo in die Ecke** (`corner`): Der Kopf bleibt stehen, das **Poster
blendet in 40 % der Zeit aus** (und sinkt dabei 5 % der Fensterhöhe), und das **Logo** (ohne Logo der Titel) **gleitet an die Stelle des Posters in die linke untere Ecke** und wird auf 80 % kleiner. Es startet erst nach 30 % der Zeit (die Angaben
unter ihm sind dann schon fast weg, sonst führe es durch sichtbaren Text) mit sanftem Anlauf und kommt abgebremst an (Kurve `cubic-bezier(0.4, 0, 0.15, 1)`); es erreicht das Poster erst, wenn das schon fast weg ist. `trailer.js` misst die Strecken
(`cornerDistances`: `--tr-tx` auf die linke Kante des Posters, `--tr-ty` so, dass die Unterkante des verkleinerten Logos bei 80 % der Fensterhöhe liegt); alles läuft über `transform` und `opacity`. Zurück (Mausbewegung) geht es in unter 1 s: erst
rutscht das Logo an seinen Platz, dann erscheinen Poster (nach 120 ms) und Texte (nach 150 ms). **Weiter unten gescrollt** (die Seite steht nicht oben, etwa beim Ansehen von Besetzung, ähnlichen Titeln oder Folgen) startet der freie Blick nicht und blendet nichts aus;
erst wer zurück nach oben scrollt, bekommt ihn nach der Ruhezeit. Das Szenario `trailer-corner.js` zeichnet den Ablauf pro Bild auf und prüft ihn (kein Sprung, gleichmäßig in eine Richtung, weicher Anlauf und Ende, Landung in der Ecke, Logo fährt nicht durch Poster
oder sichtbaren Text, sauberes Zurückkommen).

Qualität: Einstellbar sind *Bis 4K* (Standard), *Full HD* und *720p*. Die Einbettung bekommt einen festen Rahmen in der Größe der Stufe (4K: 3840 × 2160, auf die Bildfläche herunterskaliert), weil YouTube die Stufe
nach der Größe des Players wählt, und wird ausdrücklich um die Stufe gebeten (*hd2160*, *hd1080*, *hd720*). Meldet das Video, welche Stufen es hat, wird die beste bis zur eingestellten angefordert (ein Video ohne 4K läuft in
seinem Besten). Der Trailer blendet erst ein, wenn die Einbettung mindestens 1080p (bei Full HD und 720p: 720p) meldet, spätestens nach 9 s, damit der unscharfe Anfang nicht zu sehen ist; 4K baut sich danach auf. Mehr als YouTube liefert
(Bandbreite, Auflösung des Uploads) lässt sich nicht erzwingen. 4K braucht eine schnelle Leitung und einen Rechner, der es flüssig dekodiert; ruckelt es, hilft *Full HD*.

**Kein Nebel vor dem Trailer:** Über dem Hintergrundbild liegt eine Abdunkelung (Seitenfarbe links, Schleier oben und in der Mitte), die das Bild ruhig wirken lässt, den laufenden Trailer aber trüben würde. Sie besteht aus
registrierten Zahlen (`@property`, `--sh-l` links, `--sh-t` oben, `--sh-m` Mitte, `--sh-p`/`--sh-e` Lage der unteren Stufen) und blendet in 0,9 s ab, sobald der Trailer sichtbar ist: links bleiben 26 % statt 82 % Seitenfarbe, oben und
in der Mitte 0 %, der Übergang unten in die Seite beginnt erst im unteren Viertel. Dazu bleibt ein schwacher dunkler Streifen links (höchstens 34 % Schwarz) und ein Schatten am Text, damit Titel und Beschreibung auch über hellen
Szenen lesbar sind. Im freien Blick geht auch der Streifen und die Seitenfarbe (0 %), nur der Übergang unten bleibt.

**Auf der Startseite** spielt das große Banner den Trailer des gezeigten Titels ab (bei Folgen den der Serie; die YouTube-ID wird beim Wechsel zur Folie geholt, nicht für die ganze Liste). Im Banner läuft der Trailer höchstens in Full HD (steht *Bis 4K*, gilt dort 1080p; das Banner ist nie größer, 4K wäre nur Last), ohne Netz (`navigator.onLine`) startet er gar nicht, und das Bild darunter hört auf zu zoomen. Das Banner bleibt dann auf der
Folie stehen (kein Zeitbalken an den Punkten), bis der Trailer zu Ende ist, und geht danach nach 1,2 s zur nächsten; lässt er sich nicht abspielen (kein YouTube-Link, gesperrt, Fehler), gilt wieder die übliche Zeit (9 s). Der Ton-Knopf
sitzt hinter *Details*. **Nichts verschwindet:** Label, Titel/Logo, Angaben, Beschreibung und Knöpfe bleiben im Banner immer stehen (den freien Blick mit Ausblenden gibt es nur auf der Detailseite); die Abdunklung ist dort nur leichter
(links 36 % statt 62 %, oben 22 % statt 45 %, unten bleibt der Übergang in die Seite) und der Text hat einen stärkeren Schatten. Wechselt man zu einer anderen Seite, endet der Trailer; die
Startseite bleibt im Speicher des Routers, der ihr dafür `deactivate()` und beim Zurückkommen `activate()` meldet (der Trailer der aktiven Folie startet dann neu). Schalter: *Auch auf der Startseite*.
**Glas-Knöpfe ohne Weichzeichner:** Seit 1.1.0 haben **alle** Knöpfe, Reiter (auch die Staffel-Reiter der Serienseite, dort zeigten sie denselben Streifen an den letzten Bildpunkten am Rand), Auswahlfelder und Rundknöpfe (`.btn`, `.tab`, `.chip-btn`, `.opt`, `.tool`) keinen Weichzeichner; nur die Kopfleiste und die Pfeile der Reihen behalten ihn. Zuvor galt es für die Glas-Knöpfe der Aktionsleiste (Detailseite), die Auswahlfelder der Filmseite und die Knöpfe im Banner der Startseite, in jedem Zustand: ohne Trailer, solange er noch unsichtbar lädt und läuft, und nach dem Einblenden. Der Weichzeichner liest das laufende Video hinter sich und zeigte beim Darüberfahren einen senkrechten, geradlinigen Streifen im Knopf (Kachelfehler der Grafikkarte, in der VM ohne GPU nicht nachstellbar); das Video läuft schon unsichtbar, bevor der Trailer einblendet, deshalb trat der Streifen auch davor auf. Die Glasfläche (Lichtkante, Verlauf) bleibt, steht der Trailer im Bild, wird sie fest leicht dunkel getönt. Aktive Knöpfe (Favorit, Gesehen) behalten ihre Akzentfarbe. Szenario: `tools/shots/trailer-buttons.js`.

**Keine Naht in der Trailer-Mitte:** Der Rahmen der Einbettung (4K: 3840 × 2160) wird auf die Fläche herunterskaliert. Fiel die Mitte des Rahmens bei diesem Maßstab zwischen zwei Bildpunkte, stand beim Fortsetzen des Trailers (zum Beispiel nach einem verdeckten Fenster, wenn YouTube sein Pausen-Symbol einblendet) eine dünne dunkle Linie quer durchs Bild. `fit()` in `trailer.js` legt den Maßstab deshalb auf ein Raster, bei dem die halbe Rahmenbreite und -höhe auf ganzen Bildpunkten liegen (4K: Vielfache von 1/120, höchstens rund 2 % größer, das Bild bleibt deckend; berücksichtigt die Windows-Skalierung `devicePixelRatio`), und setzt die Rahmenmitte auf einen ganzen Bildpunkt (`--tr-cx`/`--tr-cy`). Gemessen mit `tools/shots/trailer-resume.js`: vorher dunkelste Zeile 0,85 bis 0,89 der Nachbarzeilen genau in der Mitte, nachher 0,997.

**Kein Play-/Pause-Symbol von YouTube:** Die Einbettung blendet bei jedem Anhalten und Fortsetzen (`pauseVideo`/`playVideo`) ihre Steuerfläche ein: den grauen Kreis mit Pause-Zeichen in der Bildmitte (je nach Rechner mehrere Sekunden lang) und den Ladekreis. Dafür gibt es keinen Einbettungs-Parameter, und die Oberfläche kommt als fremde Seite nicht an den Rahmen heran. Der Hauptprozess aber darf Code in jeden Rahmen schicken: `quietEmbedFrame()` in `main.js` hängt jedem Rahmen der Adresse `https://www.youtube-nocookie.com/embed/…` ein Stylesheet an (`document.adoptedStyleSheets`, `display: none` für `player-middle-controls`, `.ytPlayerControlsContainerHost` und die klassischen Elemente `.ytp-bezel`, `.ytp-large-play-button`, `.ytp-spinner` u. a.). Das geschieht schon beim Übernehmen der Navigation (`did-frame-navigate`, der Rahmen ist da noch leer) und noch einmal nach dem Laden (`did-frame-finish-load`), also vor dem ersten Bild des Players; mehrfaches Einschleusen hängt nichts doppelt an. Das Video und die Schnittstelle (`postMessage`) bleiben unberührt, ein eigener Skriptkontext in fremden Rahmen (`nodeIntegrationInSubFrames`) ist nicht nötig, Sandbox und Kontext-Isolierung der Oberfläche bleiben wie sie sind; Fehler beim Einschleusen werden still abgefangen. Deshalb halten Fenster verdeckt oder Seite aus dem Blick den Trailer einfach an (`pauseVideo`) und setzen ihn beim Zurückkommen fort (`playVideo`, gut 300 ms, derselbe Player, Ebene bleibt sichtbar). Gemessen im Rahmen selbst (`WebFrameMain.executeJavaScript`): ohne Stylesheet liegt die Sichtbarkeit der Mittelknöpfe nach dem Fortsetzen gut 4 s lang bei 1,0, mit Stylesheet in jeder Messung bei 0, auch im zweiten, neu angelegten Rahmen. Szenarien: `tools/shots/trailer-symbol.js` (mit Gegenprobe ohne Stylesheet) und `tools/shots/trailer-resume.js`. Hinweis: Die Klassennamen gehören YouTube; ändert YouTube sie, kommt das Symbol zurück, bis die Liste in `main.js` (`EMBED_HIDE_CSS`) angepasst ist.

**Kein Dauerlauf:** Ein Trailer läuft pro Besuch nur **einmal**. Die Einbettung hat weder `loop` noch `playlist`; ist der Trailer zu Ende, wird der Player ganz entfernt (sonst könnte ihn ein Zurückscrollen, ein Fensterwechsel oder `playVideo` neu starten) und
das Hintergrundbild bleibt. Im Banner merkt sich jede Folie, dass ihr Trailer schon lief: beim nächsten Durchlauf des Karussells bleibt es bei Bild und Zeitbalken. Ein neuer Besuch (Seite neu geöffnet, zurück auf die Startseite) spielt den Trailer wieder.

**Haarlinie am unteren Rand:** Bild, Trailer und Abdunklung sind eigene Ebenen und werden (vor allem während die Seite einblendet, und bei Windows-Skalierung wie 125 %) auf unterschiedliche Bildpunkte gerundet; dann blitzt eine Zeile in den Farben des Bildes über der
Unterkante von Banner beziehungsweise Hintergrund der Detailseite. Gegenmittel: die Höhen sind ganze 4-px-Schritte (`round(down, …, 4px)`, die Kante liegt bei 100 bis 200 % Skalierung auf einem Bildpunkt) und ein Band in der Seitenfarbe (`.hero-host::after`, `.detail-body::before`, ±3 px)
deckt die Kante ab.

Technik: YouTube-Einbettung ohne Cookies (`youtube-nocookie.com`) in einem eingeschränkten Rahmen (`sandbox`, nur Autoplay erlaubt), gesteuert per `postMessage` ohne fremdes Skript; im Rahmen blendet der Hauptprozess nur die Steuerfläche der Einbettung per Stylesheet aus (siehe „Kein Play-/Pause-Symbol von YouTube“).
YouTube verlangt für Einbettungen einen Referer (sonst Fehler 153). Die Oberfläche liegt unter `file://` und sendet keinen, deshalb setzt der Hauptprozess für genau diese eine Anfrage
`Referer: https://jellycloud.player/`. Nur YouTube-Links werden abgespielt, Trailer als Datei auf dem Jellyfin-Server nicht. Zeigt YouTube einen Fehler, bleibt es still beim Hintergrundbild.

## Anfragen mit Seerr

*Einstellungen > Anfragen (Seerr)* verbindet die App mit Seerr (Jellyseerr / Overseerr): mit dem **Jellyfin-Konto** (das Passwort wird nicht gespeichert, nur das Session-Cookie von Seerr, verschlüsselt)
(einen API-Schlüssel nimmt die App seit 1.2.4 nicht mehr, wie die Apple-App). Die Verbindung gilt **je Profil**: jedes Profil meldet sich selbst an, ein Profilwechsel nimmt sein eigenes Seerr mit; gespeichert werden Adresse, Benutzername, die Jellyfin-Kennung von Seerr und die verschlüsselte Sitzung. Nach *Trennen* bleibt die Adresse vorbelegt. Die Zugangsdaten bleiben im Hauptprozess. Ist Seerr verbunden, zeigt die **Suche** unter den Treffern der Bibliothek die Gruppe *Nicht in der Bibliothek* (seit 1.2.13; vorher *Bei Seerr anfragen*):
Titel, die es noch nicht gibt, mit Poster von TMDB (über das App-Protokoll, nur feste Größen) und der Schaltfläche *Anfragen*. Bereits Angefragtes, in Bearbeitung Befindliches oder teilweise Verfügbares
zeigt seinen Stand als **Tag** statt der Schaltfläche (Bezeichnung und Farbe allein aus `src/shared/seerr-state.js`, gezeichnet mit den Farbpaaren der Tags: grün *Verfügbar*, Türkis-Blau *Teilweise*, blau *Angefragt* / *Genehmigt*, orange *In Bearbeitung*, Orange-Rot *Abgelehnt* / *Fehlgeschlagen*; überall gleich wie in der Apple-App), Verfügbares fehlt (es steht schon in der Bibliothek). Bei Serien öffnet *Anfragen* die Staffelauswahl (seit 1.2.11). Fehler sind verständlich (Kontingent, schon angefragt, Sitzung abgelaufen);
eine abgelaufene Seerr-Sitzung führt **nicht** zur Jellyfin-Anmeldung, sondern zu einem Hinweis mit Weg in die Einstellungen.

**Seerr je Profil und vier Zustände (seit 1.2.9, Plan P10, wie die Apple-App):**
- *Einstellungen › Anfragen (Seerr)* (nach `SeerrSection`): nicht eingerichtet Adresse (die zuletzt verwendete, auch von einem anderen Profil), **Jellyfin-Konto**
  (vorbelegt mit dem des Profils, änderbar) und Jellyfin-Passwort, *Verbinden* erst mit allen dreien; eingerichtet der **Stand** mit Symbol und Hinweis (*Verbunden*,
  *Seerr ist nicht erreichbar*, *Anmeldung nicht mehr gültig*, *Verbindung fehlgeschlagen*), *Adresse*, *Anmeldung: Jellyfin-Konto (Name)*, *Erneut prüfen* und
  *Trennen* mit Rückfrage. Ist die Anmeldung abgelaufen, steht darunter *Anmeldung abgelaufen* mit Konto und Passwort und *Erneut anmelden*. Das Passwort bleibt
  nach keinem Versuch im Feld. Die Seite prüft beim Öffnen und, solange sie offen ist, still alle 20 s.
- **Anmeldung:** gemerkt werden nur die Sitzung (`connect.sid`, verschlüsselt), der Name des Jellyfin-Kontos und dessen Kennung, wie Seerr sie unter `/auth/me`
  nennt; eine Anmeldung, zu der Seerr kein Jellyfin-Konto nennt, gilt nicht. Erneutes Anmelden meldet die alte Sitzung bei Seerr ab.
- **Fremde Sitzung:** meldet Seerr später unter der gespeicherten Sitzung ein anderes Jellyfin-Konto als das gemerkte (bei Einträgen ohne gemerktes Konto: das des
  Profils), meldet die App sie bei Seerr ab, verwirft sie und bietet *Erneut anmelden* an; Adresse und Konto bleiben. Ohne Sitzung geht keine Anfrage mehr an Seerr.
- **Rechte** kommen allein aus `/auth/me` (Nummer, Name, Bitfeld), bei jeder Prüfung neu und nur im Speicher; unbekannte Rechte schalten nichts frei.
- **Zustände im Reiter *Anfragen*:** nicht eingerichtet (*Seerr verbinden*), verbunden, nicht erreichbar (*Erneut versuchen*), Anmeldung abgelaufen (*Erneut
  anmelden*, führt in die Einstellungen); ein Ausfall oder Ablauf löscht nichts, Jellyfin läuft unberührt weiter. Der Reiter sieht beim Öffnen nach.
- **Prüfung** (`connection.js`): beim Start wartet die App nur auf Jellyfin; Seerr meldet seinen Stand nach (ein hängendes Seerr hielt den Start bis 1.2.8 bis zu
  30 s auf). Profilwechsel, Trennen und Verbinden verwerfen Sitzung, Rechte und die gemerkte Trend-Liste des vorigen Stands; eine Antwort, die noch zum vorigen
  Profil gehört, kommt nicht mehr an (`SEERR_STALE`). Abmelden, Profil entfernen und Trennen melden die Sitzung auch bei Seerr ab.
- **Sprache:** Titel, Suche, Trends und Personen fragt die App mit `language=<Kurzform>` (Sprache der App, bei *automatisch* die des Systems); Anmeldung, Rechte
  und Anfragen ohne. Alle Anfragen an Seerr ohne Cookie-Speicher und ohne Zwischenspeicher der Antworten (`cache: no-store`), Frist 20 s.
- Tests: `test/seerr-profile.test.js` (Fälle aus `SeerrProfileTests` und die plattformunabhängigen Fälle 1, 2, 9 bis 11), Szenario `seerr-states.js` (Port 8993).
  Nur gegen den Mock-Seerr geprüft, nicht gegen einen echten Seerr-Server.

**Reiter *Anfragen* (seit 1.2.10, Plan P11, wie `RequestsView` der Apple-App):**
- **Plakatraster** wie Filme und Serien, der Stand als Tag oben links (Bezeichnung und Farbe aus `seerr-state.js`), darunter Titel und eine kurze Angabe
  (Jahr, bei Serien die angefragten Staffeln, sonst *Film*/*Serie*, 4K, im Verwalten „von Name“). Titel, Jahr und Bild holt der Reiter je Plakat nach
  (`seerrMedia`, höchstens sechs zugleich, gemerkt je Profil und Seerr-Sitzung).
- **Meine Anfragen** und, nur mit dem Recht alle zu sehen (*Anfragen verwalten* oder *Anfragen ansehen*), **Verwalten** (Wahl neben der Überschrift);
  wird das Recht entzogen, schließt *Verwalten*. Anzeige **Offen / Abgeschlossen** („offen“ = ausstehend, gescheitert, genehmigt und noch nicht da).
- **Aktionen** nur nach den Rechten aus `/auth/me` (`actionsFor` in `src/shared/seerr-requests.js`): ohne *verwalten* nur *Anfrage zurückziehen* für eigene
  wartende; mit *verwalten* *Genehmigen*, *Ablehnen* (wartende), *Erneut versuchen* (gescheiterte) und abgesetzt *Anfrage entfernen* (jede). Erreichbar über den
  runden Knopf oben rechts auf dem Plakat (am Desktop beim Zeigen, auf dem Handy immer), das Kontextmenü (Rechtsklick, langes Drücken, Kontextmenü-Taste).
  Zurückziehen, Ablehnen und Entfernen fragen nach (Entfernen: „Der Titel und seine Dateien bleiben unberührt“); eine Aktion je Anfrage zur Zeit, das Plakat
  ist währenddessen gesperrt. Lehnt Seerr eine Aktion ab (auch mit 401), steht „Das ist mit deinem Seerr-Konto nicht möglich …“ da, und die App sieht still
  nach, ob die Anmeldung noch gilt; danach lädt die Liste neu, Startseite und Suche verwerfen ihren gemerkten Stand.
- **Antippen** öffnet den Titel: liegt er in der Mediathek (über die TMDB-Nummer), die Detailseite, sonst das Seerr-Fenster.
- **Blättern zu je 50** (`createPaging`): die nächste Seite, wenn das Ende in Sicht kommt, und von selbst, solange die gewählte Anzeige den Bildschirm nicht
  füllt (24 Plakate); doppelt Geliefertes zählt einmal, eine leere oder nichts Neues bringende Seite beendet das Blättern. Neuladen (F5, Knopf, nach einer
  Aktion) holt in einem Abruf so viel, wie geladen war; Ansicht und Anzeige bleiben gemerkt.
- Tests: `test/seerr-requests.test.js` (die sechs Fälle aus `SeerrRequestPagingTests`, Lesen einer Anfrage, Fälle 3 und 4 aus `seerr-integration.md` gegen den
  Test-Seerr), Szenario `requests-tab.js` (Port 8991). Nur gegen den Mock-Seerr geprüft; die Kompaktansicht mit Anfragen ließ sich nicht automatisch prüfen
  (das Desktop-Programm wird nie kompakt, im Browser-Test liest Seerr kein Cookie), geprüft ist nur die Regel für den Aktionsknopf.


**Seite eines Titels (seit 1.2.11, Plan P12, wie `SeerrDetailSheet` der Apple-App; kein Dialogfenster mehr):** Ein Klick auf eine Seerr-Karte (Suche, *Filme im Trend*,
*Details* im Banner, Reiter *Anfragen*, weitere Titel einer Seite) öffnet den Titel über **einen** Weg (`src/renderer/js/seerr-open.js`): liegt er in der Mediathek
(Abgleich über die TMDB-Nummer, nie über den Titel), seine Detailseite dort, sonst seine Seite bei Seerr (`#/seerr/<art>/<nummer>`, `views/seerr-title.js`, im Verlauf
wie jede Seite; „Zurück“ führt dorthin, wo man herkam). Ein Öffnen zur Zeit. Die Seite folgt der Detailseite: Bildkopf (TMDB `w1280`, Trailer im Hintergrund wie
dort), Plakat, Titel, Tagline, Angabenzeile (Jahr, Freigabe für das Land des Geräts, in Deutschland „FSK 16“, Laufzeit, Staffeln, Bewertung), der Stand als Tag,
die Knöpfe, Handlung und Genres; darunter **Staffeln** mit Folgen, Jahr und Stand, die **Besetzung** (vorn Regie bzw. die Schöpfer und Drehbuch, je Person einmal mit
allen Aufgaben, dann die Darsteller mit Rolle, hinten Produktion und Musik), **weitere Titel** (Filmreihe, *Empfohlen*, *Ähnliche Titel*, je mit Stand) und die
**Informationen** in Gruppen (Allgemein, Bewertungen mit TMDB und IMDb samt Stimmen, Produktion; `src/shared/seerr-facts.js`). Was schon bekannt ist, steht sofort da.
- **Hauptknopf:** *Abspielen*, wenn der Titel in der Mediathek liegt (bei Serien die nächste Folge), sonst *Film anfragen*, *Serie anfragen* bzw. *Weitere Staffeln
  anfragen*; neben *Abspielen* ist die Anfrage weiterer Staffeln ein zweiter Knopf. **Nur allgemeine Anfragen, nie 4K**, auch mit dem Recht dazu.
- **Serien:** die **Staffelauswahl** (`views/season-chooser.js`) zeigt vorhandene und angefragte Staffeln mit ihrem Stand, aber nicht wählbar; offene sind
  vorausgewählt, der Fokus liegt auf der ersten offenen (ein zweiter schneller Tastendruck fragt nicht gleich alle an). Angefragte Staffeln stehen bei Seerr zunächst
  nur in den Anfragen des Titels und gelten als angefragt, solange die Anfrage nicht abgelehnt ist. Nennt Seerr keine Staffeln, wird die ganze Serie angefragt.
- **Hinweis unter den Knöpfen:** das **Kontingent** vorher („Noch 2 von 3 Anfragen in 7 Tagen.“; erschöpft ist der Knopf gesperrt), fehlendes Recht („Dein
  Seerr-Konto darf keine Serien anfragen.“, auch bei offenen Staffeln einer teilweise vorhandenen Serie), gesperrte Titel, Fehler. Ein zweiter Klick während einer
  Anfrage zählt nicht; bleibt die Antwort aus, liest die Seite zuerst den Stand bei Seerr, statt erneut zu senden (angekommen erkennt sie an den gewählten
  Staffeln bzw. am Stand). Danach verwerfen Startseite, Suche und Anfragen ihren gemerkten Stand.
- Die Karten der Suche und der Trends fragen Filme weiter direkt an; bei Serien öffnet ihr *Anfragen* die Staffelauswahl.
- Tests: `test/seerr-title.test.js` (die acht Fälle aus `SeerrDetailsTests`, die Fälle 5 bis 8 und 11 aus `seerr-integration.md`), Szenarien `seerr-title.js`
  (Port 8990) und `seerr.js`. Nur gegen den Mock-Seerr geprüft.

**Personen (seit 1.2.12, Plan P13, wie `PersonView` und `CastRow` der Apple-App):** Die Besetzung der Detailseite (Schauspiel, Regie, Gastrollen, höchstens 30)
und der Seite eines Seerr-Titels ist **eine** Reihe (`views/cast-row.js`): jede Person mit Kennung ist ein Verweis auf ihre Seite (Druck wie die Karten, per
Tastatur erreichbar), ohne Kennung wird sie nur angezeigt. Bis 1.2.11 suchte ein Klick in der Mediathek nur den Namen, unter Seerr-Titeln ging gar nichts.
- **Seite einer Person** (`views/person.js`, `#/person/<kennung>` aus der Mediathek, `#/person/tmdb/<nummer>` aus Seerr; Hintergrund wie die Mediatheken): Foto oder
  Initialen, Name, Lebensdaten („Geboren am 7. April 1980 in Norwood, London“, „46 Jahre alt“ bzw. „Gestorben am … (78 Jahre)“), die Zahl der Titel in der
  Mediathek, Biografie (*Mehr*); darunter die Titel der Mediathek (*Filme*, *Serien*, *Folgen* für Gastrollen in Serien, die nicht als Ganzes dastehen) und, mit
  Seerr, die übrige **Filmografie** ohne diese Titel (*Weitere Filme*, *Weitere Serien*, *Hinter der Kamera*; ohne Titel der Mediathek heißen die ersten beiden
  *Filme* und *Serien*). Je Titel eine Karte mit Jahr und Rolle bzw. Aufgabe und dem Stand bei Seerr, das Bekannteste zuerst, gleiche Titel einmal.
- **Zwei Quellen, eine Seite:** Mediathek (Jellyfin) und Seerr werden **nur über die TMDB-Nummer** der Person verbunden, nie über den Namen (`/Persons` sucht nach
  dem Namen, zugeordnet wird über `ProviderIds.Tmdb`). Fehlen der Mediathek Biografie, Geburtstag oder Bild, ergänzt Seerr sie; Vorhandenes bleibt. Hat die
  Person bei Jellyfin gar keine Angaben, bittet ein Administrator den Server **einmal** je Sitzung, sie nachzuladen (nichts wird ersetzt), und die Seite zeigt sie,
  sobald sie da sind. Jellyfins Tage (Mitternacht beim Server, in UTC) landen mit zwölf Stunden Aufschlag auf dem richtigen Tag.
- Eine Anfrage aus der Filmografie aktualisiert nur die Stände der Karten; die Reihen bleiben stehen. Eine unbekannte Person zeigt „Person nicht geladen“ mit
  *Erneut versuchen*.
- Code: `src/shared/person.js` (Lebensdaten, Reihen, Abgleich, Besetzung), `src/shared/seerr.js` (`person`, `filmography`, `crewRole`), `src/shared/jellyfin.js`
  (`getPerson`, `getPersonItems`, `personByTmdb`, `refreshPerson`).
- Tests: `test/person.test.js` (die sieben Fälle aus `SeerrPeopleTests`, die Regeln der Seite, die Person der Mediathek gegen den Test-Server; 13 Gegenproben),
  Szenario `person-page.js` (Port 8989). Nur gegen den Mock-Server geprüft.

**Filme im Trend auf der Startseite:** Ganz unten auf der Startseite steht die Reihe *Filme im Trend, über Seerr*. Sie holt `GET /discover/trending` (Seerr mischt dort Filme, Serien und Personen) und behält nur
die **Filme**: ohne Serien, Personen, Doppelte und gesperrte Titel (Stand 6; gelöschte, Stand 7, bleiben und lassen sich wieder anfragen), bis zu 20, gelesen über höchstens drei Seiten; scheitert eine spätere Seite, bleibt es bei dem, was da ist. Die Karten sind dieselben wie in der Suche (`views/request-card.js`): Poster von TMDB,
*Anfragen*-Knopf bei offenen Titeln, sonst der Stand als Tag (*Angefragt*, *In Bearbeitung*, *Teilweise*, grün *Verfügbar*); ein Klick auf das Poster öffnet die Seite des Titels. Die Liste bleibt zehn Minuten im Speicher der Oberfläche (die Startseite wird etwa nach
jedem Film neu aufgebaut, das soll Seerr nicht jedes Mal fragen); Anfragen aus der Reihe ändern den gemerkten Stand mit. Die Reihe wartet nicht auf die Bibliotheks-Reihen und blockiert sie nicht.
**Seit 1.2.14 (Entscheidung E8, wie die Apple-App)** gibt es die Reihe **nur mit Seerr und nur mit Titeln**: ohne Seerr fehlt sie (kein Hinweis zum Einrichten mehr), bei einem Ausfall oder einer abgelaufenen Anmeldung ebenso (keine leere
Reihe). Ausblenden lässt sie sich wie jede Reihe (*Einstellungen > Startseite > Reihen*); ein früher ausgeschalteter eigener Schalter (`appearance.homeTrending`) wurde beim Update zu „ausgeblendet“ (bei jedem Profil). Die **Trend-Folien im Banner**
und ihre Einstellung sind entfallen: das Banner zeigt nur Neues aus der Mediathek.

**Top 10 Filme und Top 10 Serien (seit 1.2.14, Plan P15, wie `TopTenRow` und `RankingStore` der Apple-App):** welche Titel der **eigenen Mediathek** gerade im Trend liegen. Die Rangfolge kommt von Seerr
(`GET /discover/trending?mediaType=movie|tv&timeWindow=day|week`), gezeigt wird nur, was es in der Mediathek gibt und was das Profil sehen darf (Verzeichnis TMDB-Nummer → Eintrag, schlank mit `Fields=ProviderIds`,
seitenweise), in der Reihenfolge der Trends, höchstens zehn, ohne Ersatzinhalte; dafür liest die App höchstens fünf Seiten. Ein älteres Seerr, das Art und Zeitraum übergeht, liefert die Trends von heute; die Reihe sagt das so.
- **Darstellung:** hohe, schmale Rangziffer hinter dem Plakat (1,2 × Plakathöhe, das Plakat ist 1,12 × so breit wie in den übrigen Reihen und überdeckt die Ziffer seitlich), deckend dunkel gefüllt, mit einem Rand im Farbverlauf und
  einem Schein entlang der Kontur in der Farbe des **Ambient Glow** ihres Bereichs (Top 10 Filme: Filme, Top 10 Serien: Serien; Farbton ±28/34°, ein gewählter Verlauf ist der Verlauf des Randes, Stärke mit der Wurzel der
  Intensität), dahinter ein großer Lichtschein im Glockenabfall. Ohne Ambient Glow ein farbloser Rand ohne Schein. Am Desktop leuchten Rand und Scheine unter dem Zeiger voll, sonst zu 80 %. Rand und Ziffer sind SVG, der weiche Schein
  ist einmal in ein Canvas gezeichnet (als SVG-Filter hielt der Browser je Ziffer zwei große Zwischenflächen vor). Regeln in `src/shared/rankings.js` und `src/shared/glow.js` (`numeralAura`), Oberfläche `views/top-ten.js`.
- **Laden:** die Startseite wartet nie darauf; die Reihen stehen an ihrem Platz (Standard: nach *Als Nächstes*) und füllen sich, sobald die Rückseite antwortet. Die Rangfolge gilt **30 Minuten** je Server, Profil, Seerr und Zeitraum
  (im Hauptprozess), die Einträge selbst (Gesehen, gemerkte Stelle) werden bei jedem Aufbau frisch geholt; *Neu laden* holt auch die Rangfolge neu. **Platzhalter nur beim ersten Laden**; danach stehen die Reihen von vorhin sofort da.
  Ein Profil- oder Seerr-Wechsel verwirft alles, eine späte Antwort des alten Profils kommt nicht mehr an. Scheitert das Laden, bleibt eine schon geladene Liste stehen; sonst fehlen die Reihen. **Ohne Seerr geht keine Anfrage hinaus.**
- **Einstellungen > Startseite > Top 10:** Zeitraum (*Heute*, *Diese Woche*; nur, was das Seerr liefert), Zeile *Aktuell* („Seerr · diese Woche · 7 Filme, 2 Serien“) und ein Fußtext. Ohne Seerr: „Seerr ist nicht verbunden“.
- **Arbeitsspeicher:** gemessen in der VM (Seitenprozess, gleiche Schritte): mit beiden Reihen rund 1 bis 2 MB mehr als ausgeblendet; alle Prozesse zusammen 20 bis 55 MB mehr (Kacheln im Grafikprozess, der in der VM ohne
  Grafikkarte bei jeder Änderung um rund 100 MB schwankt).
- Tests: `test/rankings.test.js` (die Fälle aus `RankingRulesTests` ohne die entfernte TMDB-Anbindung und aus `NumeralAuraTests`, Laden gegen den Test-Server; 16 Gegenproben), Szenario `top-ten.js` (Port 8987). Nur gegen den
  Mock-Server geprüft; die Handy-Ansicht mit Top 10 ist nicht automatisch prüfbar (im Browser-Test kein Seerr).

Technisch: `src/main/seerr.js`, API `/api/v1` (`auth/jellyfin`, `search`, `request`, `issue`, `discover/trending`, `movie/{id}`, `tv/{id}`); die Detailantwort wird auf feste Typen und Längen reduziert (`normalizeDetails`), Bildpfade gelten nur in der Form, die das App-Protokoll annimmt. Alle Anfragen laufen mit `credentials: omit`, damit Chromiums Cookie-Speicher das Seerr-Cookie nicht heimlich
mitschickt (sonst würde eine falsche Anmeldung durch ein altes Cookie akzeptiert und ein Profil sähe das Seerr eines anderen). Getestet gegen einen Mock-Seerr, **nicht** gegen einen echten Seerr-Server.

## Mitteilungen

**Seit 1.2.16 (Plan P17, wie `AppNotifications`, `NotificationsView` und `NotificationCenterModel` der Apple-App).** Seerr meldet einer App keine Ereignisse;
die App erkennt eine Änderung, indem sie die Anfragen liest und mit dem zuletzt gesehenen Stand vergleicht (`src/shared/notifications.js`).

- **Erkennung:** der erste Abgleich eines Profils mit einem Seerr-Server ist still (nur merken). Danach je eigene Anfrage: angefragt → genehmigt,
  verfügbar (nur wenn der Titel wirklich da ist), erste Folgen, abgelehnt, fehlgeschlagen; erneut versucht ist keine Nachricht. Eine eigene Anfrage, die die
  App noch nie gesehen hat und die seit dem letzten Abgleich gestellt wurde, zählt wie eine wartende. Bei Staffeln zählen die angefragten Staffeln, nicht der
  Stand der Serie. **Eigene Entscheidungen sind keine Nachricht** (nennt Seerr den Nutzer als Bearbeiter, auch bei der automatischen Genehmigung); was er in
  der App an einer Anfrage ändert, ebenso. Konten, die alle Anfragen sehen, bekommen „Neue Anfrage“ für wartende Anfragen anderer.
- **Kennung** je Anfrage und Art: dieselbe Änderung ergibt nie zwei Einträge, auch nicht nach einem Neustart; entfernte bleiben entfernt. Höchstens 100.
- **Anlässe statt Dauerabfrage:** bestätigte Verbindung zu Seerr (Start, Profilwechsel, Rückkehr in die App), Laden der eigenen Anfragen im Reiter
  *Anfragen* (deren Liste wird mitverwendet), Öffnen der Übersicht (ausdrücklich), eine eigene Aktion an einer Anfrage, bei offener App höchstens alle 15
  Minuten; sonst liegen zwischen zwei Abgleichen mindestens zwei Minuten. Nie zwei zugleich; was der Nutzer währenddessen liest, entfernt oder einstellt,
  bleibt. Lässt sich der Titel einer Änderung nicht holen, kommt die Nachricht beim nächsten Abgleich. Die Zeit des Abgleichs hat zwei Minuten Spielraum für
  Uhren, die voneinander abweichen.
- **Ort:** kein Reiter. Roter Punkt (#FF453A, 9 px mit Rand) oben rechts am Profilsymbol, im Profilmenü der Eintrag *Mitteilungen* mit „n neue“ (nur mit
  Seerr). Die Übersicht (`#/notifications`, `views/notifications.js`): je Mitteilung eine Karte (Fläche ohne Glas, Entscheidung E11) mit Plakat, Überschrift
  (ungelesen halbfett mit Punkt), Text, Stand als Tag und Zeit („vor 3 Minuten“); Antippen öffnet den Titel (Mediathek, sonst seine Seite bei Seerr) und
  merkt ihn als gelesen; Rechtsklick, langes Drücken und die Menü-Taste: *Als gelesen/ungelesen markieren*, *Entfernen* (statt Wischen); *Mehr*: *Alle
  gelesen*, *Alle entfernen* (ohne Rückfrage, wie die Mitteilungszentrale).
- **Einstellungen › Mitteilungen** (je Profil und Seerr-Server): Hauptschalter (aus: kein Abgleich, kein Punkt, keine Zahl; die Liste bleibt; wieder an:
  der erste Abgleich ist still, nichts aus der ausgeschalteten Zeit kommt nach) und die Arten einzeln, *Neue Anfragen* nur mit dem Recht, alle zu sehen.
  Mitteilungen des Systems kommen mit P18.
- **Ablage:** je Profil und Seerr-Server, Namen als Prüfsummen (keine Adressen, keine Kennungen), keine Zugangsdaten. Windows: `userData\notifications\*.json`;
  Web und Android: eigene Schlüssel `jellycloud.notify.*` im Speicher der Seite (der sichere Speicher der Android-App führt nur die Konfiguration). Gelöscht,
  wenn das Profil entfernt oder abgemeldet wird; Seerr trennen nimmt die Mitteilungen dieses Seerr mit; eine neue Adresse des Servers zieht sie mit.
- **Wortlaut** (`NotificationText` der Apple-App): „Dein angefragter Film ist jetzt verfügbar“, Serien mit ihren Staffeln („Staffeln 2, 3 von „…“ wurden
  deiner Mediathek hinzugefügt.“), „Erste Folgen sind verfügbar“, „Anfrage genehmigt“, „Anfrage abgelehnt“, „Anfrage fehlgeschlagen“, „Neue Anfrage“.
- Tests: `test/notifications.test.js` (die 14 Fälle aus `NotificationRulesTests`, die Fälle aus `NotificationCenterTests` ohne die zu den Mitteilungen des
  Systems, ein Fall durch den echten `SeerrClient`; 25 Gegenproben), zwei Fälle der Rückseite gegen den Test-Seerr in `test/seerr-requests.test.js`, Szenario
  `notifications.js` (Port 8985; 4 Gegenproben an der Oberfläche). Nur gegen den Mock-Seerr geprüft, nicht gegen einen echten Seerr-Server.

## Probleme an Seerr melden

Ist Seerr verbunden, steht auf der Detailseite gleich in der Knopfleiste ein **Warnschild** (Symbol `warning`, runder Knopf wie Gesehen und Favorit, beim Zeigen wie die anderen Knöpfe, Beschriftung „Problem melden“; seit 1.2.15 wie die Apple-App nur dort, nicht mehr zusätzlich im Menü *Mehr*), das ein Fenster öffnet (`views/issue-dialog.js`). Das Fenster fragt nach der **Art** (Video, Audio, Untertitel, Sonstiges, entspricht `issueType` 1 bis 4 bei Seerr) und nimmt einen **freiwilligen Kommentar** (bis 2000 Zeichen) entgegen;
*Melden* ist erst nach der Wahl einer Art möglich. Ohne Kommentar geht ein Ersatztext mit der Art hin („Problem mit Audio (ohne Beschreibung, gemeldet über den Jellycloud Player)“), weil Seerr keine leere Meldung annimmt.

- **Wohin:** Filme und Serien über ihre TMDB-Nummer (`ProviderIds.Tmdb`), Staffeln und Folgen über die Serie dahinter. Bei einer Folge gehen Staffel und Folge mit (`problemSeason`, `problemEpisode`), bei Serie und Film 0 (alle). Die Überschrift nennt, worum es geht („Starfall Station · Staffel 1, Folge 2“).
  Ohne TMDB-Nummer fehlt der Eintrag im Menü (der Titel ließe sich bei Seerr nicht zuordnen), ohne Seerr-Verbindung ebenso.
- **Seerr-Nummer:** Seerr verlangt die eigene Medien-Nummer (`mediaInfo.id`), nicht die von TMDB; der Hauptprozess holt sie beim Melden aus den Details (`/movie/{id}` bzw. `/tv/{id}`). Kennt Seerr den Titel noch nicht (Bibliothek nicht synchronisiert), steht im Fenster der Hinweis,
  die Bibliothek in Seerr zu synchronisieren.
- **Fehler** erscheinen im Fenster, es bleibt offen und der getippte Text geht nicht verloren: kein Recht (403, „Dein Seerr-Konto darf keine Probleme melden“), Titel unbekannt, Seerr nicht erreichbar, abgelaufene Sitzung (Hinweis mit Weg in die Einstellungen, **nicht** die Jellyfin-Anmeldung).
  Schließt man das Fenster, während gesendet wird, und es scheitert, kommt der Fehler als Hinweis oben.
- **Technik:** IPC `seerr:issue` in `main.js` prüft jedes Feld einzeln (Art 1 bis 4, Kommentar gekürzt, Zahlen ganzzahlig), `SeerrClient.reportIssue` in `seerr.js` sendet `POST /api/v1/issue`. Die Oberfläche kennt weder Adresse noch Zugangsdaten von Seerr.
  Szenario `tools/shots/seerr-issue.js` (Mock-Seerr, Port 8897), Einheitentests in `test/seerr.test.js`. Getestet gegen den Mock, **nicht** gegen einen echten Seerr-Server.

## Startseite anpassen

*Einstellungen > Startseite* (Datei `views/settings.js`, Regeln in `src/shared/home-rows.js`, gemeinsam für Hauptprozess und Oberfläche; Werte unter `settings.home`):

- **Banner:** *Banner anzeigen* (aus: die Reihen beginnen gleich unter der Kopfleiste, im Banner laufen keine Trailer und nichts wird dafür geladen), *Banner wechselt automatisch* und *Folien im Banner* (3 bis 10, Standard 6). Das Banner zeigt
  seit 1.2.14 nur Neues aus der Mediathek, Filme und Serien abwechselnd, nur mit Hintergrundbild (wie die Apple-App; keine Trend-Folien, kein Weiterschauen darin).
- **Top 10:** Zeitraum und *Aktuell* (siehe *Top 10 Filme und Top 10 Serien*).
- **Reihen:** Jede Reihe (*Weiterschauen*, *Als Nächstes*, *Neu in <Bibliothek>* je Bibliothek, *Favoriten*, *Top 10 Filme*, *Top 10 Serien*, *Filme im Trend*; so ist auch die Standardreihenfolge wie in der Apple-App: **Weiterschauen und Als Nächstes stehen ganz oben**, dann die Top 10, `TOP_ROWS` in `src/shared/home-rows.js`) hat eine Nummer, einen Schalter und Pfeile nach oben und unten. Gespeichert werden nur die Wünsche (`order`, `hidden`), und zwar **je Profil** (Server und Benutzer, seit 1.2.4 wie in der Apple-App; Banner und Folien gelten für das Gerät): die Reihen bleiben beim Abmelden gespeichert, die bisherigen des Geräts gingen beim Update einmal an jedes gemerkte Profil. Eine neue Bibliothek (oder Reihe) steht hinter der Reihe, hinter der sie in der Standardreihenfolge stünde (seit 1.2.5; vorher ganz unten),
  eine gelöschte lässt die Einstellung wirkungslos stehen. Reihen ohne Inhalt (nichts angefangen, keine Favoriten) fehlen auch eingeschaltet. Ohne Seerr stehen *Filme im Trend* und die Top 10 ausgeschaltet und gesperrt da, mit dem Grund darunter; ihr Platz und ihr Schalter bleiben gemerkt.
- **Alles ausgeblendet:** Sind alle Reihen und das Banner aus, zeigt die Startseite einen Hinweis mit Weg in die Einstellungen statt einer leeren Fläche. „Noch nichts da“ steht nur, wenn weder Banner noch eine Reihe dasteht; kommt eine
  Reihe von Seerr dazu, geht der Hinweis.
- **Wirkt sofort** wie die übrigen Einstellungen (Seiten im Speicher werden verworfen). Eine von Hand veränderte `config.json` wird geprüft (`homeConfig`: Grenzen, Typen, doppelte und fremde Einträge). *Startseite zurücksetzen* stellt Reihenfolge, alles eingeschaltet und 6 Folien wieder her.
- Szenario `tools/shots/home-customize.js` (Port 8797), Einheitentests `test/home-rows.test.js`.

## Discord Rich Presence

*Einstellungen > Discord* zeigt in Discord, was du gerade schaust, wie bei einem Spiel („Schaut Paper Moons“ mit Poster, Jahr und Genres, Fortschrittsbalken). Gedacht wie [jellyfin-rpc](https://github.com/kennethsible/jellyfin-rpc), nur eingebaut: kein zweites Programm, keine Abfrage des Servers,
die App weiß selbst, was läuft. **Aus, bis du es einschaltest.**

- **Einrichten:** keine. Discord verlangt für Rich Presence eine *Anwendung* im Entwicklerportal; die Anwendung **Jellycloud Player** (Application-ID `1568667335957676082`, öffentlich, kein Geheimnis) ist eingebaut (`DEFAULT_CLIENT_ID` in `discord-presence.js`), wie bei jellyfin-rpc. Einschalten, fertig. In Discord muss das Teilen der Aktivität
  eingeschaltet sein, und die Discord-**App** muss auf demselben Rechner laufen (nicht nur im Browser). *Verbindung testen* zeigt kurz eine Testanzeige in deinem Profil.
- **Name in Discord:** frei wählbar (bis 128 Zeichen), steht in Discord bei „Schaut …“ (Feld `name` der Aktivität, braucht ein aktuelles Discord); leer = der Name der Anwendung („Jellycloud Player“). Der Knopf *Servername* setzt den Namen deines Jellyfin-Servers ein, wie `SHOW_SERVER_NAME` bei jellyfin-rpc. Die Testanzeige trägt den eingestellten Namen schon.
  Der Titel bleibt davon unberührt, auch bei *Titel verbergen* gilt der Name.
- **Eigene Anwendung (optional):** Wer ein eigenes Symbol oder einen eigenen Anwendungsnamen im Profil will, legt im Entwicklerportal (Knopf *Entwicklerportal öffnen*) selbst eine Anwendung an und trägt deren ID unter *Eigene Application-ID* ein; sie gilt dann statt der eingebauten. Eine halb getippte ID ist ein Fehler
  (Hinweis), kein stiller Rückfall auf die eingebaute.
- **Anzeige:** Art *Schaut* (`type` 3), im Status der Titel (`status_display_type` 2). Film: Titel, darunter Jahr und zwei Genres. Folge: Serienname, darunter `S1E2 · Titel der Folge`. Dazu das **Poster** und der **Fortschritt** als Beginn und Ende (Discord rechnet den Balken selbst weiter, Unix-Zeit in Sekunden), bei Tempo ≠ 1 mit dem Tempo gerechnet.
  **Pause:** kein Balken, „Pausiert · …“ im Text. **Sprung** oder Stocken: der Balken zieht nach. Normales Weiterlaufen sendet nichts. Nach dem Ende bleibt die Anzeige noch 3 s stehen (zwischen zwei Folgen kein Flackern), dann wird sie entfernt; beim Beenden der App sowieso.
- **Poster:** Discord holt das Bild selbst aus dem Internet, es muss also öffentlich erreichbar sein. *Automatisch*: das Poster von **TMDB** (Adresse über Seerr: TMDB-Nummer des Films bzw. der Serie, `details.posterPath`, Größe w500; verrät Discord nichts über deinen Server), sonst vom **eigenen Server**, aber nur wenn er per `https`
  mit öffentlichem Namen erreichbar ist (nicht `localhost`, `192.168.x.x`, `*.local`, `*.ts.net`, nur `http`; die Bildadressen von Jellyfin brauchen keine Anmeldung, in der Adresse steht nie ein Token), sonst kein Poster. Wählbar sind auch *TMDB*, *Von meinem Server* und *Kein Poster*. Folgen zeigen das Poster der Serie.
  Kommt das Poster langsamer als 1,5 s, steht die Anzeige erst ohne Bild und bekommt es nach.
- **Datenschutz:** *Titel verbergen* zeigt nur „Schaut einen Film“ bzw. „Schaut eine Serie“, ohne Titel, Poster und Knopf. *Link zur Titelseite* (aus) fügt einen Knopf „Auf IMDb ansehen“ hinzu (Filme sonst „Auf TMDB ansehen“; nur öffentliche Seiten, nie eine Adresse des eigenen Servers) und macht den Titel zum Link (`details_url`). **Discord zeigt einem den eigenen Knopf nicht an**, nur anderen (bekanntes Verhalten des Discord-Programms); den Titel-Link siehst und klickst du auch selbst (braucht ein aktuelles Discord). Zu Discord gehen sonst
  weder Benutzername, Token noch Serveradresse (außer bei der Poster-Quelle *Von meinem Server*). Das prüft das Szenario mit.
- **Verlässlichkeit:** Läuft Discord nicht, steht in den Einstellungen „Discord ist nicht erreichbar“, und bei laufender Wiedergabe wird alle 15 s neu versucht; wird Discord neu gestartet, verbindet die App neu und zeigt wieder an. Eine abgelehnte Application-ID wird nicht in Schleife wiederholt (Status „Discord kennt diese Application-ID nicht“),
  eine neue ID oder Aus- und Einschalten ist ein neuer Versuch. Aktualisierungen gehen höchstens alle 5 s hinaus (Discord drosselt), die neueste gewinnt. Lehnt ein älteres Discord Felder ab, versucht die App schlichtere Fassungen (ohne `status_display_type`, dann ohne Knopf und als „Spielt“) und merkt sich die erste, die klappt.
- **Technik:** `src/main/discord-ipc.js` spricht das Protokoll der Discord-App ohne Zusatzpaket (benannte Pipe `\\?\pipe\discord-ipc-0` bis `-9`, Pakete aus Opcode und Länge, Handshake mit der ID, `SET_ACTIVITY` mit `pid` und `nonce`), `src/main/discord-presence.js` baut die Anzeige und hält Verbindung, Drosselung und Wiederholung
  (`DiscordPresence`), der Player meldet Änderungen über das Ereignis `nowplaying` (`PlayerController.nowPlaying()`), `main.js` verdrahtet es (IPC `discord:status`, `discord:test`). Einstellungen `settings.discord` (`enabled`, `clientId`, `poster`, `hideTitle`, `button`).
  Tests: `test/discord-ipc.test.js` und `test/discord-presence.test.js` gegen eine Fake-Pipe (`test/fake-discord.js`), Szenario `tools/shots/discord.js` (Port 9097, Fake-Discord über `JC_DISCORD_PIPE`, nur mit `JC_DEV=1`).
  **Nicht gegen ein echtes Discord getestet** (auf dem Entwicklungsrechner läuft keins): Aufbau des Protokolls und die Felder folgen Discords Dokumentation und anderen Bibliotheken. Zeigt Discord etwas anders an als hier beschrieben, bitte den Status in den Einstellungen ansehen und melden.

## Startanimation

Beim Start der App läuft rund 2,7 Sekunden ein kurzer Vorspann wie bei Netflix (`src/renderer/js/splash.js`, Stile im Abschnitt *Startanimation* von `app.css`): auf dunklem Grund **zeichnet sich der Umriss der Wolke** (ein Funke läuft den Strich entlang), das **Dreieck springt auf**, ein **Lichtblitz** und ein Ring gehen vom Logo aus, der Schriftzug **JELLYCLOUD** erscheint Buchstabe für Buchstabe,
dann **fährt die Kamera durch das Logo hindurch**: es wächst über den Bildschirm, die Oberfläche blendet dahinter ein, der dunkle Grund verschwindet. Alles besteht aus Elementen, SVG und CSS-Animationen, ohne Bild- oder Tondatei (einen Ton gibt es bewusst nicht).

- **Wann:** nur beim Start der App, nicht bei jedem Neuaufbau (erneute Anmeldung, Sprachwechsel, F5). Sie beginnt, sobald die Einstellungen geladen sind; darunter baut sich die Oberfläche ganz normal auf (Anmeldung, Startseite, Banner und Trailer), unsichtbar bis zum Zoom. Ist das Fenster noch nicht zu sehen (Autostart minimiert), wartet sie, bis man es öffnet.
- **Überspringen:** ein Klick oder eine Taste, der Vorspann blendet dann in 0,26 s aus (der Klick fällt nicht auf die Seite durch).
- **Kein Schalter, keine Vorschau** (seit 1.2.4, wie in der Apple-App). Mit der Systemeinstellung *Bewegung reduzieren* läuft eine ruhige Fassung in 45 % der Zeit (ohne Ring, Lichtblitz und Zoom, die Oberfläche blendet nur ein).
- **Hinweise warten:** Der Hinweis „Aktualisiert auf …“ und die Meldung über ein gefundenes Update erscheinen erst nach dem Vorspann (`afterSplash()`), sonst wären sie darunter unsichtbar abgelaufen.
- **Leicht zu halten:** Nur das Logo zoomt (die Glanz-, Blitz- und Ringebene blenden vorher aus, hochskaliert wären sie riesige, teure Flächen). In der VM ohne Grafikkarte liegt der größte Bildabstand bei rund 35 ms.
- **Szenarien:** `--shots` meldet der Oberfläche `devNoSplash` (nur mit `JC_DEV=1`, `main.js`), damit die Startanimation die anderen Läufe nicht verdeckt; `tools/shots/startup-anim.js` schaltet sie mit `ctx.splash(true)` ein und prüft Ablauf, Überspringen, die ruhige Fassung (`ctx.reducedMotion`) und das Warten bis das Fenster sichtbar ist.

## Neu laden und Metadaten

**F5** oder der Knopf in der Kopfzeile holt die Daten der sichtbaren Ansicht neu vom Server, **Strg+Umschalt+R** leert zusätzlich den Bildspeicher und baut alles neu auf (etwa wenn sich Bibliotheken ändern).
Auf der Detailseite bietet der Knopf *Mehr* außerdem *Fehlende Metadaten ergänzen* und *Metadaten und Bilder ersetzen*: Der Server holt sie neu (`POST /Items/{id}/Refresh`), danach lädt die Seite selbst neu.
Das dürfen nur Administratoren; sonst erscheint eine verständliche Meldung. Bei großen Serien arbeitet der Server länger, dann hilft ein späteres *Neu laden*.

## Einstellungen wirken sofort

Startseite und Bibliothek bleiben beim Verlassen im Speicher des Routers (schnelles Zurück) und lesen die Einstellungen beim Aufbau. Ändert man in den Einstellungen etwas, das sie betrifft (*Banner wechselt automatisch*, *Filme im Trend auf der Startseite*,
*Spoiler-Schutz*, alle *Trailer*-Einstellungen), verwirft `settings.js` die gemerkten Ansichten (`invalidate()`), und der nächste Besuch baut sie mit den neuen Werten auf, ohne Neuladen. Reine Darstellung (Theme, Akzent, Postergröße) wirkt sofort per CSS und lässt
die gemerkten Seiten in Ruhe. Das Szenario `tools/shots/settings-live.js` prüft es.

## Verwaltung (Administratoren)

Ist das Jellyfin-Konto **Administrator** (`Policy.IsAdministrator` aus `GET /Users/Me`; seit 1.2.7 liest es die Verbindungsprüfung beim Start mit, neben den Bibliotheken; ein Fehler dabei heißt „kein Administrator“), erscheint in der Kopfzeile ein
Schild-Knopf vor den Einstellungen (`#/admin`). Alle anderen sehen nichts davon, und die Adresse zeigt nur „Nur für Administratoren“. Der Server prüft die Rechte ohnehin: Ohne sie antwortet er auf jede dieser Anfragen mit 403,
die Oberfläche meldet es verständlich. Bereiche (Seitenleiste wie in den Einstellungen):

- **Server:** Name, Version, Betriebssystem, Adresse, „Neustart nötig“; **Bibliotheken durchsuchen** (`POST /Library/Refresh`); **Server neu starten** und **herunterfahren** (`POST /System/Restart`, `/System/Shutdown`), jeweils mit
  **doppelter Rückfrage** (erst die Frage, dann „Letzte Rückfrage“ mit dem Servernamen).
- **Aufgaben:** die geplanten Aufgaben nach Kategorie mit Zustand („Läuft (43 %)“ mit Balken, „Zuletzt vor 3 Stunden: abgeschlossen/fehlgeschlagen“), **Starten** und **Stoppen**. Die Ansicht aktualisiert sich alle 5 s von selbst
  (nicht bei verstecktem Fenster, laufendem Video oder offenem Dialog).
- **Aktivität:** aktive Sitzungen (wer schaut was, auf welchem Gerät, Position, pausiert) und das Aktivitätsprotokoll (Fehler rot, Warnungen gelb), ebenfalls mit Selbstaktualisierung.
- **Benutzer:** Liste mit Kennzeichen (Administrator, Du, Gesperrt, Ohne Passwort) und letzter Aktivität; **anlegen**, **sperren/entsperren** (die Richtlinie wird gelesen und komplett mit geändertem `IsDisabled` zurückgeschrieben, wie der
  Server es verlangt), **Passwort zurücksetzen** oder **neu setzen**, **löschen** (rote Rückfrage). Das eigene Konto hat kein Menü, andere Administratoren lassen sich nicht sperren; beides prüft auch der Hauptprozess.
- **Einträge verwalten:** Auf der Detailseite hat *Mehr* für Administratoren den Abschnitt *Verwalten*: **Metadaten bearbeiten** (Titel, Originaltitel, Slogan, Beschreibung, Jahr, Altersfreigabe, Genres, Tags; gespeichert wird nur,
  was sich geändert hat; der Eintrag wird frisch gelesen und ganz zurückgeschickt, damit nichts verloren geht), **Identifizieren** (Online-Suche mit Name und Jahr, Klick auf einen Treffer und Bestätigung ersetzen Metadaten und Bilder; nur
  Filme und Serien) und **Vom Server löschen** (rote Rückfrage mit dem Titel; danach zur Startseite).

Sicherheit: Alle Kennungen werden im Hauptprozess geprüft, bevor sie in einen Pfad gelangen (nur Hex-Ziffern und Bindestriche), Texte sind in Länge und Zeichen begrenzt (`checkId`, `checkText`, `checkList` in `jellyfin.js`), Passwörter
laufen nur im Hauptprozess und stehen in keinem Protokoll. Die Dialoge (`openModal`, `confirmDialog` in `ui.js`) halten den Fokus im Fenster, Escape bricht ab, bei gefährlichen Aktionen liegt der Fokus auf *Abbrechen*.
Getestet wird gegen den Mock-Server (`setAdmin(true)` schaltet seine Verwaltungsfunktionen frei, sonst antwortet er 403): `test/admin.test.js` (Client, Prüfungen, Schutzregeln) und `tools/shots/admin.js` (Oberfläche). Gegen einen echten
Server ist es **nicht** geprüft.

## Autostart

*Einstellungen > Allgemein*: **Mit Windows starten** trägt die App in den Windows-Autostart ein (nur in der installierten App, in der Entwicklung bleibt die Registry unberührt), **Minimiert starten**
lässt das Fenster beim automatischen Start in der Taskleiste. Der Eintrag wird bei jedem Start mit der Einstellung abgeglichen (etwa nach einem Umzug der App).

## Updates

Die App aktualisiert sich selbst (`src/main/updater.js`, ohne Fremdpakete). Die **Update-Quelle ist fest eingebaut**: die Release-Dateien eines öffentlichen GitHub-Repos,
`https://github.com/KaterBeratung/Jellycloud-Player/releases/latest/download/` (`DEFAULT_UPDATE_SOURCE` in `src/main/config.js`). Diese Adresse liefert ohne Anmeldung immer die Dateien des neuesten Releases
(GitHub leitet sie auf eine signierte Adresse eines anderen Servers weiter, das folgt der Updater).

**Die Quelle ist weder zu sehen noch zu ändern**: In den Einstellungen gibt es dafür weder ein Feld noch einen Schalter (unter *Allgemein > Updates* nur *Automatisch nach Updates suchen*), sie steht nicht in der Konfigurationsdatei,
und ein Versuch, sie über die Oberfläche zu setzen (`settings:set` mit `updateSource` oder `updateCustom`), wird im Hauptprozess verworfen. Konfigurationsversion 9: Werte der Versionen 7 und 8 (`updateSource`, `updateCustom`) werden beim Start
entfernt, auch aus der Datei; hieß eine alte Einstellung „keine Updates“ (in Version 7 geleert, in Version 8 eigene Quelle ohne Eintrag), bleibt das als ausgeschaltete automatische Prüfung. Die Quelle zu wechseln heißt, `DEFAULT_UPDATE_SOURCE`
zu ändern und neu zu bauen. Tests und Entwicklung setzen eine Quelle über `updater.getSource` (so macht es `tools/shots/update.js`).

Der Updater selbst kann mehr als die App nutzt (für Tests und eigene Zwecke): Er versteht eine https-Adresse oder einen Ordner und rückt GitHub-Seitenadressen zurecht (`github.com/NAME/REPO`, `…/releases`, `…/releases/latest`,
`…/releases/tag/vX`, `github:NAME/REPO`). Liefert eine Adresse eine Webseite statt der Datei (HTML), meldet er das klar („liefert eine Webseite statt der Datei latest.json …“) statt „zu groß“;
Anlass war `…/releases/latest.json` auf GitHub, das eine 157 KB große HTML-Seite zurückgibt.

**Quelle (Aufbau)**: eine Adresse (`https://…/jellycloud/`) oder ein Ordner. Darin liegen zwei Dateien:

| Datei | Inhalt |
| --- | --- |
| `latest.json` | `{ "version", "file", "size", "sha512", "date", "notes" }` (`notes` erscheint unter *Neu in dieser Version*) |
| `Jellycloud-Player-Setup-<Version>.exe` | der Installer |

**Direkter Download-Link, immer die neueste Version:** `https://github.com/KaterBeratung/Jellycloud-Player/releases/latest/download/Jellycloud-Player-Setup.exe`. Dafür hat jedes Release neben dem Installer mit Versionsnummer eine **Kopie mit festem Namen** (`Jellycloud-Player-Setup.exe`, dieselbe Datei):
GitHub löst `latest/download/<Name>` nur für einen festen Namen auf, mit Versionsnummer im Namen änderte sich der Link bei jedem Update. Die App selbst nutzt weiter den Namen mit Versionsnummer aus `latest.json`.

**Veröffentlichen auf GitHub**: Nach dem Bau und `tools\publish-update.ps1` lädt `tools\publish-github.ps1` den Installer, die Kopie mit festem Namen und `latest.json` als Release `v<Version>` in das Repo hoch (`-DryRun` zeigt nur an, `-Repo NAME/REPO`
wählt ein anderes, `-StableOnly` lädt nur die Kopie mit festem Namen zu einem schon veröffentlichten Release nach). Das Release wird zuerst als **Entwurf** mit beiden Dateien angelegt und erst dann veröffentlicht, damit `latest` nie auf ein Release ohne Dateien zeigt; danach folgt eine Gegenprobe ohne Anmeldung (Version in
`latest.json`, Größe des Installers über die öffentliche Adresse). Das Skript nutzt die GitHub CLI (`gh`, angemeldet mit `gh auth login`; gesucht im PATH und unter `%LOCALAPPDATA%\gh-cli\bin`). Das Repo ist öffentlich und enthält
nur Releases: **jeder kann den Installer laden**. Darin steckt `mpv` (GPL), der Lizenzhinweis dazu steht in `THIRD-PARTY.txt` (im Installer unter `resources`, in der App unter *Info > Lizenzen anzeigen*).

`tools\publish-update.ps1` schreibt `latest.json` für den Installer der Version aus `package.json` (Größe, SHA-512, Datum). Ohne Angaben landet sie neben dem Installer in `dist` (das ist dann schon eine gültige Quelle),
mit `-Out <Ordner>` werden Installer und `latest.json` dorthin kopiert (ältere Installer dort werden entfernt, `latest.json` kommt zuletzt). `-Notes "…"` oder `-NotesFile datei.txt` setzt den Text zu den Neuigkeiten.

**Ablauf**: Die App sucht vier Sekunden nach dem Start (im Hintergrund, der Start wartet nicht darauf) und danach alle sechs Stunden (abschaltbar: *Automatisch nach Updates suchen*), außerdem auf Knopfdruck unter *Einstellungen > Info*.
Ist die Version in `latest.json` höher als die laufende, erscheint ein grüner Punkt auf dem Rand des Zahnrad-Knopfs, **dauerhaft ein grüner Hinweis „Update verfügbar“ unter dem Konto** (nur der Text, die Versionsnummer steht im Tooltip und auf der Info-Seite; ein Klick führt zu *Einstellungen > Info*, dort ist er ausgeblendet) und **einmal je Version** ein kurzer Hinweis (9 s, ohne Zwang; die Version merkt sich `general.updateSeen` auch über Neustarts, danach bleiben nur Punkt und Versionshinweis).
Er kommt nur, wenn er nicht stört: nicht bei minimiertem Fenster (er wartet, bis man es wieder sieht), nicht während der Wiedergabe (er kommt kurz danach), nicht auf der Info-Seite (dort steht das Ergebnis ohnehin).
Fehler der automatischen Prüfung bleiben stumm. *Herunterladen* zeigt den Fortschritt und lässt sich abbrechen; danach ist die Datei geprüft und *Installieren und neu starten*
startet den Installer still (`--updated /S --force-run`), die App beendet sich, der Installer ersetzt sie und startet die neue Version. Nach dem Start meldet ein Hinweis „Aktualisiert auf Version …“.
Nichts wird ohne Klick geladen oder installiert; während einer Wiedergabe lehnt die App das Installieren ab.

**Schutz**: Es zählt nur https (`http` nur für `localhost`/`127.0.0.1`), keine Zugangsdaten in der Adresse, und `latest.json` wird streng geprüft (Version, Dateiname nur nach dem Muster `Jellycloud-Player-Setup-<Version>.exe`
und passend zur Version, Größe, SHA-512). Der Download wird nach Größe und Prüfsumme kontrolliert und vor dem Start des Installers noch einmal (die Datei könnte inzwischen ausgetauscht worden sein). Es wird nie eine gleiche oder ältere Version
angeboten. Der Installer ist **nicht signiert**: Vertrauen heißt, wer in die Quelle schreiben darf, bestimmt, was installiert wird. Halte die Quelle deshalb so privat wie den Rechner, auf dem sie liegt.
Heruntergeladene Installer liegen in `%APPDATA%\Jellycloud Player\updates` und werden beim nächsten Start aufgeräumt.

Gegen das **echte GitHub** geprüft (Release `v0.0.30` im Repo, 2026-11-04): Die Standard-Quelle liefert `latest.json`, die App mit Version 0.0.29 meldet 0.0.30 samt Neuigkeiten, mit 0.0.30 „aktuell“, und der Installer-Abruf wird auf die
signierte Adresse weitergeleitet (HTTP 200, richtige Länge, `MZ`-Kopf). Ein vollständiger Download und ein echtes stilles Installieren über GitHub wurden dabei noch **nicht** ausgeführt.

Geprüft: `test/updater.test.js` (26 Tests gegen einen lokalen Webserver: Quelle, `latest.json`, Prüfen, Laden mit Fortschritt, Abbruch, Verbindungsabbruch, falsche Prüfsumme, zu kleine und große Dateien, Installieren mit allen Sperren,
Ordnerquelle, Aufräumen, Zeitplan) und `tools/shots/update.js` (Oberfläche durch Electron mit echtem `net.fetch`, 39 Prüfungen). Der echte Installer wurde dabei **nicht** gestartet (Start und Beenden sind im Szenario ersetzt);
dass `--updated`, `--force-run` und `/S` die richtigen Schalter sind, steht in den NSIS-Vorlagen von electron-builder (`installSection.nsh`: nach einem stillen Lauf startet die App nur mit `--force-run`).

## Leistung großer Bibliotheken

Die Bibliothek teilt jede nachgeladene Seite in einen eigenen Block (`content-visibility`), statt ein einziges wachsendes Raster neu zu berechnen. Gemessen mit `tools/shots/perf-library.js`
(3000 Filme, VM ohne GPU): Laden bis zum Ende 94,9 s auf 38,2 s, lange Aufgaben beim Laden 25,4 s auf 0, Bildzeit beim Zurückscrollen 156 ms auf 31 ms. Tags auf Karten haben keinen Weichzeichner.

## Arbeitsspeicher der Startseite

Gemessen mit Mock-Server in der VM (Summe der privaten Bytes aller Prozesse, `getAppMetrics`): Startseite ohne Trailer rund 200 bis 280 MB, mit laufendem Full-HD-Trailer im Banner rund 450 bis 500 MB. Der Trailer ist ein eigener
YouTube-Prozess und der größte Posten (angehalten kostet er genauso viel). Deshalb baut `trailer.js` den Player ab, wenn das Fenster oder der Trailer länger als eine Minute verdeckt oder aus dem Blick ist (`REST_RELEASE_MS`): auf der
Startseite danach wieder rund 230 MB (Arbeitssatz 1051 auf 658 MB). Das Bildspeicher-Limit im Hauptprozess liegt bei 64 MB (vorher 128 MB). Wer weniger will, schaltet *Trailer > Auch auf der Startseite* aus oder stellt die Trailer-Qualität
auf 720p (Banner-Trailer 720p statt 1080p: rund 85 MB weniger). Die Neuzugänge je Bibliothek werden gleichzeitig mit Weiterschauen, Als Nächstes und Favoriten geladen (früher danach), die Startseite steht eine Wartezeit früher.
Szenario: `tools/shots/trailer-release.js`.

## Ambient Glow

Wie in der Apple-App liegt hinter dem Inhalt ein **weicher Lichtschein vom oberen und unteren Rand** (Regeln: `src/shared/glow.js`, Ebene: `src/renderer/js/glow.js`,
Einstellungen: `src/renderer/js/views/glow-settings.js`). Er ersetzt die laufende, unscharfe Aurora der Anmeldung und auf der Startseite den Hintergrundton aus
dem Bild (der bleibt nur auf Detailseiten, Einstellung *Hintergrund der Detailseite aus dem Bild*; beide liegen nie übereinander).
- **Bereiche:** Startseite, Filme (Bibliotheken mit Filmen), Serien, Suche, Anfragen, Mediatheken (von der Startseite geöffnete Bibliotheken), Anmeldung,
  Einstellungen (auch Verwaltung). Kein Ambient Glow auf Detailseiten, im Player, in Menüs und Dialogen. Jede Seite nennt ihren Bereich (`data-glow`).
- **Form:** je Rand ein elliptischer Verlauf, Mittelpunkt 8 % der Höhe außerhalb des Randes, Deckkraft in der Mitte Intensität × 0,85, Glockenabfall in 15 Stufen;
  jeder Schein reicht 58 % der Fensterhöhe, höchstens 760 px (Handy-Ansicht 600). Zwei Farben laufen quer über den Lichtfleck (als Maske). Keine Unschärfe,
  keine laufende Bewegung, fest hinter dem Inhalt; Wechsel blenden in 0,3 s.
- **Startseite:** von unten nur bis unter die Unterkante des Banners in Ruhelage (mindestens 160 px), von oben erst ohne Banner oder wenn es ganz hinausgescrollt ist.
- **Einstellungen** (*Erscheinungsbild*, direkt nach Design und Akzentfarbe): Vorschau, Ein/Aus, Intensität, Farbverlauf; 14 vorgegebene Verläufe und zwei eigene
  Farben oder sechs feste Einzelfarben und eine eigene (beide Wahlen getrennt gemerkt); je Bereich *Allgemein*, *Eigene* (dieselben Zeilen, *Bereich zurücksetzen*)
  oder *Aus*; *Ambient Glow zurücksetzen* mit Rückfrage. Standard: an, Verlauf Lila zu Blau, 100 %. Eigene Farben werden für die Fläche so weit abgedunkelt,
  dass weiße Schrift auf der stärksten Stelle 4,5:1 hat. Gespeichert in `settings.glow` (nur was vom Standard abweicht, tolerant gelesen).
- **Tests:** `test/glow.test.js` (Fälle aus `GlowStyleTests` der Apple-App), Szenario `tools/shots/glow-look.js` (Bereiche, Startseite, Einstellungen, Speichern; Aufnahmen `GL-*.png`).
## Tags

Die Formate eines Titels stehen als **Tags wie in der Apple-App** (Regeln und Farben: `src/shared/media-tags.js`, Baustein: `src/renderer/js/tags.js`, Gestaltung:
Abschnitt „Tags“ in `app.css`). Es gibt **keinen Schalter** dafür (früher *Qualitäts-Badges*; ein gespeicherter Wert fällt beim Laden weg).
- **Welche:** Premium-Bild (4K, genau ein HDR-Format: Dolby Vision vor HDR10+ vor HDR10 vor HLG, „HDR“ nur ohne bestimmtes), Premium-Ton (höchstens einer:
  Dolby Atmos, DTS:X, Dolby TrueHD, DTS-HD MA, FLAC/ALAC, LPCM; nur mit Nachweis, nie nach dem Namen der Spur), wie der Server liefert (Direct Play, Direct
  Stream, Transcoding) und gewöhnliche Angaben (HD, 1440p, 720p, SD, Bildcodec, Tonformat, Kanäle). Nichts doppelt: neben einem Premium-Ton steht sein Codec nicht.
- **Wo:** Karten unten links, höchstens zwei, Kurzformen („Atmos“, „TrueHD“); Banner bis zu drei; Detailseite (davor *Gesehen* in der Akzentfarbe, seit 1.2.15) in der Reihenfolge Premium-Auflösung, HDR,
  Premium-Ton der **gewählten** Tonspur, Wiedergabe, weitere Technik, einzeilig (reicht der Platz nicht, fallen die hinteren weg). Jahr, Laufzeit und Bewertung bleiben Text.
- **Aussehen:** feste Farbpaare je Art (4K Gold, Dolby Vision Violett zu Indigo, Atmos Eisblau zu Indigo, Direct Play Grün …), unabhängig von Design und
  Akzentfarbe. Fläche aus den zwei Farben auf feste Helligkeit gebracht, Tiefe oben hell, unten dunkel, Kontur 1 px, Schrift mindestens 7:1 zur Fläche
  (`test/media-tags.test.js`), dazu ein Schein: einmal je Art, Größe und Stärke mit einem Canvas gerechnet und als `border-image` gedehnt, ohne Weichzeichner
  zur Laufzeit. Klein 17 px (Karten, Banner), normal 22 px (Detailseite). Gewöhnliche Angaben neutral: über Bildern Schwarz 55 %, auf der Seite Schriftfarbe 12 %.
- **Wiedergabe-Tag der Detailseite:** `window.jc.playbackOutlook` fragt den Server wie beim Start (Hauptprozess `player.outlook`, Android `JCHost.outlook`),
  ohne abzuspielen, für Version, Ton- und Untertitelspur; bis zur Antwort hält ein unsichtbarer Platzhalter den Platz. Es leuchtet ruhiger (Kontur 70 %,
  Schein 45 %) als die Formate der Datei. Im Browser ohne Hülle gibt es keins. Im Player kommen die Tags erst mit der Player-Angleichung (Paket P22).
## Versionen

Jede Änderung erhöht die Version in `package.json` (und den Wurzeleintrag in `package-lock.json`): 0.0.1 bis 0.0.50, danach 1.1.x. Die Version erscheint unter *Info* und im Namen des Installers.

## Bitratenlimit des Servers

Der Jellyfin-Server hat eigene Fern-Grenzen (Benutzer-Richtlinie und serverweit), die der Client nicht umgehen kann: Liegt eine Datei darüber, meldet der Server „Direct Play nicht möglich“ und schickt
einen Transcode, auch wenn die App „Original“ verlangt. Sie gelten **nur über das Internet**, also wenn der Server den Client nicht als lokal erkennt. Die App fragt das deshalb in zwei Stufen ab
(`JellyfinClient.getStreamingLimits`):

1. `GET /System/Endpoint`: Erkennt der Server den Client als lokal, ist **Schluss**: im lokalen Netz bleibt es bei dieser einen kleinen Anfrage.
2. Nur über das Internet (oder wenn die Verbindungsart nicht erkennbar ist) werden die Grenzen gelesen: `UserPolicy.RemoteClientBitrateLimit` (`/Users/Me`) und `ServerConfiguration.RemoteClientBitrateLimit`
   (`/System/Configuration`, nicht überall lesbar; fehlt sie, gilt die des Benutzers). Bit pro Sekunde, 0 = keine, es gilt die kleinere.

Sichtbar wird es nur auf Abruf, beim Abspielen blendet die App **nichts** ein: *Einstellungen > Netzwerk > Server-Limit* (mit Knopf *Prüfen*), die Technik-Info (Zeile *Server-Limit*) und das
Qualitäts-Menü (erklärt, dass *Original* über dem Limit nicht geht). Bei jedem Start der Wiedergabe wird neu abgefragt, weil sich die Verbindung ändern kann (VPN an/aus).

Hinter einem Reverse-Proxy auf demselben Rechner sieht Jellyfin Fernzugriffe oft als lokal (127.0.0.1), dann gilt das Limit gar nicht; das Gegenmittel ist *Known proxies* im Server
([Forum](https://forum.jellyfin.org/t-remote-streaming-bandwidth-and-reverse-proxy)). Wer Direct Play will, hebt das Limit im Server an oder trägt die eigenen Netze unter *LAN-Netzwerke* ein.
Die Felder von `/System/Endpoint` und die Grenzen sind nach den veröffentlichten API-Modellen umgesetzt und gegen den Mock-Server geprüft, nicht gegen einen echten Server mit Limit.

## Wiedergabe im selben Fenster

Beim Abspielen öffnet sich **kein zusätzliches Fenster**. mpv füllt die Fläche des Hauptfensters, die Steuerung liegt als randloses,
durchsichtiges Fenster darüber (keine zweite Taskleisten-Schaltfläche). Weil die Windows-Fensterknöpfe dann unter dem Video liegen,
bringt die Steuerung eigene Knöpfe mit, das Fenster lässt sich am Titelbereich ziehen, ein Doppelklick maximiert es.
Technischer Hintergrund: Chromium legt über jedes Electron-Fenster ein Hilfs-Kindfenster; `src/main/zorder.js` hält das mpv-Fenster deshalb
per Win32 ganz oben, sonst bliebe das Video schwarz. Alternativ gibt es in den Einstellungen den Modus „mpv-Fenster“ (mpvs eigene Oberfläche).

**Dünner Streifen unten im Vollbild** (1.1.2): Das Steuerungs-Fenster ist ein eigenes, durchsichtiges Fenster und meist das Vordergrundfenster. Windows blendet die Taskleiste (auch mit *automatisch ausblenden*) nur ganz aus, wenn das Vordergrundfenster
den **ganzen Bildschirm** bedeckt; sonst bleibt ein 1 bis 2 Bildpunkte hoher, neutral grauer Streifen (rund RGB 30) am unteren Rand stehen. Im Video fällt er erst auf, wenn die Leiste nach ~3 s ausblendet (ihr dunkler Verlauf deckte ihn vorher zu).
Electron rechnet Fenstergrößen in Einheiten (DIP) und rundet auf ganze Werte; bei gebrochener Skalierung (125 %, 150 %, 175 % …) kann das Overlay dadurch einen Bildpunkt kürzer sein als der Bildschirm. Darum ragt das Overlay **im Vollbild ringsum 2 Einheiten über den Bildschirm**
(`coverBounds` in `src/main/fullscreen-bounds.js`, benutzt in `sync()` von `player.js`; es ist durchsichtig, man sieht nichts davon); im Fenster bleibt es genau auf der Fläche des Hosts. Auf dem Entwicklungsrechner (2560×1440 bei 125 %, rundet exakt) ließ sich der Streifen selbst nicht nachstellen:
`tools/shots/player-fullscreen.js` misst nativ (GetWindowRect von Host, Overlay und Bildschirm in Bildpunkten) die Reserve und `test/fullscreen-bounds.test.js` rechnet die Rundung für zehn Skalierungen und Bildschirmgrößen nach (ohne Rand bleibt in einigen Fällen eine Zeile frei, mit Rand nie).

**Kein Blick auf die Oberfläche beim Start**: Das mpv-Fenster zeigt erst nach seinem ersten gezeichneten Bild etwas an (mit echter Grafikkarte dauert das spürbar), bis dahin scheint die Seite durch.
Dabei fiel auf, dass die Seite sich beim Klick selbst veränderte: Lief ein Trailer, baute `trailer.js` ihn bei der Klasse `playing` sofort ab, und Hintergrundbild sowie der Normalzustand der Seite (Poster und Titel nach
dem „Absinken“) kamen etwa 50 ms nach dem Klick zum Vorschein, der Vorhang war erst nach rund 170 ms zu. Jetzt ist der Ton sofort aus, das Bild bleibt stehen und der Abbau folgt erst 320 ms später (`PLAY_HANDOVER_MS`), hinter dem
geschlossenen Vorhang; `tools/shots/play-handover.js` misst das Bild für Bild auf Detailseite und Banner. Der Vorhang selbst: In der Seite liegt ein schwarzer Vorhang (`#play-curtain`, `app.css`): Er blendet beim Klick auf *Abspielen* in 90 ms ein (Klasse `is-starting`, gesetzt in `playItem`), bleibt während der Wiedergabe (Klasse `playing`)
und blendet nach dem Schließen in 180 ms wieder aus. Er liegt unter dem mpv-Fenster und stört das Video nicht; bei einem Fehler beim Start verschwindet er mit der Fehlermeldung. `tools/shots/play-curtain.js` misst es mit dem echten mpv
(Seitenaufnahme alle ~30 ms und Windows-Fensterliste für das mpv-Fenster; vorher blieb die Seite nie dunkel, jetzt ist sie nach höchstens 170 ms schwarz, vor dem mpv-Fenster).

## Pausenbildschirm

Dauert eine Pause ein paar Sekunden ohne Bedienung (Standard 6 s, *Einstellungen > Wiedergabe > Pausenbildschirm*: an/aus und 3, 6, 10 oder 20 s), blendet der Player einen Pausenbildschirm ein, ähnlich wie bei Netflix, nur ruhiger:
ein dunkler Verlauf von links (der Text liegt immer auf Dunkel, egal wie hell das angehaltene Bild ist), rechts bleibt das Bild stehen. Darauf stehen, gestaffelt eingeblendet:

- die Beschriftung **Pausiert**, das **Logo** (bei Folgen das der Serie; fehlt es oder lässt es sich nicht laden, der Titel als große Schrift),
- bei Folgen **Staffel · Folge** und der Folgentitel,
- Angaben: Jahr, Altersfreigabe, Bewertung, Laufzeit und die Technik-Marken (4K, Dolby Vision, Atmos …),
- die **Beschreibung** (bis zu fünf Zeilen, in kleinen Fenstern drei; ohne Beschreibung der Werbespruch), die Genres,
- das aktuelle Kapitel, ein Fortschrittsbalken mit „0:04 von 1:30:00“ und rechts **„Endet um 23:03“ · „noch 1 Std. 30 Min.“** (Rest geteilt durch die Geschwindigkeit; die Uhrzeit läuft während der Pause mit),
- der Knopf **Weiter** und der Hinweis auf die Leertaste.

Jede Regung (Maus bewegen, Taste, Mausrad) blendet ihn aus und holt Leiste und Kopf zurück; nach derselben Wartezeit ohne Regung kommt er wieder. Eine Mausmeldung ohne Bewegung zählt nicht. Er erscheint nicht, solange ein Menü
(Audio und Untertitel, Kapitel …) oder die Technik-Info offen ist, beim Puffern, Laden und Schließen. Der **Spoiler-Schutz** gilt auch hier: die Beschreibung einer ungesehenen Folge bleibt weg.

Technik: Der Hauptprozess schickt mit dem Eintrag ein kleines Objekt `pauseInfo` (`src/main/pause-info.js`, Beschreibung als reiner Text, höchstens 1200 Zeichen). Das Overlay (`src/player/player.js`, `pause.js`) prüft alle 400 ms den Zustand
(pausiert, nichts offen, lange genug ohne Regung), statt auf einzelne Ereignisse zu hören: so greifen alle Sonderfälle ohne eigene Regeln. Nur Verläufe, kein `backdrop-filter` (er könnte das Video dahinter nicht verwischen).
Geprüft: `test/pause.test.js` (8 Tests: Angaben, Spoiler-Schutz, Fehlendes, Dauer, Ende, Kapitel) und `tools/shots/pause-screen.js` (56 Prüfungen: Wartezeit, Inhalt, Uhrzeit, Regungen, Menüs, drei Fenstergrößen, Folge, Rückfall ohne Logo, abgeschaltet).

## Countdown an „Überspringen“ und „Nächste Folge“

Wie bei Netflix läuft an den Knöpfen **Intro / Rückblick / Abspann / Vorschau überspringen** und **Jetzt** (Karte *Als Nächstes*, in den letzten 30 Sekunden einer Folge) ein Countdown: der Knopf füllt sich hinter dem Text von links nach rechts,
ist er voll, geht es von selbst weiter (Segment überspringen bzw. nächste Folge starten). **Standard 6 s**, einstellbar unter *Einstellungen > Wiedergabe > Countdown bei „Überspringen“ und „Nächste Folge“* (aus, 3, 6, 10, 15 s; `player.skipCountdown`, 0 = aus).

- Ein Klick löst sofort aus. **Pause, Laden und Puffern halten den Countdown an**, ein Sprung aus dem Segment heraus bricht ihn ab (der Knopf verschwindet).
- Ein Eintrag zählt **nur einmal** je Wiedergabe: wer nach dem Überspringen zurückspult, bekommt den Knopf ohne zweiten Countdown, und es wird nicht noch einmal automatisch übersprungen.
- Die **nächste Folge** zählt nur mit *Nächste Folge automatisch*; sonst bleibt die Karte stehen und wartet auf den Klick auf *Jetzt*. Bei der Einstellung *Automatisch* (Intro/Abspann) wird wie bisher sofort übersprungen, die Knöpfe erscheinen dann gar nicht.
- Technik: Die Sekunden gehen mit dem Eintrag `ui.autoSkip` (`{ sec, next }`, `getUi` in `main.js`, `skipCountdownSec` in `config.js`: ganze Zahl 0 bis 30) an die Steuerung. Gezählt wird in `player.js` pro Bild (`cdTick`: Wanduhr, höchstens 0,25 s je Bild, nur bei laufender Wiedergabe),
  **nicht** mit einem CSS-Ablauf: Länge und Auslösen hängen so nicht an der Bewegungseinstellung. Die Füllung ist `.cd > i` in einer eigenen Hülle (Rundung und `overflow` dort, damit der unsichtbare Trefferstreifen des Knopfes nicht abgeschnitten wird).
- Geprüft: `tools/shots/player-countdown.js` (34 Prüfungen mit dem mpv-Simulator: 6 s Standard, Füllstand, automatisches Springen, Klick, Pause, einmal je Eintrag, aus, *Bewegung reduzieren*, nächste Folge mit und ohne Autoplay), `test/episode-list.test.js` (`skipCountdownSec`).

## Folgen und Staffeln im Player

Bei Serien gibt es in der Steuerleiste einen Knopf **Folgen** (Symbol mit gestapelten Ebenen, Taste **E**). Er öffnet eine Glasliste wie die anderen Fenster: oben die **Staffel-Reiter** (bei mehr als einer Staffel; „Specials“ zuletzt), darunter die Folgen
mit Nummer, Vorschaubild, Titel und Laufzeit. Die **laufende Folge** ist in Akzentfarbe hervorgehoben („Läuft“), gesehene tragen einen Haken, angefangene einen Fortschrittsbalken. Die Liste beginnt bei der Staffel der laufenden Folge und scrollt zu ihr;
das Mausrad über der Liste scrollt sie (es ändert nicht die Lautstärke). Ein Klick auf eine andere Folge wechselt **im laufenden Player** (ab der gemerkten Position, mit den üblichen Berichten an den Server: alte Folge gestoppt, neue gestartet); ein Klick auf die laufende schließt nur die Liste.
Escape schließt sie. Der **Spoiler-Schutz** gilt auch hier: Vorschaubilder ungesehener Folgen sind verwischt (die laufende nicht). Bei Filmen und Serien mit nur einer Folge fehlt der Knopf.

Technik: `src/main/episode-list.js` (`buildEpisodeList`) macht aus den Folgen des Servers eine kleine Liste (`id, season, seasonName, index, name, runSec, posSec, played, tag, spoiler`, höchstens 600) und `nextEpisode` die Folge danach; beides holt `_loadEpisodes` in `player.js` bei jedem Start **frisch** vom Server (damit Haken
und Fortschritt stimmen) und schickt es als `episodes` an die Steuerung. Der Befehl `play-episode` wird nur für Folgen angenommen, die in genau dieser Liste standen, und nicht während eines Wechsels. Geprüft: `tools/shots/player-episodes.js` (27 Prüfungen: Film ohne Knopf, Liste, Reiter, laufende Folge, Wechsel mit Server-Log,
Taste E und Escape, Mausrad, Spoiler-Schutz, schmales Fenster 760 px) und `test/episode-list.test.js`.

## Gemeinsamer Kern, Web-Fassung, kompakte Ansicht und Android-App

Das Windows-Programm bleibt die Hauptsache. **iOS wird nativ in Swift gebaut** (Entscheidung vom 8.11.2026, damit es sich wie eine echte iOS-App anfühlt) und nicht aus dieser Oberfläche; die Module in `src/shared` und die Szenarien dienen dort als Vorlage für Verhalten und Schnittstellen.
Was hier entstand, nützt dem Windows-Programm (schlankes `main.js`, Tests) und trägt die **Android-App** (`mobile/`) sowie eine Handy-Fassung im Browser.

- `src/shared/jellyfin.js`, `seerr.js` (Clients, vorher in `src/main/`, dort bleibt eine Weiterleitung), `config-core.js` (Standardwerte und Ablage-Regeln ohne eigene Ein-/Ausgabe; `src/main/config.js` setzt Datei und Windows-DPAPI darauf)
  und `backend.js` (`createBackend`: Anmeldung, Quick Connect, Jellyfin-Aufrufe, Seerr, Bitratengrenze, Einstellungen, Zustand für die Oberfläche). `main.js` ruft nur noch dieses Modul auf (rund 150 Zeilen weniger, jede IPC-Antwort ist ein Einzeiler).
- `src/web/` (`index.html`, `jc-web.js`): dieselbe Oberfläche **ohne Electron**. `window.jc` läuft hier mit derselben Rückseite direkt in der Seite, Konfiguration in `localStorage` (Token nur kodiert), Bilder über die Adresse des Servers (Jellyfin liefert Bilder ohne Anmeldung; `window.jc.mapImage` macht aus
  `jellycloud://`-Adressen echte), die Hülle meldet sich über `window.JCHost` (Abruffunktion, Speicher, Player, Links). `node tools/build-web.js` baut daraus den Ordner `www/` (rund 570 KB, ohne Main-Prozess, Preload und Player).
- `mobile/` ist die **Android-App** (seit 1.1.5): Capacitor 8 mit eigenem Media3-Player (`PlayerActivity`), Hülle `host-capacitor.js` (native HTTP-Schicht, Wiedergabe-Plan mit Geräteprofil, Rückfall auf Transcode, Meldungen an Jellyfin), APK `dist\Jellycloud-Android-<Version>.apk` (Debug-Schlüssel, rund 6 MB). **Nur gebaut und statisch geprüft, noch nie auf einem Handy gestartet** (die VM hat keinen Emulator). Bauen, Aufbau, Grenzen und die Liste der noch offenen Geräte-Tests: `mobile/README.md`. Nicht Teil des Windows-Programms.
- **Kompakte Ansicht (Handy, seit 1.1.4):** `src/renderer/js/compact.js` setzt `<html data-compact="on">`, wenn die Plattform nicht `desktop` ist und das Fenster höchstens 820 px breit (oder liegend, niedrig und Touch) ist. Dann gilt der Abschnitt „Kompakte Ansicht“ am Ende von `app.css`:
  Tab-Leiste unten (`buildTabbar` in `app.js`: die fünf Reiter Start, Filme, Serien, Anfragen, Suche; die Einstellungen im Profilmenü) statt Navigationskapsel, oben nur Wolke und Werkzeuge, Banner und Reihen in Handygröße, Bibliothek und Suche in drei Spalten, Detailseite gestapelt (Poster, Titel, Knöpfe in voller Breite), Folgen mit schmalen Vorschaubildern,
  Einstellungen als Liste nach Themen (Konto, Darstellung, Wiedergabe, App; ein Tipp öffnet den Bereich, oben „‹ Einstellungen“ führt zurück, keine Chip-Zeile), Knöpfe mindestens 44 px, keine hängenden Hover-Hebungen, Abstände für Kerbe und Home-Balken (`env(safe-area-inset-*)`). Im Windows-Programm (`data-platform="desktop"`) tut das alles nichts, dort wird nicht einmal die Tab-Leiste gebaut.
  Außerhalb des Desktop-Programms entfallen in den Einstellungen die Bereiche Video (mpv-Bild), Audio (Ausgabe des Rechners) und Discord, in „Allgemein“ Engine, Autostart, Fensterwahl und Selbst-Aktualisierung, in „Info“ die Update-Verwaltung (auf iOS/Android auch die Tastenkürzel).
- Geprüft: `test/backend.test.js` (11 Tests mit Server-Ersatz), `tools/shots/web-mode.js` (42 Prüfungen: Oberfläche ohne Electron gegen den Mock-Server, Anmeldung, Neustart bleibt angemeldet, Seiten, Bilder, Wiedergabe-Haken, gebauter Ordner, kompakte Ansicht bei 390 px mit Aufnahmen W-02 bis W-08) und die bestehenden Szenarien unverändert.
  Der Mock-Server antwortet dafür jetzt mit CORS wie ein echter Jellyfin-Server.

## Installer bauen

```bash
npm run dist
```

Erzeugt `dist\Jellycloud-Player-Setup-<Version>.exe` (NSIS, pro Benutzer, Zielordner wählbar, Verknüpfungen).
Liegt `vendor\mpv\mpv.exe` vor, wird mpv mit eingepackt (`resources\mpv`). Der Installer ist nicht signiert,
Windows SmartScreen zeigt daher beim ersten Start eine Warnung.

Danach `tools\publish-update.ps1` ausführen: Es schreibt `dist\latest.json` für diesen Installer, damit die App das Update findet (siehe *Updates*).

## Tests

```bash
npm test                 # Einheiten- und Integrationstests (Konfiguration, Direct-Play-Profil, mpv, Jellyfin-API, Ton-Ausgabe)
npm run mock             # lokaler Mock-Jellyfin-Server auf http://127.0.0.1:8097 (Benutzer demo / Passwort demo)
```

Ohne `node`/`npm` im PATH (Windows-VM) laufen beide über das mitgelieferte Electron: `tools\test-unit.ps1` (alle oder einzelne `test\*.test.js`,
Zusammenfassung und fehlgeschlagene Fälle) und `tools\test-shots.ps1 -Names a,b` bzw. `-All` (Szenarien nacheinander, je mit eigenem Benutzerordner und Zeitlimit;
Ergebnis ok, FEHLER oder ZEITLIMIT aus Exit-Code, `FAIL`-Zeilen und „Szenario fehlgeschlagen“). Mit `-Root` prüfen beide einen anderen Stand, etwa eine Kopie.

### Testserver (`tools/mock-server.js`)

Jellyfin und ein Mock-Seerr (`/api/v1`) laufen auf **einem** Port. Die Szenarien steuern ihn im Prozess (`state`, `SEERR`, `setAdmin`, `resetSeerr`).
Dazu gibt es dieselben HTTP-Schalter wie beim Testserver der Apple-App (`Tools/mock_server.py`), alle ohne Anmeldung, GET oder POST, Zeiten in Sekunden:

| Schalter | Wirkung |
|---|---|
| `/__debug/state` | Protokoll (letzte 60 Einträge), Gesehen, Positionen, Störungen, Quick Connect, gestellte Sitzungen, Seerr-Zähler (`apiRequests`, `listRequests`, `sessionRequests`, `logouts`, `tmdbRequests`: muss 0 bleiben) |
| `/__debug/reset` (`?all=1`, `?seerr=1`) | Protokoll leeren, Sitzung gültig, Quick-Connect-Schalter aus; `all`: Gesehen, Favoriten, Positionen wie beim Start; `seerr`: Anfragen, Stände, Rechte, Sitzung, Kontingent, Zähler von Seerr wie beim Start |
| `/__debug/delay?lists=<s>\|hold&images=<s>&plan=<s>&reports=<s>&auth=<s>&requests=<s>\|hold` | Listen (Start, Bibliothek; `hold` hält sie fest, bis der Test sie freigibt, höchstens 120 s), Bilder, Wiedergabe-Planung, Ende der Wiedergabe, Anmeldung, Liste der Seerr-Anfragen verzögern |
| `/__debug/fault?lists=<400-599\|invalid\|empty\|drop\|off>&images=<…>&count=<n>`, `?clear=1` | Die nächsten n Antworten (ohne `count` alle) scheitern mit Status, unlesbarem JSON, leerer Antwort oder abgebrochener Verbindung; `clear` schaltet Störungen und Verzögerungen ab |
| `/__debug/expire` | Sitzung abgelaufen (401) bis zur nächsten Anmeldung |
| `/__debug/quickconnect?hold=1\|0&gone=1\|0&disabled=1\|0` | Bestätigung zurückhalten, Code abgelaufen (404), Quick Connect am Server aus; `POST /QuickConnect/Authorize?code=&userId=` bestätigt den Code von einem anderen Gerät (wie Jellyfin: 401 aus, 404 unbekannt oder älter als zehn Minuten, 500 schon bestätigt) |
| `/__debug/session?device=&item=&at=<s>&user=other&control=0&idle=<s>&client=`, `?clear=1` | Wiedergabe auf einem anderen Gerät desselben Kontos; `GET /Sessions` nennt sie, `POST /Sessions/<Id>/Playing/Stop` merkt sich die Stelle |
| Seerr: `/__debug/mode?set=ok\|down\|expired` | 503 bei jeder Anfrage bzw. alle bisherigen Sitzungen ungültig (erst eine neue Anmeldung gilt) |
| Seerr: `/__debug/permissions?set=<Bits>`, `/__debug/identity?jellyfin=<Kennung>\|none` | Rechte des Benutzers (ohne Wert: `MOCK_SEERR_PERMISSIONS`, sonst 1072 = anfragen, verwalten, 4K) und die Jellyfin-Kennung, die `/auth/me` für `demo` nennt (`none`: keine; eine andere: fremde Sitzung). `demo2` (Passwort `demo`) hat eine eigene Sitzung und das Jellyfin-Konto `jf-demo2` |
| Seerr: `/__debug/request?id=&status=`, `/__debug/requests?count=&open=&by=` (Anfragender: 1 demo, 2 demo2, 3 „ben“; Titel „Anfrage 90001“ …), `/__debug/season?id=&season=`, `/__debug/media?tmdb=&status=[&type=tv]` | Stand einer Anfrage, viele Anfragen (die ältesten `open` warten), eine Staffel geliefert, Stand eines Titels (5 verfügbar, 6 gesperrt, 7 gelöscht) |

Mock-Seerr kann außerdem: `GET /request` mit `take`, `skip`, `filter`, `sort`, `requestedBy` und `pageInfo` (ohne das Recht, alle zu sehen, nur die eigenen
der Sitzung, wie Seerr), `POST /request/<Id>/approve|decline|retry`, `DELETE /request/<Id>` (verwalten = Rechte 2 oder 16; ohne nur eigene wartende, sonst 401
wie Seerr 3.5.1); Anfragen tragen den Benutzer ihrer Sitzung (demo 1, demo2 2); die Angaben eines Titels nennen `mediaInfo.seasons` und `mediaInfo.requests`
(Serie „Wintersignale“, TMDB 2001: Staffel 1 da, 2 und 3 offen; eine schon vergebene Staffel noch einmal anfragen gibt 409), dazu `/movie|tv/<Id>/recommendations|similar`,
`/collection/<Id>` (Filmreihe 77) und `/movie/<Id>/ratingscombined` (IMDb für 603), `/user/<Id>/quota` (Grenze im Prozess über `SEERR.quota`), `/person/<Id>` und
`/person/<Id>/combined_credits` (Person 9202 „Mara Ellison“ ist dieselbe wie in der Mediathek), `/discover/trending` mit `mediaType` und `timeWindow` (je Art eine Liste mit 14 Filmen und 12 Serien; sieben Filme und
zwei Serien davon gibt es über ihre TMDB-Nummer in der Mediathek, „Woche“ hat eine andere Reihenfolge; `MOCK_SEERR_OLD=1` oder `SEERR.old` wie ein älteres Seerr gemischt; im Protokoll steht die Art), `/auth/logout`. Jellyfin: `GET /Playback/BitrateTest?Size=`
(`MOCK_BITRATE_MBPS` bremst); Personen mit Biografie, Lebensdaten, Geburtsort und TMDB-Nummer (`GET /Items?ids=`, `personIds`, `GET /Persons?searchTerm=`;
„Jonas Whitfield“ bekommt seine Angaben erst nach `POST /Items/<Id>/Refresh`, „Nadia Gast“ spielt nur in einer Folge); Suchen der Mediathek stehen im
Protokoll (`/Items search`), und für den Abgleich der Suche gibt es „The Glass Garden“ (TMDB 5501) auch bei Seerr (als Film ohne Stand und als Serie) und
„Code of the Wild“ (5502) dort teilweise verfügbar. Die Fälle stehen in `test/mock-server.test.js`.

Die UI-Szenarien (Screenshots, Layout-Prüfung auf Überlappungen, Wiedergabe mit simuliertem mpv) laufen mit
`JC_DEV=1`, siehe `tools/shots/`:

```powershell
$env:JC_DEV='1'; $env:JC_FAKE_MPV='1'
npx electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/player.js
```

| Szenario | prüft |
| --- | --- |
| `player.js` | Oberfläche des Players, Layout ohne Überlappung, Server-Meldungen, Intro überspringen, nächste Folge |
| `player-countdown.js` | **Countdown an Überspringen / Nächste Folge** (34 Prüfungen, Simulator): 6 s Standard, Füllstand, springt von selbst, Klick, Pause hält an, einmal je Eintrag, aus, *Bewegung reduzieren*, nächste Folge mit und ohne Autoplay |
| `web-mode.js` | **Oberfläche ohne Electron** (42 Prüfungen, eigenes Fenster ohne Vorlade-Datei, Mock-Server mit CORS): `window.jc` aus `src/web/jc-web.js`, Anmeldung und Fehler (401), Konfiguration in localStorage (Token kodiert), Neustart bleibt angemeldet, Startseite, Film, Serie, Suche, Einstellungen ohne Desktop-Bereiche, Bilder direkt vom Server, Wiedergabe-Haken (`JCHost.play`), Ereignisse der Hülle, gebauter Ordner `www`; **kompakte Ansicht** bei 390 px (Tab-Leiste unten, keine Überlappung, kein Scrollbalken, Poster über dem Titel, drei Spalten, kein seitlicher Überlauf, Anmeldekarte im Bild) und wieder 1280 px (Desktop-Layout wie zuvor), Aufnahmen `W-02` bis `W-08` |
| `player-fullscreen.js` | **Vollbild im Player** (9 Prüfungen, Simulator, native Messung per GetWindowRect): im Fenster deckt das Overlay genau den Host, im Vollbild den ganzen Bildschirm mit mindestens einem Bildpunkt Reserve ringsum (gegen den Taskleistenstreifen unten), nach erneutem Angleichen unverändert, zurück im Fenster wieder ohne Rand |
| `player-episodes.js` | **Folgen und Staffeln im Player** (27 Prüfungen, Simulator): Knopf nur bei Serien, Liste mit Staffel-Reitern, laufende Folge, Wechsel mit Server-Log, Taste E/Escape, Mausrad, Spoiler-Schutz, schmales Fenster |
| `back-latency.js` | Zurück-Taste bei langsamem Server (4 s Verzögerung der Stopped-Antwort), Schließen während des Ladens, Esc/Backspace/Maustaste, Mehrfachklick |
| `transcode-audio.js` | Spurwechsel im Transcode, Qualitätswahl im Player, Rückfall auf Transcode, Stereo-Profil, Bitstream-Schutz, Ton-Rückfall, Kanalumschaltung, Statistik nur bei offener Info |
| `reload.js` | F5, Neu-laden-Knopf, Metadaten aktualisieren (Refresh, Ersetzen, 403), Statuscodes aus dem Hauptprozess |
| `trailer.js` | Trailer auf der Detailseite gegen **echtes YouTube** (Verzögerung, stumm, 4K/Full HD/720p, Lautstärke, kein Nebel, freier Blick: Absinken und Ausblenden über 9 s, Ton-Knopf, Ausblenden, Stopp bei Wiedergabe); braucht Internet |
| `home-trailer.js` | Startseite: Banner und Reihen mit Neuzugängen, Trailer im Banner gegen **echtes YouTube** (bleibt stehen, geht nach dem Ende weiter, Punkt-Klick, nichts blendet aus, Seite verlassen und zurück, Schalter); braucht Internet |
| `audit-dialogs.js`, `audit-themes.js`, `audit-edge.js` | Audit: Menüs und Dialoge in drei Fenstergrößen (Untertitel, Mehr, Bearbeiten, Identifizieren, Benutzer), Textkontrast aller Themes (inkl. aller Einstellungen), Randfälle mit sehr langen Titeln und Namen, Namen der bedienbaren Elemente, Konsole |
| `trailer-corner.js` | Stil „Logo in die Ecke“ bei Film und Serie in drei Fenstergrößen, mit **Bildsampler** (Lage, Größe, Deckkraft pro Bild): kein Sprung, gleichmäßige Bewegung, weicher Anlauf und Ende, Landung in der Ecke, kein Überfahren von Poster oder Text, sauberes Zurückkommen; beim Scrollen startet nichts; braucht Internet |
| `home-hairline.js` | Haarlinie am unteren Rand von Banner und Detailseite (mit und ohne Trailer, Einblenden, fünf Fenstergrößen). Rechnet in Bildpunkten (Aufnahme ÷ `innerWidth`, bei 125 % Skalierung 1,25). Banner: Zeilen um die Unterkante gegen die Seitenfarbe darunter. Detailseite: Aufnahme mit gegen Aufnahme ohne Hintergrund (Median über die Breite, damit Glas-Knöpfe nicht zählen). `HAIR_ONLY=home\|detail\|scan` wählt den Teil, `scan` sucht über das ganze Bild nach einer einzeiligen, durchgehenden Linie, `HAIR_NOBAND=1` schaltet die Deckbänder zur Gegenprobe ab; braucht Internet |
| `trailer-volume.js` | **Lautstärkekapsel des Trailers** (28 Prüfungen, ohne Internet, echte Maus und Tasten): zu = runder Glas-Knopf, die Kapsel hat **exakt das Glas der Knöpfe** (computed Styles gleich), wächst beim Zeigen rechts aus dem Knopf (links bündig, gleiche Höhe), der Knopf ist dabei durchsichtig (ein Teil, keine Naht), bleibt in der Lücke und auf der Kapsel offen, beim Ziehen auch außerhalb, fährt nach 0,7 s (Maus weg) bzw. 2,2 s (Mausrad, Tasten, Klick) von selbst wieder ein, der Knopf bleibt dabei bis zum Ende durchsichtig, Klick und Tab funktionieren, am rechten Rand wächst sie nach links |
| `trailer-release.js` | Trailer nach einer Minute Ruhe (Fenster verdeckt oder aus dem Blick) abgebaut, hier mit 1,5 s: kurze Pausen behalten denselben Player, danach kein YouTube-Rahmen mehr (Hauptprozess geprüft), Arbeitsspeicher sinkt, beim Zurückkommen ein neuer Player, `destroy` räumt den Zeitgeber ab; braucht Internet |
| `trailer-once.js` | Trailer nur einmal: keine Schleife in der Einbettung, nach dem Ende kein Neustart durch Scrollen oder Sichtbarkeitswechsel, Banner spielt eine Folie im selben Besuch nicht noch einmal, neuer Besuch spielt wieder; braucht Internet |
| `home-back.js` | zurück auf die Startseite auf vielen Wegen (aus Detail, Bibliothek, Einstellungen, Suche, gescrollt, mit und ohne Trailer im Banner): Bild für Bild, ob Banner und Reihen an ihrem Platz sind |
| `settings-live.js` | Einstellungen wirken ohne Neuladen (Banner, Trailer, Theme lässt die Seiten im Speicher; Tags ohne Schalter) |
| `glow-look.js` | Ambient Glow: Bereiche (Anmeldung ohne Aurora, Startseite, Filme, Serien, Suche, Einstellungen; keiner auf Detailseiten), Startseite oben erst ohne Banner, unten bis unter das Banner, keine Unschärfe und keine Animation, Einstellungen (Ein/Aus, Einzelfarbe, Verlauf gemerkt, Intensität, eigener Bereich, Bereich aus, zurücksetzen) wirken sofort und werden gespeichert; Aufnahmen `GL-*.png` |
| `tags-look.js` | Tags wie in der Apple-App: Karten (höchstens zwei, unten links, Kurzformen), Banner (bis drei), Detailseite (Reihenfolge, gewählte Tonspur, Wiedergabe-Tag ruhiger, einzeilig), feste Farben in allen Designs und mit anderer Akzentfarbe, Schein als geteiltes Bild ohne Weichzeichner, nichts abgeschnitten; Aufnahmen `TG-*.png` |
| `trailer-series.js` | Absinken bei Serien und Filmen in drei Fenstergrößen (Bilder vom Ruhezustand, aus der Mitte, vom Ende; misst Poster und Titel); braucht Internet |
| `admin.js` | Verwaltung gegen den Mock (66 Prüfungen): ohne Rechte nichts sichtbar, Server (Info, Durchsuchen, Neustart/Herunterfahren mit doppelter Rückfrage), Aufgaben, Aktivität, Benutzer (anlegen, sperren, Passwort, löschen), Einträge bearbeiten/identifizieren/löschen, 403 bei entzogenen Rechten |
| `subtitles.js` | lange Untertitel-Listen: Auswahl auf der Detailseite (kurz, aufgeklappt, gewählte Sprache bleibt sichtbar), Informationen (Untertitel als Sprachen, jede einmal), Spur-Panel im Player (mpv-Simulator mit 24 Zusatzspuren) |
| `seerr.js` | Seerr: Verbinden (nur Jellyfin-Konto, beim Profil gespeichert, erneut mit vorbelegter Adresse), Suche, **Seite eines Titels** (Laden, Angabenzeile mit FSK, Besetzung, weitere Titel, Informationen, Anfragen von dort, Fehlerfälle, Zurück), Anfragen, abgelaufene Sitzung, Trennen mit Rückfrage (Abmeldung bei Seerr), Konsole ohne Skriptfehler (Mock-Seerr) |
| `search-page.js` | Suche (P14): Hinweis ohne Treffer nur zum beantworteten Text, 350 ms Ruhe (ein Wort = eine Suche), veraltete Antwort verworfen, Fehler der Mediathek mit *Erneut versuchen*, Abgleich mit Seerr über TMDB-Nummer und Art (gleiche Nummer als Serie bleibt, teilweise vorhandene Serie bleibt), Ausfälle von Seerr und der Mediathek ohne Fehlerseite, nach einer Anfrage nur Seerr neu, zweiter Klick auf *Suche* und Strg+K behalten den Text (eigener Port 8988) |
| `person-page.js` | Personen (P13): Besetzung der Mediathek und eines Seerr-Titels als Verweise, Seite aus beiden Wegen (Lebensdaten, Kapsel, Biografie, Foto oder Initialen), Mediathek zuerst und Filmografie ohne ihre Titel (TMDB-Nummer), Rollen zusammengefasst, Anfrage aus der Filmografie, Gastrolle, gestorben, unbekannte Person, Nachladen nur als Administrator (eigener Port 8989) |
| `seerr-title.js` | Seite eines Seerr-Titels (P12): Serie mit Staffeln und Stand, Staffelauswahl (vorhandene gesperrt, Fokus auf der ersten offenen), nur gewählte Staffel angefragt, Kontingent (Hinweis, erschöpft gesperrt), fehlendes Recht, weitere Titel öffnen ihre Seite bzw. die Mediathek, doppelter Klick (eigener Port 8990) |
| `requests-tab.js` | Reiter *Anfragen* (P11): Meine Anfragen, Offen/Abgeschlossen, Stand-Tags, nachgeladene Titel, Zurückziehen mit Rückfrage, Antippen öffnet den Titel, Kontextmenü-Taste, Verwalten mit fremden Anfragen (Genehmigen, Ablehnen, Entfernen), entzogenes Recht, Blättern hinter 120 Anfragen, Neuladen in einem Abruf, Seerr aus (eigener Port 8991) |
| `seerr-states.js` | Seerr je Profil und vier Zustände (P10): Stand in den Einstellungen, Reiter *Anfragen* verbunden / nicht erreichbar / abgelaufen, *Erneut prüfen*, *Erneut versuchen*, *Erneut anmelden*, fremde Sitzung (abgemeldet und verworfen), zweites Profil mit anderem Jellyfin-Konto, Wechsel stellt die eigene Sitzung her, `language=de` (eigener Port 8993, zweite Adresse 8992) |
| `seerr-issue.js` | **Problem melden** (31 Prüfungen, Mock-Seerr, Port 8897): **Warnschild** in der Knopfleiste (Lage, Größe, Beschriftung, öffnet das Fenster; fehlt ohne Seerr, ohne TMDB-Nummer und nach dem Trennen), Eintrag im Menü *Mehr* nur mit Seerr und TMDB-Nummer, vier Arten, Kommentar freiwillig, *Melden* erst nach der Wahl, Film, Serie und Folge (Staffel und Folge gehen mit), Ersatztext ohne Kommentar, Esc sendet nichts, Fehler im Fenster (403, Titel Seerr unbekannt) ohne Textverlust, gewählte Art klar markiert |
| `compact-audit.js` | **Handy-Ansicht auf Abgeschnittenes absuchen** (Web-Fassung, 22 Seiten und Menüs in 412×891, 360×740 und 800×411): Text und Knöpfe außerhalb des Fensters oder von einem Rahmen mit `overflow: hidden` gekappt, Tab-Beschriftungen nur mit „…“, Seitenende unter der Tab-Leiste, Menüs, die herausragen, waagerechtes Scrollen; Aufnahmen bei 412 px |
| `android-host.js` | **Hülle der Android-App ohne Handy** (23 Prüfungen, Mock-Server): Web-Bau mit `--host`, Nachbildung der **echten Capacitor-Brücke** (`nativePromise`, `PluginHeaders`, ohne `registerPlugin`; `CapacitorHttp`, `JellycloudPlayer`) per Debug-Protokoll eingeschleust, dazu ein Lauf mit der echten Laufzeit `@capacitor/core`, Diagnose-Zeile unter Einstellungen > Info; Hülle meldet Plattform/Version/Gerätename, Anmeldung und 401 über die „native“ Schicht, **Wiedergabe-Plan** (Direct Play, Token nur im Header, Startstelle aus „Weiterschauen“, Dauer, Titel, Geräteprofil ohne AC3/DTS), „Von vorn“, **Rückfall auf Transcode** ab der erreichten Stelle bei Decoder-Fehler, Fehlermeldung bei Serverfehler, Ereignisse (aktiv, geschlossen), Folgen-Titel, Links nur http(s) |
| `no-scrollbar.js` | **Kein Scrollbalken** (20 Prüfungen): auf Startseite, Film, Einstellungen und Bibliothek ist `scrollbar-width` aus, es bleibt kein Streifen am Rand (Inhalt so breit wie das Fenster), und **Mausrad und Bild-runter-Taste scrollen trotzdem**; kein scrollbares Element, keine Stylesheet-Regel (`thin`/`auto`, `::-webkit-scrollbar`) schaltet einen Balken ein; geöffnetes Sortier-Menü ohne Balken; Eingaben mit Fokus-Wiederholung (die VM verschluckt sie zwischendurch) |
| `hover-audit.js` | **Hover-Prüfung** (Port 9197, echte Mausereignisse per `sendInputEvent`, ohne Trailer): fährt auf den unteren und linken Rand von 100 bedienbaren Elementen auf sieben Seiten und misst, ob der Hover stabil bleibt (kein Zittern, kein Verlust), ob **Knöpfe, Reiter (Staffeln) und Auswahlfelder ohne Weichzeichner** sind (sonst Streifen am Rand), ob ein **Klick ganz am Rand** ankommt, ob bei Animationen *aus* nichts abhebt, ob jedes bedienbare Element den Zeiger zeigt, Karten nach dem Wegfahren wieder in Ruhe sind, **Menü bei Tastatur und Maus nur einen hervorgehobenen Eintrag** hat, die Knöpfe im **Player-Overlay** und „Weiter“ des Pausenbildschirms am Rand stabil sind und der Text beim Zeigen in allen vier Themes mindestens 4,5 : 1 Kontrast hat |
| `discord.js` | **Discord Rich Presence** (49 Prüfungen, **Fake-Discord** auf eigener Pipe über `JC_DISCORD_PIPE`, Mock-Seerr, Port 9097): Einstellungen (nur Ziffern in der eigenen ID, Test mit falscher und richtiger ID, Status), **eingebaute Anwendung** (Feld nur optional, Einschalten genügt, Test ohne ID) und **eigener Name** (Feld, Servername, leer, auf 128 gekürzt), Anzeige für Film und Folge (Titel, Jahr und Genres, S1E2, Poster von TMDB über Seerr, Fortschritt, Knopf), Pause, Weiterspielen, Sprung, keine Flut bei normalem Weiterlaufen, Titel verbergen, Poster-Quellen (Server im Heimnetz = kein Bild), Ende (Schonfrist, dann weg), Neustart von Discord, Ausschalten; nichts Vertrauliches auf dem Draht |
| `nav-shell.js` | **Navigation und Hülle** (24 Prüfungen, Port 8994): fünf Reiter in fester Reihenfolge, rechts Neu laden/Einstellungen/Profilsymbol, Strg+1 bis Strg+5, Filme mit Bibliothekswahl (zweite Bibliothek, Kollektionen, gemerkt), Serien, Reiter bleibt auf der Detailseite gewählt, Klick auf den gewählten Reiter führt nach oben, von der Startseite geöffnete Mediathek, Anfragen ohne Seerr (Überschrift unter der Kopfzeile), gleiche Breite der Leiste mit Seerr, Profilmenü (Aufbau, rechtsbündig, Escape, Einstellungen, Quick Connect, Abmelden mit Rückfrage, Profilwechsel); Aufnahmen `NAV-*.png` |
| `quick-connect.js` | **Konto, Profile, Quick Connect** (48 Prüfungen, Port 8995): Anmeldung (Marke, Kapselfelder, Fehler am richtigen Feld, Code in Kacheln, *Zurück*), *Konto* (Verbindung, Profile, Abmelden mit Rückfrage), Maske für andere Geräte (verdeckt die App, als wer und wo, Eingabe bereinigt, falscher und schon bestätigter Code, Erfolg, ausgeschaltet, Escape, Code nicht in der Konfiguration), Profil umbenennen, neue Adresse desselben Servers, fremder Server abgelehnt, Profil entfernen, Rückkehr in die App prüft, Start ohne Server; Aufnahmen `QC-*.png` |
| `page-status.js` | **Zustände und Grundmaße** (21 Prüfungen, Port 8996): Leer- und Fehlerhinweis in der Mitte des Inhaltsbereichs, Knopf 18 darunter ohne den Hinweis zu verschieben, Fläche fängt keine Klicks ab, *Erneut versuchen* während des Versuchs gesperrt, Fehler beim Nachladen am Listenende ohne ungefragten neuen Versuch, Detailseite ohne Titel, Suche; Drücken (Knopf 0,94 und blasser, Karte 0,95 und dunkler), Feld so hoch wie der Knopf, Fehlerkontur; Aufnahmen `PS-*.png` |
| `home-customize.js` | **Startseite anpassen** (32 Prüfungen, Port 8797): Einstellungen *Startseite* (Banner aus, Folien, Reihen ein/aus und umsortieren, Zurücksetzen), Wirkung sofort auf der Startseite, Banner nur aus der Mediathek, neue Bibliothek hinten, alles ausgeblendet, Überstehen eines Neustarts |
| `notifications.js` | **Mitteilungen** (P17, Port 8985): ohne Seerr kein Eintrag und kein Punkt; erster Abgleich still bei bestätigter Verbindung; je Änderung eine Mitteilung, roter Punkt mit Zahl in der Bezeichnung, „n neue“ im Profilmenü, Übersicht (Wortlaut, Plakat, Tag, Zeit), Kontextmenü, *Alle gelesen*, Antippen öffnet den Titel, *Alle entfernen* (kommt nicht wieder), Einstellungen (Arten, aus: kein Abgleich und kein Punkt, wieder an: still), Verwalter: *Neue Anfrage*, Seerr trennen nimmt alles mit |
| `item-menu.js` | **Detailseite und Kontextmenü** (P16, Port 8986, echte Mausklicks): Menü am Mauszeiger, unter dem Plakat bei langem Drücken und Tastatur, Einträge je Stand, Schließen (Escape, Klick daneben, Mausrad, Seitenwechsel; Scrollen von selbst nicht); Aus „Weiterschauen“ entfernen, Favorit und Gesehen danach auf Startseite (ohne Neuaufbau, Stellen bleiben), Mediathek (Karte an ihrem Platz), Detailseite (Folgen, *Abspielen*) und in der Seite im Speicher; „Fortsetzen ab“, „S1 E4 Fortsetzen ab“, Staffel beim Öffnen ohne Extras, Knopfreihe in zwei Zeilen, Gesehen-Tag, Informationen; Top 10 am Plakat; Seite eines Seerr-Titels |
| `top-ten.js` | **Top 10** (P15, Port 8987): ohne Seerr keine Seerr-Reihen, kein Hinweis, keine Anfrage, gesperrt im Editor; Banner nur Neues aus der Mediathek; Top 10 Filme und Serien (nur Mediathek, Reihenfolge der Trends, weniger als zehn ohne Ersatz), Platz nach *Als Nächstes*, Beschriftung, Maße und Ebenen, Rand im Glow-Verlauf, 80 % ohne Zeiger, Platzhalter nur beim ersten Laden, Zeitraum und *Aktuell* in den Einstellungen, ohne Glow farblos, Arbeitsspeicher |
| `review-fixes.js` | Fehler aus der Durchsicht (14 Prüfungen, Port 8997), jeder nachgestellt und behoben: Bibliothek lädt nach einer kurzen, ganz geladenen Liste (Favoriten) beim Zurückwechseln auf *Alle* weiter, auf einem sehr großen Bildschirm (Zoom 25 %) auch ohne Scrollen, ein Filter während des ersten Ladens gilt, Zurück während eines Seitenübergangs zeigt die passende Seite, der Rahmen der Oberfläche lässt beim Neuaufbau keinen Zuhörer für `route` zurück, die Suche bleibt nach geleertem Feld nicht abgeblendet |
| `startup-anim.js` | **Startanimation**: Ablauf (Umriss, Dreieck, Schriftzug, Zoom, Oberfläche blendet ein), Zeit rund 2,7 s, Überspringen per Klick und Taste, ruhige Fassung bei *Bewegung reduzieren*, kein Schalter und keine Vorschau in den Einstellungen, kein zweites Mal beim Neuaufbau, Warten bis das Fenster sichtbar ist, Hinweise erst danach, Bildabstände (Mock, Port 8497) |
| `home-trending.js` | Startseite: Reihe **Filme im Trend** (nur Filme, Reihenfolge, Stände, Anfragen und Details aus der Reihe, Zwischenspeicher), **ohne Seerr weder Reihe noch Hinweis** (seit 1.2.14, E8; im Editor gesperrt), ausgeblendet keine Abfrage, Verbinden/Trennen baut die Startseite neu, Fehler und abgelaufene Anmeldung ohne leere Reihe (Mock-Seerr, eigener Port 8197) |
| `limits.js` | Bitratenlimit des Servers: nur über das Internet abfragen, Anzeige in den Einstellungen, Info/Qualitäts-Menü im Player (keine Einblendung beim Start), LAN ohne weitere Abfragen |
| `autostart.js` | Minimierter Start mit `--autostart`, Einstellungen in der Entwicklung (Registry bleibt unberührt) |
| `play-curtain.js` | Klick auf *Abspielen* mit dem **echten** mpv (ohne `JC_FAKE_MPV`): Die Oberfläche ist in höchstens 250 ms schwarz und vor dem mpv-Fenster, nach dem Schließen wieder sichtbar (kein hängender Vorhang, keine Klicksperre), zweiter Klick ebenso. Misst ohne Bildschirmzugriff (Seitenaufnahme und Fensterliste), läuft also auch ohne angemeldete Sitzung |
| `pause-screen.js` | Pausenbildschirm im Player (56 Prüfungen, fake mpv): erscheint nach der eingestellten Wartezeit, Logo/Titel, Folge, Angaben, Beschreibung, Fortschritt und „Endet um“ stimmen, Maus/Taste/Rad blenden aus (Maus ohne Bewegung nicht), Weiter-Knopf und Leertaste, kein Erscheinen bei Menü/Info, drei Fenstergrößen ohne Überlappung, Rückfall ohne Logo, Spoiler-Schutz, abgeschaltet, 3 s; Aufnahmen mit Ersatz-Video |
| `play-handover.js` | Klick auf *Abspielen*, während der Trailer läuft (Detailseite im freien Blick, Banner; fake mpv; braucht Internet): Bild für Bild in der Seite gemessen, dass sich Trailer-Ebene und Klassen erst ändern, wenn der Vorhang zu ist, und dass der Trailer danach aufgeräumt wird |
| `update.js` | Updater durch die Oberfläche (39 Prüfungen): Quelle weder zu sehen noch zu ändern (auch nicht über die Schnittstelle), Quelle nicht erreichbar, Hinweis (Toast, Punkt am Zahnrad), Laden mit Fortschritt und Abbruch, Installieren (gesperrt während der Wiedergabe, sonst mit `--updated /S --force-run`), automatische Prüfung meldet jede Version nur einmal (auch nach Neustart der Oberfläche), nicht während der Wiedergabe und nicht bei minimiertem Fenster, Quelle entfernen; mit zusätzlichem Startargument `--updated` auch der Hinweis „Aktualisiert auf Version …“ |
| `perf-library.js` | Kennzahlen für große Bibliotheken (`PERF_N`, `PERF_LABEL`), zum Vergleich vor und nach Änderungen |
| `real.js` | Ablauf mit dem **echten** mpv (Einbetten, Sichtbarkeit per Pixelmessung, Seek, Vollbild); ohne `JC_FAKE_MPV` starten |

`test/fake-mpv.js` lässt sich per Umgebung steuern: `FAKE_NO_AO=1` (Tonausgabe nicht zu öffnen), `FAKE_FAIL_DIRECT=1` (Direct Play scheitert), `FAKE_DEVICE_CHANNELS`.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/main/` | Hauptprozess: Jellyfin-API (`jellyfin.js`), Direct-Play-Profil (`profile.js`), mpv-Steuerung (`mpv.js`, `mpv-args.js`), Player-Sitzung (`player.js`), Ausgabegerät und Kanäle (`audio-output.js`), Selbst-Aktualisierung (`updater.js`), Angaben für den Pausenbildschirm (`pause-info.js`), Folgenliste des Players (`episode-list.js`), Lage des Overlays im Vollbild (`fullscreen-bounds.js`), Konfiguration (`config.js`), Bildspeicher des App-Protokolls (`image-cache.js`), Discord Rich Presence (`discord-ipc.js`, `discord-presence.js`) |
| `src/renderer/` | Oberfläche (Vanilla-JS-Module, `css/app.css`) |
| `src/player/` | Overlay-Fenster über dem mpv-Video |
| `src/shared/glow.js` | Ambient Glow: Farben, Verläufe, Bereiche, Standard, tolerantes Lesen, Ändern (`set.*`), die eine Lesestelle `resolve`, Begrenzung eigener Farben, Glockenabfall, Reichweite, CSS der zwei Scheine |
| `src/shared/media-tags.js` | Tags: welche ein Titel bekommt, in welcher Reihenfolge (Karten, Detailseite) und ihre fest gerechneten Farben (Fläche, Kontur, Schrift, Schein); Baustein zum Zeichnen `src/renderer/js/tags.js` |
| `src/shared/media.js` | Auswertung von HDR/Dolby Vision/Atmos (Hauptprozess und Oberfläche); Erkennung wie in der Apple-App (`premiumAudio`): Atmos nur auf TrueHD/E-AC-3 und DTS:X nur auf DTS, jeweils mit Nachweis (`AudioSpatialFormat` oder Profil, nie der Name der Spur), `DOVIInvalid` ist kein Dolby Vision, DTS-HD MA nur bei `MA` als Wort oder „Master Audio“, dazu LPCM und ALAC |
| `src/shared/seerr-state.js` | Stände bei Seerr nach Seerr 3.5.1 (6 gesperrt, 7 gelöscht): anfragbar nur ohne Stand und gelöscht, nie gesperrt (`isRequestable`, `isTaken`, `isPresent`); bis 1.1.6 waren 6 und 7 vertauscht; seit 1.2.5 auch der Stand von Anfrage und Titel (`requestOf`, `titleState`, Staffel-Anfragen), Bezeichnungen DE/EN, Art des Tags und die Rechte (`canRequest`, `canManageRequests`, `canViewAllRequests`) wie `SeerrMediaState.swift` |
| `src/shared/jellyfin.js`, `seerr.js`, `config-core.js`, `backend.js` | Clients, Konfiguration und die Rückseite der Oberfläche ohne Electron-Abhängigkeit; gemeinsam für Hauptprozess, Tests und `src/web` (siehe „Gemeinsamer Kern und Web-Fassung“) |
| `src/web/`, `tools/build-web.js`, `mobile/` | Oberfläche ohne Electron (`jc-web.js`), Baustein für den Ordner `www/` (mit `--host` samt Hülle), Android-App (Capacitor, Media3; Werkzeuge in `%LOCALAPPDATA%\jc-android`) |
| `src/shared/home-rows.js` | Regeln für die angepasste Startseite (Grenzen, Standardreihenfolge wie die Apple-App, neue Reihen hinter ihrem Vorgänger, ausgeblendete Reihen, Seerr-Reihen); gemeinsam für Hauptprozess und Oberfläche |
| `src/shared/format.js` | Schreibweisen der Angabenzeilen: Laufzeit („2 Std. 10 Min.“), Uhrzeit, Staffeln („Staffeln 1–3, 5“), Bewertung, Folgen („S2 · E5 · Titel“), Art; DE/EN, eine Stelle für alle Ansichten und den Player (Vorlage `Format.swift`) |
| `tools/` | Mock-Server, Icon-Generator, Screenshot-Szenarien |
| `test/` | Tests und `fake-mpv.js` (simuliert mpv per JSON-IPC) |

Das Token verlässt den Hauptprozess nie: Die Oberfläche lädt Bilder über das Protokoll `jellycloud://`, mpv bekommt es als
HTTP-Header.

Drag and Drop: Aus der Oberfläche lässt sich nichts herausziehen (Links, Bilder, Karten haben kein Ziehbild) und nichts darauf ablegen (eine Datei oder ein Link im Fenster tut nichts). Das sichern `src/renderer/js/no-drag.js`
(`dragstart`, `dragover`, `drop`; Eingabefelder sind ausgenommen, dort bleibt Text ziehen normal) und `-webkit-user-drag: none` in `app.css` und `player.css`; das Overlay-Fenster des Players nutzt dasselbe Modul. Das Szenario
`ui.js` prüft es mit.

## Backup

`tools\backup.ps1` spiegelt den Projektordner per robocopy (`/MIR`) nach `C:\Users\WIN-KI\OpenCloud\Persönlich\Jellyfin Client` (Cloud-Ordner). Mit `-DryRun` zeigt es nur an, was passieren würde. Nicht gesichert wird
`dist\win-unpacked` (rund 480 MB, ändert sich bei jedem Bau, aus dem Quellcode neu erzeugbar); alles andere inklusive `node_modules` und dem aktuellen Installer schon. Weil gespiegelt wird, verschwindet im Backup,
was im Projekt gelöscht wurde (zum Beispiel alte Installer). Aufruf: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup.ps1`.

## Robustheit (Durchsicht)

Aus einer Durchsicht des Codes, jeweils mit Test (`test/` bzw. `tools/shots/review-fixes.js`):

- **Defekte `config.json`:** Ist die Datei nicht lesbar (von Hand bearbeitet, beschädigt), startet die App mit Standardwerten, sichert die alte Datei aber vorher als `config.json.corrupt` im Datenordner. Früher überschrieben die Standardwerte sie sofort, Server, Anmeldungen
  und Einstellungen waren weg. Beim Speichern weicht die App auf direktes Schreiben aus, wenn das Umbenennen der Zwischendatei scheitert (Virenscanner hält die Datei offen, EPERM/EBUSY); die Fensterposition wird aus dem Zeitgeber heraus nie mehr mit einem Absturzfenster quittiert.
- **Bildspeicher** (`src/main/image-cache.js`): Verdrängt das am längsten *nicht benutzte* Bild (vorher das älteste abgelegte), zählt ein zweimal abgelegtes Bild einmal (zwei gleichzeitige Anfragen nach demselben Poster ließen die Summe wachsen, der Speicher räumte zu früh), und gleichzeitige
  Anfragen nach demselben Bild laden es nur einmal vom Server. Eine kaputte `jellycloud://`-Adresse (abgeschnittene Prozent-Kodierung) wird mit 400 beantwortet statt mit einem Fehler im Protokoll.
- **Abmelden** wartet bei nicht erreichbarem Server höchstens 4 s (vorher 20 s Stillstand); lokal wird ohnehin abgemeldet.
- **Bibliothek:** Nach einer kurzen, ganz geladenen Liste (zum Beispiel *Favoriten*) lud *Alle* nur die erste Seite, weil der Beobachter fürs Nachladen abgeschaltet blieb. Er wird jetzt nach jeder Seite neu angelegt, auch das behebt den Stillstand auf sehr großen Bildschirmen, auf denen
  die erste Seite die Fläche nicht füllt. Ein Filter oder eine Sortierung, die während des ersten Ladens gewählt wird, gilt jetzt sofort (die veraltete Antwort wird verworfen). Eine leere Seite beendet die Liste, auch wenn der Server mehr verspricht.
- **Seitenwechsel:** Drückt man *Zurück* gleich nach dem Klick auf ein Poster (Übergang zur Detailseite), zeigt die App nicht mehr die Detailseite zur Adresse der Startseite (`router.js`, Nummer der jüngsten Navigation).
- **Kopfleiste:** Jeder Neuaufbau (Anmeldung, Sprache, Strg+Umschalt+R, Seerr verbinden) ließ einen Zuhörer für `route` und die ganze alte Kopfleiste im Speicher zurück; sie werden jetzt abgeräumt.
- **Suche:** Wird das Feld geleert, bevor die Antwort kommt, bleibt der Hinweis nicht mehr abgeblendet.
- **Hover (0.0.49):** Knöpfe, Optionen, Reiter, Themenkacheln, Seitenleiste und die Knöpfe des Players hoben sich beim Zeigen um 1 bis 2 Bildpunkte an. Stand die Maus in der letzten Bildpunktzeile, lag sie danach außerhalb: der Hover fiel weg, das Element sank zurück, bekam ihn wieder und **zitterte**; ein Klick ganz am Rand ging
  sogar **verloren**, weil das Drücken den Knopf verkleinert (im Test 3 von 6 Klicks). Jetzt hält ein unsichtbarer Streifen in Richtung der Bewegung die Trefferfläche unter der Maus (`::before` in `app.css` und `player.css`), das Aussehen ist gleich. Bei *Bewegung reduzieren* (System) entfällt die Hebung. Der Knopf *Intro überspringen*
  im Player hob sich nie an, weil seine Eingangsanimation (`both`) den Endwert festhielt (jetzt `backwards`). In Menüs wandert der Fokus mit der Maus: mit der Tastatur geöffnet leuchteten sonst der erste Eintrag und der unter der Maus zugleich. Nicht prüfbar mit simulierten Mausereignissen: ein Hover, der an der Ziehfläche der
  Titelzeile hängen bleiben könnte (bekanntes Verhalten von Electron bei `-webkit-app-region: drag`).
- **Problem melden:** Schließt man das Fenster, während gesendet wird, und es scheitert, erscheint der Fehler als Hinweis (früher stand er im unsichtbaren Fenster).

Nicht geändert, aber gut zu wissen: Der Installer ist **nicht signiert** (die Prüfsumme in `latest.json` kommt aus derselben GitHub-Quelle, sie schützt vor beschädigten Downloads, nicht vor einem manipulierten Repo), und `allowSelfSigned` gilt nur für den Jellyfin-Server, nicht für Seerr.

## Bekannte Grenzen

- Getestet mit einem Mock-Server, einem mpv-Simulator und dem echten mpv (Testvideo über den Mock-Server), **nicht** gegen einen echten Jellyfin-Server.
- Mit dem echten mpv geprüft: Start, Direct Play per HTTP mit Token-Header, `gpu-next`, Hardware-Dekodierung `d3d11va`, Bild sichtbar,
  Pause/Seek/Tempo/Lautstärke, Untertitel, Größenänderung, Vollbild. **Nicht** geprüft: echtes HDR/Dolby Vision auf einem HDR-Monitor und Audio-Passthrough
  zu einem Receiver (dafür braucht es passende Hardware und Quelldateien).
- HDR-Durchreichen hängt von Windows (HDR aktiviert), Monitor und Treiber ab.
- Die Geräteerkennung für die Kanäle ist gegen den echten Windows-Aufruf geprüft (liefert Gerät, Kanalzahl, Bauart) und die Entscheidungslogik per Test. Mit einem echten
  Receiver, Kopfhörern oder einer Stereo-Anlage wurde sie **nicht** ausprobiert; der Rückfall bei fehlender Tonausgabe ist mit einem echten mpv und einem absichtlich ungültigen Gerät geprüft.
- Der Transcode-Pfad (Spurwechsel, Rückfall) ist gegen den Mock-Server mit simuliertem mpv geprüft, nicht gegen einen echten Jellyfin-Server mit laufendem HLS-Transcode.
- Musikbibliotheken, Live-TV und Fernsteuerung durch andere Jellyfin-Clients werden nicht unterstützt.
- Electron meldet beim Start, dass `safeStorage.isEncryptionAvailable` und `encryptString` veraltet sind (Ersatz: `isAsyncEncryptionAvailable`, `encryptStringAsync`). Die App läuft damit mit der gepinnten Electron-Version (45.2.1) einwandfrei;
  bei einem Wechsel auf eine neuere Version müsste `config.js` auf die asynchronen Aufrufe umgestellt werden (alle Aufrufer von `saveServer`/`getServer` werden dann asynchron).
- Die Verwaltung (Administratoren) ist nur gegen den Mock-Server geprüft, nicht gegen einen echten Jellyfin-Server.
- Der Updater ist gegen einen lokalen Webserver und einen Ordner geprüft, nicht mit dem echten Installer (stilles Ersetzen der installierten App) und nicht gegen eine Quelle im Internet. Ein Update-Ablauf mit echtem Installer sollte einmal von Hand
  ausprobiert werden, bevor man sich darauf verlässt. Ohne Signatur gibt es keine Herkunftsprüfung außer der Prüfsumme aus `latest.json`.
- Prüfungen der Oberfläche (`tools/shots/audit-*.js`): Menüs und Dialoge passen in drei Fenstergrößen, Textkontrast in allen vier Themes (WCAG AA), Randfälle (sehr lange Titel und Namen, fehlende Bilder, viele Genres), Namen aller bedienbaren Elemente.
