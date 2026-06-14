import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { GlobalSettingsActivity } from "./global-settings-activity";

function renderGlobalSettings() {
  return render(
    <I18nProvider>
      <GlobalSettingsActivity />
    </I18nProvider>,
  );
}

describe("GlobalSettingsActivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders Preferences with English language and Light theme by default", () => {
    renderGlobalSettings();

    expect(
      screen.getByRole("navigation", { name: "Global Settings menu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preferences" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "Preferences" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Dark" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "System" }),
    ).not.toBeInTheDocument();
  });

  it("switches Preferences labels to Chinese immediately", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(screen.getByRole("button", { name: "中文" }));

    expect(
      screen.getByRole("heading", { name: "偏好设置" }),
    ).toBeInTheDocument();
    expect(screen.getByText("语言")).toBeInTheDocument();
    expect(screen.getByText("主题")).toBeInTheDocument();
    expect(window.localStorage.getItem("redwhisk.locale")).toBe("zh");
  });
});
