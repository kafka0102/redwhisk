import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { IssuePagePrototypeSection } from "./issue-page-prototype";

describe("IssuePagePrototypeSection", () => {
  it("switches between create, edit, and read-only prototypes", async () => {
    const user = userEvent.setup();

    render(<IssuePagePrototypeSection />);

    expect(
      screen.getByRole("heading", { name: "Issue prototype" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "New issue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit issue" }));

    expect(
      screen.getByRole("heading", { name: "Edit issue" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).queryByRole("button", {
        name: "Delete issue",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete issue" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Read-only" }));

    expect(
      screen.getByRole("heading", { name: "Issue #184 · ID 184" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "In progress" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
  });
});
