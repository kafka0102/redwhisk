import { describe, expect, it } from "vitest";

import type { IssueFormState } from "./issue-activity-types";
import { isIssueFormDirty } from "./issue-form-dirty";

type Attachment = IssueFormState["attachments"][number];

const savedImage = { id: 1, displayName: "a.png", kind: "image" } as Attachment;
const savedText = { id: 2, displayName: "b.txt", kind: "text" } as Attachment;
const draftText = {
  token: "draft-1",
  displayName: "c.txt",
  kind: "text",
} as Attachment;

function form(overrides: Partial<IssueFormState> = {}): IssueFormState {
  return {
    title: "",
    description: "",
    attachments: [],
    labelIds: [],
    ...overrides,
  };
}

describe("isIssueFormDirty", () => {
  it("returns false when the form equals the baseline", () => {
    const baseline = form({
      title: "T",
      description: "D",
      attachments: [savedImage],
      labelIds: [3, 4],
    });
    expect(isIssueFormDirty({ ...baseline }, baseline)).toBe(false);
  });

  it("returns true when the title differs", () => {
    const baseline = form({ title: "T" });
    expect(isIssueFormDirty(form({ title: "T2" }), baseline)).toBe(true);
  });

  it("treats description as equal when only surrounding whitespace differs", () => {
    const baseline = form({ description: "D" });
    expect(isIssueFormDirty(form({ description: "   D  " }), baseline)).toBe(
      false,
    );
  });

  it("returns true when description content differs", () => {
    const baseline = form({ description: "D" });
    expect(isIssueFormDirty(form({ description: "D2" }), baseline)).toBe(true);
  });

  it("returns true when an attachment is added", () => {
    const baseline = form({ attachments: [] });
    expect(isIssueFormDirty(form({ attachments: [savedImage] }), baseline)).toBe(
      true,
    );
  });

  it("treats attachments as equal regardless of order", () => {
    const baseline = form({ attachments: [savedImage, savedText] });
    expect(
      isIssueFormDirty(form({ attachments: [savedText, savedImage] }), baseline),
    ).toBe(false);
  });

  it("returns true when an attachment identity changes", () => {
    const baseline = form({ attachments: [savedText] });
    expect(isIssueFormDirty(form({ attachments: [draftText] }), baseline)).toBe(
      true,
    );
  });

  it("returns true when an attachment display name differs for the same id", () => {
    const baseline = form({ attachments: [savedImage] });
    const renamed = { ...savedImage, displayName: "renamed.png" } as Attachment;
    expect(isIssueFormDirty(form({ attachments: [renamed] }), baseline)).toBe(
      true,
    );
  });

  it("returns true when an attachment kind differs for the same id", () => {
    const baseline = form({ attachments: [savedImage] });
    const rekind = { ...savedImage, kind: "text" } as Attachment;
    expect(isIssueFormDirty(form({ attachments: [rekind] }), baseline)).toBe(
      true,
    );
  });

  it("returns true when label ids differ", () => {
    const baseline = form({ labelIds: [1, 2] });
    expect(isIssueFormDirty(form({ labelIds: [2, 1] }), baseline)).toBe(true);
  });

  it("returns false when label ids match in order", () => {
    const baseline = form({ labelIds: [1, 2] });
    expect(isIssueFormDirty(form({ labelIds: [1, 2] }), baseline)).toBe(false);
  });
});
