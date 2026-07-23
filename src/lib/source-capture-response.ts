import { z } from "zod";

export const SOURCE_CONTENT_STATUS_VALUES = [
  "initial",
  "unchanged",
  "changed",
] as const;

export type SourceContentStatus = (typeof SOURCE_CONTENT_STATUS_VALUES)[number];

export type SourceReplacementResult = Readonly<{
  contentStatus: SourceContentStatus;
  sourceId: number;
}>;

const sourceReplacementRowsSchema = z
  .array(
    z
      .object({
        content_status: z.enum(SOURCE_CONTENT_STATUS_VALUES),
        source_id: z.number().int().positive(),
      })
      .strict(),
  )
  .length(1);

export const sourceCaptureResponseSchema = z
  .object({
    contentStatus: z.enum(SOURCE_CONTENT_STATUS_VALUES),
    source: z
      .object({
        capturedAt: z.string().datetime(),
        capturedText: z.string().min(1),
        contentHash: z.string().length(64),
        id: z.number().int().positive(),
        kind: z.enum(["manufacturer", "kr_label"]),
        observedAt: z.string().datetime().nullable(),
        url: z.string().url(),
      })
      .strict(),
  })
  .strict();

export function parseSourceReplacementResult(
  value: unknown,
): SourceReplacementResult {
  const [result] = sourceReplacementRowsSchema.parse(value);
  return {
    contentStatus: result.content_status,
    sourceId: result.source_id,
  };
}

export function sourceCaptureTone(
  status: SourceContentStatus,
): "success" | "warning" {
  return status === "changed" ? "warning" : "success";
}

export function sourceCaptureStatusMessage(
  status: SourceContentStatus,
): string {
  switch (status) {
    case "initial":
      return "출처를 수집했습니다.";
    case "unchanged":
      return "이전 수집본과 출처 내용이 같습니다.";
    case "changed":
      return "출처 내용이 변경되었습니다. 추출 후 근거를 검토하세요.";
  }
}
