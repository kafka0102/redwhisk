import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdateStatus } from "./use-update-status";
import type { UpdateStatus } from "../../shared/commands/app-update-commands";

const getUpdateStatusMock = vi.fn();
const dismissUpdatePromptMock = vi.fn();
const listenMock = vi.fn();

vi.mock("../../shared/commands/app-update-commands", async () => {
  const actual = await vi.importActual<
    typeof import("../../shared/commands/app-update-commands")
  >("../../shared/commands/app-update-commands");
  return {
    ...actual,
    getUpdateStatus: (...args: unknown[]) => getUpdateStatusMock(...args),
    dismissUpdatePrompt: (...args: unknown[]) =>
      dismissUpdatePromptMock(...args),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function buildStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    shouldShowPrompt: true,
    currentVersion: "0.0.3",
    hasUpdate: true,
    latestVersion: "0.1.0",
    releaseUrl: "https://example.com/r",
    ignoredVersion: null,
    snoozeUntil: null,
    checkedAt: "2026-07-14T12:00:00.000Z",
    errorCode: null,
    ...overrides,
  };
}

describe("useUpdateStatus", () => {
  beforeEach(() => {
    getUpdateStatusMock.mockReset();
    dismissUpdatePromptMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
    getUpdateStatusMock.mockResolvedValue(buildStatus());
  });

  it("loads status on mount quietly", async () => {
    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(result.current.status?.latestVersion).toBe("0.1.0");
    });
    expect(getUpdateStatusMock).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it("swallows startup failures", async () => {
    getUpdateStatusMock.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(getUpdateStatusMock).toHaveBeenCalled();
    });
    expect(result.current.status).toBeNull();
  });

  it("applies event payload from other windows", async () => {
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(
      async (
        _event: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
        eventHandler = handler;
        return vi.fn();
      },
    );

    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });

    act(() => {
      eventHandler?.({
        payload: buildStatus({
          shouldShowPrompt: false,
          latestVersion: "0.2.0",
        }),
      });
    });

    expect(result.current.status?.latestVersion).toBe("0.2.0");
    expect(result.current.status?.shouldShowPrompt).toBe(false);
  });

  it("dismiss updates local status", async () => {
    dismissUpdatePromptMock.mockResolvedValue(
      buildStatus({ shouldShowPrompt: false }),
    );
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => {
      expect(result.current.status?.shouldShowPrompt).toBe(true);
    });

    await act(async () => {
      await result.current.dismiss("snooze7Days");
    });

    expect(dismissUpdatePromptMock).toHaveBeenCalledWith({
      action: "snooze7Days",
    });
    expect(result.current.status?.shouldShowPrompt).toBe(false);
  });

  it("checkForUpdates force-refreshes and exposes isChecking", async () => {
    let resolveCheck: ((value: UpdateStatus) => void) | undefined;
    getUpdateStatusMock.mockImplementation(
      (input?: { forceRefresh?: boolean }) => {
        if (input?.forceRefresh) {
          return new Promise<UpdateStatus>((resolve) => {
            resolveCheck = resolve;
          });
        }
        return Promise.resolve(buildStatus());
      },
    );

    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });
    expect(result.current.isChecking).toBe(false);

    let checkPromise: Promise<void>;
    act(() => {
      checkPromise = result.current.checkForUpdates();
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(true);
    });

    await act(async () => {
      resolveCheck?.(
        buildStatus({
          shouldShowPrompt: true,
          latestVersion: "0.2.0",
          hasUpdate: true,
        }),
      );
      await checkPromise;
    });

    expect(getUpdateStatusMock).toHaveBeenCalledWith({ forceRefresh: true });
    expect(result.current.isChecking).toBe(false);
    expect(result.current.status?.latestVersion).toBe("0.2.0");
  });

  it("checkForUpdates surfaces command failures via checkError", async () => {
    getUpdateStatusMock
      .mockResolvedValueOnce(buildStatus())
      .mockRejectedValueOnce({
        code: "APP_UPDATE_PERSISTENCE_FAILED",
        message: "boom",
      });

    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.checkError).toBe("boom");
    expect(result.current.isChecking).toBe(false);
  });

  it("ignores incomplete event payloads and refreshes quietly", async () => {
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(
      async (
        _event: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
        eventHandler = handler;
        return vi.fn();
      },
    );

    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => {
      expect(result.current.status?.latestVersion).toBe("0.1.0");
    });

    getUpdateStatusMock.mockClear();
    getUpdateStatusMock.mockResolvedValue(
      buildStatus({ latestVersion: "0.3.0" }),
    );

    act(() => {
      eventHandler?.({
        payload: {
          shouldShowPrompt: true,
          currentVersion: "0.0.3",
          hasUpdate: true,
          // 故意缺少其余字段 → 不作为完整 UpdateStatus 应用
        },
      });
    });

    await waitFor(() => {
      expect(getUpdateStatusMock).toHaveBeenCalledWith({ forceRefresh: false });
    });
    await waitFor(() => {
      expect(result.current.status?.latestVersion).toBe("0.3.0");
    });
  });
});
