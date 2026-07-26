# ADR-0025: 多 Agent 技能根目录归属

## 状态

已采纳

## 背景

本地 skill 目录并非与 Agent 一一独占。OpenCode 兼容 `.agents` / `.claude` 等约定；Grok 也消费 user-level `~/.agents/skills` 与 Claude skills 兼容路径。若扫描时每个根目录只标单一 `agentType`，设置页「支持的智能体」会低估真实可用性，Issue 工作流按 agentType 过滤 skill 时也会漏配。

已添加技能以 `skill_paths: { agentType, path }[]` 存储，天然支持同一路径挂多个 Agent，无需改表结构。

## 决策

扫描本地 skill 时，按**目录约定**展开为一条或多条 `(agentType, path)` 记录（同一 `SKILL.md` 可为多个 agentType 各生成一条）：

| 目录 | 归属 Agent |
| --- | --- |
| `~/.agents/skills`、项目 `.agents/skills` | Codex + OpenCode + Grok |
| `~/.claude/skills`、项目 `.claude/skills` | Claude + OpenCode + Grok |
| Codex 专属（如 `~/.codex/skills`、项目 `.codex/skills`、superpowers、`/etc/codex/skills` 等既有根） | 仅 Codex |
| OpenCode 专属（`~/.config/opencode/skills`、项目 `.opencode/skills`） | 仅 OpenCode |
| Grok 专属（`~/.grok/skills`、项目 `.grok/skills`） | 仅 Grok |

补充规则：

1. 同一 `name + scope` 下，同一 `agentType` 可因多个根目录产生多条路径；全部保留。
2. 展示「支持的智能体」时每个 Agent 只出现一次；Tooltip / 表单只读区可列出该 Agent 下全部路径。
3. Agent 展示固定顺序：Codex → Claude → OpenCode → Grok。
4. 技能刷新对账：按 `name + scope` 用当前扫描结果重写 `skill_paths`；本地找不到同名 skill 时保留已添加配置并将路径置空，不软删。

## 后果

- 必须补齐 OpenCode / Grok 专属根，并修正共享根的多 Agent 展开。
- 列表与表单不再把路径当成用户可多选子集；添加时写入当前检测到的全部路径。
- 下游按 `agentType` 过滤已添加技能时，共享目录 skill 可同时对多个 Agent 可选。
