import { beforeEach, describe, expect, it } from "vitest";

import {
  clearEditorReadingPosition,
  clearEditorReadingPositionsByProject,
  clearEditorReadingPositionsBySession,
  createEditorReadingLoadKey,
  createEditorReadingPositionKey,
  decideEditorReadingPositionRestore,
  isEditorLayoutReady,
  readEditorReadingPosition,
  resetEditorReadingPositionsForTests,
  shouldPersistEditorReadingPosition,
  writeEditorReadingPosition,
  type EditorReadingPosition,
} from "./editor-reading-position";

function buildPosition(scrollTop: number): EditorReadingPosition {
  return { scrollTop } as unknown as EditorReadingPosition;
}

describe("editor-reading-position", () => {
  beforeEach(() => {
    resetEditorReadingPositionsForTests();
  });

  it("isolates the code page and each session by identity", () => {
    expect(
      createEditorReadingPositionKey({ projectId: 1, filePath: "a.ts" }),
    ).not.toEqual(
      createEditorReadingPositionKey({
        projectId: 1,
        sessionId: "s1",
        filePath: "a.ts",
      }),
    );
    expect(
      createEditorReadingPositionKey({
        projectId: 1,
        sessionId: "s1",
        filePath: "a.ts",
      }),
    ).not.toEqual(
      createEditorReadingPositionKey({
        projectId: 1,
        sessionId: "s2",
        filePath: "a.ts",
      }),
    );
    expect(
      createEditorReadingPositionKey({
        projectId: 1,
        sessionId: "s1",
        filePath: "a.ts",
      }),
    ).not.toEqual(
      createEditorReadingPositionKey({
        projectId: 2,
        sessionId: "s1",
        filePath: "a.ts",
      }),
    );
  });

  it("reads back the last written position and clears single keys", () => {
    const key = createEditorReadingPositionKey({
      projectId: 1,
      filePath: "a.ts",
    });
    writeEditorReadingPosition(key, buildPosition(320));

    expect(readEditorReadingPosition(key)).toEqual(buildPosition(320));
    expect(readEditorReadingPosition("project:1\u0000file:missing.ts")).toBe(
      null,
    );

    clearEditorReadingPosition(key);
    expect(readEditorReadingPosition(key)).toBeNull();
  });

  it("clears only the given project scope", () => {
    const projectOne = createEditorReadingPositionKey({
      projectId: 1,
      filePath: "a.ts",
    });
    const projectOneSession = createEditorReadingPositionKey({
      projectId: 1,
      sessionId: "s1",
      filePath: "a.ts",
    });
    const projectEleven = createEditorReadingPositionKey({
      projectId: 11,
      filePath: "a.ts",
    });
    writeEditorReadingPosition(projectOne, buildPosition(1));
    writeEditorReadingPosition(projectOneSession, buildPosition(2));
    writeEditorReadingPosition(projectEleven, buildPosition(3));

    clearEditorReadingPositionsByProject(1);

    expect(readEditorReadingPosition(projectOne)).toBeNull();
    expect(readEditorReadingPosition(projectOneSession)).toBeNull();
    expect(readEditorReadingPosition(projectEleven)).toEqual(buildPosition(3));
  });

  it("clears every file of one session without touching other scopes", () => {
    const sessionA = createEditorReadingPositionKey({
      projectId: 1,
      sessionId: "s1",
      filePath: "src/a.ts",
    });
    const sessionASecondFile = createEditorReadingPositionKey({
      projectId: 1,
      sessionId: "s1",
      filePath: "src/b.ts",
    });
    const sessionB = createEditorReadingPositionKey({
      projectId: 1,
      sessionId: "s2",
      filePath: "src/a.ts",
    });
    const codePageSameFile = createEditorReadingPositionKey({
      projectId: 1,
      filePath: "src/a.ts",
    });
    writeEditorReadingPosition(sessionA, buildPosition(1));
    writeEditorReadingPosition(sessionASecondFile, buildPosition(2));
    writeEditorReadingPosition(sessionB, buildPosition(3));
    writeEditorReadingPosition(codePageSameFile, buildPosition(4));

    clearEditorReadingPositionsBySession("s1");

    expect(readEditorReadingPosition(sessionA)).toBeNull();
    expect(readEditorReadingPosition(sessionASecondFile)).toBeNull();
    expect(readEditorReadingPosition(sessionB)).toEqual(buildPosition(3));
    expect(readEditorReadingPosition(codePageSameFile)).toEqual(
      buildPosition(4),
    );
  });

  it("treats only a positive layout height as ready", () => {
    expect(isEditorLayoutReady(0)).toBe(false);
    expect(isEditorLayoutReady(-1)).toBe(false);
    expect(isEditorLayoutReady(1)).toBe(true);
    expect(shouldPersistEditorReadingPosition(0)).toBe(false);
    expect(shouldPersistEditorReadingPosition(600)).toBe(true);
  });

  it("waits for layout when the editor is created with zero height", () => {
    expect(
      decideEditorReadingPositionRestore({
        pending: true,
        layoutHeight: 0,
        savedPosition: buildPosition(320),
      }),
    ).toBe("wait");
    expect(
      decideEditorReadingPositionRestore({
        pending: true,
        layoutHeight: 600,
        savedPosition: buildPosition(320),
      }),
    ).toBe("restore");
  });

  it("does not restore without a pending request or a saved position", () => {
    expect(
      decideEditorReadingPositionRestore({
        pending: false,
        layoutHeight: 600,
        savedPosition: buildPosition(320),
      }),
    ).toBe("none");
    expect(
      decideEditorReadingPositionRestore({
        pending: true,
        layoutHeight: 600,
        savedPosition: null,
      }),
    ).toBe("none");
  });

  it("builds the load identity from file path, size and mtime", () => {
    expect(
      createEditorReadingLoadKey({
        filePath: "src/a.ts",
        isLoading: false,
        content: {
          isBinary: false,
          isTooLarge: false,
          modifiedAt: 1_700_000_000_000,
          sizeBytes: 42,
        },
      }),
    ).toBe("src/a.ts:42:1700000000000");
    expect(
      createEditorReadingLoadKey({
        filePath: "src/a.ts",
        isLoading: false,
        content: {
          isBinary: false,
          isTooLarge: false,
          modifiedAt: null,
          sizeBytes: 42,
        },
      }),
    ).toBe("src/a.ts:42:na");
  });

  it("has no load identity while loading or without restorable content", () => {
    const content = {
      isBinary: false,
      isTooLarge: false,
      modifiedAt: 1,
      sizeBytes: 42,
    };
    expect(
      createEditorReadingLoadKey({
        filePath: "src/a.ts",
        isLoading: true,
        content,
      }),
    ).toBeNull();
    expect(
      createEditorReadingLoadKey({
        filePath: "src/a.ts",
        isLoading: false,
        content: null,
      }),
    ).toBeNull();
    expect(
      createEditorReadingLoadKey({
        filePath: "src/a.ts",
        isLoading: false,
        content: { ...content, isBinary: true },
      }),
    ).toBeNull();
    expect(
      createEditorReadingLoadKey({
        filePath: "src/a.ts",
        isLoading: false,
        content: { ...content, isTooLarge: true },
      }),
    ).toBeNull();
  });
});
