# Backlog Issue Dialog And Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 backlog issue 弹窗实现单栏布局、附件块插入/预览/下载/删除，以及运行 prompt 的附件路径注入，同时保持 running/review/completed 弹窗行为不变。

**Architecture:** 前端继续以 `issues-activity` 作为入口，扩展 `IssueDescriptionEditor` 支持 attachment token 与内嵌附件块。后端新增 `issue_attachments` 持久化、附件文件复制与预览/导出命令，运行 prompt 通过 repo 相对路径引用附件。新建 issue 通过“先建 issue、再落附件、再回写 description token”的最小事务路径实现。

**Tech Stack:** React 19、TypeScript、Tiptap Markdown、Tauri 2、Rust、rusqlite、Vitest

---

### Task 1: 扩展后端附件数据模型

**Files:**
- Create: `src-tauri/migrations/0018_issue_attachments.sql`
- Create: `src-tauri/src/db/issue_attachment_repository.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/types/issue.rs`
- Test: `src-tauri/tests/issue.rs`

- [ ] **Step 1: 先写 Rust 测试，定义附件元数据预期**

```rust
#[test]
fn create_issue_persists_attachment_metadata() {
    // 断言 issue_attachments 可按 issue_id 读回 display_name / relative_path / is_previewable
}
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue create_issue_persists_attachment_metadata`
Expected: FAIL，提示缺少表、类型或 repository

- [ ] **Step 3: 新增 migration 与 repository 的最小实现**

```sql
CREATE TABLE IF NOT EXISTS issue_attachments (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  is_previewable INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues (id) ON DELETE CASCADE
);
```

```rust
pub struct IssueAttachmentRecord {
    pub id: i64,
    pub issue_id: i64,
    pub display_name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub mime_type: Option<String>,
    pub file_size: i64,
    pub kind: IssueAttachmentKind,
    pub is_previewable: bool,
    pub created_at: i64,
}
```

- [ ] **Step 4: 重新运行单测确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue create_issue_persists_attachment_metadata`
Expected: PASS

- [ ] **Step 5: 提交当前任务**

```bash
git add src-tauri/migrations/0018_issue_attachments.sql src-tauri/src/db/issue_attachment_repository.rs src-tauri/src/db/mod.rs src-tauri/src/types/issue.rs src-tauri/tests/issue.rs
git commit -m "feat: add issue attachment storage"
```

### Task 2: 实现 create/update issue 附件提交流程

**Files:**
- Modify: `src-tauri/src/types/issue.rs`
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/src/db/issue_repository.rs`
- Modify: `src-tauri/src/commands/issue_commands.rs`
- Test: `src-tauri/tests/issue.rs`

- [ ] **Step 1: 为 create/update issue 写失败测试**

```rust
#[test]
fn create_issue_copies_selected_files_and_rewrites_attachment_tokens() {
    // 输入 description 含临时 token，断言创建后 token 被真实 attachment id 替换
}

#[test]
fn update_issue_removes_deleted_attachments_and_keeps_order() {
    // 断言删除附件后 description 顺序与数据库一致
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue create_issue_copies_selected_files_and_rewrites_attachment_tokens update_issue_removes_deleted_attachments_and_keeps_order`
Expected: FAIL，提示输入字段或服务逻辑缺失

- [ ] **Step 3: 增加附件输入类型并实现最小服务逻辑**

```rust
pub struct IssueAttachmentDraftInput {
    pub token: String,
    pub source_path: String,
    pub display_name: String,
}
```

```rust
fn rewrite_attachment_tokens(
    description: &str,
    token_mapping: &HashMap<String, i64>,
) -> String {
    // 把 {{issue-attachment-temp:...}} 替换为 {{issue-attachment:<id>}}
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue create_issue_copies_selected_files_and_rewrites_attachment_tokens update_issue_removes_deleted_attachments_and_keeps_order`
Expected: PASS

- [ ] **Step 5: 提交当前任务**

```bash
git add src-tauri/src/types/issue.rs src-tauri/src/core/issue_service.rs src-tauri/src/db/issue_repository.rs src-tauri/src/commands/issue_commands.rs src-tauri/tests/issue.rs
git commit -m "feat: persist issue attachments during save"
```

### Task 3: 实现附件预览与下载命令

**Files:**
- Modify: `src-tauri/src/types/issue.rs`
- Modify: `src-tauri/src/core/issue_service.rs`
- Modify: `src-tauri/src/commands/issue_commands.rs`
- Test: `src-tauri/tests/issue.rs`

- [ ] **Step 1: 先写失败测试覆盖文本预览和二进制禁预览**

```rust
#[test]
fn preview_issue_attachment_returns_text_for_previewable_text_file() {}

#[test]
fn preview_issue_attachment_rejects_non_previewable_binary_file() {}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue preview_issue_attachment_returns_text_for_previewable_text_file preview_issue_attachment_rejects_non_previewable_binary_file`
Expected: FAIL

- [ ] **Step 3: 实现预览 / 导出命令**

```rust
pub struct IssueAttachmentPreview {
    pub attachment_id: i64,
    pub kind: String,
    pub text_content: Option<String>,
    pub absolute_path: Option<String>,
}
```

```rust
pub fn export_issue_attachment(...) -> Result<(), CommandError> {
    std::fs::copy(&source_path, &target_path)?;
    Ok(())
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue preview_issue_attachment_returns_text_for_previewable_text_file preview_issue_attachment_rejects_non_previewable_binary_file`
Expected: PASS

- [ ] **Step 5: 提交当前任务**

```bash
git add src-tauri/src/types/issue.rs src-tauri/src/core/issue_service.rs src-tauri/src/commands/issue_commands.rs src-tauri/tests/issue.rs
git commit -m "feat: add issue attachment preview and export"
```

### Task 4: 扩展 run prompt，注入附件路径

**Files:**
- Modify: `src/features/issues/run-prompt-builder.ts`
- Modify: `src/features/issues/run-prompt-builder.test.ts`
- Modify: `src/features/issues/issue-commands.ts`

- [ ] **Step 1: 为 prompt builder 写失败测试**

```ts
it("includes repo-relative attachment paths as a stable source", () => {
  expect(preview.sources.map((source) => source.id)).toContain("issue-attachments");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/features/issues/run-prompt-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现附件 source 和最终 prompt 拼接**

```ts
sources.push({
  id: "issue-attachments",
  label: "Issue attachments",
  content: attachmentPaths.join("\n"),
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/features/issues/run-prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: 提交当前任务**

```bash
git add src/features/issues/run-prompt-builder.ts src/features/issues/run-prompt-builder.test.ts src/features/issues/issue-commands.ts
git commit -m "feat: include issue attachments in run prompt"
```

### Task 5: 扩展前端编辑器 attachment block 与弹窗布局

**Files:**
- Modify: `src/features/issues/issue-description-editor.tsx`
- Modify: `src/features/issues/issues-activity.tsx`
- Modify: `src/app/app.css`
- Test: `src/features/issues/issues-activity.test.tsx`

- [ ] **Step 1: 先写前端失败测试**

```ts
it("renders backlog issue dialogs without a right sidebar", async () => {});

it("inserts an attachment card after file selection", async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/features/issues/issues-activity.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 backlog 单栏弹窗与 attachment block**

```tsx
const isBacklogDialog = dialogMode === "create" || selectedIssue?.status === "backlog";
```

```tsx
<IssueDescriptionEditor
  attachments={form.attachments}
  onInsertAttachment={handleInsertAttachment}
  onRemoveAttachment={handleRemoveAttachment}
  onPreviewAttachment={handlePreviewAttachment}
  onDownloadAttachment={handleDownloadAttachment}
/>
```

- [ ] **Step 4: 重新运行测试确认通过**

Run: `pnpm test -- src/features/issues/issues-activity.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交当前任务**

```bash
git add src/features/issues/issue-description-editor.tsx src/features/issues/issues-activity.tsx src/app/app.css src/features/issues/issues-activity.test.tsx
git commit -m "feat: add backlog attachment editor UI"
```

### Task 6: 实现附件预览框与下载交互

**Files:**
- Modify: `src/features/issues/issues-activity.tsx`
- Modify: `src/app/app.css`
- Test: `src/features/issues/issues-activity.test.tsx`

- [ ] **Step 1: 写失败测试覆盖查看按钮显隐与预览框**

```ts
it("shows preview action only for previewable attachments", async () => {});

it("opens a preview dialog for image and text attachments", async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/features/issues/issues-activity.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现预览框和下载流程**

```tsx
{attachment.isPreviewable ? (
  <button aria-label={`查看 ${attachment.displayName}`}>...</button>
) : null}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/features/issues/issues-activity.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交当前任务**

```bash
git add src/features/issues/issues-activity.tsx src/app/app.css src/features/issues/issues-activity.test.tsx
git commit -m "feat: add issue attachment preview dialog"
```

### Task 7: 端到端验证与收尾

**Files:**
- Modify: `openspec/changes/2026-06-13-refine-backlog-issue-dialog/tasks.md`
- Modify: `openspec/changes/2026-06-13-refine-backlog-issue-dialog/design.md`（仅当实现事实有变化）
- Modify: `openspec/changes/2026-06-13-refine-backlog-issue-dialog/specs/issues-ui/spec.md`（仅当实现事实有变化）

- [ ] **Step 1: 运行前端静态检查**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 2: 运行 TypeScript 检查**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 运行前端受影响测试**

Run: `pnpm test -- src/features/issues/issues-activity.test.tsx src/features/issues/run-prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 4: 运行 Rust 受影响测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml issue`
Expected: PASS

- [ ] **Step 5: 回填 OpenSpec tasks 并提交**

```bash
git add openspec/changes/2026-06-13-refine-backlog-issue-dialog/tasks.md openspec/changes/2026-06-13-refine-backlog-issue-dialog/design.md openspec/changes/2026-06-13-refine-backlog-issue-dialog/specs/issues-ui/spec.md
git commit -m "docs: update openspec task completion"
```
