// 构建脚本：生成「台湾读音差异表」（tw-diff）
// 数据源：g0v/moedict-data《重編國語辭典修訂本》dict-revised.json（词典文本 CC BY-ND 3.0 臺灣 教育部；JSON 格式化 CC0 @kcwu）
// 普通话读音：与运行时引擎完全一致的 pinyin-pro 3.29.4（从 main.html 提取的 UMD 引擎 .pyp/engine-3.29.4.js）
// 繁→简：opencc-js（tw→cn，构建期转换表键）
// 输出：
//   seg-dict/twdiff.b64.txt       gzip+base64 的 TSV（运行时嵌入）
//   .pyp/twdiff-stats.txt         构建统计与样例报告
//
// TSV 格式：
//   w<TAB>词<TAB>读音1|读音2        词级（读音为空格分隔的音节序列）
//   c<TAB>字<TAB>读音1|读音2        字级（大陆读音与台读音完全无交集的字，兜底用）
// 音节形式与 pinyin-pro 输出一致：带调符号、轻声无调（如 "lè sè"、"dōng xi"）
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const NODE_PATHS = "C:/Users/5809/.workbuddy/binaries/node/workspace/node_modules";

// ---- 载入与运行时一致的 pinyin-pro 引擎 ----
const engineCode = fs.readFileSync(path.join(__dirname, "engine-3.29.4.js"), "utf8");
const mod = { exports: {} };
new Function("exports", "module", "window", engineCode)(mod.exports, mod, globalThis);
const pinyin = mod.exports.pinyin;

// ---- opencc 繁→简（tw 用字 → cn 用字）----
const OpenCC = require("C:/Users/5809/.workbuddy/binaries/node/workspace/node_modules/opencc-js");
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });
const s2t = OpenCC.Converter({ from: "cn", to: "tw" });

// ---- 工具 ----
const HAN_RE = /^[\u3400-\u9FFF]+$/;
const SYL_RE = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/;
// 音节规范化：小写、ü 类统一映射 v（两岸标法差异吸收；不做 jqx u→v，避免 qu/qù 类误判）
function normSyl(s) {
  return s.toLowerCase().replace(/[üǖǘǚǜ]/g, "v");
}
const TONE_RE = /[āáǎàēéěèīíǐìōóǒòūúǔù]/;
function stripTone(s) {
  const map = { ā:"a",á:"a",ǎ:"a",à:"a",ē:"e",é:"e",ě:"e",è:"e",ī:"i",í:"i",ǐ:"i",ì:"i",ō:"o",ó:"o",ǒ:"o",ò:"o",ū:"u",ú:"u",ǔ:"u",ù:"u" };
  return normSyl(s).replace(/[āáǎàēéěèīíǐìōóǒòūúǔù]/g, (m) => map[m] || m);
}
// 轻声判定：无调符（如 de/ge/zi）
function isLight(s) {
  return !TONE_RE.test(s);
}
// 单音节等价：完全一致；或轻声 vs 非轻声（无调符方，声韵同）；或「一/不」变调 vs 原调；
// 双方均有调符且调值不同 → 真实声调差异（如 qī vs qí），不算等价
function sylEq(a, b) {
  const x = normSyl(a), y = normSyl(b);
  if (x === y) return true;
  const sx = stripTone(a), sy = stripTone(b);
  if (sx !== sy) return false;
  if ((sx === "yi" && sy === "yi") || (sx === "bu" && sy === "bu")) return true; // 一/不变调 vs 原调（台湾标原调）
  if (isLight(a) || isLight(b)) return true; // 轻声标法差异
  return false;
}
function seqEq(arr1, arr2) {
  return arr1.length === arr2.length && arr1.every((s, i) => sylEq(s, arr2[i]));
}

// ---- 读取萌典 ----
const moedict = JSON.parse(fs.readFileSync("F:/ggiitt/moedict-data/dict-revised.json", "utf8"));
const stats = { entries: moedict.length, hanWord: 0, hanChar: 0, wordCnSkip: 0, wordDiff: 0, wordSame: 0, charDiff: 0, charSame: 0, charSkip: 0 };

const wordMap = new Map(); // key(简体) -> Map(读音串 -> true)
const charMap = new Map();
const diffSamples = [];
// 字级手工白名单：两岸主流读音确有差异、但萌典把大陆音标作「又音/語音」导致交集规则漏收的常用字。
// 依据教育部《國語一字多音審音表》的主流读音（如 堤：台 ㄊ丨ˊ 主音、ㄉ丨 又音；攜：台 ㄒ丨 讀音、ㄒ丨ㄝˊ 語音）。
// 期 qī 这类「两岸日常同音、仅义项读音不同」的字不能进白名单（会误伤）。
const TW_CHAR_OVERRIDE = {
  "堤": ["tí"],
  "攜": ["xī"]
};

for (const e of moedict) {
  const title = e.title || "";
  if (!HAN_RE.test(title)) continue;
  const heteronyms = (e.heteronyms || []).map((h) => (h.pinyin || "").trim().toLowerCase().split(/\s+/)).filter((a) => a.length && a.every((s) => SYL_RE.test(s)));
  if (!heteronyms.length) continue;

  if (title.length === 1) {
    // ---- 字级：仅收简繁同形字（t2s/s2t 均不变）----
    // 排除「简化字与古字撞形」误伤：儿(→rén)、听(→yǐn)、广(→yǎn)、宁(→zhù) 等在简体文本中是常用字，
    // 萌典收的是古字义读音，若不剔除会把大陆用户简体文本注错
    stats.hanChar++;
    const key = t2s(title);
    if (TW_CHAR_OVERRIDE[title]) {
      charMap.set(key, TW_CHAR_OVERRIDE[title]);
      stats.charDiff++;
      continue;
    }
    if (t2s(title) !== title || s2t(title) !== title) { stats.charSkip++; continue; }
    let cnSet;
    try {
      cnSet = pinyin(t2s(title), { type: "array", multiple: true });
    } catch (_) { cnSet = null; }
    if (!cnSet || !cnSet.length || cnSet.some((s) => !SYL_RE.test(s))) { stats.charSkip++; continue; }
    const twAll = [];
    for (const arr of heteronyms) { if (arr.length === 1) twAll.push(arr[0]); }
    if (!twAll.length) { stats.charSkip++; continue; }
    const inter = cnSet.some((c) => twAll.some((t) => sylEq(c, t)));
    if (inter) { stats.charSame++; continue; }
    const uniq = [...new Set(twAll)];
    charMap.set(key, uniq);
    stats.charDiff++;
  } else if (title.length <= 4) {
    // ---- 词级：存在与普通话一致的台读音 → 不收；否则收与普通话不同的读音 ----
    // 限 ≤4 字：5-6 字条目多为文言典故词（三都賦/中散大夫类），现代文本命中率极低，裁掉省体积
    stats.hanWord++;
    const simTitle = t2s(title);
    let cn;
    try {
      cn = pinyin(simTitle, { type: "array" }); // 用简体形跑普通话读音（与运行时输入一致）
    } catch (_) { cn = null; }
    if (!cn || cn.length !== title.length || cn.some((s) => !SYL_RE.test(s))) { stats.wordCnSkip++; continue; }
    const alignedTw = heteronyms.filter((a) => a.length === title.length);
    if (!alignedTw.length) { stats.wordCnSkip++; continue; }
    const differing = alignedTw.filter((a) => !seqEq(a, cn));
    if (!differing.length) { stats.wordSame++; continue; }
    const key = simTitle;
    if (!wordMap.has(key)) wordMap.set(key, new Map());
    const bucket = wordMap.get(key);
    for (const a of differing) bucket.set(a.join(" "), true);
    stats.wordDiff++;
    if (diffSamples.length < 400) diffSamples.push(title + " | " + cn.join(" ") + " => " + differing.map((a) => a.join(" ")).join(" / "));
  }
}

// ---- 繁体键扩展：运行时 trie 直接匹配原文（繁体/简体输入都能命中）----
// 简体键 k → 生成 cn→tw / cn→t / cn→hk 的繁体变体键，同读音。
// 冲突安全：变体若与已有键读音冲突（如同一繁体形对应多个不同读音的简体键）则放弃该变体。
const s2tVariants = [
  OpenCC.Converter({ from: "cn", to: "tw" }),
  OpenCC.Converter({ from: "cn", to: "t" }),
  OpenCC.Converter({ from: "cn", to: "hk" })
];
function tradVariants(k) {
  const out = new Set();
  for (const cv of s2tVariants) {
    let v;
    try { v = cv(k); } catch (_) { continue; }
    if (v && v !== k && HAN_RE.test(v) && v.length === k.length) out.add(v);
  }
  return [...out];
}
let variantAdded = 0, variantConflict = 0;
function expandVariants(map, isWord) {
  const pending = new Map(); // 变体键 -> Map(来源简体键 -> true)
  for (const k of [...map.keys()]) {
    for (const v of tradVariants(k)) {
      if (!pending.has(v)) pending.set(v, new Map());
      pending.get(v).set(k, true);
    }
  }
  for (const [v, srcs] of pending) {
    if (map.has(v)) { variantConflict++; continue; }           // 已有键（简体或先前变体）占位
    if (srcs.size !== 1) { variantConflict++; continue; }      // 多来源读音可能不同，跳过
    const src = [...srcs.keys()][0];
    map.set(v, map.get(src));
    variantAdded++;
  }
}
expandVariants(wordMap, true);
expandVariants(charMap, false);

// ---- 序列化 TSV ----
const lines = [];
for (const [k, bucket] of wordMap) lines.push("w\t" + k + "\t" + [...bucket.keys()].join("|"));
for (const [k, arr] of charMap) lines.push("c\t" + k + "\t" + arr.join("|"));
lines.sort();
const tsv = lines.join("\n");
const gz = zlib.gzipSync(Buffer.from(tsv, "utf8"), { level: 9 });
const b64 = gz.toString("base64");
fs.writeFileSync(path.join(ROOT, "seg-dict", "twdiff.b64.txt"), b64);

// ---- 统计报告 ----
const rep = [];
rep.push("entries=" + stats.entries);
rep.push("hanWord=" + stats.hanWord + " wordDiff=" + stats.wordDiff + " wordSame=" + stats.wordSame + " wordCnSkip=" + stats.wordCnSkip);
rep.push("hanChar=" + stats.hanChar + " charDiff=" + stats.charDiff + " charSame=" + stats.charSame + " charSkip=" + stats.charSkip);
rep.push("tsvLines=" + lines.length + " tsvBytes=" + Buffer.byteLength(tsv) + " gzipBytes=" + gz.length + " b64Bytes=" + b64.length);
rep.push("tradVariants added=" + variantAdded + " conflict=" + variantConflict);
rep.push("");
rep.push("== 字级差异 (" + charMap.size + ") ==");
rep.push([...charMap.keys()].join(""));
rep.push("");
rep.push("== 词级差异样例 (前 200) ==");
rep.push(diffSamples.slice(0, 200).join("\n"));
fs.writeFileSync(path.join(__dirname, "twdiff-stats.txt"), rep.join("\n"));
console.log("tw-diff built:", lines.length, "lines, gzip", gz.length, "bytes, b64", b64.length, "bytes");
