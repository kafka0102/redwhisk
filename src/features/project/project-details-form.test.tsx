import { render, screen } from "@testing-library/react";
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
});
