# Jellycloud für Jellyfin (CSS)

Ein dunkles, weiches Theme für den Jellyfin-Web-Client im Stil von **ElegantFin** (Jellyseerr-nahe Blau-Grau-Töne, Indigo als Akzent), mit passender Gestaltung der **Media Bar**. Eigener Code: nur das Aussehen ist angelehnt, ElegantFin steht unter GPL-2.0 und es wurde nichts davon übernommen.

- Hintergrund als Verlauf von `#111827` nach `#1d2635`, Text in hellem Grau, Indigo (`hsl(243 75% 62%)`) als Akzent
- Durchscheinende Kopfzeile, die nach unten weich ausläuft; Einträge als runde Kapseln, beim Überfahren hell, der gewählte Eintrag in Indigo
- Karten mit Rundung und dünnem Rand, beim Überfahren heller Rand, leichtes Vergrößern und ein Glanzstreifen; Abspielen als helle runde Fläche
- Detailseite: Abspielen als helle Kapsel, übrige Knöpfe rund und beim Überfahren hell, weich gezeichnetes Hintergrundbild, durchgehender Verlauf
- Eingabefelder, Menüs, Dialoge, Anmeldeseite im selben Stil; die MUI-Farben von Jellyfin 12 (Schalter, Knöpfe, Tabs) folgen dem Akzent
- Media Bar in allen drei Layouts (*marquee*, *plate*, *classic*): Abdunklung, helle Abspiel-Kapsel, runde Knöpfe, Seitenpunkte in einer Kapsel, Pfeile, Einstellungsfenster
- Eine Akzentfarbe für alles (drei Variablen), schmale Fenster und „weniger Bewegung“ berücksichtigt

**Vorschau ohne Jellyfin:** `preview.html` im Browser öffnen (Doppelklick). Sie ist nachgebaut und zeigt Kopfzeile, Startseite, Karten, Detailknöpfe, Dialog und Media Bar.

## Einbauen

1. Im Jellyfin-Dashboard: **Allgemein** (je nach Version unter *Branding*) → **Benutzerdefinierter CSS-Code**.
2. Diese eine Zeile einfügen und speichern:

   ```css
   @import url("https://cdn.jsdelivr.net/gh/KaterBeratung/Jellycloud-Player@main/jellyfin-css/jellycloud.css");
   ```

3. Die Jellyfin-Seite neu laden, am besten mit **Strg + F5** (der Browser hält die Seite sonst manchmal in der alten Fassung).

Die Datei liegt in einem öffentlichen GitHub-Repo und wird über den CDN-Dienst jsDelivr ausgeliefert (GitHub selbst liefert Stylesheets mit einem Typ, den Browser für `@import` ablehnen). Die Seitenaufrufe deiner Nutzer gehen dabei an `cdn.jsdelivr.net`. Änderungen an der Datei kommen nach spätestens 12 Stunden beim CDN an (wer es sofort braucht, ruft einmal `https://purge.jsdelivr.net/gh/KaterBeratung/Jellycloud-Player@main/jellyfin-css/jellycloud.css` im Browser auf), und **dein Browser behält die Datei bis zu 7 Tage**: Nach einem Update einmal **Strg + F5** auf der Jellyfin-Seite drücken, dann holt er die neue Fassung.

Ohne Fremdadresse geht es auch: den gesamten Inhalt von [`jellycloud.css`](jellycloud.css) statt der Zeile einfügen. (Die Datei ist reines ASCII, es gibt keine Zeichensatz-Probleme.) Eigene Änderungen, zum Beispiel die Akzentfarbe, kommen dann in dasselbe Feld unter die `@import`-Zeile oder in die kopierte Datei.

Das CSS wirkt überall dort, wo Jellyfins **Web-Oberfläche** angezeigt wird: im Browser und in Apps, die sie in einer WebView zeigen. Native Apps (zum Beispiel Android TV, Swiftfin) ignorieren eigenes CSS.

## Media Bar

Die Media Bar ist ein Zusatz von Dritten, nicht von Jellyfin selbst. Das CSS stellt sie nur um, es installiert sie nicht:

- **Original** (MakD): <https://github.com/MakD/Jellyfin-Media-Bar>, Einbau über `index.html` des Web-Clients (Skript und Stylesheet per jsDelivr)
- **Plugin-Fassungen**: <https://github.com/IAmParadox27/jellyfin-plugin-media-bar> (braucht das Plugin *File Transformation*), Fassung für 10.11: <https://github.com/CodeDevMLH/jellyfin-plugin-media-bar-enhanced>

Gestaltet werden die Klassen aus `slideshowpure.css` (Version 6): `#slides-container`, `.slide`, `.gradient-overlay`, `.logo`, `.plot`, `.play-button`, `.detail-button`, `.favorite-button`, `.dots-container`, `.dot`, `.arrow`, `.ss-settings` und die Zeilen der Layouts *classic*, *plate* und *marquee*. Das Banner behält die Größe, die das Plugin vorgibt. Wer es niedriger will (88 % der Fensterhöhe, höchstens 860 px), schaltet in Abschnitt 10 die zwei auskommentierten Zeilen `--slideshow-height` und `--slideshow-content-top` ein.

## Akzentfarbe ändern

Standard ist Indigo. Für eine andere Farbe diesen Block **unter die `@import`-Zeile** im Jellyfin-Feld setzen (er überschreibt die Vorgaben; bei einer kopierten Datei die Variablen im ersten Block ersetzen):

```css
:root {
  --jc-accent: #3b6bff;
  --jc-accent-rgb: 59 107 255;
  --jc-accent-ink: #ffffff;
  --jc-accent-hover: #6b8fff;
}
```

`--jc-accent` ist die Farbe für Flächen, `--jc-accent-rgb` die für durchscheinende Tönungen (bei hellen Farben dunkler), `--jc-accent-ink` die Schrift auf Akzentflächen und `--jc-accent-hover` die Farbe beim Überfahren und für Rahmen im Fokus. Werte, die zusammenpassen:

| Farbe | `--jc-accent` | `--jc-accent-rgb` | `--jc-accent-ink` |
| --- | --- | --- | --- |
| Indigo (Standard) | `hsl(243 75% 62%)` | `93 85 231` | `#ffffff` |
| Blau | `#3b6bff` | `59 107 255` | `#ffffff` |
| Violett | `#7a5cff` | `122 92 255` | `#ffffff` |
| Türkis | `#19c3c3` | `25 195 195` | `#12131a` |
| Grün | `#35d07f` | `53 208 127` | `#12131a` |
| Orange | `#ff8a1f` | `255 138 31` | `#ffffff` |
| Rosa | `#ff4d6d` | `255 77 109` | `#ffffff` |
| Silberweiß (wie die Jellycloud-App) | `#f5f5f7` | `147 147 148` | `#12131a` |

Wer die neutrale Optik der Jellycloud-App (Schwarz mit Grautönen statt Blau-Grau) möchte, setzt zusätzlich: `--jc-bg: #08080a; --jc-bg2: #161618; --jc-surface: rgb(22 22 24 / 0.9); --jc-input: #2d2d32; --jc-line: rgba(255,255,255,.08); --jc-line2: rgba(255,255,255,.15);`. Rundung der Ecken: `--jc-radius` (Standard `1em`).

## Was anders ist als in der App

Es ist ein Anstrich, kein Nachbau der App: Die Startanimation, der Hintergrundton aus dem Artwork, Trailer im Banner und das Mitwandern der Kopfzeile beim Scrollen gibt es im Web-Client nicht (oder sie liefert die Media Bar selbst). Das CSS ist dunkel, eine helle Variante gibt es nicht. Auf Karten steht bewusst kein Weichzeichner (`backdrop-filter`): bei Hunderten Karten kostet er viel Arbeitsspeicher und Grafikleistung.

## Geprüft und nicht geprüft

**Geprüft** im Browser an einem lokalen **Jellyfin 12.4** (Standard-Oberfläche, deutsche Sprache, Testfilme mit Postern, Hintergründen und Logos): Startseite, Bibliothek, Detailseite, Mehr-Menü, Benutzermenü, Anmeldeseite, Fenster in Telefonbreite, und mit der **Media Bar von MakD (Version 6)** in den Layouts *marquee*, *plate* und *classic* sowie in Telefonbreite. Dazu `tools/shots/jellyfin-css.js` (37 Prüfungen, davon 9 gegen den echten Server).

**Nicht geprüft:**

- Jellyfin **10.x und 11**: Die Regeln für die alte Kopfleiste (`.skinHeader`) und das Seitenmenü (`.mainDrawer`) stehen im CSS, sind aber dort nicht ausprobiert.
- Die **Plugin-Fassungen** der Media Bar (IAmParadox27, CodeDevMLH): sie sollten dieselben Klassen haben, das ist nicht verifiziert.
- Die **Verwaltungsseiten** (Dashboard): In Jellyfin 12.4 wird der benutzerdefinierte CSS-Code dort offenbar nicht geladen, sie bleiben im Standardaussehen.
- Die neue Oberfläche, die ElegantFin für Jellyfin 12 nur im Modus „Desktop (Legacy)“ unterstützt: Mit der Standardanzeige von 12.4 funktioniert dieses CSS, andere Anzeigemodi sind nicht probiert.

Zeigt etwas in deiner Version anders, im Browser **F12** drücken, das Element anklicken und den Klassennamen ansehen: Abweichungen lassen sich meist mit einer Zeile in Abschnitt 3 bis 10 beheben. `!important` steht dort, wo Jellyfin eigene Farben erzwingt.
