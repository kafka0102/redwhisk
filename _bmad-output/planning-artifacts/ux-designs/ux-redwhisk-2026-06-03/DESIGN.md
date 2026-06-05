---
name: RedWhisk
status: final
description: 跨平台桌面 Agent 开发工作台。简洁、清新、克制，有桌面软件质感；light 参考 Multica，dark 参考 VS Code / Trae。
sources:
  - {planning_artifacts}/prds/prd-redwhisk-2026-06-03/prd.md
  - {planning_artifacts}/prds/prd-redwhisk-2026-06-03/addendum.md
updated: 2026-06-03
colors:
  light-window: '#F7F8FA'
  light-surface: '#FFFFFF'
  light-surface-subtle: '#F1F2F4'
  light-surface-elevated: '#FFFFFF'
  light-ink: '#111111'
  light-ink-muted: '#5F6368'
  light-ink-subtle: '#8A8F98'
  light-border: '#E3E5E8'
  light-border-strong: '#D1D5DB'
  light-active: '#111111'
  light-selection: '#E9EAEE'
  dark-window: '#000000'
  dark-surface: '#0B0B0C'
  dark-surface-subtle: '#141416'
  dark-surface-elevated: '#1B1C1F'
  dark-ink: '#F5F5F5'
  dark-ink-muted: '#B8BDC7'
  dark-ink-subtle: '#757B86'
  dark-border: '#272A30'
  dark-border-strong: '#3A3F47'
  dark-active: '#FFFFFF'
  dark-selection: '#24262B'
  accent-blue: '#4D84FF'
  accent-blue-dark: '#6EA0FF'
  attention: '#D97706'
  attention-dark: '#F5A524'
  success: '#22863A'
  success-dark: '#4ADE80'
  danger: '#B42318'
  danger-dark: '#F87171'
typography:
  app-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif'
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: '0'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.45'
    letterSpacing: '0'
  body-strong:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.45'
    letterSpacing: '0'
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.35'
    letterSpacing: '0'
  meta:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.35'
    letterSpacing: '0'
  mono:
    fontFamily: '"SF Mono", "Cascadia Mono", "JetBrains Mono", Consolas, monospace'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.45'
    letterSpacing: '0'
rounded:
  none: 0px
  sm: 3px
  md: 5px
  lg: 7px
  xl: 9px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  activity-bar-width: 48px
  sidebar-width: 280px
  inspector-width: 360px
  header-height: 44px
components:
  activity-bar:
    background-light: '{colors.light-window}'
    background-dark: '{colors.dark-window}'
    active-indicator-light: '{colors.light-active}'
    active-indicator-dark: '{colors.dark-active}'
    width: '{spacing.activity-bar-width}'
  sidebar:
    background-light: '{colors.light-window}'
    background-dark: '{colors.dark-surface}'
    border-light: '{colors.light-border}'
    border-dark: '{colors.dark-border}'
    width: '{spacing.sidebar-width}'
  workbench-surface:
    background-light: '{colors.light-surface}'
    background-dark: '{colors.dark-window}'
  issue-card:
    background-light: '{colors.light-surface}'
    background-dark: '{colors.dark-surface-subtle}'
    border-light: '{colors.light-border}'
    border-dark: '{colors.dark-border}'
    radius: '{rounded.md}'
  dialog:
    background-light: '{colors.light-surface-elevated}'
    background-dark: '{colors.dark-surface-elevated}'
    border-light: '{colors.light-border-strong}'
    border-dark: '{colors.dark-border-strong}'
    radius: '{rounded.lg}'
  inspector:
    background-light: '{colors.light-surface}'
    background-dark: '{colors.dark-surface}'
    width: '{spacing.inspector-width}'
  primary-button:
    background-light: '{colors.light-active}'
    foreground-light: '#FFFFFF'
    background-dark: '{colors.dark-active}'
    foreground-dark: '#000000'
    radius: '{rounded.md}'
  terminal:
    background-light: '#FFFFFF'
    foreground-light: '#111111'
    background-dark: '#000000'
    foreground-dark: '#F5F5F5'
    font: '{typography.mono.fontFamily}'
---

## Brand & Style

RedWhisk 是一个桌面开发工作台，不是项目管理 SaaS。视觉语气应该像一款认真打磨过的本地工具：安静、紧凑、清爽、可靠。它可以被长时间盯着使用，不能像营销页面，也不能像廉价网页应用套壳。

Light 模式参考 Multica 的黑白灰克制感：白色和浅灰作为主要表面，黑色文字提供清晰结构，颜色只在必要状态上出现。Dark 模式参考 VS Code / Trae 的纯黑开发环境：黑色是真正的工作台背景，面板通过细微色阶和边线区分，而不是靠大面积彩色或阴影。

整体禁止“管理后台感”：不要大圆角卡片墙、不要彩色状态柱、不要渐变装饰、不要 KPI dashboard 语言。RedWhisk 的质感来自窗口结构、边线、密度、对齐、键盘友好和状态可信。

## Colors

RedWhisk 的基础色是黑、白、灰。色彩只用于焦点、attention、成功和危险，不用于装饰。

- **Light window (`#F7F8FA`)** 是 light 模式外层窗口与 Activity Bar / Sidebar 的底色。它比纯白略冷，避免网页白屏感。
- **Light surface (`#FFFFFF`)** 是主工作区、弹窗和输入区域底色。白色只给可工作区域，不铺满所有 chrome。
- **Dark window (`#000000`)** 是 dark 模式的根背景，也是 Codex Native Session View 周围的基底。
- **Dark surface (`#0B0B0C` / `#141416`)** 用于 Sidebar、列表和轻微分层。dark 模式不使用蓝黑大面积底色，避免普通 SaaS 暗色主题感。
- **Ink tokens** 控制文本层级。Primary 只用于正文与关键标题；muted 用于元信息；subtle 用于时间、辅助标签和低优先级提示。
- **Accent Blue (`#4D84FF` / `#6EA0FF`)** 只用于焦点、可导航链接、键盘 focus ring 和当前选中项的细线强调。不要把它用于大面积按钮填充。
- **Attention** 表示用户需要回到 Session。它可以出现在小点、标记和行内提示上，不能变成整张卡片的背景。
- **Success / Danger** 只用于完成、错误、危险操作和 Git 异常，不参与普通状态色彩编码。

## Typography

使用平台系统字体。macOS 上优先 SF Pro，Windows 上回落 Segoe UI。终端、命令、路径、commit hash 和日志片段使用 mono token。

字号整体保持桌面工具密度：正文 13px，标签 12px，元信息 11px。不要使用 hero-scale 标题，不要用大字号制造“高级感”。层级通过位置、字重、边线和留白表达。

所有 `letterSpacing` 保持 0。不要使用负字距；长英文路径和命令通过 mono 字体、截断和 tooltip 处理。

## Layout & Spacing

布局以桌面窗口为基准。Activity Bar 固定 48px；左侧列表栏默认 280px；Session Header 44px；Issue Inspector 默认 360px。Project Switcher 位于窗口顶部 chrome，和系统关闭/最小化/缩放控件同一行；它占用标题区域左侧到中部的紧凑宽度，不能把内容区顶出一个重复 header。主工作区应铺满窗口，不把核心体验放进浮动卡片。

间距采用 4px 基础尺度。列表和工具栏密度高，主内容区域留出足够呼吸。面板之间优先使用 1px hairline border，而不是投影或卡片阴影。

RedWhisk 应该感觉是桌面应用：窗口 chrome、面板边界、Inspector、Dialog、Toolbar 和 Status 行要有明确对象感。不要把页面分成一段段网页 section，也不要使用营销站式中心窄列布局。

## Elevation & Depth

深度主要靠色阶和边线，不靠阴影。Light 模式中 Dialog 可以使用极轻阴影，但不能让整个界面变成卡片堆叠。Dark 模式中禁止发光阴影；使用 `dark-border` 和 `dark-surface-elevated` 表达层级。

Overlay 只用于 Dialog、Inspector 遮挡关系和全局设置窗口。不要用浮动卡片表达普通列表项。

## Shapes

桌面工具的形状应该克制。小控件 3px，按钮和卡片 5px，Dialog 和 Inspector 7px。不要使用 12px 以上大圆角；不要用 pill 形状承载普通文本。圆角用于减轻硬度，不用于制造消费 App 感。

Activity Bar 图标按钮可以是方形 hover target，图标本身居中。状态 badge 可以轻微圆角，但不要做成彩色胶囊墙。

## Components

- **Activity Bar** — 48px 固定宽度。Light 使用 `{colors.light-window}`，dark 使用 `{colors.dark-window}`。当前入口用 2px 竖线或细底色表示，不用彩色大块。
- **Project Switcher** — 放在窗口顶部 chrome。折叠态是紧凑文本按钮，显示当前 Project 名称和下拉 affordance；不要显示静态 `RedWhisk` 标题。展开态使用 light surface 浮层、1px 边线和极轻阴影，宽度约 520-620px，item 高度约 72px。每项左侧 40px 方形 icon，半径 7px，文案默认取 Project 名称首字符；icon 背景从固定色板稳定派生，可使用 green、blue、violet、slate、lime 等少量颜色，但不要每次渲染随机变化。中间两行分别是 Project 名称和 repo path，路径使用 muted/mono 风格并截断。当前 Project 的对钩放在 item 最右侧。工作台内容顶部不得再展示 `PROJECT` 标识、Project 名称和 repo path。
- **Sidebar / Session List** — 宽 280px，密度高，行高稳定。选中行使用 selection 色阶；attention 用小点或短标记，不能改变整行底色。
- **Issue Card** — 只用于 Issues 四泳道内的 Issue 项。卡片半径 `{rounded.md}`，1px 边线，少量内边距。不要加阴影，不要放过多字段。
- **Dialog** — Run Dialog、Session Dialog、completion 确认面板使用 `{components.dialog}`。内容以表单和预览为主，底部按钮固定右侧。
- **Issue Inspector** — 右侧详情面板，使用 `{components.inspector}`。它是桌面 Inspector，不是移动 Drawer；打开关闭不影响 xterm。
- **Primary Button** — Light 中黑底白字，dark 中白底黑字。只用于当前最主要动作。完成类危险/可信动作应优先通过确认面板和文案建立信任，不靠醒目颜色。
- **Terminal** — Codex Native Session View 必须像真实终端。Dark 模式背景为纯黑；light 模式背景为白。应用 chrome 不重绘 Codex UI。
- **Status Markers** — `Needs Attention` 使用 attention 色；`completed` / `closed` 使用 muted 或 success 文案；`crashed` 使用 danger。状态标记要小，不要变成彩色看板标签系统。

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| 用黑白灰建立结构，只在必要状态上使用颜色 | 做成多彩 SaaS 看板 |
| 用面板、边线、Inspector 表达桌面软件质感 | 用网页 section、hero、卡片墙表达结构 |
| 保持高密度但清晰的开发工具节奏 | 为了“高级”放大字体和拉大所有间距 |
| 让 Codex Native Session View 保持原生终端感觉 | 重做 Codex 聊天 UI 或加独立输入框 |
| Light 清爽、Dark 纯黑，两者都克制 | 把 dark 做成蓝黑渐变或紫蓝主题 |
| 用确认面板、审计信息和 Git 摘要建立信任 | 用醒目颜色诱导用户自动完成 |
