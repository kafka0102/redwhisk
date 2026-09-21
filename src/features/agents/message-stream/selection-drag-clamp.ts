// 消息流拖拽选择越界修正。
//
// 背景（issue #237）：消息流是内嵌滚动容器，单个 session 可能很长。拖拽选择时若
// 指针落到「命中不到文本」的位置——滚动容器自己的 padding、或容器之外的相邻区域
// （上方 session tab 栏），浏览器内核对选区端点的命中测试会退化成「滚动容器内容的
// 起点」：容器本身没滚动，选区却覆盖整段会话。实测 808 条、28 万字符的会话里，
// 把终点拖到容器底部 padding（约 18px 高的一条带）就会选中 28 万字符
// （ENTRY-000..ENTRY-807 全中），复制到的内容远多于看到的高亮。
//
// 修正方式：拖拽起点在滚动区内时，一旦指针落到「命中不到文本」的位置（内容盒之外、
// 容器 padding、或容器里没有文本的空区）就接管选区端点——把指针位置夹回内容盒边缘，
// 用命中测试取该处真实可见的文本位置，重建选区。指针始终落在文本内容上时不介入，
// 保持浏览器原生选择行为；因此本模块只影响这一失效路径。

/** 视口坐标点（与 MouseEvent.clientX/clientY 同坐标系）。 */
export interface SelectionPointerPoint {
  x: number;
  y: number;
}

/** 与 DOMRect 兼容的矩形，仅取本模块需要的字段，便于单测构造。 */
export interface SelectionClampRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 文本位置。 */
export interface CaretPoint {
  node: Node;
  offset: number;
}

/** 判断「指针是否已在内容盒内」的退让量。 */
const EDGE_INSET_PX = 1;

/**
 * 取边缘文本位置时的退让量。只退 1px 会踩在内容盒边界上：亚像素布局下内核可能仍把
 * 该点判成 padding（命中不到文本 → 端点夹到容器起点），所以按行高取 6px 落在边缘那一
 * 行文本中间。数组按由浅到深依次尝试。
 */
const CARET_INSET_STEPS_PX = [6, 12, 24] as const;

/**
 * 指针在矩形内返回 null（交给浏览器原生选择），在矩形外返回夹到矩形内的点。
 */
export function clampPointIntoRect(
  point: SelectionPointerPoint,
  rect: SelectionClampRect,
  insetPx: number = EDGE_INSET_PX,
): SelectionPointerPoint | null {
  const inside =
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom;
  if (inside) {
    return null;
  }

  return {
    x: Math.min(Math.max(point.x, rect.left + insetPx), rect.right - insetPx),
    y: Math.min(Math.max(point.y, rect.top + insetPx), rect.bottom - insetPx),
  };
}

/**
 * 取元素的内容盒（border box 去掉 padding）。
 *
 * 必须用内容盒而不是 border box：指针停在滚动容器的 padding 上时命中不到任何文本，
 * 内核会把端点夹到容器起点——正是本模块要修的失效路径。
 */
export function resolveContentRect(element: HTMLElement): SelectionClampRect {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const paddingTop = Number.parseFloat(style?.paddingTop ?? "0") || 0;
  const paddingRight = Number.parseFloat(style?.paddingRight ?? "0") || 0;
  const paddingBottom = Number.parseFloat(style?.paddingBottom ?? "0") || 0;
  const paddingLeft = Number.parseFloat(style?.paddingLeft ?? "0") || 0;

  return {
    top: rect.top + paddingTop,
    right: rect.right - paddingRight,
    bottom: rect.bottom - paddingBottom,
    left: rect.left + paddingLeft,
  };
}

/**
 * 命中点是否仍落在可见内容里（纵向相交即可）。
 *
 * 内核在命中不到文本时会把端点夹到容器起点，那种端点可能落在首条消息的文本上——只
 * 校验「是不是容器内的文本节点」区分不出来，还得看几何位置是否还在可见区内。几何
 * 信息不可用（全 0，如 jsdom）时退化为「按包含关系判断」，由调用方先做节点校验。
 */
export function isCaretInsideVisibleContent(
  caretBox: SelectionClampRect,
  contentRect: SelectionClampRect,
): boolean {
  const geometryUnavailable =
    caretBox.top === 0 &&
    caretBox.bottom === 0 &&
    caretBox.left === 0 &&
    caretBox.right === 0;
  if (geometryUnavailable) {
    return true;
  }

  return (
    caretBox.bottom >= contentRect.top && caretBox.top <= contentRect.bottom
  );
}

/** 浏览器命中测试 API：WebKit 只提供 `caretRangeFromPoint`，标准为 `caretPositionFromPoint`。 */
interface CaretPointSource {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/**
 * 命中测试：优先标准 `caretPositionFromPoint`，回退 WebKit 的 `caretRangeFromPoint`。
 */
export function resolveCaretPoint(
  document: Document,
  point: SelectionPointerPoint,
): CaretPoint | null {
  const caretDocument = document as unknown as CaretPointSource;
  const position = caretDocument.caretPositionFromPoint?.(point.x, point.y);
  if (position) {
    return { node: position.offsetNode, offset: position.offset };
  }

  const range = caretDocument.caretRangeFromPoint?.(point.x, point.y);
  if (range) {
    return { node: range.startContainer, offset: range.startOffset };
  }

  return null;
}

interface DragState {
  /** 按下时的文本位置：越界修正后选区的固定端点。 */
  base: CaretPoint | null;
  /** 最近一次指针位置（clientX/clientY）。 */
  pointer: SelectionPointerPoint;
  /** 指针是否已越出滚动区；一旦越界，本次拖拽余下过程都由本模块接管端点。 */
  engaged: boolean;
  /** 最近一次成功落定的文本位置，用于命中测试失败时兜底（避免回退到容器起点）。 */
  lastCaret: CaretPoint | null;
}

/**
 * mouseup 后连拍修正的帧预算。
 *
 * 内核在 mouseup 时会把自己夹到容器首/末行的端点写回选区，还可能顺手把该端点滚进
 * 视野（容器瞬移一段距离），单次修正会被这次瞬移带偏。连拍若干帧直到选区不再被改写
 * 即可收敛，同时避免留下长期运行的循环。
 */
const SETTLE_FRAME_BUDGET = 30;

export interface SelectionDragClampOptions {
  /** 消息流滚动容器。 */
  element: HTMLElement;
  /** 命中测试实现，默认走浏览器原生 API；单测注入桩实现。 */
  resolveCaret?: (
    document: Document,
    point: SelectionPointerPoint,
  ) => CaretPoint | null;
}

/**
 * 在滚动容器上安装越界拖拽修正，返回卸载函数。
 */
export function installSelectionDragClamp({
  element,
  resolveCaret = resolveCaretPoint,
}: SelectionDragClampOptions): () => void {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) {
    return () => {};
  }
  // 显式非空别名：TS 不会把上面这层收窄带进闭包。
  const ownerWindow: Window = view;

  let state: DragState | null = null;
  let frameId: number | null = null;
  let settleFrameId: number | null = null;

  /** 指针是否落在消息流的文本内容上（命中到容器的后代元素，而非容器本身）。 */
  function isPointerOnContent(point: SelectionPointerPoint): boolean {
    const elementFromPoint = document.elementFromPoint?.bind(document);
    if (!elementFromPoint) {
      // 环境不提供命中测试（如 jsdom）时只按几何判断。
      return true;
    }
    const hit = elementFromPoint(point.x, point.y);
    return hit !== null && hit !== element && element.contains(hit);
  }

  /** 把指针对应的「边缘可见文本位置」写回选区；返回是否真的改写了选区。 */
  function applyClamp(target: DragState): boolean {
    const rect = resolveContentRect(element);
    const caret = resolveClampedCaret(target, rect);
    if (!caret) {
      return false;
    }
    target.lastCaret = caret;
    const base = target.base ?? caret;
    const selection = document.getSelection();
    if (!selection) {
      return false;
    }

    if (selection.rangeCount === 1) {
      const range = selection.getRangeAt(0);
      const alreadyApplied =
        range.startContainer === base.node &&
        range.startOffset === base.offset &&
        range.endContainer === caret.node &&
        range.endOffset === caret.offset;
      if (alreadyApplied) {
        return false;
      }
    }

    try {
      selection.setBaseAndExtent(
        base.node,
        base.offset,
        caret.node,
        caret.offset,
      );
      return true;
    } catch {
      // 命中点位于不可设置的边界（如容器本身）时放弃本次修正，保留原生行为。
      return false;
    }
  }

  /**
   * 取夹取点上的文本位置。
   *
   * 指针在内容盒外时按由浅到深的退让量重试，直到命中测试返回「容器内的文本节点」——
   * 内核在命中不到文本时会返回容器起点（可能是容器首条消息里的文本），命中点的几何
   * 位置必须仍落在可见内容里才算有效。全部失败时退回本次拖拽最近一次落定的文本位置，
   * 绝不使用被夹到容器起点的端点。
   */
  function resolveClampedCaret(
    target: DragState,
    rect: SelectionClampRect,
  ): CaretPoint | null {
    for (const insetPx of CARET_INSET_STEPS_PX) {
      const point =
        clampPointIntoRect(target.pointer, rect, insetPx) ?? target.pointer;
      const caret = resolveCaret(document, point);
      if (caret && isCaretUsable(caret, rect)) {
        return caret;
      }
    }

    return target.lastCaret ?? target.base;
  }

  /** 命中测试必须落在容器内、且几何位置仍在可见内容里的文本上。 */
  function isCaretUsable(caret: CaretPoint, rect: SelectionClampRect): boolean {
    if (
      caret.node.nodeType !== Node.TEXT_NODE ||
      !element.contains(caret.node)
    ) {
      return false;
    }
    const caretBox = caretBoxOf(caret);
    if (!caretBox) {
      return true;
    }
    return isCaretInsideVisibleContent(caretBox, rect);
  }

  /** 取某个文本位置的几何盒子；无法构造（偏移越界等）时返回 null。 */
  function caretBoxOf(caret: CaretPoint): SelectionClampRect | null {
    try {
      const range = document.createRange();
      range.setStart(caret.node, caret.offset);
      range.collapse(true);
      const box = range.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
      };
    } catch {
      return null;
    }
  }

  function scheduleClamp(): void {
    const target = state;
    if (!target || !target.engaged || frameId !== null) {
      return;
    }
    frameId = ownerWindow.requestAnimationFrame(() => {
      frameId = null;
      if (state === target) {
        applyClamp(target);
        // 内核可能在同一次事件处理里稍后才写回自己被夹的端点（拖拽期间的默认行为），
        // 所以拖拽未结束时逐帧续订，保证最终留下的是修正后的端点。
        scheduleClamp();
      }
    });
  }

  function handleMouseMove(event: MouseEvent): void {
    const target = state;
    if (!target) {
      return;
    }

    if (event.buttons === 0) {
      detach();
      return;
    }

    target.pointer = { x: event.clientX, y: event.clientY };
    if (!target.engaged) {
      const rect = resolveContentRect(element);
      const insideContent =
        clampPointIntoRect(target.pointer, rect) === null &&
        isPointerOnContent(target.pointer);
      if (insideContent) {
        return;
      }
      target.engaged = true;
    }
    scheduleClamp();
  }

  function handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || state !== null) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || !element.contains(target)) {
      return;
    }

    state = {
      base: resolveCaret(document, { x: event.clientX, y: event.clientY }),
      pointer: { x: event.clientX, y: event.clientY },
      engaged: false,
      lastCaret: null,
    };
    ownerWindow.addEventListener("mousemove", handleMouseMove, true);
    ownerWindow.addEventListener("mouseup", handleMouseUp, true);
    ownerWindow.addEventListener("blur", handleWindowBlur);
    element.addEventListener("scroll", scheduleClamp);
  }

  function handleMouseUp(): void {
    const target = state;
    detach();
    if (target?.engaged) {
      // mouseup 的内核默认行为会再次把端点写回容器内容起点，
      // 不补这一轮的话，用户紧接着复制拿到的仍是整段会话。
      settle(target, SETTLE_FRAME_BUDGET);
    }
  }

  function settle(target: DragState, remainingFrames: number): void {
    if (settleFrameId !== null) {
      return;
    }
    settleFrameId = ownerWindow.requestAnimationFrame(() => {
      settleFrameId = null;
      const changed = applyClamp(target);
      if (changed && remainingFrames > 1) {
        settle(target, remainingFrames - 1);
      }
    });
  }

  function handleWindowBlur(): void {
    detach();
  }

  function detach(): void {
    state = null;
    if (frameId !== null) {
      ownerWindow.cancelAnimationFrame(frameId);
      frameId = null;
    }
    ownerWindow.removeEventListener("mousemove", handleMouseMove, true);
    ownerWindow.removeEventListener("mouseup", handleMouseUp, true);
    ownerWindow.removeEventListener("blur", handleWindowBlur);
    element.removeEventListener("scroll", scheduleClamp);
  }

  element.addEventListener("mousedown", handleMouseDown);

  return () => {
    detach();
    if (settleFrameId !== null) {
      ownerWindow.cancelAnimationFrame(settleFrameId);
      settleFrameId = null;
    }
    element.removeEventListener("mousedown", handleMouseDown);
  };
}
