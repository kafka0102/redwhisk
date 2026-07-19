# 后端 Rust 大文件拆分规则

## 目标

当 `src-tauri/src/**` 下单个 `.rs` 文件承载多个业务子领域、多个 command 分组或混杂的编排逻辑时，应优先按职责聚簇拆分，降低单文件代码量，同时保持运行时行为不变。

本规则是 [Agent 开发通用规则](./agent-development-rules.md) 中「后端 Rust 文件复杂度」章节的专项补充，并与 [前端大型组件拆分规则](./frontend-large-component-splitting-rules.md) 对称。它把 [ADR 0013](../adr/0013-feature-first-module-organization.md) 已采纳的「单文件目标 ≤ 500 行，编排主文件可到 800」从目标值升级为强制门禁。

## 行数阈值

- 常规 `.rs` 文件 ≤ **500 行**。
- 编排主文件 ≤ **800 行**：相对仓库根路径匹配 `src-tauri/src/features/*/service.rs` 或 `src-tauri/src/features/*/commands.rs`。
- 硬上限 ≤ **1000 行**：任何文件不得超过，含编排主文件。

阈值由 `scripts/check-rust-file-size.sh` 强制执行，`AGENTS.md` §5 质量门禁在每次改动 Rust 后调用。

## 门禁触发模型

- 门禁默认只检查本次 git 改动触及的 `.rs` 文件（已跟踪改动 + 未跟踪新文件），不扫全仓。
- 越界文件若在 `scripts/rust-file-size-allowlist.txt` 中登记 → 跳过并提示「存量待拆分」。
- 越界且未登记 → 脚本非零退出，任务不算完成（见 `AGENTS.md` §5）。
- 白名单仅登记「本次改动前已超阈值」的存量文件；**禁止把新建文件塞进白名单**，脚本会检测并报错。
- 维护白名单：`bash scripts/check-rust-file-size.sh --all --names-only` 列出当前全部超阈值文件。

## 拆分边界

- `features/<feature>/service.rs`：按子领域或用例拆为同 feature 下的子模块（如 `service/launch.rs`、`service/timeline.rs`），主文件只保留编排与对外入口。
- `features/<feature>/commands.rs`：按 command 分组拆为 `commands/<group>.rs`，主文件聚合 `generate_handler!` 注册。
- `db/<entity>_repository.rs`：按实体拆为 `db/<feature>/<entity>.rs`。
- `agent/<provider>/session.rs`：按协议阶段（握手、流式、收尾）或消息类型拆子模块。
- 子模块通过 `mod.rs` 或文件级 `mod` 声明聚合，不得跨 feature 引用对方私有子模块。
- feature 内部目录布局（`mod.rs` / `service.rs` / `commands.rs` / 子模块命名约定）详见 [Agent 开发通用规则](./agent-development-rules.md)「feature 内部目录约定（后端）」。

## 拆分纪律

- 不得为满足行数限制做无语义机械拆分；拆分后的模块必须有清晰单一职责，降低理解成本。
- 拆分须保持运行时行为不变：命令签名、事件 payload、错误类型、SQL 与事务边界不得改变。
- 优先做「纯移动」：搬移函数/结构体到新文件，调整 `use` 与 `mod`，不改实现。

## 验收要求

- 拆分后运行 `cargo test --lib`（集成测试有预存失败，回归判定用 `--lib`）。
- 拆分后运行 `bash scripts/check-rust-file-size.sh --files <被拆分的主文件>`，确认主文件与新子文件均不再越界（除非新子文件本身进白名单，但新建文件不得入白名单，故必须直接达标）。
- 提交说明记录新增子模块边界，便于后续继续拆同类文件。
