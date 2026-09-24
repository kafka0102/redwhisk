import { describe, expect, it } from "vitest";

import {
  createInFlightRequests,
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
