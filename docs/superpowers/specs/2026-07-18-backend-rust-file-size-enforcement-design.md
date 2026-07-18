# Rust 单文件大小强制机制设计

> 状态：设计已确认，待出实施计划
> 日期：2026-07-18
> 关联：[ADR 0013](../../adr/0013-feature-first-module-organization.md)、[Agent 开发通用规则](../../architecture-design/agent-development-rules.md)「前端文件复杂度与组件化」、[前端大型组件拆分规则](../../architecture-design/frontend-large-component-splitting-rules.md)

## 背景与问题

后端 feature-first 重构后，`src-tauri/src/` 仍存在大量超长单文件：

| 文件 | 行数 |
| --- | --- |
| `features/agent_session/service.rs` | 5860 |
| `features/issue/service.rs` | 4739 |
| `features/project_terminal/service.rs` | 2790 |
| `agent/claude_streaming/session.rs` | 2623 |
| `agent/codex_app_server/session.rs` | 1742 |
| `features/agent_session/workspace.rs` | 1686 |
| `db/agent_session_repository.rs` | 1571 |
| 其余 > 1000 行 | 多个 |

根因不是缺目标值，而是缺整套强制闭环。前端早有一套完整机制且运转良好：

- 规范文字：`agent-development-rules.md`「前端文件复杂度与组件化」章节 + 专项 `frontend-large-component-splitting-rules.md`（1000 行阈值）。
- 任务路由：`AGENTS.md` §4「按任务类型读 docs」把改动 TS/TSX 指向上述文档。
- 门禁：`AGENTS.md` §5 质量门禁（lint/typecheck/test）落地。

Rust 侧这三层全缺：`agent-development-rules.md` 没有 Rust 章节；`AGENTS.md` §4 改 Rust 的必读项里没有任何文件大小/拆分规则；§5 门禁无文件大小检查。`ADR 0013:22` 虽提过「单文件目标 ≤ 500 行，编排主文件可到 800」，但既未进 §4 必读路由、也未进 §5 门禁，Agent 改 Rust 时看不到。

## 目标

在规范层面建立机制，阻止 Agent 在单个 Rust 文件中持续堆砌代码：达到阈值时强制拆分，职责保持集中。复刻前端「规范文字 + 任务路由 + 门禁」三层闭环到 Rust 侧，并把 Rust 的约束做成比前端更强的**硬门禁**（前端目前是软约束）。

## 设计决策

### 决策 1：三层骨架（对标前端，补齐 Rust 缺失层）

| 层 | 前端现状 | Rust 新增 |
| --- | --- | --- |
| 规范文字 | `agent-development-rules.md` 章节 + `frontend-large-component-splitting-rules.md` | `agent-development-rules.md` 新增「后端 Rust 文件复杂度」章节 + 专项 `backend-large-file-splitting-rules.md` |
| 任务路由 | `AGENTS.md` §4 改动 TS/TSX 指向上述文档 | `AGENTS.md` §4 改动 Rust 追加指向新专项文档 |
| 门禁 | §5 lint/typecheck（无显式行数检查） | §5 新增第 5 步 `bash scripts/check-rust-file-size.sh` |

### 决策 2：阈值沿用 ADR 0013 分层（客观可判）

- 常规 `.rs` 文件 ≤ **500 行**。
- 编排主文件 ≤ **800 行**。
- 硬上限 ≤ **1000 行**，任何文件不得超过（含编排主文件）。

与已采纳的 `ADR 0013:22` 一致，不产生规范打架。

### 决策 3：编排主文件客观判定规则

脚本必须能客观判定一个文件是否属于「编排主文件」，不依赖人工标注。规则：

- 路径匹配 `src-tauri/src/features/*/service.rs` 或 `src-tauri/src/features/*/commands.rs` → 编排主文件，阈值 800。
- 其余 `.rs` 文件 → 常规，阈值 500。
- 所有文件共用硬上限 1000。

含义：像 `agent/claude_streaming/session.rs`（provider 主文件）这类不匹配上述通配的文件走常规 500 阈值；当前已超阈值，进入存量白名单（见决策 4），后续按专项文档拆分。

### 决策 4：门禁触发模型（仅检查本次改动 + 存量白名单）

- 默认只检查**本次 git 改动触及的 `.rs` 文件**（`git diff --name-only` vs 合并基），不扫全仓——规范上线不会因存量 5860 行秒红。
- 越界文件若在白名单 `scripts/rust-file-size-allowlist.txt` → 跳过并提示「存量待拆分」。
- 越界且不在白名单 → 非零退出，打印「文件 / 当前行数 / 适用阈值 / 拆分建议」。
- 白名单只接受「本次改动前已超阈值」的存量文件；**禁止把本次新建文件塞进白名单**（防偷懒），脚本对白名单内文件做新增文件检测并报错。
- 提供 `--all` 模式扫描全仓生成存量报告，用于维护 backlog，不阻断。

### 决策 5：脚本用 bash，不挂 pnpm

`scripts/` 现有 bash 与 node mjs 混用。本脚本核心是 `git diff` + `wc -l` + 路径通配，bash 原生即可，无 node 启动开销，跨 mac/Linux 一致。门禁由 Agent 按 `AGENTS.md` §5 手动 `bash scripts/check-rust-file-size.sh` 调用，不引入 pnpm 任务依赖。

### 决策 6：拆分指导（专项文档内容）

- feature 内按职责聚簇拆：`service.rs` 按子领域拆子模块、`commands.rs` 按领域分组、repository 按实体。
- 不得为满足行数限制做无语义机械拆分（`ADR 0013` 已强调）；拆分后模块须有清晰职责。
- 拆分须保持运行时行为不变，用 `cargo test --lib` 验证（集成测试有预存失败，见仓库记忆，回归判定用 `--lib`）。

## 落地清单

新增：

- `docs/architecture-design/backend-large-file-splitting-rules.md`——Rust 单文件复杂度专项规则（对标前端专项文档）。
- `scripts/check-rust-file-size.sh`——行数检查门禁脚本。
- `scripts/rust-file-size-allowlist.txt`——存量白名单，预填当前超阈值文件。

改动：

- `docs/architecture-design/agent-development-rules.md`——新增「后端 Rust 文件复杂度」章节。
- `docs/README.md`——索引追加新专项文档；读取顺序表追加「Rust 改动」行。
- `AGENTS.md`——§3 目录地图补 `scripts/` 说明；§4 任务路由追加改动 Rust 的必读项；§5 质量门禁追加第 5 步 Rust 文件大小检查。

## 明确不做（YAGNI）

- 不动前端规范（已运转）。
- 不引入外部 lint 工具 / cargo 自定义 lint（clippy 无行数 lint，不值得为此加构建依赖）。
- 不立即拆分存量（按白名单 backlog，后续单独任务）。
- 不做外部 CI 集成（本项目门禁由 Agent 按 §5 自跑，不依赖 CI）。

## 与现有文档的关系

- 本机制把 `ADR 0013:22` 已有但未制度化的「500/800」目标值，升级为「规范文字 + 任务路由 + 门禁」三层强制闭环。
- 与前端 `frontend-large-component-splitting-rules.md` 结构对称，便于前后端一致性维护。
- 阈值若日后需调整，以本 spec 为决策依据，同步改 `ADR 0013`、专项文档与脚本常量。
