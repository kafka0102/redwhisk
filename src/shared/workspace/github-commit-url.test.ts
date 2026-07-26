import { describe, expect, it } from "vitest";

import { buildGithubCommitUrl } from "./github-commit-url";

describe("buildGithubCommitUrl", () => {
  it("builds commit url for owner/repo/hash", () => {
    expect(buildGithubCommitUrl("acme", "widgets", "abcdef1")).toBe(
      "https://github.com/acme/widgets/commit/abcdef1",
    );
  });

  it("strips .git suffix from repo and trims parts", () => {
    expect(buildGithubCommitUrl(" acme ", "widgets.git", " abc ")).toBe(
      "https://github.com/acme/widgets/commit/abc",
    );
  });
});
