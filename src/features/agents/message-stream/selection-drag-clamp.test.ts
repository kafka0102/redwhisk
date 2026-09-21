// 拖拽选择越界修正的单测。
//
// 说明：真正的失效来自浏览器内核对「指针离开滚动容器」时的端点命中（把端点夹到
// 容器首/末行），jsdom 不实现该行为，所以这里用桩模拟内核写入的越界选区，验证我们
// 的接管逻辑（何时接管、夹到哪、mouseup 后是否收敛）。浏览器侧的端到端行为由
// issue #237 的 WebKit/Chromium 复现脚本验证。

import { afterEach, describe, expect, it } from "vitest";

import {
  clampPointIntoRect,
  installSelectionDragClamp,
  isCaretInsideVisibleContent,
  resolveCaretPoint,
} from "./selection-drag-clamp";

const RECT = {
  top: 100,
  right: 400,
  bottom: 300,
  left: 0,
};

describe("clampPointIntoRect", () => {
  it("指针在矩形内时返回 null（交给浏览器原生选择）", () => {
    expect(clampPointIntoRect({ x: 200, y: 150 }, RECT)).toBeNull();
    expect(clampPointIntoRect({ x: 0, y: 100 }, RECT)).toBeNull();
    expect(clampPointIntoRect({ x: 400, y: 300 }, RECT)).toBeNull();
  });

  it("指针在矩形外时夹到边缘内侧 1px", () => {
    expect(clampPointIntoRect({ x: 200, y: 40 }, RECT)).toEqual({
      x: 200,
      y: 101,
    });
    expect(clampPointIntoRect({ x: 200, y: 480 }, RECT)).toEqual({
      x: 200,
      y: 299,
    });
    expect(clampPointIntoRect({ x: -30, y: 150 }, RECT)).toEqual({
      x: 1,
      y: 150,
    });
    expect(clampPointIntoRect({ x: 900, y: 150 }, RECT)).toEqual({
      x: 399,
      y: 150,
    });
  });

  it("支持自定义退让量（取边缘文本时按行高内缩）", () => {
    expect(clampPointIntoRect({ x: 200, y: 480 }, RECT, 6)).toEqual({
      x: 200,
      y: 294,
    });
  });
});

describe("isCaretInsideVisibleContent", () => {
  it("命中点在可见内容内视为有效", () => {
    expect(
      isCaretInsideVisibleContent(
        { top: 250, right: 10, bottom: 268, left: 0 },
        RECT,
      ),
    ).toBe(true);
  });

  it("命中点远在可见内容之上（被夹到容器起点的形态）视为无效", () => {
    expect(
      isCaretInsideVisibleContent(
        { top: 12, right: 10, bottom: 30, left: 0 },
        RECT,
      ),
    ).toBe(false);
  });

  it("命中点远在可见内容之下视为无效", () => {
    expect(
      isCaretInsideVisibleContent(
        { top: 420, right: 10, bottom: 438, left: 0 },
        RECT,
      ),
    ).toBe(false);
  });

  it("几何信息不可用（全 0，如 jsdom）时视为有效，由节点校验兜底", () => {
    expect(
      isCaretInsideVisibleContent(
        { top: 0, right: 0, bottom: 0, left: 0 },
        RECT,
      ),
    ).toBe(true);
  });
});

describe("resolveCaretPoint", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "caretPositionFromPoint");
    Reflect.deleteProperty(document, "caretRangeFromPoint");
  });

  it("优先使用标准 caretPositionFromPoint", () => {
    const node = document.createTextNode("文本");
    (
      document as unknown as { caretPositionFromPoint: unknown }
    ).caretPositionFromPoint = () => ({ offsetNode: node, offset: 1 });
    expect(resolveCaretPoint(document, { x: 1, y: 2 })).toEqual({
      node,
      offset: 1,
    });
  });

  it("回退到 WebKit 的 caretRangeFromPoint", () => {
    const node = document.createTextNode("文本");
    const range = document.createRange();
    range.setStart(node, 2);
    range.setEnd(node, 2);
    (
      document as unknown as { caretRangeFromPoint: unknown }
    ).caretRangeFromPoint = () => range;
    expect(resolveCaretPoint(document, { x: 1, y: 2 })).toEqual({
      node,
      offset: 2,
    });
  });

  it("两个 API 都不存在时返回 null", () => {
    expect(resolveCaretPoint(document, { x: 1, y: 2 })).toBeNull();
  });
});

/** 测试用命中模型：上半区命中首行、下半区命中末行。 */
function createCaretStub(firstText: Text, lastText: Text) {
  return (_document: Document, point: { x: number; y: number }) =>
    point.y <= 200
      ? { node: firstText as Node, offset: 0 }
      : { node: lastText as Node, offset: 0 };
}

function setupStream() {
  document.body.innerHTML = `
    <div id="stream">
      <p id="first">第一行文本</p>
      <p id="last">最后一行文本</p>
    </div>
  `;
  const element = document.getElementById("stream") as HTMLElement;
  element.getBoundingClientRect = () =>
    ({
      ...RECT,
      x: RECT.left,
      y: RECT.top,
      width: RECT.right - RECT.left,
      height: RECT.bottom - RECT.top,
      toJSON: () => ({}),
    }) as DOMRect;
  const firstText = document.getElementById("first")!.firstChild as Text;
  const lastText = document.getElementById("last")!.firstChild as Text;
  return { element, firstText, lastText };
}

/** 带 padding 的滚动容器：内容盒为 128..282，底部 18px 是命中不到文本的 padding。 */
function setupPaddedStream() {
  document.body.innerHTML = `
    <div id="stream" style="padding: 28px 18px 18px;">
      <p id="head">会话开头文本</p>
      <p id="visible">底部可见结论文本</p>
    </div>
  `;
  const element = document.getElementById("stream") as HTMLElement;
  element.getBoundingClientRect = () =>
    ({
      ...RECT,
      x: RECT.left,
      y: RECT.top,
      width: RECT.right - RECT.left,
      height: RECT.bottom - RECT.top,
      toJSON: () => ({}),
    }) as DOMRect;
  const headText = document.getElementById("head")!.firstChild as Text;
  const visibleText = document.getElementById("visible")!.firstChild as Text;
  return { element, headText, visibleText };
}

function useManualFrames() {
  const frames: Array<() => void> = [];
  const originalRequest = window.requestAnimationFrame;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(() => callback(0));
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  return {
    /** 逐帧执行（有上限：拖拽期间的修正循环会不断续订下一帧）。 */
    flush(limit = 10) {
      for (let step = 0; step < limit && frames.length > 0; step += 1) {
        const frame = frames.shift();
        frame?.();
      }
    },
    restore() {
      window.requestAnimationFrame = originalRequest;
    },
  };
}

function pressAndDragTo(target: EventTarget, to: { x: number; y: number }) {
  target.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 200,
      clientY: 250,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      buttons: 1,
      clientX: to.x,
      clientY: to.y,
    }),
  );
}

/** 模拟内核：把选区端点夹到容器首行（用户看到的「整段被选中」）。 */
function simulateKernelEscape(firstText: Text, lastText: Text) {
  const selection = window.getSelection();
  selection?.setBaseAndExtent(firstText, 0, lastText, lastText.length);
}

describe("installSelectionDragClamp", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("指针始终在滚动区内时不改写选区", () => {
    const frames = useManualFrames();
    try {
      const { element, firstText, lastText } = setupStream();
      const dispose = installSelectionDragClamp({
        element,
        resolveCaret: createCaretStub(firstText, lastText),
      });

      pressAndDragTo(element, { x: 200, y: 180 });
      simulateKernelEscape(firstText, lastText);
      frames.flush();

      // 未被改写：仍是内核写入的整段范围。
      expect(window.getSelection()?.anchorNode).toBe(firstText);
      expect(window.getSelection()?.focusNode).toBe(lastText);
      dispose();
    } finally {
      frames.restore();
    }
  });

  it("指针越出滚动区上方时把端点贴回顶部可见行", () => {
    const frames = useManualFrames();
    try {
      const { element, firstText, lastText } = setupStream();
      const dispose = installSelectionDragClamp({
        element,
        resolveCaret: createCaretStub(firstText, lastText),
      });

      pressAndDragTo(element, { x: 200, y: 40 });
      simulateKernelEscape(firstText, lastText);
      frames.flush();

      // 按下点在末行、指针越过顶部 → 选区应是「按下点 → 顶部可见行」，而不是整段。
      expect(window.getSelection()?.anchorNode).toBe(lastText);
      expect(window.getSelection()?.anchorOffset).toBe(0);
      expect(window.getSelection()?.focusNode).toBe(firstText);
      expect(window.getSelection()?.focusOffset).toBe(0);
      dispose();
    } finally {
      frames.restore();
    }
  });

  it("mouseup 后内核改写选区时连拍修正，收敛到可见范围", () => {
    const frames = useManualFrames();
    try {
      const { element, firstText, lastText } = setupStream();
      const dispose = installSelectionDragClamp({
        element,
        resolveCaret: createCaretStub(firstText, lastText),
      });

      pressAndDragTo(element, { x: 200, y: 40 });
      window.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, button: 0 }),
      );
      // 内核在 mouseup 的默认行为里再次写入整段选区。
      simulateKernelEscape(firstText, lastText);
      frames.flush();

      expect(window.getSelection()?.anchorNode).toBe(lastText);
      expect(window.getSelection()?.focusNode).toBe(firstText);
      expect(window.getSelection()?.focusOffset).toBe(0);
      dispose();
    } finally {
      frames.restore();
    }
  });

  it("指针落在容器 padding 内（命中不到文本）时按内容盒下沿修正", () => {
    const frames = useManualFrames();
    try {
      // 底部 padding 18px：指针停在 padding 上时内核会把端点夹到容器起点，
      // 于是「选底部结论」变成「选整段会话」。
      const { element, headText, visibleText } = setupPaddedStream();
      const dispose = installSelectionDragClamp({
        element,
        resolveCaret: () => ({ node: visibleText as Node, offset: 0 }),
      });

      // 在可见内容上按下，再把指针拖进容器底部 padding。
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 200,
          clientY: 250,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 1,
          clientX: 200,
          clientY: 295,
        }),
      );
      simulateKernelEscape(headText, visibleText);
      frames.flush();

      expect(window.getSelection()?.anchorNode).toBe(visibleText);
      expect(window.getSelection()?.focusNode).toBe(visibleText);
      dispose();
    } finally {
      frames.restore();
    }
  });

  it("命中测试退化成容器起点（几何在可见区外）时回退到最近有效端点", () => {
    const frames = useManualFrames();
    const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;
    try {
      const { element, firstText, lastText } = setupStream();
      // 首行文本几何落在可见区上方：模拟内核把端点夹到容器起点后的命中结果。
      Range.prototype.getBoundingClientRect = function getBoundingClientRect(
        this: Range,
      ) {
        const top = this.startContainer === firstText ? 0 : 250;
        return {
          top,
          right: 400,
          bottom: top + 18,
          left: 0,
          width: 400,
          height: 18,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      };

      const dispose = installSelectionDragClamp({
        element,
        resolveCaret: createCaretStub(firstText, lastText),
      });
      pressAndDragTo(element, { x: 200, y: 40 });
      simulateKernelEscape(firstText, lastText);
      frames.flush();

      expect(window.getSelection()?.anchorNode).not.toBe(firstText);
      expect(window.getSelection()?.focusNode).not.toBe(firstText);
      dispose();
    } finally {
      Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      frames.restore();
    }
  });
});
