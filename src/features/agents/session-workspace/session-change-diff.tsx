import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { useAlertDialog } from "../../../components/ui";
import { CodeMarkdownPreview } from "../../code/code-markdown-preview";
import { useI18n } from "../../../shared/i18n/i18n";
import { DiffViewer } from "../../../shared/workspace/diff-viewer";
import { getDiffAvailability } from "../../../shared/workspace/diff-availability";
import {
  isHtmlFile,
  openHtmlInBrowser,
} from "../../../shared/workspace/open-html-in-browser";
import { statProjectWorktreeFile } from "../../../shared/workspace/workspace-commands";
import type { SessionWorkspaceSingleFileChangeTab } from "./session-workspace-types";

interface SessionChangeDiffProps {
  projectId: number;
  sessionId: number;
  tab: SessionWorkspaceSingleFileChangeTab;
  workspacePath?: string | null;
}

export function SessionChangeDiff({
  projectId,
  sessionId,
  tab,
  workspacePath = null,
}: SessionChangeDiffProps): ReactElement {
  const { contentFontSize, t, theme } = useI18n();
  const { alertDialog, showAlert } = useAlertDialog();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const availability = getDiffAvailability(tab);
  const diff = availability.kind === "content" ? availability.diff : null;
  const showMarkdown =
    diff != null && diff.language === "markdown" && diff.kind !== "deleted";
  const workspaceRoot = hasWorkspaceRoot(workspacePath) ? workspacePath : null;
  const htmlPath =
    diff != null && workspaceRoot != null && isHtmlFile(diff.filePath)
      ? diff.filePath
      : null;
  const htmlExists = useWorktreeFileExists(
    htmlPath != null,
    projectId,
    sessionId,
    htmlPath ?? "",
  );

  const isPreview = showMarkdown && previewPath === tab.filePath;
  const showBrowser = htmlExists && workspaceRoot != null && htmlPath != null;
  let statusActions: ReactNode = null;
  if (showBrowser || showMarkdown) {
    statusActions = (
      <>
        {showBrowser && workspaceRoot != null && htmlPath != null ? (
          <button
            type="button"
            className="code-workspace__browser-toggle"
            aria-label={t("agentsFeature.openHtmlInBrowser")}
            title={t("agentsFeature.openHtmlInBrowser")}
            onClick={() => {
              void openHtmlInBrowser(workspaceRoot, htmlPath).then((opened) => {
                if (!opened) {
                  showAlert({
                    message: t("agentsFeature.openHtmlInBrowserFailed"),
                    type: "error",
                  });
                }
              });
            }}
          >
            <SessionBrowserIcon />
          </button>
        ) : null}
        {showMarkdown ? (
          <button
            type="button"
            className="code-workspace__markdown-toggle"
            aria-label={t("agentsFeature.toggleMarkdownPreview")}
            aria-pressed={isPreview}
            title={t("agentsFeature.toggleMarkdownPreview")}
            onClick={() => {
              setPreviewPath(isPreview ? null : tab.filePath);
            }}
          >
            {isPreview ? (
              <EyeOff aria-hidden="true" size={14} strokeWidth={1.9} />
            ) : (
              <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
            )}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <DiffViewer
        bodyOverride={
          isPreview && diff != null ? (
            <div
              className="code-workspace__markdown-preview"
              style={{ fontSize: contentFontSize }}
            >
              <CodeMarkdownPreview
                content={diff.modifiedContent}
                theme={theme}
              />
            </div>
          ) : undefined
        }
        statusActions={statusActions}
        tab={tab}
      />
      {alertDialog}
    </>
  );
}

function useWorktreeFileExists(
  enabled: boolean,
  projectId: number,
  sessionId: number,
  filePath: string,
): boolean {
  const [confirmedPath, setConfirmedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void statProjectWorktreeFile({ projectId, sessionId, filePath })
      .then(() => {
        if (!cancelled) {
          setConfirmedPath(filePath);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfirmedPath(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, filePath, projectId, sessionId]);

  return enabled && confirmedPath === filePath;
}

function hasWorkspaceRoot(
  workspacePath: string | null | undefined,
): workspacePath is string {
  return typeof workspacePath === "string" && workspacePath.trim().length > 0;
}

function SessionBrowserIcon(): ReactElement {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="#34A853" />
      <path
        d="M12 2a10 10 0 0 1 8.66 15H13.2A4.6 4.6 0 0 0 12 7.4V2Z"
        fill="#EA4335"
      />
      <path
        d="M3.34 7A10 10 0 0 0 12 22l3.2-7.6A4.6 4.6 0 0 0 8.2 13.1L3.34 7Z"
        fill="#FBBC04"
      />
      <circle cx="12" cy="12" r="4.5" fill="#fff" />
      <circle cx="12" cy="12" r="3.1" fill="#4285F4" />
    </svg>
  );
}
