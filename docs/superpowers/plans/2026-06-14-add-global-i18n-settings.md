# Global i18n Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom global Settings icon that opens application-level Preferences with English/Chinese UI language switching and a Light-only theme preference.

**Architecture:** Add a focused React i18n provider under `src/shared/i18n`, then wire it into `App` so App shell, Global Settings, Project Settings, and main Issues / Agents labels read messages from one runtime. Add a dedicated `GlobalSettingsActivity` component that reuses the existing Settings two-column visual language without mixing in Project Settings fields.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, lucide-react, localStorage.

---

## File Structure

- Create `src/shared/i18n/i18n.tsx`: locale/theme types, messages, localStorage persistence, `I18nProvider`, `useI18n`, and test helpers.
- Create `src/features/settings/global-settings-activity.tsx`: Global Settings / Preferences page, language controls, Light-only theme controls, splitter behavior.
- Create `src/features/settings/global-settings-activity.test.tsx`: focused Preferences tests.
- Modify `src/app/app.tsx`: wrap selected-project shell in `I18nProvider`.
- Modify `src/app/app-shell.tsx`: split project activities from bottom Global Settings icon and route global Settings surface.
- Modify `src/app/app.css`: bottom activity group, icon-only global button, global preferences card and theme preview styles.
- Modify `src/features/settings/project-settings-activity.tsx`: read Settings text from `useI18n`.
- Modify `src/features/issues/issues-activity.tsx`: derive lane labels and primary visible labels from `useI18n`.
- Modify `src/features/agents/agents-activity.tsx`: derive session group labels and empty copy from `useI18n`.
- Modify docs `docs/architecture-design/agent-development-rules.md` and `docs/architecture-design/settings-page-layout.md`.
- Backfill `openspec/changes/add-global-i18n-settings/tasks.md` and `.onespec.yaml`.

## Task 1: i18n Runtime

**Files:**
- Create: `src/shared/i18n/i18n.tsx`
- Modify: `src/app/app.tsx`
- Modify: `src/app/app.test.tsx`

- [ ] **Step 1: Write the failing App default-language test**

In `src/app/app.test.tsx`, clear localStorage in the existing `beforeEach`:

```ts
window.localStorage.clear();
```

Add this test inside `describe("App project entry", ...)`:

```ts
it("uses English as the default UI language in a project workbench", async () => {
  window.history.replaceState(null, "", "/?projectId=1");

  render(<App />);

  expect(
    await screen.findByRole("navigation", { name: "Activity Bar" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Issues" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Project Settings" }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test -- src/app/app.test.tsx`

Expected: FAIL because `Project Settings` is not yet the accessible project settings label.

- [ ] **Step 3: Implement `src/shared/i18n/i18n.tsx`**

Create:

```ts
export type Locale = "en" | "zh";
export type ThemePreference = "light";
```

Define messages for `app`, `globalSettings`, `settings`, `issues`, and `agentsFeature`. English values must match current visible text; Chinese values must cover Settings / Preferences / Language / Theme, Settings menu labels, table labels, Issues lane labels, and Agents session group labels.

Implement:

```ts
export function getInitialLocale(): Locale;
export function getInitialThemePreference(): ThemePreference;
export function I18nProvider({ children }: { children: ReactNode }): JSX.Element;
export function useI18n(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  messages: I18nMessages;
};
```

Use localStorage keys `redwhisk.locale` and `redwhisk.theme`. Invalid stored values return `en` and `light`.

- [ ] **Step 4: Wrap the selected project shell**

In `src/app/app.tsx`, import `I18nProvider` and wrap only the selected-project branch:

```tsx
return (
  <I18nProvider>
    <AppShell
      onProjectUpdated={handleProjectUpdated}
      project={selectedProject}
      projects={projects}
      onProjectsRefresh={refreshProjects}
    />
  </I18nProvider>
);
```

- [ ] **Step 5: Run the app test again**

Run: `pnpm test -- src/app/app.test.tsx`

Expected: still fails until Task 3 adjusts AppShell labels, but TypeScript should compile for the new provider.

## Task 2: Global Settings Preferences UI

**Files:**
- Create: `src/features/settings/global-settings-activity.tsx`
- Create: `src/features/settings/global-settings-activity.test.tsx`
- Modify: `src/app/app.css`

- [ ] **Step 1: Write failing component tests**

Create `src/features/settings/global-settings-activity.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../shared/i18n/i18n";
import { GlobalSettingsActivity } from "./global-settings-activity";

function renderGlobalSettings() {
  return render(
    <I18nProvider>
      <GlobalSettingsActivity />
    </I18nProvider>,
  );
}

describe("GlobalSettingsActivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders Preferences with English language and Light theme by default", () => {
    renderGlobalSettings();

    expect(
      screen.getByRole("navigation", { name: "Global Settings menu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preferences" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "System" })).not.toBeInTheDocument();
  });

  it("switches Preferences labels to Chinese immediately", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(screen.getByRole("button", { name: "中文" }));

    expect(screen.getByRole("heading", { name: "偏好设置" })).toBeInTheDocument();
    expect(screen.getByText("语言")).toBeInTheDocument();
    expect(screen.getByText("主题")).toBeInTheDocument();
    expect(window.localStorage.getItem("redwhisk.locale")).toBe("zh");
  });
});
```

- [ ] **Step 2: Run the failing component test**

Run: `pnpm test -- src/features/settings/global-settings-activity.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `GlobalSettingsActivity`**

Implement the component with:

- `activity-surface activity-surface--settings activity-surface--global-settings`
- `settings-layout`, `settings-menu`, `settings-splitter`, and `settings-content`
- local splitter state with min `180`, max `420`, step `16`
- one left menu item: Preferences
- right content title: Preferences
- language buttons: English and 中文 with `aria-pressed`
- theme button: Light only, selected, calls `setThemePreference("light")`

- [ ] **Step 4: Add CSS for Preferences and theme preview**

Add styles to `src/app/app.css`:

- `.global-preferences-card`
- `.global-preferences-section`
- `.global-language-options`
- `.global-language-option`
- `.global-theme-grid`
- `.global-theme-option`
- `.global-theme-preview`
- `.global-theme-preview__dots`
- `.global-theme-preview__body`

Use existing color tokens, `var(--radius-card)`, and stable responsive dimensions.

- [ ] **Step 5: Run component tests**

Run: `pnpm test -- src/features/settings/global-settings-activity.test.tsx`

Expected: PASS.

## Task 3: App Shell Global Settings Entry

**Files:**
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/app.css`
- Modify: `src/app/app.test.tsx`

- [ ] **Step 1: Write failing shell behavior test**

Add to `src/app/app.test.tsx`:

```ts
it("opens global settings from the bottom activity bar icon without resetting project activities", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/?projectId=1");

  render(<App />);

  expect(await screen.findByRole("button", { name: "Issues" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Agents" }));
  await user.click(screen.getByRole("button", { name: "Global Settings" }));

  expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Global Settings" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.click(screen.getByRole("button", { name: "Issues" }));
  expect(screen.getByRole("button", { name: "Issues" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
```

- [ ] **Step 2: Run failing app tests**

Run: `pnpm test -- src/app/app.test.tsx`

Expected: FAIL because the global Settings icon is not wired.

- [ ] **Step 3: Update `AppShell`**

Use `useI18n()` and model active surface as:

```ts
type ShellSurface = "project" | "global-settings";
```

Keep existing `activeActivity` state. Project buttons set `activeActivity` and `activeSurface` to `"project"`. Bottom icon sets `activeSurface` to `"global-settings"`. When active surface is global settings, render `<GlobalSettingsActivity />`; otherwise render `ActivityRouter`.

Project Settings button must keep visible text `Settings` but accessible label `Project Settings`.

- [ ] **Step 4: Update activity bar CSS**

Add:

```css
.activity-bar__spacer {
  flex: 1;
}

.activity-bar__button--icon-only span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
```

- [ ] **Step 5: Run app tests**

Run: `pnpm test -- src/app/app.test.tsx`

Expected: PASS.

## Task 4: Project Settings i18n Migration

**Files:**
- Modify: `src/features/settings/project-settings-activity.tsx`
- Modify: `src/features/settings/project-settings-activity.test.tsx`
- Optionally keep `src/shared/i18n/settings-messages.ts` as a compatibility shim if imports remain.

- [ ] **Step 1: Wrap Settings tests with `I18nProvider`**

In `project-settings-activity.test.tsx`, wrap all renders in `I18nProvider`. Existing English assertions should continue to pass after migration.

- [ ] **Step 2: Add Chinese Settings assertion**

Add a focused test that preloads `window.localStorage.setItem("redwhisk.locale", "zh")`, renders `ProjectSettingsActivity`, and asserts Chinese text for `通用`, `操作`, and `删除`.

- [ ] **Step 3: Run failing Settings tests**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Expected: FAIL until component reads i18n.

- [ ] **Step 4: Replace hard-coded Settings text**

In `ProjectSettingsActivity`, call `const { messages } = useI18n();` and replace:

- menu labels `General`, `Agents`
- nav aria-label `Settings menu`
- splitter aria-label
- `New agent`
- table columns
- `Global` / `Project`
- `Loading...`
- `No agents`
- General form labels and Save/Saving
- delete button and confirmation

Do not translate agent type labels, profile names, command values, or skill names.

- [ ] **Step 5: Run Settings tests**

Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

Expected: PASS.

## Task 5: Issues / Agents Main Path i18n

**Files:**
- Modify: `src/features/issues/issues-activity.tsx`
- Modify: `src/features/agents/agents-activity.tsx`
- Modify tests only when wrappers or assertions require it.

- [ ] **Step 1: Derive Issues lane labels from i18n**

Move `ISSUE_LANES` labels into `IssuesActivity` using `messages.issues.backlog`, `messages.issues.inProgress`, `messages.issues.review`, and `messages.issues.done`.

- [ ] **Step 2: Derive Agents group labels from i18n**

Move `SESSION_GROUPS` labels and empty copy into `AgentsActivity` using `messages.agentsFeature`.

- [ ] **Step 3: Run affected tests**

Run:

```bash
pnpm test -- src/features/issues/issues-activity.test.tsx
pnpm test -- src/features/agents/agents-activity.test.tsx
```

Expected: PASS.

## Task 6: Documentation, OpenSpec Backfill, and Full Verification

**Files:**
- Modify: `docs/architecture-design/agent-development-rules.md`
- Modify: `docs/architecture-design/settings-page-layout.md`
- Modify: `openspec/changes/add-global-i18n-settings/tasks.md`
- Modify: `openspec/changes/add-global-i18n-settings/.onespec.yaml`

- [ ] **Step 1: Update docs**

In `agent-development-rules.md`, update the UI rule to state: Project Settings remains a Project Activity; Global Settings is a bottom icon-only shell action.

In `settings-page-layout.md`, add that Global Settings reuses the two-column layout but is not a Project Settings module.

- [ ] **Step 2: Track touched files**

Run the OneSpec track command for all files touched by implementation:

```bash
ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
. "$ONESPEC_ENV"
"$ONESPEC_BASH" "$ONESPEC_COMMIT" track add-global-i18n-settings <paths>
```

- [ ] **Step 3: Backfill tasks**

Mark OpenSpec tasks 1.1 through 5.7 complete after implementation and verification pass.

- [ ] **Step 4: Run required verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test -- src/app
pnpm test -- src/features/settings
pnpm test -- src/features/issues
pnpm test -- src/features/agents
openspec validate add-global-i18n-settings --strict
```

Expected: all commands pass.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git status --short
git add <only files touched by this change>
git commit -m "feat: add global i18n settings"
```

Expected: one implementation commit on branch `add-global-i18n-settings`.

## Self-Review

Spec coverage:

- Global Settings bottom icon: Task 3.
- Preferences two-column page: Task 2.
- Language default and Chinese switching: Tasks 1 and 2.
- Light-only theme: Task 2.
- i18n runtime and main path migration: Tasks 1, 4, and 5.
- Documentation and OpenSpec backfill: Task 6.

No placeholders remain. Types used in later tasks match Task 1: `Locale`, `ThemePreference`, `I18nMessages`, `I18nProvider`, `useI18n`.
