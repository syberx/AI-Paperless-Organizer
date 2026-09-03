# Changelog

Alle wichtigen Änderungen an AI Paperless Organizer.

---

## 2026-08-31

### OCR – PDFs werden seitenweise gerendert (behebt OOM-Abstürze)
- **Bugfix Speicherverbrauch**: `_convert_to_images` hat per `convert_from_bytes()` ohne Seitenbereich **alle** Seiten eines PDFs gleichzeitig als PIL-Images in den RAM gerendert. Eine A4-Seite bei 400 DPI ist ~46 MB, ein 30-seitiger Scan also ~1,4 GB auf einen Schlag – das hat den Container reproduzierbar vom OOM-Killer abräumen lassen (Exit 137). `MAX_FILE_SIZE_MB` begrenzt nur die Dateigröße, nicht die Seitenzahl: ein 12-MB-Scan kann 80 Seiten haben.
- **Neu**: Die Seitenzahl kommt jetzt aus `pdfinfo` (rendert nichts), und `LazyPdfPageSource` rendert genau eine Seite pro Durchlauf. Der Speicherbedarf ist damit konstant, unabhängig vom Dokumentumfang – gemessen: 12 Seiten @ 400 DPI vorher 1627 MB, jetzt 168 MB; bei 32 Seiten unverändert 168 MB.
- **Nebeneffekt Resume**: Bereits fertige Seiten werden beim Wiederaufsetzen gar nicht mehr gerendert (vorher wurden immer alle Seiten gerendert, auch die aus der DB übernommenen).
- **Nebeneffekt Fehlertoleranz**: Eine Seite, die sich nicht rendern lässt, wird wie eine fehlgeschlagene OCR-Seite behandelt und als `partial` gemeldet, statt das ganze Dokument abzubrechen. Die übrigen Seiten laufen durch.

### OCR – Seitenlimit für sehr lange Dokumente
- **Neu**: Dokumente ab **50 Seiten** (`OCR_MANUAL_REVIEW_PAGES`) werden nicht mehr automatisch ge-OCRt, sondern mit einem Fehler auf die Ignore-Liste gesetzt und zur manuellen Prüfung übergeben. Die Prüfung passiert über `pdfinfo`, also bevor eine einzige Seite gerendert wird, und kostet damit nichts.
- **Warum**: Sehr lange Dokumente belegen den Ollama-Lock über Stunden und blockieren die dahinter wartende Auto-Klassifizierung komplett. `MAX_FILE_SIZE_MB` greift hier nicht – ein 58-seitiger Scan kann 2,6 MB klein sein.

### Docker – Healthchecks und Memory-Limit
- **Neu Healthchecks**: Backend (`/api/health` via curl) und Frontend (nginx via wget) haben jetzt einen Healthcheck. Der Zustand ist damit direkt in `docker ps` sichtbar, statt dass ein totes Backend hinter einem weiterlaufenden Frontend unbemerkt bleibt. Beide Checks nutzen bewusst `127.0.0.1` statt `localhost` – im Container löst `localhost` auf `::1` auf, nginx lauscht aber nur auf IPv4.
- **Neu Memory-Limit**: Das Backend bekommt `mem_limit: 3g`. Ohne Limit trifft ein Speicher-Spike den OOM-Killer des Hosts, der Container wird per SIGKILL beendet (Exit 137) – und Docker meldet das nicht als `OOMKilled`, weil der Kill außerhalb des Container-cgroups passiert. Mit Limit bleibt der Schaden auf den Container begrenzt und ist diagnostizierbar.

---

## 2026-06-14

### Auto-Klassifizierung – „Nur diese Tags"-Filter blockierte db-Modus
- **Bugfix**: Der `only_tag_ids`-Filter wurde im Auto-Classify-Loop unabhängig vom Filter-Modus angewendet. Ein im Tag-Modus gesetzter (und danach hängengebliebener) Wert führte dazu, dass im normalen `db`-Modus **alle** neuen Dokumente übersprungen wurden, die diesen Tag nicht trugen – die Klassifizierung lief leer, ohne Fehler. Jetzt greift `only_tags` nur noch im `tag`-Modus.

### Manuelle Klassifizierung – Tag-Bugs
- **Bugfix Tag-Ideen trotz Deaktivierung**: Die Einstellung `tag_behavior = existing_only` („nur vorhandene Tags") wurde nirgends durchgesetzt – das Modell schlug weiterhin neue Tags vor. Im Post-Processing werden neu vorgeschlagene Tags jetzt verworfen, wenn `existing_only` aktiv ist.
- **Bugfix Entfernte Tags kamen zurück**: Beim manuellen/Review-Apply wurden vom Nutzer entfernte Tags durch den `tags_keep_existing`-Merge wieder aus dem Paperless-Dokument hinzugefügt. Manuell kuratierte Tag-Listen sind jetzt maßgeblich (`tags_authoritative`): kein Merge mit dem Bestand, eine leere Liste löscht alle Tags. Der Merge-Schutz bleibt für die Auto-Klassifizierung erhalten.

### OCR-Watchdog – fehlgeschlagene Docs nicht mehr dauerhaft ausmustern
- **Preflight-Check**: Vor jedem Watchdog-Zyklus wird Ollama auf Erreichbarkeit geprüft. Ist der Host/das Notebook offline, wird der Zyklus komplett übersprungen, statt jede Seite scheitern zu lassen und damit Dokumente nach 3 transienten Fehlversuchen permanent als `ocrfehler` zu markieren.
- **Automatischer Retry-Sweep**: Permanent fehlgeschlagene (`ocrfehler`) Dokumente werden alle `RETRY_FAILED_AFTER_HOURS` (Standard 6 h) automatisch zurückgesetzt (Tag entfernt + Fehlerzähler geleert) und im nächsten Zyklus erneut versucht – z. B. sobald das Notebook wieder online ist. Manuell ignorierte Dokumente bleiben unangetastet.

### Intelligente Korrespondenten-Zuordnung (Beta, opt-in, Standard AUS)
- **Neu**: Optionales Beta-Feature, das einen von der KI vorgeschlagenen Korrespondenten einem bereits vorhandenen zuordnet, statt eine Dublette anzulegen (z. B. „Muster-Technik" und „Muster Technik"). Es wird nichts zusammengeführt, umbenannt oder gelöscht – lediglich ein bestehender Korrespondent wiederverwendet.
- **Zwei Stufen**: Stufe A = deterministische Normalisierung (Groß-/Kleinschreibung, Umlaute, Bindestriche, „&"/„und", optional Rechtsformen) – kann konstruktionsbedingt nicht falsch zuordnen. Stufe B = vorsichtiger Fuzzy-Abgleich für Tippfehler/OCR (eigener Unterschalter, Standard AUS) mit mehreren Schutzregeln, damit ähnliche, aber unterschiedliche Namen (z. B. „Schmidt"/„Schmitt") **nicht** zusammengeführt werden.
- **Sicherheit**: Standardmäßig komplett deaktiviert; bei AUS verhält sich die Klassifizierung exakt wie zuvor. Jede Zuordnung wird im Backend-Log protokolliert.

---

## 2026-04-23 (Update)

### Klassifizierer-Bugfixes
- **Bugfix Status-Tags vergessen**: GET `/api/classifier/config` lieferte `classification_tag_enabled`, `review_tag_enabled`, `tag_ideas_tag_enabled` und deren Namen NICHT zurück. Werte wurden zwar in der DB gespeichert, aber nach dem Reload zeigte das UI alles wieder als "aus". Jetzt sind alle Felder im Response.
- **Bugfix Tag-Modus überschrieben**: Status-Polling synchronisierte den User-eingestellten Filter-Modus ständig mit dem Backend-Default `db`, sobald die Auto-Klassifizierung NICHT lief. Jetzt nur noch synchronisiert wenn enabled=true.
- **Bugfix Skip-Tags + Tag-Auswahl fehlten im GET**: `auto_classify_filter_mode`, `auto_classify_skip_tag_ids`, `auto_classify_only_tag_ids` werden jetzt korrekt zurückgegeben.

---

## 2026-04-23

### OCR Batch – Paperless-Timeout & Transiente Fehler
- **Fix**: Default-`page_size` in `get_documents()` von 1000 → 250. Paperless-ngx antwortet bei vielen Dokumenten bei `page_size=1000` nicht innerhalb des httpx-Timeouts; selbst 500 läuft unter Last knapp ans Limit (115s/120s gemessen). 250 antwortet stabil in ~50s.
- **Fix**: httpx-Timeout in `PaperlessClient._request` von 120s → 180s als Reserve für temporäre Paperless-Lastspitzen
- **Fix**: Zentraler Retry (3×, 5/10s Backoff) in `_request` für GETs auf Timeout, ConnectError, RemoteProtocolError sowie HTTP 502/503/504/521/522/524. Damit killt ein einzelner Cloudflare-/Proxy-Hänger (z.B. `get_tags()` vor dem Batch) nicht mehr den ganzen OCR-Batch.
- **Fehlermeldung**: Batch-OCR zeigt jetzt Exception-Typ im Log (vorher nur `– Retry in 30s` ohne Kontext, da `httpx.ReadTimeout` leeren `str()` hat); Stacktrace landet im Backend-Log

### Transaktions-Match API
- **Bugfix Amount-Vorzeichen**: Negative Buchungen (z.B. Ausgaben `-21.25`) werden jetzt korrekt mit positiven Paperless-Beträgen gematcht (`abs()`)
- **Amount Format-Varianten**: Prüft sowohl `21.25` als auch `21,25` und ganzzahlige Beträge als `21`
- **Rechnungsnummer-Regex**: Extrahiert Rechnungsnummern (`nc-4670017`, `WEB-2025-0058`, `RE-2024-0815`, `INV-1234`) aus `paypalItemTitle`, `paypalSubject` und `description` — löst Prio-1 (100%) Matches aus
- **Volltext-Fallback für Betrag**: Wenn Custom-Field "Betrag" fehlt, wird OCR-Content nach dem Betrag gescannt (+12 Punkte)
- **Fallback Field-Name**: Nutzt "Betrag" oder "Gesamtbetrag" als Custom-Field
- **Neues Feld**: `paypalItemTitle` im Request-Schema

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
