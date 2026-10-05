# -*- coding: utf-8 -*-
"""从 bpmfvs 规格读音表（phonic_table_Z.txt）生成注音芫荽 IVS 查找数据。
数据格式：[keys, vals, vocab]
  keys : 所有汉字依序连接（每字一个 BMP 字符）
  vals : 每字的读音序列，读音编码为 chr(0x3400 + vocab序号)，条目以 U+E000 分隔
  vocab: ",".join(全部读音字符串)
运行期反查：bpmfIvs[ch] = [读音1, 读音2, ...]，读音序号 n → IVS 选择子 U+E01E0+n（n=0 为默认字形，无需选择子）。
读音表来源 https://github.com/ButTaiwan/bpmfvs（Apache-2.0 / 字型 OTF），读音与《重編國語辭典》同源。
用法：python .pyp/gen-ivs.py  →  写出 .pyp/bpmf-ivs.data.json
"""
import io, json, sys, io as _io

SRC = ".pyp/bpmfvs/table_Z.txt"
DST = ".pyp/bpmf-ivs.data.json"
SEP = 0xE000
BASE = 0x3400

rows = {}
order = []
dup = 0
astral = 0
vocab = {}
for line in io.open(SRC, encoding="utf-8"):
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 4:
        continue
    ch = parts[0]
    if len(ch) != 1 or ord(ch) > 0xFFFF:
        astral += 1
        continue
    readings = [r.strip() for r in parts[3:] if r.strip()]
    if not readings:
        continue
    if ch in rows:
        dup += 1
        continue
    rows[ch] = readings
    order.append(ch)
    for r in readings:
        if r not in vocab:
            vocab[r] = len(vocab)

if len(vocab) > 0xC000 - BASE:
    sys.exit("vocab too large: %d" % len(vocab))

keys = "".join(order)
vals = "".join(
    "".join(chr(BASE + vocab[r]) for r in rows[ch]) + chr(SEP)
    for ch in order
)
voc = ",".join(sorted(vocab, key=vocab.get))
data = json.dumps([keys, vals, voc], ensure_ascii=False)
io.open(DST, "w", encoding="utf-8").write(data)

multi = sum(1 for ch in order if len(rows[ch]) > 1)
print("chars: %d (dup skipped %d, astral skipped %d)" % (len(order), dup, astral))
print("syllables: %d, polyphones(>1 reading): %d" % (len(vocab), multi))
print("data size: %d bytes" % len(data.encode("utf-8")))
