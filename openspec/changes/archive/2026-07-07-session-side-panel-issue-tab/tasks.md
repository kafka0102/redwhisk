# 任务清单

## 1. OpenSpec 与交互入口

- [x] 1.1 为 `agents-ui` 补充 Session side panel 的 `Issue` tab 规格。
- [x] 1.2 将 “打开指定 Issue 详情” 的回调从 `AppShell` 传递到 `AgentsActivity`。

## 2. Session side panel 实现

- [x] 2.1 扩展 `SessionSidePanelTab`，在存在关联 Issue 时渲染置顶 `Issue` tab。
- [x] 2.2 新增 Issue 面板组件，加载当前 Session 关联的 Issue 详情并展示标题、描述、标签。
- [x] 2.3 增加 `查看 issue` link button，点击后切换到 Issues Activity 并打开该 Issue 详情。
- [x] 2.4 补充 side panel 样式与国际化文案。

## 3. 测试与验证

- [x] 3.1 更新或新增 Agents Activity 测试，覆盖 `Issue` tab 的默认展示、标签展示和跳转。
- [x] 3.2 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`
- [x] 3.3 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`
- [x] 3.4 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`
- [x] 3.5 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`
