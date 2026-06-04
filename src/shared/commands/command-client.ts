import { invoke } from "@tauri-apps/api/core";

import { toCommandError } from "./command-error";

export async function invokeCommand<TResponse>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResponse> {
  try {
    return await invoke<TResponse>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}
