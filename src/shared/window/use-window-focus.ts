import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * 当前窗口是否获得焦点（OS 级窗口焦点），用于停掉后台窗口的轮询。
 *
 * 多个项目窗口会同时挂载同一批轮询，而 `document.visibilityState` 对未最小化的
 * 后台窗口仍是 `visible`：只看可见性无法区分「用户正在看的窗口」与「被切到后面的
 * 窗口」，git 子进程与 IPC 会按窗口数线性叠加。这里取 Tauri 窗口焦点（与
 * `agentSessionNotificationTransport.isWindowFocused` 同源）。
 *
 * 不用 `document.hasFocus()`：它反映的是 webview 内容是否持有 DOM 焦点，用户点窗口
 * 标题栏 / 原生菜单时会变 false，导致「正在看的窗口」被误判为后台而停掉轮询。
 *
 * 无法判定时（非 Tauri 环境、API 不可用）保持 `true`，即维持既有轮询行为。
 */
export function useWindowFocus(): boolean {
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | undefined;

    const sync = (next: boolean) => {
      if (isDisposed) {
        return;
      }
      setIsFocused(next);
    };

    try {
      const currentWindow = getCurrentWindow();

      void currentWindow
        .isFocused()
        .then(sync)
        .catch(() => {});
      void currentWindow
        .onFocusChanged((event) => sync(Boolean(event.payload)))
        .then((nextUnlisten) => {
          if (isDisposed) {
            nextUnlisten();
            return;
          }
          unlisten = nextUnlisten;
        })
        .catch(() => {});
    } catch {
      // 非窗口环境（测试 / 浏览器预览）：保持「始终聚焦」。
    }

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  return isFocused;
}
