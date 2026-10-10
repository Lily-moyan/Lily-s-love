# 炒饭会 RAG · 第202回《OPC 的路径选择与启动方式》

把 `G:\AI产品经理\炒饭会\20260923第202回 Opc的路径选择与启动方式.pdf`（139 页，主讲人 高玮，2026.9.23）
变成一份**可离线检索的知识库**：给一句中文查询，返回最相关的幻灯片段落 + 真实页码，方便引用与回查。

无需联网、无需 API Key、无需向量数据库 —— 纯本地 BM25（中文按字符二元组切分）实现。

---

## 目录结构

```
chaofan-rag/
├── extract.py            # ① PDF → data/pages.jsonl（逐页纯文本）
├── build_index.py        # ② pages.jsonl → data/index.json（分块 + BM25 倒排索引）
├── rag.py                # ③ 检索 CLI（人类可读 / --json）
├── knowledge.md          # 结构化知识笔记（章节要点 + 页码引用 + 速查索引）
├── README.md             # 本文件
└── data/
    ├── raw/20260923-chaofanhui-202.pdf   # 源文件副本（自包含）
    ├── pages.jsonl        # 139 页原始文本，每行 {doc, page, text}
    ├── index.json         # 索引（约 246 KB）：chunks + postings + doclen
    └── preview/           # 抽样渲染的页面 PNG（用于核对抽取质量）
```

## 快速开始

```powershell
cd G:\dsh\chaofan-rag
$env:PYTHONIOENCODING='utf-8'      # Windows 控制台默认 GBK，必须设，否则中文报错

python rag.py "OPC 是什么"
python rag.py "需求判定 付费意愿" -k 3
python rag.py "影子时薪 时间 ROI" --full
python rag.py "关停条件" --json
python rag.py --outline             # 打印 133 页的标题目录
python rag.py                       # 交互式检索模式
```

输出示例：

```
[1] 8.14  p.115  七个阶段阶段讲次线解决什么你会带走商业定位 L1-L3 …
     …十天计划终局 L30 商业养着、卖掉，还是长大三个数字与关停条件
```

`[序号] BM25得分  页码  该页标题` + 命中片段（`--full` 打印整段）。多份文档时页码前会带 `回202` 之类的短文档标签。

## 重建 / 加入下一回

```powershell
# 全量重建
python extract.py            # 可用位置参数指定别的 PDF
python build_index.py --stats

# 追加第203回（保留已有内容）
python extract.py --append "G:\AI产品经理\炒饭会\2026xxxx第203回 ....pdf"
python build_index.py
```

`pages.jsonl` 每行都带 `doc` 字段，多份文档共用一个索引，检索结果自动带文档标签。

## 工作原理

| 环节 | 做法 | 原因 |
| --- | --- | --- |
| 抽取 | PyMuPDF `get_text("text")` 逐页 | 该 deck 是真文本 PDF，中文抽取 100% 准确（已用第 30 页渲染图逐字核对） |
| 清洗 | 去掉每页页眉噪音（`BDS`、`炒饭会`、`课伴`、竖排拆字），保留 bullet 结构，合并版式换行 | 幻灯片的换行是排版而非语义 |
| 分块 | **一页一块**（>420 字才切分，重叠 60 字） | 幻灯片的语义单元就是每一页，页码引用天然准确 |
| 切词 | 中文 → 字符二元组 + 单字兜底；英文/数字整体保留 | 无需 jieba，对短查询与术语（`CAC`、`LTV/CAC`、`GEO`）都稳 |
| 排序 | BM25（k1=1.5, b=0.75）+ 标题命中加权 ×2 | 标题词是强信号；无命中时自动回退到单字检索 |
| 引用 | 每个结果携带 `page` | 结论可回溯到原文页码 |

**为什么不用向量检索**：本机没有可用的 embedding 模型或 API Key（已确认 `sentence_transformers` 缺失、环境无相关变量）。
中文二元组 BM25 在这类短文本、术语密集的幻灯片上召回已经很好；若日后要升级语义检索，只要替换 `Retriever._score`
并把 `build_index.py` 的 `postings` 换成向量矩阵即可，`rag.py` 的接口不用动。

## 已知局限

- **图片里的内容检索不到**：本 deck 的正文全是文本框，背景图/插图不含关键信息；若后续某回是图片版 PPT，需要先 OCR（PyMuPDF 可渲染成 PNG，本机 `pdfplumber`/`fitz` 可用）。
- 标题会被版式影响：部分页首行是口号而不是标题（如 `p.41 特点`），不影响召回但显示略粗糙。
- 6 页被整页剔除（139 → 133）：这些页只有页眉装饰字，无正文。
- 页码是 PDF 页码，不是 PPT 原始页码（两者在本文件里一致）。

## 依赖

Python 3.12（本机已就绪）：`fitz`（PyMuPDF）——仅 `extract.py` 需要；`build_index.py` 与 `rag.py` 只用标准库。
