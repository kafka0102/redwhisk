import { describe, expect, it } from "vitest";

import en from "../../../shared/i18n/locales/en.json";
import zh from "../../../shared/i18n/locales/zh.json";
import {
  createHostAttachmentController,
  descriptionWithoutToken,
  type HostAttachmentController,
  type HostFile,
} from "./host-attachment-upload";

const MARKDOWN = "![shot.png](https://github.com/user-attachments/assets/abc)";
const INPUT =
  "See this\n\n![shot.png]({{issue-attachment-temp:img}})\n\nNotes\n";

function file(
  token: string,
  displayName: string,
  byteLength?: number,
): HostFile {
  return {
    token,
    displayName,
    sourcePath: `/tmp/${displayName}`,
    byteLength,
  };
}

function formWith(
  upload: (input: {
    sourcePath: string;
    displayName: string;
    tempToken: string;
  }) => Promise<string>,
): HostAttachmentController {
  return createHostAttachmentController({
    upload,
    createIssue: async () => undefined,
    updateIssue: async () => undefined,
    deleteHost: async () => undefined,
  });
}

describe("host attachment upload on select", () => {
  it("uploads the selected png once before create", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("img", "shot.png"));
    expect(form.uploadCalls).toEqual([
      {
        sourcePath: "/tmp/shot.png",
        displayName: "shot.png",
        tempToken: "img",
      },
    ]);
    expect(form.createCalls).toBe(0);
  });

  it("waits for the in-flight upload before creating once", async () => {
    let release: (markdown: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const form = formWith(() => pending);
    await form.setCreateSource("remote", "github");
    const selected = form.selectFile(file("img", "shot.png"));
    const submitted = form.submit(INPUT);
    await Promise.resolve();
    expect(form.createCalls).toBe(0);
    release(MARKDOWN);
    await submitted;
    await selected;
    expect(form.createCalls).toBe(1);
  });

  it("does not create when upload fails and retries only that file", async () => {
    let shot = 0;
    let other = 0;
    const form = formWith(async (input) => {
      if (input.displayName === "shot.png") {
        shot += 1;
        throw new Error("upload failed");
      }
      other += 1;
      return "![other.png](https://github.com/user-attachments/assets/ok)";
    });
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("img", "shot.png"));
    await form.selectFile(file("ok", "other.png"));
    await form.submit(INPUT);
    expect(form.createCalls).toBe(0);
    expect(shot).toBe(2);
    expect(other).toBe(1);
  });

  it("does not upload a bmp and still creates", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("bmp", "shot.bmp"));
    expect(form.uploadCalls).toHaveLength(0);
    expect(form.status("bmp")).toBe("rejected");
    await form.submit("see");
    expect(form.createCalls).toBe(1);
  });

  it("uploads Shot.PNG and skips shot.bmp", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("png", "Shot.PNG"));
    await form.selectFile(file("bmp", "shot.bmp"));
    expect(form.uploadCalls.map((call) => call.displayName)).toEqual([
      "Shot.PNG",
    ]);
  });

  it("uploads a 10485760 byte png and keeps a larger png on the form", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("exact", "exact.png", 10_485_760));
    await form.selectFile(file("over", "over.png", 10_485_761));
    expect(form.uploadCalls.map((call) => call.displayName)).toEqual([
      "exact.png",
    ]);
    expect(form.status("over")).toBe("failed");
    await form.submit("body");
    expect(form.createCalls).toBe(0);
  });

  it("does not upload while the create source is local", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("local", "github");
    await form.selectFile(file("img", "shot.png"));
    expect(form.uploadCalls).toHaveLength(0);
  });

  it("keeps the temp token when the source switches back to local", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("img", "shot.png"));
    await form.setCreateSource("local", "github");
    const description = form.submittedDescription(INPUT);
    expect(description).toContain("{{issue-attachment-temp:img}}");
    expect(description).not.toContain(
      "https://github.com/user-attachments/assets/abc",
    );
  });

  it("uploads after the source switches from local to remote and does not create yet", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("local", "github");
    await form.selectFile(file("img", "shot.png"));
    await form.setCreateSource("remote", "github");
    expect(form.uploadCalls).toHaveLength(1);
    expect(form.createCalls).toBe(0);
  });

  it("omits the uploaded url after the file is removed and does not delete the host file", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("img", "shot.png"));
    form.removeFile("img");
    await form.submit(descriptionWithoutToken(INPUT, "img"));
    expect(form.deleteCalls).toBe(0);
    expect(form.createDescriptions[0]).not.toContain(
      "https://github.com/user-attachments/assets/abc",
    );
  });

  it("does not delete or create when the draft is cancelled", async () => {
    const form = formWith(async () => MARKDOWN);
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("img", "shot.png"));
    form.cancel();
    expect(form.deleteCalls).toBe(0);
    expect(form.createCalls).toBe(0);
  });

  it("does not upload while editing an existing issue", async () => {
    const form = formWith(async () => MARKDOWN);
    form.setMode("edit");
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("img", "shot.png"));
    await form.saveEdit();
    expect(form.uploadCalls).toHaveLength(0);
    expect(form.updateCalls).toBe(1);
    expect(form.createCalls).toBe(0);
  });

  it("uploads the selected mp4 once before create", async () => {
    const form = formWith(
      async () => "https://github.com/user-attachments/assets/vid",
    );
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("vid", "clip.mp4"));
    expect(form.uploadCalls).toEqual([
      {
        sourcePath: "/tmp/clip.mp4",
        displayName: "clip.mp4",
        tempToken: "vid",
      },
    ]);
    expect(form.status("vid")).toBe("uploaded");
    expect(form.createCalls).toBe(0);
  });

  it("uploads mov and webm and does not upload a pdf on github", async () => {
    const form = formWith(
      async () => "https://github.com/user-attachments/assets/vid",
    );
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("mov", "clip.mov"));
    await form.selectFile(file("webm", "clip.webm"));
    await form.selectFile(file("pdf", "notes.pdf"));
    expect(form.uploadCalls.map((call) => call.displayName)).toEqual([
      "clip.mov",
      "clip.webm",
    ]);
    expect(form.status("pdf")).toBe("rejected");
  });

  it("uploads a 104857600 byte mp4 and keeps a larger mp4 on the form", async () => {
    const form = formWith(
      async () => "https://github.com/user-attachments/assets/vid",
    );
    await form.setCreateSource("remote", "github");
    await form.selectFile(file("exact", "exact.mp4", 104_857_600));
    await form.selectFile(file("over", "over.mp4", 104_857_601));
    expect(form.uploadCalls.map((call) => call.displayName)).toEqual([
      "exact.mp4",
    ]);
    expect(form.status("over")).toBe("failed");
    await form.submit("body");
    expect(form.createCalls).toBe(0);
  });

  it("uploads every selected gitlab file instead of rejecting it", async () => {
    const form = formWith(async () => "[notes.pdf](/uploads/hash/notes.pdf)");
    await form.setCreateSource("remote", "gitlab");
    await form.selectFile(file("pdf", "notes.pdf"));
    await form.selectFile(file("zip", "notes.zip"));
    expect(form.uploadCalls.map((call) => call.displayName)).toEqual([
      "notes.pdf",
      "notes.zip",
    ]);
    expect(form.status("pdf")).toBe("uploaded");
    expect(form.status("zip")).toBe("uploaded");
    expect(form.createCalls).toBe(0);
  });

  it("does not create when a gitlab file upload fails", async () => {
    const form = formWith(async () => {
      throw new Error("upload failed");
    });
    await form.setCreateSource("remote", "gitlab");
    await form.selectFile(file("pdf", "notes.pdf"));
    await form.submit("Notes");
    expect(form.createCalls).toBe(0);
    expect(form.status("pdf")).toBe("failed");
  });
});

describe("host attachment copy", () => {
  it("has uploading, failed, and rejected copy in zh and en", () => {
    const keys = [
      "hostAttachmentUploading",
      "hostAttachmentUploadFailed",
      "hostAttachmentRejected",
    ] as const;
    for (const key of keys) {
      expect(zh.issues[key]?.length).toBeGreaterThan(0);
      expect(en.issues[key]).not.toMatch(/\p{Script=Han}/u);
    }
    for (const key of [
      "hostAttachmentUnauthenticated",
      "hostAttachmentForbidden",
      "hostAttachmentOffline",
      "hostAttachmentCliMissing",
      "hostAttachmentUploadFailed",
      "hostAttachmentNotRemote",
      "hostAttachmentUnavailable",
      "hostAttachmentTooLarge",
      "hostAttachmentUploadRequired",
      "hostAttachmentRejected",
    ] as const) {
      expect(zh.errors.FORGE_UNAVAILABLE[key]?.length).toBeGreaterThan(0);
      expect(en.errors.FORGE_UNAVAILABLE[key]).not.toMatch(/\p{Script=Han}/u);
    }
  });
});
