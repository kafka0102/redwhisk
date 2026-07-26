import { beforeEach, describe, expect, it, vi } from "vitest";

import { openCommitOnGithub } from "./open-commit-on-github";

describe("openCommitOnGithub", () => {
  const probe = vi.fn();
  const openUrl = vi.fn();

  beforeEach(() => {
    probe.mockReset();
    openUrl.mockReset();
  });

  it("opens browser when probe reports exists", async () => {
    probe.mockResolvedValue({
      status: "exists",
      commitUrl: "https://github.com/acme/widgets/commit/abc123",
    });
    openUrl.mockResolvedValue(undefined);

    await expect(
      openCommitOnGithub(
        { owner: "acme", repo: "widgets", commitHash: "abc123" },
        { probe, openUrl },
      ),
    ).resolves.toBe("opened");

    expect(probe).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      commitHash: "abc123",
    });
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/acme/widgets/commit/abc123",
    );
  });

  it("returns not_found without opening browser", async () => {
    probe.mockResolvedValue({ status: "not_found", commitUrl: null });

    await expect(
      openCommitOnGithub(
        { owner: "acme", repo: "widgets", commitHash: "deadbeef" },
        { probe, openUrl },
      ),
    ).resolves.toBe("not_found");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("returns network_error when probe reports network_error", async () => {
    probe.mockResolvedValue({ status: "network_error", commitUrl: null });

    await expect(
      openCommitOnGithub(
        { owner: "acme", repo: "widgets", commitHash: "abc" },
        { probe, openUrl },
      ),
    ).resolves.toBe("network_error");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("returns network_error when probe throws", async () => {
    probe.mockRejectedValue(new Error("offline"));

    await expect(
      openCommitOnGithub(
        { owner: "acme", repo: "widgets", commitHash: "abc" },
        { probe, openUrl },
      ),
    ).resolves.toBe("network_error");
  });

  it("returns open_failed when opener throws after exists", async () => {
    probe.mockResolvedValue({
      status: "exists",
      commitUrl: "https://github.com/acme/widgets/commit/abc",
    });
    openUrl.mockRejectedValue(new Error("blocked"));

    await expect(
      openCommitOnGithub(
        { owner: "acme", repo: "widgets", commitHash: "abc" },
        { probe, openUrl },
      ),
    ).resolves.toBe("open_failed");
  });

  it("falls back to constructed url when probe omits commitUrl", async () => {
    probe.mockResolvedValue({ status: "exists", commitUrl: null });
    openUrl.mockResolvedValue(undefined);

    await expect(
      openCommitOnGithub(
        { owner: "acme", repo: "widgets", commitHash: "abc" },
        { probe, openUrl },
      ),
    ).resolves.toBe("opened");
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/acme/widgets/commit/abc",
    );
  });
});
