# ADR 0002：Issue 时间轴事件模型

## 状态

已采纳。

## 决定

Issue 时间轴以 `issue_actions` 作为唯一、不可变的事件流，不另建动态表；`issue_comments` 在后续 Agent 评论阶段独立保存正文，并由评论动作引用。`issue_actions` 将操作者与评论关系列化，`action_type` 表示稳定动作类型，`payload_json` 仅保存带版本的展示参数；前端通过集中 renderer registry 和 i18n 模板渲染，不在数据库保存可见模板。

用户档案解除 `id = 1` 的单用户约束，但现有用户与历史动作仍以 ID 1 兼容回填。Agent 分配事件同时保存配置 ID 和名称快照，使逻辑删除或改名不影响历史展示。

## 后果

- 首期仅实现用户创建、分配 Agent、状态变更的时间轴写入与展示；Agent 评论表和写入逻辑后续实现。
- 现有动作需回填操作者，既有 Agent 分配无法解析名称时展示“已删除 Agent”。
- Agent 最终评论仅提取最终答复中的 `<issue-comment>` 交付摘要，完整答复继续保留在 Agent Session。
