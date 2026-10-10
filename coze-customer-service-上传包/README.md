# 通用网页搭建专家 - 智能客服系统

基于 Coze 工作流的智能客服对话网站，支持订单查询、物流跟踪、售后处理等业务场景。

## 特性

- ✅ **流式响应**: 实时显示工作流输出，无需等待完整响应
- ✅ **中断恢复**: 支持工作流追问场景，自动处理 Interrupt 事件
- ✅ **多气泡渲染**: 按 `node_title` + `loop_index` 智能分组显示多个结果
- ✅ **Cyan 主题**: 现代化设计，Bento 阴影 + Large 圆角
- ✅ **类型安全**: 完整的 TypeScript 类型定义
- ✅ **响应式设计**: 适配移动端和桌面端

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

创建 `.env.local` 文件：

```bash
COZE_PAT=your_coze_personal_access_token
COZE_WORKFLOW_ID=your_workflow_id
```

### 3. 启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

### 4. 生产构建

```bash
pnpm build
pnpm start
```

## 项目结构

```
coze-customer-service/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── chat/
│   │   │       └── route.ts          # 后端 API：透传工作流 SSE
│   │   ├── globals.css               # CSS 变量 + Tailwind
│   │   ├── layout.tsx                # 根布局
│   │   └── page.tsx                  # 首页
│   └── components/
│       └── chat/
│           └── chat-window.tsx       # 聊天窗口组件
├── .env.local                        # 环境变量（不提交）
├── .env.example                      # 环境变量示例
├── package.json                      # 依赖配置
├── tsconfig.json                     # TypeScript 配置
├── tailwind.config.js                # Tailwind 配置
├── DESIGN.md                         # 设计语言文档
├── AGENTS.md                         # 工程指南文档
└── README.md                         # 本文件
```

## 核心功能

### 流式渲染

使用 `fetch + body.getReader()` 逐 chunk 读取 SSE 流：

```typescript
const reader = response.body?.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // 实时更新 UI
}
```

### 多气泡分组

工作流循环输出时，按 `node_title` + `loop_index` 自动分组：

```typescript
const key = `${nodeTitle}_${loopIndex}`
// 相同 key 追加内容，不同 key 创建新气泡
```

### 中断恢复

1. 收到 `Interrupt` 事件时记录 `event_id` 和 `interrupt_type`
2. 用户回答后，下次请求自动带上这两个字段
3. 后端路由到 `stream_resume` 端点

### 未查到 Fallback

当用户输入订单号/手机号格式，但工作流没返回订单结果时，自动显示友好提示。

## 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS + CSS Variables
- **包管理**: pnpm
- **API**: Coze Workflow API (SSE)

## 开发规范

### 样式约束

**禁止硬编码**，必须使用 CSS 变量：

```tsx
// ✅ 正确
style={{ backgroundColor: 'hsl(var(--primary))' }}
style={{ borderRadius: 'var(--radius)' }}

// ❌ 错误
style={{ backgroundColor: '#00bcd4' }}
style={{ borderRadius: '12px' }}
```

### 端口配置

**禁止硬编码端口**，必须从环境变量读取：

```json
{
  "scripts": {
    "dev": "next dev -p ${DEPLOY_RUN_PORT:-3000}"
  }
}
```

### 客户端渲染守卫

避免 hydration 错误，动态内容使用 `useEffect` 守卫：

```tsx
const [isMounted, setIsMounted] = useState(false)

useEffect(() => {
  setIsMounted(true)
}, [])

if (!isMounted) return null
```

## 测试

### 类型检查

```bash
pnpm ts-check
```

### Lint 检查

```bash
pnpm lint
```

### API 测试

```bash
# 首次调用
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "查订单"}' \
  --no-buffer

# 中断恢复
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "13800138000", "eventId": "...", "interruptType": 0}' \
  --no-buffer
```

### 端到端测试

1. 发送 "查订单" → 工作流追问
2. 输入手机号 → 工作流返回订单列表
3. 验证多个订单显示为多个气泡

## 文档

- [DESIGN.md](./DESIGN.md) - 设计语言：颜色、字体、圆角、阴影规范
- [AGENTS.md](./AGENTS.md) - 工程指南：架构、API、测试、部署

## 环境要求

- Node.js >= 18
- pnpm >= 8
- Coze 工作流 ID（已发布）
- Coze Personal Access Token

## 部署

### 环境变量

部署时需设置：

- `COZE_PAT`: Coze 个人访问令牌
- `COZE_WORKFLOW_ID`: 工作流 ID
- `DEPLOY_RUN_PORT`: (可选) 服务端口，默认 3000

### 构建命令

```bash
pnpm install
pnpm build
```

### 启动命令

```bash
pnpm start
```

## 常见问题

**Q: 工作流返回 401**  
A: 检查 `.env.local` 中的 `COZE_PAT` 是否正确

**Q: 端口被占用**  
A: 设置 `DEPLOY_RUN_PORT` 环境变量

**Q: Hydration 错误**  
A: 确保动态内容使用 `useEffect + useState` 客户端守卫

**Q: 样式不生效**  
A: 检查是否使用 CSS 变量而非硬编码值

## License

MIT

## 作者

通用网页搭建专家
