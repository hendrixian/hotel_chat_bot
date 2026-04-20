import argparse
import ast
import json
import random
import re
from pathlib import Path


def normalize_key(value: str) -> str:
    return " ".join(str(value).strip().split()).lower()


def collect_pairs(obj, pairs):
    if isinstance(obj, dict):
        if "en" in obj and "my" in obj:
            en = obj.get("en")
            my = obj.get("my")
            if isinstance(en, str) and isinstance(my, str):
                en = en.strip()
                my = my.strip()
                if en and my:
                    pairs.append((en, my))
        for value in obj.values():
            collect_pairs(value, pairs)
    elif isinstance(obj, list):
        for item in obj:
            collect_pairs(item, pairs)


def load_glossary_pairs(path: Path):
    text = path.read_text(encoding="utf-8")
    match = re.search(r"GLOSSARY\s*=\s*({[\s\S]*})\s*$", text)
    if not match:
        return []
    data = ast.literal_eval(match.group(1))
    pairs = []
    for entry in data.values():
        en_list = entry.get("en") or []
        my_list = entry.get("my") or []
        for en in en_list:
            for my in my_list:
                if isinstance(en, str) and isinstance(my, str):
                    en = en.strip()
                    my = my.strip()
                    if en and my:
                        pairs.append((en, my))
    return pairs


def write_jsonl(path: Path, items):
    with path.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Prepare EN-MY parallel dataset from KB and glossary.")
    parser.add_argument("--kb", default="backend/data/kb.json", help="Path to kb.json")
    parser.add_argument("--glossary", default="backend/data/glossary.py", help="Path to glossary.py")
    parser.add_argument("--include_glossary", action="store_true", help="Include glossary pairs")
    parser.add_argument("--output_dir", default="datasets", help="Output directory")
    parser.add_argument("--train_file", default="en_my_train.jsonl", help="Train JSONL filename")
    parser.add_argument("--valid_file", default="en_my_valid.jsonl", help="Valid JSONL filename")
    parser.add_argument("--valid_ratio", type=float, default=0.05, help="Validation split ratio")
    parser.add_argument("--seed", type=int, default=42)

    args = parser.parse_args()

    kb_path = Path(args.kb)
    if not kb_path.exists():
        raise SystemExit(f"kb.json not found: {kb_path}")

    kb_data = json.loads(kb_path.read_text(encoding="utf-8"))
    pairs = []
    collect_pairs(kb_data, pairs)

    if args.include_glossary:
        glossary_path = Path(args.glossary)
        if glossary_path.exists():
            pairs.extend(load_glossary_pairs(glossary_path))

    seen = set()
    unique = []
    for en, my in pairs:
        key = (normalize_key(en), normalize_key(my))
        if key in seen:
            continue
        seen.add(key)
        unique.append({"en": en, "my": my})

    random.seed(args.seed)
    random.shuffle(unique)

    valid_count = int(len(unique) * args.valid_ratio)
    valid = unique[:valid_count]
    train = unique[valid_count:]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    train_path = output_dir / args.train_file
    valid_path = output_dir / args.valid_file

    write_jsonl(train_path, train)
    write_jsonl(valid_path, valid)

    print(f"Pairs total: {len(unique)}")
    print(f"Train: {len(train)} -> {train_path}")
    print(f"Valid: {len(valid)} -> {valid_path}")


if __name__ == "__main__":
    main()
