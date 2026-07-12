# Claude Code 项目入口

本仓库的 Agent 指令以 AGENTS.md 为单一事实源。Claude Code 不会自动读取 AGENTS.md，
通过下方 import 拉入；所有规则以 AGENTS.md 为准，本文件不再重复维护。

@AGENTS.md

## Agent skills

### Issue tracker

Issue 统一记录在 GitHub Issues 中。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认五类 triage 标签。详见 `docs/agents/triage-labels.md`。

### Domain docs

采用单上下文布局：根目录 `CONTEXT.md` 与 `docs/adr/`。详见 `docs/agents/domain.md`。
