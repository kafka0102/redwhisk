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

1. 同一 `name + scope` 下，同一 `agentType` 可因多个根目录产生多条路径；**存储**时全部保留于 `skill_paths`。
2. 展示「支持的智能体」时每个 Agent 只出现一次；Tooltip / 表单只读区对该 Agent **只展示一条 preferred 路径**（不罗列全部路径）。选取优先级（数字越小越优先）：
   1. 该 Agent **专属根**（Codex：`.codex/skills`、`.codex/superpowers/skills`、`/etc/codex/skills`；Claude：`.claude/skills`；OpenCode：`.opencode/skills`、`.config/opencode/skills`；Grok：`.grok/skills`）
   2. 共享 **`.agents/skills`**
   3. **其他共享根**（对非 Claude 的 OpenCode / Grok 而言，含 `.claude/skills` 等）
   4. 其余路径
   - 同优先级多条：路径字符串字典序取第一条
   - 路径匹配按规范化后的路径后缀 / 片段判断（兼容绝对路径）
3. Agent 展示固定顺序：Codex → Claude → OpenCode → Grok。
4. 技能刷新对账：按 `name + scope` 用当前扫描结果重写 `skill_paths`；
   - **项目 scope**：对账扫描源 = 项目快照 ∪ 全局快照；合并键为 `name + agentType`，同键时**项目优先**；
   - **全局 scope**：对账扫描源仅全局快照；
   - 对应 scope 的扫描源中找不到同名 skill 时，保留已添加配置并将路径置空，**不软删**。

## 后果

- 必须补齐 OpenCode / Grok 专属根，并修正共享根的多 Agent 展开。
- 列表与表单不再把路径当成用户可多选子集；添加时写入当前检测到的全部路径，展示层再按规则 2 收敛为每 Agent 一条 preferred 路径。
- 下游按 `agentType` 过滤已添加技能时，共享目录 skill 可同时对多个 Agent 可选。
- 项目范围技能仅存在于全局 skill 目录时，对账与展示仍可解析出支持的智能体，避免误报「未检测到」。

## 相关

- 领域语言：[`CONTEXT.md`](../../CONTEXT.md)（已添加技能、技能路径条目、支持的智能体、技能刷新同步）
