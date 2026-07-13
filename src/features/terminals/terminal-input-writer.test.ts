import { describe, expect, it, vi } from "vitest";

import { createTerminalInputWriter } from "./terminal-input-writer";

describe("createTerminalInputWriter", () => {
  it("writes the first chunk immediately", async () => {
    const write = vi.fn(async () => undefined);
    const onError = vi.fn();
    const writer = createTerminalInputWriter(write, onError);

    writer.push("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("a");
    expect(onError).not.toHaveBeenCalled();
  });

  it("serializes writes and merges keys that arrive while in-flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (write.mock.calls.length === 1) {
            resolveFirst = resolve;
            return;
          }
          resolve();
        }),
    );
    const onError = vi.fn();
    const writer = createTerminalInputWriter(write, onError);

    writer.push("a");
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith("a");

    writer.push("b");
    writer.push("c");
    expect(write).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("bc");
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops accepting input after dispose", async () => {
    const write = vi.fn(async () => undefined);
    const writer = createTerminalInputWriter(write, vi.fn());

    writer.dispose();
    writer.push("x");
    await Promise.resolve();

    expect(write).not.toHaveBeenCalled();
  });
});
