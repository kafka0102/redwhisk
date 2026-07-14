import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrlMock = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

describe("openReleasePage", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
  });

  it("opens the given url and returns true", async () => {
    openUrlMock.mockResolvedValue(undefined);
    const { openReleasePage } = await import("./open-release-page");

    await expect(
      openReleasePage(
        "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
      ),
    ).resolves.toBe(true);

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
    );
  });

  it("returns false when opener fails", async () => {
    openUrlMock.mockRejectedValue(new Error("blocked"));
    const { openReleasePage } = await import("./open-release-page");

    await expect(openReleasePage("https://example.com/r")).resolves.toBe(false);
  });

  it("returns false for empty url without calling opener", async () => {
    const { openReleasePage } = await import("./open-release-page");

    await expect(openReleasePage("")).resolves.toBe(false);
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
