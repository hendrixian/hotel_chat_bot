import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(REPO_ROOT / ".env")


def env_text(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value or default


def env_path(name: str, default: str) -> Path:
    raw = env_text(name, default)
    path = Path(raw)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path
