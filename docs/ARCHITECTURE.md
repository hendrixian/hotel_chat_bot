# Architecture & Pipeline

This document describes how the hotel chatbot is structured and how a message flows through the system.

## Components

- Frontend (React)
  - File: `frontend/src/App.jsx`
  - Responsibilities: UI, language auto-detection, request/response rendering.

- Backend (Node/Express)
  - Entry: `backend/src/index.js`
  - Responsibilities: language routing, retrieval, LLM calls, and response assembly.

- Retrieval Service (Python/FastAPI + FAISS)
  - Entry: `ai-core/app.py`
  - Responsibilities: vector search over hotel knowledge.

- LLM Services
  - Colab endpoints: `/generate`, `/translate`, `/intent`, `/rewrite`
  - Optional local fallback: Ollama `/api/generate`

- Data
  - SQLite: `backend/data/app.db`
  - FAISS index: `ai-core/data/index.faiss`
  - FAISS metadata: `ai-core/data/meta.json`

## Request Flow (English)

1. Frontend sends `POST /api/chat` with `message` and `sessionId`.
2. Backend detects language (English vs Burmese).
3. Backend pulls recent history from SQLite.
4. Backend retrieves context:
   - Primary: `ai-core` `/retrieve`
   - Fallback: SQLite keyword search
5. Backend builds a prompt with system instructions and context.
6. Backend calls Colab `/generate` (or Ollama if configured).
7. Reply is returned to the frontend.

## Request Flow (Burmese)

1. Frontend sends `POST /api/chat` with the user message.
2. Backend detects Burmese input and keeps the message/history in Burmese.
3. Retrieval runs on the original message.
4. Backend builds a prompt with Burmese system instructions and calls Colab `/generate` (or Ollama).
5. Reply is returned to the frontend in Burmese.

## UI Translation

The frontend optionally calls `POST /api/translate-ui` to translate static UI strings when Burmese is detected. If translation fails, the UI falls back to English.

## Environment Variables

Backend (`backend/.env`):
- `COLAB_URL`, `COLAB_TOKEN`
- `OLLAMA_URL`, `OLLAMA_MODEL`
- `AI_CORE_URL`
- `DEBUG_LLM`

AI Core (`ai-core/.env`):
- `MODEL_NAME`
- `HOTEL_DB_PATH`
- `INDEX_PATH`, `META_PATH`

## Updating Knowledge

1. Update `backend/data/app.db` (facts/rooms).
2. Rebuild FAISS index:
   - `python build_index.py`
3. Restart `ai-core` service.
