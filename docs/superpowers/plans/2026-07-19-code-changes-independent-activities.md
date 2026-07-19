# Code / Changes 拆分为独立 Activity 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 `features/code/code-workspace.tsx`（单一外壳 + 受控 `view` prop 同时承载「代码」与「变更」两个 Activity）拆成两个完全独立的 Activity 容器 `CodeActivity` / `ChangesActivity`，消除 `view` 分支判断，且两者各自持有独立的分支选择与缓存（在 code 选 A 分支不影响 changes 选的 B 分支）。

**Architecture:** 抽出无状态共享层——`shared/workspace/use-workspace-shell.ts`（hook：roots 轮询 / selectRoot / selectedRoot / sidebarWidth / splitter 拖拽 / root 失效自动切换）与 `shared/workspace/workspace-shell.tsx`（布局组件：`<section>` + 分支下拉 + splitter + sidebar/main 双 slot）。两个 Activity 各自调用 hook、各自管理独立 cache、各自装配布局组件。底层渲染件（`FileTreePanel` / `DiffViewer` / `WorkspaceChangesPanels` / `CodeContent` / `CodeBreadcrumb`）与 CSS `code-workspace__*` 类名不动，编辑器逻辑零复制。

**Tech Stack:** React 19 + TypeScript + Vitest + @testing-library/react；Tauri command（不经 HTTP）；i18n 走 `shared/i18n`。

## Global Constraints

- 默认简体中文输出所有说明；代码/命令/标识符/路径不翻译。
- 命名：目录/文件 `kebab-case`，变量/函数 `camelCase`，类型/接口 `PascalCase`。
- 跨 feature 复用的代码放 `src/shared/`；`shared` 不得反向依赖 `src/features/`。
- 改动前端源码后必跑门禁：`pnpm format`（复查 `git status --short`）→ `pnpm lint` → `pnpm typecheck` → `pnpm test`（受影响）→ `bash scripts/check-frontend-file-size.sh`。每个 task 末尾按需跑。
- 提交信息：`<type>: <简体中文描述>`，无 scope；正文尾追加 `Refs: #136`（本任务分支 issue-136）；尾行 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 重构保持现有可访问名称、按钮文案、DOM role、键盘行为、错误展示行为不变。
- 拆分不增加 IPC / 网络调用次数（两个 Activity 互斥渲染，同一刻仅一个挂载，roots 轮询不重复）。

---

## File Structure

**新建：**
- `src/shared/workspace/use-workspace-shell.ts` + `.test.ts` — 共享 hook（工作区框架逻辑，无状态持久化）
- `src/shared/workspace/workspace-shell.tsx` + `.test.tsx` — 无状态两栏布局组件（分支下拉 + splitter + sidebar/main slot）
- `src/features/code/code-activity.tsx` + `.test.tsx` — 代码 Activity 容器
- `src/features/changes/changes-activity.tsx` + `.test.tsx` — 变更 Activity 容器
- `src/features/changes/changes-workspace-cache.ts` — 变更独立缓存
- `docs/adr/0018-code-changes-independent-activities.md` — 记录决策变更

**移动（`git mv`，保留 blame）：**
- `src/features/code/use-code-workspace-roots.ts` → `src/shared/workspace/use-code-workspace-roots.ts`
- `src/features/code/use-code-workspace-roots.test.ts` → `src/shared/workspace/use-code-workspace-roots.test.ts`

**修改：**
- `src/features/code/code-workspace-cache.ts` — 删 `CodeWorkspaceView` 与 changes 折叠态字段，重命名导出为 `codeWorkspaceCache` / `resetCodeWorkspaceCacheForTests`
- `src/features/changes/code-workspace-changes-view.tsx` + `.test.tsx` — 简化为「变更侧栏内容」组件（去 branchBar/splitter/布局，仅渲染 `WorkspaceChangesPanels` + 跑 changes data hooks）
- `src/app/activity-router.tsx` — `code` → `<CodeActivity>`、`changes` → `<ChangesActivity>`，去掉 `view` prop
- `src/app/app-shell.test.tsx` — mock 拆为两个 Activity
- `docs/adr/0008-*.md`、`docs/adr/0009-*.md` — 顶部状态标注「被 ADR-0018 修订」

**删除：**
- `src/features/code/code-workspace.tsx`（外壳，逻辑已分散到 code-activity + 共享层）
- `src/features/code/code-workspace.test.tsx`（有效用例迁移到 `code-activity.test.tsx`）

**不动：** `code-content.tsx`、`code-breadcrumb.tsx`、`use-code-workspace-file-tree.ts(+test)`、`use-code-workspace-changes.ts(+test)`、`use-code-workspace-diff.ts(+test)`、`use-changes-auto-refresh.ts(+test)`、`app.css`（`code-workspace__*` 类名）。

---

## Task 1: 把 `useCodeWorkspaceRoots` 移到 `shared/workspace/`

**Files:**
- Move: `src/features/code/use-code-workspace-roots.ts` → `src/shared/workspace/use-code-workspace-roots.ts`
- Move: `src/features/code/use-code-workspace-roots.test.ts` → `src/shared/workspace/use-code-workspace-roots.test.ts`
- Modify: `src/features/code/code-workspace.tsx`（仅改一行 import 路径，保持旧外壳编译）

**Interfaces:**
- Produces: `useCodeWorkspaceRoots(projectId, initialRoots, enabled)` 签名不变，仅目录与 import 路径变更。

- [ ] **Step 1: 用 `git mv` 移动源文件与测试**

```bash
git mv src/features/code/use-code-workspace-roots.ts src/shared/workspace/use-code-workspace-roots.ts
git mv src/features/code/use-code-workspace-roots.test.ts src/shared/workspace/use-code-workspace-roots.test.ts
```

- [ ] **Step 2: 修正移动后文件的内部 import 路径**

`use-code-workspace-roots.ts` 原 import 用 `../../shared/...`（从 `features/code/` 出发两层到仓库根）；移到 `shared/workspace/` 后只需一层。把：

```ts
import { subscribeTauriEvent } from "../../shared/tauri-event/use-tauri-event";
import {
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  listCodeWorkspaceRoots,
  type CodeWorkspaceRoot,
  type CodeWorkspaceRootsUpdatedEvent,
} from "../../shared/workspace/workspace-commands";
```

改为：

```ts
import { subscribeTauriEvent } from "../tauri-event/use-tauri-event";
import {
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT,
  listCodeWorkspaceRoots,
  type CodeWorkspaceRoot,
  type CodeWorkspaceRootsUpdatedEvent,
} from "./workspace-commands";
```

测试文件 `use-code-workspace-roots.test.ts` 的 import 路径同样按新位置校正（用 Read 确认其现有 import，把 `../../shared/workspace/...` 改为相对新位置的路径，例如被测文件改为 `./use-code-workspace-roots`、command mock 改为 `./workspace-commands`、tauri-event mock 改为 `../tauri-event/use-tauri-event`）。

- [ ] **Step 3: 修正旧外壳 `code-workspace.tsx` 的 import**

把 `src/features/code/code-workspace.tsx` 第 41 行：

```ts
import { useCodeWorkspaceRoots } from "./use-code-workspace-roots";
```

改为：

```ts
import { useCodeWorkspaceRoots } from "../../shared/workspace/use-code-workspace-roots";
```

（旧外壳在本计划 Task 7 才删，期间必须保持编译。）

- [ ] **Step 4: 验证 lint / typecheck / 受影响测试**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
pnpm test -- use-code-workspace-roots
```
Expected: 全部通过；`git status --short` 仅显示本次移动 + 一行 import 改动，无无关文件。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: useCodeWorkspaceRoots 移至 shared/workspace

为 code/changes 拆分独立 Activity 做准备：工作区分支轮询是两个 Activity
都要复用的横切能力，按 shared 依赖方向移出 features/code。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 新建共享 hook `useWorkspaceShell`

**Files:**
- Create: `src/shared/workspace/use-workspace-shell.ts`
- Create: `src/shared/workspace/use-workspace-shell.test.ts`

**Interfaces:**
- Consumes: `useCodeWorkspaceRoots(projectId, initialRoots, enabled)`（Task 1 已移到本目录）。
- Produces:
  - `selectInitialRoot(roots: CodeWorkspaceRoot[]): CodeWorkspaceRoot | null`（模块导出，给 Activity 算初始 root 用）
  - `DEFAULT_SIDEBAR_WIDTH` 常量（= 400）
  - `useWorkspaceShell({ projectId, initialRoots, initialSelectedRootPath, initialSidebarWidth, onRootChange }): { roots, selectedRootPath, selectedRoot, selectedRootWorkspacePath, selectRoot, sidebarWidth, beginResize }`
  - `onRootChange?: () => void`：root 切换或被清空时回调，供 Activity 清理自身状态（code 清 tabs，changes 清 diff）。

- [ ] **Step 1: 写失败测试 `use-workspace-shell.test.ts`**

```ts
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SIDEBAR_WIDTH,
  selectInitialRoot,
  useWorkspaceShell,
} from "./use-workspace-shell";

vi.mock("./workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  listCodeWorkspaceRoots: vi.fn(),
}));
vi.mock("../tauri-event/use-tauri-event", () => ({
  subscribeTauriEvent: () => () => {},
}));

const projectRoot = { branch: "main", path: "/tmp/repo", isProjectRoot: true };
const featureRoot = {
  branch: "issue-1",
  path: "/tmp/repo.wt/issue-1",
  isProjectRoot: false,
};

describe("selectInitialRoot", () => {
  it("returns the project root when present", () => {
    expect(selectInitialRoot([featureRoot, projectRoot])).toEqual(projectRoot);
  });

  it("returns null when no project root exists", () => {
    expect(selectInitialRoot([featureRoot])).toBeNull();
  });
});

describe("useWorkspaceShell", () => {
  beforeEach(() => {
    vi.mocked(listCodeWorkspaceRoots).mockReset();
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({
      roots: [projectRoot],
    });
  });

  it("exposes the default sidebar width constant as 400", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(400);
  });

  it("initializes selectedRoot from initialSelectedRootPath when it exists in roots", async () => {
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({
      roots: [projectRoot, featureRoot],
    });
    const { result } = renderHook(() =>
      useWorkspaceShell({
        projectId: 1,
        initialRoots: [projectRoot, featureRoot],
        initialSelectedRootPath: featureRoot.path,
        initialSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      }),
    );

    expect(result.current.selectedRootWorkspacePath).toBe(featureRoot.path);
  });

  it("falls back to the project root when the cached selected root disappears", async () => {
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({ roots: [projectRoot] });
    const { result } = renderHook(() =>
      useWorkspaceShell({
        projectId: 1,
        initialRoots: [projectRoot],
        initialSelectedRootPath: "/tmp/repo.wt/gone",
        initialSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      }),
    );

    await vi.waitFor(() => {
      expect(result.current.selectedRootWorkspacePath).toBe(projectRoot.path);
    });
  });

  it("invokes onRootChange when selectRoot is called", async () => {
    const onRootChange = vi.fn();
    vi.mocked(listCodeWorkspaceRoots).mockResolvedValue({
      roots: [projectRoot, featureRoot],
    });
    const { result } = renderHook(() =>
      useWorkspaceShell({
        projectId: 1,
        initialRoots: [projectRoot, featureRoot],
        initialSelectedRootPath: projectRoot.path,
        initialSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        onRootChange,
      }),
    );

    await vi.waitFor(() => {
      expect(result.current.roots).toHaveLength(2);
    });

    act(() => {
      result.current.selectRoot(featureRoot);
    });

    expect(result.current.selectedRootWorkspacePath).toBe(featureRoot.path);
    expect(onRootChange).toHaveBeenCalled();
  });
});
```

import 行补 `listCodeWorkspaceRoots`（在第一个 `vi.mock` 里已引用，顶部需加 `import { listCodeWorkspaceRoots } from "./workspace-commands";`）。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test -- use-workspace-shell
```
Expected: FAIL，报 `Cannot find module "./use-workspace-shell"`。

- [ ] **Step 3: 写实现 `use-workspace-shell.ts`**

```ts
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CodeWorkspaceRoot } from "./workspace-commands";
import { useCodeWorkspaceRoots } from "./use-code-workspace-roots";

export const DEFAULT_SIDEBAR_WIDTH = 400;

/**
 * 默认分支 = 项目根（即仓库当前分支）；项目根不存在时返回 null（显示为空），
 * 不回退到 roots[0]，与「默认分支不存在则显示为空」诉求一致。
 */
export function selectInitialRoot(
  roots: CodeWorkspaceRoot[],
): CodeWorkspaceRoot | null {
  return roots.find((root) => root.isProjectRoot) ?? null;
}

interface UseWorkspaceShellOptions {
  projectId: number;
  initialRoots: CodeWorkspaceRoot[];
  /** 初始选中分支路径（来自各自 Activity 的 cache）；为 null 时回退到项目根。 */
  initialSelectedRootPath: string | null;
  initialSidebarWidth: number;
  /** root 切换或被清空时通知调用方清理自身状态（code 清 tabs，changes 清 diff）。 */
  onRootChange?: () => void;
}

export interface UseWorkspaceShellResult {
  roots: CodeWorkspaceRoot[];
  /** 用户选择的分支路径（root 失效切换时也会更新），用于持久化到各自 cache。 */
  selectedRootPath: string | null;
  /** 实际生效的 root（selectedRootPath 命中则取它，否则回退到项目根）。 */
  selectedRoot: CodeWorkspaceRoot | null;
  selectedRootWorkspacePath: string | null;
  selectRoot: (root: CodeWorkspaceRoot) => void;
  sidebarWidth: number;
  beginResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

/**
 * 代码 / 变更两个 Activity 共享的「工作区框架」逻辑：分支轮询、root 选择、侧栏
 * 宽度拖拽、选中分支被删时自动切默认分支。无状态持久化——初始值由调用方从各自
 * cache 传入，由调用方负责把 selectedRootPath / sidebarWidth 写回各自 cache。
 *
 * 两个 Activity 各自实例化本 hook：因 Activity 互斥渲染，同一刻仅一个挂载，
 * `useCodeWorkspaceRoots` 的轮询不会重复。
 */
export function useWorkspaceShell({
  projectId,
  initialRoots,
  initialSelectedRootPath,
  initialSidebarWidth,
  onRootChange,
}: UseWorkspaceShellOptions): UseWorkspaceShellResult {
  const { roots: workspaceRoots } = useCodeWorkspaceRoots(
    projectId,
    initialRoots,
    true,
  );

  const [selectedRootPath, setSelectedRootPath] = useState<string | null>(
    initialSelectedRootPath,
  );
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // onRootChange 用 ref 桥接，避免它成为 selectRoot / effect 的频繁依赖。
  const onRootChangeRef = useRef(onRootChange);
  onRootChangeRef.current = onRootChange;

  const selectedRoot = useMemo(
    () =>
      workspaceRoots.find((root) => root.path === selectedRootPath) ??
      selectInitialRoot(workspaceRoots),
    [selectedRootPath, workspaceRoots],
  );

  const selectRoot = useCallback((root: CodeWorkspaceRoot) => {
    setSelectedRootPath(root.path);
    onRootChangeRef.current?.();
  }, []);

  // 选中分支被删（roots 更新后不再存在）→ 自动切默认分支；默认分支也不存在 → 清空。
  // setState 放进微任务，避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (selectedRootPath === null || workspaceRoots.length === 0) return;
    if (workspaceRoots.some((root) => root.path === selectedRootPath)) return;
    const projectRoot = workspaceRoots.find((root) => root.isProjectRoot);
    void Promise.resolve().then(() => {
      if (projectRoot) {
        selectRoot(projectRoot);
      } else {
        setSelectedRootPath(null);
        onRootChangeRef.current?.();
      }
    });
  }, [workspaceRoots, selectedRootPath, selectRoot]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const beginResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
        setSidebarWidth(
          Math.min(640, Math.max(230, startWidth + moveEvent.clientX - startX)),
        );
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current?.();
      dragCleanupRef.current = onMouseUp;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  return {
    roots: workspaceRoots,
    selectedRootPath,
    selectedRoot,
    selectedRootWorkspacePath: selectedRoot?.path ?? null,
    selectRoot,
    sidebarWidth,
    beginResize,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test -- use-workspace-shell
```
Expected: PASS（全部用例）。

- [ ] **Step 5: 验证门禁**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
```
Expected: 通过；`git status --short` 仅两个新文件。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: 抽取共享工作区框架 hook useWorkspaceShell

封装 roots 轮询 / selectRoot / 侧栏宽度拖拽 / root 失效自动切换，供 code
与 changes 两个 Activity 各自独立复用；初始值与持久化由调用方传入，hook 不
持有跨 Activity 状态。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 新建无状态布局组件 `WorkspaceShell`

**Files:**
- Create: `src/shared/workspace/workspace-shell.tsx`
- Create: `src/shared/workspace/workspace-shell.test.tsx`

**Interfaces:**
- Produces: `WorkspaceShell({ ariaLabel, loadingBranchText, roots, selectedRoot, onSelectRoot, sidebarWidth, onBeginResize, sidebar, main })`。
  - 渲染 `<section class="code-workspace">` + `<aside>`（内含分支下拉 + `{sidebar}`）+ splitter + `<main>{main}</main>`。
  - 分支下拉（`DropdownMenu`）由本组件用 `roots` / `selectedRoot` / `onSelectRoot` 内部构造，复用 `code-workspace__branch` / `code-workspace__branch-bar` 类名（CSS 不动）。

- [ ] **Step 1: 写失败测试 `workspace-shell.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceShell } from "./workspace-shell";

const projectRoot = { branch: "main", path: "/tmp/repo", isProjectRoot: true };
const featureRoot = {
  branch: "issue-1",
  path: "/tmp/repo.wt/issue-1",
  isProjectRoot: false,
};

describe("WorkspaceShell", () => {
  it("renders the selected branch, sidebar slot and main slot", () => {
    render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading"
        roots={[projectRoot]}
        selectedRoot={projectRoot}
        onSelectRoot={() => {}}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={<div>sidebar content</div>}
        main={<div>main content</div>}
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("sidebar content")).toBeInTheDocument();
    expect(screen.getByText("main content")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "400",
    );
  });

  it("shows the loading text when no root is selected", () => {
    render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading branches"
        roots={[]}
        selectedRoot={null}
        onSelectRoot={() => {}}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={null}
        main={null}
      />,
    );

    expect(screen.getByText("Loading branches")).toBeInTheDocument();
  });

  it("lists all roots and fires onSelectRoot on pick", async () => {
    const user = userEvent.setup();
    const onSelectRoot = vi.fn();
    render(
      <WorkspaceShell
        ariaLabel="Code"
        loadingBranchText="Loading"
        roots={[projectRoot, featureRoot]}
        selectedRoot={projectRoot}
        onSelectRoot={onSelectRoot}
        sidebarWidth={400}
        onBeginResize={() => {}}
        sidebar={null}
        main={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /main/ }));
    await user.click(screen.getByRole("menuitem", { name: "issue-1" }));

    expect(onSelectRoot).toHaveBeenCalledWith(featureRoot);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test -- workspace-shell
```
Expected: FAIL，`Cannot find module "./workspace-shell"`。

- [ ] **Step 3: 写实现 `workspace-shell.tsx`**

```tsx
import { ChevronDown } from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui";
import type { CodeWorkspaceRoot } from "./workspace-commands";

interface WorkspaceShellProps {
  ariaLabel: string;
  /** 分支下拉未选中时的占位文案（如 messages.agentsFeature.loadingCode）。 */
  loadingBranchText: string;
  roots: CodeWorkspaceRoot[];
  selectedRoot: CodeWorkspaceRoot | null;
  onSelectRoot: (root: CodeWorkspaceRoot) => void;
  sidebarWidth: number;
  onBeginResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** 侧栏分支下拉之外的内容（code: 文件树；changes: 变更面板）。 */
  sidebar: ReactNode;
  /** 主区内容（code: tabs+编辑器；changes: diff 查看器）。 */
  main: ReactNode;
}

/**
 * 代码 / 变更两个 Activity 共享的无状态两栏布局：左侧分支下拉 + sidebar slot，
 * 右侧 main slot，中间可拖拽 splitter。复用既有 `code-workspace__*` CSS 类名。
 * 不持有任何跨 Activity 状态——roots / selectedRoot / onSelectRoot / sidebarWidth
 * 均由调用方（各自 Activity）传入。
 */
export function WorkspaceShell({
  ariaLabel,
  loadingBranchText,
  roots,
  selectedRoot,
  onSelectRoot,
  sidebarWidth,
  onBeginResize,
  sidebar,
  main,
}: WorkspaceShellProps) {
  return (
    <section
      className="code-workspace"
      aria-label={ariaLabel}
      style={{ "--code-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="code-workspace__sidebar">
        <div className="code-workspace__branch-bar">
          <DropdownMenu>
            <DropdownMenuTrigger className="code-workspace__branch">
              <span>{selectedRoot?.branch ?? loadingBranchText}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {roots.map((root) => (
                <DropdownMenuItem
                  key={root.path}
                  onClick={() => onSelectRoot(root)}
                >
                  {root.branch}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {sidebar}
      </aside>
      <div
        className="code-workspace__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={230}
        aria-valuemax={640}
        aria-valuenow={sidebarWidth}
        onMouseDown={onBeginResize}
      />
      <main className="code-workspace__main">{main}</main>
    </section>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test -- workspace-shell
```
Expected: PASS。

- [ ] **Step 5: 验证门禁**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
bash scripts/check-frontend-file-size.sh
```
Expected: 通过；`workspace-shell.tsx` 行数远低于 500。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: 抽取无状态工作区两栏布局组件 WorkspaceShell

封装 section/aside/分支下拉/splitter/main 骨架，code 与 changes 两个 Activity
通过 sidebar/main 双 slot 注入各自内容，复用 code-workspace__* CSS。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 拆分缓存为 code / changes 两份独立

**Files:**
- Modify: `src/features/code/code-workspace-cache.ts`
- Create: `src/features/changes/changes-workspace-cache.ts`

**Interfaces:**
- Produces:
  - `codeWorkspaceCache: Map<number, CachedCodeWorkspaceState>` + `resetCodeWorkspaceCacheForTests()`（code 侧，字段 `activePath` / `openFolders` / `selectedRootPath` / `sidebarWidth` / `tabs`）。
  - `changesWorkspaceCache: Map<number, CachedChangesWorkspaceState>` + `resetChangesWorkspaceCacheForTests()`（changes 侧，字段 `selectedRootPath` / `sidebarWidth` / `uncommittedChangesExpanded` / `committedChangesExpanded`）。
- 删除：`CodeWorkspaceView` 类型、合并态 `codeWorkspaceStateCache` / `resetCodeWorkspaceStateCacheForTests`。

> **注意：** 本 task 改名/删除的导出会被旧 `code-workspace.tsx`、`code-workspace.test.tsx`、`app-shell.test.tsx` 引用——它们在 Task 5 / 7 才更新。因此本 task 完成后 `pnpm typecheck` **预期暂时失败**（旧外壳引用已删的 `selectInitialRoot` 之外无碍，但引用了改名后的 cache）。为保持每个 task 可编译，**本 task 仅新增 changes cache + 修改 code-cache 文件导出名，并在同一 commit 内同步更新旧 `code-workspace.tsx`、`code-workspace.test.tsx`、`app-shell.test.tsx` 中对 cache 符号的引用**（最小改动：重命名引用、不删逻辑）。具体见步骤。

- [ ] **Step 1: 改写 `code-workspace-cache.ts`**

```ts
import type { WorkspaceFileContent } from "../../shared/workspace/workspace-commands";

export interface CodeFileTab {
  content: WorkspaceFileContent | null;
  errorMessage: string | null;
  fileName: string;
  filePath: string;
  isLoading: boolean;
  lastActiveAt: number;
}

/** 代码 Activity 按 projectId 持久化的工作区状态。 */
export interface CachedCodeWorkspaceState {
  activePath: string | null;
  /** 目录展开状态（react-arborist OpenMap），切页回来保持展开结构。 */
  openFolders: Record<string, boolean>;
  selectedRootPath: string | null;
  sidebarWidth: number;
  tabs: CodeFileTab[];
}

export const codeWorkspaceCache = new Map<number, CachedCodeWorkspaceState>();

export function resetCodeWorkspaceCacheForTests(): void {
  codeWorkspaceCache.clear();
}
```

- [ ] **Step 2: 新建 `changes-workspace-cache.ts`**

```ts
/** 变更 Activity 按 projectId 持久化的工作区状态（与 code 完全独立）。 */
export interface CachedChangesWorkspaceState {
  selectedRootPath: string | null;
  sidebarWidth: number;
  /** 「未提交变更」折叠面板是否展开，默认展开。 */
  uncommittedChangesExpanded: boolean;
  /** 「已提交变更」折叠面板是否展开，默认展开。 */
  committedChangesExpanded: boolean;
}

export const changesWorkspaceCache = new Map<
  number,
  CachedChangesWorkspaceState
>();

export function resetChangesWorkspaceCacheForTests(): void {
  changesWorkspaceCache.clear();
}
```

- [ ] **Step 3: 同步旧外壳与测试对 cache 符号的引用（保持编译）**

在 `src/features/code/code-workspace.tsx`：
- `import { codeWorkspaceStateCache, ... } from "./code-workspace-cache"` → 改名为 `codeWorkspaceCache`；
- 文件内所有 `codeWorkspaceStateCache` 调用 → `codeWorkspaceCache`；
- `CachedCodeWorkspaceState` 里的 `uncommittedChangesExpanded` / `committedChangesExpanded` 字段已删，故旧外壳写 cache 的对象字面量需删掉这两个字段；读 cache 处 `cachedState?.uncommittedChangesExpanded` / `committedChangesExpanded` 改为本地 state 默认值（`true`）。
- `import { ... type CodeWorkspaceView ... }` 删掉（已删类型）；`view: CodeWorkspaceView` prop 类型改为 `view: "files" | "changes"` 内联字面量（旧外壳临终态，Task 7 整体删除）。

在 `src/features/code/code-workspace.test.tsx`：
- `import { codeWorkspaceStateCache, resetCodeWorkspaceStateCacheForTests } from "./code-workspace-cache"` → `codeWorkspaceCache` / `resetCodeWorkspaceCacheForTests`；
- `beforeEach` 里 `resetCodeWorkspaceStateCacheForTests()` → `resetCodeWorkspaceCacheForTests()`；
- "switches to the default branch" 用例里 `codeWorkspaceStateCache.set(1, { ... uncommittedChangesExpanded, committedChangesExpanded })` → 删去这两个字段（用 `codeWorkspaceCache.set(1, { activePath: null, openFolders: {}, selectedRootPath: "/tmp/redwhisk.wt/issue-1", sidebarWidth: 400, tabs: [] })`）。

在 `src/app/app-shell.test.tsx`：无 cache 引用，跳过。

- [ ] **Step 4: 验证门禁**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
pnpm test -- code-workspace.test app-shell
```
Expected: 通过（旧外壳改名为 `codeWorkspaceCache` 后行为不变，所有原测试仍绿）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: 工作区缓存按 Activity 拆为 code/changes 两份独立

codeWorkspaceCache 仅留代码侧字段（tabs/activePath/openFolders/选中根/侧栏宽），
新增 changesWorkspaceCache 持有变更侧字段；删除 CodeWorkspaceView 与合并态。
为后续两个 Activity 独立持久化各自的分支选择做准备。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 新建 `CodeActivity`，迁移旧测试

**Files:**
- Create: `src/features/code/code-activity.tsx`
- Create: `src/features/code/code-activity.test.tsx`
- Modify: `src/features/code/code-workspace-helpers.ts`（保持 `resolveFileLoadErrorMessage` 等，`selectInitialRoot` 暂留——Task 7 再删）

**Interfaces:**
- Consumes:
  - `useWorkspaceShell`、`DEFAULT_SIDEBAR_WIDTH` from `../../shared/workspace/use-workspace-shell`
  - `WorkspaceShell` from `../../shared/workspace/workspace-shell`
  - `codeWorkspaceCache`、`CodeFileTab` from `./code-workspace-cache`
  - `resolveFileLoadErrorMessage` from `./code-workspace-helpers`
  - `useCodeWorkspaceFileTree` from `./use-code-workspace-file-tree`
  - `CodeBreadcrumb` / `CodeContent` / `FileTreePanel` / `readProjectWorktreeFile` 等
- Produces: `CodeActivity({ projectId, roots })`，由 `activity-router` 在 Task 7 渲染。

- [ ] **Step 1: 写实现 `code-activity.tsx`**

```tsx
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { FileTreePanel, type FileTreeOpenState } from "../../shared/workspace/file-tree-panel";
import {
  DEFAULT_SIDEBAR_WIDTH,
  useWorkspaceShell,
} from "../../shared/workspace/use-workspace-shell";
import { WorkspaceShell } from "../../shared/workspace/workspace-shell";
import {
  readProjectWorktreeFile,
  type CodeWorkspaceRoot,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import { CodeBreadcrumb } from "./code-breadcrumb";
import { CodeContent } from "./code-content";
import { type CodeFileTab, codeWorkspaceCache } from "./code-workspace-cache";
import { resolveFileLoadErrorMessage } from "./code-workspace-helpers";
import { useCodeWorkspaceFileTree } from "./use-code-workspace-file-tree";

const MAX_FILE_TABS = 10;

interface CodeActivityProps {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

/**
 * 「代码」Activity：文件树 + 多 tab 代码编辑器。分支选择、侧栏宽度、tabs 等状态
 * 持久化在 codeWorkspaceCache（仅 code 侧），与「变更」Activity 完全独立——在
 * code 切换分支不影响 changes 的选择，反之亦然。工作区框架逻辑（roots 轮询、
 * splitter、root 失效切换）复用 useWorkspaceShell + WorkspaceShell。
 */
export function CodeActivity({ projectId, roots }: CodeActivityProps) {
  const { contentFontSize, messages, theme, t } = useI18n();
  const cached = codeWorkspaceCache.get(projectId);
  const [tabs, setTabs] = useState<CodeFileTab[]>(() => cached?.tabs ?? []);
  const [activePath, setActivePath] = useState<string | null>(
    () => cached?.activePath ?? null,
  );
  const [openFolders, setOpenFolders] = useState<FileTreeOpenState>(
    () => cached?.openFolders ?? {},
  );
  const activePathRef = useRef<string | null>(cached?.activePath ?? null);
  const openFilePathsRef = useRef(
    new Set((cached?.tabs ?? []).map((tab) => tab.filePath)),
  );
  const fileNotFoundMessage = messages.agentsFeature.fileNotFound;

  const clearCodeState = useCallback(() => {
    openFilePathsRef.current.clear();
    activePathRef.current = null;
    setTabs([]);
    setActivePath(null);
    setOpenFolders({});
  }, []);

  const shell = useWorkspaceShell({
    projectId,
    initialRoots: roots,
    initialSelectedRootPath: cached?.selectedRootPath ?? null,
    initialSidebarWidth: cached?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    onRootChange: clearCodeState,
  });
  const { selectedRoot, selectedRootWorkspacePath, selectRoot } = shell;

  useEffect(() => {
    codeWorkspaceCache.set(projectId, {
      activePath,
      openFolders,
      selectedRootPath: shell.selectedRootPath,
      sidebarWidth: shell.sidebarWidth,
      tabs,
    });
  }, [
    activePath,
    openFolders,
    projectId,
    shell.selectedRootPath,
    shell.sidebarWidth,
    tabs,
  ]);

  const { tree, treeError, isTreeLoading, changedFileKinds } =
    useCodeWorkspaceFileTree(projectId, selectedRootWorkspacePath, true);

  // 切回代码页时复检已打开文件：缓存内容先展示，再异步校验是否被删除。
  useEffect(() => {
    if (!selectedRoot || tabs.length === 0) return;

    let isCurrent = true;
    const tabsToValidate = tabs;
    const workspacePath = selectedRoot.path;

    void Promise.all(
      tabsToValidate.map(async (tab) => {
        try {
          const content = await readProjectWorktreeFile({
            projectId,
            workspacePath,
            filePath: tab.filePath,
          });
          return {
            content,
            errorMessage: null as string | null,
            filePath: tab.filePath,
          };
        } catch (error) {
          return {
            content: null,
            errorMessage: resolveFileLoadErrorMessage(error, fileNotFoundMessage, t),
            filePath: tab.filePath,
          };
        }
      }),
    ).then((results) => {
      if (!isCurrent) return;
      const resultByPath = new Map(results.map((result) => [result.filePath, result]));
      setTabs((currentTabs) =>
        currentTabs.map((tab) => {
          const result = resultByPath.get(tab.filePath);
          if (!result) return tab;
          return {
            ...tab,
            content: result.content,
            errorMessage: result.errorMessage,
            isLoading: false,
          };
        }),
      );
    });

    return () => {
      isCurrent = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount/root revalidation
  }, [fileNotFoundMessage, projectId, selectedRoot?.path, t]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.filePath === activePath) ?? null,
    [activePath, tabs],
  );

  const openFile = useCallback(
    (file: WorkspaceFileTreeNode) => {
      if (!selectedRoot || file.kind !== "file") return;
      const now = Date.now();
      const previousActivePath = activePathRef.current;
      const isAlreadyOpen = openFilePathsRef.current.has(file.path);
      activePathRef.current = file.path;
      openFilePathsRef.current.add(file.path);
      setActivePath(file.path);
      setTabs((currentTabs) => {
        const existing = currentTabs.find((tab) => tab.filePath === file.path);
        if (existing) {
          return currentTabs.map((tab) =>
            tab.filePath === file.path ? { ...tab, lastActiveAt: now } : tab,
          );
        }
        const nextTab: CodeFileTab = {
          content: null,
          errorMessage: null,
          fileName: file.name,
          filePath: file.path,
          isLoading: true,
          lastActiveAt: now,
        };
        const retained =
          currentTabs.length < MAX_FILE_TABS
            ? currentTabs
            : currentTabs.filter(
                (tab) =>
                  tab.filePath !==
                  currentTabs
                    .filter(
                      (candidate) => candidate.filePath !== previousActivePath,
                    )
                    .sort((left, right) => left.lastActiveAt - right.lastActiveAt)[0]
                    ?.filePath,
              );
        currentTabs
          .filter((tab) => !retained.includes(tab))
          .forEach((tab) => openFilePathsRef.current.delete(tab.filePath));
        return [...retained, nextTab];
      });
      if (isAlreadyOpen) return;
      void readProjectWorktreeFile({
        projectId,
        workspacePath: selectedRoot.path,
        filePath: file.path,
      })
        .then((content) => {
          setTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === file.path
                ? { ...tab, content, errorMessage: null, isLoading: false }
                : tab,
            ),
          );
        })
        .catch((error) => {
          setTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === file.path
                ? {
                    ...tab,
                    errorMessage: resolveFileLoadErrorMessage(
                      error,
                      fileNotFoundMessage,
                      t,
                    ),
                    isLoading: false,
                  }
                : tab,
            ),
          );
        });
    },
    [fileNotFoundMessage, projectId, selectedRoot, t],
  );

  const closeTab = (filePath: string) => {
    openFilePathsRef.current.delete(filePath);
    setTabs((currentTabs) => {
      const remaining = currentTabs.filter((tab) => tab.filePath !== filePath);
      if (activePathRef.current === filePath) {
        const nextActivePath = remaining[remaining.length - 1]?.filePath ?? null;
        activePathRef.current = nextActivePath;
        setActivePath(nextActivePath);
      }
      return remaining;
    });
  };

  return (
    <WorkspaceShell
      ariaLabel={messages.agentsFeature.codeTab}
      loadingBranchText={messages.agentsFeature.loadingCode}
      roots={shell.roots}
      selectedRoot={selectedRoot}
      onSelectRoot={selectRoot}
      sidebarWidth={shell.sidebarWidth}
      onBeginResize={shell.beginResize}
      sidebar={
        <FileTreePanel
          changedFileKinds={changedFileKinds}
          errorMessage={treeError}
          fileTree={tree}
          initialOpenState={openFolders}
          isLoading={isTreeLoading}
          workspacePath={selectedRoot?.path}
          onOpenFile={openFile}
          onOpenStateChange={setOpenFolders}
        />
      }
      main={
        <>
          <div className="code-workspace__tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.filePath}
                aria-selected={activePath === tab.filePath}
                className="code-workspace__tab"
                role="tab"
                type="button"
                onClick={() => {
                  activePathRef.current = tab.filePath;
                  setActivePath(tab.filePath);
                  setTabs((current) =>
                    current.map((item) =>
                      item.filePath === tab.filePath
                        ? { ...item, lastActiveAt: Date.now() }
                        : item,
                    ),
                  );
                }}
              >
                <span>{tab.fileName}</span>
                <X
                  aria-label={messages.agentsFeature.closeTab(tab.fileName)}
                  size={13}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.filePath);
                  }}
                />
              </button>
            ))}
          </div>
          {activeTab ? (
            <>
              <CodeBreadcrumb
                filePath={activeTab.filePath}
                tree={tree}
                onOpenFile={openFile}
              />
              <CodeContent
                tab={activeTab}
                contentFontSize={contentFontSize}
                messages={messages}
                theme={theme}
              />
            </>
          ) : null}
        </>
      }
    />
  );
}
```

- [ ] **Step 2: 迁移测试到 `code-activity.test.tsx`**

把 `src/features/code/code-workspace.test.tsx` 的全部用例机械迁移到 `code-activity.test.tsx`，按下表替换；其余测试体（mock、断言）逐字保留：

| 原写法 | 新写法 |
| --- | --- |
| `import { ... codeWorkspaceStateCache, resetCodeWorkspaceStateCacheForTests } from "./code-workspace-cache"` | `import { codeWorkspaceCache, resetCodeWorkspaceCacheForTests } from "./code-workspace-cache"` |
| `import { CodeWorkspace } from "./code-workspace"` | `import { CodeActivity } from "./code-activity"` |
| `resetCodeWorkspaceStateCacheForTests()`（beforeEach） | `resetCodeWorkspaceCacheForTests()` |
| `<CodeWorkspace projectId={1} roots={roots} view="files" />`（每处） | `<CodeActivity projectId={1} roots={roots} />` |
| `describe("CodeWorkspace", ...)` | `describe("CodeActivity", ...)` |
| "switches to the default branch" 用例里 `codeWorkspaceStateCache.set(1, { activePath: null, openFolders: {}, selectedRootPath: "/tmp/redwhisk.wt/issue-1", sidebarWidth: 400, tabs: [] })` | `codeWorkspaceCache.set(1, { activePath: null, openFolders: {}, selectedRootPath: "/tmp/redwhisk.wt/issue-1", sidebarWidth: 400, tabs: [] })` |

迁移后 `code-activity.test.tsx` 的 import 段与一个代表用例如下（其余 10 个用例按上表替换，测试体不变）：

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  getProjectWorktreeChanges,
  getProjectWorktreeFileTree,
  listCodeWorkspaceRoots,
  readProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";
import {
  codeWorkspaceCache,
  resetCodeWorkspaceCacheForTests,
} from "./code-workspace-cache";
import { CodeActivity } from "./code-activity";

// （vi.mock 段、editorThemeProp、roots、fileContent 与原 code-workspace.test.tsx 完全一致，逐字复制）

describe("CodeActivity", () => {
  beforeEach(() => {
    resetCodeWorkspaceCacheForTests();
    // ...（与原 beforeEach 完全一致）
  });

  it("renders the workspace snapshot immediately and refreshes roots on mount", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(listCodeWorkspaceRoots).toHaveBeenCalledTimes(1);
  });

  // ...其余 10 个用例逐字迁移，仅按上表替换组件名 / cache 符号
});
```

- [ ] **Step 3: 运行新测试确认通过**

```bash
pnpm test -- code-activity
```
Expected: PASS（全部 11 个用例）。

- [ ] **Step 4: 验证门禁**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
bash scripts/check-frontend-file-size.sh
```
Expected: 通过；`code-activity.tsx` 行数检查（如超 500 行需按 `docs/architecture-design/frontend-large-component-splitting-rules.md` 拆分——预计 ~280 行，远低于阈值）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: 新建独立 CodeActivity 容器

代码 Activity 持有自己的分支选择与 codeWorkspaceCache，复用 useWorkspaceShell +
WorkspaceShell 承载工作区框架，文件树/tabs/编辑器逻辑与变更 Activity 解耦。
测试自 code-workspace.test 平移。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 简化变更视图 + 新建 `ChangesActivity`

**Files:**
- Modify: `src/features/changes/code-workspace-changes-view.tsx`
- Modify: `src/features/changes/code-workspace-changes-view.test.tsx`
- Create: `src/features/changes/changes-activity.tsx`
- Create: `src/features/changes/changes-activity.test.tsx`

**Interfaces:**
- Consumes:
  - `useWorkspaceShell`、`DEFAULT_SIDEBAR_WIDTH` from `../../shared/workspace/use-workspace-shell`
  - `WorkspaceShell` from `../../shared/workspace/workspace-shell`
  - `changesWorkspaceCache` from `./changes-workspace-cache`
  - `useCodeWorkspaceDiff` from `./use-code-workspace-diff`
  - `DiffViewer` from `../../shared/workspace/diff-viewer`
- Produces:
  - `CodeWorkspaceChangesView({ projectId, selectedRootWorkspacePath, uncommittedExpanded, committedExpanded, onToggleUncommitted, onToggleCommitted, onOpenChangedFile, onOpenCommittedChangedFile })` — 仅渲染 `WorkspaceChangesPanels`（变更侧栏内容），跑 changes data hooks；不再含分支下拉/splitter/布局/DiffViewer。
  - `ChangesActivity({ projectId, roots })` — 由 `activity-router` 在 Task 7 渲染。

- [ ] **Step 1: 改写 `code-workspace-changes-view.tsx` 为「变更侧栏内容」组件**

```tsx
import { WorkspaceChangesPanels } from "../../shared/workspace/workspace-changes-panels";
import type {
  WorkspaceChangedFile,
  WorkspaceCommitChangedFile,
} from "../../shared/workspace/workspace-commands";
import { useChangesAutoRefresh, useWorktreeRunningSession } from "./use-changes-auto-refresh";
import { useCodeWorkspaceChanges } from "./use-code-workspace-changes";

interface CodeWorkspaceChangesViewProps {
  projectId: number;
  selectedRootWorkspacePath: string | null;
  uncommittedExpanded: boolean;
  committedExpanded: boolean;
  onToggleUncommitted: () => void;
  onToggleCommitted: () => void;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onOpenCommittedChangedFile: (
    commitHash: string,
    file: WorkspaceCommitChangedFile,
  ) => void;
}

/**
 * 变更 Activity 的侧栏内容：接线变更数据 hooks（useCodeWorkspaceChanges /
 * useWorktreeRunningSession / useChangesAutoRefresh）并渲染 WorkspaceChangesPanels。
 * 分支下拉 / splitter / 布局 / DiffViewer 由 ChangesActivity + WorkspaceShell 承载，
 * 本组件不再负责。文件名保留 code-workspace- 前缀属历史包袱（ADR-0009），暂不更名。
 */
export function CodeWorkspaceChangesView({
  projectId,
  selectedRootWorkspacePath,
  uncommittedExpanded,
  committedExpanded,
  onToggleUncommitted,
  onToggleCommitted,
  onOpenChangedFile,
  onOpenCommittedChangedFile,
}: CodeWorkspaceChangesViewProps) {
  const {
    changes,
    isChangesLoading,
    changesErrorMessage,
    isChangesUnavailable,
    commitHistory,
    isCommitHistoryLoading,
    commitHistoryErrorMessage,
    isWorktree,
    baseBranch,
    refreshChanges,
    refreshCommitHistory,
  } = useCodeWorkspaceChanges(projectId, selectedRootWorkspacePath, true);

  const isWorktreeRunning = useWorktreeRunningSession(
    projectId,
    selectedRootWorkspacePath,
    true,
  );
  useChangesAutoRefresh({
    enabled: true,
    running: isWorktreeRunning,
    refreshChanges,
    refreshCommitHistory,
    isUnavailable: isChangesUnavailable,
  });

  return (
    <WorkspaceChangesPanels
      changes={changes}
      changesErrorMessage={changesErrorMessage}
      isChangesLoading={isChangesLoading}
      isUncommittedExpanded={uncommittedExpanded}
      onOpenChangedFile={onOpenChangedFile}
      onOpenCommittedChangedFile={onOpenCommittedChangedFile}
      onToggleUncommittedExpanded={onToggleUncommitted}
      commitHistory={commitHistory}
      commitHistoryErrorMessage={commitHistoryErrorMessage}
      isCommitHistoryLoading={isCommitHistoryLoading}
      isWorktree={isWorktree}
      baseBranch={baseBranch}
      isCommittedExpanded={committedExpanded}
      onToggleCommittedExpanded={onToggleCommitted}
    />
  );
}
```

- [ ] **Step 2: 更新 `code-workspace-changes-view.test.tsx`**

接口精简后，原测试断言的「分支下拉 main」「DiffViewer 空态」「文件树/刷新按钮不渲染」不再属于本组件职责（移到 `changes-activity.test.tsx`）。本测试聚焦「变更侧栏接线」：mock `use-code-workspace-changes` 与 `use-changes-auto-refresh`（沿用原 mock），断言 `WorkspaceChangesPanels` 哨兵渲染。完整新内容：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { CodeWorkspaceChangesView } from "./code-workspace-changes-view";

vi.mock("../../shared/workspace/workspace-changes-panels", () => ({
  WorkspaceChangesPanels: () => <div>Changes View</div>,
}));

vi.mock("./use-code-workspace-changes", () => ({
  useCodeWorkspaceChanges: () => ({
    changes: [],
    isChangesLoading: false,
    changesErrorMessage: null,
    isChangesUnavailable: false,
    commitHistory: [],
    isCommitHistoryLoading: false,
    commitHistoryErrorMessage: null,
    isWorktree: false,
    refreshChanges: () => {},
    refreshCommitHistory: () => {},
  }),
}));

vi.mock("./use-changes-auto-refresh", () => ({
  useWorktreeRunningSession: () => false,
  useChangesAutoRefresh: () => {},
}));

describe("CodeWorkspaceChangesView", () => {
  it("renders the changes panels for the sidebar slot", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspaceChangesView
          projectId={1}
          selectedRootWorkspacePath="/tmp/redwhisk"
          uncommittedExpanded={true}
          committedExpanded={true}
          onToggleUncommitted={() => {}}
          onToggleCommitted={() => {}}
          onOpenChangedFile={() => {}}
          onOpenCommittedChangedFile={() => {}}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Changes View")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 写实现 `changes-activity.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { DiffViewer } from "../../shared/workspace/diff-viewer";
import {
  DEFAULT_SIDEBAR_WIDTH,
  useWorkspaceShell,
} from "../../shared/workspace/use-workspace-shell";
import { WorkspaceShell } from "../../shared/workspace/workspace-shell";
import type { CodeWorkspaceRoot } from "../../shared/workspace/workspace-commands";
import { CodeWorkspaceChangesView } from "./code-workspace-changes-view";
import { changesWorkspaceCache } from "./changes-workspace-cache";
import { useCodeWorkspaceDiff } from "./use-code-workspace-diff";

interface ChangesActivityProps {
  projectId: number;
  roots: CodeWorkspaceRoot[];
}

/**
 * 「变更」Activity：变更面板 + diff 查看器。分支选择、侧栏宽度、折叠态持久化在
 * changesWorkspaceCache（仅 changes 侧），与「代码」Activity 完全独立。
 *
 * `useCodeWorkspaceDiff` 在本 Activity 实例化——切换到 code 时本 Activity 卸载，
 * diff 面板随之重置（每个 Activity 独立状态，不再跨 code↔changes 保留 diff；
 * 详见 ADR-0018）。root 切换时经 onRootChange → diff.clear() 清空。
 */
export function ChangesActivity({ projectId, roots }: ChangesActivityProps) {
  const { messages } = useI18n();
  const cached = changesWorkspaceCache.get(projectId);
  const [uncommittedExpanded, setUncommittedExpanded] = useState(
    () => cached?.uncommittedChangesExpanded ?? true,
  );
  const [committedExpanded, setCommittedExpanded] = useState(
    () => cached?.committedChangesExpanded ?? true,
  );

  // shell 与 diff 互相依赖（onRootChange 要调 diff.clear，diff 要 shell 的 workspace
  // path）：用 ref 桥接 onRootChange，先建 shell，再建 diff，再回填 clear 引用。
  const diffClearRef = useRef<(() => void) | null>(null);
  const shell = useWorkspaceShell({
    projectId,
    initialRoots: roots,
    initialSelectedRootPath: cached?.selectedRootPath ?? null,
    initialSidebarWidth: cached?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    onRootChange: () => diffClearRef.current?.(),
  });
  const diff = useCodeWorkspaceDiff(projectId, shell.selectedRootWorkspacePath);
  diffClearRef.current = diff.clear;

  useEffect(() => {
    changesWorkspaceCache.set(projectId, {
      selectedRootPath: shell.selectedRootPath,
      sidebarWidth: shell.sidebarWidth,
      uncommittedChangesExpanded: uncommittedExpanded,
      committedChangesExpanded: committedExpanded,
    });
  }, [
    projectId,
    shell.selectedRootPath,
    shell.sidebarWidth,
    uncommittedExpanded,
    committedExpanded,
  ]);

  return (
    <WorkspaceShell
      ariaLabel={messages.app.changes}
      loadingBranchText={messages.agentsFeature.loadingCode}
      roots={shell.roots}
      selectedRoot={shell.selectedRoot}
      onSelectRoot={shell.selectRoot}
      sidebarWidth={shell.sidebarWidth}
      onBeginResize={shell.beginResize}
      sidebar={
        <CodeWorkspaceChangesView
          projectId={projectId}
          selectedRootWorkspacePath={shell.selectedRootWorkspacePath}
          uncommittedExpanded={uncommittedExpanded}
          committedExpanded={committedExpanded}
          onToggleUncommitted={() => setUncommittedExpanded((current) => !current)}
          onToggleCommitted={() => setCommittedExpanded((current) => !current)}
          onOpenChangedFile={diff.openChange}
          onOpenCommittedChangedFile={diff.openCommittedChange}
        />
      }
      main={<DiffViewer tab={diff.diffTab} />}
    />
  );
}
```

- [ ] **Step 4: 写测试 `changes-activity.test.tsx`**

继承原 `code-workspace-changes-view.test.tsx` 中迁移过来的断言（DiffViewer 空态、分支下拉渲染、文件树不渲染），并新增「与 code 缓存隔离」的断言：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  changesWorkspaceCache,
  resetChangesWorkspaceCacheForTests,
} from "./changes-workspace-cache";
import { ChangesActivity } from "./changes-activity";

vi.mock("../../shared/workspace/workspace-changes-panels", () => ({
  WorkspaceChangesPanels: () => <div>Changes View</div>,
}));
vi.mock("../../shared/workspace/diff-viewer", () => ({
  DiffViewer: ({ tab }: { tab: unknown }) => (
    <div>{tab ? "diff content" : "Select a changed file."}</div>
  ),
}));
vi.mock("./use-code-workspace-changes", () => ({
  useCodeWorkspaceChanges: () => ({
    changes: [],
    isChangesLoading: false,
    changesErrorMessage: null,
    isChangesUnavailable: false,
    commitHistory: [],
    isCommitHistoryLoading: false,
    commitHistoryErrorMessage: null,
    isWorktree: false,
    refreshChanges: () => {},
    refreshCommitHistory: () => {},
  }),
}));
vi.mock("./use-changes-auto-refresh", () => ({
  useWorktreeRunningSession: () => false,
  useChangesAutoRefresh: () => {},
}));
vi.mock("../../shared/workspace/use-code-workspace-roots", () => ({
  useCodeWorkspaceRoots: (_projectId: number, initialRoots: unknown) => ({
    roots: initialRoots,
  }),
}));

const roots = [
  { branch: "main", path: "/tmp/repo", isProjectRoot: true },
];

describe("ChangesActivity", () => {
  beforeEach(() => {
    resetChangesWorkspaceCacheForTests();
  });

  it("renders the branch dropdown, changes panels and diff empty state without a file tree", () => {
    render(
      <I18nProvider initialLocale="en">
        <ChangesActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Changes View")).toBeInTheDocument();
    expect(screen.getByText("Select a changed file.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open file" }),
    ).not.toBeInTheDocument();
  });

  it("persists its own selected root independent of code cache", () => {
    changesWorkspaceCache.set(1, {
      selectedRootPath: "/tmp/repo.wt/feature",
      sidebarWidth: 320,
      uncommittedChangesExpanded: false,
      committedChangesExpanded: true,
    });

    render(
      <I18nProvider initialLocale="en">
        <ChangesActivity projectId={1} roots={roots} />
      </I18nProvider>,
    );

    expect(changesWorkspaceCache.get(1)?.selectedRootPath).toBe(
      "/tmp/repo.wt/feature",
    );
  });
});
```

> 注：`useCodeWorkspaceRoots` mock 让 `roots` 直接回传 `initialRoots`，避免触发真实 IPC。第二例断言 changes 侧 cache 不受 code 侧影响（两份 Map 物理隔离）。

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm test -- changes-activity code-workspace-changes-view
```
Expected: PASS。

- [ ] **Step 6: 验证门禁**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
bash scripts/check-frontend-file-size.sh
```
Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: 新建独立 ChangesActivity 容器并简化变更视图

变更 Activity 持有自己的分支选择与 changesWorkspaceCache，与代码 Activity 物理隔离；
复用 useWorkspaceShell + WorkspaceShell。code-workspace-changes-view 收敛为变更侧栏
内容组件（去分支下拉/splitter/布局/DiffViewer）。diff 不再跨 code↔changes 保留。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 切换 Activity 路由 + 删除旧外壳 + 更新 app-shell 测试

**Files:**
- Modify: `src/app/activity-router.tsx`
- Modify: `src/app/app-shell.test.tsx`
- Delete: `src/features/code/code-workspace.tsx`
- Delete: `src/features/code/code-workspace.test.tsx`
- Modify: `src/features/code/code-workspace-helpers.ts`（删除已无人引用的 `selectInitialRoot`）

**Interfaces:**
- Produces: `activity-router` 渲染 `<CodeActivity>` / `<ChangesActivity>`；`CodeWorkspace` 符号彻底移除。

- [ ] **Step 1: 改 `activity-router.tsx`**

把 import：

```ts
import { CodeWorkspace } from "../features/code/code-workspace";
```

替换为：

```ts
import { CodeActivity } from "../features/code/code-activity";
import { ChangesActivity } from "../features/changes/changes-activity";
```

把 `code` 分支：

```tsx
  if (activeActivity === "code") {
    return (
      <CodeWorkspace
        key={projectId}
        projectId={projectId}
        roots={projectCodeWorkspaces}
        view="files"
      />
    );
  }

  if (activeActivity === "changes") {
    return (
      <CodeWorkspace
        key={projectId}
        projectId={projectId}
        roots={projectCodeWorkspaces}
        view="changes"
      />
    );
  }
```

替换为：

```tsx
  if (activeActivity === "code") {
    return (
      <CodeActivity
        key={projectId}
        projectId={projectId}
        roots={projectCodeWorkspaces}
      />
    );
  }

  if (activeActivity === "changes") {
    return (
      <ChangesActivity
        key={projectId}
        projectId={projectId}
        roots={projectCodeWorkspaces}
      />
    );
  }
```

- [ ] **Step 2: 更新 `app-shell.test.tsx` 的 mock 与断言**

把 mock：

```tsx
vi.mock("../features/code/code-workspace", () => ({
  CodeWorkspace: ({
    projectId,
    view,
  }: {
    projectId: number;
    view: "files" | "changes";
  }) => (
    <div>
      code workspace {projectId} view:{view}
    </div>
  ),
}));
```

替换为两个独立 Activity mock：

```tsx
vi.mock("../features/code/code-activity", () => ({
  CodeActivity: ({ projectId }: { projectId: number }) => (
    <div>code activity {projectId}</div>
  ),
}));

vi.mock("../features/changes/changes-activity", () => ({
  ChangesActivity: ({ projectId }: { projectId: number }) => (
    <div>changes activity {projectId}</div>
  ),
}));
```

把用例 "opens the independent Code activity between Agents and Terminals" 的断言：

```tsx
    expect(screen.getByText("code workspace 1 view:files")).toBeInTheDocument();
```

改为：

```tsx
    expect(screen.getByText("code activity 1")).toBeInTheDocument();
```

把用例 "opens the Changes activity between Code and Terminals with view=changes" 的标题改为 `"opens the independent Changes activity between Code and Terminals"`，并断言：

```tsx
    expect(screen.getByText("changes activity 1")).toBeInTheDocument();
```

（删除 `view:changes` 相关文案断言。）

- [ ] **Step 3: 删除旧外壳与旧测试**

```bash
git rm src/features/code/code-workspace.tsx
git rm src/features/code/code-workspace.test.tsx
```

- [ ] **Step 4: 删除 `code-workspace-helpers.ts` 中已无引用的 `selectInitialRoot`**

确认无引用：

```bash
rg -n "selectInitialRoot" src/
```
Expected: 仅 `src/shared/workspace/use-workspace-shell.ts`（Task 2 的定义）。如仍命中 `code-workspace-helpers.ts`，删除其中的 `selectInitialRoot` 函数定义（`resolveFileLoadErrorMessage` / `isMissingWorkspaceFileError` / `MISSING_FILE_ERROR_REASONS` 保留）。

- [ ] **Step 5: 运行全部相关测试**

```bash
pnpm test -- code-activity changes-activity app-shell code-workspace-changes-view use-workspace-shell workspace-shell use-code-workspace-roots
```
Expected: 全部 PASS。

- [ ] **Step 6: 验证门禁**

```bash
pnpm format && git status --short
pnpm lint
pnpm typecheck
pnpm test
bash scripts/check-frontend-file-size.sh
```
Expected: 全部通过；`git status --short` 仅本次任务相关改动。
> 若 `pnpm test` 出现与本次无关的既有失败（如 memory 中记录的 issue-timeline unhandled rejection、settings.rs 后端失败），按 memory 既定判断：前端 clean main 预存的非阻断错误用 stash 对比 errors 数确认非回归；后端失败不影响前端门禁。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: 路由切换为独立 CodeActivity/ChangesActivity 并删除旧外壳

activity-router 不再用受控 view 的单一 CodeWorkspace，改为分别渲染两个独立
Activity；删除 code-workspace.tsx 及其测试，清理 helpers 中遗留的 selectInitialRoot。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 更新 ADR（记录决策变更）

**Files:**
- Create: `docs/adr/0018-code-changes-independent-activities.md`
- Modify: `docs/adr/0008-changes-promoted-to-activity-with-conditional-polling.md`（顶部状态行追加修订标注）
- Modify: `docs/adr/0009-changes-split-into-own-feature-dir.md`（同上）
- Modify: `docs/adr/README.md`（追加 0018 索引行）

- [ ] **Step 1: 新建 `docs/adr/0018-code-changes-independent-activities.md`**

```markdown
# ADR 0018：代码与变更拆分为完全独立的 Activity

## 状态

采纳。修订 [ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)
「单一 CodeWorkspace + 受控 view + 跨 code/changes 共享选中根与缓存」的核心实现方案，
与 [ADR-0009](./0009-changes-split-into-own-feature-dir.md)「外壳留 code/」的文件归属。
不推翻两条 ADR 的「不复制编辑器逻辑」「条件轮询」等仍有效决策。

## 背景

ADR-0008 为控制重构量，让 code / changes 两个 Activity 复用同一 `CodeWorkspace`（受控
`view`），`code-workspace.tsx` 内用 `view === "changes" ? ... : ...` 三元分支区分两侧
渲染，并以单份 `codeWorkspaceStateCache` 共享选中根 / 侧栏宽度 / tabs。此后两侧职责
持续分化，单一外壳的 if-else 与共享状态成为各自独立演进的阻碍：业务上「在 code 选 A
分支、在 changes 选 B 分支、互不影响」成为明确诉求，而共享选中根无法满足。

## 决定

1. 拆为两个完全独立的 Activity 容器：`features/code/code-activity.tsx`、
   `features/changes/changes-activity.tsx`，各自持有独立的分支选择与缓存
   （`codeWorkspaceCache` / `changesWorkspaceCache`，按 projectId 物理隔离）。
2. 抽出无状态共享层供两者复用、零逻辑重复：`shared/workspace/use-workspace-shell.ts`
   （hook：roots 轮询 / selectRoot / 侧栏宽度拖拽 / root 失效切换）、
   `shared/workspace/workspace-shell.tsx`（布局组件：分支下拉 + splitter + sidebar/main
   双 slot）。`useCodeWorkspaceRoots` 一并迁入 `shared/workspace/`（依赖方向 shared→feature）。
3. 消除 `view` prop 与三元分支；`activity-router` 直接渲染两个 Activity。
4. 行为变化：`useCodeWorkspaceDiff` 改在 `ChangesActivity` 实例化——切到 code 时 changes
   卸载，diff 面板随之重置（不再跨 code↔changes 保留 diff）。该跨 Activity 保留此前无测试
   覆盖，且 changes 页右栏本就是 diff 而非 tabs，独立状态更贴合直觉。

## 后果

- code / changes 的分支选择、侧栏宽度、各自专属状态彻底隔离，满足「互不影响」诉求。
- `features/code/` 不再承载变更视图渲染与外壳；`code-workspace.tsx` 删除。
- 共享层位于 `shared/workspace/`，两个 Activity 各自调用，编辑器 / diff / 文件树逻辑零复制。
- diff 不再跨 code↔changes 保留：用户在 changes 打开 diff 后切到 code 再切回，diff 重置。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 维持 ADR-0008 受控 view 单外壳 | if-else 与共享选中根阻碍两侧独立演进，无法满足「分支互不影响」 |
| 各自复制一套编辑器 / splitter 逻辑 | 违反 ADR-0008「不复制编辑器逻辑」核心，DRY 退化 |
| 共享层留 `features/code/`（ADR-0009 既有归属） | changes 跨目录引用 code 违反独立性诉求；shared 更符合依赖方向 |

## 代码事实来源

- 本决策记录：`docs/adr/0018-code-changes-independent-activities.md`
- 独立 Activity：`src/features/code/code-activity.tsx`、`src/features/changes/changes-activity.tsx`
- 共享层：`src/shared/workspace/use-workspace-shell.ts`、`workspace-shell.tsx`、`use-code-workspace-roots.ts`
- 独立缓存：`src/features/code/code-workspace-cache.ts`、`src/features/changes/changes-workspace-cache.ts`
- 相关 ADR：[ADR-0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)、[ADR-0009](./0009-changes-split-into-own-feature-dir.md)（被本 ADR 修订）
```

- [ ] **Step 2: 在 ADR-0008 / ADR-0009 顶部状态段追加修订标注**

`0008-*.md`「## 状态」段原内容后追加一行：

```markdown

> 「单一 CodeWorkspace + 受控 view + 跨 code/changes 共享选中根与缓存」的实现方案已被
> [ADR-0018](./0018-code-changes-independent-activities.md) 修订为两个完全独立的 Activity；
> 本 ADR 的「条件轮询」「不复制编辑器逻辑」等决策仍然有效。
```

`0009-*.md`「## 状态」段原内容后追加一行：

```markdown

> 「外壳与 cache 留 `features/code/`」「两侧复用同一 CodeWorkspace 外壳」已被
> [ADR-0018](./0018-code-changes-independent-activities.md) 修订；变更专属件归属 `features/changes/`
> 仍然有效。
```

- [ ] **Step 3: 在 `docs/adr/README.md` 索引追加 0018 行**

按现有编号顺序在 0017 之后追加：

```markdown
- [ADR 0018：代码与变更拆分为完全独立的 Activity](./0018-code-changes-independent-activities.md)
```

- [ ] **Step 4: 复查 ADR 内部相对链接一致**

```bash
rg -n "0018|0008|0009" docs/adr/README.md docs/adr/0008-*.md docs/adr/0009-*.md docs/adr/0018-*.md
```
Expected: 索引与状态段交叉引用一致，无断链。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs: 新增 ADR-0018 记录 code/changes 拆分为独立 Activity

修订 ADR-0008 受控 view 单外壳方案与 ADR-0009 外壳归属，保留各自仍有效的决策。

Refs: #136

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 验收（全局）

- [ ] `pnpm format` / `lint` / `typecheck` / `test` / `check-frontend-file-size.sh` 全绿（既有非本次失败按 memory 既定判断区分）。
- [ ] `git status --short` 无残留任务相关未提交文件。
- [ ] 运行时手测（如条件允许）：在 code 选 worktree A、切到 changes 选 worktree B、切回 code，确认 code 仍显示 A；反之亦然。
- [ ] 无新增 `@ts-ignore` / `@ts-nocheck` / `eslint-disable`（除原已存在的 `react-hooks/exhaustive-deps` 注释豁免，原样保留）。
- [ ] 每处 diff 可追溯到本计划任务。
