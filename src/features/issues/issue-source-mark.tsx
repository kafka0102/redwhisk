import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { IssueMirrorView } from "./issue-mirror-fields";

export function IssueSourceMark({
  mirror,
}: {
  mirror: IssueMirrorView;
}): JSX.Element {
  const { t } = useI18n();
  const kind =
    mirror.source !== "remote"
      ? "local"
      : mirror.provider === "gitlab"
        ? "gitlab"
        : "github";
  const label =
    kind === "local"
      ? t("issues.sourceLocal")
      : kind === "gitlab"
        ? t("issues.sourceGitLab")
        : t("issues.sourceGitHub");
  return (
    <span
      aria-label={label}
      className="issue-source-mark"
      data-kind={kind}
      role="img"
    >
      {kind === "local" ? (
        <LocalGlyph />
      ) : kind === "gitlab" ? (
        <GitLabGlyph />
      ) : (
        <GitHubGlyph />
      )}
    </span>
  );
}

function LocalGlyph(): JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <rect
        height="7.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.4"
        width="11"
        x="2.5"
        y="3"
      />
      <path d="M6 13.5h4M8 10.5v3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function GitHubGlyph(): JSX.Element {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 2.2a5.8 5.8 0 0 0-1.8 11.3c.3 0 .4-.1.4-.3v-1.1c-1.5.3-1.8-.6-1.8-.6-.2-.6-.6-.8-.6-.8-.5-.3 0-.3 0-.3.6 0 .9.6.9.6.5.8 1.3.6 1.6.4.1-.4.2-.6.4-.7-1.2-.1-2.4-.6-2.4-2.6 0-.6.2-1 .5-1.4-.1-.1-.2-.7.1-1.4 0 0 .5-.2 1.6.5a5.5 5.5 0 0 1 2.9 0c1.1-.7 1.6-.5 1.6-.5.3.7.2 1.3.1 1.4.3.4.5.8.5 1.4 0 2-1.2 2.5-2.4 2.6.2.2.4.5.4 1v1.5c0 .2.1.3.4.3A5.8 5.8 0 0 0 8 2.2z" />
    </svg>
  );
}

function GitLabGlyph(): JSX.Element {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 13.2 2.2 8.4 4 3.2l2.1 3.6h3.8L12 3.2l1.8 5.2z" />
    </svg>
  );
}
