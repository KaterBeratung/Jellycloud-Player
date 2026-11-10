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
- **Infuse-ähnliche Oberfläche:** Hero-Banner und Reihen vor allem mit **Neuzugängen** (Banner: nur Neues, Filme und Serien abwechselnd; darunter ganz oben *Weiterschauen*, dann *Neu in Filme*, *Neu in Serien*, Als Nächstes, Favoriten), Poster-Raster mit 4K/HDR/Atmos-Badges,
  Detailseite mit Version, Audio und Untertiteln vor dem Start, Staffeln und Folgen, Besetzung, technische Details.
- **Player:** eigene Steuerung im Liquid-Glass-Stil (Seekbar mit Trickplay-Vorschau, Kapitel, Intro/Abspann überspringen,
  nächste Folge, **Folgen und Staffeln der Serie** zum Wechseln, Countdown an Überspringen und Nächste Folge, Tempo, Bildformat, Audio-/Untertitel-Panel mit Verzögerung und Größe, Technik-Info). Untertitel
  weichen der Steuerleiste aus. Alle Panels passen ohne Scrollen (zweispaltig bzw. verdichtet).
- **Anpassbar:** Themes (Midnight, Graphite, AMOLED, Daylight), **Akzentfarbe für Buttons usw.** (Farbfelder,
  Farbwähler, Hex-Code), Postergröße, Eckenradius, Animationen (voll/reduziert/aus), Glas-Effekte, Sprache (DE/EN).
- **Konto:** Anmeldung mit Benutzer/Passwort oder Quick Connect, mehrere Server, Token per Windows-DPAPI verschlüsselt.
  Fortschritt, „gesehen“ und Favoriten werden mit dem Server synchronisiert.
- **Trailer:** Auf der Detailseite und im Banner der Startseite läuft der Trailer im Hintergrund, sofort und leise (siehe *Trailer*).
- **Verwaltung für Administratoren:** Server (Info, Bibliotheken durchsuchen, Neustart, Herunterfahren), Aufgaben, Aktivität, Benutzer, Metadaten bearbeiten, identifizieren, Einträge löschen (siehe *Verwaltung*).
- **Lange Untertitel-Listen:** Ab 9 Spuren ordnet die Auswahl auf der Detailseite und das Spur-Panel im Player die Untertitel nach Sprache: gleich zu sehen sind die bevorzugten Sprachen (eingestellte Untertitelsprache, Oberfläche, Tonspur, Englisch) und die gewählte Spur, der Rest steckt hinter *Weitere Sprachen*.
- **Anfragen:** Titel, die es noch nicht gibt, lassen sich über Seerr anfragen (siehe *Anfragen mit Seerr*). Die Startseite zeigt unten die Reihe *Filme im Trend* (aus Seerr), ohne Seerr-Verbindung einen Hinweis zur Einrichtung, und im Banner oben gut bewertete Trend-Filme (standardmäßig zwei).
- **Probleme melden:** Auf der Detailseite zeigt ein **Warnschild** in der Knopfleiste (zwischen Herz und „Mehr“, auch unter *Mehr > Problem melden …*) ein Fenster, in dem sich zu Video, Audio, Untertiteln oder Sonstigem ein Problem an Seerr melden lässt, der Kommentar ist freiwillig (siehe *Probleme an Seerr melden*).
- **Discord Rich Presence:** Zeigt in Discord, was du gerade schaust, mit Poster, Folge und Fortschritt und einem Namen, den du selbst wählst (siehe *Discord Rich Presence*). Aus, bis du es einschaltest; die Discord-Anwendung ist eingebaut, es ist keine Einrichtung nötig.
- **Startseite anpassen:** *Einstellungen > Startseite*: Banner an oder aus, Zahl der Folien und der Trend-Folien, Reihen ein- und ausschalten und umsortieren (siehe *Startseite anpassen*).
- **Neu laden:** F5, Knopf in der Kopfzeile, Metadaten vom Server aktualisieren lassen (siehe *Neu laden und Metadaten*).
- **Autostart:** Optional mit Windows starten, auf Wunsch minimiert.
- **Startanimation:** Beim Start zeichnet sich das Logo, dann fährt die Kamera durch es hindurch in die Oberfläche (siehe *Startanimation*). Abschaltbar, mit Vorschau.

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
  auf Daylight nimmt sie die dunkle Textfarbe mit schwächerem Leuchten. (Bis 0.0.43 war das App-Symbol eine silberne Wolke mit dunklem Rand ohne Leuchten.)
- **Standardfarbe:** neutrales Silberweiß (`#f5f5f7`) wie bei Apple TV für Buttons, Navigation, Fortschritt und Markierungen. Die Farbe ist unter *Erscheinungsbild* frei wählbar (Königsblau ist eines der Farbfelder). Die Regeln stehen in `src/shared/accent.js`
  und gelten für Oberfläche und Player gleich: Weiß, Grau und Schwarz passen sich dem Theme an (auf Daylight wird Weiß zu Fast-Schwarz, sonst wären
  Buttons unsichtbar); helle Akzente bekommen dunkle Schrift und eine abgedunkelte Tönung für durchscheinende Auswahlzustände (`--accent-rgb`);
  Text und Icons in Akzentfarbe werden so weit aufgehellt bzw. abgedunkelt, dass der Kontrast mindestens 4,5:1 beträgt (`--accent-fg`).
  Bestehende Installationen mit dem alten Standard-Blau bekommen einmalig das neue Silberweiß (Konfigurationsversion 3); eine danach bewusst
  gewählte Farbe bleibt.
- **Hintergrundton:** Die Seite nimmt auf Start (aktuelles Banner) und Detailseite dezent die Farbe des gezeigten Bilds auf (13 % bei Midnight, bei
  AMOLED weniger, bei Daylight ein Hauch) und blendet sie bei anderen Seiten wieder aus. Die Farbe kommt aus dem Blurhash des Servers
  (`ImageBlurHashes`, ohne Bild zu laden); fehlt er, bleibt der Hintergrund neutral. Abschaltbar unter *Erscheinungsbild*
  („Hintergrund passt sich dem Bild an“). Umsetzung: `ambient.js`, `color.js`, CSS-Eigenschaften `--tint`, `--tint-amt`, `--page`.
- **Kopfzeile:** ganz oben eine schmale Titelzeile (Ziehfläche und Windows-Fensterknöpfe), darunter links die **Marke „Jellycloud“** als eigene Glas-Kapsel (44 px, bei schmalen
  Fenstern nur die Wolke), gestaltet wie das Logo der Startanimation: Wolkenumriss mit Leuchten in der Akzentfarbe (auf Daylight in der dunklen Textfarbe und mit schwächerem Leuchten) und der Schriftzug in Großbuchstaben mit weitem Buchstabenabstand (`.brand-mark`, `.brand-name` in `app.css`), die Navigation (Start, Filme, Serien) als Kapsel **mittig** (wie die Tab-Leiste in Apple TV) und rechts eine Kapsel gleicher Höhe mit Suche, Neu laden, Einstellungen und
  Konto als identische 36-px-Scheiben. Die Ziehfläche sind die Titelzeile und der freie Platz neben den Kapseln: Eine ganze Leiste als Ziehfläche zu markieren
  und Knöpfe auszunehmen verschluckt unter Windows die Klicks.
- **Apple-TV-Stil:** neutrales Dunkel ohne Blaustich (Apple-Grautöne), großer Hero mit dem Inhalt unten links und Seitenpunkten in einer Glaskapsel
  unten mittig, Reihentitel mit Pfeil (führt zur ganzen Bibliothek), Karten mit größerem Radius, die sich beim Zeigen heben, zur Maus neigen
  (bis 7°, bei „reduziert“ halb so stark, bei „aus“ gar nicht) und einen Glanzpunkt bekommen (`attachTilt` in `ui.js`), Fokusring weiß statt in
  der Akzentfarbe. Die Akzentfarbe bleibt für Buttons, Fortschritt und Markierungen. Bestehende Installationen mit dem alten Standard-Radius 14
  bekommen einmalig den neuen Standard 18 (Konfigurationsversion 2); eigene Werte bleiben.
- **Kein Scrollbalken (seit 1.1.4):** Die Oberfläche hat nirgends einen sichtbaren Scrollbalken (weder am Fensterrand noch in Menüs, Dialogen und Listen), wie bei Netflix und Apple TV; es bleibt auch kein 12-px-Streifen reserviert, der Inhalt nutzt die volle Breite.
  Gescrollt wird mit Mausrad, Touchpad, Fingern und Tastatur (Bild hoch/runter, Pos1/Ende, Leertaste; `#view` ist fokussierbar). Umsetzung: `* { scrollbar-width: none; }` und `::-webkit-scrollbar { display: none; }` am Anfang von `app.css`; wer eine eigene Breite braucht, muss `scrollbar-width: none` selbst setzen (Klassenregeln schlagen die allgemeine).
  Ausnahme: die Popups im Player-Overlay (Spuren, Info, Folgenliste) haben noch ihren schmalen, durchscheinenden Balken. Szenario `no-scrollbar.js`.
- **Personen ohne Foto:** runde Scheibe in der Akzentfarbe mit Initialen. (Die Bildplatzhalter hießen früher `empty`, wie der Leerzustand einer
  ganzen Seite, und erbten dessen großen Innenabstand; daher die Klasse `noimg`.)

## Einstellungen

Elf Bereiche, orientiert an dem, was Infuse, VLC, Plex und mpv-Frontends anbieten:

| Bereich | Auswahl |
| --- | --- |
| Erscheinungsbild | Theme, Akzentfarbe (Farbfelder, Farbwähler, Hex), Postergröße, Eckenradius, Animationen, Glas-Effekte, **Startanimation** (mit Vorschau), Sprache |
| Startseite | **Banner** (an/aus, wechselt automatisch, Folien 3 bis 10, Trend-Folien 0 bis 4) und **Reihen** (jede ein- und ausschaltbar, mit Pfeilen umsortieren, *Filme im Trend* eingeschlossen), Zurücksetzen |
| Bild & HDR | HDR-Ausgabe, Tone-Mapping-Verfahren, Spitzenhelligkeit, Hardware-Dekodierung, Grafik-API (D3D11/Vulkan), Skalierungsqualität, Video-Sync, Bewegungsglättung, Debanding, Zeilensprung, Helligkeit/Kontrast/Sättigung/Gamma |
| Ton | Ausgabegerät (mit Anzeige des erkannten Geräts), Kanäle (Auto/Stereo/5.1/7.1), Passthrough (nur digitale Ausgänge), WASAPI exklusiv, Nachtmodus |
| Sprache & Untertitel | Audiosprache, Untertitel-Modus (Server/Aus/Erzwungen/Immer/Smart), Untertitelsprache, Größe, Position, Farbe, Umrandung, Hintergrundkasten, Fett, Schriftart, ASS-Stil, Live-Vorschau |
| Wiedergabe | **Trailer** (automatisch, stumm starten, Verzögerung, Text ausblenden, Lautstärke, Qualität bis 4K), nächste Folge automatisch, Intro/Abspann überspringen (Button/Auto/Aus), Countdown an den Knöpfen (6 s), Rücksprung beim Fortsetzen, Vollbild beim Start, Sprungweiten, Mausrad, Pause beim Minimieren, Bildschirm anlassen |
| Netzwerk | Qualitätsgrenze, Transcoding erlauben, Puffergröße, Vorausladen, selbstsignierte Zertifikate |
| Anfragen (Seerr) | Verbindung zu Seerr: Adresse, Anmeldung per Jellyfin-Konto oder API-Schlüssel |
| Discord | **Rich Presence** (zeigt, was du schaust): Schalter, Verbindung testen, Statuszeile, **Name in Discord** (frei wählbar, Knopf *Servername*), Poster-Quelle (Automatisch/TMDB/Server/Kein), Titel verbergen, Link zur Titelseite (Knopf und anklickbarer Titel), optional eine eigene Application-ID mit Anleitung |
| Allgemein | mpv-Status (nur Anzeige), **mit Windows starten**, **minimiert starten**, Fenster merken, Spoiler-Schutz, Bildcache leeren, alles zurücksetzen |
| Konto, Info | Server, Abmelden, Tastenkürzel |

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
oder mit einem **API-Schlüssel**. Die Zugangsdaten bleiben im Hauptprozess. Ist Seerr verbunden, zeigt die **Suche** unter den Treffern der Bibliothek die Gruppe *Bei Seerr anfragen*:
Titel, die es noch nicht gibt, mit Poster von TMDB (über das App-Protokoll, nur feste Größen) und der Schaltfläche *Anfragen*. Bereits Angefragtes, in Bearbeitung Befindliches oder teilweise Verfügbares
zeigt eine Beschriftung statt der Schaltfläche, Verfügbares fehlt (es steht schon in der Bibliothek). Serien werden komplett angefragt. Fehler sind verständlich (Kontingent, schon angefragt, Sitzung abgelaufen);
eine abgelaufene Seerr-Sitzung führt **nicht** zur Jellyfin-Anmeldung, sondern zu einem Hinweis mit Weg in die Einstellungen.

**Details beim Anklicken:** Ein Klick auf eine Anfrage-Karte (Poster oder Beschriftung, per Tastatur Enter oder Leertaste auf dem Poster) öffnet ein Detailfenster (`src/renderer/js/views/request-detail.js`): sofort mit
dem, was die Suche schon kennt (Titel, Poster, Beschreibung), dann nachgeladen aus Seerr (`/movie/{id}` bzw. `/tv/{id}`): Hintergrundbild, Jahr, Laufzeit, Bewertung, Genres, Tagline, Regie bzw. *Erstellt von*, Erscheinungsdatum,
bei Serien Staffeln, Folgen und Stand, dazu die **Besetzung** mit Fotos (oder Initialen). Im Fenster steht die Schaltfläche *Anfragen* (oder der Stand, wenn schon angefragt); die Anfrage von dort aktualisiert auch die
Karte dahinter. Schließen mit Kreuz, Esc, Klick neben das Fenster oder beim Seitenwechsel; der Fokus kehrt zum Poster zurück, Tab bleibt im Fenster. Schlägt das Nachladen fehl, bleiben die bekannten Angaben und die Schaltfläche,
dazu ein Hinweis (bei abgelaufener Sitzung mit Weg in die Einstellungen). Ohne Hintergrundbild dient das verwischte Poster als Kopf.

**Filme im Trend auf der Startseite:** Ganz unten auf der Startseite (unter Weiterschauen, Neuzugängen, Als Nächstes und Favoriten) steht die Reihe *Filme im Trend, über Seerr*. Sie holt `GET /discover/trending` (Seerr mischt dort Filme, Serien und Personen) und behält nur
die **Filme**: ohne Serien, Personen, Doppelte und gesperrte Titel (Stand 7), bis zu 20, gelesen über höchstens drei Seiten; scheitert eine spätere Seite, bleibt es bei dem, was da ist. Die Karten sind dieselben wie in der Suche (`views/request-card.js`): Poster von TMDB,
*Anfragen*-Knopf bei offenen Titeln, sonst die Beschriftung *Angefragt*, *Wird bearbeitet*, *Teilweise verfügbar* oder grün *Verfügbar*; ein Klick auf das Poster öffnet das Detailfenster. Die Liste bleibt zehn Minuten im Speicher der Oberfläche (die Startseite wird etwa nach
jedem Film neu aufgebaut, das soll Seerr nicht jedes Mal fragen); Anfragen aus der Reihe ändern den gemerkten Stand mit. Die Reihe wartet nicht auf die Bibliotheks-Reihen und blockiert sie nicht.
**Ohne Seerr-Verbindung** steht an ihrer Stelle ein Hinweis mit angedeuteten Postern, der erklärt, was dort erscheint, und *Seerr einrichten* (führt in *Einstellungen > Anfragen*) sowie *Ausblenden* anbietet. Ist Seerr verbunden, aber nicht erreichbar, bleibt die Startseite ohne die Reihe
(kein Fehlerhinweis); eine abgelaufene Seerr-Anmeldung zeigt statt der Karten den Hinweis mit Weg in die Einstellungen. Ausschalten: *Einstellungen > Startseite > Reihen > Filme im Trend* (auch der Knopf *Ausblenden* setzt das); Verbinden und Trennen von Seerr verwirft die
gemerkte Startseite, damit sie sofort die Reihe bzw. den Hinweis zeigt. Es gibt keine Quelle für Trends ohne Seerr: der Player bringt keinen eigenen TMDB-Schlüssel mit.

**Gut bewertete Trend-Filme im Banner:** Im Banner oben auf der Startseite stehen zwischen den Neuzugängen standardmäßig **zwei** Folien *Im Trend* (an dritter und fünfter Stelle; Zahl der Folien und der Trend-Folien sind unter *Einstellungen > Startseite* einstellbar, die Trend-Folien nehmen den Platz von Neuzugängen). Gewählt werden aus
der Trend-Liste (dieselbe wie in der Reihe, nur einmal geholt) in der Reihenfolge von Seerr die Filme mit einer **TMDB-Bewertung ab 7,0** und einem Hintergrundbild (`HERO_TREND_SLIDES`, `TREND_MIN_RATING` in `views/home.js`). Es gibt zwei Arten von Folien:
- **Film nicht in der Bibliothek** (`seerrSlide()`): Hintergrundbild von TMDB in der Stufe `w1280` (Titelbild, kein Logo), Jahr, Bewertung, *Film*, Beschreibung. *Details* öffnet dasselbe Fenster zum Anfragen wie die Karten der Reihe, *Anfragen* fragt gleich an; ist schon etwas angefragt, steht der Stand (*Angefragt*,
  *Verfügbar* ...) statt des Knopfes, und die Karte in der Reihe zeigt denselben Stand (beide teilen die Daten). Der **Trailer** kommt wie bei den anderen Folien (Einstellungen *Trailer*, *Auch auf der Startseite*): Seerr liefert ihn in den Details (`relatedVideos`; `trailerKey` in `normalizeDetails`: erst ein Trailer, sonst
  ein Teaser, nur YouTube mit echtem Schlüssel aus 11 Zeichen).
- **Film schon in der Bibliothek:** Meldet Seerr den Titel als verfügbar oder teilweise verfügbar, sucht die App ihn über die TMDB-Nummer (`anyProviderIdEquals=tmdb.<Nummer>`, nur Filme) in der Bibliothek. Gefunden: die normale Bibliotheks-Folie mit *Abspielen*, *Details* und dem Trailer des Eintrags, nur mit der Beschriftung *Im Trend*;
  er steht dann nicht noch einmal als Neuzugang im Banner.

Das Banner wartet höchstens 1,5 s auf Seerr (`TREND_WAIT_MS`): ist die Liste bis dahin nicht da (Seerr langsam), steht es wie früher ohne Trend-Folien, und die Reihe darunter erscheint, sobald Seerr antwortet; beim nächsten Aufbau der Startseite ist die Liste im Speicher und die Folien sind da. Ohne Seerr-Verbindung, bei
Seerr-Fehlern, ohne passende Filme oder bei ausgeschalteter Reihe (*Einstellungen > Startseite > Reihen > Filme im Trend*, der Schalter gilt für Reihe und Banner) oder 0 Trend-Folien bleibt das Banner wie es war. Ein Fehlschlag wird nicht gemerkt, der nächste Aufbau fragt wieder. Szenario: `tools/shots/home-trend-hero.js` (Port 8397).

Technisch: `src/main/seerr.js`, API `/api/v1` (`auth/jellyfin`, `search`, `request`, `issue`, `discover/trending`, `movie/{id}`, `tv/{id}`); die Detailantwort wird auf feste Typen und Längen reduziert (`normalizeDetails`), Bildpfade gelten nur in der Form, die das App-Protokoll annimmt. Alle Anfragen laufen mit `credentials: omit`, damit Chromiums Cookie-Speicher das Seerr-Cookie nicht heimlich
mitschickt (sonst würde ein falscher API-Schlüssel durch ein altes Cookie akzeptiert). Getestet gegen einen Mock-Seerr, **nicht** gegen einen echten Seerr-Server.

## Probleme an Seerr melden

Ist Seerr verbunden, steht auf der Detailseite gleich in der Knopfleiste ein **Warnschild** (Symbol `warning`, runder Knopf wie Gesehen und Favorit, beim Zeigen wie die anderen Knöpfe, Beschriftung „Problem melden“) und zusätzlich im Menü *Mehr* der Eintrag **Problem melden …** (`views/issue-dialog.js`). Das Fenster fragt nach der **Art** (Video, Audio, Untertitel, Sonstiges, entspricht `issueType` 1 bis 4 bei Seerr) und nimmt einen **freiwilligen Kommentar** (bis 2000 Zeichen) entgegen;
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

- **Banner:** *Banner anzeigen* (aus: die Reihen beginnen gleich unter der Kopfleiste, im Banner laufen keine Trailer und nichts wird dafür geladen), *Banner wechselt automatisch*, *Folien im Banner* (3 bis 10, Standard 6) und *Trend-Filme im Banner* (0 bis 4, Standard 2).
- **Reihen:** Jede Reihe (*Weiterschauen*, *Neu in <Bibliothek>* je Bibliothek, *Als Nächstes*, *Favoriten*, *Filme im Trend*; so ist auch die Standardreihenfolge: **Weiterschauen steht standardmäßig ganz oben**, `TOP_ROWS` in `src/shared/home-rows.js`) hat eine Nummer, einen Schalter und Pfeile nach oben und unten. Gespeichert werden nur die Wünsche (`order`, `hidden`): eine neue Bibliothek erscheint automatisch hinter den bisherigen,
  eine gelöschte lässt die Einstellung wirkungslos stehen. Reihen ohne Inhalt (nichts angefangen, keine Favoriten) fehlen auch eingeschaltet. *Filme im Trend* teilt sich den Schalter mit `appearance.homeTrending`, damit der Knopf *Ausblenden* auf der Startseite und die Einstellung dasselbe sind.
- **Alles ausgeblendet:** Sind alle Reihen und das Banner aus, zeigt die Startseite einen Hinweis mit Weg in die Einstellungen statt einer leeren Fläche. Auch der Hinweis, der nach *Ausblenden* der Trend-Reihe erscheint, führt mit *Startseite* in diese Einstellungen.
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
- **Einstellungen > Erscheinungsbild:** *Startanimation* (Schalter, Standard an) mit Knopf **Vorschau**, der sie über der Einstellungsseite abspielt. *Animationen: Reduziert* spielt eine ruhige Fassung in 45 % der Zeit (ohne Ring, Lichtblitz und Zoom, die Oberfläche blendet nur ein), *Animationen: Aus* lässt sie ganz weg (die Vorschau meldet dann, dass sie Animationen braucht).
- **Hinweise warten:** Der Hinweis „Aktualisiert auf …“ und die Meldung über ein gefundenes Update erscheinen erst nach dem Vorspann (`afterSplash()`), sonst wären sie darunter unsichtbar abgelaufen.
- **Leicht zu halten:** Nur das Logo zoomt (die Glanz-, Blitz- und Ringebene blenden vorher aus, hochskaliert wären sie riesige, teure Flächen). In der VM ohne Grafikkarte liegt der größte Bildabstand bei rund 35 ms.
- **Szenarien:** `--shots` startet die App mit ausgeschalteter Startanimation (`main.js`), damit sie die anderen Läufe nicht verdeckt; `tools/shots/startup-anim.js` schaltet sie gezielt ein und prüft Ablauf, Überspringen, Stufen, Schalter, Vorschau und das Warten bis das Fenster sichtbar ist.

## Neu laden und Metadaten

**F5** oder der Knopf in der Kopfzeile holt die Daten der sichtbaren Ansicht neu vom Server, **Strg+Umschalt+R** leert zusätzlich den Bildspeicher und baut alles neu auf (etwa wenn sich Bibliotheken ändern).
Auf der Detailseite bietet der Knopf *Mehr* außerdem *Fehlende Metadaten ergänzen* und *Metadaten und Bilder ersetzen*: Der Server holt sie neu (`POST /Items/{id}/Refresh`), danach lädt die Seite selbst neu.
Das dürfen nur Administratoren; sonst erscheint eine verständliche Meldung. Bei großen Serien arbeitet der Server länger, dann hilft ein späteres *Neu laden*.

## Einstellungen wirken sofort

Startseite und Bibliothek bleiben beim Verlassen im Speicher des Routers (schnelles Zurück) und lesen die Einstellungen beim Aufbau. Ändert man in den Einstellungen etwas, das sie betrifft (*Banner wechselt automatisch*, *Filme im Trend auf der Startseite*, *Qualitäts-Badges*,
*Spoiler-Schutz*, alle *Trailer*-Einstellungen), verwirft `settings.js` die gemerkten Ansichten (`invalidate()`), und der nächste Besuch baut sie mit den neuen Werten auf, ohne Neuladen. Reine Darstellung (Theme, Akzent, Radius, Postergröße) wirkt sofort per CSS und lässt
die gemerkten Seiten in Ruhe. Das Szenario `tools/shots/settings-live.js` prüft es.

## Verwaltung (Administratoren)

Ist das Jellyfin-Konto **Administrator** (`Policy.IsAdministrator` aus `GET /Users/Me`, wird beim Start zusammen mit den Bibliotheken geholt; ein Fehler dabei heißt „kein Administrator“), erscheint in der Kopfzeile ein
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
`https://github.com/KaterBeratung/jellycloud-releases/releases/latest/download/` (`DEFAULT_UPDATE_SOURCE` in `src/main/config.js`). Diese Adresse liefert ohne Anmeldung immer die Dateien des neuesten Releases
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

**Direkter Download-Link, immer die neueste Version:** `https://github.com/KaterBeratung/jellycloud-releases/releases/latest/download/Jellycloud-Player-Setup.exe`. Dafür hat jedes Release neben dem Installer mit Versionsnummer eine **Kopie mit festem Namen** (`Jellycloud-Player-Setup.exe`, dieselbe Datei):
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
(3000 Filme, VM ohne GPU): Laden bis zum Ende 94,9 s auf 38,2 s, lange Aufgaben beim Laden 25,4 s auf 0, Bildzeit beim Zurückscrollen 156 ms auf 31 ms. Badges auf Karten haben keinen Weichzeichner mehr.

## Arbeitsspeicher der Startseite

Gemessen mit Mock-Server in der VM (Summe der privaten Bytes aller Prozesse, `getAppMetrics`): Startseite ohne Trailer rund 200 bis 280 MB, mit laufendem Full-HD-Trailer im Banner rund 450 bis 500 MB. Der Trailer ist ein eigener
YouTube-Prozess und der größte Posten (angehalten kostet er genauso viel). Deshalb baut `trailer.js` den Player ab, wenn das Fenster oder der Trailer länger als eine Minute verdeckt oder aus dem Blick ist (`REST_RELEASE_MS`): auf der
Startseite danach wieder rund 230 MB (Arbeitssatz 1051 auf 658 MB). Das Bildspeicher-Limit im Hauptprozess liegt bei 64 MB (vorher 128 MB). Wer weniger will, schaltet *Trailer > Auch auf der Startseite* aus oder stellt die Trailer-Qualität
auf 720p (Banner-Trailer 720p statt 1080p: rund 85 MB weniger). Die Neuzugänge je Bibliothek werden gleichzeitig mit Weiterschauen, Als Nächstes und Favoriten geladen (früher danach), die Startseite steht eine Wartezeit früher.
Szenario: `tools/shots/trailer-release.js`.

## Jellyfin-CSS

Im Ordner `jellyfin-css/` liegt ein **benutzerdefiniertes CSS für den Jellyfin-Web-Client** (Dashboard > Allgemein) im Stil von ElegantFin (Blau-Grau, Indigo; eigener Code, ElegantFin steht unter GPL-2.0), mit Gestaltung der Media Bar: `jellycloud.css`, eine Anleitung (`README.md`, Einbau, Akzentfarbe,
Media Bar) und `preview.html` als Vorschau ohne Jellyfin. Die Datei liegt öffentlich im Repo `KaterBeratung/jellycloud-releases` (Ordner `jellyfin-css/`); in Jellyfin genügt eine Zeile
(`@import url("https://cdn.jsdelivr.net/gh/KaterBeratung/jellycloud-releases@main/jellyfin-css/jellycloud.css");`, über jsDelivr, weil GitHub-Raw Stylesheets als `text/plain` ausliefert und Browser sie für `@import` ablehnen).
Aktualisieren: `tools\publish-jellyfin-css.ps1` (öffentlich, nur nach Freigabe). Es gehört nicht zur App (wird nicht mitgebaut). Geprüft im Browser an einem lokalen **Jellyfin 12.4** und mit der **Media Bar von MakD (Version 6)** in allen drei Layouts (Einzelheiten und was nicht geprüft ist: `jellyfin-css/README.md`, Szenario `tools/shots/jellyfin-css.js`; mit `JF_URL` und `JF_TOKEN_FILE` läuft es auch gegen einen echten Server).

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
  **nicht** mit einem CSS-Ablauf: bei *Animationen aus* liefe der sonst sofort durch. Die Füllung ist `.cd > i` in einer eigenen Hülle (Rundung und `overflow` dort, damit der unsichtbare Trefferstreifen des Knopfes nicht abgeschnitten wird).
- Geprüft: `tools/shots/player-countdown.js` (34 Prüfungen mit dem mpv-Simulator: 6 s Standard, Füllstand, automatisches Springen, Klick, Pause, einmal je Eintrag, aus, Animationen aus, nächste Folge mit und ohne Autoplay), `test/episode-list.test.js` (`skipCountdownSec`).

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
  Tab-Leiste unten (`buildTabbar` in `app.js`: Start, bis zu drei Bibliotheken, Suche, Einstellungen) statt Navigationskapsel, oben nur Wolke und Werkzeuge, Banner und Reihen in Handygröße, Bibliothek und Suche in drei Spalten, Detailseite gestapelt (Poster, Titel, Knöpfe in voller Breite), Folgen mit schmalen Vorschaubildern,
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

Die UI-Szenarien (Screenshots, Layout-Prüfung auf Überlappungen, Wiedergabe mit simuliertem mpv) laufen mit
`JC_DEV=1`, siehe `tools/shots/`:

```powershell
$env:JC_DEV='1'; $env:JC_FAKE_MPV='1'
npx electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/player.js
```

| Szenario | prüft |
| --- | --- |
| `player.js` | Oberfläche des Players, Layout ohne Überlappung, Server-Meldungen, Intro überspringen, nächste Folge |
| `player-countdown.js` | **Countdown an Überspringen / Nächste Folge** (34 Prüfungen, Simulator): 6 s Standard, Füllstand, springt von selbst, Klick, Pause hält an, einmal je Eintrag, aus, Animationen aus, nächste Folge mit und ohne Autoplay |
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
| `jellyfin-css.js` | `jellyfin-css/jellycloud.css`: ASCII, Klammern, kein Weichzeichner auf Karten, keine Fremdadressen, kein ElegantFin-Code, dazu die nachgebaute Vorschauseite (Tabs, Karten, Knöpfe, Dialog, Media Bar, Akzentfarbe per Variablen, schmales Fenster; 28 Prüfungen, kein Server nötig). Mit `JF_URL` und `JF_TOKEN_FILE` (Zugriffsschlüssel und Benutzer-Id in zwei Zeilen) zusätzlich 9 Prüfungen gegen einen echten laufenden Jellyfin (Startseite, Detailseite, MUI-Kopfleiste, Farbvariablen) |
| `trailer-volume.js` | **Lautstärkekapsel des Trailers** (28 Prüfungen, ohne Internet, echte Maus und Tasten): zu = runder Glas-Knopf, die Kapsel hat **exakt das Glas der Knöpfe** (computed Styles gleich), wächst beim Zeigen rechts aus dem Knopf (links bündig, gleiche Höhe), der Knopf ist dabei durchsichtig (ein Teil, keine Naht), bleibt in der Lücke und auf der Kapsel offen, beim Ziehen auch außerhalb, fährt nach 0,7 s (Maus weg) bzw. 2,2 s (Mausrad, Tasten, Klick) von selbst wieder ein, der Knopf bleibt dabei bis zum Ende durchsichtig, Klick und Tab funktionieren, am rechten Rand wächst sie nach links |
| `trailer-release.js` | Trailer nach einer Minute Ruhe (Fenster verdeckt oder aus dem Blick) abgebaut, hier mit 1,5 s: kurze Pausen behalten denselben Player, danach kein YouTube-Rahmen mehr (Hauptprozess geprüft), Arbeitsspeicher sinkt, beim Zurückkommen ein neuer Player, `destroy` räumt den Zeitgeber ab; braucht Internet |
| `trailer-once.js` | Trailer nur einmal: keine Schleife in der Einbettung, nach dem Ende kein Neustart durch Scrollen oder Sichtbarkeitswechsel, Banner spielt eine Folie im selben Besuch nicht noch einmal, neuer Besuch spielt wieder; braucht Internet |
| `home-back.js` | zurück auf die Startseite auf vielen Wegen (aus Detail, Bibliothek, Einstellungen, Suche, gescrollt, mit und ohne Trailer im Banner): Bild für Bild, ob Banner und Reihen an ihrem Platz sind |
| `settings-live.js` | Einstellungen wirken ohne Neuladen (Banner, Badges, Trailer, Theme lässt die Seiten im Speicher) |
| `trailer-series.js` | Absinken bei Serien und Filmen in drei Fenstergrößen (Bilder vom Ruhezustand, aus der Mitte, vom Ende; misst Poster und Titel); braucht Internet |
| `admin.js` | Verwaltung gegen den Mock (66 Prüfungen): ohne Rechte nichts sichtbar, Server (Info, Durchsuchen, Neustart/Herunterfahren mit doppelter Rückfrage), Aufgaben, Aktivität, Benutzer (anlegen, sperren, Passwort, löschen), Einträge bearbeiten/identifizieren/löschen, 403 bei entzogenen Rechten |
| `subtitles.js` | lange Untertitel-Listen: Auswahl auf der Detailseite (kurz, aufgeklappt, gewählte Sprache bleibt sichtbar), Technik-Info, Spur-Panel im Player (mpv-Simulator mit 24 Zusatzspuren) |
| `seerr.js` | Seerr: Verbinden (Jellyfin-Konto, API-Schlüssel), Suche, **Details-Fenster** (Laden, Besetzung, Fokus, Esc, Anfragen von dort, Fehlerfälle), Anfragen, abgelaufene Sitzung, Trennen, Konsole ohne Skriptfehler (Mock-Seerr) |
| `seerr-issue.js` | **Problem melden** (31 Prüfungen, Mock-Seerr, Port 8897): **Warnschild** in der Knopfleiste (Lage, Größe, Beschriftung, öffnet das Fenster; fehlt ohne Seerr, ohne TMDB-Nummer und nach dem Trennen), Eintrag im Menü *Mehr* nur mit Seerr und TMDB-Nummer, vier Arten, Kommentar freiwillig, *Melden* erst nach der Wahl, Film, Serie und Folge (Staffel und Folge gehen mit), Ersatztext ohne Kommentar, Esc sendet nichts, Fehler im Fenster (403, Titel Seerr unbekannt) ohne Textverlust, gewählte Art klar markiert |
| `compact-audit.js` | **Handy-Ansicht auf Abgeschnittenes absuchen** (Web-Fassung, 22 Seiten und Menüs in 412×891, 360×740 und 800×411): Text und Knöpfe außerhalb des Fensters oder von einem Rahmen mit `overflow: hidden` gekappt, Tab-Beschriftungen nur mit „…“, Seitenende unter der Tab-Leiste, Menüs, die herausragen, waagerechtes Scrollen; Aufnahmen bei 412 px |
| `android-host.js` | **Hülle der Android-App ohne Handy** (23 Prüfungen, Mock-Server): Web-Bau mit `--host`, Nachbildung der **echten Capacitor-Brücke** (`nativePromise`, `PluginHeaders`, ohne `registerPlugin`; `CapacitorHttp`, `JellycloudPlayer`) per Debug-Protokoll eingeschleust, dazu ein Lauf mit der echten Laufzeit `@capacitor/core`, Diagnose-Zeile unter Einstellungen > Info; Hülle meldet Plattform/Version/Gerätename, Anmeldung und 401 über die „native“ Schicht, **Wiedergabe-Plan** (Direct Play, Token nur im Header, Startstelle aus „Weiterschauen“, Dauer, Titel, Geräteprofil ohne AC3/DTS), „Von vorn“, **Rückfall auf Transcode** ab der erreichten Stelle bei Decoder-Fehler, Fehlermeldung bei Serverfehler, Ereignisse (aktiv, geschlossen), Folgen-Titel, Links nur http(s) |
| `no-scrollbar.js` | **Kein Scrollbalken** (20 Prüfungen): auf Startseite, Film, Einstellungen und Bibliothek ist `scrollbar-width` aus, es bleibt kein Streifen am Rand (Inhalt so breit wie das Fenster), und **Mausrad und Bild-runter-Taste scrollen trotzdem**; kein scrollbares Element, keine Stylesheet-Regel (`thin`/`auto`, `::-webkit-scrollbar`) schaltet einen Balken ein; geöffnetes Sortier-Menü ohne Balken; Eingaben mit Fokus-Wiederholung (die VM verschluckt sie zwischendurch) |
| `hover-audit.js` | **Hover-Prüfung** (Port 9197, echte Mausereignisse per `sendInputEvent`, ohne Trailer): fährt auf den unteren und linken Rand von 100 bedienbaren Elementen auf sieben Seiten und misst, ob der Hover stabil bleibt (kein Zittern, kein Verlust), ob **Knöpfe, Reiter (Staffeln) und Auswahlfelder ohne Weichzeichner** sind (sonst Streifen am Rand), ob ein **Klick ganz am Rand** ankommt, ob bei Animationen *aus* nichts abhebt, ob jedes bedienbare Element den Zeiger zeigt, Karten nach dem Wegfahren wieder in Ruhe sind, **Menü bei Tastatur und Maus nur einen hervorgehobenen Eintrag** hat, die Knöpfe im **Player-Overlay** und „Weiter“ des Pausenbildschirms am Rand stabil sind und der Text beim Zeigen in allen vier Themes mindestens 4,5 : 1 Kontrast hat |
| `discord.js` | **Discord Rich Presence** (49 Prüfungen, **Fake-Discord** auf eigener Pipe über `JC_DISCORD_PIPE`, Mock-Seerr, Port 9097): Einstellungen (nur Ziffern in der eigenen ID, Test mit falscher und richtiger ID, Status), **eingebaute Anwendung** (Feld nur optional, Einschalten genügt, Test ohne ID) und **eigener Name** (Feld, Servername, leer, auf 128 gekürzt), Anzeige für Film und Folge (Titel, Jahr und Genres, S1E2, Poster von TMDB über Seerr, Fortschritt, Knopf), Pause, Weiterspielen, Sprung, keine Flut bei normalem Weiterlaufen, Titel verbergen, Poster-Quellen (Server im Heimnetz = kein Bild), Ende (Schonfrist, dann weg), Neustart von Discord, Ausschalten; nichts Vertrauliches auf dem Draht |
| `home-customize.js` | **Startseite anpassen** (32 Prüfungen, Port 8797): Einstellungen *Startseite* (Banner aus, Folien, Trend-Folien, Reihen ein/aus und umsortieren, Zurücksetzen), Wirkung sofort auf der Startseite, neue Bibliothek hinten, alles ausgeblendet, Schalter der Trend-Reihe, Überstehen eines Neustarts |
| `review-fixes.js` | Fehler aus der Durchsicht (14 Prüfungen, Port 8997), jeder nachgestellt und behoben: Bibliothek lädt nach einer kurzen, ganz geladenen Liste (Favoriten) beim Zurückwechseln auf *Alle* weiter, auf einem sehr großen Bildschirm (Zoom 25 %) auch ohne Scrollen, ein Filter während des ersten Ladens gilt, Zurück während eines Seitenübergangs zeigt die passende Seite, der Rahmen der Oberfläche lässt beim Neuaufbau keinen Zuhörer für `route` zurück, die Suche bleibt nach geleertem Feld nicht abgeblendet |
| `startup-anim.js` | **Startanimation**: Ablauf (Umriss, Dreieck, Schriftzug, Zoom, Oberfläche blendet ein), Zeit rund 2,7 s, Überspringen per Klick und Taste, Stufen *Aus* und *Reduziert*, Schalter und Vorschau in den Einstellungen, kein zweites Mal beim Neuaufbau, Warten bis das Fenster sichtbar ist, Hinweise erst danach, Bildabstände (Mock, Port 8497) |
| `home-trending.js` | Startseite: Reihe **Filme im Trend** (nur Filme, Reihenfolge, Stände, Anfragen und Details aus der Reihe, Zwischenspeicher), **Hinweis ohne Seerr** (einrichten, ausblenden, Schalter in den Einstellungen), Verbinden/Trennen baut die Startseite neu, Fehler und abgelaufene Anmeldung (Mock-Seerr, eigener Port 8197) |
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
| `src/shared/media.js` | Auswertung von HDR/Dolby Vision/Atmos für Badges (Hauptprozess und Oberfläche) |
| `src/shared/jellyfin.js`, `seerr.js`, `config-core.js`, `backend.js` | Clients, Konfiguration und die Rückseite der Oberfläche ohne Electron-Abhängigkeit; gemeinsam für Hauptprozess, Tests und `src/web` (siehe „Gemeinsamer Kern und Web-Fassung“) |
| `src/web/`, `tools/build-web.js`, `mobile/` | Oberfläche ohne Electron (`jc-web.js`), Baustein für den Ordner `www/` (mit `--host` samt Hülle), Android-App (Capacitor, Media3; Werkzeuge in `%LOCALAPPDATA%\jc-android`) |
| `src/shared/home-rows.js` | Regeln für die angepasste Startseite (Grenzen, Reihenfolge, ausgeblendete Reihen); gemeinsam für Hauptprozess und Oberfläche |
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
  sogar **verloren**, weil das Drücken den Knopf verkleinert (im Test 3 von 6 Klicks). Jetzt hält ein unsichtbarer Streifen in Richtung der Bewegung die Trefferfläche unter der Maus (`::before` in `app.css` und `player.css`), das Aussehen ist gleich. Bei *Animationen aus* entfällt die Hebung. Der Knopf *Intro überspringen*
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
