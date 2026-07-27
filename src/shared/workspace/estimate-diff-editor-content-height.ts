/**
 * 按内容行数与字号推算 Monaco DiffEditor 像素高度（multi-diff 内容高度模式）。
 * side-by-side / inline 均取 original/modified 行数较大者。
 */
export function estimateDiffEditorContentHeightPx(
  originalContent: string,
  modifiedContent: string,
  fontSize: number,
): number {
  const lineCount = Math.max(
    countTextLines(originalContent),
    countTextLines(modifiedContent),
    1,
  );
  const lineHeight = Math.ceil(fontSize * 1.5);
  const verticalChromePx = 12;
  return lineCount * lineHeight + verticalChromePx;
}

function countTextLines(content: string): number {
  if (content.length === 0) {
    return 1;
  }
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return lines;
}
