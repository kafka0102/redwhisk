## Why

当前 Project Settings 的 `General` 只能修改项目名和 completion strategy，无法在应用内更换仓库目录，也没有在修改时重新校验目录是否仍然是有效 Git 仓库。Project Home 的创建流程则是在用户选完目录后立即创建项目，缺少一个可确认和可编辑的表单步骤，用户也无法在创建前看到默认项目名和 completion strategy。

这导致两个问题：

- 仓库路径相关配置分散在“创建时一次性决定”和“之后无法在 Settings 中维护”之间，无法形成一致的项目元数据编辑入口。
- 创建流程虽然在后端会拒绝非 Git 目录，但前端交互不够完整，无法让用户在确认前调整项目名，也无法把默认 completion strategy 固定为这次需求要求的 `auto commit`。

## What Changes

- 在 Project Settings 的 `General` 表单中新增 `Repository path` 字段，提供目录选择入口，并在保存前校验所选目录是 Git 仓库。
- 扩展项目设置更新接口，使其支持同时更新项目名、仓库路径和 Git completion strategy；后端在更新时继续做路径规范化和 Git 仓校验。
- 调整 Project Home 的创建流程：用户先选择仓库目录，前端先校验该目录是否为 Git 仓库；校验通过后不立刻创建，而是弹出与 Settings `General` 一致字段结构的表单。
- 新建项目弹窗默认使用仓库目录名作为 `Project Name`，默认将 `Git completion strategy` 设为 `auto commit`，用户确认后再创建项目。
- 保留后端 `create_project` 的 Git 仓强校验，确保前端校验失败或被绕过时仍然不会写入无效项目。

## Capabilities

### Modified Capabilities

- `settings-ui`: 扩展 General 表单，支持仓库路径选择与 Git 仓校验。
- `project-registry`: 定义项目创建前确认表单、默认值和 Git 仓前置校验流程。

## 影响

- 前端：`src/features/settings/project-settings-activity.tsx`、`src/app/app.tsx`、项目创建相关组件与样式、对应测试。
- 前后端命令：`src/features/project/project-commands.ts`、Tauri `project_commands` / `project_service` / project types 需要支持更新仓库路径与创建前表单输入。
- 测试：补充 Settings General 的新字段与校验行为，补充 Project Home 创建弹窗、默认值和错误提示测试，补充 Rust service/command 测试覆盖更新仓库路径的校验。
- 数据模型：不新增 migration，继续复用现有 `projects.repo_path` 和 `completion_policy` 字段。
