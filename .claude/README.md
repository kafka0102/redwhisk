# Claude 项目配置

本目录包含 Claude Code AI 助手的项目级配置。

## 自动提交 Hook

### 功能说明

`auto-commit.js` 是一个自动提交 Hook，它会：

- 在 Claude Code 主任务完成后检测未提交改动
- 通过 Stop hook 反馈提示词，交由 Claude 按 [Git 工作流规范](../docs/standards/git-workflow.md) 自行编写 message 并提交
- 仅针对 Claude 本轮实际写入的文件发起提交提示
- 自身不生成 message、不执行 `git add` / `git commit`

### 工作原理

1. **跟踪写入文件**：`PostToolUse` 只记录 `Write` / `Edit` / `MultiEdit` / `NotebookEdit` 涉及的文件路径。
2. **任务完成反馈**：`Stop` 在 Claude Code 主响应完成时触发；若存在本任务产生的未提交改动，通过 `decision: "block"` + `reason` 把提交提示词喂回主 Agent。
3. **由 Claude 提交**：主 Agent 收到提示后自行 `git add` + `git commit`，message 遵循 Git 工作流规范。
4. **兜底提示**：如果没有记录到写入文件但工作区存在改动，且开启 `commitDirtyFallback`，会对全部 dirty 文件发起提交提示。
5. **循环防护**：连续 block 达上限后放行 Stop，避免无限循环；无 dirty 改动时复位计数。
6. **提交日志**：Hook 行为写入系统临时目录下的 `redwhisk-claude-auto-commit.log`，不会污染仓库工作区。

更详细的机制与 v4 差异见 [auto-commit-usage.md](./auto-commit-usage.md)。

### 配置

编辑 `.claude/auto-commit.json` 来调整行为配置：

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
