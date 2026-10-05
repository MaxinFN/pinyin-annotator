// 把 pinyin-pro/data 包的 complete.json 转为分词词典 TSV → gzip+base64
// 输入：F:/ggiitt/pinyin-pro/packages/data/json/complete.json  格式 {词: [拼音, 词频概率]}
// 输出：seg-dict/segdict-complete.b64.txt（gzip+base64 的 TSV：词\t拼音\t词频）
// 过滤规则：仅保留 双字及以上、纯汉字（CJK 基本区+扩展A） 的词条
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = "F:/ggiitt/pinyin-pro/packages/data/json/complete.json";
const OUT = path.join(__dirname, "segdict-complete.b64.txt");

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));

// CJK 基本区 + 扩展A（覆盖常用字即可，扩展区生僻字对分词无意义）
const isHanzi = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf);
};

let total = 0, kept = 0, skippedLen = 0, skippedNonHanzi = 0, skippedNoPinyin = 0;
const lines = [];
for (const word in data) {
  total++;
  const v = data[word];
  if (!Array.isArray(v) || typeof v[0] !== "string" || !v[0]) { skippedNoPinyin++; continue; }
  const chars = Array.from(word);
  if (chars.length < 2) { skippedLen++; continue; }
  let ok = true;
  for (const ch of chars) { if (!isHanzi(ch)) { ok = false; break; } }
  if (!ok) { skippedNonHanzi++; continue; }
  const freq = typeof v[1] === "number" ? v[1] : 0;
  lines.push(word + "\t" + v[0].trim() + "\t" + freq);
  kept++;
}

// 词频降序排序（同频按词长升序），保证 addDict 优先级稳定可预期
lines.sort((a, b) => {
  const fa = parseFloat(a.split("\t")[2]), fb = parseFloat(b.split("\t")[2]);
  if (fb !== fa) return fb - fa;
  return a.length - b.length;
});

const tsv = lines.join("\n");
const gz = zlib.gzipSync(Buffer.from(tsv, "utf8"), { level: 9 });
const b64 = gz.toString("base64");
fs.writeFileSync(OUT, b64);

console.log("总词条:", total);
console.log("保留(双字+纯汉字):", kept);
console.log("跳过-单字:", skippedLen, " 跳过-含非汉字:", skippedNonHanzi, " 跳过-无拼音:", skippedNoPinyin);
console.log("TSV:", tsv.length, "bytes → gzip:", gz.length, "bytes → base64:", b64.length, "bytes");
console.log("输出:", OUT);
