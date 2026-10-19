// 补表自检：检查 template.html 里的 POLY_EXTRA（引擎缺失读音的项目补充表）是否仍然必要
// 用法：node check-poly-extra.js
// 目的：引擎升级后，某些补录读音可能已被上游收录（重复维护），或补表项已失效；
//       本脚本逐条比对当前内嵌引擎的多音数据，列出「仍缺失」「上游已收录」「格式异常」三类。
// 退出码：0 正常（含「上游已收录」提示）；1 存在格式错误 / 找不到引擎文件。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;

// 1) 找版本号最高的内嵌引擎
const vendorDir = path.join(root, "vendor");
const engines = fs.readdirSync(vendorDir)
  .map(f => /^engine-(\d+\.\d+\.\d+)\.js$/.exec(f))
  .filter(Boolean)
  .map(m => ({ file: m[0], ver: m[1], parts: m[1].split(".").map(Number) }))
  .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
if (!engines.length) { console.error("未找到 vendor/engine-x.y.z.js"); process.exit(1); }
const enginePath = path.join(vendorDir, engines[0].file);

const ctx = { console };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(enginePath, "utf8"), ctx);
const lib = ctx.pinyinPro;
if (!lib) { console.error("引擎加载失败：未导出 pinyinPro"); process.exit(1); }

// 2) 从 template.html 抽取 POLY_EXTRA
const tpl = fs.readFileSync(path.join(root, "template.html"), "utf8");
const m = /var POLY_EXTRA\s*=\s*(\{[\s\S]*?\n  \});/.exec(tpl);
if (!m) { console.error("template.html 中未找到 POLY_EXTRA"); process.exit(1); }
let table;
try { table = vm.runInNewContext("(" + m[1] + ")"); }
catch (e) { console.error("POLY_EXTRA 解析失败：" + e.message); process.exit(1); }

// 3) 逐条比对
//    拼音合法性：允许带调号，或轻声（无调号纯字母）
const SYL_RE = /^[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜêńňǹḿ]+$/;
const rows = [];
let errors = 0, stale = 0, missing = 0;

for (const han of Object.keys(table)) {
  if ([...han].length !== 1 || !/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(han)) {
    rows.push([han, "格式异常：键必须是单个汉字", "ERROR"]); errors++; continue;
  }
  const engineRd = String(lib.polyphonic(han) || "").split(/\s+/).filter(Boolean);
  const adds = table[han];
  if (!Array.isArray(adds) || !adds.length) {
    rows.push([han, "格式异常：值必须是非空数组", "ERROR"]); errors++; continue;
  }
  for (const rd of adds) {
    if (!SYL_RE.test(rd)) { rows.push([han, "格式异常：读音 " + JSON.stringify(rd), "ERROR"]); errors++; continue; }
    if (engineRd.indexOf(rd) >= 0) {
      rows.push([han + " " + rd, "上游 " + engines[0].ver + " 已收录（可删除该补录项）", "STALE"]); stale++;
    } else {
      rows.push([han + " " + rd, "上游缺失，补录有效（引擎现有：" + engineRd.join(" ") + "）", "OK"]); missing++;
    }
  }
}

// 4) 输出
const w = Math.max(...rows.map(r => r[0].length), 4);
console.log("引擎：" + engines[0].file + "（" + (ctx.__ENGINE_VERSION__ || "?") + "）");
console.log("补表条目：" + missing + " 条有效 / " + stale + " 条已被上游收录 / " + errors + " 条异常\n");
rows.forEach(r => console.log("  " + r[0].padEnd(w) + "  " + r[1]));
if (stale) console.log("\n提示：标记为「上游已收录」的条目可以在下次发版时删除，避免与引擎重复维护。");
process.exit(errors ? 1 : 0);
