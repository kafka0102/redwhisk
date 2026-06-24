# RedWhisk 设计系统指南

## 概述

RedWhisk 的设计理念是**安静、紧凑、可靠**。界面应该像一个精确的本地工作台，而不是一个花哨的营销页面。

## 设计原则

### 1. 黑白灰优先

- 默认使用黑白灰建立结构
- 颜色只在必要时使用（焦点、提示、状态）
- 避免过度使用彩色

### 2. 紧凑但清晰

- 使用 13px 的主体字体
- 合理的间距，不要过度留白
- 信息密度是产品能力的一部分

### 3. 状态清晰可验证

- 所有状态变化都应该有明确的视觉反馈
- 状态不能只通过颜色表达，还要有文字或图标
- 提供可审计的信息

### 4. 不要过度设计

- 避免渐变、阴影、动画等装饰性元素
- 保持界面的功能性和专业性
- 不要做营销页面或 SaaS 仪表盘

## 颜色系统

### 中性色

| Token                   | Light     | Dark      | 用途           |
| ----------------------- | --------- | --------- | -------------- |
| `--color-app`           | `#ffffff` | `#000000` | 应用背景       |
| `--color-surface`       | `#ffffff` | `#0b0b0c` | 面板、卡片背景 |
| `--color-surface-muted` | `#f1f2f4` | `#141416` | Hover 背景     |
| `--color-border`        | `#e3e5e8` | `#272a30` | 默认边框       |
| `--color-border-strong` | `#d1d5db` | `#3a3f47` | 强调边框       |
| `--color-text`          | `#17181a` | `#f5f5f5` | 主要文字       |
| `--color-text-muted`    | `#5f6368` | `#b8bdc7` | 次要文字       |
| `--color-text-subtle`   | `#8a8f98` | `#757b86` | 辅助文字       |

### 强调色

| Token                  | Light     | Dark      | 用途             |
| ---------------------- | --------- | --------- | ---------------- |
| `--color-accent`       | `#111111` | `#ffffff` | 主按钮、选中状态 |
| `--color-accent-muted` | `#e9eaee` | `#24262b` | 强调背景         |

### 状态色

| Token                           | Value     | 用途       |
| ------------------------------- | --------- | ---------- |
| `--color-danger`                | `#b42318` | 错误、危险 |
| `--color-lane-running-marker`   | `#c89000` | 运行中     |
| `--color-lane-review-marker`    | `#249447` | 待审核     |
| `--color-lane-completed-marker` | `#1681d9` | 已完成     |

### 项目标识色

- `#2563eb` - Blue
- `#16a34a` - Green
- `#7c3aed` - Violet
- `#475569` - Slate
- `#65a30d` - Lime

## 字体系统

### 字体层级

| 层级        | 字号 | 字重 | 行高 | 用途                 |
| ----------- | ---- | ---- | ---- | -------------------- |
| Headline    | 22px | 650  | 1.2  | 项目首页标题         |
| Title       | 16px | 650  | 1.25 | 活动级标题           |
| Body Strong | 13px | 650  | 1.32 | 项目名称、Issue 标题 |
| Body        | 13px | 400  | 1.45 | 默认 UI 文字         |
| Label       | 12px | 600  | 1.35 | 字段标签             |
| Meta        | 11px | 400  | 1.35 | 时间戳、计数         |
| Mono        | 12px | 400  | 1.45 | 代码、路径           |

### 字间距

- 始终保持 `letter-spacing: 0`
- 不要使用字间距调整

## 圆角系统

| Token              | 值  | 用途         |
| ------------------ | --- | ------------ |
| `--radius-control` | 3px | 按钮、输入框 |
| `--radius-card`    | 5px | 卡片         |
| `--radius-dialog`  | 7px | 对话框       |
| `--radius-icon`    | 7px | 图标背景     |

## 间距系统

| Token | 值   | 用途     |
| ----- | ---- | -------- |
| xs    | 4px  | 紧凑间距 |
| sm    | 8px  | 小间距   |
| md    | 12px | 中等间距 |
| lg    | 16px | 大间距   |
| xl    | 22px | 超大间距 |
| xxl   | 32px | 特大间距 |

## 阴影系统

| Shadow                   | 用途         |
| ------------------------ | ------------ |
| `--shadow-focus`         | 焦点状态     |
| `--color-popover-shadow` | Popover 悬浮 |
| `--color-dialog-shadow`  | Dialog 悬浮  |

**注意**：普通卡片不使用阴影，只使用边框和背景色区分。

## 组件使用指南

### 使用原则

- 默认使用 `src/components/ui/` 下的 shadcn 组件搭建页面。
- 不为每个页面重新手写按钮、输入框、选择器、菜单、对话框、空态等基础控件样式。
- 当 shadcn 默认元素与 RedWhisk 设计差异不大时，优先接受默认样式，避免为了微小差异新增局部 CSS。
- 当差异影响信息密度、焦点状态、圆角、颜色或可访问性时，优先在 `src/shared/styles/tokens.css`、全局样式或 `src/components/ui/` 组件层统一覆盖，不在 feature 内分散覆盖。

### Button

```tsx
import { Button } from "@/components/ui";

// Primary
<Button>Save</Button>

// Secondary
<Button variant="secondary">Cancel</Button>

// Ghost
<Button variant="ghost">Edit</Button>

// With icon
<Button>
  <Plus size={16} />
  New Issue
</Button>
```

### Input

```tsx
import { Input, Label } from "@/components/ui";

<div>
  <Label htmlFor="title">Title</Label>
  <Input id="title" placeholder="Enter title" />
</div>;
```

### Card

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui";

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Description here</CardDescription>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>;
```

### Badge

```tsx
import { Badge } from "@/components/ui";

<Badge variant="default">Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Danger</Badge>
<Badge className="bg-[rgba(36,148,71,0.1)] text-[var(--color-lane-review-marker)]">
  Review
</Badge>
```

### Layouts

```tsx
import { PageLayout, DialogLayout, SplitLayout, GridLayout } from "@/layouts";

// Page layout
<PageLayout title="My Page" subtitle="Subtitle here">
  Content here
</PageLayout>

// Dialog layout
<DialogLayout title="Dialog Title" onClose={() => {}}>
  Content here
</DialogLayout>

// Split layout
<SplitLayout left={<Sidebar />} right={<MainContent />} />

// Grid layout
<GridLayout gap="12px">
  <Card>...</Card>
  <Card>...</Card>
</GridLayout>
```

## 禁止事项

⚠️ **不要使用**：

- 渐变背景或文字
- 装饰性阴影（卡片阴影）
- 彩色边框作为强调
- 大圆角（>7px）
- 显示字体或超大标题
- 过度动画
- 玻璃态效果
- 营销页面风格的设计

✅ **应该使用**：

- 扁平的卡片和面板
- 1px 边框作为分隔
- 紧凑的间距
- 黑白灰为主
- 状态变化有明确反馈

## 可访问性

- 所有按钮都有 `aria-label`
- Dialog 有正确的 `role="dialog"` 和 `aria-modal`
- Focus 状态清晰可见
- 状态不只用颜色表达
- 支持 `prefers-reduced-motion`

## 开发工作流

1. 先看 DESIGN.md 了解设计理念
2. 使用设计系统展示页面查看组件效果
3. 使用布局模板快速搭建页面
4. 从 @/components/ui 导入组件
5. 从 @/layouts 导入布局

## 相关文件

- [DESIGN.md](../../DESIGN.md) - 完整设计系统文档
- [PRODUCT.md](../../PRODUCT.md) - 产品文档
- [AGENTS.md](../../AGENTS.md) - 开发规范
