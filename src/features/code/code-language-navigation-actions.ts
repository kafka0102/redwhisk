import * as monaco from "monaco-editor";

import {
  BUILTIN_CODE_LANGUAGE_NAVIGATION_ACTION_IDS,
  filterEditorContextMenuItems,
} from "../../shared/monaco-builtin-navigation-menu";

export const CODE_LANGUAGE_GO_TO_DEFINITION_ACTION_ID =
  "codeLanguage.goToDefinition";
export const CODE_LANGUAGE_FIND_REFERENCES_ACTION_ID =
  "codeLanguage.findReferences";

export {
  BUILTIN_CODE_LANGUAGE_NAVIGATION_ACTION_IDS,
  filterEditorContextMenuItems,
};

export interface CodeLanguageNavigationLabels {
  goToDefinition: string;
  findReferences: string;
}

export function createCodeLanguageNavigationActionDescriptors(
  labels: CodeLanguageNavigationLabels,
): monaco.editor.IActionDescriptor[] {
  return [
    {
      id: CODE_LANGUAGE_GO_TO_DEFINITION_ACTION_ID,
      label: labels.goToDefinition,
      precondition: "editorHasDefinitionProvider",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.1,
      run: (editor) => {
        void editor.getAction("editor.action.revealDefinition")?.run();
      },
    },
    {
      id: CODE_LANGUAGE_FIND_REFERENCES_ACTION_ID,
      label: labels.findReferences,
      precondition: "editorHasReferenceProvider",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.45,
      run: (editor) => {
        void editor.getAction("editor.action.referenceSearch.trigger")?.run();
      },
    },
  ];
}

export function applyCodeLanguageNavigationActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  labels: CodeLanguageNavigationLabels,
): monaco.IDisposable {
  const actionDisposables = createCodeLanguageNavigationActionDescriptors(
    labels,
  ).map((descriptor) => editor.addAction(descriptor));
  const unbindBuiltin = monaco.editor.addKeybindingRule({
    keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F12,
    command: null,
  });
  const bindPeek = monaco.editor.addKeybindingRule({
    keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F12,
    command: "editor.action.referenceSearch.trigger",
  });
  return {
    dispose: () => {
      for (const disposable of actionDisposables) {
        disposable.dispose();
      }
      unbindBuiltin.dispose();
      bindPeek.dispose();
    },
  };
}
