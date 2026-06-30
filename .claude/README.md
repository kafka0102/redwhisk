# Claude 项目配置

本目录包含 Claude Code AI 助手的项目级配置。

## 自动提交 Hook

### 功能说明

`auto-commit.js` 是一个智能自动提交 Hook，它会：

- 自动检测 Agent 任务完成
- 遵循项目的 [Git 工作流规范](../docs/standards/git-workflow.md)
- 只提交与当前任务相关的文件
- 生成符合规范的中文 commit message

### 工作原理

1. **跟踪工具使用**：记录每次写操作（Write/Edit/MultiEdit/DeleteFile）
2. **检测任务完成**：当 8 秒内没有写操作且 Agent 在使用读/总结工具时
3. **智能提交**：自动检测 git 状态，生成合适的 commit message
4. **反馈给 Agent**：提交成功后会通过 additionalContext 告诉 Agent

### 配置

编辑 `.claude/auto-commit.json` 来调整配置：

```json
{
  "enabled": true,
  "maxFiles": 30,
  "useChineseDescription": true,
  "excludePatterns": [
    "node_modules/",
    "dist/",
    "build/",
    ".git/",
    ".DS_Store",
    "*.log",
    "tmp/",
    "temp/",
    ".claude/",
    ".planning/"
  ]
}
```

### 全局设置

全局 wrapper 脚本位于 `~/.claude/hooks/auto-commit-wrapper.js`，它会自动检测当前项目是否有 `.claude/auto-commit.js`，如果有就使用项目级别的配置。

### 禁用自动提交

如果需要临时禁用自动提交，可以：

1. 修改配置文件设置 `"enabled": false`
2. 或者临时重命名 `.claude/auto-commit.js`
