// 前端 markdown 渲染器的真实渲染验证：抽出 md2html 与 esc，用真实摘要跑一遍。
//
// 教训：断言必须**条件化**。第一版对输入里根本不存在的语法（某些摘要没有 ### / > / 列表）
// 也要求输出里有对应标签，于是报了一堆假失败。正确做法是：
// 只有当输入里出现某语法时，才要求输出里有对应标签；输入没有就 SKIP。
const fs = require("fs");

const page = process.argv[2];
const digest = process.argv[3];
const html = fs.readFileSync(page, "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");

const a = scripts.indexOf("function esc");
const b = scripts.indexOf("/* ---- 数据加载");
if (a < 0 || b < 0 || b <= a) {
  console.error("无法定位 esc/md2html 源码片段");
  process.exit(2);
}
const md2html = new Function(scripts.slice(a, b) + "\nreturn md2html;")();

const md = fs.readFileSync(digest, "utf8");
const out = md2html(md);

// [输入的 markdown 语法, 期望出现的 HTML 标签, 名称]
const expects = [
  ["\n### ", "<h3>", "三级标题"],
  ["\n## ", "<h2>", "二级标题"],
  ["\n# ", "<h1>", "一级标题"],
  ["**", "<b>", "粗体"],
  ["`", "<code>", "行内代码"],
  ["\n|", "<td>", "表格单元格"],
  ["\n- ", "<ul>", "无序列表"],
  ["\n> ", "<blockquote>", "引用"],
];

let checked = 0;
let failed = 0;
for (const [syn, tag, name] of expects) {
  if (!md.includes(syn)) {
    console.log(`  SKIP ${name}（输入中没有该语法）`);
    continue;
  }
  checked++;
  const ok = out.includes(tag);
  if (!ok) failed++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}  -> 期望包含 ${tag}`);
}

// 注意：必须在**代码段之外**检查残留。
// 摘要里存在 `sk-c78d****f297` 这类被脱敏的 Key，星号是真实内容，理应原样保留在 <code> 里。
// 第一版在整个输出里找 ** 就把它误判成"未渲染的粗体"了。
const outsideCode = out.replace(/<code>[\s\S]*?<\/code>/g, "");
const structural = [
  [!outsideCode.includes("**"), "代码段之外无未渲染的 **"],
  [!/<t[dh]>\s*\|/.test(out), "表格竖线已被吃掉"],
  [out.length > md.length * 0.8, "输出体量与输入匹配"],
  [/<code>[\s\S]*?<\/code>/.test(out) === md.includes("`"), "代码段处理与输入一致"],
];
for (const [ok, name] of structural) {
  checked++;
  if (!ok) failed++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}`);
}

console.log(`\n输入 ${md.length} 字符 -> 输出 ${out.length} 字符 HTML；检查 ${checked} 项，失败 ${failed} 项`);
console.log(`结论: ${failed === 0 ? "全部通过" : "存在失败项"}`);
process.exit(failed === 0 ? 0 : 1);
