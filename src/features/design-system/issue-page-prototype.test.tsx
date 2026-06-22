import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Read-only" }));

    expect(
      screen.getByRole("heading", { name: "Issue detail" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to board" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
  });
});
