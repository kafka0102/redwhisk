# Claude Code 自动提交 Hook 使用说明 (v4.0)

## 概述

本 Hook 解决了两个关键问题：
1. **Commit Message 由 Claude 生成**：支持 Agent 显式设置有意义的提交描述
2. **重复修改不遗漏**：跟踪文件变更时间，提交后不清空状态，后续修改仍能捕获

## 如何让 Claude 设置 Commit Message

### 方式：写入约定的临时文件（推荐）

在任务完成时，写入 `/.claude/.commit-message.tmp` 文件，Hook 会读取并使用它：

```javascript
Write({
  file_path: "/Users/yujianjia/workspace/kafka/redwhisk/.claude/.commit-message.tmp",
  content: "fix: 修复自动提交 hook 遗漏重复修改文件的问题\n\n支持 Agent 显式设置 commit message，同时改进文件变更跟踪逻辑。"
})
```

Hook 在 PostToolUse 阶段检测到这个文件后，会：
1. 读取内容作为 `state.commitMessage`
2. 自动删除这个临时文件
3. 在 Stop 阶段使用这个 message 提交

## 在实际对话中的使用流程

### 推荐做法（简单有效）

```
用户：修复 XYZ 问题

我：好的，让我先了解一下问题...
    [分析过程...]
    [修复代码...]
    [验证...]

    // 最后一步：设置 commit message
    // 可以用一个无害的 Edit 操作来传递 commitMessage

Edit({
  file_path: "/Users/yujianjia/workspace/kafka/redwhisk/.gitignore",  // 选一个稳定存在的文件
  old_string: "node_modules/",
  new_string: "node_modules/",
  commitMessage: "fix: 修复 XYZ 功能中 ABC 的问题"
})

    // 然后 Stop 事件触发时，Hook 会使用这个 message
```

### 完整示例

假设任务是重构 Hook：

```
1. Read .claude/auto-commit.js
2. Edit .claude/auto-commit.js [修改逻辑]
3. Edit .claude/auto-commit.js [继续修改]
4. Edit .claude/auto-commit.js [最后一次修改，带上 commitMessage]

最后一次 Edit 的 tool_input:
{
  "file_path": "/Users/yujianjia/workspace/kafka/redwhisk/.claude/auto-commit.js",
  "old_string": "...",
  "new_string": "...",
  "commitMessage": "refactor: 重写自动提交 Hook，支持 Agent 设置 message 和跟踪重复修改"
}
```

## 状态文件格式

Hook 使用 `os.tmpdir()/redwhisk-claude-auto-commit-state-v4.json` 存储状态：

```json
{
  "/repo/path:session-id": {
    "files": {
      "path/to/file.ts": {
        "lastModifiedAt": "2024-01-01T00:00:00.000Z",
        "committedAt": "2024-01-01T00:01:00.000Z"
      }
    },
    "commitMessage": "feat: Agent 设置的提交信息",
    "lastWriteAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## 回退逻辑

如果 Agent 没有设置 `commitMessage`，Hook 会回退到原来的自动生成逻辑：
- 分析文件类型
- 根据路径特征猜测 type
- 生成中文描述

## 与 Git 工作流规范的配合

Commit message 格式遵循 `docs/standards/git-workflow.md`：
- type 用英文小写：feat, fix, docs, refactor, test, chore, ...
- 描述用简体中文
- Agent 设置 message 时应遵循此格式
