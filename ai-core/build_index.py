import json
import os
import sqlite3
from pathlib import Path

import faiss
import numpy as np
from dotenv import load_dotenv
from FlagEmbedding import BGEM3FlagModel

load_dotenv()

MODEL_NAME = os.getenv("MODEL_NAME", "BAAI/bge-m3")
DB_PATH = os.getenv("HOTEL_DB_PATH", "../backend/data/app.db")
INDEX_PATH = os.getenv("INDEX_PATH", "./data/index.faiss")
META_PATH = os.getenv("META_PATH", "./data/meta.json")
EMBED_MAX_LENGTH = int(os.getenv("EMBED_MAX_LENGTH", "512"))
EMBED_FP16 = os.getenv("EMBED_FP16", "true").lower() == "true"


def load_docs():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    docs = []

    for row in cur.execute("SELECT id, title, content, category FROM facts"):
        doc_id, title, content, category = row
        docs.append({
            "id": f"fact-{doc_id}",
            "text": f"{title}: {content}",
            "source": category
        })

    for row in cur.execute("SELECT id, name, capacity, price_per_night, features FROM rooms"):
        doc_id, name, capacity, price_per_night, features = row
        docs.append({
            "id": f"room-{doc_id}",
            "text": f"{name} (capacity {capacity}, ${price_per_night}/night, {features})",
            "source": "room"
        })

    conn.close()
    return docs


def normalize_embeddings(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-12
    return vectors / norms


def main():
    docs = load_docs()
    if not docs:
        raise SystemExit("No documents found. Seed the database first.")

    model = BGEM3FlagModel(MODEL_NAME, use_fp16=EMBED_FP16)
    texts = [doc["text"] for doc in docs]
    embeddings = model.encode(texts, max_length=EMBED_MAX_LENGTH)["dense_vecs"]
    embeddings = normalize_embeddings(np.asarray(embeddings, dtype=np.float32))

    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)

    Path(os.path.dirname(INDEX_PATH) or ".").mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, INDEX_PATH)

    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    print(f"Saved index to {INDEX_PATH} and metadata to {META_PATH}")


if __name__ == "__main__":
    main()
