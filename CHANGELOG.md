# Changelog

Alle wichtigen Änderungen an AI Paperless Organizer.

---

## 2026-04-16

- **Neu: Transaktions-Match API** – externe Buchhaltungstools (EÜR, n8n, PayPal-Reconciliation) können Bank-/PayPal-Buchungen per `POST /api/match/transaction` gegen Paperless-Belege matchen. Score-basiert (Rechnungsnummer, Betrag, IBAN, Datum, Kundenname Fuzzy, Volltext), gibt Top 3 mit 0-100% zurück
- **Match-Optionen pro Request**: Datum-Fenster, Betrag-Toleranz (€ oder %), Fuzzy-Schwelle, Anzahl Treffer frei einstellbar
- **Match-Log** – rollende letzte 30 Anfragen einsehbar unter `/api/match/log`
- **API-Doku erweitert** unter Einstellungen → API

---

## 2026-04-15

- **Bugfix**: Tag-Modus Klassifizierung crashte bei Custom Fields mit Fehler "cannot access local variable 're'"
- **Bugfix**: Ausgeschlossene Tags werden jetzt endgültig beim Anwenden gefiltert (nicht nur bei Vorschlägen)
- **Bugfix**: Auto-Klassifizierung DB/Tag-Modus bleibt nach Neustart erhalten (war bisher immer auf DB-Modus zurückgesetzt)
- **Bugfix**: OCR Batch-Modus (Alle/Getaggt/Manuell) wird im Browser gespeichert und nicht mehr zurückgesetzt
- **Mistral OCR**: Funktioniert jetzt auch beim Batch-Scan (nicht nur Einzel-OCR)
- **Feature**: Mistral OCR im Modell-Vergleich gegen Ollama testen
- **Feature**: Docker Hub Images aktualisiert

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

### Mistral / OpenRouter
- **Bugfix**: Klassifizierung mit Mistral Cloud und OpenRouter funktioniert jetzt (Tool-Schema Kompatibilität)
- **Mistral OCR**: Neuer OCR-Provider über Mistral's dedizierte OCR API (Modell: mistral-ocr-latest). Sendet PDFs direkt an Mistral — kein Ollama nötig
- **OCR Provider-Auswahl**: Unter OCR-Einstellungen wählbar zwischen Ollama Vision (lokal) und Mistral OCR (Cloud). Single OCR Button nutzt automatisch den konfigurierten Provider
- **Mistral OCR im Vergleich**: Im Modell-Vergleich kann Mistral OCR (mit "Cloud" Badge) gegen Ollama-Modelle getestet werden

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
