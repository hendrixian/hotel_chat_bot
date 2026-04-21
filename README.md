# Hotel Chat Bot

This project uses a Node/Express backend, a React frontend, and a Python FAISS service for retrieval. The backend routes between a hosted LLM endpoint (Colab) and an optional local model (Ollama).

## Quick Overview

- Frontend auto-detects Burmese vs English from user input.
- Backend also auto-detects language if none is provided.
- Retrieval uses the FAISS service when available; otherwise it falls back to SQLite keyword search.
- KB dashboard is admin-only at `/admin/kb`.

## Prerequisites

- Node.js 18+
- Python 3.11 recommended (FAISS + NumPy wheels)

## Step-by-step Setup

1. Backend dependencies

```powershell
cd backend
npm install
```

2. Shared environment

```powershell
copy .env.example .env
```

Update the root `.env` with your Colab endpoint and token if required.

Recommended mode (single notebook, single Cloudflare URL):

- Set `COLAB_URL` to the URL from `hotel_cb_mbart.ipynb`
- Set `COLAB_TOKEN` only if your notebook requires auth

Legacy split mode is still supported:

- `COLAB_QWEN_URL` for `/generate`, `/intent`, `/rewrite`
- `COLAB_MBART_URL` for `/translate`
- Optional split tokens: `COLAB_QWEN_TOKEN`, `COLAB_MBART_TOKEN`

3. Seed the SQLite database

```powershell
npm run seed
```

4. AI core dependencies

```powershell
cd ..\ai-core
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

5. AI core environment

No separate `ai-core/.env` is needed. The AI core also reads the root `.env`.

6. Build the FAISS index

```powershell
python build_index.py
```

Windows note: if you see a Hugging Face symlink error, run

```powershell
$env:HF_HUB_DISABLE_SYMLINKS=1
$env:HF_HUB_DISABLE_SYMLINKS_WARNING=1
python build_index.py
```

7. Start the FAISS service

```powershell
uvicorn app:app --reload --port 8000
```

8. Start the backend

```powershell
cd ..\backend
npm run dev
```

9. Start the frontend

```powershell
cd ..\frontend
npm install
npm run dev
```

Open the frontend dev server in your browser and start chatting.

10. Admin console

- Open `/admin` in the frontend (for example `http://localhost:5173/admin`)
- Login with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`
- Open admin KB view at `/admin/kb` (for example `http://localhost:5173/admin/kb`)
- Admin can manage:
  - Room inventory by date (`total_rooms`, `available_rooms`, optional price)
  - Events calendar by date range
  - Reservations
  - Custom KB entries (single-edit bilingual workflow)

## Notes

- If the Colab endpoint is down, the backend falls back to Ollama when `OLLAMA_URL` is set.
- If `/translate` is unavailable, chat translation can fall back to the LLM (disable with `LLM_TRANSLATE_FALLBACK=0`).
- `HISTORY_TRANSLATE_MAX_CHARS` controls max Burmese history message length translated per turn (default `420`).
- Admin auth/session config:
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
  - `ADMIN_SESSION_HOURS`
- The FAISS service reads from the same SQLite database to build its index.
- Update hotel data in `backend/data/kb.json` and then rerun `python build_index.py`.
- `kb.json` supports bilingual fields using `{ "en": ..., "my": ... }`.
- Admin-created KB entries, events, and room inventory are merged into runtime KB automatically.
- Set `DEBUG_LLM=1` in the root `.env` for backend LLM debugging logs.
- `hotel_cb_mbart.ipynb` runs both Qwen and mBART in one API and should be used with one `COLAB_URL`.

## Docs

- `docs/ARCHITECTURE.md`
