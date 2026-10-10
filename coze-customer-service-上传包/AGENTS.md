# 工程指南 (Engineering Guide)

## 项目概述

基于 Coze 工作流的智能客服对话网站，支持流式响应、中断恢复、多气泡渲染。

**服务名**: 通用网页搭建专家  
**技术栈**: Next.js 14 + TypeScript + Tailwind CSS  
**包管理器**: pnpm (仅允许 pnpm，禁止 npm/yarn)

## 环境配置

### 环境变量

创建 `.env.local` 文件（已被 `.gitignore` 忽略）：

```bash
COZE_PAT=your_coze_personal_access_token
COZE_WORKFLOW_ID=your_workflow_id
```

### 端口配置

**重要**: 禁止硬编码端口号，必须从环境变量读取：

```json
// package.json
{
  "scripts": {
    "dev": "next dev -p ${DEPLOY_RUN_PORT:-3000}",
    "start": "next start -p ${DEPLOY_RUN_PORT:-3000}"
  }
}
```

读取方式：`process.env.DEPLOY_RUN_PORT`，默认回退到 3000。

## Coze 工作流接口

### API 端点

1. **首次调用 (stream_run)**
   ```
   POST https://api.coze.cn/v1/workflow/stream_run
   ```
   
   请求体：
   ```json
   {
     "workflow_id": "7653451845825724450",
     "parameters": {
       "user_input": "用户消息"
     }
   }
   ```

2. **中断恢复 (stream_resume)**
   ```
   POST https://api.coze.cn/v1/workflow/stream_resume
   ```
   
   请求体：
   ```json
   {
     "workflow_id": "7653451845825724450",
     "event_id": "从 Interrupt 事件获取",
     "interrupt_type": 0,
     "resume_data": "用户回答"
   }
   ```

### SSE 事件类型

工作流返回的 SSE 事件：

| 事件类型 | 描述 | 处理方式 |
|---------|------|---------|
| `Message` | 节点输出内容 | 按 `node_title` + `loop_index` 分组显示 |
| `Interrupt` | 工作流追问 | 记录 `event_id` + `interrupt_type`，下次请求时使用 |
| `Done` | 工作流结束 | 停止流式读取 |
| `Error` | 错误信息 | 显示错误气泡 |

## 架构设计

### 后端 API (`src/app/api/chat/route.ts`)

**核心职责**:
1. 根据请求中是否包含 `eventId` 路由到不同端点
2. 透传 Coze SSE 响应到前端友好格式
3. 错误处理和日志记录

**流程**:
```
前端请求 → 判断 eventId
           ├─ 有: stream_resume
           └─ 无: stream_run
           ↓
        Coze API SSE 流
           ↓
        逐行解析 data: 事件
           ↓
        封装为 {type, event} 格式
           ↓
        透传到前端
```

**数据格式**:
```typescript
// 输出格式
{ type: 'coze_event', event: CozeEventData }
{ type: 'done' }
{ type: 'error', error: string }
```

### 前端组件 (`src/components/chat/chat-window.tsx`)

**核心状态**:
```typescript
messages: Message[]           // 对话历史
input: string                 // 当前输入
isLoading: boolean            // 加载状态
pendingResume: {              // 待恢复的中断
  eventId: string
  interruptType: number
} | null
```

**流式渲染流程**:
```
用户发送消息
  ↓
fetch /api/chat
  ↓
body.getReader() 逐 chunk 读取
  ↓
按行解析 JSON
  ↓
根据事件类型处理:
  - Message: 更新/创建对应气泡
  - Interrupt: 设置 pendingResume
  - Error: 显示错误
  ↓
实时更新 UI
```

**多气泡分组逻辑**:
```typescript
// 工作流可能循环输出多个结果
const key = `${nodeTitle}_${loopIndex}`

// 相同 key 追加内容，不同 key 创建新气泡
if (existingIndex >= 0) {
  assistantMessages[existingIndex].content += content
} else {
  assistantMessages.push({ role: 'assistant', content, nodeTitle, loopIndex })
}
```

**Interrupt 处理**:
1. 收到 Interrupt 事件时记录 `eventId` 和 `interruptType`
2. 显示追问内容
3. 用户回答后，在下次请求中带上这两个字段
4. 后端自动路由到 `stream_resume` 端点

### 未查到 Fallback

**触发条件**:
- 用户输入格式像订单号/手机号（11位或10-20位数字）
- 工作流没有返回包含"订单"关键词的内容
- 没有任何助手消息

**实现**:
```typescript
const looksLikeOrderQuery = /^\d{11}$/.test(userMessage) || /^\d{10,20}$/.test(userMessage)
if (looksLikeOrderQuery && !hasOrderResult && assistantMessages.length === 0) {
  // 显示 fallback 消息
}
```

## 样式约束

### 禁止硬编码

**❌ 禁止**:
```tsx
<div style={{ color: '#00bcd4' }} />
<div style={{ borderRadius: '12px' }} />
<div className="bg-cyan-500" />
```

**✅ 正确**:
```tsx
<div style={{ color: 'hsl(var(--primary))' }} />
<div style={{ borderRadius: 'var(--radius)' }} />
<div style={{ boxShadow: 'var(--shadow-bento)' }} />
```

### CSS 变量位置

所有设计 token 定义在 `src/app/globals.css`:
- 颜色: `--primary`, `--background`, `--foreground` 等
- 字体: `--font-sans`, `--font-mono`
- 圆角: `--radius`
- 阴影: `--shadow-bento`

## 客户端渲染守卫

### 问题

JSX 中使用 `Math.random()` 或 `Date.now()` 会导致服务端渲染和客户端渲染不一致，触发 hydration 错误。

### 解决方案

**❌ 错误**:
```tsx
<div key={Math.random()}>...</div>
```

**✅ 正确**:
```tsx
const [isMounted, setIsMounted] = useState(false)

useEffect(() => {
  setIsMounted(true)
}, [])

if (!isMounted) {
  return null
}

return <div>...</div>
```

## 开发流程

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
# 默认端口 3000
pnpm dev

# 指定端口
DEPLOY_RUN_PORT=8080 pnpm dev
```

### 类型检查

```bash
pnpm ts-check
```

### Lint 检查

```bash
pnpm lint
```

### 生产构建

```bash
pnpm build
pnpm start
```

## 测试指南

### API 测试

**测试首次调用**:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "查订单"}' \
  --no-buffer
```

**测试中断恢复**:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "13800138000",
    "eventId": "从上次响应获取",
    "interruptType": 0
  }' \
  --no-buffer
```

### 端到端测试

1. 启动开发服务器: `pnpm dev`
2. 打开浏览器: `http://localhost:3000`
3. 测试流程:
   - 发送 "查订单" → 工作流追问
   - 输入手机号 → 工作流返回订单列表
   - 多个订单应显示为多个气泡

## 错误处理

### 网络错误

```typescript
try {
  const response = await fetch('/api/chat', {...})
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
} catch (error) {
  // 显示错误消息
  setMessages(prev => [...prev, {
    role: 'assistant',
    content: `抱歉，发生了错误: ${error.message}`
  }])
}
```

### Coze API 错误

后端捕获并返回友好错误：
```json
{ "type": "error", "error": "工作流调用失败: 500" }
```

### 流解析错误

捕获 JSON.parse 失败，记录日志但不中断流：
```typescript
try {
  const eventData = JSON.parse(dataStr)
} catch (e) {
  console.error('Failed to parse event data:', dataStr, e)
  // 继续处理下一个事件
}
```

## 性能优化

### 流式渲染

- 使用 `ReadableStream` 逐 chunk 处理
- 实时更新 UI，无需等待完整响应
- 减少用户等待时间

### 自动滚动

```typescript
const messagesEndRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [messages])
```

### 防抖输入

当前实现：Enter 发送，可扩展为按钮防抖

## 安全性

### 环境变量保护

- PAT 仅存储在 `.env.local`
- `.env.local` 已加入 `.gitignore`
- 前端代码不包含任何凭证

### API 路由保护

- PAT 仅在服务端使用
- 前端无法直接访问 Coze API
- 所有请求通过 Next.js API 路由中转

## 部署注意事项

### 沙箱环境

- 项目设计用于沙箱环境
- 端口从 `DEPLOY_RUN_PORT` 环境变量读取
- 无需额外配置即可适应不同部署平台

### 环境变量设置

部署时需设置：
- `COZE_PAT`: Coze 个人访问令牌
- `COZE_WORKFLOW_ID`: 工作流 ID
- `DEPLOY_RUN_PORT`: (可选) 服务端口

### 构建输出

```bash
pnpm build
# 输出到 .next 目录
pnpm start
```

## 常见问题

### Q: 端口被占用
A: 设置 `DEPLOY_RUN_PORT` 环境变量到其他端口

### Q: 工作流返回 401
A: 检查 `.env.local` 中的 `COZE_PAT` 是否正确

### Q: 消息不显示
A: 检查工作流是否返回 `Message` 事件，查看浏览器控制台日志

### Q: Hydration 错误
A: 确保所有动态内容使用 `useEffect + useState` 客户端守卫

### Q: 样式不生效
A: 确认使用 CSS 变量而非硬编码值，检查 `globals.css` 是否被导入

## 扩展点

### 添加新功能

1. **持久化对话**: 使用 localStorage 保存 messages
2. **多会话管理**: 添加会话列表组件
3. **富文本渲染**: 解析 Markdown 格式消息
4. **语音输入**: 集成 Web Speech API
5. **文件上传**: 支持上传图片/文档

### 自定义主题

修改 `src/app/globals.css` 中的 CSS 变量：
```css
:root {
  --primary: 189 94% 43%;  /* 修改为其他颜色 */
  --radius: 1rem;          /* 调整圆角大小 */
}
```

## 代码规范

### TypeScript

- 严格模式启用
- 所有组件使用类型注解
- 避免使用 `any`

### React

- 函数组件 + Hooks
- Props 使用 interface 定义
- 使用 `useEffect` 管理副作用

### 命名规范

- 组件: PascalCase (`ChatWindow`)
- 函数: camelCase (`handleSend`)
- 常量: UPPER_SNAKE_CASE (`COZE_API_BASE`)
- CSS 变量: kebab-case (`--primary-foreground`)

## 维护清单

- [ ] 定期更新依赖: `pnpm update`
- [ ] 运行类型检查: `pnpm ts-check`
- [ ] 运行 Lint: `pnpm lint`
- [ ] 测试关键流程（首次调用、中断恢复）
- [ ] 检查 Coze API 文档更新
- [ ] 审查错误日志
- [ ] 性能监控（响应时间、流式延迟）

## 参考资源

- [Next.js 文档](https://nextjs.org/docs)
- [Coze API 文档](https://www.coze.com/docs)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [TypeScript 文档](https://www.typescriptlang.org/docs)
