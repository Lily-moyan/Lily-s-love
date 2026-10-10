# 简历改写 eval（李雪蓉 · AI 产品经理岗）

一套最小可用的 eval 闭环：**样本 → 跑批 → 判分 → 人工对齐 → 看 pass 率 → 改 prompt → 再跑**。

被测单元：给**一条原始简历 bullet + 一份 JD**，产出改写后的 bullet。
这是「简历改写」这件事里最小、最可复现的单位——比整份简历好判分，又比单句改写更接近真实任务。

## 目录

| 文件 | 作用 |
|---|---|
| `cases.jsonl` | 30 条样本 = 15 条真实简历 bullet × 2 份真实 JD |
| `facts.md` | **唯一事实来源**。判分和 prompt 都以它为准，超出它的数字/公司/工具一律算编造 |
| `jd/yuncong.md`、`jd/zhengda.md` | 两份真实 JD 原文 |
| `rubric.md` | 两条二元断言的定义、critique 要求、人机对齐方法 |
| `prompts/v1-baseline.md` | 基线：只说「改写得更贴合岗位」（≈ 现在多数人直接用大模型的方式） |
| `prompts/v2-evidence.md` | 改进版：加了「只用已有事实 / 必须对齐指定要求 / 撑不住就如实说」三条硬约束 |
| `run.mjs` | 批量生成 → `runs/<时间戳>/outputs.jsonl` |
| `judge.mjs` | 断言 A 纯代码判 + 断言 B LLM judge → `judged.jsonl` |
| `report.mjs` | pass 率（变体 × 断言）、失败清单、人机一致率 |
| `viewer.html` | 人工查看 + 标注 → 导出 `labels.jsonl` |

## 怎么跑

```powershell
cd G:\dsh\resume-eval

node run.mjs --limit 3            # 先探路，确认通路
node run.mjs                      # 全量：30 条 × 2 变体 = 60 次调用
node judge.mjs --run runs\<时间戳>  # 判分
node report.mjs --run runs\<时间戳> # 看结果
```

模型配置从 `G:\dsh\resume-expert\.env.local` 读（`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`），
也可以用 `LLM_ENV_FILE` 指向别的文件。密钥不会被打印、不会写进结果。

看结果：浏览器打开 `viewer.html`，选 `runs/<时间戳>/outputs.jsonl` 和 `judged.jsonl`，
人工点 20 条 pass/fail，导出 `labels.jsonl` 放进同一个 run 目录，再跑一次 `report.mjs` 看一致率。

## 为什么要这么设计

1. **先有 error analysis，不是先有工具。** 30 条样本是从真实简历和真实 JD 里挖的，不是随机抽的——每条都对应一个「这条能不能撑住这个岗位」的具体判断。
2. **两条断言，都是二元。** 不要 1–5 分：3 分和 4 分的界限会吃掉你的注意力，而且最后你还是得自己划线。
3. **能代码判的绝不花 token。** 断言 A（编造）用数字白名单纯代码判，稳、免费、可复现；只有断言 B（对齐质量）才用 LLM judge。
4. **judge 不可信，除非验证过。** 人机一致率低于 85% 时，judge 的 pass 率只是参考值，不能当结论；这时改 rubric，**不要**去改被测 prompt。
5. **生成与判分分离。** 判分器看不到 prompt，只看到输出——避免「判分器顺着 prompt 的意图打分」。
6. **记录版本。** 每次 run 都留 `meta.json`：模型、temperature、变体、prompt 哈希、case 列表。三个月后你还知道分数是怎么来的。

## 下一轮可以改什么

- 样本：30 → 60（加"该绕开的要求"这类 case，例如正大能科的「1 年燃气经验」）。
- 稳定性：`node run.mjs --repeats 3 --temperature 0.8` 看同一条 case 的通过率波动（pass@k vs pass^k）。
- 判分：断言 A 加上「把弱证据说成强证据」的动词对照表（参与/主导、支持/负责）。
- 扩到整份简历：把单元从「一条 bullet」换成「整份简历」，样本量降到 10 条左右，判分改成逐条 bullet 的通过率。
