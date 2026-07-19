# ADR 0013：后端业务模块按 feature 纵切，退役 core/

## 状态

采纳（已执行完成；执行清单见 [后端 feature-first 重构方案](../architecture-design/backend-feature-first-refactor.md)）。

## 背景

`src-tauri/src/core/` 当前承载全部业务 service：`issue_service`（5785 行）、`agent_session_service`（7283 行）、`project_terminal_service`（3129 行）、`session_workspace_service`、`settings_service`、`project_service`、`user_profile_service`、`completion_state_machine`、`completion_effect_interpreter`、`app_update/`、`local_data_service`。

[ADR-0001](./0001-core-architecture-boundaries.md) 与 `docs/architecture-design/agent-development-rules.md`「目录边界」章节 把 `core/` 定义为「业务 service、状态流转、事务编排」——即相对前端 UI 的「后端核心」，而非 shared-kernel 意义上「与业务无关的基础设施」。

核对 `core/` 全部 14 个文件后确认：**没有任何一个是与业务无关的核心**。真正的基础设施实际散在 `db/connection.rs`、`types/`、`logging/`、`app_state.rs`、`local_data_path.rs`。`core` 目录名名不副实，造成两个后果：

1. **语义误导**：按通用架构惯例，`core/` / `kernel/` 指共享内核；本项目却把全部业务装在里面，新人需先读 ADR-0001 才能理解此 `core` 非彼 core。
2. **前后端结构不对称**：前端已是 `src/features/{project,issues,agents,settings,terminals}/`，后端却把对应业务压在单一 `core/` 下，跨边界定位同一能力要在前端 `features/` 与后端 `core/` 间反复跳转。

## 决定

1. **退役 `src-tauri/src/core/`**：业务模块按能力纵切迁入 `src-tauri/src/features/<feature>/`，feature 划分对齐前端 `src/features/`。
2. **力度 L2（业务纵切 + commands 跟随）**：每个 feature 收纳自身的 service 与 commands；`db/`、`agent/`、`git/`、`types/`、`logging/`、`agent_skill/`、`app_state.rs`、`local_data_path.rs` 保持横切/顶层——它们是跨 feature 的基础设施或全局能力（migration 与连接池必须全局；provider 抽象、git 工具、skill 扫描跨 feature 复用）。
3. **feature 内部分层**：feature 目录内按职责切文件（`service.rs` / `commands.rs` / 子领域目录），单文件目标 ≤ 500 行，编排主文件可到 800。超出部分按职责聚簇拆子文件，不做无语义机械切分。
4. **`core/` 不留空壳**：迁移完成后删除 `core/` 目录与 `core/mod.rs`。
5. **执行期同步更新契约文档**：ADR-0001 事实来源、`project-map.md`、`agent-development-rules.md`「目录边界」章节 的路径与分层描述，在对应迁移 PR 内一并更新；历史 ADR（0010/0011/0012）与历史 plan 里引用的 `core/` 路径按 ADR 规则不回写。

## 后果

- 后端目录与前端 `src/features/` 对称，跨边界定位同一能力只需同名的 feature 目录。
- 改一个业务能力不再跨 `core/` + `commands/` 两处，feature 内聚提升。
- `db/` 仍横切，跨 feature 事务（issue + agent_session）继续由 service 在 `db/` 声明事务边界、repository 执行 SQL（与本重构的 SQL 收敛后续阶段同向）。
- 代价：移动约 14 个 core 文件 + 10 个 commands 文件，全仓 `use crate::core::...` 引用与 `tauri::generate_handler!` 注册需同步调整；详见 [执行清单](../architecture-design/backend-feature-first-refactor.md)。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 在 `core/` 下按业务建子目录（`core/issue/`） | 只重新分类，未解决 `core` 名不副实与前后端结构不对称的根因 |
| L1：只迁 core，commands 保持横切 | feature 内聚仅解决一半，定位一能力的全部代码仍跨 `features/` + `commands/` |
| L3：commands + service + repository + types 全纵切 | `db/migration` 必须全局、跨 feature 事务归属难定，纵切不彻底反而别扭；收益不抵代价 |
| 业务模块铺到 `src-tauri/src/` 顶层 | 顶层会冒出 15+ 平级目录，淹没基础设施层；`features/` 分组更清晰 |

## 事实来源

- 迁移前：`src-tauri/src/core/`、`src-tauri/src/commands/`、`docs/architecture-design/project-map.md`。
- 迁移后：`src-tauri/src/features/`、`src-tauri/src/{agent,agent_skill,db,git,logging,types}`、`src-tauri/src/{app_state.rs,local_data_path.rs}`。
- 执行清单：[后端 feature-first 重构方案](../architecture-design/backend-feature-first-refactor.md)。
