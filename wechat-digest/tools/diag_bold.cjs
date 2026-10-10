// 诊断：定位渲染后仍残留的字面 ** 究竟来自哪一行输入。
const fs = require("fs");

const html = fs.readFileSync(process.argv[2], "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
const a = scripts.indexOf("function esc");
const b = scripts.indexOf("/* ---- 数据加载");
const md2html = new Function(scripts.slice(a, b) + "\nreturn md2html;")();

const md = fs.readFileSync(process.argv[3], "utf8");
const out = md2html(md);

console.log("=== 输出中残留 ** 的位置与上下文 ===");
let idx = -1;
let n = 0;
while ((idx = out.indexOf("**", idx + 1)) >= 0) {
  n++;
  const s = Math.max(0, idx - 120);
  const e = Math.min(out.length, idx + 120);
  console.log(`\n--- 第 ${n} 处，偏移 ${idx} ---`);
  console.log(out.slice(s, e).replace(/\n/g, "⏎"));
  if (n >= 6) break;
}
console.log(`\n输出中 ** 出现次数: ${(out.match(/\*\*/g) || []).length}`);

console.log("\n=== 输入中各行的 ** 个数（奇数行的嫌疑最大） ===");
md.split("\n").forEach((ln, i) => {
  const c = (ln.match(/\*\*/g) || []).length;
  if (c % 2 === 1 || ln.includes("****")) {
    console.log(`  行${i + 1}  **x${c}: ${ln.trim().slice(0, 150)}`);
  }
});
