# AI Paperless Organizer

🤖 **KI-gestütztes Tool zur Organisation deiner Paperless-ngx Dokumente**

## Kompatibilität

**Läuft mit Paperless-ngx 2.x und 3.x.** Zuletzt geprüft gegen **3.1.3**, lesend wie schreibend – der Umstieg auf v3 erfordert am Tool keine Anpassung.

## Features

- **🏷️ Tag-Bereinigung**: Finde und lösche leere, unsinnige oder doppelte Tags
- **👤 Korrespondenten-Analyse**: Erkenne ähnliche Korrespondenten und führe sie zusammen
- **📄 Dokumententypen-Optimierung**: Gruppiere ähnliche Dokumententypen
- **🔄 Tags als Korrespondenten/Typen**: Finde Tags die eigentlich Korrespondenten oder Dokumententypen sein sollten
- **🚫 Globale Ignorierliste**: Bestimmte Einträge dauerhaft von der Analyse ausschließen
- **📊 Token-Schätzung**: Sehe vor jeder KI-Analyse wieviele Tokens benötigt werden

## 🔒 Datenschutz

**Wichtig:** An das LLM werden **ausschließlich Metadaten** übermittelt:
- Namen von Tags, Korrespondenten und Dokumententypen
- Anzahl der zugehörigen Dokumente

**Es werden KEINE Dokumenteninhalte, Texte oder Dateien an das LLM gesendet!**

Für maximalen Datenschutz kannst du Ollama mit lokalen Modellen verwenden - dann verlassen keine Daten deinen Server.

## Unterstützte LLM-Provider

- OpenAI (GPT-4, GPT-4o, GPT-3.5)
- Anthropic (Claude 3)
- Azure OpenAI
- Ollama (lokale Modelle) ← **Empfohlen für maximalen Datenschutz**

## Quick Start

```yaml
# docker-compose.yml
services:
  backend:
    image: webdienste/ai-paperless-organizer:backend-latest
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  frontend:
    image: webdienste/ai-paperless-organizer:frontend-latest
    ports:
      - "3001:80"
    depends_on:
      - backend
    restart: unless-stopped
```

```bash
docker compose up -d
```

Dann öffne http://localhost:3001

## Konfiguration

1. **Paperless-ngx Verbindung**: URL und API-Token eingeben
2. **LLM Provider**: Wähle deinen KI-Provider und gib den API-Key ein
3. **Fertig!** Starte mit der Tag-Bereinigung

## Links

- 📖 [GitHub Repository](https://github.com/syberx/AI-Paperless-Organizer)
- 🐛 [Issues melden](https://github.com/syberx/AI-Paperless-Organizer/issues)

## OCR Statistiken

![OCR Stats](https://raw.githubusercontent.com/syberx/AI-Paperless-Organizer/main/docs/screenshots/ocr-stats.png)

## Tags

- `backend-latest` - Backend API (FastAPI/Python)
- `frontend-latest` - Frontend UI (React/Vite)

---

Made with ❤️ for the Paperless-ngx community

