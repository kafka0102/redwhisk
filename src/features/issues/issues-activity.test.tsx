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

vi.mock("./issue-description-editor", () => ({
  IssueDescriptionEditor: ({
    ariaLabel,
    onChange,
    placeholder,
    value,
  }: {
    ariaLabel: string;
    onChange: (value: string) => void;
    placeholder: string;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
    expect(runningLane).toHaveTextContent("no issues");
    expect(reviewLane).toHaveTextContent("no issues");
    expect(completedLane).toHaveTextContent("no issues");
  });

  it("shows issue id, updated time, full title, and a single-line description excerpt", async () => {
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    const card = await screen.findByRole("button", {
      name: "Existing issue",
    });

    expect(card).toHaveTextContent("Existing issue");
    expect(card).toHaveTextContent("#20");
    expect(card).toHaveTextContent(formatTestTimestamp(existingIssue.updatedAt));
    expect(card).toHaveTextContent("Existing description");
    expect(card).not.toHaveTextContent(/priority|label|assignee|milestone/i);
  });

  it("opens an issue detail dialog without status or updated-at fields", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });

    render(<IssuesActivity projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Issue Detail",
    });
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Existing issue",
    );
    expect(within(dialog).getByLabelText("Description")).toHaveValue(
      "Existing description",
    );
    expect(within(dialog).getByPlaceholderText("Issue title")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Description")).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText(/status|updated/i, {
        selector: "input, textarea, select",
      }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Backlog")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(formatTestTimestamp(existingIssue.updatedAt)),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Run" })).toBeDisabled();
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

    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
    expect(within(dialog).getByLabelText("Title")).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();

    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveFocus();

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

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "draft local issue");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    const dialog = screen.getByRole("dialog", { name: "New Issue" });
    expect(
      await within(dialog).findByRole("status", { name: "Dialog status" }),
    ).toHaveTextContent("Issue title 不能为空。");
    expect(
      screen.queryByRole("button", { name: "draft local issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("draft local issue")).toBeInTheDocument();
  });

  it("keeps the create dialog open while a create request is pending", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockImplementation(
      () => new Promise<IssueRecord>(() => undefined),
    );

    render(<IssuesActivity projectId={1} />);

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Pending issue");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("dialog", { name: "New Issue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Issue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("keeps lowercase input and closes the create dialog after save", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockResolvedValue({
      id: 24,
      projectId: 1,
      title: "draft local issue",
      description: "small task shape",
      status: "backlog",
      createdAt: 1_780_632_000_000,
      updatedAt: 1_780_632_000_000,
    });

    render(<IssuesActivity projectId={1} />);

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    const titleInput = screen.getByLabelText("Title");
    const descriptionInput = screen.getByLabelText("Description");
    await user.type(titleInput, "draft local issue");
    await user.type(descriptionInput, "small task shape");

    expect(titleInput).toHaveValue("draft local issue");
    expect(descriptionInput).toHaveValue("small task shape");

    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    await waitFor(() =>
      expect(createIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        title: "draft local issue",
        description: "small task shape",
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "New Issue" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "draft local issue" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the edit dialog after save", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [existingIssue] });
    updateIssueMock.mockResolvedValue({
      ...existingIssue,
      title: "Updated issue",
      description: "Updated description",
      updatedAt: 1_780_635_600_000,
    });

    render(<IssuesActivity projectId={1} />);

    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated issue");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Updated description");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateIssueMock).toHaveBeenCalledWith({
        projectId: 1,
        issueId: 20,
        title: "Updated issue",
        description: "Updated description",
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Issue Detail" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Updated issue" }),
    ).toHaveAttribute("aria-pressed", "true");
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
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      title: "Failed update",
      description: "Existing description",
    });
    const dialog = screen.getByRole("dialog", { name: "Issue Detail" });
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

    await user.click(
      (await screen.findAllByRole("button", { name: "New Issue" }))[0],
    );
    await user.type(screen.getByLabelText("Title"), "Late issue");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
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
    await user.click(screen.getByRole("button", { name: "New Issue" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Existing issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the backlog lane header plus action to create issues", async () => {
    listIssuesMock.mockResolvedValue({ issues: [] });

    render(<IssuesActivity projectId={1} />);

    const header = screen.getByRole("heading", {
      name: "Issues",
    }).parentElement;
    const backlogLane = await screen.findByRole("region", { name: "Backlog" });
    const createButton = within(backlogLane).getByRole("button", {
      name: "New Issue",
    });

    expect(header).not.toHaveTextContent("New Issue");
    expect(
      within(backlogLane).queryByRole("button", {
        name: "New Issue for backlog",
      }),
    ).not.toBeInTheDocument();
    expect(createButton).toBeInTheDocument();
  });
});

function formatTestTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}
