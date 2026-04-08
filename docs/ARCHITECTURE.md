# Architecture & Pipeline

This document describes how the hotel chatbot is structured and how a message flows through the system.

## High-Level Overview

At runtime there are three services:

- Frontend (React) on `localhost:5173`
- Backend (Node/Express) on `localhost:4000`
- Retrieval service (FastAPI + FAISS) on `localhost:8000` (optional)

External LLM services are accessed over HTTP:

- Colab LLM API via a Cloudflare tunnel
- Optional local fallback: Ollama on `localhost:11434`

## Components

Frontend (React)
- File: `frontend/src/App.jsx`
- Responsibilities:
  - Renders chat UI
  - Detects Burmese vs English input
  - Sends requests to backend (`/api/chat`, `/api/translate-ui`, `/api/kb`)
  - Renders assistant replies and status

Backend (Node/Express)
- Entry: `backend/src/index.js`
- Responsibilities:
  - Accepts chat requests
  - Detects language and intent
  - Fetches context from retrieval service (or keyword fallback)
  - Builds prompts
  - Calls LLM endpoints (`/generate`, `/translate`, `/intent`, `/rewrite`)
  - Writes conversation history to SQLite

Retrieval Service (FastAPI + FAISS)
- Entry: `ai-core/app.py`
- Responsibilities:
  - Loads embeddings and FAISS index
  - Returns top-k relevant KB passages
  - Falls back to keyword search if FAISS is not available

LLM Services
- Colab endpoints:
  - `/generate`: free-form response generation
  - `/translate`: NLLB translation used for UI and some history handling
  - `/intent`: intent classifier (booking/faq/complex)
  - `/rewrite`: optional Burmese rewrite polishing
- Optional local fallback:
  - Ollama `/api/generate` using `OLLAMA_MODEL`

Data & Storage
- Knowledge base JSON: `backend/data/kb.json` (supports `en`/`my` bilingual fields)
- SQLite (sessions/messages): `backend/data/app.db`
- FAISS index: `ai-core/data/index.faiss`
- FAISS metadata: `ai-core/data/meta.json`

## API Surface (Backend)

`POST /api/chat`
- Body: `{ message, sessionId, language? }`
- Response: `{ sessionId, intent, reply, context }`

`POST /api/translate-ui`
- Body: `{ targetLang: "my" | "en", texts: string[] }`
- Response: `{ texts: string[] }`

`GET /api/kb`
- Query: `?lang=en|my`
- Response: knowledge base payload used by the UI `/kb` page

`GET /api/health`
- Response: `{ status: "ok" }`

## Request Flow (English)

1. Frontend sends `POST /api/chat` with `message` and `sessionId`.
2. Backend detects language (English vs Burmese).
3. Backend loads recent history from SQLite (up to 6 messages).
4. Backend retrieves context:
   - Primary: `ai-core` `/retrieve` (vector search)
   - Fallback: keyword match over `kb.json`
5. Backend builds a prompt with system instructions, context, history, and the user message.
6. Backend calls Colab `/generate` (or Ollama if Colab fails and `OLLAMA_URL` is set).
7. Backend logs both user and assistant messages to SQLite.
8. Backend returns `{ reply, intent, context }` to the frontend.

## Request Flow (Burmese)

1. Frontend sends `POST /api/chat` with the user message.
2. Backend detects Burmese input (Myanmar script).
3. History and retrieval run in the same language as the user input.
4. Backend builds a Burmese system prompt and calls `/generate`.
5. Reply is returned in Burmese.

## UI Translation

When Burmese is detected, the frontend calls `POST /api/translate-ui` to translate static UI strings. The backend uses the Colab `/translate` endpoint. If translation fails, the frontend keeps English strings to avoid blocking the chat UI.

## Intent Routing

The backend uses two layers:

1. Keyword/heuristic routing (`backend/src/router.js`) for short, simple English queries.
2. Colab `/intent` for Burmese queries (or when heuristics are not confident).

The returned intent is sent back to the frontend but does not currently alter UI behavior.

## Failure Modes & Fallbacks

- Colab `/generate` failure:
  - If `OLLAMA_URL` is set, backend attempts Ollama.
  - If Ollama fails too, backend returns the generic error reply.
- Colab `/translate` failure:
  - UI translation falls back to English without failing the chat request.
- `ai-core` not running:
  - Backend uses keyword search over `kb.json`.
- Timeout:
  - Backend HTTP calls honor `FETCH_TIMEOUT_MS` (default 20000 ms).

## Environment Variables

Backend (`backend/.env`)
- `COLAB_URL`, `COLAB_TOKEN`
- `OLLAMA_URL`, `OLLAMA_MODEL`
- `AI_CORE_URL`
- `FETCH_TIMEOUT_MS`
- `DEBUG_LLM`

AI Core (`ai-core/.env`)
- `MODEL_NAME`
- `HOTEL_DB_PATH`
- `INDEX_PATH`, `META_PATH`

## Updating Knowledge

1. Update `backend/data/kb.json`.
2. Rebuild FAISS index:
   - `python build_index.py`
3. Restart `ai-core` service.
4. Restart backend if the KB schema changed.
