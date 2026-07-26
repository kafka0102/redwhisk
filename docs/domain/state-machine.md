# 领域状态机

本文档汇总会改变用户可见业务流程的稳定状态。字段定义和真实校验以 `src-tauri/src/types/`、feature service（`src-tauri/src/features/**/service.rs`）和 migration 为准。

## Issue 与 Agent Session

| 实体          | 状态                             | 允许的核心迁移                                                               | 不变量                                                    |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Issue         | `backlog`                        | 创建；成功启动关联会话后进入 `running`                                       | 启动失败仍保持 `backlog`                                  |
| Issue         | `running`                        | `mark_issue_review` → `review`                                               | 同一活动 Issue 最多一个未软删除的关联 session             |
| Issue         | `review`                         | 经统一 completion flow → `completed`                                         | 继续给 Agent 发消息不退回 `running`，不创建第二个 session |
| Issue         | `completed`                      | 仅可回退到 `backlog`                                                         | 不可进入 `running`/`review`；不提供 Run/再次完成主路径；可 summary、日志、诊断与退回待办 |
| Agent Session | `running`                        | provider 正常关闭 → `closed`；异常退出 → `crashed`；重启无法恢复 → `stopped` | session 状态不等同 Issue `review`                         |
| Agent Session | `closed` / `crashed` / `stopped` | 终态事实                                                                     | 不自动完成关联 Issue                                      |
| Attention     | `none` / `requested`             | `set_agent_session_attention`                                                | 仅会话提示状态，不是 Issue 状态                           |

Issue 状态变化由 Rust 后端 编排；前端不得直接写 SQLite 或伪造状态。新增状态变更必须同时写入 `issue_actions`、`session_events` 或完成记录中的适当审计事实。

## Turn 与权限

| 事实                   | 写入方                        | 前端职责                                                           |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `is_turn_running`      | Rust 后端                     | 根据 stream event 显示处理中；不自行置位                           |
| turn 完成/失败/取消    | provider → `AgentStreamEvent` | reducer 更新消息流与控件可用性                                     |
| `permission_requested` | Codex provider                | 展示动作，调用 `respond_agent_permission`；Claude 不假定存在该事件 |
| `seq` / `epoch`        | Rust broadcaster              | 用于去重、顺序和重建对齐                                           |

## Issue 完成 flow

`issue_completion_flows.phase` 的值为 `detecting_workspace`、`prompting_dirty_decision`、`auto_committing`、`confirming_continue_after_commit`、`reconciling_worktree`、`confirming_worktree_cleanup`、`completed`、`cancelled`、`blocked`。其中 `completed`、`cancelled` 是 flow 终态；`blocked` 需要显示原因并允许业务规定的恢复路径。

完成的对外 action 为 `completed`、`prompt_dirty_decision`、`waiting_auto_commit`、`confirm_continue_after_commit`、`confirm_worktree_cleanup`、`blocked`、`cancelled`。UI 以 action 驱动弹框，不根据局部猜测跳过 flow。

## 新增状态的最小改动集

1. 定义 Rust enum 与 serde 字符串值。
2. 更新 SQLite CHECK / migration、repository 映射及历史数据策略。
3. 在 feature service 显式校验迁移合法性，并写审计记录。
4. 同步前端 union、显示文本、i18n、命令/事件处理。
5. 覆盖成功、非法迁移、重启/失败和数据回读。
