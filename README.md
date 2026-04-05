# Hotel Chat Bot

This project uses a Node/Express backend, a React frontend, and a Python FAISS service for retrieval. The backend routes between a local model (optional) and a Colab LLaMA 3 endpoint.

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

5. Build the FAISS index

```powershell
copy .env.example .env
python build_index.py
```

6. Start the FAISS service

```powershell
uvicorn app:app --reload --port 8000
```

7. Start the backend

```powershell
cd ..\backend
npm run dev
```

8. Start the frontend

```powershell
cd ..\frontend
npm install
npm run dev
```

Open the frontend dev server in your browser and start chatting.

## Notes

- If the Colab endpoint is down, the backend will fall back to Ollama if `OLLAMA_URL` is set.
- The FAISS service reads from the same SQLite database to build its index.
- You can add more facts and rooms directly into `backend/data/app.db` using any SQLite tool, then rerun `python build_index.py`.
