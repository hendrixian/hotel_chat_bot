import json
import os
from typing import List

import faiss
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from FlagEmbedding import BGEM3FlagModel

load_dotenv()

MODEL_NAME = os.getenv("MODEL_NAME", "BAAI/bge-m3")
INDEX_PATH = os.getenv("INDEX_PATH", "./data/index.faiss")
META_PATH = os.getenv("META_PATH", "./data/meta.json")
EMBED_MAX_LENGTH = int(os.getenv("EMBED_MAX_LENGTH", "512"))
EMBED_FP16 = os.getenv("EMBED_FP16", "true").lower() == "true"

app = FastAPI()

model = None
index = None
meta = None


class RetrieveRequest(BaseModel):
    query: str
    top_k: int = 5


class RetrieveResult(BaseModel):
    text: str
    source: str
    score: float


class RetrieveResponse(BaseModel):
    results: List[RetrieveResult]


def normalize_embeddings(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-12
    return vectors / norms


@app.on_event("startup")
def startup():
    global model, index, meta

    if not os.path.exists(INDEX_PATH) or not os.path.exists(META_PATH):
        return

    model = BGEM3FlagModel(MODEL_NAME, use_fp16=EMBED_FP16)
    index = faiss.read_index(INDEX_PATH)
    with open(META_PATH, "r", encoding="utf-8") as f:
        meta = json.load(f)


@app.get("/health")
def health():
    ready = model is not None and index is not None and meta is not None
    return {"status": "ok", "ready": ready}


@app.post("/retrieve", response_model=RetrieveResponse)
def retrieve(req: RetrieveRequest):
    if model is None or index is None or meta is None:
        raise HTTPException(status_code=500, detail="Index not loaded. Run build_index.py first.")

    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    top_k = max(1, min(req.top_k, 10))

    embedding = model.encode([query], max_length=EMBED_MAX_LENGTH)["dense_vecs"]
    embedding = normalize_embeddings(np.asarray(embedding, dtype=np.float32))
    scores, indices = index.search(embedding, top_k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0 or idx >= len(meta):
            continue
        doc = meta[idx]
        results.append({
            "text": doc["text"],
            "source": doc.get("source", "unknown"),
            "score": float(score)
        })

    return {"results": results}
