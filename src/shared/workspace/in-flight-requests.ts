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
}

export function createInFlightRequests(): InFlightRequests {
  const keys = new Set<string>();

  return {
    tryBegin(key) {
      if (keys.has(key)) {
        return false;
      }
      keys.add(key);
      return true;
    },
    settle(key) {
      keys.delete(key);
    },
    isInFlight(key) {
      return keys.has(key);
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
