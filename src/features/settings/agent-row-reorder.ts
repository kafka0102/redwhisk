export interface AgentRowReorderDrag {
  pointerId: number;
  draggedId: number;
  startOrderedIds: number[];
  lastOrderedIds: number[];
}

export function moveAgentRow(
  orderedIds: readonly number[],
  draggedId: number,
  targetId: number,
): number[] {
  if (draggedId === targetId) {
    return [...orderedIds];
  }
  const fromIndex = orderedIds.indexOf(draggedId);
  const toIndex = orderedIds.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0) {
    return [...orderedIds];
  }
  const nextIds = [...orderedIds];
  const [moved] = nextIds.splice(fromIndex, 1);
  nextIds.splice(toIndex, 0, moved);
  return nextIds;
}

export function agentRowOrderChanged(
  before: readonly number[],
  after: readonly number[],
): boolean {
  return (
    before.length !== after.length ||
    before.some((id, index) => id !== after[index])
  );
}

// 指针落点对应的行。拖动中的握柄在最上层，要穿透它才能命中目标行。
export function agentRowIdAtPoint(
  x: number,
  y: number,
  rowSelector = "[data-agent-profile-id]",
): number | null {
  const elements = document.elementsFromPoint(x, y);
  for (const element of elements) {
    if (!(element instanceof Element)) {
      continue;
    }
    const row = element.closest(rowSelector);
    if (!row) {
      continue;
    }
    const rawId = row.getAttribute("data-agent-profile-id");
    const id = Number(rawId);
    if (rawId !== null && rawId !== "" && Number.isInteger(id)) {
      return id;
    }
  }
  return null;
}
