# 任务清单

## 1. OpenSpec

- [x] 1.1 为 `issues-ui` 补充只读 Issue 双栏布局与右侧会话信息/运行参数规格。

## 2. 实现

- [x] 2.1 调整只读 Issue header 边距：分割线全宽，标题与动作区各 10px 内边距。
- [x] 2.2 将只读详情主体改为双栏，左右内容区各 10px 边距，右侧宽度对齐 session side panel 默认 400px。
- [x] 2.3 新增右侧会话侧栏组件：上方会话信息（含“查看会话”），下方运行参数；数据来自关联 session。
- [x] 2.4 在 `IssuesActivity` 接入右侧栏所需回调与空态处理。
- [x] 2.5 补齐样式与国际化文案（会话信息标题“会话信息”等）。

## 3. 验证

- [x] 3.1 更新或新增只读 Issue 详情布局与会话信息展示测试。
- [x] 3.2 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`
- [x] 3.3 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`
- [x] 3.4 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`
- [x] 3.5 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`
- [x] 3.6 运行 `openspec validate issue-readonly-dual-column-session-panel --strict`
