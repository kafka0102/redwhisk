# Tasks

- [x] 1. 更新 `src/features/agents/session-changes-panel.tsx`：将 `session-commit-row__remote-tag` 移到 `session-commit-row__author` 之后并置于 button 直接子级；仅最上方第一条已推送 commit 渲染 tag
- [x] 2. 更新 `src/app/app.css`：`session-commit-row` 加 `position: relative`；`session-commit-row__content` 加 `overflow: hidden`；`session-commit-row__remote-tag` 改为绝对定位 `right: 4px`、垂直居中、`z-index: 1`，移除其 `flex: 0 0 auto`
- [x] 3. 更新 `openspec/specs/agents-ui/spec.md`：替换 committed changes 占位 scenario，补充已推送 tag 显示规则
- [x] 4. 运行 lint / typecheck，运行 `openspec validate reposition-pushed-branch-tag --strict`
