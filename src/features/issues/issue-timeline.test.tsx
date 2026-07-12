import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { getIssueTimeline } from "./issue-commands";
import { IssueTimeline } from "./issue-timeline";

vi.mock("./issue-commands", () => ({
  getIssueTimeline: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

const getIssueTimelineMock = vi.mocked(getIssueTimeline);

function renderTimeline() {
  return render(
    <I18nProvider fixedLocale="en">
      <IssueTimeline issueId={2} projectId={1} />
    </I18nProvider>,
  );
}

describe("IssueTimeline", () => {
  it("does not render the activity module when no entries exist", async () => {
    getIssueTimelineMock.mockResolvedValue({ entries: [] });

    renderTimeline();

    await waitFor(() => {
      expect(getIssueTimelineMock).toHaveBeenCalledWith({
        issueId: 2,
        projectId: 1,
      });
    });
    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(screen.queryByText("Activity")).toBeNull();
  });

  it("renders the created entry with a fallback avatar and relative time", async () => {
    getIssueTimelineMock.mockResolvedValue({
      entries: [
        {
          actionType: "issue_created",
          actor: { name: "Alice", avatarPath: null },
          createdAt: Date.now() - 120_000,
        },
      ],
    });

    renderTimeline();

    expect(
      await screen.findByRole("region", { name: "Activity" }),
    ).toBeVisible();
    expect(screen.getByText("Alice")).toBeVisible();
    expect(screen.getByText("created this Issue")).toBeVisible();
    expect(screen.getByText("2m ago")).toBeVisible();
    expect(document.querySelector(".issue-timeline__avatar")).toHaveAttribute(
      "src",
      expect.stringContaining("default_user_profile"),
    );
  });
});
