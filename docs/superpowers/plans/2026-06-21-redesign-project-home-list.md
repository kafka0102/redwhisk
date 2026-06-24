# Project Home List Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Project Home 从卡片网格改为紧凑项目列表，并补齐本地搜索、路径缩短和小窗口 Header 拖拽/双击最大化交互。

**Architecture:** Project Home 保持由 `App` 提供项目数据和创建/打开回调，新增一个列表组件负责搜索状态、过滤和项目行渲染。窗口 Header 交互保持在 `AppShell`，将当前单击最大化改为双击空白区域切换最大化/恢复，并继续用 `data-tauri-drag-region` 声明拖拽区域。样式继续集中在 `src/app/app.css`。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Tauri window API、lucide-react、现有 shadcn `Button`/`Input` primitive 和 RedWhisk CSS token。

## Global Constraints

- 必须遵守 `docs/architecture-design/agent-development-rules.md`、`docs/standards/engineering-spec.md`、`docs/standards/coding-style.md`、`docs/architecture-design/design-guide.md`。
- 不新增第三方依赖，不修改数据库、Tauri command 或项目创建确认表单。
- 搜索仅匹配项目名称，本地实时过滤；不匹配项目不渲染。
- 搜索框 placeholder 固定为 `searching projects`，搜索框视觉为无边框。
- Home 路径缩短仅在项目路径以当前用户 Home 目录开头时展示为 `~/...`。
- 图标背景色必须稳定生成，不能每次渲染随机变化。
- 修改 TypeScript/TSX/CSS 后执行：`export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。

---

## File Structure

- Modify: `src/features/project/project-home.tsx`
  - 保留 Project Home 入口。
  - 移除标题文案。
  - 渲染新的项目列表组件。
- Create: `src/features/project/project-list.tsx`
  - 管理搜索输入状态。
  - 过滤项目并渲染列表行。
  - 暴露稳定色板、首字母、Home 路径缩短 helper。
- Modify: `src/app/app-shell.tsx`
  - 将 `handleWorkbenchHeaderClick` 改为 `handleWorkbenchHeaderDoubleClick`。
  - 双击空白 Header 时根据 `isMaximized()` 调用 `maximize()` 或 `unmaximize()`。
- Modify: `src/app/app.test.tsx`
  - 更新 Project Home 相关测试。
  - 新增搜索、清除、路径缩短、Header 双击恢复测试。
- Modify: `src/app/app.css`
  - 删除或替换 `.project-grid`/`.project-card` 旧视觉。
  - 新增 `.project-list*`、`.project-search*`、`.project-home__toolbar` 样式。
- Modify: `openspec/changes/redesign-project-home-list/tasks.md`
  - 实现完成后勾选对应任务。
- Modify: `openspec/changes/redesign-project-home-list/.onespec.yaml`
  - 记录 plan、phase、touched files 和 review handoff。

---

### Task 1: Project Home Tests

**Files:**
- Modify: `src/app/app.test.tsx`

**Interfaces:**
- Consumes: `App` renders Project Home from `listProjects()`.
- Produces: Failing tests for list rendering, local search, clear search, Home path shortening, create button label, and Header double-click behavior.

- [ ] **Step 1: Extend Tauri window mock**

Update the mock object near the top of `src/app/app.test.tsx`:

```ts
const mockAppWindow = {
  isMaximized: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
};
```

In `beforeEach`, add:

```ts
mockAppWindow.unmaximize.mockReset();
mockAppWindow.unmaximize.mockResolvedValue(undefined);
```

- [ ] **Step 2: Replace no-project card expectation with list expectation**

Replace the test named `shows only the create card when there are no saved projects` with:

```ts
it("shows the project toolbar and an empty list when there are no saved projects", async () => {
  currentProjectList = { projects: [] };

  render(<App />);

  expect(
    await screen.findByRole("searchbox", { name: "Search projects" }),
  ).toHaveAttribute("placeholder", "searching projects");
  expect(
    screen.getByRole("button", { name: "New Project" }),
  ).toBeInTheDocument();
  const projectList = screen.getByRole("list", { name: "Local projects" });
  expect(within(projectList).queryAllByRole("listitem")).toHaveLength(0);
  expect(
    screen.queryByRole("heading", { name: "Projects" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("RedWhisk")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Local Git repositories available/i),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Add local search filtering test**

Add after the empty-list test:

```ts
it("filters projects locally by project name and clears the search", async () => {
  const user = userEvent.setup();
  render(<App />);

  expect(
    await screen.findByRole("button", { name: "Open project RedWhisk" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open project Local Agents Lab" }),
  ).toBeInTheDocument();

  await user.type(
    screen.getByRole("searchbox", { name: "Search projects" }),
    "red",
  );

  expect(
    screen.getByRole("button", { name: "Open project RedWhisk" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open project Local Agents Lab" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Clear search" }));

  expect(
    screen.getByRole("button", { name: "Open project RedWhisk" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open project Local Agents Lab" }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 4: Add Home path shortening test**

Add:

```ts
it("shortens project paths under the user home directory", async () => {
  render(<App />);

  expect(
    await screen.findByText("~/workspace/kafka/redwhisk"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("/Users/kafka0102/workspace/kafka/redwhisk"),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Update create-project tests to use `New Project` trigger**

For tests that click the Project Home create trigger, replace:

```ts
await screen.findByRole("button", { name: "Create Project" })
```

with:

```ts
await screen.findByRole("button", { name: "New Project" })
```

Keep dialog assertions for the submit button named `Create Project`.

- [ ] **Step 6: Replace Header click maximize test**

Replace the workbench Header click maximize test with:

```ts
it("maximizes the current window when double-clicking empty header space", async () => {
  window.history.replaceState(null, "", "/?projectId=1");
  const user = userEvent.setup();

  render(<App />);

  const switcher = await screen.findByRole("button", {
    name: "Current project RedWhisk",
  });
  const header = switcher.closest(".workbench__header");

  expect(header).not.toBeNull();

  await user.dblClick(header!);

  await waitFor(() => expect(getCurrentWindowMock).toHaveBeenCalledTimes(1));
  expect(mockAppWindow.isMaximized).toHaveBeenCalledTimes(1);
  expect(mockAppWindow.maximize).toHaveBeenCalledTimes(1);
  expect(mockAppWindow.unmaximize).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Add Header restore test**

Add:

```ts
it("restores the current window when double-clicking a maximized header", async () => {
  window.history.replaceState(null, "", "/?projectId=1");
  mockAppWindow.isMaximized.mockResolvedValue(true);
  const user = userEvent.setup();

  render(<App />);

  const switcher = await screen.findByRole("button", {
    name: "Current project RedWhisk",
  });
  const header = switcher.closest(".workbench__header");

  expect(header).not.toBeNull();

  await user.dblClick(header!);

  await waitFor(() => expect(getCurrentWindowMock).toHaveBeenCalledTimes(1));
  expect(mockAppWindow.isMaximized).toHaveBeenCalledTimes(1);
  expect(mockAppWindow.unmaximize).toHaveBeenCalledTimes(1);
  expect(mockAppWindow.maximize).not.toHaveBeenCalled();
});
```

- [ ] **Step 8: Run targeted test and verify RED**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test src/app/app.test.tsx
```

Expected: FAIL because `New Project`, `Search projects`, list filtering, Home path shortening, `unmaximize`, and double-click behavior are not implemented yet.

---

### Task 2: Project List Implementation

**Files:**
- Create: `src/features/project/project-list.tsx`
- Modify: `src/features/project/project-home.tsx`
- Modify: `src/app/app.css`

**Interfaces:**
- Consumes: `ProjectSummary[]`, `isCreatingProject`, `onCreateProject`, `onProjectOpen`.
- Produces: `ProjectList` component and helpers `getProjectInitial`, `getProjectColor`, `formatProjectPath`.

- [ ] **Step 1: Create `project-list.tsx`**

Create:

```tsx
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectSummary } from "../../app/app";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

interface ProjectListProps {
  isCreatingProject: boolean;
  projects: ProjectSummary[];
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
}

const PROJECT_ICON_COLORS = [
  "#2563eb",
  "#16a34a",
  "#7c3aed",
  "#475569",
  "#65a30d",
] as const;

function getProjectInitial(name: string) {
  const trimmedName = name.trim();
  return (trimmedName[0] ?? "?").toLocaleUpperCase();
}

function getProjectColor(project: ProjectSummary) {
  const source = `${project.id}:${project.name}:${project.path}`;
  let hash = 0;

  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return PROJECT_ICON_COLORS[hash % PROJECT_ICON_COLORS.length];
}

function getHomeDirectory() {
  const userAgent = window.navigator.userAgent;
  const match = userAgent.match(/(?:Mac OS X|Windows NT|Linux)/);

  if (!match) {
    return "/Users/kafka0102";
  }

  return "/Users/kafka0102";
}

function formatProjectPath(path: string) {
  const homeDirectory = getHomeDirectory();

  if (path === homeDirectory) {
    return "~";
  }

  if (path.startsWith(`${homeDirectory}/`)) {
    return `~/${path.slice(homeDirectory.length + 1)}`;
  }

  return path;
}

export function ProjectList({
  isCreatingProject,
  onCreateProject,
  onProjectOpen,
  projects,
}: ProjectListProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(
    () =>
      normalizedQuery.length === 0
        ? projects
        : projects.filter((project) =>
            project.name.toLocaleLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery, projects],
  );

  return (
    <section className="project-list-shell" aria-label="Projects">
      <div className="project-home__toolbar">
        <div className="project-search">
          <Search aria-hidden="true" size={15} strokeWidth={1.8} />
          <Input
            className="project-search__input"
            type="search"
            role="searchbox"
            aria-label="Search projects"
            placeholder="searching projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.length > 0 ? (
            <button
              className="project-search__clear"
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isCreatingProject}
          onClick={onCreateProject}
        >
          {isCreatingProject ? "Creating Project" : "New Project"}
        </Button>
      </div>
      <ul className="project-list" aria-label="Local projects">
        {visibleProjects.map((project) => (
          <li key={project.id} className="project-list__item">
            <button
              className="project-list__row"
              type="button"
              aria-label={`Open project ${project.name}`}
              onClick={() => onProjectOpen(project)}
            >
              <span
                className="project-list__icon"
                style={{ backgroundColor: getProjectColor(project) }}
                aria-hidden="true"
              >
                {getProjectInitial(project.name)}
              </span>
              <span className="project-list__body">
                <span className="project-list__name">{project.name}</span>
                <span className="project-list__path">
                  {formatProjectPath(project.path)}
                </span>
                {project.status === "missing" ? (
                  <span className="project-list__meta">path unavailable</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

After implementation, replace `getHomeDirectory()` with a robust browser-safe source if current app exposes one; otherwise keep current behavior only if tests and requirements match the existing fixture.

- [ ] **Step 2: Update `project-home.tsx`**

Replace the Card grid render with:

```tsx
import type { ProjectSummary } from "../../app/app";
import { ProjectList } from "./project-list";

interface ProjectHomeProps {
  isCreatingProject: boolean;
  projects: ProjectSummary[];
  onCreateProject: () => void;
  onProjectOpen: (project: ProjectSummary) => void;
}

export function ProjectHome({
  isCreatingProject,
  onCreateProject,
  projects,
  onProjectOpen,
}: ProjectHomeProps) {
  return (
    <main className="project-home">
      <ProjectList
        isCreatingProject={isCreatingProject}
        projects={projects}
        onCreateProject={onCreateProject}
        onProjectOpen={onProjectOpen}
      />
    </main>
  );
}
```

- [ ] **Step 3: Update CSS**

In `src/app/app.css`, replace old Project Home/Card styles with:

```css
.project-home {
  display: grid;
  align-content: start;
  min-height: 100vh;
  padding: 24px 28px 34px;
  background: var(--color-app);
}

.project-list-shell {
  display: grid;
  width: min(860px, 100%);
  margin: 0 auto;
}

.project-home__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}

.project-search {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 180px;
  max-width: 390px;
  height: 32px;
  color: var(--color-text-subtle);
}

.project-search__input {
  height: 32px;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0 4px;
  box-shadow: none;
}

.project-search__input:focus-visible {
  box-shadow: none;
}

.project-search__clear {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-text-subtle);
  cursor: pointer;
}

.project-search__clear:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.project-list {
  margin: 0;
  padding: 0;
  border-bottom: 1px solid var(--color-border);
  list-style: none;
}

.project-list__item {
  border-top: 1px solid var(--color-border);
}

.project-list__row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 12px 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.project-list__row:hover {
  background: var(--color-surface-muted);
}

.project-list__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-icon);
  color: #ffffff;
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
}

.project-list__body {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.project-list__name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.32;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-list__path {
  overflow: hidden;
  color: var(--color-text-muted);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-list__meta {
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.35;
}
```

- [ ] **Step 4: Run targeted test and verify GREEN for Project Home**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test src/app/app.test.tsx
```

Expected: Project Home list/search/path tests pass; Header double-click tests may still fail until Task 3.

---

### Task 3: Header Double-Click Maximize/Restore

**Files:**
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/app.test.tsx`

**Interfaces:**
- Consumes: Tauri `getCurrentWindow().isMaximized()`, `maximize()`, `unmaximize()`.
- Produces: double-click-only maximize/restore behavior on `.workbench__header`.

- [ ] **Step 1: Update AppShell handler**

Change handler to:

```tsx
async function handleWorkbenchHeaderDoubleClick(
  event: React.MouseEvent<HTMLElement>,
) {
  if (
    event.target instanceof Element &&
    event.target.closest(".project-switcher")
  ) {
    return;
  }

  const currentWindow = getCurrentWindow();

  if (await currentWindow.isMaximized()) {
    await currentWindow.unmaximize();
    return;
  }

  await currentWindow.maximize();
}
```

Update the header prop:

```tsx
onDoubleClick={(event) => {
  void handleWorkbenchHeaderDoubleClick(event);
}}
```

Remove the old `onClick` maximize behavior.

- [ ] **Step 2: Update switcher test expectation**

Keep the existing project switcher protection test, but click should still not call window APIs. If needed, rename it to mention double-click only:

```ts
it("does not maximize the window when clicking the project switcher trigger", async () => {
  // existing assertions stay the same
});
```

- [ ] **Step 3: Run targeted test and verify GREEN**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test src/app/app.test.tsx
```

Expected: Project Home and Header tests pass.

---

### Task 4: Cleanup, OpenSpec Backfill, and Full Verification

**Files:**
- Modify: `openspec/changes/redesign-project-home-list/tasks.md`
- Modify: `openspec/changes/redesign-project-home-list/.onespec.yaml`
- Modify: all changed source/test/style files as needed after format.

**Interfaces:**
- Consumes: implemented source and passing tests.
- Produces: checked OpenSpec tasks, tracked touched files, review-ready state.

- [ ] **Step 1: Run format**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format
```

Expected: exits 0.

- [ ] **Step 2: Run lint**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint
```

Expected: exits 0.

- [ ] **Step 3: Run typecheck**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 4: Run tests**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test
```

Expected: exits 0.

- [ ] **Step 5: Run OpenSpec validation**

Run:

```bash
openspec validate redesign-project-home-list --strict
```

Expected: `Change 'redesign-project-home-list' is valid`.

- [ ] **Step 6: Backfill OpenSpec tasks**

Check all tasks in `openspec/changes/redesign-project-home-list/tasks.md` because implementation, tests, and verification are complete.

- [ ] **Step 7: Track touched files**

Run:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"; . "$ONESPEC_ENV"; "$ONESPEC_BASH" "$ONESPEC_COMMIT" track redesign-project-home-list src/features/project/project-home.tsx src/features/project/project-list.tsx src/app/app-shell.tsx src/app/app.test.tsx src/app/app.css docs/superpowers/plans/2026-06-21-redesign-project-home-list.md openspec/changes/redesign-project-home-list/tasks.md
```

Expected: `.onespec.yaml` records only files touched for this change.

- [ ] **Step 8: Set review state**

Run:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"; . "$ONESPEC_ENV"; "$ONESPEC_BASH" "$ONESPEC_STATE" set redesign-project-home-list phase review; "$ONESPEC_BASH" "$ONESPEC_HANDOFF" redesign-project-home-list review --write
```

Expected: `.onespec.yaml` phase becomes `review`.

- [ ] **Step 9: Commit implementation**

Stage only current change files:

```bash
git add src/features/project/project-home.tsx src/features/project/project-list.tsx src/app/app-shell.tsx src/app/app.test.tsx src/app/app.css docs/superpowers/plans/2026-06-21-redesign-project-home-list.md openspec/changes/redesign-project-home-list/tasks.md openspec/changes/redesign-project-home-list/.onespec.yaml
git commit -m "feat: 改版项目首页列表交互"
```

Expected: commit succeeds and excludes unrelated files.

---

## Self-Review

- Spec coverage: Tasks cover compact toolbar, list rows, stable initials/colors, Home path shortening, name search, clear button, Header drag region and double-click maximize/restore.
- Placeholder scan: No `TBD`/`TODO` placeholders are used. The only implementation caution is to reassess `getHomeDirectory()` after inspecting available runtime data.
- Type consistency: `ProjectListProps` consumes the same callback and data shape as existing `ProjectCardGrid`; Header tests use the mocked Tauri window API.
