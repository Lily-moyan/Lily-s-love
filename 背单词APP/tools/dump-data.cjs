/* 从 index.html 抽出 PLAN 与 STORIES，写成合法 JSON 供生成脚本读取
   只执行数据段本身，不执行后面的 DOM 代码。

   用法：
     node tools/dump-data.cjs [index.html] [输出.json]
*/
var fs = require("fs");
var path = require("path");

var htmlPath = process.argv[2] || path.join(__dirname, "..", "index.html");
var outPath = process.argv[3] || "";

/* 从 start（指向开括号）开始按括号配对取整段，跳过字符串内部 */
function balanced(text, start) {
  var open = text[start];
  var close = open === "[" ? "]" : "}";
  var depth = 0, inStr = false, esc = false;
  for (var i = start; i < text.length; i++) {
    var c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("括号没配对");
}

function grab(html, decl) {
  var i = html.indexOf(decl);
  if (i < 0) throw new Error("找不到 " + decl);
  var openAt = -1;
  for (var j = i + decl.length; j < html.length; j++) {
    if (html[j] === "[" || html[j] === "{") { openAt = j; break; }
  }
  if (openAt < 0) throw new Error(decl + " 后面没有数据");
  return balanced(html, openAt);
}

var html = fs.readFileSync(htmlPath, "utf8");
var planText = grab(html, "var PLAN = ");
var storyText = grab(html, "var STORIES = ");

/* 安全性检查：数据段里不该出现任何代码 */
function assertPureData(text, label) {
  var bad = ["function", "=>", ";", "eval", "require", "window", "document", "this"];
  bad.forEach(function (k) {
    if (text.indexOf(k) >= 0) throw new Error(label + " 里出现了可疑内容：" + k);
  });
}

assertPureData(planText, "PLAN");
assertPureData(storyText, "STORIES");

/* PLAN 是合法 JSON；STORIES 是对象字面量（键名没引号），需要求值 */
var plan = JSON.parse(planText);
var stories = (0, eval)("(" + storyText + ")");

/* 结构校验：只允许预期的字段 */
var ALLOWED_STORY_KEYS = { s: 1, act: 1, pic: 1, ask: 1, ipa: 1, emoji: 1, tip: 1 };
Object.keys(stories).forEach(function (w) {
  var st = stories[w];
  if (!st || typeof st !== "object") throw new Error(w + " 的故事不是对象");
  Object.keys(st).forEach(function (k) {
    if (!ALLOWED_STORY_KEYS[k]) throw new Error(w + " 出现未知字段：" + k);
  });
});
plan.forEach(function (row) {
  if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") {
    throw new Error("PLAN 行格式不对：" + JSON.stringify(row));
  }
});

var json = JSON.stringify({ PLAN: plan, STORIES: stories }, null, 2);

if (outPath) {
  fs.writeFileSync(outPath, json, "utf8");
  // 输出保持 ASCII：Windows 上子进程默认用 GBK 解码，中文会炸
  console.error("[dump-data] wrote " + outPath + " (" + plan.length +
                " words, " + Object.keys(stories).length + " stories)");
} else {
  process.stdout.write(json);
}
