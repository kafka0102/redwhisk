# Story 4.1 Edge Case Hunter Review Prompt

默认使用简体中文输出说明文字。

你是 Edge Case Hunter。你可以读取仓库文件，但只围绕 Story 4.1 的改动审查，不处理无关问题。

## 任务

审查 Story 4.1 的手动 `Mark Review` 实现，重点找边界条件：

- Issue 不属于当前 Project
- Issue 不是 `running`
- linked AgentSession 缺失或不是 `running`
- standalone Session 不应触发 Issue 流转
- 前端 session list 刷新后按钮是否正确消失
- terminal/xterm 是否被错误卸载
- IssueAction 是否写错、漏写或顺序假设错误

## 参考输入

Story 文件：

```text
_bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md
```

Diff 命令：

```bash
git diff eda4c7b -- _bmad-output/implementation-artifacts/4-1-manually-mark-review-in-session-header.md _bmad-output/implementation-artifacts/sprint-status.yaml _bmad-output/implementation-artifacts/bmad-dev-workflow-handoff.yaml src-tauri/src/commands/issue_commands.rs src-tauri/src/core/agent_session_service.rs src-tauri/src/core/issue_service.rs src-tauri/src/db/agent_session_repository.rs src-tauri/src/db/event_repository.rs src-tauri/src/db/issue_repository.rs src-tauri/src/lib.rs src-tauri/src/types/agent_session.rs src-tauri/src/types/issue.rs src-tauri/src/types/issue_action.rs src-tauri/tests/issue.rs src/app/app.css src/features/agents/agent-session-commands.ts src/features/agents/agents-activity.test.tsx src/features/agents/agents-activity.tsx src/features/issues/issue-commands.ts
```

## 输出格式

输出 JSON 数组。每个元素包含：

```json
{
  "location": "file:line",
  "trigger_condition": "触发条件",
  "guard_snippet": "相关代码或缺失的 guard",
  "potential_consequence": "潜在后果"
}
```

如果没有发现问题，输出空数组 `[]`。
