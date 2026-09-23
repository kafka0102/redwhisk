/**
 * 文件树目录 listing 的失败重试簿记。
 *
 * 5s 轮询只重拉 `listings` 里已成功的目录；目录拉取失败（并发争抢导致的
 * SQLITE_BUSY / 超时）若不单独留重试，展开状态会停在「箭头已向下但子节点永远
 * 为空」，直到用户折叠再展开或切换 root。本模块只做纯簿记（失败记录 / 退避时间 /
 * 到期查询），不含 React 与请求逻辑。
 */

/** 目录 listing 失败后的首次重试延迟；每次失败翻倍，封顶 30s。 */
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;

interface FileTreeDirectoryRetryEntry {
  attempts: number;
  nextAttemptAt: number;
  pathKey: string;
}

/** 以 `<projectId>::<workspacePath>::<directoryPath>` 为键的重试表。 */
export type FileTreeDirectoryRetryQueue = Map<
  string,
  FileTreeDirectoryRetryEntry
>;

/** 记录一次目录 listing 失败，并按失败次数指数退避下一次重试时间。 */
export function markFileTreeDirectoryLoadFailed(
  queue: FileTreeDirectoryRetryQueue,
  key: string,
  pathKey: string,
  now: number,
): void {
  const attempts = (queue.get(key)?.attempts ?? 0) + 1;

  queue.set(key, {
    attempts,
    nextAttemptAt:
      now +
      Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempts - 1), RETRY_MAX_DELAY_MS),
    pathKey,
  });
}

/** 目录 listing 成功后清掉该目录的重试记录。 */
export function clearFileTreeDirectoryLoadFailure(
  queue: FileTreeDirectoryRetryQueue,
  key: string,
): void {
  queue.delete(key);
}

/** 返回该工作区下已到重试时间的目录路径（同一目录最多一条）。 */
export function dueFileTreeDirectoryRetryPaths(
  queue: FileTreeDirectoryRetryQueue,
  requestKey: string,
  now: number,
): string[] {
  const prefix = `${requestKey}::`;
  const duePaths: string[] = [];

  for (const [key, entry] of queue) {
    if (!key.startsWith(prefix) || entry.nextAttemptAt > now) {
      continue;
    }
    duePaths.push(entry.pathKey);
  }

  return duePaths;
}
