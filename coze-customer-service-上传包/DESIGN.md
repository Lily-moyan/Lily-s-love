# 设计语言 (Design System)

## 概述
本项目采用现代化的 Cyan 主题设计，专注于提供清晰、专业的智能客服体验。

## 颜色系统

### 主题色 - Cyan
- **Primary**: `hsl(189, 94%, 43%)` - 青色主题，用于主要按钮、标题、交互元素
- **Primary Foreground**: `hsl(0, 0%, 100%)` - 主题色上的文字颜色

### 语义色
- **Background**: `hsl(0, 0%, 100%)` - 页面背景
- **Foreground**: `hsl(240, 10%, 3.9%)` - 主要文字颜色
- **Muted**: `hsl(240, 4.8%, 95.9%)` - 柔和背景色（用于助手消息气泡）
- **Muted Foreground**: `hsl(240, 3.8%, 46.1%)` - 次要文字颜色
- **Border**: `hsl(240, 5.9%, 90%)` - 边框颜色
- **Destructive**: `hsl(0, 84.2%, 60.2%)` - 错误/警告色

## 字体系统

### Business 字体族
- **Sans Serif**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Monospace**: `"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace`

### 使用规范
- 标题使用 `font-bold` + 相应的文字大小
- 正文使用默认字重
- 代码/数据使用等宽字体

## 圆角系统 - Large (lg)

### 统一圆角
- **Radius**: `0.75rem` (12px) - 所有卡片、按钮、输入框使用此圆角值
- 通过 CSS 变量 `var(--radius)` 统一控制

### 应用场景
- 对话窗口容器
- 消息气泡
- 输入框
- 按钮

## 阴影系统 - Bento

### Bento 阴影
```css
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
```

### 特点
- 双层阴影：外层柔和扩散 + 内层细节增强
- 适度的深度感，不过分突出
- 营造悬浮、轻盈的视觉效果

### 使用规范
- 主要应用于聊天窗口容器
- 使用 `shadow-bento` utility class 或 `var(--shadow-bento)`

## 组件规范

### 聊天窗口
- 宽度: `max-w-4xl` (最大 896px)
- 高度: `600px` (固定)
- 背景: `hsl(var(--card))`
- 圆角: `var(--radius)`
- 阴影: `shadow-bento`
- 边框: `1px solid hsl(var(--border))`

### 消息气泡
- 用户消息:
  - 背景: `hsl(var(--primary))` (青色)
  - 文字: `hsl(var(--primary-foreground))` (白色)
  - 位置: 右对齐
- 助手消息:
  - 背景: `hsl(var(--muted))` (浅灰)
  - 文字: `hsl(var(--foreground))` (深色)
  - 位置: 左对齐
- 最大宽度: `80%`
- 内边距: `px-4 py-3`
- 圆角: `var(--radius)`

### 输入区域
- 输入框:
  - 背景: `hsl(var(--input))`
  - 边框: `1px solid hsl(var(--border))`
  - 圆角: `var(--radius)`
  - Focus: `ring-2` (自动使用 primary 色)
- 发送按钮:
  - 背景: `hsl(var(--primary))`
  - 文字: `hsl(var(--primary-foreground))`
  - 圆角: `var(--radius)`
  - 禁用时: `opacity-50`

### 加载状态
- 三点跳动动画
- 颜色: `hsl(var(--muted-foreground))`
- 动画延迟: 0ms, 150ms, 300ms

## 布局规范

### 页面布局
- 最小高度: `min-h-screen`
- 背景渐变: `from-cyan-50 to-blue-50` (浅色模式)
- 容器: `container mx-auto px-4 py-8`

### 响应式设计
- 移动端: 聊天窗口自适应宽度
- 桌面端: 限制最大宽度 `max-w-4xl`
- 所有断点保持统一的 padding 和 spacing

## 交互规范

### 动画
- 滚动: `smooth` behavior
- 过渡: `transition-opacity` 用于禁用状态
- 跳动: `animate-bounce` 用于加载指示器

### 状态反馈
- 禁用状态: `opacity-50` + `disabled` 属性
- 加载状态: 三点动画 + 禁用输入
- 错误状态: 使用 destructive 色系

## 暗色模式支持

### 自动适配
- 所有颜色通过 CSS 变量定义
- `.dark` 类自动切换暗色模式
- 渐变背景自动调整为深色系

### 暗色模式色值
- Background: `hsl(240, 10%, 3.9%)`
- Foreground: `hsl(0, 0%, 98%)`
- Primary: 保持 `hsl(189, 94%, 43%)` (青色主题不变)
- Muted: `hsl(240, 3.7%, 15.9%)`

## 无障碍性 (Accessibility)

### 颜色对比度
- 所有文字与背景对比度符合 WCAG AA 标准
- Primary 色与白色文字对比度 > 4.5:1

### 键盘导航
- 输入框支持 Enter 发送消息
- Shift+Enter 换行（未来扩展）
- 所有交互元素可通过键盘访问

### 语义化 HTML
- 使用语义化标签 (`<main>`, `<header>`)
- 按钮使用 `<button>` 元素
- 输入框包含 `placeholder` 提示

## CSS 变量使用规范

### ✅ 正确做法
```tsx
style={{ backgroundColor: 'hsl(var(--primary))' }}
style={{ borderRadius: 'var(--radius)' }}
className="shadow-bento"
```

### ❌ 禁止做法
```tsx
// 禁止硬编码颜色
style={{ backgroundColor: '#00bcd4' }}

// 禁止硬编码圆角
style={{ borderRadius: '12px' }}

// 禁止硬编码阴影
style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}
```

### 原因
- 统一管理主题
- 支持暗色模式自动切换
- 便于主题定制和维护
- 确保设计一致性
