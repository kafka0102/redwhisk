import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

/**
 * Tauri event 订阅原语：把 `listen` + 竞态安全的 `unlisten` 契约收口到此一处。
 *
 * `listen()` 返回 `Promise<UnlistenFn>`；若调用方在 resolve 前卸载（快速切页 / 测试
 * 卸载），未持有 unlisten 会泄漏监听，并使被取消的 then 产生 unhandled rejection。
 * 本原语用 `disposed` flag 兜底——卸载早于 resolve 时，在 then 回调里立即调用刚拿到
 * 的 unlisten。返回同步 teardown，供调用方在 `useEffect` cleanup 中直接 `return`。
 *
 * handler 收到的是已解包的 `event.payload`，与 agents feature 的 `subscribe*()` 形状一致。
 */
export function subscribeTauriEvent<T>(
  name: string,
  handler: (payload: T) => void,
): () => void {
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  void listen<T>(name, (event) => {
    handler(event.payload);
  }).then((nextUnlisten) => {
    if (disposed) {
      nextUnlisten();
      return;
    }
    unlisten = nextUnlisten;
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * 统一的 Tauri event 订阅 hook：替代各 callsite 手抄的三种 cleanup 范式
 * （isDisposed flag / 无 guard 泄漏 / subscribe helper 消费侧 isMounted 仪式）。
 *
 * handler 经 ref 始终持有最新闭包——重渲染时只更新 ref，不重订阅，故 handler 闭包
 * 内的变量（projectId、issueId、translate 等）无需进依赖、也无需触发 teardown/重连。
 * 仅当 `name` 变化时重新订阅。需要按 `enabled` 等条件门控订阅生命周期的组合 effect，
 * 直接用 {@link subscribeTauriEvent} 原语在自己的 effect 中管理。
 */
export function useTauriEvent<T>(
  name: string,
  handler: (payload: T) => void,
): void {
  // 经 effect 同步最新 handler（不在 render 期写 ref），事件到达时 handlerRef
  // 始终是最近一次提交的闭包；订阅本身只在 name 变化时重连。
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(
    () =>
      subscribeTauriEvent<T>(name, (payload) => {
        handlerRef.current(payload);
      }),
    [name],
  );
}
