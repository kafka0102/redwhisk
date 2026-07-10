---
name: RedWhisk
description: 跨平台桌面 Agent 开发工作台，安静、紧凑、可靠。
colors:
  app-light: "#ffffff"
  surface-light: "#ffffff"
  surface-muted-light: "#eef1f4"
  border-light: "#d9dde3"
  border-strong-light: "#aeb6c2"
  text-light: "#17181a"
  text-muted-light: "#5d6470"
  text-subtle-light: "#7a828e"
  accent-light: "#111111"
  accent-muted-light: "#f0f0f0"
  danger-light: "#b42318"
  app-dark: "#000000"
  surface-dark: "#0b0b0c"
  surface-muted-dark: "#141416"
  border-dark: "#2b2d31"
  border-strong-dark: "#484c54"
  text-dark: "#f2f3f5"
  text-muted-dark: "#a8aeb8"
  text-subtle-dark: "#79808a"
  accent-dark: "#ffffff"
  accent-muted-dark: "#242426"
  lane-running: "#c89000"
  lane-review: "#249447"
  lane-completed: "#1681d9"
  project-blue: "#2563eb"
  project-green: "#16a34a"
  project-violet: "#7c3aed"
  project-slate: "#475569"
  project-lime: "#65a30d"
typography:
  headline:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  body-strong:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.32
    letterSpacing: "0"
  label:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  meta:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0"
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  control: "3px"
  card: "5px"
  dialog: "7px"
  icon: "7px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  xxl: "32px"
  activity-bar-width: "48px"
  workbench-header-height: "40px"
  project-grid-max: "980px"
  project-switcher-width: "600px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.app-light}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
    height: "30px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
    height: "30px"
    typography: "{typography.body}"
  issue-card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.card}"
    padding: "10px"
    typography: "{typography.body}"
  project-card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.card}"
    padding: "14px"
    typography: "{typography.body}"
  activity-bar-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted-light}"
    rounded: "{rounded.control}"
    width: "40px"
    height: "40px"
  dialog:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.dialog}"
    width: "820px"
---

# Design System: RedWhisk

## 1. Overview

**Creative North Star: "The Local Workbench"**

RedWhisk 应该像一个精确的本地 Agent 开发工作台：安静的窗口 chrome、紧凑的面板、清晰的边线，以及不会打断 Codex Session 的控件。视觉系统服务的是任务可信度，不是品牌表演；用户应该能直接判断自己正在操作哪个 Project、Issue、Session、状态和动作。

界面默认克制。Light 模式使用白色和冷灰，Dark 模式使用真黑和细微色阶；颜色只有在承载状态、焦点或 Project 识别时才出现。系统明确拒绝营销页面、Web SaaS dashboard、项目管理后台、彩色阶段柱看板、KPI 式统计页面和过度设计的 AI Chat UI。

**Key Characteristics:**

- 桌面优先的面板结构：固定 chrome、hairline border、紧凑控件。
- 黑、白、灰是默认语法；状态色必须小而明确。
- 13px body scale 的系统字体，不使用 display type 或 fluid heading。
- 状态可信优先于愉悦感：focus、error、attention、missing path、disabled action 都必须清楚、事实化。

## 2. Colors

RedWhisk 的色彩系统是克制的工作台色彩：先建立中性结构，再用少量状态色帮助用户判断。

### Primary

- **Workbench Ink** (`accent-light` / `accent-dark`): 用于选中的 Issue Card、primary button、当前 Project check 和图标强调。Light 模式为黑色，Dark 模式为白色。

### Secondary

- **Project Identity Set** (`project-blue`, `project-green`, `project-violet`, `project-slate`, `project-lime`): Project Switcher icon 的稳定背景色。它们只用于识别本地 Project，不能扩展成全局装饰色板。

### Tertiary

- **Lane State Markers** (`lane-running`, `lane-review`, `lane-completed`): Issue lane 的小点和最小状态提示。只用作 marker，不要铺满整张卡片或做宽色条。

### Neutral

- **App White / App Black** (`app-light`, `app-dark`): 根窗口背景。
- **Workbench Surface** (`surface-light`, `surface-dark`): 主面板、卡片、dialog、input 和 popover。
- **Muted Surface** (`surface-muted-light`, `surface-muted-dark`): hover 和 selected 背景。
- **Hairline Border** (`border-light`, `border-dark`): 默认面板、卡片和控件分隔线。
- **Strong Border** (`border-strong-light`, `border-strong-dark`): dialog、popover 和固定状态提示。
- **Primary Text** (`text-light`, `text-dark`): 标题、label、Issue title 和 button copy。
- **Muted Text** (`text-muted-light`, `text-muted-dark`): repo path、timestamp、metadata、empty state 和辅助文案。
- **Subtle Text** (`text-subtle-light`, `text-subtle-dark`): 只用于最低优先级 label。

### Named Rules

**The Rarity Rule.** 颜色必须稀缺。如果用户先感受到“这个屏幕很彩色”，再去读 label，说明颜色已经从状态语言滑成了装饰。

**The No Stripe Rule.** 不要在 card、lane、callout 或 alert 上使用彩色 `border-left` / `border-right` 作为强调。使用完整边框、小点、文本或小图标。

## 3. Typography

**Display Font:** 无。
**Body Font:** Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif。
**Label/Mono Font:** "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace。

**Character:** 字体系统紧凑、系统化、事实化。它应该像本地开发工具，而不是 landing page 或 editorial surface。

### Hierarchy

- **Headline** (650, 22px, 1.2): 只用于 Project Home title。慎用。
- **Title** (650, 16px, 1.25): activity 级标题，例如 Issues。
- **Body Strong** (650, 13px, 1.32): Project name、Issue title、dialog title 和 selected item label。
- **Body** (400, 13px, 1.45): 默认 UI copy、button label、input 和 panel text。
- **Label** (600, 12px, 1.35): field label、section label 和小型 panel header。
- **Meta** (400, 11px, 1.35): timestamp、count、status text 和紧凑 Activity Bar label。
- **Mono** (400, 12px, 1.45): repo path、command、log、hash 和 file path。

### Named Rules

**The No Display Rule.** RedWhisk 没有 hero type。不要引入 display font、clamp-based heading、负 letter spacing 或营销式大标题。

**The Zero Tracking Rule.** `letter-spacing` 保持 `0`。uppercase 只允许用于现有紧凑 RedWhisk eyebrow 和短 label。

## 4. Elevation

深度是结构性的，不是装饰性的。默认系统是 flat：panel、card、lane、input 和 navigation 依靠 surface tone 与 1px hairline border 分隔。Shadow 只用于必须悬浮在 workbench 之上的临时 overlay，例如 dialog 和 Project Switcher popover。

### Shadow Vocabulary

- **Focus Ring** (`0 0 0 2px #ffffff, 0 0 0 4px #111111` in light mode; inverted in dark mode): button 和 field 的键盘焦点。
- **Popover Lift** (`0 8px 22px rgb(15 23 42 / 12%)`): 只用于 Project Switcher popover。
- **Dialog Lift** (`0 18px 50px rgb(15 23 42 / 16%)`): 只用于 modal dialog。

### Named Rules

**The Flat Workbench Rule.** 普通 surface 在静止状态下是 flat。如果一个普通 card 需要 shadow 才像可点击，说明 border、background 或 affordance 错了。

**The Overlay-Only Shadow Rule.** Shadow 属于 dialog 和 popover，不属于 Issue Card、Project Card、lane 或 empty state。

## 5. Components

### Buttons

- **Shape:** 紧凑的方形控件，3px radius。
- **Primary:** Light 模式黑底白字，Dark 模式白底黑字。只用于当前最强动作。
- **Secondary:** surface 背景、1px border、primary text。用于 Cancel、中性动作和被禁用的后续 workflow button。
- **Hover / Focus:** hover 改变 border strength 和 muted surface；focus 使用全局 focus ring。Disabled 使用 `opacity: 0.65` 和 `cursor: not-allowed`。

### Chips

RedWhisk 目前没有可复用 chip。后续如需引入，它必须是带文本或 accessible label 的小型状态标记，不能变成彩色胶囊墙。

### Cards / Containers

- **Corner Style:** Project Card、Issue Card、lane、empty state 和 status panel 使用 5px radius。
- **Background:** card 使用 workbench surface，不使用 gradient 或 glass。
- **Shadow Strategy:** card 不使用 shadow。使用 1px border 和 hover surface shift。
- **Border:** 默认 hairline border；strong border 只用于 elevated 或 blocking surface。
- **Internal Padding:** Project Card 使用 14px；Issue Card 使用 10px；empty state 使用 16px。

### Inputs / Fields

- **Style:** 3px radius、1px hairline border、surface background、13px text。
- **Focus:** 使用全局 focus ring。不要替换成只有灰色的弱 outline。
- **Error / Disabled:** error text 使用 danger role，并且必须保留文字；disabled field 可以降低 opacity，但不能隐藏 label。

### Navigation

Activity Bar 是 48px 固定 rail，包含 40px hit target 和 lucide icon。Active state 使用 muted surface 与 active ink，不使用彩色大块。Project Switcher 是 top chrome 中的紧凑文本按钮；popover 最大宽度 600px，item 高 72px，包含 40px 稳定色 Project icon、mono path 和当前 Project check。

### Dialog

Dialog 是居中的受限工作面，7px radius、strong border、固定 header/footer，只使用足够把它从 dimmed app 中分离出来的 shadow。Issue Dialog 在桌面使用双栏 body，低于 640px 时将 side panel 折到 editor 下方。

### Issue Kanban

Issue lane 是常驻列，使用细微 tint background 和小型 status dot。Issue Card 只展示 meta row 和 title。除非后续 story 明确增加字段，不要加入 priority、assignee、metrics 或项目管理 SaaS 式视觉密度。

## 6. Do's and Don'ts

### Do:

- **Do** 使用黑、白、灰、边线和紧凑 spacing，让界面像桌面开发工具。
- **Do** 只把颜色用于 focus、attention、success、danger、Project identity 或 lane state。
- **Do** 在实现 Agent workflow 时保留结构化消息流与 composer 作为主工作面。
- **Do** 一致使用 lucide icon，并给 Activity Bar 40px target 和事实化 accessible label。
- **Do** 让状态文本化：missing path、error、attention、crashed、stopped、no commit detected 和 completed 不能只靠颜色表达。
- **Do** 让 Project、Issue、Agent Session、Project Settings 和 Global Settings 在视觉上保持清楚边界。

### Don't:

- **Don't** 把 RedWhisk 做成营销页面、Web SaaS dashboard、项目管理后台、彩色阶段柱看板、KPI 式统计页面或过度设计的 AI Chat UI。
- **Don't** 使用大圆角卡片墙、渐变装饰、网页 section、hero 文案、彩色状态胶囊墙、hover-only 关键操作、拖拽作为主路径、庆祝动画或把 Codex CLI 重做成单独聊天框。
- **Don't** 引入 side-stripe border、gradient text、glassmorphism、diagonal stripe background、ghost-card shadow 或 nested card。
- **Don't** 给普通 Project Card、Issue Card、lane 或 empty state 添加 card shadow。
- **Don't** 通过放大字体或拉大 spacing 制造虚假的高级感；密度是产品能力的一部分。
- **Don't** 使用 blue-black gradient、purple-blue theme、neon accent 或装饰性的 inactive full-saturation state。
