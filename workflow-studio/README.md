# ⚡ 工作流平台（类 Coze）

从零开发的轻量可视化工作流平台 MVP：拖拽节点组成 DAG 工作流，一键运行，实时查看每个节点的执行状态与输出，运行历史可回溯。

## 功能

- **可视化画布**：拖拽添加节点、连线组成流程，支持缩放/小地图/框选删除（React Flow）
- **7 类节点**：开始、文本、HTTP 请求、代码（JS 沙箱）、条件分支（是/否双出口）、大模型（LLM）、结束
- **执行引擎**：DAG 逐波调度、同层节点并行执行、条件分支自动跳过未激活路径、上游失败自动中断传播
- **数据引用**：任意节点可通过 `{{inputs.<节点ID>.<字段>}}` 模板引用**任意上游节点**的输出（节点按 id 聚合上游成功输出）
- **实时进度**：运行面板通过 SSE 实时更新节点状态（运行中/成功/失败/跳过），画布节点高亮、连线动画
- **运行历史**：每次运行的输入、每个节点的输出/耗时/错误均可回溯查看
- **内置示例**：首次启动自动创建两个示例工作流（含一个完全离线可跑的）

## 快速开始

环境要求：Node.js ≥ 23.4（内置 `node:sqlite`），推荐 Node 24；包管理器 pnpm。

```bash
cd workflow-studio
pnpm install
pnpm build        # 构建前端
pnpm start        # 启动服务（单进程同时托管 API + 前端）
```

浏览器打开 **http://127.0.0.1:3010**

开发模式（前端热更新 + 后端自动重启）：

```bash
pnpm dev          # 前端 http://127.0.0.1:5173（API 自动代理到 3010）
```

## LLM 节点配置

LLM 节点调用 OpenAI 兼容接口，默认走 DeepSeek，通过环境变量配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LLM_API_KEY` | 空 | API Key；**未配置时进入 mock 模式**（返回模拟输出，流程仍可完整跑通） |
| `LLM_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容 Base URL |
| `LLM_MODEL` | `deepseek-chat` | 默认模型（节点配置里可覆盖） |

```powershell
$env:LLM_API_KEY = "sk-..."
$env:LLM_MODEL  = "deepseek-chat"
pnpm start
```

## 技术栈与结构

```
workflow-studio/
├── server/            # Node.js 后端（Express + node:sqlite，零原生依赖）
│   └── src/
│       ├── index.js   # 入口：API + 静态托管前端 dist
│       ├── routes.js  # 工作流 CRUD / 运行 / SSE
│       ├── engine.js  # DAG 执行引擎（并行调度 + 条件分支 + 跳过传播）
│       ├── nodes.js   # 节点注册表：类型元数据 + 执行器（模板/HTTP/JS沙箱/LLM）
│       ├── db.js      # SQLite 存储（workflows / runs 两张表）
│       ├── bus.js     # 运行级事件总线（SSE 推送）
│       └── seed.js    # 示例工作流种子
└── web/               # 前端（Vite + React + TypeScript + @xyflow/react）
    └── src/
        ├── pages/     # 工作流列表 / 画布编辑器 / 运行记录 / 运行详情
        └── components/ # 节点卡片 / 调色板 / 配置面板
```

## 数据与接口

- 数据文件：`server/data/workflow.db`（SQLite，删除即重置，重启会自动重建示例）
- 主要 API（前缀 `/api`）：
  - `GET/POST /workflows`、`GET/PUT/DELETE /workflows/:id`、`POST /workflows/:id/duplicate`
  - `POST /workflows/:id/runs` 发起运行；`GET /runs`、`GET /runs/:id` 查询历史
  - `GET /runs/:id/events` SSE 实时节点状态流
  - `GET /nodes/types` 节点类型元数据（驱动画布调色板与配置表单）

## 已知边界（MVP）

- 代码/条件节点使用 `node:vm` 沙箱 + 超时，**不是安全隔离边界**，仅限可信工作流；单节点超时 120s
- 进程重启会中断正在运行的工作流（运行状态会标记为中断）
- 暂不支持循环节点、工作流级定时触发、节点调试单步执行
