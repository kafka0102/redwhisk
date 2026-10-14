import type {
  WorkspaceDiffContent,
  WorkspaceFileContent,
  WorkspacePreviewKind,
} from "./workspace-commands";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export type SvgPreviewView = "image" | "text";

/** 1MB 内 SVG：有 UTF-8 文本且带图片预览，才允许切到文本。 */
export function isSvgTextSwitchable(content: WorkspaceFileContent): boolean {
  return (
    content.previewKind === "image" && !content.isBinary && !content.isTooLarge
  );
}

/** 位图与 PDF 不提供文本编辑。过大文件不算。 */
export function isBitmapOrPdfPreview(content: WorkspaceFileContent): boolean {
  if (content.isTooLarge || content.previewKind == null) {
    return false;
  }
  if (content.previewKind === "pdf") {
    return true;
  }
  return content.isBinary;
}

export function shouldRenderVisualPreview(
  content: WorkspaceFileContent,
  svgView: SvgPreviewView,
): boolean {
  if (content.isTooLarge || content.previewKind == null) {
    return false;
  }
  if (isSvgTextSwitchable(content) && svgView === "text") {
    return false;
  }
  return true;
}

/** SVG 两侧都有 ≤1MB 文本时，才允许从并排图片切到文本 diff。 */
export function isSvgDiffTextSwitchable(diff: WorkspaceDiffContent): boolean {
  return (
    diff.previewKind === "image" &&
    !diff.isTooLarge &&
    !diff.isBinary &&
    diff.originalContent.length + diff.modifiedContent.length > 0
  );
}

export function visualPreviewMimeType(
  filePath: string,
  kind: WorkspacePreviewKind,
): string {
  if (kind === "pdf") {
    return "application/pdf";
  }
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}
