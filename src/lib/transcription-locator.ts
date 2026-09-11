export function normalizeVisionSliceName(sliceName: string): string {
  const fileName = sliceName.split(/[\\/]/).at(-1) ?? sliceName;
  const match = /^(?:(.+)-)?t(\d+)(?:-small)?(?:\.[^.]+)?$/i.exec(fileName);
  if (!match) return sliceName;

  const prefix = match[1] === undefined ? "" : `${match[1]}-`;
  return `${prefix}t${match[2].padStart(2, "0")}`;
}
