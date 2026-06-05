import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuesActivity } from "./issues-activity";
import {
  createIssue,
  listIssues,
  updateIssue,
  type IssueRecord,
} from "./issue-commands";

vi.mock("./issue-commands", () => ({
  createIssue: vi.fn(),
  listIssues: vi.fn(),
  updateIssue: vi.fn(),
}));

const createIssueMock = vi.mocked(createIssue);
const listIssuesMock = vi.mocked(listIssues);
const updateIssueMock = vi.mocked(updateIssue);

const existingIssue: IssueRecord = {
  id: 20,
  projectId: 1,
  title: "Existing issue",
  description: "Existing description",
  status: "backlog",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_632_000_000,
};

const runningIssue: IssueRecord = {
  id: 21,
  projectId: 1,
  title: "Running issue",
  description: "Running description",
  status: "running",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_633_000_000,
};

const reviewIssue: IssueRecord = {
  id: 22,
  projectId: 1,
  title: "Review issue",
  description: "Review description",
  status: "review",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_634_000_000,
};

const completedIssue: IssueRecord = {
  id: 23,
  projectId: 1,
  title: "Completed issue",
  description: "Completed description",
  status: "completed",
  createdAt: 1_780_632_000_000,
  updatedAt: 1_780_635_000_000,
};

describe("IssuesActivity", () => {
  beforeEach(() => {
    createIssueMock.mockReset();
    listIssuesMock.mockReset();
    updateIssueMock.mockReset();
  });

  it("renders four persistent lanes and groups issues by status", async () => {
    listIssuesMock.mockResolvedValue({
      issues: [existingIssue, runningIssue, reviewIssue, completedIssue],
    });

    render(<IssuesActivity projectId={1} />);

    const backlogLane = await screen.findByRole("region", {
      name: "Backlog",
    });
    const runningLane = screen.getByRole("region", { name: "Running" });
    const reviewLane = screen.getByRole("region", { name: "Review" });
    const completedLane = screen.getByRole("region", { name: "Completed" });

    expect(
      within(backlogLane).getByRole("button", { name: "Existing issue" }),
    ).toBeInTheDocument();
    expect(
      within(runningLane).getByRole("button", { name: "Running issue" }),
    ).toBeInTheDocument();
    expect(
      within(reviewLane).getByRole("button", { name: "Review issue" }),
    ).toBeInTheDocument();
    expect(
      within(completedLane).getByRole("button", { name: "Completed issue" }),
    ).toBeInTheDocument();
    expect(
      within(backlogLane).queryByRole("button", { name: "Running issue" }),
    ).not.toBeInTheDocument();
  });

  it("keeps empty lanes visible when only backlog issues exist", async () => {
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    const runningLane = await screen.findByRole("region", { name: "Running" });
    const reviewLane = screen.getByRole("region", { name: "Review" });
    const completedLane = screen.getByRole("region", { name: "Completed" });

    expect(runningLane).toHaveTextContent("0");
    expect(runningLane).toHaveTextContent("No issues yet.");
    expect(reviewLane).toHaveTextContent("No issues yet.");
    expect(completedLane).toHaveTextContent("No issues yet.");
  });

  it("keeps card content limited to title, status, and updated time", async () => {
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    const card = await screen.findByRole("button", {
      name: "Existing issue",
    });

    expect(card).toHaveTextContent("Existing issue");
    expect(card).toHaveTextContent("Backlog");
    expect(card).toHaveAccessibleDescription(/Backlog/);
    expect(card).not.toHaveTextContent("Existing description");
    expect(card).not.toHaveTextContent(/priority|label|assignee|milestone/i);
  });

  it("opens an issue details dialog with read-only metadata", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Issue Details",
    });
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Existing issue",
    );
    expect(within(dialog).getByLabelText("Description")).toHaveValue(
      "Existing description",
    );
    expect(
      within(dialog).queryByLabelText(/status|updated/i, {
        selector: "input, textarea, select",
      }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText("Backlog")).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatTestTimestamp(existingIssue.updatedAt)),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Run Issue" }),
    ).toBeDisabled();
  });

  it("closes the detail dialog with Escape and restores focus to the triggering card", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    const card = await screen.findByRole("button", { name: "Existing issue" });
    await user.click(card);

    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(card).toHaveFocus();
  });

  it("keeps Tab focus inside the issue dialog", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Issue Details" });
    expect(within(dialog).getByLabelText("Title")).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();

    await user.tab();
    expect(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    ).toHaveFocus();

    await user.tab();
    expect(
      within(dialog).getByRole("button", { name: "Close issue dialog" }),
    ).toHaveFocus();
  });

  it("keeps the empty kanban and dialog input when issue creation fails", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockRejectedValue({
      code: "ISSUE_VALIDATION_FAILED",
      message: "Issue title 不能为空。",
    });

    render(<IssuesActivity projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Create Issue" }));
    await user.type(screen.getByLabelText("Title"), "Draft local issue");
    const dialog = screen.getByRole("dialog", { name: "New Issue" });
    await user.click(
      within(dialog).getByRole("button", { name: "Create Issue" }),
    );

    expect(
      await within(dialog).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue title 不能为空。");
    expect(
      screen.queryByRole("button", { name: "Draft local issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Draft local issue")).toBeInTheDocument();
  });

  it("keeps the create dialog open while a create request is pending", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockImplementation(
      () => new Promise<IssueRecord>(() => undefined),
    );

    render(<IssuesActivity projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Create Issue" }));
    await user.type(screen.getByLabelText("Title"), "Pending issue");
    const dialog = screen.getByRole("dialog", { name: "New Issue" });
    await user.click(
      within(dialog).getByRole("button", { name: "Create Issue" }),
    );
    await user.keyboard("{Escape}");

    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create Issue" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("keeps the stored issue card when update fails", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    updateIssueMock.mockRejectedValue({
      code: "ISSUE_NOT_FOUND",
      message: "Issue 不存在。",
    });

    render(<IssuesActivity projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Failed update");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      title: "Failed update",
      description: "Existing description",
    });
    const dialog = screen.getByRole("dialog", { name: "Issue Details" });
    expect(
      await within(dialog).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue 不存在。");
    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: "Failed update" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Failed update")).toBeInTheDocument();
  });

  it("clears stale issue state when a new project list fails", async () => {
    listIssuesMock.mockResolvedValueOnce({ issues: [existingIssue] });
    const { rerender } = render(<IssuesActivity projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "Existing issue" }),
    ).toBeInTheDocument();

    listIssuesMock.mockRejectedValueOnce({
      code: "PROJECT_NOT_FOUND",
      message: "Project 不存在。",
    });
    rerender(<IssuesActivity projectId={2} />);

    expect(
      await screen.findByRole("status", { name: "Issues status" }),
    ).toHaveTextContent("Project 不存在。");
    expect(
      screen.queryByRole("button", { name: "Existing issue" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a late create result after switching projects", async () => {
    const user = userEvent.setup();
    let resolveCreate: (issue: IssueRecord) => void = () => {};
    listIssuesMock
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] });
    createIssueMock.mockImplementation(
      () =>
        new Promise<IssueRecord>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { rerender } = render(<IssuesActivity projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "Create Issue" }));
    await user.type(screen.getByLabelText("Title"), "Late issue");
    await user.click(
      within(screen.getByRole("dialog", { name: "New Issue" })).getByRole(
        "button",
        { name: "Create Issue" },
      ),
    );
    rerender(<IssuesActivity projectId={2} />);
    resolveCreate({
      id: 24,
      projectId: 1,
      title: "Late issue",
      description: "",
      status: "backlog",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
    });

    await waitFor(() => expect(listIssuesMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Late issue" }),
    ).not.toBeInTheDocument();
  });

  it("restores the selected issue when create is canceled", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    expect(
      await screen.findByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the page header action to create issues", async () => {
    listIssuesMock.mockResolvedValue({ issues: [] });

    render(<IssuesActivity projectId={1} />);

    const header = screen
      .getByRole("heading", {
        name: "Issues",
      })
      .closest(".surface-header");
    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    expect(header).not.toBeNull();
    const createButton = within(header as HTMLElement).getByRole("button", {
      name: "Create Issue",
    });

    expect(header).toHaveTextContent(
      "Keep backlog, active runs, review, and completion in one board.",
    );
    expect(
      within(backlogLane).queryByRole("button", {
        name: "Create Issue",
      }),
    ).not.toBeInTheDocument();
    expect(createButton).toBeInTheDocument();
  });
});

function formatTestTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
