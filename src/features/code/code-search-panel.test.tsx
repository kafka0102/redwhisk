import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { CodeSearchPanel } from "./code-search-panel";
import {
  DEFAULT_CODE_CONTENT_SEARCH_STATE,
  type CodeContentSearchState,
} from "./code-search-state";

function StatefulPanel({
  initial = DEFAULT_CODE_CONTENT_SEARCH_STATE,
}: {
  initial?: CodeContentSearchState;
}) {
  const [state, setState] = useState(initial);
  return <CodeSearchPanel state={state} onChange={setState} />;
}

describe("CodeSearchPanel", () => {
  it("renders query, match options, include/exclude rows and empty results", () => {
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Match Case")).toBeInTheDocument();
    expect(screen.getByLabelText("Match Whole Word")).toBeInTheDocument();
    expect(screen.getByLabelText("Use Regular Expression")).toBeInTheDocument();
    expect(screen.getByLabelText("files to include")).toBeInTheDocument();
    expect(screen.getByLabelText("files to exclude")).toBeInTheDocument();
    expect(screen.getByLabelText("Search results")).toBeInTheDocument();
    expect(
      screen.getByText("No results yet. Press Enter to search."),
    ).toBeInTheDocument();
  });

  it("keeps query and match option state while editing", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <StatefulPanel />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText("Search"), "foo");
    expect(screen.getByLabelText("Search")).toHaveValue("foo");

    await user.click(screen.getByLabelText("Match Case"));
    expect(screen.getByLabelText("Match Case")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.type(screen.getByLabelText("files to include"), "*.ts");
    expect(screen.getByLabelText("files to include")).toHaveValue("*.ts");
  });
});
