# 任务清单

## 1. OpenSpec 与设计约束

- [x] 1.1 新增 agents-ui spec delta，描述 Session Tab 工具入口、终端 Tab 和浏览器 Tab 行为。
- [x] 1.2 明确复用现有临时 Session 终端能力，不新增后端持久配置。

## 2. 前端结构与组件拆分

- [x] 2.1 梳理 `agents-activity.tsx` 中现有 Session Tab、终端入口和终端面板状态。
- [x] 2.2 拆分 Session 工具 Tab 容器组件，保持 Activity 负责数据流和选中 Session 状态。
- [x] 2.3 移除顶部独立终端图标入口，改为 Tab 栏 `+` 下拉菜单。
- [x] 2.4 实现终端工具 Tab：新增、关闭、多开、切换和 10 个上限提示。
- [x] 2.5 将现有内联终端渲染迁移到终端 Tab 内容区，避免继续显示在页面底部。
- [x] 2.6 实现浏览器工具 Tab 组件：地址输入、Enter 访问或刷新、嵌入浏览区域。
- [x] 2.7 补齐新增可见文案的国际化。

## 3. 测试与验证

- [x] 3.1 补充或更新 React 测试，覆盖 `+` 菜单、终端新增关闭、终端上限提示、浏览器地址提交。
- [x] 3.2 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`。
- [x] 3.3 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`。
- [x] 3.4 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`。
- [x] 3.5 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`。
- [x] 3.6 运行 `openspec validate session-tab-tools --strict`。
