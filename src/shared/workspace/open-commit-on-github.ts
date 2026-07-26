import { openUrl } from "@tauri-apps/plugin-opener";

import { buildGithubCommitUrl } from "./github-commit-url";
import {
  probeGithubCommit,
  type ProbeGithubCommitResponse,
} from "./workspace-commands";

export type OpenCommitOnGithubOutcome =
  | "opened"
  | "not_found"
  | "network_error"
  | "open_failed";

export interface OpenCommitOnGithubDeps {
  probe: (input: {
    owner: string;
    repo: string;
    commitHash: string;
  }) => Promise<ProbeGithubCommitResponse>;
  openUrl: (url: string) => Promise<void>;
}

const defaultDeps: OpenCommitOnGithubDeps = {
  probe: probeGithubCommit,
  openUrl: async (url: string) => {
    await openUrl(url);
  },
};

/**
 * 探测 GitHub 上是否存在该提交；存在则外开浏览器，否则返回可映射 toast 的结果。
 * 不负责「是否显示菜单」——调用方已确认 remote 为 github.com。
 */
export async function openCommitOnGithub(
  input: { owner: string; repo: string; commitHash: string },
  deps: OpenCommitOnGithubDeps = defaultDeps,
): Promise<OpenCommitOnGithubOutcome> {
  const commitUrl = buildGithubCommitUrl(
    input.owner,
    input.repo,
    input.commitHash,
  );
  let probeResult: ProbeGithubCommitResponse;
  try {
    probeResult = await deps.probe({
      owner: input.owner,
      repo: input.repo,
      commitHash: input.commitHash,
    });
  } catch {
    return "network_error";
  }

  if (probeResult.status === "not_found") {
    return "not_found";
  }
  if (probeResult.status === "network_error") {
    return "network_error";
  }

  const url = probeResult.commitUrl?.trim() || commitUrl;
  try {
    await deps.openUrl(url);
    return "opened";
  } catch {
    return "open_failed";
  }
}
