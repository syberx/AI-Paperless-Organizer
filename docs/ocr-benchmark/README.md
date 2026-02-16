# OCR-Modell-Vergleich & KI-Qualitätsbewertung

Dieser Ordner dient zur Dokumentation des integrierten **OCR-Benchmarks** im AI Paperless Organizer.

## Funktionen im Tool

- **OCR Modell-Vergleich**: Gleiches Dokument mit mehreren Ollama-Vision-Modellen (z. B. qwen3-vl:4b-instruct, qwen3-vl:8b-instruct, glm-ocr, minicpm-v) verarbeiten und Ergebnisse nebeneinander anzeigen.
- **KI-Qualitätsbewertung**: Cloud-LLM (z. B. GPT-4o) bewertet die OCR-Ergebnisse nach Kriterien wie Namen, IBAN, Beträge, Vollständigkeit und gibt eine strukturierte Empfehlung.

## Screenshots (optional)

Du kannst hier Beispiel-Screenshots ablegen, **ohne personenbezogene oder sensible Daten**:

- `ocr-ki-quality-assessment.png` – Ausschnitt der KI-Qualitätsbewertung (z. B. Bewertung 4B vs. 8B).
- `ocr-model-compare-ui.png` – OCR-Vergleichs-UI mit Modellauswahl und Fortschritt.

**Hinweis:** Vor dem Hochladen in ein öffentliches Repository alle echten IBANs, Namen, Adressen und Dokumenten-IDs in den Screenshots entfernen oder schwärzen.

## Empfohlene Modelle

- **qwen3-vl:4b-instruct** – guter Kompromiss aus Qualität und Geschwindigkeit.
- **huihui_ai/qwen3-vl-abliterated:8b** – 8B ohne Safety-Filter, erkennt IBANs und sensible Felder zuverlässiger.
- **glm-ocr** – schlank, schnell, gut für Standard-OCR.

Die Standard-Version **qwen3-vl:8b-instruct** filtert sensible Felder (z. B. IBAN) stark; für vollständige Transkription die abliterated-Variante oder 4b-instruct nutzen.
