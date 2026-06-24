# Settings Agents Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Settings 右侧内容统一为 80% 居中布局，并把 Agents 设置页改成 action card + table + 精简 New agent 弹窗。

**Architecture:** 前端继续沿用 `ProjectSettingsActivity` 作为 Settings 页面入口，`AgentProfileForm` 负责创建/编辑 profile。布局规则落在 `docs/architecture-design/settings-page-layout.md` 和 `src/app/app.css`，agent logo 通过一个共享 helper 复用现有 Codex / Claude SVG 资源。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Tauri command wrapper、CSS modules-by-convention in `src/app/app.css`。

---

## File Structure

- Modify: `docs/architecture-design/settings-page-layout.md`
  更新 Settings 右侧 80% 居中布局规范。
- Create: `src/features/agents/agent-visuals.ts`  
  统一导出 agent 类型 label 和 logo src，供 Agents Session 与 Settings table 复用。
- Modify: `src/features/agents/agents-activity.tsx`  
  删除本地 logo/label helper，改用 `agent-visuals.ts`。
- Modify: `src/features/settings/project-settings-activity.tsx`  
  将 Agents 页面改成 action card + table，新增按钮默认打开 global 创建弹窗；table row 继续可点击编辑。
- Modify: `src/features/settings/agent-profile-form.tsx`  
  支持创建时 scope 可选、字段重排、命令名检测、命令测试按钮、scope 驱动 skill 过滤、隐藏高级字段。
- Modify: `src/app/app.css`  
  实现 80% 居中内容、Agents table/action card、弹窗内联 command/test 和 skill 选项样式。
- Modify: `src/features/settings/project-settings-activity.test.tsx`  
  更新现有测试并新增覆盖新版布局、table、dialog 字段、scope/skill 查询和保存默认值。

## Task 1: Settings 布局规范与共享 logo helper

**Files:**
- Modify: `docs/architecture-design/settings-page-layout.md`
- Create: `src/features/agents/agent-visuals.ts`
- Modify: `src/features/agents/agents-activity.tsx`
- Test: `src/features/agents/agents-activity.test.tsx`

- [ ] **Step 1: 写失败测试，锁定 logo helper 复用后的 session logo 行为**

  在 `src/features/agents/agents-activity.test.tsx` 现有 logo 测试附近保持断言不变或补充一条断言：Codex session row 使用 `codexLogoSrc`，Claude session row 使用 `claudeLogoSrc`。如果现有测试已经覆盖，不新增重复测试，直接运行下一步确认重构前后保护网存在。

- [ ] **Step 2: 运行测试确认当前保护网通过**

  Run: `pnpm test -- src/features/agents/agents-activity.test.tsx`

  Expected: PASS。此任务是无行为重构，不需要制造失败；不要改生产代码直到确认现有测试保护 logo 行为。

- [ ] **Step 3: 新增共享 helper**

  创建 `src/features/agents/agent-visuals.ts`：

  ```ts
  import claudeLogoSrc from "../../assets/images/claude.svg";
  import codexLogoSrc from "../../assets/images/codex.svg";

  export type VisualAgentType = "codex" | "claude" | "claude_code" | string;

  export function formatAgentTypeLabel(agentType: VisualAgentType): string {
    switch (agentType) {
      case "codex":
        return "Codex";
      case "claude":
      case "claude_code":
        return "Claude";
      default:
        return agentType;
    }
  }

  export function getAgentLogoSrc(agentType: VisualAgentType): string {
    if (agentType === "claude" || agentType === "claude_code") {
      return claudeLogoSrc;
    }

    return codexLogoSrc;
  }
  ```

- [ ] **Step 4: 更新 Agents Session 页面使用 helper**

  在 `src/features/agents/agents-activity.tsx`：

  - 删除 `import claudeLogoSrc ...` 和 `import codexLogoSrc ...`。
  - 新增：

    ```ts
    import {
      formatAgentTypeLabel,
      getAgentLogoSrc,
    } from "./agent-visuals";
    ```

  - 将 `formatAgentType(session.agentType)` 改为 `formatAgentTypeLabel(session.agentType)`。
  - 删除文件底部本地 `formatAgentType` 和 `getAgentLogoSrc` 函数。

- [ ] **Step 5: 更新 Settings 布局规范**

  在 `docs/architecture-design/settings-page-layout.md` 的“右侧内容模板”中，将原来的 `max-width: 900px` 规则替换为：

  ```markdown
  右侧具体内容容器默认使用右侧区域的 `80%` 宽度，并在右侧区域内水平居中。容器必须保留 `min-width: 0`、响应式约束和溢出保护，避免窄屏时内容越界；当右侧区域过窄时可以退化为接近 `100%` 的可用宽度，但默认设计基线仍是 `80%`。

  General、Agents 以及后续新增 Settings 菜单项都必须复用该右侧内容容器。单个模块不得自行定义与 80% 居中规则冲突的外层宽度；模块内部 card、table 或表单可以在该容器内按内容需要布局。General 表单 card 不得设置固定高度，应由内容自然撑开。
  ```

- [ ] **Step 6: 运行任务验证**

  Run: `pnpm test -- src/features/agents/agents-activity.test.tsx`

  Expected: PASS。

## Task 2: Settings Agents 页面改为 action card + table

**Files:**
- Modify: `src/features/settings/project-settings-activity.tsx`
- Modify: `src/app/app.css`
- Modify: `src/features/settings/project-settings-activity.test.tsx`

- [ ] **Step 1: 写失败测试，验证 Agents table 与 New agent 入口**

  在 `src/features/settings/project-settings-activity.test.tsx` 中替换旧的 “separate sections” 测试为：

  ```ts
  it("shows agents in a table below the new agent action card", async () => {
    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New agent" }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Configured agents" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Command" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Scope" })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Workflow Skill" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Project Codex" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Global Codex" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Agent 类型：Codex")).toHaveLength(2);
  });
  ```

  将旧的 `Project Agents` / `Global Agents` region 断言改为 table 断言。

- [ ] **Step 2: 运行测试确认失败**

  Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

  Expected: FAIL，原因是还没有 `Configured agents` table 和 `New agent` 按钮。

- [ ] **Step 3: 实现 profiles 合并与 table UI**

  在 `src/features/settings/project-settings-activity.tsx`：

  - 导入 helper：

    ```ts
    import {
      formatAgentTypeLabel,
      getAgentLogoSrc,
    } from "../agents/agent-visuals";
    ```

  - 删除 `AddFormState.scope`，改为：

    ```ts
    interface AddFormState {
      projectId: number;
    }
    ```

  - 新增合并列表：

    ```ts
    const currentProfiles = [
      ...currentProjectProfiles,
      ...currentGlobalProfiles,
    ].sort((left, right) => left.id - right.id);
    ```

  - 将 Agents JSX 替换为：

    ```tsx
    <section className="settings-agent-action-card" aria-label="Agent actions">
      <div>
        <h4>Agent profiles</h4>
      </div>
      <Button
        className="settings-agent-action-card__button"
        type="button"
        onClick={() => {
          setAddForm({ projectId });
          setEditingProfile(null);
        }}
      >
        + New agent
      </Button>
    </section>

    {currentLoadState === "loading" ? (
      <p className="settings-agent-section__loading">Loading...</p>
    ) : currentProfiles.length === 0 ? (
      <div className="settings-agent-table-empty">
        <p>No agents</p>
      </div>
    ) : (
      <table className="settings-agent-table" aria-label="Configured agents">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Name</th>
            <th scope="col">Command</th>
            <th scope="col">Scope</th>
            <th scope="col">Workflow Skill</th>
          </tr>
        </thead>
        <tbody>
          {currentProfiles.map((profile) => {
            const agentLabel = formatAgentTypeLabel(profile.agentType);
            return (
              <tr
                key={profile.id}
                className="settings-agent-table__row"
                tabIndex={0}
                onClick={() => {
                  setEditingProfile({
                    contextProjectId: projectId,
                    profile,
                  });
                  setAddForm(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setEditingProfile({
                    contextProjectId: projectId,
                    profile,
                  });
                  setAddForm(null);
                }}
              >
                <td>
                  <img
                    alt={`Agent 类型：${agentLabel}`}
                    className="settings-agent-table__logo"
                    src={getAgentLogoSrc(profile.agentType)}
                  />
                </td>
                <td>{profile.name}</td>
                <td>
                  <span className="settings-agent-table__command">
                    {formatCommandName(profile.command)}
                  </span>
                </td>
                <td>{profile.scope === "global" ? "Global" : "Project"}</td>
                <td>
                  {profile.defaultSkill.trim().length > 0 ? (
                    profile.defaultSkill
                  ) : (
                    <span className="settings-agent-table__empty">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
    ```

  - 新增 helper：

    ```ts
    function formatCommandName(command: string): string {
      const trimmedCommand = command.trim();
      if (trimmedCommand.length === 0) return "—";
      const normalizedCommand = trimmedCommand.replace(/\\/g, "/");
      return normalizedCommand.split("/").filter(Boolean).at(-1) ?? trimmedCommand;
    }
    ```

- [ ] **Step 4: 更新 add form 调用**

  在 `currentAddForm` 渲染处改为：

  ```tsx
  <AgentProfileForm
    key={`create-${currentAddForm.projectId}`}
    mode="create"
    scope="global"
    projectId={projectId}
    onCancel={() => setAddForm(null)}
    onSaved={handleProfileSaved}
  />
  ```

  这里 `projectId` 保持传入，用于弹窗切换到 Project scope 时加载当前项目 skill；初始保存 scope 由 `AgentProfileForm` 内部维护。

- [ ] **Step 5: 更新 CSS**

  在 `src/app/app.css`：

  - `.settings-section__body` 改成 80% 居中：

    ```css
    .settings-section__body {
      display: grid;
      align-content: start;
      width: min(80%, 1100px);
      min-width: 0;
      margin: 0 auto;
    }
    ```

  - 删除 `.settings-section--general .settings-section__header` 的 520px 特例，改为让 header 跟随 section body 宽度；如果需要，给 `.settings-section` 自身也设定 `width: 100%`。
  - `.settings-general-card` 改为：

    ```css
    .settings-general-card {
      width: 100%;
      min-height: 0;
    }
    ```

  - 添加 table/action card 样式：

    ```css
    .settings-agent-action-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      padding: 14px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-card);
      background: var(--color-surface);
    }

    .settings-agent-action-card h4 {
      margin: 0;
      font-size: 14px;
      line-height: 1.3;
    }

    .settings-agent-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      font-size: 12px;
    }

    .settings-agent-table th,
    .settings-agent-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      text-align: left;
      vertical-align: middle;
    }

    .settings-agent-table th {
      color: var(--color-text-muted);
      font-weight: 650;
    }

    .settings-agent-table__row {
      cursor: pointer;
    }

    .settings-agent-table__row:hover {
      background: var(--color-surface-muted);
    }

    .settings-agent-table__logo {
      display: block;
      width: 18px;
      height: 18px;
      object-fit: contain;
    }

    .settings-agent-table__command {
      font-family: var(--font-mono);
      color: var(--color-text-muted);
    }

    .settings-agent-table__empty,
    .settings-agent-table-empty {
      color: var(--color-text-muted);
    }
    ```

  - 在 mobile media query 中改 `.settings-section__body { width: 100%; }`，并让 table 横向滚动可用：

    ```css
    .settings-section__body {
      width: 100%;
    }

    .settings-agent-table {
      min-width: 640px;
    }
    ```

- [ ] **Step 6: 运行任务验证**

  Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

  Expected: PASS 或只剩 Task 3 相关旧弹窗测试失败。若有旧测试仍查找 `Add project agent` / `Add global agent`，在 Task 3 中一并更新。

## Task 3: New agent 弹窗字段、scope 与 skill 过滤

**Files:**
- Modify: `src/features/settings/agent-profile-form.tsx`
- Modify: `src/features/settings/project-settings-activity.tsx`
- Modify: `src/app/app.css`
- Modify: `src/features/settings/project-settings-activity.test.tsx`

- [ ] **Step 1: 写失败测试，验证 New agent 字段和默认保存值**

  在 `src/features/settings/project-settings-activity.test.tsx` 新增或替换创建测试：

  ```ts
  it("creates a global codex agent from the streamlined New agent dialog", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    detectCodexCommandMock.mockResolvedValue({ command: "/usr/local/bin/codex" });
    testAgentCommandMock.mockResolvedValue({ command: "codex" });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      name: "My Codex",
      command: "codex",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));

    expect(screen.getByRole("heading", { name: "New agent" })).toBeInTheDocument();
    expect(screen.getByLabelText("Agent profile name")).toHaveValue("");
    expect(screen.getByLabelText("Agent type")).toHaveValue("codex");
    expect(await screen.findByLabelText("Agent command")).toHaveValue("codex");
    expect(screen.getByLabelText("Agent scope")).toHaveValue("global");
    expect(screen.queryByLabelText("Mode")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt template")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Agent profile name"), "My Codex");
    await user.click(screen.getByRole("button", { name: "测试" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Codex",
          agentType: "codex",
          command: "codex",
          scope: "global",
          projectId: null,
          mode: "default",
          dangerous: true,
          defaultSkill: "",
          promptTemplate: "",
        }),
      ),
    );
  });
  ```

- [ ] **Step 2: 写失败测试，验证 Scope 驱动 skill 过滤**

  新增：

  ```ts
  it("reloads workflow skills when New agent scope changes", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));
    expect(listAgentSkillsMock).toHaveBeenCalledWith({
      agentType: "codex",
      projectId: null,
    });
    expect(
      await screen.findByText("/home/me/.agents/skills/codex-global/SKILL.md"),
    ).toBeInTheDocument();
    expect(screen.queryByText("/repo/.agents/skills/codex-project/SKILL.md")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Agent scope"), "project");

    expect(listAgentSkillsMock).toHaveBeenCalledWith({
      agentType: "codex",
      projectId: 1,
    });
    expect(
      await screen.findByText("/repo/.agents/skills/codex-project/SKILL.md"),
    ).toBeInTheDocument();
  });
  ```

- [ ] **Step 3: 运行测试确认失败**

  Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

  Expected: FAIL，原因包括 dialog 标题、scope 控件、命令 basename、隐藏字段和 skill option 自定义渲染尚未实现。

- [ ] **Step 4: 修改 AgentProfileForm 状态模型**

  在 `src/features/settings/agent-profile-form.tsx`：

  - 新增本地 scope：

    ```ts
    const [scopeValue, setScopeValue] = useState<AgentScope>(() =>
      profile?.scope ?? scope,
    );
    ```

  - 默认 mode 改为：

    ```ts
    const [modeValue] = useState(() => profile?.mode ?? "default");
    const [dangerous] = useState(() => profile?.dangerous ?? true);
    const [promptTemplate] = useState(() => profile?.promptTemplate ?? "");
    ```

  - `skillProjectId` 改为：

    ```ts
    const skillProjectId = scopeValue === "project" ? projectId : null;
    ```

  - `handleSubmit` 中保存：

    ```ts
    const effectiveProjectId = scopeValue === "project" ? projectId : null;
    const savedProfile = await saveAgentProfile({
      id: profile?.id,
      name,
      agentType,
      command,
      scope: scopeValue,
      projectId: effectiveProjectId,
      mode: modeValue,
      dangerous,
      defaultSkill,
      promptTemplate: profile ? promptTemplate : "",
    });
    ```

- [ ] **Step 5: 自动检测命令名**

  在 `agent-profile-form.tsx` 新增 helper：

  ```ts
  function toCommandName(commandPath: string): string {
    const trimmedCommand = commandPath.trim();
    if (trimmedCommand.length === 0) return "";
    const normalizedCommand = trimmedCommand.replace(/\\/g, "/");
    return normalizedCommand.split("/").filter(Boolean).at(-1) ?? trimmedCommand;
  }
  ```

  将创建时 `detectCodexCommand` 的 `setCommand(result.command)` 改为 `setCommand(toCommandName(result.command))`。`handleTestCommand` 成功后也设置 `toCommandName(result.command)`。

- [ ] **Step 6: 调整 dialog 标题与字段顺序**

  - `dialogTitle` 创建时固定为 `New agent`，编辑保留 `Edit Agent`。
  - JSX 顺序为 Name、Type、Command、Scope、Workflow Skill。
  - Type 选项：

    ```tsx
    <option value="codex">codex</option>
    <option value="claude">Claude Code</option>
    ```

  - Command 输入和测试按钮放同一行：

    ```tsx
    <label className="settings-field">
      <span>Command</span>
      <div className="agent-dialog__command-row">
        <input
          aria-label="Agent command"
          className="settings-input"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
        <button
          className="issues-button"
          type="button"
          disabled={isTesting || isSaving || command.trim().length === 0}
          onClick={handleTestCommand}
        >
          {isTesting ? "Testing..." : "测试"}
        </button>
      </div>
    </label>
    ```

  - 新增 Scope select：

    ```tsx
    <label className="settings-field">
      <span>Scope</span>
      <select
        aria-label="Agent scope"
        className="settings-input"
        value={scopeValue}
        onChange={(event) => {
          skillRequestSequenceRef.current += 1;
          setScopeValue(event.target.value as AgentScope);
          setDefaultSkill("");
          setSkills([]);
          setSkillLoadFailed(false);
        }}
      >
        <option value="global">Global</option>
        <option value="project">Project</option>
      </select>
    </label>
    ```

  - 移除 Detect 按钮、Mode select、Dangerous checkbox、Prompt Template textarea 的渲染。

- [ ] **Step 7: 将 Workflow Skill 从 select 改为可展示路径的 radio/listbox**

  原生 `<option>` 不能可靠展示浅灰路径。改为：

  ```tsx
  <fieldset className="agent-dialog__skill-field">
    <legend>Workflow Skill</legend>
    <label className="agent-dialog__skill-option">
      <input
        checked={defaultSkill === ""}
        name="agent-default-skill"
        type="radio"
        value=""
        onChange={() => setDefaultSkill("")}
      />
      <span>
        <span className="agent-dialog__skill-name">None</span>
      </span>
    </label>
    {visibleSkills.map((skill) => (
      <label key={skill.path} className="agent-dialog__skill-option">
        <input
          checked={defaultSkill === skill.name}
          name="agent-default-skill"
          type="radio"
          value={skill.name}
          onChange={() => setDefaultSkill(skill.name)}
        />
        <span>
          <span className="agent-dialog__skill-name">{skill.name}</span>
          <span className="agent-dialog__skill-path">{skill.path}</span>
        </span>
      </label>
    ))}
  </fieldset>
  ```

  `visibleSkills` 由 scope 过滤：

  ```ts
  const visibleSkills = useMemo(
    () => skills.filter((skill) => skill.scope === scopeValue),
    [skills, scopeValue],
  );
  ```

  兼容已选 skill 缺失时，在列表中显示一项 missing option，名称为旧值，路径为 `Saved value`。

- [ ] **Step 8: 更新 CSS**

  在 `src/app/app.css` 添加：

  ```css
  .agent-dialog__command-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  .agent-dialog__skill-field {
    display: grid;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .agent-dialog__skill-field legend {
    margin-bottom: 2px;
    color: var(--color-text-muted);
    font-size: 12px;
  }

  .agent-dialog__skill-option {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
    cursor: pointer;
  }

  .agent-dialog__skill-name,
  .agent-dialog__skill-path {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-dialog__skill-name {
    color: var(--color-text);
    font-size: 12px;
  }

  .agent-dialog__skill-path {
    margin-top: 2px;
    color: var(--color-text-subtle);
    font-size: 11px;
  }
  ```

- [ ] **Step 9: 运行任务验证**

  Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

  Expected: PASS。

## Task 4: 完整验证、OpenSpec 回填与提交

**Files:**
- Modify: `openspec/changes/redesign-settings-agents-layout/tasks.md`
- Modify: `openspec/changes/redesign-settings-agents-layout/.onespec.yaml`
- Commit all files directly related to this change.

- [ ] **Step 1: 运行 lint**

  Run: `pnpm lint`

  Expected: PASS。

- [ ] **Step 2: 运行 typecheck**

  Run: `pnpm typecheck`

  Expected: PASS。

- [ ] **Step 3: 运行 Settings 测试**

  Run: `pnpm test -- src/features/settings/project-settings-activity.test.tsx`

  Expected: PASS。

- [ ] **Step 4: 运行受影响 Agents Session 测试**

  Run: `pnpm test -- src/features/agents/agents-activity.test.tsx`

  Expected: PASS。

- [ ] **Step 5: 运行全量前端测试**

  Run: `pnpm test`

  Expected: PASS。

- [ ] **Step 6: 校验 OpenSpec**

  Run: `openspec validate redesign-settings-agents-layout --strict`

  Expected: PASS。

- [ ] **Step 7: 回填 OpenSpec tasks**

  将 `openspec/changes/redesign-settings-agents-layout/tasks.md` 中 1.1 到 4.5 勾选为完成。不要勾选未完成或未验证的项。

- [ ] **Step 8: 记录 touched files**

  Run:

  ```bash
  ONESPEC_ENV="${ONESPEC_ENV:-$(find . "$HOME"/.codex "$HOME"/.claude "$HOME"/.cursor "$HOME"/.gemini "$HOME"/.copilot "$HOME"/.agents "$HOME"/.config -path '*/onespec/scripts/onespec-env.sh' -type f -print -quit 2>/dev/null)}"
  . "$ONESPEC_ENV"
  "$ONESPEC_BASH" "$ONESPEC_COMMIT" track redesign-settings-agents-layout \
    docs/architecture-design/settings-page-layout.md \
    docs/superpowers/plans/2026-06-13-redesign-settings-agents-layout.md \
    src/features/agents/agent-visuals.ts \
    src/features/agents/agents-activity.tsx \
    src/features/settings/project-settings-activity.tsx \
    src/features/settings/agent-profile-form.tsx \
    src/features/settings/project-settings-activity.test.tsx \
    src/app/app.css \
    openspec/changes/redesign-settings-agents-layout/tasks.md \
    openspec/changes/redesign-settings-agents-layout/.onespec.yaml
  ```

- [ ] **Step 9: 提交**

  Run:

  ```bash
  git add docs/architecture-design/settings-page-layout.md \
    docs/superpowers/plans/2026-06-13-redesign-settings-agents-layout.md \
    src/features/agents/agent-visuals.ts \
    src/features/agents/agents-activity.tsx \
    src/features/settings/project-settings-activity.tsx \
    src/features/settings/agent-profile-form.tsx \
    src/features/settings/project-settings-activity.test.tsx \
    src/app/app.css \
    openspec/changes/redesign-settings-agents-layout/tasks.md \
    openspec/changes/redesign-settings-agents-layout/.onespec.yaml
  git commit -m "feat: redesign settings agents layout"
  ```

  Expected: commit succeeds and contains only files directly related to this change.

## Self-Review

- Spec coverage: Task 1 covers shared layout specification and logo reuse; Task 2 covers action card/table layout; Task 3 covers New agent dialog fields, command test, scope-based skill loading, skill name/path rendering, hidden fields; Task 4 covers required validation and OpenSpec task backfill.
- Placeholder scan: No TODO/TBD/fill-later placeholders remain; each task names exact files and commands.
- Type consistency: Existing `AgentType` remains `codex | claude`; UI displays `Claude Code` while saving `claude`. Existing `AgentScope` remains `project | global`.
