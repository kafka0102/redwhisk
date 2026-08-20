import { useEffect, useRef } from "react";

import type { CodeFileTab } from "./code-workspace-cache";
import {
  getCodeLanguageHostPort,
  type CodeLanguageHostPort,
} from "./code-language-host-port";
import { clearCodeLanguageMarkersForUri } from "./code-language-markers";
import { toCodeLanguageFileUri } from "./code-language-uri";
import { isCodeLanguageFile } from "./is-code-language-file";

const DEFAULT_DID_CHANGE_DEBOUNCE_MS = 200;

interface SyncedDocument {
  version: number;
  text: string;
}

export function useCodeLanguageDocuments(options: {
  projectId: number;
  workspacePath: string | null;
  tabs: CodeFileTab[];
  isReady: boolean;
  debounceMs?: number;
  port?: CodeLanguageHostPort;
}): void {
  const {
    projectId,
    workspacePath,
    tabs,
    isReady,
    debounceMs = DEFAULT_DID_CHANGE_DEBOUNCE_MS,
    port,
  } = options;
  const portRef = useRef(port ?? getCodeLanguageHostPort());
  const syncedRef = useRef(new Map<string, SyncedDocument>());
  const pendingTextRef = useRef(new Map<string, string>());
  const timersRef = useRef(new Map<string, number>());

  useEffect(() => {
    portRef.current = port ?? getCodeLanguageHostPort();
  });

  useEffect(() => {
    const hostPort = portRef.current;
    if (!workspacePath || !isReady) {
      if (workspacePath) {
        for (const filePath of [...syncedRef.current.keys()]) {
          closeSyncedDocument({
            filePath,
            hostPort,
            projectId,
            workspacePath,
            syncedRef,
            pendingTextRef,
            timersRef,
          });
        }
      } else {
        for (const timer of timersRef.current.values()) {
          window.clearTimeout(timer);
        }
        timersRef.current.clear();
        pendingTextRef.current.clear();
        syncedRef.current.clear();
      }
      return;
    }
    const qualifiedTabs = tabs.filter(
      (tab) =>
        tab.content &&
        isCodeLanguageFile({
          isBinary: tab.content.isBinary,
          isTooLarge: tab.content.isTooLarge,
          language: tab.content.language,
        }),
    );
    const qualifiedPaths = new Set(qualifiedTabs.map((tab) => tab.filePath));

    for (const filePath of [...syncedRef.current.keys()]) {
      if (qualifiedPaths.has(filePath)) {
        continue;
      }
      closeSyncedDocument({
        filePath,
        hostPort,
        projectId,
        workspacePath,
        syncedRef,
        pendingTextRef,
        timersRef,
      });
    }

    for (const tab of qualifiedTabs) {
      const content = tab.content;
      if (!content) {
        continue;
      }
      const uri = toCodeLanguageFileUri(workspacePath, tab.filePath);
      const text = content.content;
      const existing = syncedRef.current.get(tab.filePath);
      if (!existing) {
        syncedRef.current.set(tab.filePath, { version: 1, text });
        void hostPort.notifyDocument({
          projectId,
          workspacePath,
          uri,
          kind: "didOpen",
          languageId: content.language ?? "typescript",
          version: 1,
          text,
        });
        continue;
      }
      if (
        existing.text === text ||
        pendingTextRef.current.get(tab.filePath) === text
      ) {
        continue;
      }
      pendingTextRef.current.set(tab.filePath, text);
      const previousTimer = timersRef.current.get(tab.filePath);
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }
      const sendChange = (): void => {
        timersRef.current.delete(tab.filePath);
        pendingTextRef.current.delete(tab.filePath);
        const current = syncedRef.current.get(tab.filePath);
        if (!current) {
          return;
        }
        const version = current.version + 1;
        syncedRef.current.set(tab.filePath, { version, text });
        void hostPort.notifyDocument({
          projectId,
          workspacePath,
          uri,
          kind: "didChange",
          version,
          text,
        });
      };
      if (debounceMs <= 0) {
        sendChange();
        continue;
      }
      timersRef.current.set(
        tab.filePath,
        window.setTimeout(sendChange, debounceMs),
      );
    }
  }, [debounceMs, isReady, projectId, tabs, workspacePath]);
}

function closeSyncedDocument(options: {
  filePath: string;
  hostPort: CodeLanguageHostPort;
  projectId: number;
  workspacePath: string;
  syncedRef: { current: Map<string, SyncedDocument> };
  pendingTextRef: { current: Map<string, string> };
  timersRef: { current: Map<string, number> };
}): void {
  const {
    filePath,
    hostPort,
    projectId,
    workspacePath,
    syncedRef,
    pendingTextRef,
    timersRef,
  } = options;
  const timer = timersRef.current.get(filePath);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timersRef.current.delete(filePath);
  }
  pendingTextRef.current.delete(filePath);
  if (!syncedRef.current.has(filePath)) {
    return;
  }
  syncedRef.current.delete(filePath);
  const uri = toCodeLanguageFileUri(workspacePath, filePath);
  void hostPort.notifyDocument({
    projectId,
    workspacePath,
    uri,
    kind: "didClose",
  });
  clearCodeLanguageMarkersForUri(uri);
}
