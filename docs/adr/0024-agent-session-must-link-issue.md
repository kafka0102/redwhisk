# 新建 Agent Session 必须关联 Issue

Agents 工作台不再提供「加号创建无 Issue 的自定义 / 临时 Session」。**新建** Agent Session 只能从 Issue 启动并绑定该 Issue；`start_structured_agent_session` 及 standalone 新建通路删除。

存量 `issue_id` 为空的会话称为**历史独立 Session**：列表/打开/消息/resume 仍可读兼容，并保留删除与改标题以便清理；本轮不做 schema 强制 `NOT NULL`、也不 bulk 删除存量。

## Considered Options

| 选项 | 结论 |
| --- | --- |
| 仅删前端加号，后端新建 command 保留 | 否：易被旁路调用，与「删除前后端创建代码」不符 |
| command 保留但永远失败 | 否：死接口；桌面应用无外部旧客户端兼容压力 |
| 隐藏或 bulk 清理存量 standalone | 否：本轮选择只读兼容，降低数据风险 |
| schema 强制 `issue_id NOT NULL` | 否：留给后续；需先处理存量 |

## Consequences

- Issue 关联启动仍走 `start_agent_session`；历史独立 Session 的 delete/title 仍走既有 command。
- ADR-0011 中「standalone 启动前半段」仅适用于历史兼容与 resume 等非新建路径；新建 standalone 不再存在。
- 正式文档（`tauri-contract`、`agent-development-rules`）须同步「禁止新建无 Issue Session」。
