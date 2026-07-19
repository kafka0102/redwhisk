import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeTauriEvent, useTauriEvent } from "./use-tauri-event";

interface ListenCapture<T> {
  name: string;
  callback: (event: { payload: T }) => void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const listenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function captureListener<T>(): {
  capture: ListenCapture<T>;
  unlisten: ReturnType<typeof vi.fn>;
} {
  const unlisten = vi.fn();
  const capture = {
    name: "",
    callback: vi.fn(),
  } as unknown as ListenCapture<T>;
  listenMock.mockImplementationOnce(
    (name: string, callback: (event: { payload: T }) => void) => {
      capture.name = name;
      capture.callback = callback;
      return Promise.resolve(unlisten);
    },
  );
  return { capture, unlisten };
}

describe("subscribeTauriEvent", () => {
  beforeEach(() => {
    listenMock.mockReset();
  });

  it("订阅指定事件名，并在收到事件时把解包后的 payload 交给 handler", async () => {
    const { capture, unlisten } = captureListener<string>();
    const handler = vi.fn();

    const teardown = subscribeTauriEvent<string>("event-a", handler);
    await Promise.resolve();

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(capture.name).toBe("event-a");

    capture.callback({ payload: "hello" });
    expect(handler).toHaveBeenCalledWith("hello");

    teardown();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("teardown 早于 listen resolve 时，仍在新 unlisten 到手后立即释放（不泄漏）", async () => {
    const deferred = createDeferred<ReturnType<typeof vi.fn>>();
    listenMock.mockImplementationOnce(() => deferred.promise);
    const handler = vi.fn();

    const teardown = subscribeTauriEvent<string>("event-b", handler);
    teardown();

    const lateUnlisten = vi.fn();
    deferred.resolve(lateUnlisten);
    await Promise.resolve();

    expect(lateUnlisten).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("useTauriEvent", () => {
  let capturedCallback: ((event: { payload: string }) => void) | null;
  let capturedUnlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listenMock.mockReset();
    capturedCallback = null;
    capturedUnlisten = vi.fn();
    listenMock.mockImplementation(
      (_name: unknown, callback: (event: { payload: string }) => void) => {
        capturedCallback = callback;
        return Promise.resolve(capturedUnlisten);
      },
    );
  });

  it("挂载即订阅，卸载即释放，且重渲染只更新 handler 不重订阅", async () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ handler }) => useTauriEvent<string>("event-c", handler),
      { initialProps: { handler: firstHandler } },
    );
    await Promise.resolve();

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(capturedUnlisten).not.toHaveBeenCalled();

    // 重渲染只更新 handlerRef，不重新订阅。
    rerender({ handler: secondHandler });
    expect(listenMock).toHaveBeenCalledTimes(1);

    capturedCallback?.({ payload: "ping" });
    expect(secondHandler).toHaveBeenCalledWith("ping");
    expect(firstHandler).not.toHaveBeenCalled();

    // 卸载调用 unlisten，释放监听。
    unmount();
    expect(capturedUnlisten).toHaveBeenCalledTimes(1);
  });
});
