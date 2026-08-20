import { describe, expect, it, vi } from "vitest";

const { addKeybindingRule } = vi.hoisted(() => ({
  addKeybindingRule: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("monaco-editor", () => ({
  KeyMod: { Shift: 1024 },
  KeyCode: { F12: 70 },
  editor: {
    addKeybindingRule,
  },
}));

import {
  BUILTIN_CODE_LANGUAGE_NAVIGATION_ACTION_IDS,
  CODE_LANGUAGE_FIND_REFERENCES_ACTION_ID,
  CODE_LANGUAGE_GO_TO_DEFINITION_ACTION_ID,
  applyCodeLanguageNavigationActions,
  createCodeLanguageNavigationActionDescriptors,
  filterEditorContextMenuItems,
} from "./code-language-navigation-actions";

describe("code language navigation actions", () => {
  it("filters monaco default definition and references menu items", () => {
    expect(
      filterEditorContextMenuItems([
        { command: { id: "editor.action.revealDefinition" } },
        { command: { id: "editor.action.goToReferences" } },
        { command: { id: "editor.action.clipboardCopyAction" } },
        { command: { id: "codeLanguage.goToDefinition" } },
      ]).map((item) => item.command?.id),
    ).toEqual([
      "editor.action.clipboardCopyAction",
      "codeLanguage.goToDefinition",
    ]);
    expect(BUILTIN_CODE_LANGUAGE_NAVIGATION_ACTION_IDS).toEqual([
      "editor.action.revealDefinition",
      "editor.action.goToReferences",
    ]);
  });

  it("registers i18n peek actions with Shift+F12", () => {
    const descriptors = createCodeLanguageNavigationActionDescriptors({
      goToDefinition: "转到定义",
      findReferences: "查找引用",
    });
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: CODE_LANGUAGE_GO_TO_DEFINITION_ACTION_ID,
          label: "转到定义",
          contextMenuGroupId: "navigation",
        }),
        expect.objectContaining({
          id: CODE_LANGUAGE_FIND_REFERENCES_ACTION_ID,
          label: "查找引用",
          contextMenuGroupId: "navigation",
        }),
      ]),
    );
    expect(descriptors.some((item) => item.keybindings)).toBe(false);
    expect(descriptors.map((item) => item.label)).not.toContain(
      "Go to Definition",
    );
    expect(descriptors.map((item) => item.label)).not.toContain(
      "Go to References",
    );
  });

  it("adds actions to the editor and runs builtin commands", () => {
    const reveal = vi.fn();
    const peek = vi.fn();
    const added: Array<{ id: string; run: (editor: unknown) => void }> = [];
    const editor = {
      addAction: vi.fn(
        (descriptor: { id: string; run: (editor: unknown) => void }) => {
          added.push(descriptor);
          return { dispose: vi.fn() };
        },
      ),
      getAction: vi.fn((id: string) => {
        if (id === "editor.action.revealDefinition") {
          return { run: reveal };
        }
        if (id === "editor.action.referenceSearch.trigger") {
          return { run: peek };
        }
        return null;
      }),
    };
    const disposable = applyCodeLanguageNavigationActions(editor as never, {
      goToDefinition: "Go to Definition",
      findReferences: "Find References",
    });
    expect(editor.addAction).toHaveBeenCalledTimes(2);
    added
      .find((item) => item.id === CODE_LANGUAGE_GO_TO_DEFINITION_ACTION_ID)
      ?.run(editor);
    added
      .find((item) => item.id === CODE_LANGUAGE_FIND_REFERENCES_ACTION_ID)
      ?.run(editor);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(peek).toHaveBeenCalledTimes(1);
    disposable.dispose();
  });
});
