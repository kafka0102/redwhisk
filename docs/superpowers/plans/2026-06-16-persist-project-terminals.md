# Persist Project Terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目终端配置可持久化，并在再次打开项目时自动启动所有已保存终端，同时完成终端列表的紧凑化与编辑交互。

**Architecture:** 后端把“终端配置”与“PTY 运行实例”拆开：SQLite 保存 `project_terminal_configs`，`ProjectTerminalRegistry` 继续保存运行期 session 映射，并在 `open_project` 生命周期里按配置自动启动。前端把终端卡片状态升级为 `configId + sessionId + name + workingDir + launchCommand`，通过新的配置命令驱动列表初始化、编辑弹窗和删除逻辑，终端渲染仍复用现有 `TerminalSurface`。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Tauri commands、Rust + rusqlite、SQLite migrations、portable-pty。

---

## File Structure

- Create: `src-tauri/migrations/0021_project_terminal_configs.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/project_repository.rs`
- Create: `src-tauri/src/types/project_terminal_config.rs`
- Modify: `src-tauri/src/types/project_terminal.rs`
- Modify: `src-tauri/src/core/project_terminal_service.rs`
- Modify: `src-tauri/src/core/project_service.rs`
- Modify: `src-tauri/src/commands/project_terminal_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/project.rs`
- Modify: `src/features/terminals/project-terminal-commands.ts`
- Modify: `src/features/terminals/project-terminals-activity-state.ts`
- Modify: `src/features/terminals/project-terminals-activity.tsx`
- Create: `src/features/terminals/project-terminal-edit-dialog.tsx`
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/activity-router.tsx`
- Modify: `src/features/terminals/project-terminals-activity.test.tsx`
- Modify: `src/features/settings/project-settings-activity.test.tsx` only if Settings routing or dialog mounting assertions need updates
- Modify: `src/app/app.css`

## Task 1: 持久化项目终端配置并扩展返回类型

**Files:**
- Create: `src-tauri/migrations/0011_project_terminal_configs.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/project_repository.rs`
- Create: `src-tauri/src/types/project_terminal_config.rs`
- Modify: `src-tauri/src/types/project_terminal.rs`
- Modify: `src/features/terminals/project-terminal-commands.ts`

- [ ] **Step 1: 先写 Rust repository / migration 失败测试**

  在 `src-tauri/tests/project.rs` 新增测试，断言 `MigrationRunner::default()` 跑完后存在 `project_terminal_configs` 表，并至少包含：

  ```rust
  #[test]
  fn project_terminal_config_migration_creates_expected_schema() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let database = DatabaseConfig::new(temp_dir.path())
          .open()
          .expect("database");

      MigrationRunner::default()
          .run(&database.connection)
          .expect("migrations");

      let columns = table_columns(&database.connection, "project_terminal_configs");
      assert_eq!(
          columns,
          vec![
              "id",
              "project_id",
              "name",
              "working_dir",
              "launch_command",
              "created_at",
              "updated_at",
          ],
      );
  }
  ```

- [ ] **Step 2: 运行目标测试确认失败**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml project_terminal_config_migration_creates_expected_schema`

  Expected: FAIL，提示 `project_terminal_configs` 不存在。

- [ ] **Step 3: 新增 migration**

  创建 `src-tauri/migrations/0021_project_terminal_configs.sql`：

  ```sql
  CREATE TABLE IF NOT EXISTS project_terminal_configs (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    working_dir TEXT NOT NULL,
    launch_command TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_project_terminal_configs_project_id
    ON project_terminal_configs (project_id);
  ```

- [ ] **Step 4: 在 repository 增加配置读写接口**

  同时在 `src-tauri/src/db/migrations.rs` 注册：

  ```rust
  const PROJECT_TERMINAL_CONFIGS_MIGRATION_VERSION: &str =
      "0021_project_terminal_configs";
  const PROJECT_TERMINAL_CONFIGS_MIGRATION_SQL: &str =
      include_str!("../../migrations/0021_project_terminal_configs.sql");
  ```

  并把它加入 `MigrationRunner::default()` 返回的 migrations 列表尾部。

- [ ] **Step 5: 在 repository 增加配置读写接口**

  在 `src-tauri/src/db/project_repository.rs` 增加配置记录结构和以下最小方法：

  ```rust
  pub fn list_project_terminal_configs(
      &self,
      project_id: i64,
  ) -> rusqlite::Result<Vec<ProjectTerminalConfigRecord>>;

  pub fn insert_project_terminal_config(
      &self,
      project_id: i64,
      name: &str,
      working_dir: &str,
      launch_command: &str,
  ) -> rusqlite::Result<ProjectTerminalConfigRecord>;

  pub fn update_project_terminal_config(
      &self,
      id: i64,
      project_id: i64,
      name: &str,
      working_dir: &str,
      launch_command: &str,
  ) -> rusqlite::Result<ProjectTerminalConfigRecord>;

  pub fn delete_project_terminal_config(
      &self,
      id: i64,
      project_id: i64,
  ) -> rusqlite::Result<()>;
  ```

  时间戳沿用当前 `projects` 表的毫秒表达式。

- [ ] **Step 6: 扩展前后端终端类型**

  在 `src-tauri/src/types/project_terminal.rs` 和 `src/features/terminals/project-terminal-commands.ts` 中把创建/列表返回值升级为包含：

  ```ts
  {
    configId: number;
    sessionId: number;
    name: string;
    workingDir: string;
    launchCommand: string;
  }
  ```

  同时新增：

  ```ts
  export interface UpdateProjectTerminalConfigInput {
    projectId: number;
    configId: number;
    name: string;
    workingDir: string;
    launchCommand: string;
  }

  export interface ListProjectTerminalsInput {
    projectId: number;
  }
  ```

- [ ] **Step 7: 运行任务验证**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml project_terminal_config_migration_creates_expected_schema`

  Expected: PASS。

## Task 2: 在项目打开时自动启动已保存终端

**Files:**
- Modify: `src-tauri/src/core/project_terminal_service.rs`
- Modify: `src-tauri/src/core/project_service.rs`
- Modify: `src-tauri/src/commands/project_terminal_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/project.rs`

- [ ] **Step 1: 写失败测试，覆盖“打开项目自动恢复终端”**

  在 `src-tauri/tests/project.rs` 增加集成测试：

  ```rust
  #[test]
  fn open_project_restarts_saved_project_terminals() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let database = DatabaseConfig::new(temp_dir.path())
          .open()
          .expect("database");
      MigrationRunner::default()
          .run(&database.connection)
          .expect("migrations");

      let repo_dir = temp_dir.path().join("sample-repo");
      fs::create_dir_all(repo_dir.join(".git")).expect("git dir");

      let project = ProjectRepository::new(&database.connection)
          .insert_or_get_existing(
              "sample-repo",
              &repo_dir.to_string_lossy(),
              ProjectCompletionPolicy::Manual,
          )
          .expect("project");

      ProjectRepository::new(&database.connection)
          .insert_project_terminal_config(
              project.id,
              "web",
              &repo_dir.to_string_lossy(),
              "pnpm dev",
          )
          .expect("config");

      // 调用 open_project 对应服务后，断言至少返回或列出一个活跃终端条目
  }
  ```

  测试可通过 `ProjectTerminalService::list_terminals_in_data_dir(...)` 或等价接口验证自动启动结果。

- [ ] **Step 2: 运行目标测试确认失败**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml open_project_restarts_saved_project_terminals`

  Expected: FAIL，因为还没有自动恢复逻辑。

- [ ] **Step 3: 扩展 registry 与 service**

  在 `src-tauri/src/core/project_terminal_service.rs`：

  - 给 `ProjectTerminalSession` 增加 `config_id`、`working_dir`、`launch_command`。
  - 将 `create_terminal` 拆成“创建配置并启动”和“按现有配置启动”两个路径。
  - 新增：

    ```rust
    pub fn list_terminals(...)
    pub fn update_terminal_config(...)
    pub fn ensure_project_terminals_started(...)
    ```

  - `ensure_project_terminals_started` 读取当前项目全部配置；若某个 `config_id` 已有活跃 session 则跳过，否则启动新 session。
  - `launch_command` 为空时仍使用系统 shell；非空时用系统 shell 执行 `-lc <launch_command>` 或等价方式，确保能跑 `pnpm dev` 这类命令。

- [ ] **Step 4: 把自动启动接到项目打开路径**

  在 `src-tauri/src/core/project_service.rs` 的 `open_project_in_data_dir` / `open_project_for_window_in_data_dir` 路径里，在确认项目存在且 path 可用后调用 `ProjectTerminalService::ensure_project_terminals_started_in_data_dir(...)`。

  保持规则：

  - 单个终端启动失败不让 `open_project` 整体失败。
  - 项目记录的 `last_opened_at` 仍照常更新。

- [ ] **Step 5: 暴露列表与更新命令**

  在 `src-tauri/src/commands/project_terminal_commands.rs` 注册并实现：

  ```rust
  #[tauri::command]
  pub fn list_project_terminals(...)

  #[tauri::command]
  pub fn update_project_terminal_config(...)
  ```

  并在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中加入命令。

- [ ] **Step 6: 运行任务验证**

  Run:

  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml open_project_restarts_saved_project_terminals
  cargo test --manifest-path src-tauri/Cargo.toml project_terminal
  ```

  Expected: PASS。

## Task 3: 重做终端页状态、选中态和编辑弹窗

**Files:**
- Modify: `src/features/terminals/project-terminal-commands.ts`
- Modify: `src/features/terminals/project-terminals-activity-state.ts`
- Modify: `src/features/terminals/project-terminals-activity.tsx`
- Create: `src/features/terminals/project-terminal-edit-dialog.tsx`
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/activity-router.tsx`
- Modify: `src/app/app.css`

- [ ] **Step 1: 写前端失败测试，锁定编辑入口和稳定选中态**

  在 `src/features/terminals/project-terminals-activity.test.tsx` 新增至少两条测试：

  ```ts
  it("shows an edit button on hover and opens the terminal edit dialog", async () => {
    // 准备一个已存在 terminal card
    // hover card
    // 断言左侧 edit button 出现
    // click 后出现 role="dialog"
    // dialog 内含 Name / Path / Launch command 三个字段
  });

  it("uses a stable darker active background instead of random colors", async () => {
    // 创建两个 terminal
    // 断言激活态 style 包含固定 active 变量
    // 不再依赖 Math.random
  });
  ```

- [ ] **Step 2: 运行测试确认失败**

  Run: `pnpm test -- src/features/terminals/project-terminals-activity.test.tsx`

  Expected: FAIL，原因是当前没有 edit dialog，且选中态仍使用随机颜色。

- [ ] **Step 3: 升级终端状态与命令封装**

  在 `src/features/terminals/project-terminals-activity-state.ts` 中把 card 状态改成：

  ```ts
  export interface ProjectTerminalCardState {
    configId: number;
    sessionId: number;
    name: string;
    workingDir: string;
    launchCommand: string;
  }
  ```

  同时删掉 `selectedTerminalColor`，改为固定常量，例如：

  ```ts
  export const DEFAULT_TERMINAL_CARD_BACKGROUND = "#f8f8f6";
  export const ACTIVE_TERMINAL_CARD_BACKGROUND = "#e4e1d8";
  export const DEFAULT_TERMINAL_CARD_BORDER = "#d8d2c6";
  export const ACTIVE_TERMINAL_CARD_BORDER = "#b9b09f";
  ```

- [ ] **Step 4: 新增终端编辑弹窗**

  参考 `src/features/settings/agent-profile-form.tsx` 和 `src/features/agents/temporary-session-dialog.tsx` 的 dialog 结构，创建 `src/features/terminals/project-terminal-edit-dialog.tsx`，最小骨架：

  ```tsx
  export function ProjectTerminalEditDialog(props: ProjectTerminalEditDialogProps) {
    return (
      <div className="issue-dialog-overlay">
        <form aria-label="Edit terminal" className="issue-dialog issue-dialog--compact" role="dialog">
          <div className="issue-dialog__header">
            <h3>Edit terminal</h3>
          </div>
          <div className="issue-dialog__body issue-dialog__body--single">
            <label>
              <span>Name</span>
              <Input ... />
            </label>
            <label>
              <span>Path</span>
              <Input ... />
            </label>
            <label>
              <span>Launch command</span>
              <Input ... />
            </label>
          </div>
          <div className="issue-dialog__footer issue-dialog__footer--end">
            <Button type="button" variant="secondary">Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </div>
    );
  }
  ```

- [ ] **Step 5: 改造 `ProjectTerminalsActivity`**

  在 `src/features/terminals/project-terminals-activity.tsx`：

  - 首屏或 `projectId` 切换时调用 `listProjectTerminals({ projectId })` 装载已保存终端。
  - `createProjectTerminal` 返回的新条目直接写入完整 card state。
  - `selectTerminal` 只更新 `selectedSessionId`。
  - hover 左侧增加编辑按钮，图标用 `ArrowRight` 或仓库现有等价箭头图标。
  - 删除 `Math.random`、`SELECTED_TERMINAL_CARD_COLORS` 和 `getRandomSelectedTerminalColor`。
  - section 高度在现有基础上减少 10px，并让列表项 margin / gap 固定为 4px。
  - 保存编辑弹窗后，用 `updateProjectTerminalConfig` 回写后端，再更新本地 card state。

- [ ] **Step 6: 更新全局状态初始化**

  在 `src/app/app-shell.tsx` 保持“每个项目单独一份 terminals state”，但不要再假设 terminalCards 只能由“点击 + 按钮”产生；初次进入终端页后允许列表接口回填已保存终端。

- [ ] **Step 7: 运行任务验证**

  Run: `pnpm test -- src/features/terminals/project-terminals-activity.test.tsx`

  Expected: PASS。

## Task 4: 回填 OpenSpec、补齐回归测试并执行最终验证

**Files:**
- Modify: `src/features/terminals/project-terminals-activity.test.tsx`
- Modify: `src-tauri/tests/project.rs`
- Modify: `openspec/changes/2026-06-16-persist-project-terminals/tasks.md`
- Modify: `openspec/changes/2026-06-16-persist-project-terminals/proposal.md` only if implementation事实偏离
- Modify: `openspec/changes/2026-06-16-persist-project-terminals/design.md` only if实现路径改变

- [ ] **Step 1: 补充前端测试矩阵**

  在 `src/features/terminals/project-terminals-activity.test.tsx` 至少覆盖：

  - 初次加载已保存 terminals
  - hover 显示 edit 按钮
  - 编辑后名称 / 路径 / 启动命令在 UI 中更新
  - 删除时调用的是 `configId + sessionId` 对应后端
  - 选中态使用稳定加深配色

- [ ] **Step 2: 补充 Rust 测试矩阵**

  在 `src-tauri/tests/project.rs` 或 project terminal 相关测试中覆盖：

  - 创建 terminal 时默认保存 `repo_path`
  - 更新 terminal config 后重新打开项目能加载新值
  - 删除配置会关闭 session 且下次打开项目不再恢复

- [ ] **Step 3: 回填 OpenSpec tasks**

  在 `openspec/changes/2026-06-16-persist-project-terminals/tasks.md` 勾选实际完成项；如果实现过程中没有改变需求，不修改 proposal / design / spec delta 的语义内容。

- [ ] **Step 4: 运行最终前端验证**

  Run:

  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test
  ```

  Expected: 全部 PASS。若 `vitest` 继续打印 `HTMLCanvasElement` / `Could not parse CSS stylesheet` 警告，但退出码为 0，则记录为已知测试噪音，不视为失败。

- [ ] **Step 5: 运行最终 Rust 与 OpenSpec 验证**

  Run:

  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml project_terminal
  cargo test --manifest-path src-tauri/Cargo.toml project
  openspec validate 2026-06-16-persist-project-terminals --strict
  ```

  Expected: 全部 PASS。

- [ ] **Step 6: 提交实现**

  Run:

  ```bash
  git status --short
  git add openspec/changes/2026-06-16-persist-project-terminals \
    docs/superpowers/plans/2026-06-16-persist-project-terminals.md \
    src/features/terminals \
    src/app/app-shell.tsx \
    src/app/activity-router.tsx \
    src/app/app.css \
    src-tauri/src \
    src-tauri/tests/project.rs \
    src-tauri/migrations/0021_project_terminal_configs.sql
  git commit -m "feat: persist project terminal configs"
  ```

  只暂存本次 change 直接相关文件；若有无关脏文件，保持不动。
