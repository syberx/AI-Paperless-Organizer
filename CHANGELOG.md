# Changelog

Alle wichtigen Änderungen an AI Paperless Organizer.

---

## 2026-04-13

### Auto-Klassifizierung
- **DB-Modus vs. Tag-Modus**: Beim Starten wählbar — DB-Modus klassifiziert nur neue Dokumente, Tag-Modus erlaubt Neuklassifizierung von Dokumenten mit bestimmten Tags
- **Auslöser-Tag**: Im Tag-Modus wählt man einen Tag der die Klassifizierung auslöst — wird danach automatisch entfernt
- **Status-Tags Übersicht**: Zeigt beim Start ob Fertig-/Prüf-/Tag-Ideen-Tags aktiv sind
- **Review-Tag wird nach Anwenden entfernt**: "KI-prüfen" und "KI-tag-ideen" Tags werden automatisch vom Dokument entfernt
- **Skip-Tags werden sofort gespeichert**: Kein "Speichern"-Button mehr nötig, Änderungen überleben Neustarts
- **Prüf-Warteschlange**: "Alle verwerfen" Button zum Leeren von hängengebliebenen Einträgen
- **Bugfix**: Prüf-Warteschlange aktualisiert sich nach Anwenden

### Custom Fields
- **Felder beim Prüfen deaktivierbar**: Klick auf den Feldnamen → Feld wird nicht übernommen
- **Bugfix**: Betrag-Feld mit Währungssymbolen (EUR, USD) verursacht keinen Fehler mehr

### Speicherpfad
- **Bugfix**: KI wählt jetzt den besten verfügbaren Pfad statt zu schnell "kein Pfad" zu setzen

---

## 2026-04-12

### Neue Features
- **Cloud Sync / Import**: Dokumente aus Google Drive, OneDrive, Dropbox, Nextcloud (WebDAV) oder lokalen Ordnern automatisch in Paperless importieren. OAuth-Flow direkt im Browser, kein Terminal nötig
- **Duplikate finden**: 3-stufige Erkennung — exakte Duplikate (Checksum), ähnliche Dokumente (KI-Embeddings), doppelte Rechnungen (Rechnungsnummer). Unter Aufräumen → Duplikate finden
- **Tag-Ideen Bulk-Aktionen**: In der Top-Tags-Übersicht "Erstellen & Zuweisen" / "Verwerfen" für alle Dokumente gleichzeitig
- **Bestehende Tags in Tag-Ideen zuweisen**: Suchfeld pro Dokument um vorhandene Tags direkt zuzuweisen
- **Tag-Ausschlüsse für Auto-Klassifizierung**: Dokumente mit bestimmten Tags überspringen (z.B. von n8n vorklassifiziert)

### Bugfixes
- PDF-Vorschau in Chrome/Firefox (Mac): `embed`-Tag statt `iframe`/`object`
- Klassifizierer-Status nur gelb wenn aktiv klassifiziert wird

### Dokumentation
- README komplett überarbeitet: Feature-Tabelle direkt oben, alle neuen Features dokumentiert
- Neue Screenshots: Dashboard, Klassifizierer, RAG Chat, Cloud Import, Duplikate

---

## 2026-04-01

### RAG Dokumenten-Chat
- Streaming-Chat mit Quellenangabe und Citation-Highlighting
- Hybrid Search: BM25 + ChromaDB + Cross-Encoder Reranking (deutsch)
- Query-Enrichment für Folgefragen
- Fakten-Extraktion (Geburtsdatum, Steuernummer, etc.)
- Session-Management (Chats speichern/laden)
- Ollama-Lock verhindert parallele LLM-Anfragen

---

## 2025-12 – 2026-03

### Grundfunktionen
- KI-Dokumenten-Klassifizierer (Titel, Tags, Korrespondent, Typ, Datum, Speicherpfad, Custom Fields)
- Metadaten-Bereinigung (Korrespondenten, Tags, Dokumententypen zusammenführen)
- Tag Cleanup Wizard (5-stufig)
- OCR mit Ollama Vision (Einzel, Batch, Watchdog)
- OCR Modell-Benchmark (bis zu 5 Modelle + KI-Qualitätsbewertung)
- Dokumente aufräumen (Junk-Dokumente finden/löschen)
- Dashboard mit Statistiken
- Multi-Provider LLM (OpenAI, Mistral, Anthropic, Azure, OpenRouter, Ollama)
