## Context

现有项目终端实现把“条目列表状态”和“PTY 运行实例”都放在前端运行期与内存注册表里：

- 前端 `ProjectTerminalsActivityState` 只记录 `sessionId` 与 `name`。
- Rust `ProjectTerminalRegistry` 只维护当前进程里的活跃 session。
- `create_project_terminal` 直接启动 shell，不存在配置层，也没有项目打开时的恢复入口。

要满足本次需求，必须把“终端配置”与“终端运行实例”明确拆开，否则重启后没有恢复依据，也无法区分用户保存的启动命令与一次性 session 状态。

## Scope Assumptions

- 一个项目可保存多个终端配置，打开项目时全部自动启动。
- 自动启动的失败表现先保持简单：单个终端启动失败时不阻塞项目打开，前端通过现有错误展示或空终端状态承接。
- 编辑只修改配置，不支持对正在运行的 shell 做热重启替换；保存后以“下次打开项目生效”为最低保证，当前会话内如需同步表现，按可安全实现的最小行为处理。

## Data Model

新增持久化表，例如 `project_terminal_configs`：

- `id`
- `project_id`
- `name`
- `working_dir`
- `launch_command`
- `created_at`
- `updated_at`

约束：

- `project_id` 外键指向 `projects.id`
- 删除项目时可级联删除或由应用层清理；本次以仓库现有 migration 风格为准
- `working_dir` 允许保存项目 repo path 或用户自定义子路径 / 其他路径

运行时继续保留内存注册表，但 registry 记录项需要关联配置 id，以便前端把“保存的终端配置”映射到“当前 session”。

## Backend Flow

拆成两类操作：

1. 配置操作
   - `list_project_terminal_configs(projectId)`
   - `create_project_terminal_config(projectId)` 或把现有 create 改为“创建配置并启动”
   - `update_project_terminal_config(id, name, workingDir, launchCommand)`
   - `delete_project_terminal_config(id)`，并关闭对应 session

2. 运行时操作
   - 基于配置启动 terminal session
   - 项目打开时遍历配置并批量启动
   - 保持已有 read / write / resize / restore / close transport

推荐最小实现是保留现有 `create_project_terminal` 语义，但改成：

- 先写入默认配置（名称 `New Terminal`，路径为项目 repo path，启动命令为空或默认 shell）
- 再基于该配置启动 session
- 返回 `configId + sessionId + name + workingDir + launchCommand`

项目打开时，在 Rust 的 `open_project` 路径补一段“加载配置并启动 session”的逻辑，比前端单独调用更稳，因为它天然覆盖“重启后再次打开项目”的场景。

## Frontend Flow

终端页状态需要从“只持有 session”升级为“配置 + session 展示态”：

- `configId`
- `sessionId`
- `name`
- `workingDir`
- `launchCommand`

进入 `Terminals` 页面时，如果当前项目状态尚未装载过，应先从后端读取已保存并已启动的终端配置；但更稳妥的方案是项目打开后就把这些 session 启起来，终端页只负责读取展示列表。

UI 变化：

- 条目高度减少 10px，使用固定 4px 纵向间距。
- hover 左侧显示编辑按钮，点击打开模态框。
- 模态框字段顺序：名称、路径、启动命令。
- 选中态使用统一色板的加深版本，不再随机。

## Complexity

该 change 涉及：

- 前端交互与状态模型调整
- 新的数据库 migration / repository
- Tauri 命令与 service 扩展
- 项目打开生命周期接入自动启动

这已经超出“单模块、无 migration、路径线性”的低复杂度范畴，应判定为 `中复杂度`。

## Validation

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml project_terminal`
- `cargo test --manifest-path src-tauri/Cargo.toml project`
