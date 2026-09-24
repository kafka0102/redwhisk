import { describe, expect, it, vi } from "vitest";

import {
  createInFlightRequests,
  refreshAfterIdle,
  workspaceRequestKey,
} from "./in-flight-requests";

describe("createInFlightRequests", () => {
  it("rejects a second begin for the same key", () => {
    const inFlight = createInFlightRequests();

    expect(inFlight.tryBegin("changes:1:/tmp/repo")).toBe(true);
    expect(inFlight.tryBegin("changes:1:/tmp/repo")).toBe(false);
    expect(inFlight.isInFlight("changes:1:/tmp/repo")).toBe(true);
  });

  it("allows the same key to begin again after it is settled", () => {
    const inFlight = createInFlightRequests();

    inFlight.tryBegin("changes:1:/tmp/repo");
    inFlight.settle("changes:1:/tmp/repo");

    expect(inFlight.isInFlight("changes:1:/tmp/repo")).toBe(false);
    expect(inFlight.tryBegin("changes:1:/tmp/repo")).toBe(true);
  });

  it("keeps different keys independent", () => {
    const inFlight = createInFlightRequests();

    inFlight.tryBegin("changes:1:/tmp/repo");

    expect(inFlight.tryBegin("changes:1:/tmp/other")).toBe(true);
    expect(inFlight.tryBegin("commit-history:1:/tmp/repo")).toBe(true);
    expect(inFlight.isInFlight("changes:1:/tmp/repo")).toBe(true);
  });

  it("treats settling an unknown key as a no-op", () => {
    const inFlight = createInFlightRequests();
    inFlight.tryBegin("changes:1:/tmp/repo");

    expect(() => inFlight.settle("never-begun")).not.toThrow();

    expect(inFlight.isInFlight("never-begun")).toBe(false);
    expect(inFlight.isInFlight("changes:1:/tmp/repo")).toBe(true);
  });
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createInFlightRequests waitForIdle", () => {
  it("resolves immediately when the key has no in-flight request", async () => {
    const inFlight = createInFlightRequests();
    let isIdle = false;

    void inFlight.waitForIdle("changes:1:/tmp/repo").then(() => {
      isIdle = true;
    });
    await flushMicrotasks();

    expect(isIdle).toBe(true);
  });

  it("resolves only after the in-flight request is settled", async () => {
    const inFlight = createInFlightRequests();
    inFlight.tryBegin("changes:1:/tmp/repo");
    let isIdle = false;

    void inFlight.waitForIdle("changes:1:/tmp/repo").then(() => {
      isIdle = true;
    });
    await flushMicrotasks();
    expect(isIdle).toBe(false);

    inFlight.settle("changes:1:/tmp/repo");
    await flushMicrotasks();
    expect(isIdle).toBe(true);
  });

  it("wakes every waiter registered for the same key and none for other keys", async () => {
    const inFlight = createInFlightRequests();
    inFlight.tryBegin("changes:1:/tmp/repo");
    inFlight.tryBegin("changes:1:/tmp/other");
    const idledKeys: string[] = [];

    void inFlight.waitForIdle("changes:1:/tmp/repo").then(() => {
      idledKeys.push("repo-1");
    });
    void inFlight.waitForIdle("changes:1:/tmp/repo").then(() => {
      idledKeys.push("repo-2");
    });
    void inFlight.waitForIdle("changes:1:/tmp/other").then(() => {
      idledKeys.push("other");
    });

    inFlight.settle("changes:1:/tmp/repo");
    await flushMicrotasks();

    expect(idledKeys).toEqual(["repo-1", "repo-2"]);
  });

  it("does not hold back a new request begun while waiters are parked", async () => {
    const inFlight = createInFlightRequests();
    inFlight.tryBegin("changes:1:/tmp/repo");
    void inFlight.waitForIdle("changes:1:/tmp/repo");

    inFlight.settle("changes:1:/tmp/repo");

    // 等待者尚未被唤醒（微任务未跑）时，新请求已能登记；waitForIdle 只等结算，
    // 不占用「在途登记」本身。
    expect(inFlight.tryBegin("changes:1:/tmp/repo")).toBe(true);
  });
});

describe("refreshAfterIdle", () => {
  it("refreshes immediately when the key has no in-flight request", async () => {
    const inFlight = createInFlightRequests();
    const refresh = vi.fn();

    refreshAfterIdle("changes:1:/tmp/repo", inFlight, refresh, () => true);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("defers the refresh until the in-flight request settles", async () => {
    const inFlight = createInFlightRequests();
    inFlight.tryBegin("changes:1:/tmp/repo");
    const refresh = vi.fn();

    refreshAfterIdle("changes:1:/tmp/repo", inFlight, refresh, () => true);
    await flushMicrotasks();
    expect(refresh).not.toHaveBeenCalled();

    inFlight.settle("changes:1:/tmp/repo");
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("drops the deferred refresh when the caller is no longer interested", async () => {
    const inFlight = createInFlightRequests();
    inFlight.tryBegin("changes:1:/tmp/repo");
    const refresh = vi.fn();
    let isStillWanted = true;

    refreshAfterIdle(
      "changes:1:/tmp/repo",
      inFlight,
      refresh,
      () => isStillWanted,
    );
    // 续延期间门控收紧 / 切了工作区根：这次失效不再发起请求。
    isStillWanted = false;
    inFlight.settle("changes:1:/tmp/repo");
    await flushMicrotasks();

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("workspaceRequestKey", () => {
  it("scopes the key by resource, project and workspace root", () => {
    const key = workspaceRequestKey("commit-history", 1, "/tmp/repo");

    expect(key).toBe("commit-history:1:/tmp/repo");
    expect(workspaceRequestKey("commit-history", 2, "/tmp/repo")).not.toBe(key);
    expect(workspaceRequestKey("commit-history", 1, "/tmp/other")).not.toBe(
      key,
    );
    expect(workspaceRequestKey("changes", 1, "/tmp/repo")).not.toBe(key);
  });
});
