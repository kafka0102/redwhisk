/**
 * 检测「非备用屏、CUP 原地重绘」场景：当前屏内容可被覆盖且 baseY===0 时
 * 无法上滚查看更早输出（典型：短 shell 后启动 Codex TUI）。
 */

const ESC = 0x1b;
const BRACKET = 0x5b; // [
const CUP_FINAL = 0x48; // H

export const IN_PLACE_TUI_CUP_SCORE_THRESHOLD = 3;
const CUP_SCORE_MAX = 32;

export interface InPlaceTuiCupTracker {
  observe(bytes: Uint8Array): void;
  getScore(): number;
  reset(): void;
}

/**
 * 统计将光标移到第 1 行（含缺省行）的 CUP 序列数量。
 * 匹配：CSI H / CSI ;H / CSI 1;1H / CSI 0;1H 等。
 */
export function countCupHomeSequences(bytes: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== ESC) {
      continue;
    }
    if (bytes[index + 1] !== BRACKET) {
      continue;
    }

    let cursor = index + 2;
    let params = "";
    while (cursor < bytes.length) {
      const code = bytes[cursor];
      if (code === CUP_FINAL) {
        if (isHomeRowCup(params)) {
          count += 1;
        }
        break;
      }
      // 参数数字与分号；其它字符则不是我们关心的 CUP
      if (
        (code >= 0x30 && code <= 0x39) || // 0-9
        code === 0x3b // ;
      ) {
        params += String.fromCharCode(code);
        cursor += 1;
        continue;
      }
      break;
    }
  }
  return count;
}

function isHomeRowCup(params: string): boolean {
  if (params.length === 0 || params === ";") {
    return true;
  }
  const rowToken = params.split(";")[0] ?? "";
  if (rowToken.length === 0) {
    return true;
  }
  const row = Number(rowToken);
  return Number.isFinite(row) && row <= 1;
}

export function createInPlaceTuiCupTracker(): InPlaceTuiCupTracker {
  let score = 0;

  return {
    observe(bytes: Uint8Array): void {
      if (bytes.length === 0) {
        return;
      }
      const cups = countCupHomeSequences(bytes);
      if (cups > 0) {
        score = Math.min(CUP_SCORE_MAX, score + cups);
        return;
      }
      // 无 CUP 的输出逐渐衰减，避免提示在普通 shell 下残留
      score = Math.max(0, score - 1);
    },
    getScore(): number {
      return score;
    },
    reset(): void {
      score = 0;
    },
  };
}

export function shouldShowInPlaceTuiScrollHint(
  baseY: number,
  cupScore: number,
  threshold: number = IN_PLACE_TUI_CUP_SCORE_THRESHOLD,
): boolean {
  return baseY <= 0 && cupScore >= threshold;
}

export type InPlaceTuiScrollHintAction =
  | { type: "show" }
  | { type: "clear"; source: "inplace" | "output" | "poll" }
  | { type: "noop" };

/**
 * 根据当前状态源与 buffer 情况决定是否展示/清除 inplace 提示。
 * 不覆盖 restore/boot/input/inactive 等高优先级状态。
 */
export function resolveInPlaceTuiScrollHintAction(
  statusSource: string | null,
  baseY: number,
  cupScore: number,
): InPlaceTuiScrollHintAction {
  if (
    statusSource &&
    statusSource !== "inplace" &&
    statusSource !== "output" &&
    statusSource !== "poll"
  ) {
    return { type: "noop" };
  }
  if (shouldShowInPlaceTuiScrollHint(baseY, cupScore)) {
    return { type: "show" };
  }
  if (
    statusSource === "inplace" ||
    statusSource === "output" ||
    statusSource === "poll"
  ) {
    return { type: "clear", source: statusSource };
  }
  return { type: "noop" };
}
