import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatePromptBadge } from "./update-prompt-badge";
import type { UpdateStatus } from "../../shared/commands/app-update-commands";

const openReleasePageMock = vi.fn();

vi.mock("./open-release-page", () => ({
  openReleasePage: (...args: unknown[]) => openReleasePageMock(...args),
}));

function buildStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    shouldShowPrompt: true,
    currentVersion: "0.0.3",
    hasUpdate: true,
    latestVersion: "0.1.0",
    releaseUrl: "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
    ignoredVersion: null,
    snoozeUntil: null,
    checkedAt: "2026-07-14T12:00:00.000Z",
    errorCode: null,
    ...overrides,
  };
}

describe("UpdatePromptBadge", () => {
  beforeEach(() => {
    openReleasePageMock.mockReset();
    openReleasePageMock.mockResolvedValue(true);
  });

  it("renders nothing when shouldShowPrompt is false", () => {
    const { container } = render(
      <UpdatePromptBadge
        status={buildStatus({ shouldShowPrompt: false })}
        onDismiss={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the release page when the main label is clicked", async () => {
    const user = userEvent.setup();
    render(<UpdatePromptBadge status={buildStatus()} onDismiss={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Open release page" }));

    await waitFor(() => {
      expect(openReleasePageMock).toHaveBeenCalledWith(
        "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
      );
    });
  });

  it("dismisses via snooze and ignore menu actions", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(<UpdatePromptBadge status={buildStatus()} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: "Dismiss options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Remind me in 7 days" }),
    );
    expect(onDismiss).toHaveBeenCalledWith("snooze7Days");

    await user.click(screen.getByRole("button", { name: "Dismiss options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Ignore this version" }),
    );
    expect(onDismiss).toHaveBeenCalledWith("ignoreVersion");
  });
});
