interface SnapshotUpdate {
  kind: "append" | "reset";
  data: string;
}

export function resolveSnapshotUpdate(
  previousSnapshot: string,
  nextSnapshot: string,
): SnapshotUpdate | null {
  if (nextSnapshot === previousSnapshot) {
    return null;
  }

  if (previousSnapshot && nextSnapshot.startsWith(previousSnapshot)) {
    return {
      kind: "append",
      data: nextSnapshot.slice(previousSnapshot.length),
    };
  }

  if (previousSnapshot && nextSnapshot.length >= previousSnapshot.length) {
    const overlapLength = findSnapshotTailOverlap(
      previousSnapshot,
      nextSnapshot,
    );
    if (overlapLength > 0) {
      return {
        kind: "append",
        data: nextSnapshot.slice(overlapLength),
      };
    }
  }

  return {
    kind: "reset",
    data: nextSnapshot,
  };
}

function findSnapshotTailOverlap(previousSnapshot: string, nextSnapshot: string) {
  const maxOverlap = Math.min(previousSnapshot.length, nextSnapshot.length);

  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (previousSnapshot.endsWith(nextSnapshot.slice(0, overlapLength))) {
      return overlapLength;
    }
  }

  return 0;
}
