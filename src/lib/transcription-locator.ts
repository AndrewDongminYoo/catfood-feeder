export function normalizeVisionSliceName(sliceName: string): string {
  const match = /(?:^|-)t(\d+)(?:-small)?(?:\.[^.]+)?$/i.exec(sliceName);
  return match ? `t${match[1].padStart(2, "0")}` : sliceName;
}
