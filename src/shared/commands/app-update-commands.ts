import { invokeCommand } from "./command-client";

export const UPDATE_PROMPT_CHANGED_EVENT = "update-prompt-changed";

export type DismissUpdatePromptAction = "snooze7Days" | "ignoreVersion";

export interface UpdateStatus {
  shouldShowPrompt: boolean;
  currentVersion: string;
  hasUpdate: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
  ignoredVersion: string | null;
  snoozeUntil: string | null;
  checkedAt: string | null;
  error: string | null;
}

export interface GetUpdateStatusInput {
  forceRefresh?: boolean;
}

export interface DismissUpdatePromptInput {
  action: DismissUpdatePromptAction;
}

export async function getUpdateStatus(
  input: GetUpdateStatusInput = {},
): Promise<UpdateStatus> {
  return invokeCommand<UpdateStatus>("get_update_status", {
    input: {
      forceRefresh: input.forceRefresh ?? false,
    },
  });
}

export async function dismissUpdatePrompt(
  input: DismissUpdatePromptInput,
): Promise<UpdateStatus> {
  return invokeCommand<UpdateStatus>("dismiss_update_prompt", { input });
}
