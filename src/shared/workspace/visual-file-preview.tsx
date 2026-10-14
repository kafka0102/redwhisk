import { useEffect, useMemo, useState } from "react";

import type { WorkspacePreviewKind } from "./workspace-commands";

function decodeBase64(value: string): Uint8Array | null {
  if (value.length === 0) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function createPreviewObjectUrl(
  bytesBase64: string,
  mimeType: string,
): string | null {
  const bytes = decodeBase64(bytesBase64);
  if (!bytes) {
    return null;
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function VisualFilePreview({
  bytesBase64,
  mimeType,
  kind,
  label,
  failureMessage,
}: {
  bytesBase64: string;
  mimeType: string;
  kind: WorkspacePreviewKind;
  label: string;
  failureMessage: string;
}) {
  const previewUrl = useMemo(
    () => createPreviewObjectUrl(bytesBase64, mimeType),
    [bytesBase64, mimeType],
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const mediaFailed = previewUrl != null && failedUrl === previewUrl;

  useEffect(() => {
    if (!previewUrl) {
      return;
    }
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!previewUrl || mediaFailed) {
    return (
      <p className="session-viewer-state" role="alert">
        {failureMessage}
      </p>
    );
  }

  if (kind === "pdf") {
    return (
      <iframe
        className="visual-file-preview visual-file-preview--pdf"
        src={previewUrl}
        title={label}
      />
    );
  }

  return (
    <div className="visual-file-preview">
      <img
        alt={label}
        src={previewUrl}
        onError={() => {
          setFailedUrl(previewUrl);
        }}
      />
    </div>
  );
}
