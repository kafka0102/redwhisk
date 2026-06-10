---
baseline_commit: 7118dc8
---

# Story 6.2: 统一 Settings 页面双栏布局

Status: ready-for-dev

<!-- 说明：本 story 聚焦 Settings 页面外层布局一致性，不扩大 Project Settings / Global Settings 的产品边界。 -->

## Story

作为本地开发者,
我希望 Settings 页面与 Agents 页面保持一致的双栏布局和可调左栏,
以便配置 General 和 Agents 时获得稳定、清晰、可复用的桌面设置体验。

## Acceptance Criteria

1. 给定用户打开 Project 工作台的 Settings Activity，当 Settings 页面渲染时，页面保持左右两栏结构；左侧菜单默认宽度、最小宽度、最大宽度与 Agents Activity 左侧 Session list 保持一致；左栏与右侧内容之间的分割线从页面顶部连续延伸至底部。
2. 给定用户拖动 Settings 左右栏之间的分割线，当指针水平移动时，左侧菜单宽度跟随调整，并遵守与 Agents Activity 一致的宽度上下限；拖动行为、`col-resize` 光标、不可选中文本处理、可访问标签和 keyboard focus 样式参考 Agents Activity 的 splitter 实现。
3. 给定 Settings 当前包含 `General` 和 `Agents` 两个菜单项，当左侧菜单和右侧标题渲染时，每个菜单项和当前页面标题在文字前展示小图标；图标优先使用项目已依赖的 `lucide-react`。
4. 给定用户选中 `General` 或 `Agents`，当菜单项处于当前选中状态时，该菜单项背景色变为灰色或等价的 `var(--color-surface-muted)` 选中底色；选中状态仍通过 `aria-pressed` 或等价语义暴露，不能只依赖颜色表达。
5. 给定用户点击任一 Settings 菜单项，当右侧内容区域切换时，右侧使用统一的 Settings 内容模板，而不是每个模块各自定义外层布局；内容模板顶部显示当前菜单名称，例如 `General` 或 `Agents`；标题下方渲染该菜单对应的具体内容。
6. 给定 Settings 右侧内容区域渲染，当可用内容宽度大于 900px 时，具体内容容器在右侧区域内居中显示，最大宽度固定为 900px。
7. 给定 Settings 右侧内容区域渲染，当可用内容宽度小于 900px 时，具体内容容器宽度为 100%；标题、表单、列表和状态信息不得溢出或与左侧菜单、分割线重叠。
8. 给定后续新增 Settings 模块，当开发者接入新菜单项时，新模块复用同一份 Settings 页面布局约束和菜单配置模式；不新增与该 story 无关的 Settings 字段、Project/Global Settings 数据模型或 Agent Profile 行为。

## Tasks / Subtasks

- [ ] 建立 Settings 页面统一菜单配置与内容模板 (AC: 3, 5, 8)
  - [ ] 在 `src/features/settings/project-settings-activity.tsx` 中用一份菜单配置描述 `General` 和 `Agents` 的 key、label、icon。
  - [ ] 抽出 Settings 右侧统一模板，负责标题、标题图标和 900px 内容容器；具体模块只提供内容。
  - [ ] 保持现有 General 和 `Agents` 业务内容、加载、保存和弹窗行为不变。

- [ ] 对齐 Agents Activity 左栏宽度与 splitter 行为 (AC: 1, 2)
  - [ ] Settings 左栏默认宽度设为 200px，最小 200px，最大 420px，与 `AgentsActivity` 的 session list 常量一致。
  - [ ] 增加 Settings splitter，`role="separator"`、`aria-orientation="vertical"`、`aria-valuemin`、`aria-valuemax`、`aria-valuenow` 和可读 `aria-label` 必须完整。
  - [ ] 拖动时更新左栏宽度，设置 `document.body.style.cursor = "col-resize"` 和 `document.body.style.userSelect = "none"`；拖动结束后恢复。
  - [ ] 支持键盘 `ArrowLeft` / `ArrowRight` 每次调整 16px，并限制在 200px 到 420px 内。

- [ ] 更新 Settings 菜单与内容样式 (AC: 1, 3, 4, 6, 7)
  - [ ] 在 `src/app/app.css` 中让 `.activity-surface--settings` / `.settings-layout` 使用 CSS 变量控制左栏宽度，并包含左栏、8px splitter、右侧内容三列。
  - [ ] 分割线必须从页面顶部到页面底部连续显示；focus-visible 样式参考 `.agents-splitter`。
  - [ ] 菜单项使用图标 + 文案布局，选中态使用 `var(--color-surface-muted)` 或等价灰色背景，并保留 `aria-pressed`。
  - [ ] 右侧内容模板在可用宽度大于 900px 时居中，最大宽度 900px；小于 900px 时宽度 100%，内容不重叠、不溢出。

- [ ] 补齐 Settings 布局测试 (AC: 1, 2, 3, 4, 5, 6, 8)
  - [ ] 更新 `src/features/settings/project-settings-activity.test.tsx`，断言菜单图标可访问隐藏、`aria-pressed`、统一标题区域和具体模块内容切换。
  - [ ] 增加 splitter 测试：存在 `role="separator"`，具备宽度 aria 属性；键盘方向键能更新 `aria-valuenow`。
  - [ ] 增加回归测试，确认点击 `General` / `Agents` 后仍保留现有 Completion Policy 和 Agent list 行为。

## Dev Notes

### 关键假设与取舍

- 本 story 是前端布局一致性工作，不需要 Rust、SQLite、Tauri command、Agent Profile 数据模型或 Project Settings 数据模型变更。
- 保持当前 Settings 业务能力不变：`General` 仍展示 Project 名称和 Completion Policy；`Agents` 仍展示 Project Agents、Global Agents、Add/Edit Agent 弹窗和现有命令调用。
- 不新增 Settings 字段、Global Settings 入口、Agent Profile 行为或 i18n 扩展；FR26 在本 story 中只落实既有菜单/标题文案和图标呈现，不扩大语言切换能力。
- 当前实现已有两栏雏形，但左栏固定为 104px、没有可拖动 splitter、菜单无图标、选中态只改变文字颜色、右侧模块各自承担外层布局；这些是本 story 的主要修正点。

### 当前代码状态

- `src/features/settings/project-settings-activity.tsx` 当前在组件内直接渲染 `settings-menu` 和 `settings-content`，`activeMenu` 默认为 `agents`，菜单项为 `General` 和 `Agents`。
- `src/features/settings/project-settings-activity.tsx` 当前直接在条件分支中渲染 `settings-section` 和两个 `settings-agent-section`，尚未复用统一的右侧内容模板。
- `src/app/app.css` 当前 `.settings-layout` 是 `104px minmax(0, 1fr)` 两列，`.settings-content` 用 `border-left` 充当分隔线；没有独立 splitter，也没有 200/420px 宽度约束。
- `src/features/agents/agents-activity.tsx` 已有可复用行为参考：`defaultSidebarWidth = 200`，左栏最小 200px、最大 420px，splitter 使用 `role="separator"`、拖动时设置 body cursor/userSelect，并支持方向键每次 16px 调整。
- `src/app/app.css` 已有 `.agents-splitter` 的连续分割线、hover/focus 样式和 `focus-visible` 处理，Settings splitter 应按同一视觉语言实现。

### 实现约束

- 图标使用现有依赖 `lucide-react`，不要新增图标依赖或远程资源。建议 `Info` / `Bot` 或项目已使用的等价图标，图标本身加 `aria-hidden="true"`。
- 菜单配置应是显式结构，例如 `SETTINGS_MENU_ITEMS`，后续新增模块只需要添加配置和内容映射，不复制外层布局。
- 不要把 Settings 外层布局抽到 `shared/ui`，除非已有跨 feature 使用需求。本 story 只要求 Settings 内部复用，避免提前抽象。
- 若需要 CSS 变量，优先在 `<main className="activity-surface activity-surface--settings">` 上设置 `--settings-menu-width`，保持实现局部化。
- 分割线宽度建议与 Agents Activity 一致使用 8px hit area；视觉线仍为 1px。
- 宽度上下限必须是行为约束，不只是 CSS min/max；拖动和键盘都要 clamp。
- 移动窄屏媒体查询不得破坏可用性：如果沿用现有小屏单列处理，必须确保 story 的桌面双栏行为仍是默认工作台体验，且小屏下内容不重叠。

### 回归风险

- `AgentProfileForm` 使用全局 dialog overlay，布局重构时不要把 add/edit 弹窗限制到右侧内容容器导致遮罩层范围异常。
- Completion Policy 保存依赖 `updateProjectCompletionPolicy` 和 `onProjectUpdated`；移动 General 内容时必须保留禁用状态、错误处理和回调。
- Agent list 加载错误当前通过 `settings-status` 展示；统一模板后错误仍应在 Agents 内容区域可见，不要被标题或容器结构吞掉。
- `projectId` 变化仍应触发 project/global profiles 重新加载；不要把菜单配置或模板抽象写成闭包过期的结构。

### Project Structure Notes

- 主要修改文件：
  - `src/features/settings/project-settings-activity.tsx`
  - `src/features/settings/project-settings-activity.test.tsx`
  - `src/app/app.css`
- 通常不需要修改：
  - `src/features/settings/settings-commands.ts`
  - `src/features/settings/agent-profile-form.tsx`
  - `src-tauri/**`
  - `package.json` / `pnpm-lock.yaml`
- 若发现确实需要新增 Settings 子组件，文件应放在 `src/features/settings/`，文件名使用 kebab-case。

### Testing Requirements

- 本 story 修改 TypeScript / TSX 和渲染逻辑，完成后至少运行：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test -- src/features/settings/project-settings-activity.test.tsx
pnpm test
```

- 如只修改前端，不需要运行 Cargo 测试；若实现中意外触碰 `src-tauri/**`，必须追加：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 6 和 Story 6.2 的目标、requirements 与 BDD 验收。
- `docs/standards/settings-page-layout.md` — Settings 页面两栏、splitter、菜单项、右侧内容模板和非目标约束。
- `_bmad-output/planning-artifacts/architecture.md` — `features/settings` 边界、文件组织、组件边界与 FR 映射。
- `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` — Project Settings / Global Settings 产品边界，Activity Bar 只包含当前 Project Settings。
- `_bmad-output/planning-artifacts/ux-designs/ux-redwhisk-2026-06-03/EXPERIENCE.md` — Project Settings 与 Global Settings 不混用；工作台 Activity Bar 包含 `Issues`、`Agents`、`Settings`。
- `src/features/settings/project-settings-activity.tsx` — 当前 Settings 菜单、General 和 Agents 内容实现。
- `src/features/settings/project-settings-activity.test.tsx` — 当前 Settings 行为测试，应在此补布局和回归覆盖。
- `src/features/agents/agents-activity.tsx` — 左侧 Session list 宽度常量、splitter 拖动和键盘行为参考。
- `src/app/app.css` — Settings 与 Agents 当前布局样式。

### Latest Technical Notes

- 当前项目已经依赖 `lucide-react@^1.17.0`，本 story 使用该依赖即可，不需要新增图标包。
- 当前 React 版本为 `^19.1.0`，测试使用 `@testing-library/react@^16.3.2`、`@testing-library/user-event@^14.6.1`、`vitest@^4.1.8`；按现有测试风格扩展即可。

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-10T20:02+0800：bmad-dev-workflow 预检发现 sprint 中无 `ready-for-dev` story，选择首个 backlog story `6-2-unify-settings-page-two-column-layout` 创建 story。
- 2026-06-10T20:02+0800：读取 Epic 6、`docs/standards/settings-page-layout.md`、architecture、当前 Settings 和 Agents Activity 实现，确认本 story 只涉及前端布局和测试。
- 2026-06-10T20:21+0800：根据用户反馈将 Settings 的 General 面向用户标签统一为英文，已同步 story、布局规范、epics、组件和测试。

### Completion Notes List

- Story 创建完成，状态为 `ready-for-dev`。
- 本 story 明确不新增 Settings 业务字段、后端数据模型、Tauri command 或 Agent Profile 行为。
- Settings 当前 General 标签已在运行时代码和测试中改为英文，后续 6-2 开发应继续以 `General` 作为菜单和标题文案。

### File List

- `_bmad-output/implementation-artifacts/6-2-unify-settings-page-two-column-layout.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml`
- `_bmad-output/planning-artifacts/epics.md`
- `docs/standards/settings-page-layout.md`
- `src/features/settings/project-settings-activity.tsx`
- `src/features/settings/project-settings-activity.test.tsx`

### Validation Commands

- `test -f _bmad-output/implementation-artifacts/6-2-unify-settings-page-two-column-layout.md`
- `rg -n "Status: ready-for-dev|6-2-unify-settings-page-two-column-layout: ready-for-dev" _bmad-output/implementation-artifacts/6-2-unify-settings-page-two-column-layout.md _bmad-output/implementation-artifacts/sprint-status.yaml`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- src/features/settings/project-settings-activity.test.tsx`
- `pnpm test`

### Validation Results

- `test -f _bmad-output/implementation-artifacts/6-2-unify-settings-page-two-column-layout.md`：通过。
- `rg -n "Status: ready-for-dev|6-2-unify-settings-page-two-column-layout: ready-for-dev" _bmad-output/implementation-artifacts/6-2-unify-settings-page-two-column-layout.md _bmad-output/implementation-artifacts/sprint-status.yaml`：通过，确认 story 文件状态和 sprint 状态均为 `ready-for-dev`。
- `pnpm format`：通过，Prettier 覆盖范围内文件均已格式化。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test -- src/features/settings/project-settings-activity.test.tsx`：通过，8 个 test files、157 个 tests 通过；jsdom 输出既有 `HTMLCanvasElement.getContext()` 与 CSS parse 警告，不影响退出码。
- `pnpm test`：通过，8 个 test files、157 个 tests 通过；jsdom 输出既有 `HTMLCanvasElement.getContext()` 与 CSS parse 警告，不影响退出码。
