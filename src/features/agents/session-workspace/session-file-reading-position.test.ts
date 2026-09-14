import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  readEditorReadingPosition,
  resetEditorReadingPositionsForTests,
  writeEditorReadingPosition,
  type EditorReadingPosition,
} from "../../../shared/workspace/editor-reading-position";
import {
  clearSessionFileReadingPosition,
  clearSessionFileReadingPositions,
  sessionFileReadingPositionKey,
} from "./session-file-reading-position";
import { useSessionFileReadingPositionCleanup } from "./use-session-file-reading-position-cleanup";

function buildPosition(scrollTop: number): EditorReadingPosition {
  return { scrollTop } as unknown as EditorReadingPosition;
}

function seed(
  projectId: number,
  sessionId: number,
  filePath: string,
  scrollTop: number,
): string {
  const key = sessionFileReadingPositionKey(projectId, sessionId, filePath);
  writeEditorReadingPosition(key, buildPosition(scrollTop));
  return key;
}

describe("session-file-reading-position", () => {
  beforeEach(() => {
    resetEditorReadingPositionsForTests();
  });

  it("keeps the same file isolated per session and per project", () => {
    const sessionA = sessionFileReadingPositionKey(1, 7, "src/a.ts");
    const sessionB = sessionFileReadingPositionKey(1, 8, "src/a.ts");
    const otherProject = sessionFileReadingPositionKey(2, 7, "src/a.ts");
    const otherFile = sessionFileReadingPositionKey(1, 7, "src/b.ts");

    expect(new Set([sessionA, sessionB, otherProject, otherFile]).size).toBe(4);
  });

  it("clears a single file without touching the session's other files", () => {
    const fileA = seed(1, 7, "src/a.ts", 100);
    const fileB = seed(1, 7, "src/b.ts", 200);

    clearSessionFileReadingPosition(1, 7, "src/a.ts");

    expect(readEditorReadingPosition(fileA)).toBeNull();
    expect(readEditorReadingPosition(fileB)).toEqual(buildPosition(200));
  });

  it("clears every file of one session without touching other sessions", () => {
    const sessionA = seed(1, 7, "src/a.ts", 100);
    const sessionAOtherFile = seed(1, 7, "src/b.ts", 200);
    const sessionB = seed(1, 8, "src/a.ts", 300);

    clearSessionFileReadingPositions(7);

    expect(readEditorReadingPosition(sessionA)).toBeNull();
    expect(readEditorReadingPosition(sessionAOtherFile)).toBeNull();
    expect(readEditorReadingPosition(sessionB)).toEqual(buildPosition(300));
  });
});

describe("useSessionFileReadingPositionCleanup", () => {
  beforeEach(() => {
    resetEditorReadingPositionsForTests();
  });

  it("clears the previous file when its tab is closed or replaced", () => {
    const fileA = seed(1, 7, "src/a.ts", 100);
    const fileB = seed(1, 7, "src/b.ts", 200);

    const { rerender } = renderHook(
      ({ filePath }: { filePath: string | null }) =>
        useSessionFileReadingPositionCleanup(1, 7, filePath),
      { initialProps: { filePath: "src/a.ts" as string | null } },
    );
    expect(readEditorReadingPosition(fileA)).toEqual(buildPosition(100));

    rerender({ filePath: null });
    expect(readEditorReadingPosition(fileA)).toBeNull();
    expect(readEditorReadingPosition(fileB)).toEqual(buildPosition(200));

    // 再次渲染同一路径不得清理新文件的位置。
    rerender({ filePath: "src/b.ts" });
    expect(readEditorReadingPosition(fileB)).toEqual(buildPosition(200));
  });

  it("does not clear anything when the same file stays open", () => {
    const fileA = seed(1, 7, "src/a.ts", 100);

    const { rerender } = renderHook(
      ({ filePath }: { filePath: string | null }) =>
        useSessionFileReadingPositionCleanup(1, 7, filePath),
      { initialProps: { filePath: "src/a.ts" as string | null } },
    );
    rerender({ filePath: "src/a.ts" });

    expect(readEditorReadingPosition(fileA)).toEqual(buildPosition(100));
  });
});
