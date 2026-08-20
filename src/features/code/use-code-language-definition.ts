import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

import {
  getCodeLanguageHostPort,
  type CodeLanguageHostPort,
} from "./code-language-host-port";
import {
  openCodeLanguageDefinitionMatch,
  selectWorkspaceDefinitionLocations,
  toRevealLineNumber,
  toWorkspaceRelativeFilePath,
  type CodeLanguageOpenMatch,
} from "./code-language-definition";
import { toCodeLanguageFileUri } from "./code-language-uri";

const DEFINITION_LANGUAGES = ["typescript", "javascript"] as const;

export function useCodeLanguageDefinition(options: {
  projectId: number;
  workspacePath: string | null;
  onOpenMatch: (match: CodeLanguageOpenMatch) => void;
  port?: CodeLanguageHostPort;
}): void {
  const { projectId, workspacePath, onOpenMatch, port } = options;
  const onOpenMatchRef = useRef(onOpenMatch);
  const portRef = useRef(port ?? getCodeLanguageHostPort());

  useEffect(() => {
    onOpenMatchRef.current = onOpenMatch;
  }, [onOpenMatch]);

  useEffect(() => {
    portRef.current = port ?? getCodeLanguageHostPort();
  });

  useEffect(() => {
    if (!workspacePath) {
      return;
    }
    const currentWorkspacePath = workspacePath;
    const providerDisposables = DEFINITION_LANGUAGES.map((language) =>
      monaco.languages.registerDefinitionProvider(language, {
        provideDefinition: async (model, position) => {
          const relativePath = toWorkspaceRelativeFilePath(
            currentWorkspacePath,
            model.uri.toString(),
          );
          if (relativePath == null) {
            return [];
          }
          try {
            const result = await portRef.current.requestDefinition({
              projectId,
              workspacePath: currentWorkspacePath,
              uri: toCodeLanguageFileUri(currentWorkspacePath, relativePath),
              position: {
                line: Math.max(0, position.lineNumber - 1),
                character: Math.max(0, position.column - 1),
              },
            });
            return selectWorkspaceDefinitionLocations(
              currentWorkspacePath,
              result.locations,
            ).map((location) => ({
              uri: monaco.Uri.parse(
                toCodeLanguageFileUri(currentWorkspacePath, location.filePath),
              ),
              range: new monaco.Range(
                location.range.start.line + 1,
                location.range.start.character + 1,
                location.range.end.line + 1,
                location.range.end.character + 1,
              ),
            }));
          } catch {
            return [];
          }
        },
      }),
    );
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor(_source, resource, selectionOrPosition) {
        return openCodeLanguageDefinitionMatch({
          workspacePath: currentWorkspacePath,
          uri: resource.toString(),
          lineNumber: toRevealLineNumber(selectionOrPosition),
          openMatch: (match) => {
            onOpenMatchRef.current(match);
          },
        });
      },
    });

    return () => {
      for (const disposable of providerDisposables) {
        disposable.dispose();
      }
      opener.dispose();
    };
  }, [projectId, workspacePath]);
}
