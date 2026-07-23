import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProfileForm } from "./agent-profile-form";
import { I18nProvider } from "../../shared/i18n/i18n";
import {
  detectCodexCommand,
  saveAgentProfile,
  testAgentCommand,
  type AgentProfileRecord,
} from "./settings-commands";
import {
  openShadcnSelect,
  selectShadcnOption,
} from "../../test/select-helpers";

vi.mock("./settings-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings-commands")>();
  return {
    ...actual,
    detectCodexCommand: vi.fn(),
    saveAgentProfile: vi.fn(),
    testAgentCommand: vi.fn(),
  };
});

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);
const testAgentCommandMock = vi.mocked(testAgentCommand);

function buildProfile(
  overrides: Partial<AgentProfileRecord> = {},
): AgentProfileRecord {
  return {
    id: 1,
    name: "Codex",
    agentType: "codex",
    command: "/usr/local/bin/codex",
    scope: "global",
    projectId: null,
    mode: "full-access",
    dangerous: true,
    defaultSkill: "",
    promptTemplate: "",
    del: 0,
    displayMode: "json",
    enabled: true,
    ...overrides,
  };
}

function renderForm(props: Parameters<typeof AgentProfileForm>[0]) {
  return render(
    <I18nProvider fixedLocale="zh">
      <AgentProfileForm {...props} />
    </I18nProvider>,
  );
}

describe("AgentProfileForm", () => {
  beforeEach(() => {
    detectCodexCommandMock.mockReset();
    saveAgentProfileMock.mockReset();
    testAgentCommandMock.mockReset();
    detectCodexCommandMock.mockResolvedValue({ command: "codex" });
    testAgentCommandMock.mockResolvedValue({ command: "codex" });
  });

  describe("agentType select", () => {
    it("renders 4 agentType options including opencode and grok", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await openShadcnSelect(user, screen, "智能体类型");

      for (const optionText of ["Codex", "Claude Code", "OpenCode", "Grok"]) {
        expect(
          await screen.findByRole("option", { name: optionText }),
        ).toBeInTheDocument();
      }
    });
  });

  describe("displayMode field", () => {
    it("defaults to json and shows switch UI for codex", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      // 切换控件可见 → trigger 存在
      const trigger = screen.getByRole("combobox", { name: "展示形式" });
      expect(trigger).toHaveTextContent("JSON");

      // 可切到 TUI
      await selectShadcnOption(user, screen, "展示形式", "TUI");
      expect(trigger).toHaveTextContent("TUI");
    });

    it("defaults to json and shows switch UI for opencode", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await selectShadcnOption(user, screen, "智能体类型", "OpenCode");

      const trigger = screen.getByRole("combobox", { name: "展示形式" });
      expect(trigger).toHaveTextContent("JSON");

      await selectShadcnOption(user, screen, "展示形式", "TUI");
      expect(trigger).toHaveTextContent("TUI");
    });

    it("locks tui and hides switch UI when agentType is grok", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await selectShadcnOption(user, screen, "智能体类型", "Grok");

      expect(screen.queryByRole("combobox", { name: "展示形式" })).toBeNull();
      expect(screen.getByLabelText("展示形式")).toHaveAttribute("readonly");
    });

    it("preserves tui when switching codex→opencode→codex", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      // 默认 codex/json，切到 tui
      await selectShadcnOption(user, screen, "展示形式", "TUI");
      // 列表收起后 trigger 显示 TUI
      expect(
        screen.getByRole("combobox", { name: "展示形式" }),
      ).toHaveTextContent("TUI");

      // 切到 opencode：保留 tui，仍可切换
      await selectShadcnOption(user, screen, "智能体类型", "OpenCode");
      expect(
        screen.getByRole("combobox", { name: "展示形式" }),
      ).toHaveTextContent("TUI");

      // 切回 codex → 仍可切，值仍为 tui
      await selectShadcnOption(user, screen, "智能体类型", "Codex");
      expect(
        screen.getByRole("combobox", { name: "展示形式" }),
      ).toHaveTextContent("TUI");
    });
  });

  describe("enabled field", () => {
    it("defaults to enabled Yes", () => {
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      expect(
        screen.getByRole("combobox", { name: "是否启用" }),
      ).toHaveTextContent("是");
    });

    it("can be toggled to No", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await selectShadcnOption(user, screen, "是否启用", "否");
      expect(
        screen.getByRole("combobox", { name: "是否启用" }),
      ).toHaveTextContent("否");
    });
  });

  describe("name validation", () => {
    it("shows error and disables submit when name exceeds 20 chars", async () => {
      const user = userEvent.setup();
      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      const nameInput = screen.getByLabelText("智能体配置名称");
      // 21 字符超长
      await user.type(nameInput, "a".repeat(21));

      expect(
        screen.getByText("智能体名称不能超过 20 个字符。"),
      ).toBeInTheDocument();

      const submit = screen.getByRole("button", { name: "保存" });
      expect(submit).toBeDisabled();
    });

    it("accepts 20 char name and submits successfully", async () => {
      const user = userEvent.setup();
      saveAgentProfileMock.mockResolvedValue(buildProfile());

      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      const nameInput = screen.getByLabelText("智能体配置名称");
      await user.type(nameInput, "a".repeat(20));

      const commandInput = screen.getByLabelText("智能体命令");
      await user.type(commandInput, "codex");

      const submit = screen.getByRole("button", { name: "保存" });
      expect(submit).not.toBeDisabled();

      await user.click(submit);

      await waitFor(() => {
        expect(saveAgentProfileMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("edit mode prefill", () => {
    it("prefills displayMode and enabled from profile", () => {
      renderForm({
        mode: "edit",
        scope: "global",
        projectId: null,
        profile: buildProfile({
          agentType: "claude",
          displayMode: "tui",
          enabled: false,
        }),
        onCancel: () => {},
        onSaved: () => {},
      });

      expect(
        screen.getByRole("combobox", { name: "展示形式" }),
      ).toHaveTextContent("TUI");
      expect(
        screen.getByRole("combobox", { name: "是否启用" }),
      ).toHaveTextContent("否");
    });

    it("prefills locked tui readonly input for grok profile", () => {
      renderForm({
        mode: "edit",
        scope: "global",
        projectId: null,
        profile: buildProfile({
          agentType: "grok",
          displayMode: "tui",
        }),
        onCancel: () => {},
        onSaved: () => {},
      });

      expect(screen.queryByRole("combobox", { name: "展示形式" })).toBeNull();
      expect(screen.getByLabelText("展示形式")).toHaveAttribute("readonly");
    });
  });

  describe("submit payload", () => {
    it("passes form displayMode and enabled to saveAgentProfile", async () => {
      const user = userEvent.setup();
      saveAgentProfileMock.mockResolvedValue(buildProfile());

      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await user.type(screen.getByLabelText("智能体配置名称"), "Codex");
      await user.type(screen.getByLabelText("智能体命令"), "codex");

      // 改 displayMode 为 tui、enabled 为否
      await selectShadcnOption(user, screen, "展示形式", "TUI");
      await selectShadcnOption(user, screen, "是否启用", "否");

      await user.click(screen.getByRole("button", { name: "保存" }));

      await waitFor(() => {
        expect(saveAgentProfileMock).toHaveBeenCalledWith(
          expect.objectContaining({
            displayMode: "tui",
            enabled: false,
          }),
        );
      });
    });

    it("passes default json + enabled form value for opencode", async () => {
      const user = userEvent.setup();
      saveAgentProfileMock.mockResolvedValue(
        buildProfile({ agentType: "opencode", displayMode: "json" }),
      );

      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await user.type(screen.getByLabelText("智能体配置名称"), "OpenCode");
      await user.type(screen.getByLabelText("智能体命令"), "opencode");

      await selectShadcnOption(user, screen, "智能体类型", "OpenCode");

      await user.click(screen.getByRole("button", { name: "保存" }));

      await waitFor(() => {
        expect(saveAgentProfileMock).toHaveBeenCalledWith(
          expect.objectContaining({
            agentType: "opencode",
            displayMode: "json",
            enabled: true,
          }),
        );
      });
    });

    it("can save switched tui displayMode for opencode", async () => {
      const user = userEvent.setup();
      saveAgentProfileMock.mockResolvedValue(
        buildProfile({ agentType: "opencode", displayMode: "tui" }),
      );

      renderForm({
        mode: "create",
        scope: "global",
        projectId: null,
        onCancel: () => {},
        onSaved: () => {},
      });

      await user.type(screen.getByLabelText("智能体配置名称"), "OpenCode");
      await user.type(screen.getByLabelText("智能体命令"), "opencode");

      await selectShadcnOption(user, screen, "智能体类型", "OpenCode");
      await selectShadcnOption(user, screen, "展示形式", "TUI");

      await user.click(screen.getByRole("button", { name: "保存" }));

      await waitFor(() => {
        expect(saveAgentProfileMock).toHaveBeenCalledWith(
          expect.objectContaining({
            agentType: "opencode",
            displayMode: "tui",
            enabled: true,
          }),
        );
      });
    });
  });
});
