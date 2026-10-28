import type { ProjectTerminalShortcutCommandRecord } from "./project-terminal-commands";

/**
 * 同一项目的多个终端共用这份常用命令快照。
 * generation 只在保存或删除成功后前进；较慢的旧请求不能覆盖新快照。
 * 没前进时，打开菜单直接用快照，不再请求后端。
 */
interface ShortcutCommandSnapshot {
  generation: number;
  commands: ProjectTerminalShortcutCommandRecord[];
}

const EMPTY_SHORTCUT_COMMANDS: ProjectTerminalShortcutCommandRecord[] = [];

const snapshots = new Map<number, ShortcutCommandSnapshot>();
const generations = new Map<number, number>();
const listeners = new Map<number, Set<() => void>>();

export function readProjectTerminalShortcutCommands(
  projectId: number,
): ProjectTerminalShortcutCommandRecord[] {
  return snapshots.get(projectId)?.commands ?? EMPTY_SHORTCUT_COMMANDS;
}

export function currentProjectTerminalShortcutCommandGeneration(
  projectId: number,
): number {
  return generations.get(projectId) ?? 0;
}

export function isProjectTerminalShortcutCommandCacheStale(
  projectId: number,
): boolean {
  const snapshot = snapshots.get(projectId);
  if (!snapshot) {
    return false;
  }
  return (
    snapshot.generation !==
    currentProjectTerminalShortcutCommandGeneration(projectId)
  );
}

export function subscribeProjectTerminalShortcutCommands(
  projectId: number,
  listener: () => void,
): () => void {
  const projectListeners = listeners.get(projectId) ?? new Set<() => void>();
  projectListeners.add(listener);
  listeners.set(projectId, projectListeners);
  return () => {
    const currentListeners = listeners.get(projectId);
    if (!currentListeners) {
      return;
    }
    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      listeners.delete(projectId);
    }
  };
}

/** 保存或删除已经落库后调用，让仍在飞的旧列表请求作废。 */
export function invalidateProjectTerminalShortcutCommands(
  projectId: number,
): number {
  const generation =
    currentProjectTerminalShortcutCommandGeneration(projectId) + 1;
  generations.set(projectId, generation);
  return generation;
}

/** 只接受当前 generation 的结果。返回 false 表示这是过期响应。 */
export function publishProjectTerminalShortcutCommands(
  projectId: number,
  generation: number,
  commands: readonly ProjectTerminalShortcutCommandRecord[],
): boolean {
  if (
    generation !== currentProjectTerminalShortcutCommandGeneration(projectId)
  ) {
    return false;
  }

  snapshots.set(projectId, {
    generation,
    commands: commands.map((command) => ({ ...command })),
  });
  const projectListeners = listeners.get(projectId);
  if (projectListeners) {
    for (const listener of projectListeners) {
      listener();
    }
  }
  return true;
}

export function clearProjectTerminalShortcutCommandCacheForTests(): void {
  snapshots.clear();
  generations.clear();
  listeners.clear();
}
