/**
 * 有界并发地依次消费 `items`：同一时刻最多 `concurrency` 个 worker 在跑。
 * worker 按完成再取下一项；用于提交多文件 diff 的有界 IPC 拉取。
 */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  };

  const runnerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: runnerCount }, () => run()));
}
