// 与后端 `AgentType` 枚举（snake_case 序列化）对齐：
// - codex / claude / opencode / grok / deepseek 跨 IPC 边界字面量。
// - claude_code 是前端 UI 别名（视作 Claude），不跨 IPC 边界。
export type AgentType =
  | "codex"
  | "claude"
  | "claude_code"
  | "opencode"
  | "grok"
  | "deepseek";
