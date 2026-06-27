import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPermissionGranted,
  removeActive,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { agentSessionNotificationTransport } from "./agent-session-notification-transport";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  removeActive: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: vi.fn().mockResolvedValue(false),
    requestUserAttention: vi.fn().mockResolvedValue(undefined),
  }),
  UserAttentionType: {
    Critical: "critical",
    Informational: "informational",
  },
}));

const isPermissionGrantedMock = vi.mocked(isPermissionGranted);
const removeActiveMock = vi.mocked(removeActive);
const requestPermissionMock = vi.mocked(requestPermission);
const sendNotificationMock = vi.mocked(sendNotification);

describe("agentSessionNotificationTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isPermissionGrantedMock.mockReset();
    removeActiveMock.mockReset();
    requestPermissionMock.mockReset();
    sendNotificationMock.mockReset();
    isPermissionGrantedMock.mockResolvedValue(true);
    removeActiveMock.mockResolvedValue(undefined);
  });

  it("sends large notification content and removes it after the configured duration", async () => {
    await agentSessionNotificationTransport.sendSystemNotification({
      body: "Session finished.\n\nSummary\nImplemented monitor.\n\nRecent messages\nAgent: Done.",
      durationMs: 300_000,
      key: "agent-session-status:8:closed",
      level: "normal",
      title: "RedWhisk session completed",
    });

    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Session finished.",
        id: expect.any(Number),
        largeBody: expect.stringContaining("Recent messages"),
        title: "RedWhisk session completed",
      }),
    );

    const notificationOptions = sendNotificationMock.mock.calls[0][0];
    if (typeof notificationOptions === "string") {
      throw new Error("Expected object notification options.");
    }
    const notificationId = notificationOptions.id;

    await vi.advanceTimersByTimeAsync(300_000);

    expect(removeActiveMock).toHaveBeenCalledWith([{ id: notificationId }]);
  });

  it("requests permission before sending a system notification", async () => {
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("granted");

    await agentSessionNotificationTransport.sendSystemNotification({
      body: "Needs approval",
      key: "agent-session:1:epoch:1",
      level: "urgent",
      title: "RedWhisk needs your input",
    });

    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalled();
  });
});
