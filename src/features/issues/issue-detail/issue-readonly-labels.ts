export interface ReadOnlyDetailLabel {
  name: string;
  color: string | null;
}

function visibleName(name: string): string {
  return name.trim();
}

function configuredColor(color: string | null | undefined): string | null {
  const next = color?.trim() ?? "";
  return next.length === 0 ? null : next;
}

export function readOnlyDetailLabels(input: {
  issueLabels: ReadonlyArray<{
    name: string;
    color: string | null | undefined;
  }>;
  hostLabels: readonly string[];
  catalog: ReadonlyArray<{ name: string; color: string | null | undefined }>;
}): ReadOnlyDetailLabel[] {
  const seen = new Set<string>();
  const labels: ReadOnlyDetailLabel[] = [];
  const catalogColors = new Map<string, string | null>();

  for (const label of input.catalog) {
    const key = visibleName(label.name).toLowerCase();
    if (key.length === 0 || catalogColors.has(key)) {
      continue;
    }
    catalogColors.set(key, configuredColor(label.color));
  }

  function add(name: string, color: string | null): void {
    const nextName = visibleName(name);
    const key = nextName.toLowerCase();
    if (nextName.length === 0 || seen.has(key)) {
      return;
    }
    seen.add(key);
    labels.push({ name: nextName, color });
  }

  for (const label of input.issueLabels) {
    add(label.name, configuredColor(label.color));
  }
  for (const hostLabel of input.hostLabels) {
    const key = visibleName(hostLabel).toLowerCase();
    add(hostLabel, catalogColors.get(key) ?? null);
  }

  return labels;
}
