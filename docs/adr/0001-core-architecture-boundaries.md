# ADR 0001：核心架构边界

## 状态

已采纳。

## 决定

1. SQLite 是本地业务状态唯一事实源；React 仅通过 Tauri command 与 Rust 后端交互。
2. 前后端不用 HTTP REST 或 GraphQL；跨边界以显式 Rust DTO、Tauri command 和 event 实现。
3. Codex 与 Claude 使用结构化 provider 输出并归一化为 `AgentStreamEvent`；项目终端才使用 PTY/xterm。
4. Issue 可在当前分支或 RedWhisk 管理的 Git worktree 中执行；应用只自动清理自己拥有的 worktree。

## 后果

- 新状态、数据或跨边界字段必须同步 migration、Rust DTO、前端类型及测试。
- provider 私有协议不得进入 feature UI；UI 面向统一 timeline 和 capability。
- Git 完成流程必须显式处理 dirty、阻断、外部 worktree 与用户确认。

## 事实来源

`src-tauri/src/features/`、`db/`、`commands/`、`agent/`、`git/`，以及 [项目代码地图](../architecture-design/project-map.md)。
