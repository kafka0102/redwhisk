// 用户 Home 目录解析（用于把 `~/...` 收成工作区相对路径）。
//
// `homeDir()` 每次调用都走一次 Tauri IPC，而 Home 在进程生命周期内不变：模块级缓存
// 只解析一次，并复用同一份在途请求，避免消息流里多处 `~` 路径触发并发探测。

import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";

/** `undefined` 表示尚未解析；`null` 表示解析失败（无法展开 `~`）。 */
let resolvedHomePath: string | null | undefined;
let homePathRequest: Promise<string | null> | null = null;

function requestHomePath(): Promise<string | null> {
  if (resolvedHomePath !== undefined) {
    return Promise.resolve(resolvedHomePath);
  }
  if (homePathRequest === null) {
    homePathRequest = homeDir()
      .then((path) => {
        resolvedHomePath = path;
        return path;
      })
      .catch(() => {
        resolvedHomePath = null;
        return null;
      });
  }
  return homePathRequest;
}

/**
 * 解析用户 Home 绝对路径；解析失败（含非 Tauri 环境）返回 `null`。
 *
 * `null` 的语义是「`~/` 解析不了」：调用方按不可点处理，不猜测路径。
 */
export function useHomePath(): string | null {
  const [homePath, setHomePath] = useState<string | null>(
    () => resolvedHomePath ?? null,
  );

  useEffect(() => {
    if (resolvedHomePath !== undefined) {
      return;
    }
    let isCancelled = false;
    void requestHomePath().then((path) => {
      if (!isCancelled) {
        setHomePath(path);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  return homePath;
}
