# QLoRA Training (EN -> MY)

This repo includes a minimal QLoRA training script for the EN->MY model
`Ko-Yin-Maung/mig-mt-2.5b-eng-mya`.

## Requirements

QLoRA needs an NVIDIA GPU and Linux/WSL/Colab. `bitsandbytes` is not
supported on native Windows.

Install training deps:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements-qlora.txt
```

## Prepare Dataset

This helper extracts EN/MY pairs from `backend/data/kb.json` and (optionally)
`backend/data/glossary.py`.

```bash
python scripts/prepare_en_my_dataset.py --include_glossary
```

Outputs:
- `datasets/en_my_train.jsonl`
- `datasets/en_my_valid.jsonl`

Each line is JSON like:

```json
{"en": "Late check-out charges apply after 12:00", "my": "..."}
```

## Run QLoRA Training

```bash
python scripts/train_qlora_en_my.py \
  --model_name Ko-Yin-Maung/mig-mt-2.5b-eng-mya \
  --train_file datasets/en_my_train.jsonl \
  --valid_file datasets/en_my_valid.jsonl \
  --output_dir outputs/qlora-mig-en-my \
  --bf16
```

If the model uses explicit language tokens, you can pass them:

```bash
python scripts/train_qlora_en_my.py \
  --src_lang en_XX \
  --tgt_lang my_MM
```

## Using The Adapter

The output directory contains the LoRA adapter weights. Load them with PEFT:

```python
from peft import PeftModel
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

base = AutoModelForSeq2SeqLM.from_pretrained("Ko-Yin-Maung/mig-mt-2.5b-eng-mya")
model = PeftModel.from_pretrained(base, "outputs/qlora-mig-en-my")

# use model.generate(...) as usual
```
