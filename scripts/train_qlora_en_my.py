import argparse
import os
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoConfig,
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    DataCollatorForSeq2Seq,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments
)


def resolve_dtype(args):
    if args.bf16 and torch.cuda.is_available() and torch.cuda.is_bf16_supported():
        return torch.bfloat16
    return torch.float16


def find_target_modules(model, override):
    if override:
        return [item.strip() for item in override.split(",") if item.strip()]

    candidates = [
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        "out_proj",
        "gate_proj",
        "up_proj",
        "down_proj"
    ]
    found = set()
    for name, _ in model.named_modules():
        for cand in candidates:
            if name.endswith(cand):
                found.add(cand)
    if not found:
        return ["q_proj", "v_proj"]
    return sorted(found)


def set_lang_tokens(tokenizer, src_lang, tgt_lang):
    if src_lang and hasattr(tokenizer, "src_lang"):
        tokenizer.src_lang = src_lang
    if tgt_lang and hasattr(tokenizer, "tgt_lang"):
        tokenizer.tgt_lang = tgt_lang


def main():
    parser = argparse.ArgumentParser(description="QLoRA fine-tune for EN->MY translation.")
    parser.add_argument("--model_name", default="Ko-Yin-Maung/mig-mt-2.5b-eng-mya")
    parser.add_argument("--train_file", default="datasets/en_my_train.jsonl")
    parser.add_argument("--valid_file", default="datasets/en_my_valid.jsonl")
    parser.add_argument("--output_dir", default="outputs/qlora-mig-en-my")
    parser.add_argument("--source_field", default="en")
    parser.add_argument("--target_field", default="my")
    parser.add_argument("--source_prefix", default="")
    parser.add_argument("--max_source_length", type=int, default=256)
    parser.add_argument("--max_target_length", type=int, default=256)
    parser.add_argument("--per_device_train_batch_size", type=int, default=2)
    parser.add_argument("--per_device_eval_batch_size", type=int, default=2)
    parser.add_argument("--gradient_accumulation_steps", type=int, default=8)
    parser.add_argument("--num_train_epochs", type=int, default=3)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    parser.add_argument("--warmup_ratio", type=float, default=0.03)
    parser.add_argument("--logging_steps", type=int, default=50)
    parser.add_argument("--save_steps", type=int, default=500)
    parser.add_argument("--eval_steps", type=int, default=500)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--lora_r", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--lora_dropout", type=float, default=0.05)
    parser.add_argument("--target_modules", default="")
    parser.add_argument("--src_lang", default="")
    parser.add_argument("--tgt_lang", default="")
    parser.add_argument("--bf16", action="store_true")

    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is required for QLoRA training.")

    train_path = Path(args.train_file)
    if not train_path.exists():
        raise SystemExit(f"Training file not found: {train_path}")

    valid_path = Path(args.valid_file)
    has_valid = valid_path.exists()

    compute_dtype = resolve_dtype(args)

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=compute_dtype
    )

    config = AutoConfig.from_pretrained(args.model_name)
    if not config.is_encoder_decoder:
        raise SystemExit("This script expects an encoder-decoder model.")

    tokenizer = AutoTokenizer.from_pretrained(args.model_name, use_fast=True)
    set_lang_tokens(tokenizer, args.src_lang, args.tgt_lang)

    model = AutoModelForSeq2SeqLM.from_pretrained(
        args.model_name,
        quantization_config=bnb_config,
        device_map="auto"
    )
    model.config.use_cache = False

    model = prepare_model_for_kbit_training(model)

    target_modules = find_target_modules(model, args.target_modules)
    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type=TaskType.SEQ_2_SEQ_LM,
        target_modules=target_modules
    )
    model = get_peft_model(model, lora_config)

    data_files = {"train": str(train_path)}
    if has_valid:
        data_files["validation"] = str(valid_path)

    dataset = load_dataset("json", data_files=data_files)

    source_field = args.source_field
    target_field = args.target_field

    def preprocess(batch):
        sources = [args.source_prefix + item for item in batch[source_field]]
        targets = batch[target_field]
        model_inputs = tokenizer(
            sources,
            max_length=args.max_source_length,
            truncation=True
        )
        labels = tokenizer(
            text_target=targets,
            max_length=args.max_target_length,
            truncation=True
        )
        model_inputs["labels"] = labels["input_ids"]
        return model_inputs

    tokenized = dataset.map(
        preprocess,
        batched=True,
        remove_columns=dataset["train"].column_names
    )

    data_collator = DataCollatorForSeq2Seq(tokenizer, model=model)

    training_args = Seq2SeqTrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        num_train_epochs=args.num_train_epochs,
        warmup_ratio=args.warmup_ratio,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        eval_steps=args.eval_steps,
        evaluation_strategy="steps" if has_valid else "no",
        save_total_limit=2,
        fp16=(not args.bf16),
        bf16=args.bf16,
        optim="paged_adamw_8bit",
        report_to="none",
        predict_with_generate=False,
        gradient_checkpointing=True,
        seed=args.seed
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized.get("validation"),
        data_collator=data_collator,
        tokenizer=tokenizer
    )

    trainer.train()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))


if __name__ == "__main__":
    main()
