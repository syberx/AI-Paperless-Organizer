# AI Paperless Organizer

Ein Docker-basiertes Webinterface zur intelligenten Bereinigung und Konsolidierung von Korrespondenten, Tags und Dokumententypen in Paperless-ngx mittels verschiedener LLM-Provider.

## Features

- **KI-gestützte Ähnlichkeitserkennung**: Findet automatisch ähnliche Einträge (z.B. "do", "do gmbh", "Domain Offensive GmbH")
- **Multi-LLM Support**: OpenAI, Anthropic Claude, Azure OpenAI, Ollama (lokal)
- **Hybrid-Workflow**: KI schlägt vor, Benutzer entscheidet, System führt aus
- **Anpassbare Prompts**: Eigene Prompts für verschiedene Entitätstypen
- **Merge-History**: Protokollierung aller Zusammenführungen

## Quick Start

### Voraussetzungen

- Docker & Docker Compose
- Paperless-ngx Installation mit API-Token
- (Optional) LLM API Key (OpenAI, Anthropic) oder lokales Ollama

### Installation

1. Repository klonen:
```bash
git clone <repository-url>
cd paperless-organizer
```

2. Docker Container starten:
```bash
docker-compose up -d
```

3. Webinterface öffnen: http://localhost:3001

4. In den Einstellungen konfigurieren:
   - Paperless-ngx URL und API Token
   - LLM Provider aktivieren und API Key hinterlegen

## Konfiguration

### Paperless-ngx

1. Gehe zu Einstellungen -> Paperless-ngx Verbindung
2. Gib die URL deiner Paperless Installation ein (z.B. `https://paperless.example.com`)
3. Erstelle in Paperless unter Admin -> Auth Tokens einen neuen Token
4. Füge den Token ein und teste die Verbindung

### LLM Provider

#### OpenAI
- API Key von https://platform.openai.com/api-keys
- Empfohlenes Model: `gpt-4o`

#### Anthropic Claude
- API Key von https://console.anthropic.com/
- Empfohlenes Model: `claude-3-5-sonnet-20241022`

#### Ollama (Lokal)
- Installiere Ollama: https://ollama.ai/
- Kein API Key benötigt
- URL: `http://host.docker.internal:11434` (für Docker)
- Empfohlenes Model: `llama3.1` oder `mistral`

#### Azure OpenAI
- Azure OpenAI Endpoint URL
- Deployment Name als Model

## Verwendung

### Korrespondenten/Tags/Dokumententypen bereinigen

1. Navigiere zum entsprechenden Bereich
2. Klicke auf "Mit KI analysieren"
3. Die KI gruppiert ähnliche Einträge und zeigt sie mit Konfidenz-Wert an
4. Für jede Gruppe:
   - Wähle welche Einträge zusammengeführt werden sollen
   - Bestimme den Ziel-Eintrag (oder gib einen eigenen Namen ein)
   - Bestätige mit "Zusammenführen"
5. Alle Dokumente werden automatisch aktualisiert

### Prompts anpassen

1. Gehe zu "Prompts"
2. Wähle den Entitätstyp (Korrespondenten, Tags, Dokumententypen)
3. Bearbeite den Prompt nach Bedarf
4. Speichere die Änderungen
5. Mit "Auf Standard zurücksetzen" kannst du den Original-Prompt wiederherstellen

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose                          │
├─────────────────────┬───────────────────────────────────────┤
│   Frontend (React)  │           Backend (FastAPI)           │
│   Port: 3001        │           Port: 8000                  │
└─────────────────────┴───────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Paperless-ngx  │
                    │      API        │
                    └─────────────────┘
```

## Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy, httpx
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **Database**: SQLite (für Config/History)
- **Container**: Docker Compose

## Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

### Backend

| Variable | Beschreibung | Default |
|----------|--------------|---------|
| `DATABASE_URL` | SQLite Database URL | `sqlite+aiosqlite:///./data/organizer.db` |

## API Endpoints

### Paperless
- `GET /api/paperless/status` - Verbindungsstatus
- `GET /api/paperless/correspondents` - Alle Korrespondenten
- `GET /api/paperless/tags` - Alle Tags
- `GET /api/paperless/document-types` - Alle Dokumententypen

### Correspondents
- `GET /api/correspondents/` - Liste mit Dokumentenanzahl
- `POST /api/correspondents/analyze` - KI-Analyse starten
- `POST /api/correspondents/merge` - Zusammenführen
- `GET /api/correspondents/history` - Merge-History

### Tags
- `GET /api/tags/` - Liste mit Dokumentenanzahl
- `POST /api/tags/analyze` - KI-Analyse starten
- `POST /api/tags/merge` - Zusammenführen

### Document Types
- `GET /api/document-types/` - Liste mit Dokumentenanzahl
- `POST /api/document-types/analyze` - KI-Analyse starten
- `POST /api/document-types/merge` - Zusammenführen

### Settings
- `GET/POST /api/settings/paperless` - Paperless Einstellungen
- `GET /api/settings/llm-providers` - LLM Provider Liste
- `PUT /api/settings/llm-providers/{id}` - Provider aktualisieren
- `GET /api/settings/prompts` - Alle Prompts
- `PUT /api/settings/prompts/{id}` - Prompt aktualisieren
- `POST /api/settings/prompts/reset/{type}` - Prompt zurücksetzen

### LLM
- `POST /api/llm/test` - Aktiven Provider testen
- `GET /api/llm/active-provider` - Aktiver Provider Info

## Lizenz

MIT License

