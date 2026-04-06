# Hotel Chat Bot

This project uses a Node/Express backend, a React frontend, and a Python FAISS service for retrieval. The backend routes between a hosted LLM endpoint (Colab) and an optional local model (Ollama).

## Quick Overview

- Frontend auto-detects Burmese vs English from user input.
- Backend also auto-detects language if none is provided.
- Retrieval uses the FAISS service when available; otherwise it falls back to SQLite keyword search.

## Prerequisites

- Node.js 18+
- Python 3.11 recommended (FAISS + NumPy wheels)

## Step-by-step Setup

1. Backend dependencies

```powershell
cd backend
npm install
```

2. Backend environment

```powershell
copy .env.example .env
```

Update `backend/.env` with your Colab endpoint and token if required.

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

```powershell
copy .env.example .env
```

Update `ai-core/.env` if you change the embedding model.

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

## Notes

- If the Colab endpoint is down, the backend falls back to Ollama when `OLLAMA_URL` is set.
- The FAISS service reads from the same SQLite database to build its index.
- Update hotel facts/rooms in `backend/data/app.db` and then rerun `python build_index.py`.
- Set `DEBUG_LLM=1` in `backend/.env` for backend LLM debugging logs.

## Docs

- `docs/ARCHITECTURE.md`
