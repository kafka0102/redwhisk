import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// 非 Tauri 环境默认 stub listen，避免 I18nProvider 等全局订阅在 jsdom 中产生
// unhandled rejection；需要断言订阅行为的用例可在文件内覆盖 mock。
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// jsdom 不实现 requestIdleCallback / cancelIdleCallback。源码（如
// agents-activity.tsx 的 loadSessions）在 session 列表加载后用它延迟加载非关键
// 内容，测试环境下缺失会抛 "window.requestIdleCallback is not a function" 并
// 污染后续测试。这里提供一个同步执行的 polyfill，使回调立即触发。
if (typeof window.requestIdleCallback !== "function") {
  window.requestIdleCallback = (callback: IdleRequestCallback) => {
    const handle = window.setTimeout(() => callback({} as IdleDeadline), 0);
    return handle as unknown as number;
  };
}

if (typeof window.cancelIdleCallback !== "function") {
  window.cancelIdleCallback = (handle: number) => {
    window.clearTimeout(handle);
  };
}

afterEach(() => {
  cleanup();
});
