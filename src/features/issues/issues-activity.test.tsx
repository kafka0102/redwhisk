import { render, screen, waitFor } from "@testing-library/react";
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

describe("IssuesActivity", () => {
  beforeEach(() => {
    createIssueMock.mockReset();
    listIssuesMock.mockReset();
    updateIssueMock.mockReset();
  });

  it("keeps the empty state when issue creation fails", async () => {
    const user = userEvent.setup();
    listIssuesMock.mockResolvedValue({ issues: [] });
    createIssueMock.mockRejectedValue({
      code: "ISSUE_VALIDATION_FAILED",
      message: "Issue title 不能为空。",
    });

    render(<IssuesActivity projectId={1} />);

    await user.click(await screen.findByRole("button", { name: "New Issue" }));
    await user.type(screen.getByLabelText("Title"), "Draft local issue");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));

    expect(
      await screen.findByRole("status", { name: "Issues status" }),
    ).toHaveTextContent("Issue title 不能为空。");
    expect(
      screen.queryByRole("button", { name: "Draft local issue" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Draft local issue")).toBeInTheDocument();
  });

  it("keeps the stored issue state when update fails", async () => {
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
    expect(
      await screen.findByRole("status", { name: "Issues status" }),
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
    expect(
      screen.queryByDisplayValue("Existing issue"),
    ).not.toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: "New Issue" }));
    await user.type(screen.getByLabelText("Title"), "Late issue");
    await user.click(screen.getByRole("button", { name: "Create Issue" }));
    rerender(<IssuesActivity projectId={2} />);
    resolveCreate({
      id: 21,
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
    expect(screen.getByDisplayValue("Existing issue")).toBeInTheDocument();
  });
});
