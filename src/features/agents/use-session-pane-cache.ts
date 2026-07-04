// Agent session pane 的 LRU 实例池 hook。
//
// 配合 `agents-session-pane.tsx` 中「按 sessionId 缓存 AgentSessionView 实例」
// 的渲染策略使用：已访问过的 session 切回时复用已挂载实例，避免重挂载导致消息流
// DOM 重建（这是切 session / 切 tab 主线程卡顿的根因）。超出上限时淘汰最久未访问
// 的实例，控制常驻内存。
//
// 上限与 `use-agent-message-stream.ts` 的 `MAX_CACHED_SESSIONS` 对齐，保证实例池
// 与消息流 state 缓存的淘汰粒度一致。
//
// 淘汰策略关键约束：处于 open（运行中）状态的 session 不可被淘汰。原因——
// 一旦 open session 的 AgentSessionView 实例被卸载，其底层 handle 会被 drop，
// 对于 claude code 等单轮进程模型的 agent 会触发 transport.shutdown() 杀掉进程，
// 导致正在执行的 turn 报「claude 进程退出：客户端主动关闭」。因此 LRU 淘汰时
// 只回收 closed 的 session，open session 即使最久未访问也保留在缓存中。
//
// 实现说明：当前选中 session 变化时，在 render 阶段同步把它加入缓存（React 支持
// 在 render 中调用同组件 setState 触发立即重渲染，等价于 getDerivedStateFromProps）。
// 不能用 useEffect 延迟 touch——那会让首次渲染时实例池为空，导致依赖同步渲染的
// 断言（getByLabelText）以及首帧可见性出现问题。用 useState 而非 useRef 记录上次
// touch 值，避免在 render 中访问 ref（react-hooks/refs 规则）。

import { useCallback, useState } from "react";

interface UseSessionPaneCacheArgs {
  // 当前选中的 session id；为 null 表示无选中 session。
  currentSessionId: number | null;
  // 最大缓存的 session 实例数量。
  maxCached: number;
  // 判断某个 session 是否处于 open（运行中）状态。
  // open session 即使最久未访问也不会被淘汰，以避免其 handle 被 drop 导致
  // agent 进程被 kill。返回 true 表示该 session 当前不可淘汰。
  isOpenSession: (sessionId: number) => boolean;
}

interface SessionPaneCache {
  // 按 LRU 顺序排列的 session id 数组，末尾为最近访问。
  cachedSessionIds: number[];
  // 从缓存中移除某个 session id（删除 session 时调用）。
  remove: (sessionId: number) => void;
}

export function useSessionPaneCache({
  currentSessionId,
  maxCached,
  isOpenSession,
}: UseSessionPaneCacheArgs): SessionPaneCache {
  const [cachedSessionIds, setCachedSessionIds] = useState<number[]>([]);
  // 记录上次 touch 过的 sessionId，用于在 render 阶段判断是否需要更新。
  // 用 useState 而非 useRef，因为在 render 中读取/更新 state 是安全的。
  const [lastTouched, setLastTouched] = useState<number | null>(null);

  // render 阶段同步处理 currentSessionId 变化：保证当前选中 session 在本次渲染
  // 结束前就已进入缓存，实例池能立即渲染对应的 AgentSessionView。
  if (currentSessionId !== null && lastTouched !== currentSessionId) {
    setLastTouched(currentSessionId);
    setCachedSessionIds((current) => {
      // 先移除已存在的同一 sessionId（避免重复），再追加到末尾。
      const filtered = current.filter((id) => id !== currentSessionId);
      const next = [...filtered, currentSessionId];

      // 超上限时淘汰头部最久未访问的 closed session；
      // open session 即使在最头部也跳过，保证其 handle 不被 drop。
      // 若全部为 open（运行中 session 数超过上限），不做强制淘汰——open
      // session 的常驻优先级高于内存上限控制。
      while (next.length > maxCached) {
        const evictIndex = next.findIndex((id) => !isOpenSession(id));
        if (evictIndex === -1) {
          break;
        }
        next.splice(evictIndex, 1);
      }
      return next;
    });
  }

  // currentSessionId 变为 null（无选中 session）时重置 lastTouched，
  // 使下次选中新 session 时能重新触发 touch。
  if (currentSessionId === null && lastTouched !== null) {
    setLastTouched(null);
  }

  const remove = useCallback((sessionId: number) => {
    setCachedSessionIds((current) => current.filter((id) => id !== sessionId));
  }, []);

  return { cachedSessionIds, remove };
}
