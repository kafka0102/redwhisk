import type { Terminal } from "@xterm/xterm";

/**
 * 全动作鼠标追踪（DECSET 1003）关掉后，xterm 不再把指针移动编码成输入。
 * 1006 / 1016 只是编码；协议回到 NONE 由 1003 的复位完成。
 */
const ESC = String.fromCharCode(0x1b);
const RELEASE_ANY_EVENT_MOUSE_TRACKING = `${ESC}[?1003l${ESC}[?1006l${ESC}[?1016l`;
const SGR_PREFIX = `${ESC}[<`;
const X10_PREFIX = `${ESC}[M`;

const releasePending = new WeakMap<Terminal, boolean>();

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function readDigits(data: string, index: number): number | null {
  if (!isDigit(data[index])) {
    return null;
  }
  let next = index + 1;
  while (isDigit(data[next])) {
    next += 1;
  }
  return next;
}

/** SGR：ESC [ < Pb ; Px ; Py M/m。失败返回 null。 */
function readSgrReport(data: string, start: number): number | null {
  if (!data.startsWith(SGR_PREFIX, start)) {
    return null;
  }
  let index = start + SGR_PREFIX.length;
  for (let field = 0; field < 3; field += 1) {
    const next = readDigits(data, index);
    if (next === null) {
      return null;
    }
    index = next;
    if (field < 2) {
      if (data[index] !== ";") {
        return null;
      }
      index += 1;
    }
  }
  const final = data[index];
  if (final !== "M" && final !== "m") {
    return null;
  }
  return index + 1;
}

/** 数据是否只由鼠标追踪上报组成（可多条拼在一起）。 */
export function isMouseTrackingReport(data: string): boolean {
  if (data.length === 0) {
    return false;
  }
  let index = 0;
  while (index < data.length) {
    const sgrEnd = readSgrReport(data, index);
    if (sgrEnd !== null) {
      index = sgrEnd;
      continue;
    }
    // X10：ESC [ M + 3 字节。
    if (
      data.startsWith(X10_PREFIX, index) &&
      index + X10_PREFIX.length + 3 <= data.length
    ) {
      index += X10_PREFIX.length + 3;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * 远程程序异常退出（例如休眠后 SSH broken pipe）时，往往来不及发送
 * DECRST 1003。xterm 仍停在 any-event 模式，但 buffer 已经回到 shell
 * 的 normal screen。此时上报会进 zsh，显示成 `35;col;rowM`。
 * alternate screen 上的 TUI 仍要这些上报，不能在这里丢。
 */
export function shouldDropLeakedMouseReport(
  terminal: Terminal,
  data: string,
): boolean {
  if (terminal.buffer.active.type !== "normal") {
    return false;
  }
  if (terminal.modes.mouseTrackingMode !== "any") {
    return false;
  }
  return isMouseTrackingReport(data);
}

/** 只写给 xterm 解析器，不进入 PTY。重复调用在上一次复位完成前合并。 */
export function releaseLeakedMouseTracking(terminal: Terminal): void {
  if (releasePending.get(terminal) === true) {
    return;
  }
  releasePending.set(terminal, true);
  terminal.write(RELEASE_ANY_EVENT_MOUSE_TRACKING, () => {
    releasePending.delete(terminal);
  });
}
