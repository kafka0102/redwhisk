import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Quill from "quill";
import { useState, type SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emptySelection: string[] = [];

import { I18nProvider } from "../../../shared/i18n/i18n";
import type { CommandError } from "../../../shared/commands/command-error";
import {
  saveIssueAttachmentDraft,
  type SaveIssueAttachmentDraftResult,
} from "../issue-commands";
import { EMPTY_FORM, type IssueFormState } from "../issue-activity-types";
import type { IssueAttachmentDraft } from "./issue-description-editor";
import { IssueEditablePage } from "../issue-detail/issue-editable-page";
import { useIssueAttachments } from "../use-issue-attachments";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("../issue-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../issue-commands")>();
  return {
    ...actual,
    saveIssueAttachmentDraft: vi.fn(),
  };
});

vi.mock("../../settings/issue-source-commands", () => ({
  getProjectIssueSourceSettings: vi.fn(async () => ({
    projectId: 1,
    issueSourceMode: "local",
    issueSyncScope: "all_open",
    issueSyncLabel: null,
    issueSyncEnabled: false,
    issueSyncIntervalSeconds: 90,
    issueWritebackCloseOnComplete: false,
    issueWritebackCloseOnPrMerge: false,
    issueWritebackComment: false,
    issueCreateSource: "local",
    localIssueCount: 0,
    remoteIssueCount: 0,
    connection: {
      provider: null,
      hostUrl: null,
      repoPath: null,
      login: null,
      cliInstalled: false,
      cliAuthenticated: false,
      authStatus: "unknown",
      checkedAt: 1,
    },
  })),
  updateProjectIssueSourceSettings: vi.fn(),
}));

const openDialogMock = vi.mocked(open);
const saveIssueAttachmentDraftMock = vi.mocked(saveIssueAttachmentDraft);
const convertFileSrcMock = vi.mocked(convertFileSrc);

const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

describe("Issue image multi-select", () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    saveIssueAttachmentDraftMock.mockReset();
    convertFileSrcMock.mockReset();
    convertFileSrcMock.mockImplementation((path) => `asset://${path}`);
    Range.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
        toJSON() {
          return {};
        },
      }) as DOMRect;
  });

  it("opens the image dialog for multiple images and keeps the current extensions", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue(null);
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    expect(openDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: false,
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: imageExtensions,
          },
        ],
      }),
    );
    expect(saveIssueAttachmentDraftMock).not.toHaveBeenCalled();
  });

  it("keeps add attachment as a single unfiltered file dialog", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue(null);
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Attach file" }),
    );

    expect(openDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: false,
        multiple: false,
        filters: undefined,
      }),
    );
  });

  it.each([
    ["null", null],
    ["[]", emptySelection],
  ] as const)(
    "leaves the description and attachments unchanged when the image dialog returns %s",
    async (_label, selected) => {
      const user = userEvent.setup();
      openDialogMock.mockResolvedValue(selected);
      renderIssueImageForm({
        description: "Already",
        attachments: [savedAttachment()],
      });

      await user.click(
        await screen.findByRole("button", { name: "Insert image" }),
      );

      await waitFor(() => {
        expect(openDialogMock).toHaveBeenCalled();
      });
      expect(saveIssueAttachmentDraftMock).not.toHaveBeenCalled();
      expect(descriptionText()).toContain("Already");
      expect(descriptionText()).not.toContain("![");
      expect(screen.getByText("kept.md")).toBeInTheDocument();
      expect(formError()).toBe("");
    },
  );

  it.each(["/desk/one.png", ["/desk/one.png"]])(
    "inserts exactly one image when the dialog returns %j",
    async (selected) => {
      const user = userEvent.setup();
      openDialogMock.mockResolvedValue(selected);
      saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
        draftResult(input.sourcePath, "image"),
      );
      renderIssueImageForm();

      await user.click(
        await screen.findByRole("button", { name: "Insert image" }),
      );

      await waitFor(() => {
        expect(imageLines()).toHaveLength(1);
      });
      expect(
        imageLines()[0].startsWith("![one.png]({{issue-attachment-temp:draft-"),
      ).toBe(true);
      expect(imageLines()[0].endsWith("}})")).toBe(true);
      const token = imageToken(imageLines()[0]);
      expect(attachmentNames()).toEqual(["one.png"]);
      expect(descriptionText()).toContain(`{{issue-attachment-temp:${token}}}`);
      expect(formError()).toBe("");
    },
  );

  it("inserts multiple images in the order the file dialog returns", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue(["/desk/one.png", "/desk/two.jpg"]);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
      draftResult(input.sourcePath, "image"),
    );
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(imageLines().map(imageAlt)).toEqual(["one.png", "two.jpg"]);
    });
    expect(
      imageLines().every((line) =>
        line.includes("{{issue-attachment-temp:draft-"),
      ),
    ).toBe(true);
    const [firstToken, secondToken] = imageLines().map(imageToken);
    expect(firstToken).not.toBe(secondToken);
    expect(attachmentNames()).toEqual(["one.png", "two.jpg"]);
    expect(
      saveIssueAttachmentDraftMock.mock.calls.map((call) => call[0]),
    ).toEqual([
      { sourcePath: "/desk/one.png", displayName: "one.png" },
      { sourcePath: "/desk/two.jpg", displayName: "two.jpg" },
    ]);
  });

  it("keeps the first copy of a repeated path and continues with later paths", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue([
      "/desk/one.png",
      "/desk/one.png",
      "/desk/two.jpg",
    ]);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
      draftResult(input.sourcePath, "image"),
    );
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(saveIssueAttachmentDraftMock).toHaveBeenCalledTimes(2);
    });
    expect(
      saveIssueAttachmentDraftMock.mock.calls.map((call) => call[0].sourcePath),
    ).toEqual(["/desk/one.png", "/desk/two.jpg"]);
    expect(imageLines().map(imageAlt)).toEqual(["one.png", "two.jpg"]);
  });

  it("keeps two different files that share a display name on different draft paths", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue([
      "/a/screenshot.png",
      "/b/screenshot.png",
    ]);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) => ({
      path: `/drafts/${input.sourcePath === "/a/screenshot.png" ? "a" : "b"}-screenshot.png`,
      displayName: "screenshot.png",
      kind: "image",
      isPreviewable: true,
    }));
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(imageLines()).toHaveLength(2);
    });
    expect(imageLines().map(imageAlt)).toEqual([
      "screenshot.png",
      "screenshot.png",
    ]);
    const tokens = imageLines().map(imageToken);
    expect(new Set(tokens).size).toBe(2);
    expect(saveIssueAttachmentDraftMock).toHaveBeenCalledTimes(2);
    const paths = saveIssueAttachmentDraftMock.mock.results.map((result) =>
      (result.value as Promise<SaveIssueAttachmentDraftResult>).then(
        (draft) => draft.path,
      ),
    );
    await expect(Promise.all(paths)).resolves.toEqual([
      "/drafts/a-screenshot.png",
      "/drafts/b-screenshot.png",
    ]);
  });

  it("keeps images saved before a copy failure and stops the rest", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue([
      "/desk/ok.png",
      "/desk/missing.png",
      "/desk/later.png",
    ]);
    const copyError: CommandError = {
      code: "ISSUE_VALIDATION_FAILED",
      message: "附件源文件不存在。",
      reason: "attachmentSourceNotFound",
    };
    saveIssueAttachmentDraftMock.mockImplementation(async (input) => {
      if (input.sourcePath === "/desk/missing.png") {
        throw copyError;
      }
      return draftResult(input.sourcePath, "image");
    });
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(formError()).toContain("附件源文件不存在。");
    });
    expect(
      saveIssueAttachmentDraftMock.mock.calls.map((call) => call[0].sourcePath),
    ).toEqual(["/desk/ok.png", "/desk/missing.png"]);
    expect(imageLines().map(imageAlt)).toEqual(["ok.png"]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("inserts three images without a new count limit", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue([
      "/desk/one.png",
      "/desk/two.jpg",
      "/desk/three.gif",
    ]);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
      draftResult(input.sourcePath, "image"),
    );
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(imageLines().map(imageAlt)).toEqual([
        "one.png",
        "two.jpg",
        "three.gif",
      ]);
    });
    expect(attachmentNames()).toEqual(["one.png", "two.jpg", "three.gif"]);
    expect(formError()).toBe("");
  });

  it("saves and inserts the third image when draft saves resolve on a macrotask", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue([
      "/desk/one.png",
      "/desk/two.jpg",
      "/desk/three.gif",
    ]);
    saveIssueAttachmentDraftMock.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(draftResult(input.sourcePath, "image"));
          }, 0);
        }),
    );
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(imageLines().map(imageAlt)).toEqual([
        "one.png",
        "two.jpg",
        "three.gif",
      ]);
    });
    expect(saveIssueAttachmentDraftMock).toHaveBeenCalledTimes(3);
    expect(attachmentNames()).toEqual(["one.png", "two.jpg", "three.gif"]);
  });

  it("inserts an image before existing text when the cursor is at the start", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/desk/one.png");
    saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
      draftResult(input.sourcePath, "image"),
    );
    renderIssueImageForm({
      description: "Already",
    });

    await screen.findByRole("button", { name: "Insert image" });
    placeCursorAtStart();

    await user.click(screen.getByRole("button", { name: "Insert image" }));

    await waitFor(() => {
      expect(descriptionText()).toContain("![one.png]");
    });
    expect(descriptionText()).toContain("Already");
    expect(descriptionText().indexOf("![one.png]")).toBeLessThan(
      descriptionText().indexOf("Already"),
    );
  });

  it("keeps existing description text and attachments when more images are inserted", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue(["/desk/one.png", "/desk/two.jpg"]);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
      draftResult(input.sourcePath, "image"),
    );
    renderIssueImageForm({
      description: "Already",
      attachments: [savedAttachment()],
    });

    await screen.findByRole("button", { name: "Insert image" });
    placeCursorAtEnd();
    await user.click(screen.getByRole("button", { name: "Insert image" }));

    await waitFor(() => {
      expect(imageLines().map(imageAlt)).toEqual(["one.png", "two.jpg"]);
    });
    expect(descriptionText()).toContain("Already");
    expect(descriptionText().indexOf("Already")).toBeLessThan(
      descriptionText().indexOf("![one.png]"),
    );
    expect(descriptionText().indexOf("![one.png]")).toBeLessThan(
      descriptionText().indexOf("![two.jpg]"),
    );
    expect(attachmentNames()).toEqual(["kept.md", "one.png", "two.jpg"]);
  });

  it("keeps a non-image file as an attachment without interrupting surrounding images", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue([
      "/desk/one.png",
      "/desk/notes.txt",
      "/desk/two.jpg",
    ]);
    saveIssueAttachmentDraftMock.mockImplementation(async (input) =>
      draftResult(
        input.sourcePath,
        input.sourcePath.endsWith(".txt") ? "text" : "image",
      ),
    );
    renderIssueImageForm();

    await user.click(
      await screen.findByRole("button", { name: "Insert image" }),
    );

    await waitFor(() => {
      expect(attachmentNames()).toEqual(["one.png", "notes.txt", "two.jpg"]);
    });
    expect(imageLines().map(imageAlt)).toEqual(["one.png", "two.jpg"]);
    expect(descriptionText()).not.toContain("![notes.txt]");
    expect(descriptionText()).toContain("{{issue-attachment-temp:");
  });

  it("does not add files when the attachment dialog returns an array", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue(["/desk/a.md", "/desk/b.md"]);
    renderIssueImageForm({
      description: "Already",
      attachments: [savedAttachment()],
    });

    await user.click(
      await screen.findByRole("button", { name: "Attach file" }),
    );

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalled();
    });
    expect(saveIssueAttachmentDraftMock).not.toHaveBeenCalled();
    expect(descriptionText()).toContain("Already");
    expect(imageLines()).toEqual([]);
    expect(attachmentNames()).toEqual(["kept.md"]);
    expect(formError()).toBe("");
  });
});

function renderIssueImageForm(initial: Partial<IssueFormState> = {}) {
  return render(
    <I18nProvider>
      <IssueImageForm initial={initial} />
    </I18nProvider>,
  );
}

function IssueImageForm({ initial }: { initial: Partial<IssueFormState> }) {
  const [form, setForm] = useState<IssueFormState>({
    ...EMPTY_FORM,
    ...initial,
  });
  const [description, setDescription] = useState(form.description);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const attachments = useIssueAttachments({
    projectId: 1,
    setForm,
    setAttachmentPreview: () => undefined,
    setDialogErrorMessage: setErrorMessage,
    t: ((key: string) => key) as never,
    messages: {
      richText: { image: "Insert image" },
      issues: {
        addAttachment: "Add attachment",
        imageFilterName: "Images",
      },
    } as never,
  });

  return (
    <>
      <div data-description-markdown={description} hidden />
      <IssueEditablePage
        availableLabels={[]}
        errorMessage={errorMessage}
        form={form}
        isLoadingLabels={false}
        isSaving={false}
        labelsErrorMessage={null}
        mode="create"
        projectId={1}
        selectedIssue={null}
        titleError={null}
        titleInputRef={{ current: null }}
        onCancel={() => undefined}
        onDeleteIssue={() => undefined}
        onDownloadAttachment={() => undefined}
        onFormChange={(next: SetStateAction<IssueFormState>) => {
          setForm((current) => {
            const resolved = typeof next === "function" ? next(current) : next;
            setDescription(resolved.description);
            return resolved;
          });
        }}
        onOpenProjectLabelsSettings={() => undefined}
        onOpenProjectSettings={() => undefined}
        onPreviewAttachment={() => undefined}
        onRemoveAttachment={attachments.removeAttachment}
        onSelectAttachment={attachments.selectAttachment}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      />
    </>
  );
}

function savedAttachment(): IssueAttachmentDraft {
  return {
    token: "saved-kept",
    displayName: "kept.md",
    sourcePath: "/tmp/kept.md",
    absolutePath: "/tmp/kept.md",
    kind: "text",
    isPreviewable: true,
  };
}

function draftResult(
  sourcePath: string,
  kind: SaveIssueAttachmentDraftResult["kind"],
): SaveIssueAttachmentDraftResult {
  const displayName = sourcePath.split("/").pop() ?? sourcePath;
  return {
    path: `/drafts/${displayName}`,
    displayName,
    kind,
    isPreviewable: kind === "image" || kind === "text",
  };
}

function descriptionText(): string {
  const editor = document.querySelector(".ql-editor");
  if (!editor) {
    throw new Error("missing description editor");
  }
  const markdown = (
    document.querySelector("[data-description-markdown]") as HTMLElement | null
  )?.dataset.descriptionMarkdown;
  return markdown ?? editor.textContent ?? "";
}

function placeCursorAtStart(): void {
  findQuill().setSelection(0, 0, "user");
}

function placeCursorAtEnd(): void {
  const quill = findQuill();
  quill.setSelection(Math.max(quill.getLength() - 1, 0), 0, "user");
}

function findQuill(): Quill {
  const surface = document.querySelector(".rich-text-editor__surface");
  if (!(surface instanceof HTMLElement)) {
    throw new Error("missing description editor");
  }
  const quill = Quill.find(surface);
  if (!(quill instanceof Quill)) {
    throw new Error("missing quill");
  }
  return quill;
}

function imageLines(): string[] {
  return descriptionText()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("!["));
}

function imageAlt(line: string): string {
  return /^!\[([^\]]*)\]/.exec(line)?.[1] ?? "";
}

function imageToken(line: string): string {
  return /\{\{issue-attachment-temp:([^}]+)\}\}/.exec(line)?.[1] ?? "";
}

function attachmentNames(): string[] {
  return within(document.body)
    .getAllByText(
      /^(kept\.md|one\.png|two\.jpg|three\.gif|ok\.png|screenshot\.png|notes\.txt)$/,
    )
    .map((node) => node.textContent ?? "");
}

function formError(): string {
  return (
    screen.queryByRole("status", { name: "Dialog status" })?.textContent ?? ""
  );
}
