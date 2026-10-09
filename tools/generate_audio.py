#!/usr/bin/env python3
"""Generate Xiaoxiao TTS mp3s for all chars/words/sentences in js/books.js.

Usage:
  python3 tools/generate_audio.py          # only missing files
  python3 tools/generate_audio.py --force  # regenerate all
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("Please install edge-tts: pip install edge-tts")

ROOT = Path(__file__).resolve().parents[1]
BOOKS_JS = ROOT / "js" / "books.js"
AUDIO_DIR = ROOT / "audio"
VOICE = "zh-CN-XiaoxiaoNeural"


def load_books():
    src = BOOKS_JS.read_text(encoding="utf-8")
    if not src.startswith("const BOOKS = "):
        raise SystemExit("js/books.js must start with: const BOOKS = ")
    raw = src[len("const BOOKS = ") :].rstrip().rstrip(";").strip()
    return json.loads(raw)


def collect_texts(books):
    texts = set()
    for b in books:
        for c in b["chapters"]:
            for ch in c["chars"]:
                texts.add(ch["ch"])
                texts.update(ch.get("words") or [])
            texts.update(c.get("bookWords") or [])
            if c.get("articleTitle"):
                texts.add(c["articleTitle"])
            for s in c.get("sentences") or []:
                if isinstance(s, list):
                    texts.update(s)
                else:
                    texts.add(s)
    return sorted(texts, key=lambda x: (len(x), x))


def rate_for(text: str) -> str:
    if len(text) <= 1:
        return "-10%"
    if len(text) <= 4 and not any(p in text for p in "。！？；"):
        return "-5%"
    return "+0%"


# Linux NAME_MAX ~255 bytes; keep short Chinese names, hash long paragraphs
MAX_AUDIO_NAME_BYTES = 180


def out_path(text: str) -> Path:
    # Short: UTF-8 Chinese filename (browser: encodeURIComponent(text)+".mp3")
    # Long: h_<sha1[:16]>.mp3 (same rule in js/app.js audioUrlFor)
    if "/" in text or "\\" in text or text in (".", ".."):
        raise ValueError(f"unsafe utterance: {text!r}")
    raw = f"{text}.mp3"
    if len(raw.encode("utf-8")) > MAX_AUDIO_NAME_BYTES:
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        return AUDIO_DIR / f"h_{h}.mp3"
    return AUDIO_DIR / raw


async def synth_one(sem, text: str, force: bool, stats: dict):
    path = out_path(text)
    if path.exists() and not force:
        stats["skip"] += 1
        return
    async with sem:
        try:
            communicate = edge_tts.Communicate(text, VOICE, rate=rate_for(text))
            await communicate.save(str(path))
            stats["ok"] += 1
            if stats["ok"] % 50 == 0:
                print(f"  generated {stats['ok']} …", flush=True)
        except Exception as e:
            stats["fail"] += 1
            print(f"FAIL [{text!r}]: {e}", flush=True)


async def main_async(force: bool, concurrency: int):
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    books = load_books()
    texts = collect_texts(books)
    print(f"Voice: {VOICE}")
    print(f"Utterances: {len(texts)}  (force={force})")
    sem = asyncio.Semaphore(concurrency)
    stats = {"ok": 0, "skip": 0, "fail": 0}
    await asyncio.gather(*(synth_one(sem, t, force, stats) for t in texts))
    print(f"Done. ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
    print(f"Audio dir: {AUDIO_DIR}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()
    asyncio.run(main_async(args.force, args.concurrency))


if __name__ == "__main__":
    main()
