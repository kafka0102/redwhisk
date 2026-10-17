const PAGE_UP = "\u001b[5~";
const PAGE_DOWN = "\u001b[6~";
const WHEEL_TAIL = /^\d+;\d+[Mm]$/;

function isWheel(data: string, button: "64" | "65"): boolean {
  const prefix = `\u001b[<${button};`;
  if (!data.startsWith(prefix)) {
    return false;
  }
  return WHEEL_TAIL.test(data.slice(prefix.length));
}

/** 完成回看只把滚轮和翻页键交给 CLI，其余输入丢掉。 */
export function filterCompletedReviewInput(data: string): string {
  if (
    data === PAGE_UP ||
    data === PAGE_DOWN ||
    isWheel(data, "64") ||
    isWheel(data, "65")
  ) {
    return data;
  }
  return "";
}
