## 1. Project Settings General

- [x] 1.1 扩展 General 表单字段，新增 `Repository path` 展示与目录选择入口。
- [x] 1.2 将 General 保存逻辑扩展为提交 `name`、`repoPath`、`completionPolicy`，并在前端阻止保存无效 Git 仓目录。
- [x] 1.3 更新 Settings 相关测试，覆盖路径选择、脏状态判断、错误提示与成功保存。

## 2. Project 创建流程

- [x] 2.1 调整 Project Home 创建入口，在选择目录后先校验 Git 仓有效性，再打开 `New Project` 弹窗。
- [x] 2.2 为创建弹窗实现与 General 一致的字段结构，并设置默认值：项目名取仓库名，completion strategy 默认 `agent_auto_commit`。
- [x] 2.3 仅在用户确认弹窗后调用 `createProject`，并补充取消、非 Git 仓和创建失败场景测试。

## 3. 命令与后端校验

- [x] 3.1 扩展前端 project commands 类型，使创建和更新都支持 `name`、`repoPath`、`completionPolicy`。
- [x] 3.2 更新 Tauri command / service / project types，使创建和更新路径都执行项目名非空、路径规范化和 Git 仓校验。
- [x] 3.3 补充 Rust 测试，覆盖更新仓库路径成功与非 Git 仓失败。

## 4. 验证

- [x] 4.1 运行 `pnpm lint`。
- [x] 4.2 运行 `pnpm typecheck`。
- [x] 4.3 运行 `pnpm test -- src/app/app.test.tsx src/features/settings/project-settings-activity.test.tsx`。
- [x] 4.4 运行 `cargo test --manifest-path src-tauri/Cargo.toml project`。
