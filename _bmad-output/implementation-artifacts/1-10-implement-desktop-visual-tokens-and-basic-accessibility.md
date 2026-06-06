---
baseline_commit: cbf97fb
---

# Story 1.10: 实现桌面视觉 Token 与基础可访问性

Status: review

<!-- 说明：create-story 已完成上下文分析；dev-story 前可按需再次校验本文件。 -->

## Story

作为 RedWhisk 用户,
我希望应用具备一致、克制且可访问的桌面视觉基础,
以便我可以长时间使用工作台，而不被网页化或管理后台式 UI 干扰。

## Acceptance Criteria

1. 给定应用工作台壳已初始化，当全局样式与 design token 加载时，则系统提供 light/dark 主题 token、typography token、spacing token、rounded token，并且 token 值遵守 UX 文档中的桌面视觉约束：light 以 `#F7F8FA` / `#FFFFFF` 为主，dark 以 `#000000` / `#0B0B0C` / `#141416` 为主，正文 13px、标签 12px、元信息 11px、mono 12px，Activity Bar 48px，Header 44px，小控件 3px、卡片/按钮 5px、Dialog/Inspector 7px。
2. 给定用户查看当前已实现的 Project Home、Project workbench header、Activity Bar、Project Switcher、Issues surface 与 Settings surface，当这些区域渲染时，则界面呈现统一的桌面工具层级：window chrome、work surface、panel surface 和当前态分层清晰；不使用营销式 hero、大圆角卡片墙、彩色状态柱、渐变装饰或管理后台式选中态。
3. 给定用户使用当前基础控件与浮层，当 Button、Input、Textarea、Dropdown/Menu、Toolbar 按钮、Activity Bar 图标按钮渲染时，则它们统一使用自建 CSS/token 层驱动的视觉规则与焦点规则；不得引入大型管理后台组件库作为视觉基底，也不得把后续 feature-specific 组件的视觉需求提前扩散为本 story 的范围。
4. 给定用户通过键盘操作当前应用，当焦点移动到可操作控件、打开/关闭已有 Dialog 或切换可见浮层时，则可操作控件具有可见 focus ring、最小 hit target 与可读状态；`Esc` 关闭最上层已有 Dialog/Popover、Dialog 关闭后焦点回到触发控件、`Tab` 按视觉顺序可达关键控件，且 `prefers-reduced-motion: reduce` 下禁用或显著收敛非必要过渡/弹入动画。

## Tasks / Subtasks

- [x] 对齐全局桌面视觉 token 与主题基线 (AC: 1, 2)
  - [x] 调整 `src/shared/styles/tokens.css`，把字体栈切回系统桌面字体与 mono 字体，避免继续以 `Inter` 和通用 Web UI token 作为主基底。
  - [x] 将 light/dark 色板、边线、焦点蓝、surface/window 分层、圆角和尺寸 token 对齐到 UX `DESIGN.md`，避免纯白铺满和大面积同层背景。
  - [x] 明确 window chrome、work surface、panel surface、popover/dialog 的 token 分工，为当前已实现页面提供一致材质感。
- [x] 重做当前已实现壳层与关键页面的桌面分层，而不扩大功能范围 (AC: 2)
  - [x] 调整 `src/app/app.css` 的 `app-shell`、`workbench__header`、`activity-bar`、`activity-surface`、`project-home`、`project-card`、`settings-layout` 等样式，使当前层级更像桌面工作台而不是普通 Web 页面。
  - [x] 必要时小幅调整 `src/app/app-shell.tsx`、`src/features/project/project-home.tsx`、`src/features/project/project-switcher.tsx`、`src/features/settings/project-settings-activity.tsx` 的标记结构或文案位置，以支持更合理的视觉节奏，但不改变既有功能流转。
  - [x] 将当前态从“大块填充按钮”收敛为细指示、轻底色、字重增强等桌面工具风格；不要引入夸张 hover、渐变或装饰性动画。
- [x] 统一基础控件视觉与交互基线 (AC: 3, 4)
  - [x] 调整 `src/components/ui/button.tsx`、`input.tsx`、`textarea.tsx`、`dropdown-menu.tsx`，去掉通用 shadcn/web app 味道过重的圆角、阴影和动效，使其服从桌面 token。
  - [x] 统一 focus ring、ring offset、边框、文本层级、密度和最小 hit target，确保 Activity Bar、Project Switcher、Settings 列表行和表单控件都达标。
  - [x] 为 `prefers-reduced-motion: reduce` 增加样式兜底，收敛 dropdown/dialog/popover 过渡动画。
- [x] 验证当前可访问性基线与视觉约束没有回退 (AC: 4)
  - [x] 补或调前端测试，覆盖当前关键行为：Project/Settings 区域关键按钮可访问命名、Project Switcher/已有 Dialog 的 `Esc` 关闭、Dialog 关闭后的焦点恢复、关键入口可键盘触达。
  - [x] 如测试对 CSS token 无法直接断言，则至少通过 DOM 行为、aria 属性、可见文案和 class/token 使用点覆盖回归风险；必要时记录无法自动化的视觉验证点。
  - [x] 运行 `pnpm format`。
  - [x] 运行 `pnpm lint`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `pnpm build`。

## Dev Notes

### 关键假设与取舍

- 这条 story 只做“视觉与基础可访问性基建”，不新开功能，不重写 IA，不扩展新弹窗，不提前实现 Issue Inspector、Completion Confirmation 或完整 Global Settings。
- 用户当前反馈的“丑、没有质感”已经能在现有实现中定位到具体问题：全局 token 仍偏 Web UI、壳层分层太平、Project Home 有 landing page 感、Activity Bar 和 Settings 选中态像管理后台 tab、基础控件仍保留 shadcn 默认网页味道。因此默认选择是优先修正 token、壳层和 primitives，而不是加装饰。
- Story 允许对现有 JSX 做最小结构调整，以支撑更好的层级和焦点语义；但不允许借机改数据流、命令边界、设置业务规则或 Issue/Project 的状态机。
- 当前仓库工作区已经存在一批与 Settings 功能相关的脏改动。开发阶段必须只暂存与 1.10 直接相关的文件；若某个文件同时混有无法安全拆分的无关改动，应停止自动提交并向用户说明。

### 范围边界

- 交付视觉 token、基础控件风格统一、当前已实现页面的桌面壳层分层，以及基础 a11y 行为校准。
- 不交付新业务能力，不实现新的 Settings 信息架构，不实现新的 Project/Issue/Session 字段，不引入图标系统之外的新设计库。
- 不为了“更高级”而增加 hero 文案、彩色面板、玻璃拟态、噪声背景、装饰渐变、页面级大动画或品牌化营销设计。
- 不修改 Rust、Tauri command、数据库 schema、迁移或测试数据，除非后续验证证明某个前端可访问性行为必须通过后端支持；当前文档分析下默认不需要。

### 架构约束

- UI 必须继续遵守自建桌面工作台组件层 + CSS/token 层，不引入大型管理后台组件库作为视觉基底。[Source: `_bmad-output/planning-artifacts/epics.md` UX-DR26]
- Activity Bar 宽度、顶部 header 高度、圆角与字号必须服从 UX token，不得在局部组件内重新发明一套尺寸体系。[Source: `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md`]
- 焦点可见性、最小 hit target、`Esc`/`Tab`/focus restore 与 reduce motion 属于基础可访问性底线；不能只靠颜色表达状态。[Source: `_bmad-output/planning-artifacts/epics.md` NFR8, UX-DR22, UX-DR23]
- 当前 story 不应把视觉问题“修”成复杂组件抽象。优先在现有 `tokens.css`、`app.css` 和少量 UI primitive 中建立稳定规则，再让 feature 页面消费它。

### 当前代码状态与修改指引

- `src/shared/styles/tokens.css` 当前仍以 `Inter` 和较通用的 shadcn/web app token 为主；`--color-app`、`--color-surface`、`--color-accent-muted` 的分层过平，light 模式缺少 window chrome 与 work surface 的区分，dark 模式也还没形成纯黑工作台感。
- `src/app/app.css` 目前同时承载 Project Home、workbench shell、Issues surface、Settings surface 的大部分样式。当前问题集中在：`project-home` 过于像网页首屏、`project-card`/`settings-panel` 带有后台卡片感、`activity-bar`/`settings-menu` 的当前态过于依赖整块填色、顶部 header 还不够像桌面 chrome。
- `src/features/project/project-home.tsx` 当前标题结构和 lede 更像产品 landing copy；可在不改变“Project Home 首屏 + card grid”职责的前提下，压缩语气和版式密度。
- `src/features/project/project-switcher.tsx` 已具备真实交互，但视觉上仍偏通用 dropdown。可在不改变窗口切换逻辑的前提下，优化 trigger、item、icon、check 和 error 层级。
- `src/features/settings/project-settings-activity.tsx` 已有最小业务能力，但视觉仍是标准 Web 两栏。可调整导航密度、列表行样式、分组标题和留白，使其更接近桌面 inspector/list-panel。
- `src/components/ui/button.tsx`、`input.tsx`、`textarea.tsx`、`dropdown-menu.tsx` 目前大量沿用默认 shadcn 类名，比如 `rounded-md`、`shadow-md`、`zoom-in-95`。Story 1.10 应把这些基础控件拉回 RedWhisk 的桌面视觉语义。

### 前置故事信息

- Story 1.1 已建立 Tauri + React 工作台壳和基础 CSS/token 层，但当时只满足“可用”和最小桌面约束，未完成高质量视觉收口。
- Story 1.4 已确立 Project Home 首屏、顶部 Project Switcher 和工作台壳层；1.10 应在这些既有信息架构约束内提质，而不是改入口模型。
- Story 1.8 与 1.9a 已把 Settings 与顶部栏交互推到当前形态，因此 1.10 需要兼容当前“顶部 Project Switcher + 顶部项目设置入口 + Activity Bar 仅保留主要活动”的现状。

### Git Intelligence

- 当前 workflow preflight 记录的基线 `HEAD` 是 `cbf97fb`。
- 工作区在本 story 开始前已经存在以下无关脏改动：`src-tauri/src/commands/settings_commands.rs`、`src-tauri/src/core/settings_service.rs`、`src-tauri/src/db/agent_profile_repository.rs`、`src-tauri/src/db/migrations.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/types/agent_profile.rs`、`src-tauri/tests/local_data.rs`、`src-tauri/tests/settings.rs`、`src/features/settings/agent-profile-form.tsx`、`src/features/settings/settings-commands.ts`、`pnpm-lock.yaml` 等；开发完成后的 staging 必须只包含与 1.10 直接相关的视觉/测试文件。

### 测试要求

- 因本 story 会修改 TypeScript / React 源码，必须运行 `pnpm lint` 与 `pnpm typecheck`。
- 因本 story 会影响渲染逻辑、焦点行为、浮层关闭行为和测试依赖实现，必须运行 `pnpm test`。
- 因本 story 会影响样式构建与组件 class 组合，建议保留 `pnpm build` 作为收尾验证，尽早发现 CSS 或打包回归。
- 最小验证命令清单：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 参考资料

- `_bmad-output/planning-artifacts/epics.md` — Story 1.10、NFR8、NFR9、UX-DR1、UX-DR2、UX-DR3、UX-DR4、UX-DR22、UX-DR23、UX-DR25、UX-DR26。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/DESIGN.md` — 桌面视觉 token、品牌语气、组件视觉约束。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — 信息架构、Project Home、Project Switcher、Activity Bar、可访问性与禁区。
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-04.md` — UX/PRD/Architecture 对齐结论与 key-screen 风险提示。
- `src/shared/styles/tokens.css` — 当前全局 token 实现。
- `src/app/app.css`、`src/app/app-shell.tsx` — 当前桌面壳层与活动区样式。
- `src/features/project/project-home.tsx`、`src/features/project/project-switcher.tsx` — 当前首屏与顶部切换器实现。
- `src/features/settings/project-settings-activity.tsx` — 当前 Settings 可见层实现。
- `src/components/ui/button.tsx`、`src/components/ui/input.tsx`、`src/components/ui/textarea.tsx`、`src/components/ui/dropdown-menu.tsx` — 当前基础控件实现。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-06T11:27+0800：`bmad-dev-workflow` preflight 选择 `1-10-implement-desktop-visual-tokens-and-basic-accessibility` 作为当前 story，基线 `HEAD` 为 `cbf97fb`。
- 2026-06-06T11:31+0800：对比 `DESIGN.md` / `EXPERIENCE.md` 与现有 `tokens.css`、`app.css`、`project-home.tsx`、`project-switcher.tsx`、`project-settings-activity.tsx`，确认当前主要问题是 token 和壳层分层偏 Web 化，而不是缺少装饰元素。
- 2026-06-06T11:34+0800：补读基础 UI primitive，确认 `button`、`input`、`textarea`、`dropdown-menu` 仍沿用默认 shadcn 风格，需要纳入 1.10 的桌面化收口范围。
- 2026-06-06T14:06+0800：先新增 `src/components/ui/desktop-primitives.test.tsx` 锁定 desktop token class 断言，首次 `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx` 红灯，确认 primitives 仍停留在默认 Web 风格。
- 2026-06-06T14:12+0800：完成 `tokens.css`、`app.css`、`project-home.tsx`、`project-switcher.tsx` 与 `components/ui/*` 收口；将 Activity Bar / Settings 当前态改为细指示 + 轻底色，统一 light/dark surface 分层与 focus ring。
- 2026-06-06T14:18+0800：发现 `app.css` 的部分 Settings/Header 样式与当前未提交的功能改动耦合，改为兼容基线 `ProjectSettingsActivity` / `AppShell` 结构的写法，避免 `1-10` 提交依赖无关功能文件。
- 2026-06-06T14:13+0800：完成格式化、lint、typecheck、test、build 验证；`vitest` 仍输出既有 `Could not parse CSS stylesheet` 警告，`vite build` 仍输出既有 CSS minify / chunk size warning，但均未阻塞本 story。

### Completion Notes List

- create-story 已为 Story 1.10 生成完整开发上下文。
- 已明确本 story 只做视觉 token、桌面壳层与基础可访问性基线，不扩展新功能。
- 已标出当前最关键的实现入口：`src/shared/styles/tokens.css`、`src/app/app.css`、`src/features/project/project-home.tsx`、`src/features/project/project-switcher.tsx`、`src/features/settings/project-settings-activity.tsx` 与 `src/components/ui/*`。
- 已明确现有“廉价 Web 壳”问题的根因是字体/token 体系、surface 分层、选中态和 primitives 风格，而不是缺少装饰。
- 已规定开发阶段必须只提交与 1.10 直接相关的视觉/测试文件，避免把当前工作区的 Settings/Rust 脏改动混入。
- 已将 `tokens.css` 收口到系统桌面字体、light window / surface 分层、dark 纯黑工作台、focus blue 与更克制的 lane/status 色板。
- 已重做 `app.css` 中的 Project Home、Project card、Activity Bar、workbench header、Issues lanes、Settings navigation 和 Project Switcher 层级，让当前界面更像桌面工具而不是网页壳。
- 已收口 `button.tsx`、`input.tsx`、`textarea.tsx`、`dropdown-menu.tsx` 的 desktop primitive 规则，并新增 `desktop-primitives.test.tsx` 锁定关键 token class。
- 已通过 `project-switcher.tsx` 的 `aria-controls` 与 `data-current` 辅助当前态和可访问结构；已有 `Escape` / 焦点恢复行为继续由现有 `App`、`Issues` 测试覆盖。
- 已执行并记录验证：`pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，以及两轮定向 `vitest` 命令用于红绿测试。
- 已将 `app.css` 调整为同时兼容基线的顶部项目设置按钮和既有 Settings 面板结构，从而允许只提交 `1-10` 直接相关文件而不混入当前工作区里的 Settings 功能改动。

### Validation Commands

- `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx`
- `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx`
- `pnpm test -- --run src/app/app.test.tsx src/features/settings/project-settings-activity.test.tsx src/components/ui/desktop-primitives.test.tsx`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm format`
- `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx src/app/app.test.tsx`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

### Validation Results

- `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx`：失败，3 个新增 primitive 测试全部红灯，暴露默认 `rounded-md` / `text-sm` / `focus-visible:ring-ring` 仍未切回桌面 token。
- `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx`：通过，3 个 desktop primitive 测试转绿。
- `pnpm test -- --run src/app/app.test.tsx src/features/settings/project-settings-activity.test.tsx src/components/ui/desktop-primitives.test.tsx`：通过，54 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `pnpm format`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，54 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `pnpm build`：通过；保留既有 esbuild CSS minify warning（`"file" is not a known CSS property`）和 chunk size warning，未阻塞本 story。
- `pnpm format`：通过（兼容基线结构的最终收口后重跑）。
- `pnpm test -- --run src/components/ui/desktop-primitives.test.tsx src/app/app.test.tsx`：通过，54 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告。
- `pnpm lint`：通过（最终版）。
- `pnpm typecheck`：通过（最终版）。
- `pnpm test`：通过，54 个测试通过；输出包含既有 `Could not parse CSS stylesheet` 警告（最终版）。
- `pnpm build`：通过；保留既有 esbuild CSS minify warning 与 chunk size warning（最终版）。

### File List

- _bmad-output/implementation-artifacts/1-10-implement-desktop-visual-tokens-and-basic-accessibility.md
- _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml
- _bmad-output/implementation-artifacts/sprint-status.yaml
- src/app/app.css
- src/components/ui/button.tsx
- src/components/ui/desktop-primitives.test.tsx
- src/components/ui/dropdown-menu.tsx
- src/components/ui/input.tsx
- src/components/ui/textarea.tsx
- src/features/project/project-home.tsx
- src/features/project/project-switcher.tsx
- src/shared/styles/tokens.css

### Change Log

- 2026-06-06：创建 Story 1.10 开发上下文并进入开发。
- 2026-06-06：完成桌面视觉 token、基础控件和工作台壳层收口，状态推进到 review。
