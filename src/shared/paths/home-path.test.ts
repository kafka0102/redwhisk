import { describe, expect, it } from "vitest";

import { formatHomePathForDisplay } from "./home-path";

describe("formatHomePathForDisplay", () => {
  it("shortens Unix home paths for display", () => {
    expect(
      formatHomePathForDisplay("/Users/yujianjia/workspace/kafka/redwhisk"),
    ).toBe("~/workspace/kafka/redwhisk");
    expect(formatHomePathForDisplay("/users/yujianjia/workspace")).toBe(
      "~/workspace",
    );
    expect(formatHomePathForDisplay("/home/me/repo")).toBe("~/repo");
  });

  it("shortens Windows home paths for display", () => {
    expect(formatHomePathForDisplay("C:\\Users\\me\\workspace\\repo")).toBe(
      "~\\workspace\\repo",
    );
  });

  it("keeps non-home paths unchanged", () => {
    expect(formatHomePathForDisplay("/tmp/redwhisk")).toBe("/tmp/redwhisk");
    expect(formatHomePathForDisplay("")).toBe("");
  });
});
