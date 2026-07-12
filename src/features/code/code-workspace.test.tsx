import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { listCodeWorkspaceRoots } from "../agents/session-workspace-commands";
import { CodeWorkspace } from "./code-workspace";

vi.mock("../agents/session-workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  getProjectWorktreeFileTree: vi.fn(),
  listCodeWorkspaceRoots: vi.fn(),
  readProjectWorktreeFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

describe("CodeWorkspace", () => {
  it("uses the workspace snapshot returned when the project opened", () => {
    render(
      <I18nProvider initialLocale="en">
        <CodeWorkspace
          projectId={1}
          roots={[
            {
              branch: "main",
              path: "/tmp/redwhisk",
              isProjectRoot: true,
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(listCodeWorkspaceRoots).not.toHaveBeenCalled();
  });
});
