import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  BROWSER_RECENT_URLS_STORAGE_KEY,
  rememberRecentBrowserUrl,
} from "./session-browser-history";
import { SessionBrowserTab } from "./session-browser-tab";

describe("SessionBrowserTab", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not render the empty browser prompt by default", () => {
    renderWithI18n(<SessionBrowserTab />);

    expect(
      screen.queryByText("Enter an address to open a page."),
    ).not.toBeInTheDocument();
  });

  it("shows the 10 most recent urls on focus and filters them case-insensitively", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      BROWSER_RECENT_URLS_STORAGE_KEY,
      JSON.stringify([
        "https://history-11.example.com",
        "https://history-10.example.com",
        "https://history-09.example.com",
        "https://history-08.example.com",
        "https://history-07.example.com",
        "https://history-06.example.com",
        "https://history-05.example.com",
        "https://Alpha.example.com/Path",
        "https://history-03.example.com",
        "https://history-02.example.com",
        "https://history-01.example.com",
      ]),
    );

    renderWithI18n(<SessionBrowserTab />);

    const addressInput = screen.getByRole("textbox", {
      name: "Browser address",
    });
    await user.click(addressInput);

    expect(
      screen.getByRole("button", { name: "https://history-11.example.com" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "https://history-02.example.com",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "https://history-01.example.com",
      }),
    ).not.toBeInTheDocument();

    await user.type(addressInput, "alpHA");

    expect(
      screen.getByRole("button", {
        name: "https://Alpha.example.com/Path",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "https://history-11.example.com",
      }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "https://Alpha.example.com/Path",
      }),
    );

    expect(
      screen.getByTitle("Browser page https://Alpha.example.com/Path"),
    ).toHaveAttribute("src", "https://Alpha.example.com/Path");
  });

  it("stores only the latest 100 unique urls", () => {
    let recentUrls: string[] = [];

    for (let index = 0; index <= 100; index += 1) {
      recentUrls = rememberRecentBrowserUrl(
        `https://history-${index}.example.com`,
        recentUrls,
      );
    }

    expect(recentUrls).toHaveLength(100);
    expect(recentUrls[0]).toBe("https://history-100.example.com");
    expect(recentUrls[recentUrls.length - 1]).toBe(
      "https://history-1.example.com",
    );

    recentUrls = rememberRecentBrowserUrl(
      "https://history-42.example.com",
      recentUrls,
    );

    expect(recentUrls).toHaveLength(100);
    expect(recentUrls[0]).toBe("https://history-42.example.com");
    expect(
      recentUrls.filter(
        (recentUrl) => recentUrl === "https://history-42.example.com",
      ),
    ).toHaveLength(1);
  });
});

function renderWithI18n(component: ReactNode) {
  return render(<I18nProvider fixedLocale="en">{component}</I18nProvider>);
}
