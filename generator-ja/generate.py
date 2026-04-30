#!/usr/bin/env python3
import os
import sys
import json
import time
import random
import re
from datetime import datetime, timezone

import torch
from transformers.models.t5.tokenization_t5 import T5Tokenizer
from transformers import AutoModelForCausalLM

SEEDS = [
    "夜の",
    "もう、",
    "鏡",
    "わたしは",
    "",
    "光が",
    "忘れて",
    "声が",
    "空の",
    "水は",
    "ことばが",
    "眠れない",
    "やがて",
    "ゆめの中で",
    "きえて",
    "ひかりの",
    "あなたは",
    "どこかで",
    "川の",
    "静かに",
]

MODEL_NAME = os.environ.get("MODEL_NAME", "rinna/japanese-gpt2-medium")
TEMPERATURE = float(os.environ.get("TEMPERATURE", "1.4"))
TOP_P = float(os.environ.get("TOP_P", "0.95"))
MIN_CHARS = int(os.environ.get("MIN_CHARS", "5"))
MAX_CHARS = int(os.environ.get("MAX_CHARS", "25"))
SLEEP_MIN = float(os.environ.get("SLEEP_MIN", "0.5"))
SLEEP_MAX = float(os.environ.get("SLEEP_MAX", "2.0"))


def load_model():
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    print(f"[generator-ja] loading {MODEL_NAME} on {device}", file=sys.stderr, flush=True)
    tokenizer = T5Tokenizer.from_pretrained(MODEL_NAME, legacy=True)
    model = AutoModelForCausalLM.from_pretrained(MODEL_NAME, torch_dtype=torch.float16)
    model = model.to(device)
    model.eval()
    print("[generator-ja] model ready", file=sys.stderr, flush=True)
    return model, tokenizer, device


def generate_text(model, tokenizer, device):
    seed = random.choice(SEEDS)
    if seed:
        inputs = tokenizer.encode(seed, return_tensors="pt").to(device)
    else:
        bos = getattr(tokenizer, "bos_token_id", None) or tokenizer.eos_token_id
        inputs = torch.tensor([[bos]], dtype=torch.long, device=device)

    attention_mask = torch.ones_like(inputs)
    with torch.no_grad():
        output = model.generate(
            inputs,
            attention_mask=attention_mask,
            max_new_tokens=random.randint(30, 80),
            temperature=TEMPERATURE,
            top_p=TOP_P,
            top_k=0,
            repetition_penalty=1.0,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    return tokenizer.decode(output[0], skip_special_tokens=True)


def post_process(text):
    # rinna tokenizer inserts spaces between tokens; remove them
    text = text.replace(" ", "")
    # Split on sentence-ending Japanese punctuation and newlines
    fragments = re.split(r"[。！？\n\r]+", text)
    results = []
    for frag in fragments:
        frag = frag.strip()
        if not frag:
            continue
        char_count = len(frag)
        if MIN_CHARS <= char_count <= MAX_CHARS:
            results.append(frag)
        elif char_count > MAX_CHARS:
            # Sub-split on mid-sentence punctuation to salvage shorter fragments
            for sub in re.split(r"[、「」『』【】…]+", frag):
                sub = sub.strip()
                if MIN_CHARS <= len(sub) <= MAX_CHARS:
                    results.append(sub)
    return results


def main():
    model, tokenizer, device = load_model()
    while True:
        try:
            raw = generate_text(model, tokenizer, device)
            fragments = post_process(raw)
            for frag in fragments:
                record = {
                    "text": frag,
                    "lang": "ja",
                    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
                print(json.dumps(record, ensure_ascii=False), flush=True)
                time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
        except KeyboardInterrupt:
            break
        except BrokenPipeError:
            sys.exit(0)
        except Exception as e:
            print(f"[generator-ja] ERROR: {e}", file=sys.stderr, flush=True)
            time.sleep(1)


if __name__ == "__main__":
    main()
