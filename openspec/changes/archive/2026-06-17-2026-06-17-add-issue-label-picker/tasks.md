## 1. Issue labels 数据模型

- [x] 1.1 为 issues 增加 label 持久化字段与 migration。
- [x] 1.2 更新前后端 issue 类型、create / update 输入与 hydration 逻辑。
- [x] 1.3 为 issue labels 增加后端测试。

## 2. Issue dialog labels 交互

- [x] 2.1 在 issue 新建 / 编辑表单中增加 labels 行，并加载项目级与全局 labels。
- [x] 2.2 实现带分隔线的下拉列表、`管理 labels` / `添加标签` 入口，以及选中后彩色 label chip 展示。
- [x] 2.3 实现从 issue 页面跳转到 Project Settings 的 `labels` tab。

## 3. 验证

- [x] 3.1 更新 `src/features/issues/issues-activity.test.tsx` 覆盖 labels 选择与 settings 跳转。
- [x] 3.2 运行 `pnpm lint`。
- [x] 3.3 运行 `pnpm typecheck`。
- [x] 3.4 运行 `pnpm exec vitest run src/features/issues/issues-activity.test.tsx src/app/app.test.tsx src/app/app-shell.test.tsx`。
- [x] 3.5 运行 `cargo test --manifest-path src-tauri/Cargo.toml --test issue`。
