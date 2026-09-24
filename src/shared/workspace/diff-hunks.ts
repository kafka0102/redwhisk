/**
 * 提交变更摘要视图的 hunk 切分（纯函数，与 UI 无关）。
 *
 * 输入该文件的原 / 新全文，输出可直接渲染的统一视图 hunk 列表：
 * - 行号从 1 开始；上下文行两侧都有行号、新增行只有新行号、删除行只有旧行号。
 * - `oldStart` / `newStart` 为该侧在 hunk 内的首个行号；该侧行数为 0 时（纯新增 /
 *   纯删除）表示插入点位置，调用方据此判断是否展示该侧行号范围。
 * - 同一 hunk 内两侧行交错排列；相邻改动之间未变行数不足 `2 × contextLines` 时合并。
 * - 两侧内容一致（例如仅重命名）时返回空列表，由 UI 渲染「无内容变更」。
 * - 行尾 `\r` 与文件末尾换行不参与比较：CRLF / LF 互换、仅增删末尾换行都视为无变更。
 */

/** hunk 前后各保留的未改动行数。 */
export const DEFAULT_HUNK_CONTEXT_LINES = 3;

/**
 * 去掉公共前后缀后的中间段编辑距离上限。超过该上限时回退为「整段删除 + 整段新增」，
 * 避免极端重写（例如整份 regenerate 的大文件）在渲染线程上做无界回溯。
 */
export const MAX_HUNK_EDIT_DISTANCE = 2000;

export type DiffHunkLineKind = "context" | "added" | "removed";

/** hunk 内单行：上下文行两侧都有行号，新增行只有新行号，删除行只有旧行号。 */
export interface DiffHunkLine {
  kind: DiffHunkLineKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

/** 单个 hunk：两侧起始行号 / 行数 + 按统一视图顺序排列的行。 */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffHunkLine[];
}

interface LineEdit {
  kind: DiffHunkLineKind;
  text: string;
}

/** 全文按行切分；丢弃末尾空串（末尾换行不算一行），CRLF 的 `\r` 不参与比较。 */
function splitContentLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function commonPrefixLength(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length);
  let count = 0;
  while (count < limit && a[count] === b[count]) {
    count += 1;
  }
  return count;
}

function commonSuffixLength(
  a: string[],
  b: string[],
  prefixLength: number,
): number {
  const limit = Math.min(a.length, b.length) - prefixLength;
  let count = 0;
  while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) {
    count += 1;
  }
  return count;
}

/**
 * Myers 差分（O((N+M)D)）。返回 null 表示中间段编辑距离超过上限，由调用方回退。
 */
function diffTrimmedLines(a: string[], b: string[]): LineEdit[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  // v[k] = 当前 d 下对角线 k 上已到达的最远 x。
  const v = new Map<number, number>();
  const trace: Array<Map<number, number>> = [];

  for (let d = 0; d <= max; d += 1) {
    if (d > MAX_HUNK_EDIT_DISTANCE) {
      return null;
    }
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = v.get(k + 1);
      const right = v.get(k - 1);
      let x: number;
      if (k === -d || (k !== d && (right ?? -Infinity) < (down ?? -Infinity))) {
        x = down ?? 0;
      } else {
        x = (right ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        return backtrackLineEdits(a, b, trace, d);
      }
    }
  }
  return null;
}

function backtrackLineEdits(
  a: string[],
  b: string[],
  trace: Array<Map<number, number>>,
  foundDistance: number,
): LineEdit[] {
  const edits: LineEdit[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = foundDistance; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const down = v.get(k + 1);
    const right = v.get(k - 1);
    const previousK =
      k === -d || (k !== d && (right ?? -Infinity) < (down ?? -Infinity))
        ? k + 1
        : k - 1;
    const previousX = v.get(previousK) ?? 0;
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      edits.push({ kind: "context", text: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d === 0) {
      continue;
    }
    if (x === previousX) {
      edits.push({ kind: "added", text: b[y - 1] });
      y -= 1;
    } else {
      edits.push({ kind: "removed", text: a[x - 1] });
      x -= 1;
    }
  }

  edits.reverse();
  return edits;
}

function computeLineEdits(a: string[], b: string[]): LineEdit[] {
  const prefixLength = commonPrefixLength(a, b);
  const suffixLength = commonSuffixLength(a, b, prefixLength);
  const middleA = a.slice(prefixLength, a.length - suffixLength);
  const middleB = b.slice(prefixLength, b.length - suffixLength);
  const middle = diffTrimmedLines(middleA, middleB);

  return [
    ...a.slice(0, prefixLength).map(toContextEdit),
    ...(middle ?? [...middleA.map(toRemovedEdit), ...middleB.map(toAddedEdit)]),
    ...a.slice(a.length - suffixLength).map(toContextEdit),
  ];
}

function toContextEdit(text: string): LineEdit {
  return { kind: "context", text };
}

function toRemovedEdit(text: string): LineEdit {
  return { kind: "removed", text };
}

function toAddedEdit(text: string): LineEdit {
  return { kind: "added", text };
}

interface ChangeBlock {
  start: number;
  end: number;
}

/** 相邻改动之间未变行数不足 `2 × contextLines` 时并入同一改动块。 */
function groupChangeBlocks(
  edits: LineEdit[],
  contextLines: number,
): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  edits.forEach((edit, index) => {
    if (edit.kind === "context") {
      return;
    }
    const last = blocks[blocks.length - 1];
    if (last && index - last.end - 1 < contextLines * 2) {
      last.end = index;
      return;
    }
    blocks.push({ start: index, end: index });
  });
  return blocks;
}

/** 逐行计算两侧行号：上下文行两侧都有，删除行只有旧行号，新增行只有新行号。 */
function computeLineNumbers(edits: LineEdit[]): {
  oldLineNumbers: Array<number | null>;
  newLineNumbers: Array<number | null>;
  oldLinesBefore: number[];
  newLinesBefore: number[];
} {
  const oldLineNumbers: Array<number | null> = [];
  const newLineNumbers: Array<number | null> = [];
  const oldLinesBefore: number[] = [];
  const newLinesBefore: number[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const edit of edits) {
    oldLinesBefore.push(oldLine);
    newLinesBefore.push(newLine);
    oldLineNumbers.push(edit.kind === "added" ? null : oldLine);
    newLineNumbers.push(edit.kind === "removed" ? null : newLine);
    if (edit.kind !== "added") {
      oldLine += 1;
    }
    if (edit.kind !== "removed") {
      newLine += 1;
    }
  }

  return { oldLineNumbers, newLineNumbers, oldLinesBefore, newLinesBefore };
}

function toHunk(
  edits: LineEdit[],
  block: ChangeBlock,
  contextLines: number,
  lineNumbers: ReturnType<typeof computeLineNumbers>,
): DiffHunk {
  const from = Math.max(0, block.start - contextLines);
  const to = Math.min(edits.length - 1, block.end + contextLines);
  const lines = edits.slice(from, to + 1).map((edit, offset) => ({
    kind: edit.kind,
    oldLineNumber: lineNumbers.oldLineNumbers[from + offset],
    newLineNumber: lineNumbers.newLineNumbers[from + offset],
    text: edit.text,
  }));
  const oldNumbers = lines
    .map((line) => line.oldLineNumber)
    .filter((lineNumber): lineNumber is number => lineNumber !== null);
  const newNumbers = lines
    .map((line) => line.newLineNumber)
    .filter((lineNumber): lineNumber is number => lineNumber !== null);

  return {
    oldStart: oldNumbers[0] ?? lineNumbers.oldLinesBefore[from],
    oldCount: oldNumbers.length,
    newStart: newNumbers[0] ?? lineNumbers.newLinesBefore[from],
    newCount: newNumbers.length,
    lines,
  };
}

export function computeDiffHunks(
  originalContent: string,
  modifiedContent: string,
  contextLines: number = DEFAULT_HUNK_CONTEXT_LINES,
): DiffHunk[] {
  const edits = computeLineEdits(
    splitContentLines(originalContent),
    splitContentLines(modifiedContent),
  );
  const blocks = groupChangeBlocks(edits, Math.max(0, contextLines));
  if (blocks.length === 0) {
    return [];
  }
  const lineNumbers = computeLineNumbers(edits);
  return blocks.map((block) =>
    toHunk(edits, block, Math.max(0, contextLines), lineNumbers),
  );
}
