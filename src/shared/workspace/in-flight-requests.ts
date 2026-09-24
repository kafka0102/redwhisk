/**
 * 在途请求登记簿：同一资源同一时刻至多一个在途请求。
 *
 * 变更 / 提交历史 / 会话列表这类数据被 4s、5s、8s 多档轮询与手动刷新、事件刷新
 * 同时驱动。旧实现允许「新请求一发起就作废旧请求」，慢机器 / 大仓库下单次往返
 * 超过轮询间隔后，每个响应都在落地前被下一个 tick 作废，面板永久停在加载态。
 *
 * 本模块只做纯簿记（登记 / 结算 / 查询），不含 React 与请求逻辑：调用方先
 * `tryBegin(key)`，登记失败即跳过本次（不作废在途请求），请求结算（成功 / 失败 /
 * 过期）时 `settle(key)`。与既有 `file-tree-directory-retry` 同层，供多个 hook 复用。
 */
export interface InFlightRequests {
  /** 登记一次在途请求；同一 key 已有在途请求时返回 false，调用方应跳过本次。 */
  tryBegin(key: string): boolean;
  /** 结算一次在途请求（含失败 / 作废）；未知 key 为空操作。 */
  settle(key: string): void;
  /** 该 key 当前是否有在途请求。 */
  isInFlight(key: string): boolean;
  /**
   * 等该 key 当前在途请求结算；无在途请求时立即 resolve。
   *
   * 供「失效事件」路径实现「在途不叠加请求、结算后补一次刷新」：失效到达时若已有
   * 请求在飞，直接跳过会把这轮失效吞掉（数量要等下一个定时 tick 才收敛），因此在
   * 结算后再发起本次刷新。续延是微任务，故补刷新总是先于下一个定时 tick 抢到登记。
   *
   * 只观察在途状态，不占用登记本身：等待期间其他调用方仍可 `tryBegin` 同一个 key。
   */
  waitForIdle(key: string): Promise<void>;
}

export function createInFlightRequests(): InFlightRequests {
  const keys = new Set<string>();
  const waitersByKey = new Map<string, Array<() => void>>();

  return {
    tryBegin(key) {
      if (keys.has(key)) {
        return false;
      }
      keys.add(key);
      return true;
    },
    settle(key) {
      if (!keys.delete(key)) {
        return;
      }
      const waiters = waitersByKey.get(key);
      if (!waiters) {
        return;
      }
      waitersByKey.delete(key);
      waiters.forEach((resolve) => resolve());
    },
    isInFlight(key) {
      return keys.has(key);
    },
    waitForIdle(key) {
      if (!keys.has(key)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const waiters = waitersByKey.get(key);
        if (waiters) {
          waiters.push(resolve);
          return;
        }
        waitersByKey.set(key, [resolve]);
      });
    },
  };
}

/**
 * 资源 key：`<资源名>:<projectId>:<工作区根>`。
 *
 * key 必须带工作区根：切换根时新根不能被旧根的在途请求挡住（旧根的迟到响应由
 * 调用方的请求序号丢弃）。
 */
export function workspaceRequestKey(
  resource: string,
  projectId: number,
  workspacePath: string,
): string {
  return `${resource}:${projectId}:${workspacePath}`;
}

/**
 * 发起一次「失效刷新」：该资源无在途请求时立即刷新；已有在途请求时等它结算后再刷新
 * （既不叠加请求，也不把这次失效丢给下一个定时 tick）。
 *
 * 事件（如「回合结束、Agent 可能刚提交」）到达时，正在飞的请求可能是在提交前发起的、
 * 数据已经过期：直接跳过会让界面等下一个 tick 才收敛，而叠加第二个请求又违反「同一
 * 资源单一在途请求」。等结算再补一次同时满足两者，且续延是微任务，补刷新先于下一个 tick。
 *
 * `isStillWanted` 在补刷新真正发起前求值：续延可能跨过门控收紧（失焦 / 面板关闭）或
 * 作用域切换（切工作区根 / 切会话），此时这次失效已无意义——新作用域有自己的首拉，
 * 后台窗口不该发请求。返回 false 即放弃这次补刷新。调用方没有门控概念时传 `() => true`。
 */
export function refreshAfterIdle(
  requestKey: string,
  inFlightRequests: InFlightRequests,
  refresh: () => void,
  isStillWanted: () => boolean,
): void {
  void inFlightRequests.waitForIdle(requestKey).then(() => {
    if (!isStillWanted()) {
      return;
    }
    refresh();
  });
}
