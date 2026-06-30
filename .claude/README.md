# Claude 项目配置

本目录包含 Claude Code AI 助手的项目级配置。

## 自动提交 Hook

### 功能说明

`auto-commit.js` 是一个自动提交 Hook，它会：

- 在 Claude Code 主任务完成后提交改动
- 遵循项目的 [Git 工作流规范](../docs/standards/git-workflow.md)
- 优先提交 Claude 本轮实际写入的文件
- 生成符合规范的中文 commit message

### 工作原理

1. **跟踪写入文件**：`PostToolUse` 只记录 `Write` / `Edit` / `MultiEdit` / `NotebookEdit` 涉及的文件路径。
2. **任务完成提交**：`Stop` 在 Claude Code 主响应完成时触发自动提交。
3. **兜底提交**：如果没有记录到写入文件但工作区存在改动，会按配置提交当前 dirty 文件。
4. **提交日志**：提交结果写入系统临时目录下的 `redwhisk-claude-auto-commit.log`，不会污染仓库工作区。

### 配置

编辑 `.claude/auto-commit.json` 来调整行为配置：

```json
{
  "enabled": true,
  "maxFiles": 80,
  "commitDirtyFallback": true,
  "useChineseDescription": true,
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

### 项目级别 Hook 配置

本项目使用 Claude Code 的项目级 Hook 配置，通过 `.claude/settings.json` 实现：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/auto-commit.js",
            "timeout": 20
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/auto-commit.js",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### 禁用自动提交

如果需要临时禁用自动提交，可以：

1. 修改配置文件设置 `"enabled": false`
2. 或者临时重命名 `.claude/auto-commit.js`
3. 或者注释掉 `.claude/settings.json` 中的 hooks 配置
