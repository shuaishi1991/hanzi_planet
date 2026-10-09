#!/usr/bin/env python3
"""Re-split sentence groups in js/books.js to ~10 hanzi parts (punct/quote/jieba)."""
from __future__ import annotations
import json, re, jieba
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOKS_JS = ROOT / "js" / "books.js"
HAN = re.compile(r"[\u4e00-\u9fff]")
PUNCT_BREAK = set("，。！？；、：…")
ATTACH_RIGHT_PREFIX = set("了着过的地得么们")
for w in ["一个一个地","系好","苹果口味","迷你木屋","糖果屋","捉迷藏","大门口","国庆节","一动不动","一闪一闪","跑来跑去","西瓜冰沙","胖娃娃","蓝袜子","红袜子","绿袜子","穿上了"]:
    jieba.add_word(w)

def han_len(s): return len(HAN.findall(s))

def split_at_quotes(text):
    parts, i, n = [], 0, len(text)
    while i < n:
        if text[i] == "“":
            j = text.find("”", i + 1)
            if j < 0: parts.append(text[i:]); break
            parts.append(text[i:j+1]); i = j + 1
        else:
            j = text.find("“", i)
            if j < 0: parts.append(text[i:]); break
            parts.append(text[i:j]); i = j
    return [p for p in parts if p]

def split_to_atoms(text):
    text = text.replace("...", "…").replace("……", "…")
    pieces = []
    for seg in split_at_quotes(text):
        if len(seg) >= 2 and seg[0] == "“" and seg[-1] == "”":
            pieces.append(seg); continue
        buf = ""
        for ch in seg:
            buf += ch
            if ch in PUNCT_BREAK:
                pieces.append(buf); buf = ""
        if buf: pieces.append(buf)
    return [p for p in pieces if p]

def soft_cut(chunk, limit=10):
    if han_len(chunk) <= limit: return [chunk]
    count = 0
    for i, ch in enumerate(chunk[:-1]):
        if HAN.match(ch): count += 1
        if ch in PUNCT_BREAK and 3 <= count <= limit:
            return [chunk[:i+1]] + soft_cut(chunk[i+1:], limit)
    words = list(jieba.cut(chunk))
    cands = []
    acc = 0
    for w in words[:-1]:
        acc += len(w)
        left, right = chunk[:acc], chunk[acc:]
        cut = acc
        while right and right[0] in ATTACH_RIGHT_PREFIX and han_len(left) + 1 <= limit and han_len(right) > 3:
            left += right[0]; right = right[1:]; cut = len(left)
        lh, rh = han_len(left), han_len(right)
        if lh < 3 or rh < 3 or lh > limit: continue
        left_stripped = re.sub(r"[，。！？；、：…\s“”]+$", "", left)
        dangling = left_stripped and left_stripped[-1] in "不很太最更还也都又再绿红青白黑黄"
        score = -abs(lh - 8) - (20 if dangling else 0)
        if right[:1] in ATTACH_RIGHT_PREFIX: score -= 8
        if right.startswith(("地", "得")) and lh >= 6: score -= 3
        cands.append((score, lh, cut))
    if cands:
        cands.sort(key=lambda x: (-x[0], -x[1]))
        cut = cands[0][2]
        return [chunk[:cut]] + soft_cut(chunk[cut:], limit)
    if han_len(chunk) <= limit + 4: return [chunk]
    return [chunk]

def pack_atoms(atoms, limit=10):
    parts, buf = [], ""
    def flush():
        nonlocal buf
        if buf: parts.append(buf); buf = ""
    for atom in atoms:
        is_quote = len(atom) >= 2 and atom[0] == "“" and atom[-1] == "”"
        if is_quote:
            if han_len(atom) > limit:
                flush()
                body = soft_cut(atom[1:-1], limit)
                if len(body) == 1: parts.append("“" + body[0] + "”")
                else:
                    parts.append("“" + body[0]); parts.extend(body[1:-1]); parts.append(body[-1] + "”")
                continue
            if buf and buf.endswith(("说：", "道：", "问：", "想：", "喊：", "叫：")):
                flush(); parts.append(atom); continue
            if buf and han_len(buf) + han_len(atom) <= limit: buf += atom
            else: flush(); buf = atom
            continue
        if han_len(atom) > limit:
            flush(); parts.extend(soft_cut(atom, limit)); continue
        if not buf: buf = atom
        elif han_len(buf) + han_len(atom) <= limit: buf += atom
        else: flush(); buf = atom
    flush()
    cleaned = []
    for p in parts:
        if cleaned and han_len(p) <= 1 and han_len(cleaned[-1]) + han_len(p) <= limit + 1:
            cleaned[-1] += p
        else: cleaned.append(p)
    return cleaned

def split_paragraph(text, limit=10):
    text = (text or "").strip()
    return pack_atoms(split_to_atoms(text), limit) or [text] if text else [text]

def main():
    src = BOOKS_JS.read_text(encoding="utf-8")
    books = json.loads(src[len("const BOOKS = "):].rstrip().rstrip(";").strip())
    for b in books:
        for ch in b.get("chapters") or []:
            ch["sentences"] = [split_paragraph("".join(g) if isinstance(g, list) else str(g)) for g in (ch.get("sentences") or [])]
    BOOKS_JS.write_text("const BOOKS = " + json.dumps(books, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print("updated", BOOKS_JS)

if __name__ == "__main__":
    main()
