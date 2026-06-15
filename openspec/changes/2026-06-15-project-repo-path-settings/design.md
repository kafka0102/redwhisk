## 上下文

现有实现里，`ProjectSettingsActivity` 的 General 表单只提交 `name` 与 `completionPolicy`。项目创建入口位于 `src/app/app.tsx`，点击 `Create Project` 后通过 Tauri dialog 选择目录，并立即调用 `createProject({ repoPath })`。后端 `ProjectService::create_project` 已具备路径规范化和 Git 仓校验能力，但 `update_project_settings` 仅校验项目名非空，不支持修改 `repo_path`。

这次需求本质上是让“项目元数据表单”同时服务于两条路径：

1. 已存在项目的 General 设置编辑。
2. 新项目创建前的确认弹窗。

## 关键假设与取舍

- `Repository path` 采用目录选择器驱动，而不是允许用户自由手输任意路径；表单中仍展示可读文本值，但主要修改入口是“选择目录”。
- 前端会在选择目录后尽早给出“不是 Git 仓库”的错误，减少无效提交；后端继续保留同样的强校验，避免前端绕过。
- 新建项目弹窗字段顺序和选项与 Settings `General` 保持一致，但不复用整个组件的保存逻辑，避免把“创建”和“更新”耦合到一套过度抽象里。
- 新建项目默认 `Git completion strategy` 为 `agent_auto_commit`，仅影响创建弹窗默认值；已有项目仍展示其当前持久化值。

## 交互设计

### Settings General

General 表单字段顺序改为：

1. `Project Name`
2. `Repository path`
3. `Git completion strategy`

`Repository path` 行展示：

- 只读或普通输入框样式的当前路径文本
- 右侧 `Choose folder` 按钮，点击后打开目录选择器
- 如当前选择路径不存在或不是 Git 仓库，在表单状态区显示错误并阻止保存

保存按钮启用条件扩展为：

- 名称非空
- 当前没有校验错误
- 名称 / 路径 / completion strategy 至少有一项发生变化

### Project 创建弹窗

创建流程调整为：

1. 用户点击 `Create Project`
2. 打开目录选择器
3. 若用户取消，则直接返回
4. 若目录不是 Git 仓库，留在 Project Home 并显示错误
5. 若目录有效，弹出 `New Project` 表单
6. 表单默认值：
   - `Project Name` = 目录 basename
   - `Repository path` = 刚选择的目录
   - `Git completion strategy` = `agent_auto_commit`
7. 用户点击确认后才调用 `createProject`

弹窗不支持再次从零启动目录选择流程外的复杂编辑，只需要允许重新选择目录、修改项目名和 completion strategy。

## 接口设计

### 前端命令

- `CreateProjectInput` 从仅含 `repoPath` 扩展为：
  - `name`
  - `repoPath`
  - `completionPolicy`
- `UpdateProjectSettingsInput` 从仅含 `name`、`completionPolicy` 扩展为：
  - `name`
  - `repoPath`
  - `completionPolicy`
- 新增轻量校验命令，例如 `validateProjectRepoPath`，用于在创建前或设置页切换路径时检查目录是否存在且为 Git 仓库；如果现有命令体系更适合复用 `create/update` 返回错误，也可以不新增命令，改为在提交时统一处理，但推荐单独校验以改善交互。

### 后端服务

- `ProjectService::create_project` 不再从路径推导名称，而是接收前端确认后的 `name` 与 `completion_policy`，但当传入名称为空时仍应拒绝。
- `ProjectService::update_project_settings` 需要对 `repo_path` 做与创建时一致的 `normalize_repo_path` 与 `is_git_repository` 校验。
- 更新仓库路径时不需要新增迁移，只需更新现有记录。

## 验证

实现阶段至少运行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test -- src/app/app.test.tsx src/features/settings/project-settings-activity.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml project`
