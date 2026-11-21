# Jellycloud – Verbindliche Entwicklungsrichtlinien

## Grundregel: Native Apple-Qualität, Performance und Codequalität

Jellycloud soll sich auf jeder unterstützten Plattform wie eine hochwertige, vollständig native Apple-App anfühlen. Es reicht nicht aus, dass eine Funktion lediglich technisch funktioniert: Sie muss zuverlässig, flüssig, intuitiv und optisch konsistent umgesetzt sein.

Diese Regeln gelten für **jede Implementierung, Fehlerbehebung, Refaktorierung und Designänderung** im Projekt.

### 1. Qualität vor Funktionsumfang

Bevorzuge durchdachte, stabile und performante Implementierungen gegenüber schnellen Lösungen. Ergänze neue Funktionen nicht auf Kosten der Zuverlässigkeit bestehender Funktionen.

### 2. Saubere Architektur

Nutze die bestehende modulare Multiplattform-Architektur und vorhandene Komponenten. Teile Geschäftslogik, Datenmodelle und geeignete UI-Bausteine plattformübergreifend. Vermeide unnötige Abstraktionen, doppelten Code, Workarounds und zusätzliche Komplexität. Erzwinge keine gemeinsame UI-Lösung, wenn eine plattformspezifische Umsetzung besser ist.

### 3. Ursachen statt Symptome beheben

Analysiere Fehler gründlich und behebe ihre eigentliche Ursache, statt oberflächliche Korrekturen oder provisorische Sonderfälle einzubauen.

### 4. Native Bedienung

Orientiere dich an Apples Human Interface Guidelines. Berücksichtige die Besonderheiten von iOS, iPadOS, macOS und tvOS, insbesondere Touch-, Maus-, Tastatur- und Fernbedienungssteuerung sowie Fokusverhalten.

### 5. Flüssige Benutzeroberfläche

Animationen, Navigation und Interaktionen sollen ohne wahrnehmbare Verzögerungen, Ruckler oder störendes Flackern funktionieren. Lade- und Übergangszustände müssen konsistent und vorhersehbar sein.

### 6. Zuverlässige Zustandsverwaltung

Verhindere Race Conditions, unerwünschte Zustandswechsel, doppelte Aktionen und Interaktionen mit bereits ausgeblendeten Elementen. Unsichtbare oder geschlossene Ansichten dürfen keine Eingaben abfangen. Prüfe insbesondere schnelle, wiederholte Eingaben und Übergänge zwischen Ansichten.

### 7. Performance und Ressourcen

Optimiere Ladezeiten, Speicherverbrauch, CPU-/GPU-Auslastung und Netzwerkzugriffe, ohne Lesbarkeit und Wartbarkeit des Codes zu verschlechtern. Vermeide unnötige Arbeit auf dem Hauptthread.

### 8. Konsistentes Design

Alle Komponenten müssen sich harmonisch in die bestehende Jellycloud-Designsprache einfügen und auf jeder Plattform hochwertig wirken. Achte auf einheitliche Abstände, Typografie, Animationen, Rückmeldungen und Bedienelemente.

### 9. Keine Regressionen

Bestehende Funktionen müssen erhalten bleiben. Prüfe bei Änderungen an gemeinsamen Modulen mögliche Auswirkungen auf alle unterstützten Plattformen. Teste relevante Erfolgs-, Fehler-, Lade- und Übergangsszenarien; behaupte keine Tests, die nicht tatsächlich durchgeführt wurden.

### 10. Langfristige Wartbarkeit

Schreibe verständlichen, modularen und möglichst einfachen Code. Bevorzuge etablierte Apple-APIs und projektbestehende Lösungen, sofern sie technisch geeignet sind. Entferne überflüssigen Code und vermeide unnötige Abhängigkeiten.

## Oberste Priorität

**Jellycloud soll nicht nur funktionieren, sondern sich in Bedienung, Stabilität, Geschwindigkeit und Design wie eine professionell entwickelte Apple-App anfühlen.** Jede Implementierung muss diesem Qualitätsanspruch gerecht werden. Wähle die technisch saubere und langfristig sinnvollste Lösung statt einer kurzfristigen Umgehung.
