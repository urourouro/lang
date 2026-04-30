#!/usr/bin/env python3
import os
import sys
import json
import time
import random
import re
from datetime import datetime, timezone

import torch
from transformers import GPT2LMHeadModel, GPT2Tokenizer

SEEDS = [
    "the mirror",
    "once,",
    "in the corner of",
    "forget",
    "",
    "when light",
    "the room",
    "before morning",
    "after all",
    "she",
    "silence is",
    "at the edge",
    "a door",
    "it was never",
    "the window",
    "somewhere between",
    "nothing holds",
    "the sound of",
]

TEMPERATURE = float(os.environ.get("TEMPERATURE", "1.4"))
TOP_P = float(os.environ.get("TOP_P", "0.95"))
MIN_WORDS = int(os.environ.get("MIN_WORDS", "3"))
MAX_WORDS = int(os.environ.get("MAX_WORDS", "10"))
SLEEP_MIN = float(os.environ.get("SLEEP_MIN", "0.5"))
SLEEP_MAX = float(os.environ.get("SLEEP_MAX", "2.0"))


def load_model():
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    print(f"[generator-en] loading gpt2-medium on {device}", file=sys.stderr, flush=True)
    tokenizer = GPT2Tokenizer.from_pretrained("gpt2-medium")
    model = GPT2LMHeadModel.from_pretrained("gpt2-medium", torch_dtype=torch.float16)
    model = model.to(device)
    model.eval()
    print("[generator-en] model ready", file=sys.stderr, flush=True)
    return model, tokenizer, device


def generate_text(model, tokenizer, device):
    seed = random.choice(SEEDS)
    if seed:
        inputs = tokenizer.encode(seed, return_tensors="pt").to(device)
    else:
        inputs = torch.tensor([[tokenizer.bos_token_id]], dtype=torch.long, device=device)

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
    # Split on sentence-ending punctuation and newlines
    fragments = re.split(r"[.!?;:\n\r]+", text)
    results = []
    for frag in fragments:
        frag = frag.strip()
        if not frag:
            continue
        words = frag.split()
        if MIN_WORDS <= len(words) <= MAX_WORDS:
            results.append(frag)
        elif len(words) > MAX_WORDS:
            # Sub-split on commas to salvage shorter fragments
            for sub in re.split(r",\s*", frag):
                sub = sub.strip()
                w = sub.split()
                if MIN_WORDS <= len(w) <= MAX_WORDS:
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
                    "lang": "en",
                    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
                print(json.dumps(record, ensure_ascii=False), flush=True)
                time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
        except KeyboardInterrupt:
            break
        except BrokenPipeError:
            sys.exit(0)
        except Exception as e:
            print(f"[generator-en] ERROR: {e}", file=sys.stderr, flush=True)
            time.sleep(1)


if __name__ == "__main__":
    main()
