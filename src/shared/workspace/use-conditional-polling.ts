import { useEffect } from "react";

export interface UseConditionalPollingOptions {
  /** 每次 tick 调用的刷新函数。可为 async（返回值被忽略，调用方自行处理竞态）。 */
  refresh: () => void;
  /** 轮询间隔（毫秒）。 */
  intervalMs: number;
  /**
   * 门控：false 时不起定时器、不补拉。调用方把「可见性 / tab / 不可恢复错误」
   * 等条件 fold 成一个布尔传入，本 hook 不解释其含义。
   */
  isActive: boolean;
  /**
   * 变为 active（含首次激活）时是否立即补拉一次。默认 true，对齐 agents 侧
   * 「进入即拉」语义；已有外层首拉的调用方（如 changes 视图）传 false。
   */
  refreshOnActivate?: boolean;
}

/**
 * 条件轮询深 module：一个 setInterval 生命周期契约喂多个 feature。
 *
 * - isActive=false：不起定时器、不补拉；
 * - isActive=true：按 intervalMs 起 setInterval；refreshOnActivate 为 true 时
 *   先补拉一次，随后按间隔 tick；
 * - isActive / intervalMs / refresh 变化：清理旧定时器、按新值重启（refreshOnActivate
 *   为 true 时重启也会补拉一次，与既有 useEffect 语义一致）；
 * - 卸载或失活：清理定时器。
 *
 * 不持有数据、不做请求竞态保护——调用方的 refresh 自行处理（如 agents 侧的
 * requestSequence）。本 hook 只收口「定时器生命周期 + 门控 + 补拉」这一层，
 * 让分散在两处 polling 的 cleanup 契约集中一处可测。参见 ADR-0005 / ADR-0008。
 */
export function useConditionalPolling({
  refresh,
  intervalMs,
  isActive,
  refreshOnActivate = true,
}: UseConditionalPollingOptions): void {
  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (refreshOnActivate) {
      refresh();
    }
    const timerId = window.setInterval(refresh, intervalMs);
    return () => {
      window.clearInterval(timerId);
    };
  }, [isActive, intervalMs, refresh, refreshOnActivate]);
}
