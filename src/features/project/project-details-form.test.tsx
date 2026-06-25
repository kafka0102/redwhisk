import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectDetailsForm } from "./project-details-form";

describe("ProjectDetailsForm", () => {
  it("renders auxiliary and submit buttons with different emphasis", () => {
    render(
      <ProjectDetailsForm
        ariaStatusLabel="Status"
        chooseFolderLabel="Choose folder"
        completionPolicy="manual"
        completionStrategyLabel="Git completion strategy"
        errorMessage={null}
        isChoosingRepoPath={false}
        isSubmitting={false}
        onChooseRepoPath={vi.fn()}
        onCompletionPolicyChange={vi.fn()}
        onNameChange={vi.fn()}
        onWorktreeLocationChange={vi.fn()}
        onSubmit={vi.fn()}
        projectName="RedWhisk"
        projectNameLabel="Project Name"
        repoPath="/tmp/redwhisk"
        repoPathLabel="Repository path"
        submitDisabled={false}
        submitLabel="Save"
        submittingLabel="Saving..."
      />,
    );

    const chooseFolderButton = screen.getByRole("button", {
      name: "Choose folder",
    });
    const saveButton = screen.getByRole("button", { name: "Save" });

    expect(chooseFolderButton.className).toContain("bg-background");
    expect(chooseFolderButton.className).not.toContain("bg-primary");
    expect(saveButton.className).toContain("bg-primary");
  });

  it("renders worktree location choices derived from the repository path", async () => {
    const user = userEvent.setup();
    const onWorktreeLocationChange = vi.fn();

    render(
      <ProjectDetailsForm
        ariaStatusLabel="Status"
        chooseFolderLabel="Choose folder"
        completionPolicy="manual"
        completionStrategyLabel="Git completion strategy"
        errorMessage={null}
        isChoosingRepoPath={false}
        isSubmitting={false}
        onChooseRepoPath={vi.fn()}
        onCompletionPolicyChange={vi.fn()}
        onNameChange={vi.fn()}
        onWorktreeLocationChange={onWorktreeLocationChange}
        onSubmit={vi.fn()}
        projectName="RedWhisk"
        projectNameLabel="Project Name"
        repoPath="/Users/me/workspace/kafka/redwhisk"
        repoPathLabel="Repository path"
        submitDisabled={false}
        submitLabel="Save"
        submittingLabel="Saving..."
        worktreeLocation="repo_sibling"
        worktreeLocationLabel="Worktree path"
      />,
    );

    expect(screen.getByLabelText("Worktree path")).toHaveTextContent(
      "~/workspace/kafka/redwhisk.worktrees",
    );

    await user.click(screen.getByRole("combobox", { name: "Worktree path" }));

    expect(
      await screen.findByRole("option", {
        name: "~/workspace/kafka/redwhisk.worktrees",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "~/workspace/kafka/redwhisk/.worktrees",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "~/.redwhisk/worktrees/redwhisk",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("option", {
        name: "~/workspace/kafka/redwhisk/.worktrees",
      }),
    );

    expect(onWorktreeLocationChange).toHaveBeenCalledWith("repo_internal");
  });

  it("shows a detected setup command as the textarea value", () => {
    render(
      <ProjectDetailsForm
        ariaStatusLabel="Status"
        chooseFolderLabel="Choose folder"
        completionPolicy="manual"
        completionStrategyLabel="Git completion strategy"
        errorMessage={null}
        isChoosingRepoPath={false}
        isSubmitting={false}
        onChooseRepoPath={vi.fn()}
        onCompletionPolicyChange={vi.fn()}
        onNameChange={vi.fn()}
        onSubmit={vi.fn()}
        projectName="RedWhisk"
        projectNameLabel="Project Name"
        repoPath="/Users/me/workspace/kafka/redwhisk"
        repoPathLabel="Repository path"
        submitDisabled={false}
        submitLabel="Save"
        submittingLabel="Saving..."
        worktreeSetupCommand="pnpm install"
        worktreeSetupCommandLabel="Worktree setup after creation"
        worktreeSetupCommandPlaceholder="Enter initialization steps to run after creating the worktree"
      />,
    );

    const setupCommand = screen.getByLabelText("Worktree setup after creation");

    expect(setupCommand).toHaveValue("pnpm install");
    expect(setupCommand).toHaveAttribute(
      "placeholder",
      "Enter initialization steps to run after creating the worktree",
    );
  });
});
