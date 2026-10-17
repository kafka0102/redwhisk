import { describe, expect, it } from "vitest";

import { filterCompletedReviewInput } from "./completed-review-input";

describe("filterCompletedReviewInput", () => {
  it("keeps wheel and page keys for the CLI", () => {
    expect(filterCompletedReviewInput("\u001b[5~")).toBe("\u001b[5~");
    expect(filterCompletedReviewInput("\u001b[6~")).toBe("\u001b[6~");
    expect(filterCompletedReviewInput("\u001b[<64;10;20M")).toBe(
      "\u001b[<64;10;20M",
    );
    expect(filterCompletedReviewInput("\u001b[<65;10;20M")).toBe(
      "\u001b[<65;10;20M",
    );
  });

  it("drops letters, enter, editing keys, and paste", () => {
    expect(filterCompletedReviewInput("a")).toBe("");
    expect(filterCompletedReviewInput("Hello")).toBe("");
    expect(filterCompletedReviewInput("\r")).toBe("");
    expect(filterCompletedReviewInput("\u007f")).toBe("");
    expect(filterCompletedReviewInput("\u001b[A")).toBe("");
    expect(filterCompletedReviewInput("\u0016pasted")).toBe("");
  });
});
