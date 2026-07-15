import { createHash } from "node:crypto";

export const SOURCE_KIND_VALUES = ["manufacturer", "kr_label"] as const;
export type SourceKind = (typeof SOURCE_KIND_VALUES)[number];

export const SOURCE_CAPTURE_METHOD_VALUES = ["fetch", "manual"] as const;
export type SourceCaptureMethod = (typeof SOURCE_CAPTURE_METHOD_VALUES)[number];

export const SOURCE_FETCH_STATUS_VALUES = ["fetched", "failed"] as const;
export type SourceFetchStatus = (typeof SOURCE_FETCH_STATUS_VALUES)[number];

export function normalizeSourceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function hashSourceText(value: string): string {
  return createHash("sha256").update(normalizeSourceText(value)).digest("hex");
}

export function isEvidenceExcerpt(
  sourceText: string,
  excerpt: string,
): boolean {
  const normalizedExcerpt = normalizeSourceText(excerpt);
  return (
    normalizedExcerpt.length > 0 &&
    normalizeSourceText(sourceText).includes(normalizedExcerpt)
  );
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
