import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, type RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { openShadcnSelect } from "../../../test/select-helpers";
import {
  getProjectIssueSourceSettings,
  updateProjectIssueSourceSettings,
  type ProjectIssueSourceSettings,
} from "../../settings/issue-source-commands";
import { IssueEditablePage } from "./issue-editable-page";

vi.mock("../../settings/issue-source-commands", () => ({
  getProjectIssueSourceSettings: vi.fn(),
  updateProjectIssueSourceSettings: vi.fn(),
}));

const getSettings = vi.mocked(getProjectIssueSourceSettings);
const updateSettings = vi.mocked(updateProjectIssueSourceSettings);

function settings(
  overrides: Partial<ProjectIssueSourceSettings> = {},
): ProjectIssueSourceSettings {
  const base: ProjectIssueSourceSettings = {
    projectId: 1,
    issueSourceMode: "mixed",
    issueDisplayMode: "board",
    issueSyncScope: "all_open",
    issueSyncLabel: null,
    issueSyncEnabled: true,
    issueSyncIntervalSeconds: 90,
    issueWritebackCloseOnComplete: false,
    issueWritebackCloseOnPrMerge: false,
    issueWritebackComment: false,
    issueCreateSource: "local",
    localIssueCount: 0,
    remoteIssueCount: 0,
    connection: {
      provider: "github",
      hostUrl: "https://github.com",
      repoPath: "acme/redwhisk",
      login: "lin",
      cliInstalled: true,
      cliAuthenticated: true,
      authStatus: "ready",
      checkedAt: 1,
    },
  };
  return {
    ...base,
    ...overrides,
    connection: {
      ...base.connection,
      ...overrides.connection,
    },
  };
}

function nearestCommonParent(
  left: HTMLElement,
  right: HTMLElement,
): HTMLElement {
  const ancestors = new Set<HTMLElement>();
  let current: HTMLElement | null = left;
  while (current !== null) {
    ancestors.add(current);
    current = current.parentElement;
  }
  current = right;
  while (current !== null) {
    if (ancestors.has(current)) {
      return current;
    }
    current = current.parentElement;
  }
  throw new Error("no common parent");
}

function CreatePage({
  onOpenProjectSettings = () => {},
}: {
  onOpenProjectSettings?: () => void;
}): React.JSX.Element {
  const titleInputRef = useRef<HTMLInputElement>(null);
  return (
    <I18nProvider fixedLocale="zh">
      <IssueEditablePage
        availableLabels={[]}
        errorMessage={null}
        form={{ title: "", description: "", attachments: [], labelIds: [] }}
        isLoadingLabels={false}
        isSaving={false}
        labelsErrorMessage={null}
        mode="create"
        projectId={1}
        selectedIssue={null}
        titleError={null}
        titleInputRef={titleInputRef as RefObject<HTMLInputElement | null>}
        onCancel={() => {}}
        onDeleteIssue={() => {}}
        onDownloadAttachment={() => {}}
        onFormChange={() => {}}
        onOpenProjectLabelsSettings={() => {}}
        onOpenProjectSettings={onOpenProjectSettings}
        onPreviewAttachment={() => {}}
        onRemoveAttachment={() => {}}
        onSelectAttachment={async () => null}
        onSubmit={() => {}}
      />
    </I18nProvider>
  );
}

describe("issue create source", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    updateSettings.mockResolvedValue(settings());
  });

  it("keeps the title first while the source mode is empty", async () => {
    getSettings.mockReturnValue(new Promise(() => {}));
    render(<CreatePage />);
    expect(screen.getByLabelText("标题")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "项目设置" }),
    ).not.toBeInTheDocument();
  });

  it("hides the source row for a local project", async () => {
    getSettings.mockResolvedValue(settings({ issueSourceMode: "local" }));
    render(<CreatePage />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("标题")).toBeInTheDocument();
  });

  it("hides the source row for a ready remote project and still creates", async () => {
    getSettings.mockResolvedValue(settings({ issueSourceMode: "remote" }));
    render(<CreatePage />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "项目设置" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Issue" })).toBeEnabled();
  });

  it("does not render a source dropdown when settings fail", async () => {
    getSettings.mockRejectedValue(new Error("offline"));
    render(<CreatePage />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.getByLabelText("标题")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "项目设置" }),
    ).not.toBeInTheDocument();
  });

  it("shows local and GitHub, and remembers the last remote choice", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(settings({ issueCreateSource: "remote" }));
    render(<CreatePage />);
    const source = await screen.findByRole("combobox", { name: "来源" });
    const title = screen.getByLabelText("标题");
    expect(source.tagName).toBe("BUTTON");
    expect(
      source.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      within(nearestCommonParent(source, title)).queryByPlaceholderText(
        "描述任务内容",
      ),
    ).not.toBeInTheDocument();
    expect(source).toHaveTextContent("GitHub");
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "项目设置" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("创建位置")).not.toBeInTheDocument();
    await openShadcnSelect(user, screen, "来源");
    expect(
      await screen.findByRole("option", { name: "本地" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "GitHub" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitLab" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "本地" }));
    expect(updateSettings).toHaveBeenCalledWith({
      projectId: 1,
      issueCreateSource: "local",
    });
  });

  it("shows local and GitLab without a GitHub card", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(
      settings({
        connection: {
          provider: "gitlab",
          hostUrl: "https://gitlab.example.com",
          repoPath: "acme/redwhisk",
          login: "lin",
          cliInstalled: true,
          cliAuthenticated: true,
          authStatus: "ready",
          checkedAt: 1,
        },
      }),
    );
    render(<CreatePage />);
    await screen.findByRole("combobox", { name: "来源" });
    await openShadcnSelect(user, screen, "来源");
    expect(
      await screen.findByRole("option", { name: "本地" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "GitLab" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitHub" }),
    ).not.toBeInTheDocument();
  });

  it("shows only local when the host is unknown", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(
      settings({
        connection: {
          provider: null,
          hostUrl: null,
          repoPath: null,
          login: null,
          cliInstalled: false,
          cliAuthenticated: false,
          authStatus: "unknown",
          checkedAt: 1,
        },
      }),
    );
    render(<CreatePage />);
    const source = await screen.findByRole("combobox", { name: "来源" });
    const title = screen.getByLabelText("标题");
    expect(
      source.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await openShadcnSelect(user, screen, "来源");
    expect(
      await screen.findByRole("option", { name: "本地" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitHub" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "GitLab" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an unready GitHub option disabled and still creates locally", async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    getSettings.mockResolvedValue(
      settings({
        issueCreateSource: "remote",
        connection: {
          provider: "github",
          hostUrl: "https://github.com",
          repoPath: "acme/redwhisk",
          login: null,
          cliInstalled: true,
          cliAuthenticated: false,
          authStatus: "unauthenticated",
          checkedAt: 1,
        },
      }),
    );
    render(<CreatePage onOpenProjectSettings={openSettings} />);
    const source = await screen.findByRole("combobox", { name: "来源" });
    expect(source).toHaveTextContent("本地");
    expect(
      screen.queryByRole("button", { name: "项目设置" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Issue" })).toBeEnabled();
    await openShadcnSelect(user, screen, "来源");
    const github = await screen.findByRole("option", { name: "GitHub" });
    expect(github).toHaveAttribute("aria-disabled", "true");
    await user.click(github);
    expect(updateSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: "本地" }));
    expect(updateSettings).toHaveBeenCalledWith({
      projectId: 1,
      issueCreateSource: "local",
    });
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("restores the previous source when remembering the choice fails", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(settings({ issueCreateSource: "remote" }));
    updateSettings.mockRejectedValueOnce(new Error("save failed"));
    render(<CreatePage />);
    expect(
      await screen.findByRole("combobox", { name: "来源" }),
    ).toHaveTextContent("GitHub");
    await openShadcnSelect(user, screen, "来源");
    await user.click(await screen.findByRole("option", { name: "本地" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "来源" })).toHaveTextContent(
        "GitHub",
      );
    });
  });

  it("disables create for a remote-only project that is not ready", async () => {
    const openSettings = vi.fn();
    getSettings.mockResolvedValue(
      settings({
        issueSourceMode: "remote",
        connection: {
          provider: "github",
          hostUrl: "https://github.com",
          repoPath: "acme/redwhisk",
          login: null,
          cliInstalled: false,
          cliAuthenticated: false,
          authStatus: "cli_missing",
          checkedAt: 1,
        },
      }),
    );
    render(<CreatePage onOpenProjectSettings={openSettings} />);
    expect(
      await screen.findByRole("button", { name: "项目设置" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "来源" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "创建 Issue" })).toBeDisabled();
    });
    await userEvent.click(screen.getByRole("button", { name: "项目设置" }));
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("matches the title input height and title-row gap", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/shared/styles/issue-detail.css"),
      "utf8",
    );
    expect(ruleBodyFor(css, ".issue-field--title input")).toMatch(
      /height:\s*44px/,
    );
    expect(ruleBodyFor(css, ".issue-create-title-row")).toMatch(/gap:\s*8px/);
    expect(ruleBodyFor(css, ".issue-create-source__trigger")).toMatch(
      /height:\s*44px/,
    );
  });
});

function ruleBodyFor(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  expect(selectorIndex).toBeGreaterThan(-1);
  const openBraceIndex = css.indexOf("{", selectorIndex);
  const closeBraceIndex = css.indexOf("}", openBraceIndex);
  return css.slice(openBraceIndex, closeBraceIndex);
}
