import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, type RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
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
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    expect(screen.queryByText("创建位置")).not.toBeInTheDocument();
  });

  it("hides the source row for a local project", async () => {
    getSettings.mockResolvedValue(settings({ issueSourceMode: "local" }));
    render(<CreatePage />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    expect(screen.getByLabelText("标题")).toBeInTheDocument();
  });

  it("hides the source row for a ready remote project and still creates", async () => {
    getSettings.mockResolvedValue(settings({ issueSourceMode: "remote" }));
    render(<CreatePage />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "GitHub" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Issue" })).toBeEnabled();
  });

  it("shows local and GitHub, and remembers the last remote choice", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue(settings({ issueCreateSource: "remote" }));
    render(<CreatePage />);
    expect(
      await screen.findByRole("group", { name: "来源" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本地" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "GitHub" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "GitLab" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("创建位置")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "本地" }));
    expect(updateSettings).toHaveBeenCalledWith({
      projectId: 1,
      issueCreateSource: "local",
    });
  });

  it("shows local and GitLab without a GitHub card", async () => {
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
    expect(
      await screen.findByRole("button", { name: "GitLab" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本地" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "GitHub" }),
    ).not.toBeInTheDocument();
  });

  it("shows only local when the host is unknown", async () => {
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
    expect(
      await screen.findByRole("button", { name: "本地" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "GitHub" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "GitLab" }),
    ).not.toBeInTheDocument();
  });

  it("disables the remote card until the connection is ready and still allows local", async () => {
    const openSettings = vi.fn();
    getSettings.mockResolvedValue(
      settings({
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
    expect(
      await screen.findByRole("button", { name: "GitHub" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "本地" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "项目设置" }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "创建 Issue" })).toBeEnabled();
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
    expect(screen.queryByText("来源")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "创建 Issue" })).toBeDisabled();
    });
    await userEvent.click(screen.getByRole("button", { name: "项目设置" }));
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
