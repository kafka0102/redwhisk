# CLAUDE.md

本项目对 Claude Code 的统一协作规则以 [AGENTS.md](./AGENTS.md) 为准。

Claude Code 在开始任何任务前必须先读取并遵守：

1. [AGENTS.md](./AGENTS.md)
2. [docs/README.md](./docs/README.md)
3. 与本次任务直接相关的 `docs/**` 正式文档

补充说明：

- 若 `AGENTS.md` 与某份 `docs/**` 的概括存在冲突，以对应 `docs/**` 正式文档为准。
- 若用户明确给出与 `AGENTS.md` 不同的要求，以用户要求为准。
- 为避免多处维护规则，除 Claude Code 专属补充外，不要在本文件重复抄写 `AGENTS.md` 内容。

## Claude Code 工作流程要求

### 🔴 必须自动提交 Git

Claude Code **必须**在完成每个开发任务后，自动创建 git 提交，无需用户提醒：

1. 完成任务后 → 先运行验证（lint、typecheck、test 等）
2. 验证通过 → 自动暂存相关文件
3. 创建有意义的 commit message（描述清楚做了什么）
4. 完成提交

### 任务完成的标准

- 运行相关验证（lint、typecheck、test 等）
- 所有验证通过
- 创建 git 提交（只包含任务相关文件）
- 工作区干净
- 告知用户完成
