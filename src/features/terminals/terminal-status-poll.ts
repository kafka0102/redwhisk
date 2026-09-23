/**
 * 终端快照轮询的开关控制器。
 *
 * 终端在「终端」Activity 里常驻挂载（用 hidden 切换显隐），隐藏实例若继续按 2s 轮询
 * 快照，负载会按终端数线性叠加。可见性变化时调用 `sync`：隐藏即停表，重新可见即重启。
 */
export interface TerminalStatusPoll {
  dispose: () => void;
  sync: (shouldPoll: boolean) => void;
}

export function createTerminalStatusPoll(
  intervalMs: number,
  poll: () => void,
): TerminalStatusPoll {
  let timerId: number | null = null;

  const stop = () => {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };

  return {
    dispose: stop,
    sync(shouldPoll) {
      if (!shouldPoll) {
        stop();
        return;
      }
      if (timerId !== null) {
        return;
      }
      timerId = window.setInterval(poll, intervalMs);
    },
  };
}
