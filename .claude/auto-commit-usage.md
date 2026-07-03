# Claude Code 自动提交 Hook 使用说明 (v5.0)

## 概述

本 Hook 不再自行生成 commit message，而是把"提交"这件事交还给 Claude Code 本体：

1. **Commit Message 由 Claude 生成**：Hook 只负责检测未提交改动并向主 Agent 反馈一条提交提示词，message 由 Claude 根据 diff 和任务意图自行编写。
2. **遵循项目规范**：提示词显式要求 Claude 按 `docs/standards/git-workflow.md` 的 Conventional Commits 规范提交，禁止泛化措辞。
3. **重复修改不遗漏**：跟踪文件变更时间，提交后不清空状态，后续修改仍能捕获。
4. **循环防护**：用 `askedCount` 限制连续反馈次数，避免因故未提交时无限 block。

## 工作机制

Hook 在两个事件触发（配置见 `.claude/settings.json`）：

- **PostToolUse**（匹配 `Write` / `Edit` / `MultiEdit` / `NotebookEdit`）：记录本轮 Agent 写入的文件路径，用于在 Stop 阶段区分"本任务文件"与仓库中无关的 dirty 文件。
- **Stop**：主响应完成时触发。
  1. 若没有任何 dirty 改动 → 复位 `askedCount`，放行 Stop。
  2. 若有本任务产生的未提交改动 → 通过 `decision: "block"` + `reason` 把提交提示词喂回 Claude Code，由 Claude 自行 `git add` + `git commit`。
  3. 连续 block 达上限（默认 2 次）后放行 Stop，避免无限循环。

Hook **不**生成 message、**不**执行 `git add` / `git commit`，所有提交动作由主 Agent 完成。

## Claude 收到的提示词示例

当 Stop 检测到未提交改动时，Claude 会收到类似下面的反馈（即 Stop hook 的 `reason`）：

```
检测到本次任务存在未提交改动：
- path/to/file.ts

请由你自行完成提交（不要依赖外部脚本生成 message）：
1. 仅 git add 上面列出的、与本次任务直接相关的文件，不要混入无关改动；
2. commit message 必须遵循 docs/standards/git-workflow.md 的 Conventional Commits 规范，
   并准确描述本次任务的真实意图（禁止使用「更新源码」「更新文档」这类泛化措辞）；
3. 提交完成后即可结束本轮回复，无需等待额外确认。
```

## 与旧版本（v4）的差异

| 维度 | v4（已废弃） | v5（当前） |
|------|--------------|-----------|
| message 来源 | 脚本规则匹配路径关键词，或读 `.claude/.commit-message.tmp` | Claude Code 自行根据 diff 生成 |
| 提交执行者 | Hook 脚本执行 `git add` / `git commit` | 主 Agent 执行 |
| `.commit-message.tmp` 旁路 | 存在 | 已删除 |
| 典型问题 | 产出 `docs: 更新文档` / `feat: 更新源码` 等占位 message | message 准确描述任务意图 |

## 状态文件格式

Hook 使用 `os.tmpdir()/redwhisk-claude-auto-commit-state-v5.json` 存储状态：

```json
{
  "/repo/path:session-id": {
    "files": {
      "path/to/file.ts": {
        "lastModifiedAt": "2026-07-03T00:00:00.000Z",
        "committedAt": "2026-07-03T00:01:00.000Z"
      }
    },
    "lastWriteAt": "2026-07-03T00:00:00.000Z",
    "askedCount": 0
  }
}
```

## 配置

编辑 `.claude/auto-commit.json` 调整行为：

```json
{
  "enabled": true,
  "maxFiles": 80,
  "commitDirtyFallback": true,
  "excludePatterns": [
    "node_modules/",
    "dist/",
    "build/",
    ".git/",
    ".DS_Store",
    "*.log",
    "tmp/",
    "temp/"
  ]
}
```

字段说明：

- `enabled`：是否启用 Hook。
- `maxFiles`：单次提示提交的文件数上限，超过则跳过（避免一次性提交过多）。
- `commitDirtyFallback`：未记录到本任务写入文件时，是否回退为对全部 dirty 文件发起提交提示。
- `excludePatterns`：不计入提交提示的路径排除规则。

> v4 遗留的 `useChineseDescription` 字段在 v5 中已无作用（message 由 Claude 生成），保留在配置里会被忽略，可按需清理。

## 与 Git 工作流规范的配合

提交提示词显式指向 `docs/standards/git-workflow.md`，要求：

- type 用英文小写：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / ...
- 描述用简体中文，准确反映本次任务意图
- 一个 commit 只包含当前任务直接相关的文件

规范细节以 `docs/standards/git-workflow.md` 为准。
