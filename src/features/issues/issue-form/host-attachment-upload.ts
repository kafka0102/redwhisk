export const GITHUB_IMAGE_LIMIT = 10_485_760;

export type HostProvider = "github" | "gitlab" | null;
export type HostSource = "local" | "remote";
export type HostMode = "create" | "edit";
export type HostStatus = "uploading" | "uploaded" | "failed" | "rejected";

export interface HostFile {
  token: string;
  displayName: string;
  sourcePath: string;
  byteLength?: number;
}

export interface HostUploadCall {
  sourcePath: string;
  displayName: string;
  tempToken: string;
}

export interface HostAttachmentPorts {
  upload: (input: HostUploadCall) => Promise<string>;
  createIssue: (description: string) => Promise<void>;
  updateIssue: () => Promise<void>;
  deleteHost: () => Promise<void>;
}

export interface HostAttachmentController {
  selectFile: (file: HostFile) => Promise<void>;
  setCreateSource: (
    source: HostSource,
    provider: HostProvider,
  ) => Promise<void>;
  setMode: (mode: HostMode) => void;
  removeFile: (token: string) => void;
  cancel: () => void;
  prepareSubmit: () => Promise<boolean>;
  submit: (description: string) => Promise<void>;
  saveEdit: () => Promise<void>;
  submittedDescription: (description: string) => string;
  status: (token: string) => HostStatus | undefined;
  uploadCalls: HostUploadCall[];
  createCalls: number;
  updateCalls: number;
  deleteCalls: number;
  createDescriptions: string[];
}

const GITHUB_IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export function isGithubImage(displayName: string): boolean {
  const extension = displayName.split(".").pop()?.toLowerCase() ?? "";
  return GITHUB_IMAGES.has(extension);
}

export function descriptionWithoutToken(
  description: string,
  token: string,
): string {
  const marker = `{{issue-attachment-temp:${token}}}`;
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return description
    .replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, "g"), "")
    .split("\n")
    .filter((line) => line.trim() !== marker)
    .join("\n")
    .split(marker)
    .join("");
}

export function hostAttachmentStatusKey(
  status: Exclude<HostStatus, "uploaded">,
):
  | "issues.hostAttachmentUploading"
  | "issues.hostAttachmentUploadFailed"
  | "issues.hostAttachmentRejected" {
  if (status === "uploading") {
    return "issues.hostAttachmentUploading";
  }
  if (status === "failed") {
    return "issues.hostAttachmentUploadFailed";
  }
  return "issues.hostAttachmentRejected";
}

export function createHostAttachmentController(
  ports: HostAttachmentPorts,
): HostAttachmentController {
  const files = new Map<string, HostFile>();
  const statuses = new Map<string, HostStatus>();
  const inflight = new Map<string, Promise<void>>();
  const oversized = new Set<string>();
  const uploadCalls: HostUploadCall[] = [];
  const createDescriptions: string[] = [];
  let source: HostSource = "local";
  let provider: HostProvider = null;
  let mode: HostMode = "create";
  let createCalls = 0;
  let updateCalls = 0;
  const deleteCalls = 0;

  function shouldUpload(): boolean {
    return mode === "create" && source === "remote" && provider === "github";
  }

  async function waitInflight(): Promise<void> {
    await Promise.all([...inflight.values()]);
  }

  async function uploadOne(file: HostFile): Promise<void> {
    const call = {
      sourcePath: file.sourcePath,
      displayName: file.displayName,
      tempToken: file.token,
    };
    uploadCalls.push(call);
    statuses.set(file.token, "uploading");
    const pending = ports
      .upload(call)
      .then(() => {
        statuses.set(file.token, "uploaded");
      })
      .catch(() => {
        statuses.set(file.token, "failed");
      })
      .finally(() => {
        inflight.delete(file.token);
      });
    inflight.set(file.token, pending);
    await pending;
  }

  function githubFiles(): HostFile[] {
    return [...files.values()].filter((file) =>
      isGithubImage(file.displayName),
    );
  }

  async function uploadPending(): Promise<void> {
    if (!shouldUpload()) {
      return;
    }
    for (const file of githubFiles()) {
      if (
        oversized.has(file.token) ||
        statuses.get(file.token) === "uploaded"
      ) {
        continue;
      }
      if (statuses.get(file.token) === "uploading") {
        continue;
      }
      if (
        file.byteLength !== undefined &&
        file.byteLength > GITHUB_IMAGE_LIMIT
      ) {
        statuses.set(file.token, "failed");
        oversized.add(file.token);
        continue;
      }
      await uploadOne(file);
    }
  }

  return {
    uploadCalls,
    createDescriptions,
    get createCalls() {
      return createCalls;
    },
    get updateCalls() {
      return updateCalls;
    },
    get deleteCalls() {
      return deleteCalls;
    },
    status(token) {
      return statuses.get(token);
    },
    submittedDescription(description) {
      return description;
    },
    setMode(next) {
      mode = next;
    },
    async setCreateSource(nextSource, nextProvider) {
      source = nextSource;
      provider = nextProvider;
      await uploadPending();
    },
    async selectFile(file) {
      if (mode !== "create") {
        return;
      }
      files.set(file.token, file);
      if (!shouldUpload()) {
        return;
      }
      if (!isGithubImage(file.displayName)) {
        statuses.set(file.token, "rejected");
        return;
      }
      if (
        file.byteLength !== undefined &&
        file.byteLength > GITHUB_IMAGE_LIMIT
      ) {
        statuses.set(file.token, "failed");
        oversized.add(file.token);
        return;
      }
      await uploadOne(file);
    },
    removeFile(token) {
      files.delete(token);
      statuses.delete(token);
      oversized.delete(token);
      inflight.delete(token);
    },
    cancel() {
      files.clear();
      statuses.clear();
      oversized.clear();
      inflight.clear();
    },
    async prepareSubmit() {
      if (!shouldUpload()) {
        return true;
      }
      await waitInflight();
      if ([...oversized].some((token) => files.has(token))) {
        return false;
      }
      const pending = githubFiles().filter(
        (file) => statuses.get(file.token) !== "uploaded",
      );
      for (const file of pending) {
        if (oversized.has(file.token)) {
          return false;
        }
        await uploadOne(file);
      }
      await waitInflight();
      return githubFiles().every(
        (file) => statuses.get(file.token) === "uploaded",
      );
    },
    async submit(description) {
      const ready = await this.prepareSubmit();
      if (!ready) {
        return;
      }
      createCalls += 1;
      createDescriptions.push(description);
      await ports.createIssue(description);
    },
    async saveEdit() {
      updateCalls += 1;
      await ports.updateIssue();
    },
  };
}
