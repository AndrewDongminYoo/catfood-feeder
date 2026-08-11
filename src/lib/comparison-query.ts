export function parseComparisonIds(ids: string | undefined): number[] {
  const selectedIds = new Set<number>();

  for (const value of (ids ?? "").split(",")) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const id = Number(trimmed);
    if (!Number.isSafeInteger(id) || id < 0 || selectedIds.has(id)) continue;

    selectedIds.add(id);
    if (selectedIds.size === 2) break;
  }

  return [...selectedIds];
}
