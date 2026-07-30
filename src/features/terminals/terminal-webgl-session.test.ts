import { afterEach, describe, expect, it, vi } from "vitest";

const webglAddonInstances: Array<{
  dispose: ReturnType<typeof vi.fn>;
  onContextLoss: ReturnType<typeof vi.fn>;
  triggerLoss: () => void;
}> = [];

vi.mock("@xterm/addon-webgl", () => {
  class WebglAddon {
    dispose = vi.fn();
    onContextLoss = vi.fn((handler: () => void) => {
      this.triggerLoss = handler;
    });
    triggerLoss: () => void = () => undefined;
    constructor() {
      webglAddonInstances.push(this);
    }
  }
  return { WebglAddon };
});

vi.mock("./terminal-surface-live-handlers", () => ({
  healTerminalViewport: vi.fn(),
}));

import { healTerminalViewport } from "./terminal-surface-live-handlers";
import { createTerminalWebglSession } from "./terminal-webgl-session";

describe("createTerminalWebglSession", () => {
  afterEach(() => {
    webglAddonInstances.length = 0;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("loads webgl addon into the terminal", () => {
    const terminal = { loadAddon: vi.fn() };
    const session = createTerminalWebglSession(terminal as never, {
      isCurrent: () => true,
    });

    expect(terminal.loadAddon).toHaveBeenCalledTimes(1);
    expect(session.getAddon()).not.toBeNull();
    session.dispose();
  });

  it("recreates webgl addon after context loss", () => {
    vi.useFakeTimers();
    const terminal = { loadAddon: vi.fn() };
    const session = createTerminalWebglSession(terminal as never, {
      isCurrent: () => true,
    });
    const first = webglAddonInstances[0];
    expect(first).toBeDefined();

    first.triggerLoss();
    expect(first.dispose).toHaveBeenCalled();
    expect(session.getAddon()).toBeNull();

    vi.advanceTimersByTime(250);
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2);
    expect(session.getAddon()).not.toBeNull();
    expect(healTerminalViewport).toHaveBeenCalledWith(terminal);
    session.dispose();
  });

  it("stops recovering after dispose", () => {
    vi.useFakeTimers();
    const terminal = { loadAddon: vi.fn() };
    const session = createTerminalWebglSession(terminal as never, {
      isCurrent: () => true,
    });
    const first = webglAddonInstances[0];
    session.dispose();
    first.triggerLoss();
    vi.advanceTimersByTime(250);
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1);
  });
});
