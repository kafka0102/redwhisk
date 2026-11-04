// GFM 表格列宽。助手消息和代码 Markdown 预览共用这一份，避免半角规则分叉。
// 宽字符计 2，其余计 1，封顶 72。链接只算标签，强调和行内代码只算里面的字。

import type { Components } from "react-markdown";

/** 约 36 个汉字。宽字符计 2，其余计 1。 */
const TABLE_COLUMN_CAP_UNITS = 72;

const WIDE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

interface MarkdownTreeNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
}

function isWideCodePoint(codePoint: number): boolean {
  return WIDE_CODE_POINT_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end,
  );
}

function halfwidthUnits(text: string): number {
  let units = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    units += codePoint !== undefined && isWideCodePoint(codePoint) ? 2 : 1;
  }
  return units;
}

function visibleTextFromNode(node: MarkdownTreeNode): string {
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(visibleTextFromNode).join("");
}

function elementChildren(node: MarkdownTreeNode): MarkdownTreeNode[] {
  return (node.children ?? []).filter((child) => child.type === "element");
}

function tableRows(table: MarkdownTreeNode): MarkdownTreeNode[] {
  const rows: MarkdownTreeNode[] = [];
  for (const section of elementChildren(table)) {
    if (section.tagName === "tr") {
      rows.push(section);
      continue;
    }
    for (const row of elementChildren(section)) {
      if (row.tagName === "tr") {
        rows.push(row);
      }
    }
  }
  return rows;
}

function rowCells(row: MarkdownTreeNode): MarkdownTreeNode[] {
  return elementChildren(row).filter(
    (cell) => cell.tagName === "th" || cell.tagName === "td",
  );
}

function columnContentUnits(text: readonly string[]): number {
  const widest = text.reduce(
    (max, cell) => Math.max(max, halfwidthUnits(cell)),
    0,
  );
  return Math.min(TABLE_COLUMN_CAP_UNITS, widest);
}

function columnWidths(table: MarkdownTreeNode): number[] {
  const rows = tableRows(table);
  const header = rows[0];
  if (header === undefined) {
    return [];
  }
  const body = rows.slice(1);
  return rowCells(header).map((headerCell, index) =>
    columnContentUnits([
      visibleTextFromNode(headerCell).trim(),
      ...body.map((row) =>
        visibleTextFromNode(
          rowCells(row)[index] ?? { type: "element", children: [] },
        ).trim(),
      ),
    ]),
  );
}

function markdownTreeNode(node: unknown): MarkdownTreeNode | null {
  if (typeof node !== "object" || node === null || !("type" in node)) {
    return null;
  }
  const record = node as { type: unknown };
  if (record.type !== "element") {
    return null;
  }
  return node as MarkdownTreeNode;
}

function cellStyle(node: { properties?: Record<string, unknown> } | undefined):
  | {
      width?: string;
      minWidth?: string;
      maxWidth?: string;
      textAlign?: "center" | "right";
    }
  | undefined {
  const size = columnContentSize(node);
  const textAlign = tableCellAlign(node?.properties?.align);
  if (size === undefined && textAlign === undefined) {
    return undefined;
  }
  return {
    ...(size === undefined
      ? {}
      : { width: size, minWidth: size, maxWidth: size }),
    ...(textAlign === undefined ? {} : { textAlign }),
  };
}

function tableCellAlign(align: unknown): "center" | "right" | undefined {
  if (align === "center" || align === "right") {
    return align;
  }
  return undefined;
}

function findTables(node: MarkdownTreeNode): MarkdownTreeNode[] {
  const tables: MarkdownTreeNode[] = [];
  if (node.type === "element" && node.tagName === "table") {
    tables.push(node);
  }
  for (const child of node.children ?? []) {
    tables.push(...findTables(child));
  }
  return tables;
}

/** 把列内容宽写到格子上。只写在 col 上时，浏览器会把内边距算进列宽，短列会被挤成一字一行。 */
function annotateTableColumnWidths(tree: MarkdownTreeNode): void {
  for (const table of findTables(tree)) {
    const widths = columnWidths(table);
    for (const row of tableRows(table)) {
      rowCells(row).forEach((cell, index) => {
        const units = widths[index];
        if (units === undefined) {
          return;
        }
        const properties = (cell.properties ??= {});
        properties.dataColumnCh = String(units);
      });
    }
  }
}

export function rehypeMarkdownTableWidths(): (tree: MarkdownTreeNode) => void {
  return (tree: MarkdownTreeNode): void => {
    annotateTableColumnWidths(tree);
  };
}

function columnContentSize(
  node: { properties?: Record<string, unknown> } | undefined,
): string | undefined {
  const raw = node?.properties?.dataColumnCh;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return undefined;
  }
  return `${raw}ch`;
}

export const markdownTableComponents: Pick<Components, "table" | "th" | "td"> =
  {
    table({ children, node }) {
      const tree = markdownTreeNode(node);
      const widths = tree === null ? [] : columnWidths(tree);
      return (
        <div className="agents-message__table-scroll">
          <table className="agents-message__table">
            <colgroup>
              {widths.map((units, index) => (
                <col
                  key={index}
                  style={{
                    width: `${units}ch`,
                    minWidth: `${units}ch`,
                    maxWidth: `${units}ch`,
                  }}
                />
              ))}
            </colgroup>
            {children}
          </table>
        </div>
      );
    },
    th({ children, node }) {
      return (
        <th
          className="agents-message__table-cell agents-message__table-head"
          style={cellStyle(node)}
        >
          {children}
        </th>
      );
    },
    td({ children, node }) {
      return (
        <td className="agents-message__table-cell" style={cellStyle(node)}>
          {children}
        </td>
      );
    },
  };
