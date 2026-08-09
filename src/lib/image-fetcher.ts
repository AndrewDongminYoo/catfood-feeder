import { createHash } from "node:crypto";

/**
 * 상세페이지 이미지 한 장을 받아 온다.
 *
 * 텍스트 수집(`source-fetcher.ts`)과 같은 이유로 가드가 먼저다: 서버가 임의의 URL을
 * 바이트로 받는 자리이므로, 형식과 크기를 확인하기 전에는 아무것도 신뢰하지 않는다.
 * 라벨 이미지는 본문 텍스트보다 훨씬 크다 — 캐츠랑의 상세 이미지는 10.9 MB,
 * 1000 × 34288 px 였다(실측 2026-08-10). 상한을 그보다 낮게 잡으면 첫 실제 이미지부터
 * 거부된다.
 */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ImageCaptureFailureCode =
  | "invalid_url"
  | "http_error"
  | "network_error"
  | "unsupported_content_type"
  | "response_too_large";

export type ImageCaptureResult =
  | {
      readonly kind: "success";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly contentHash: string;
    }
  | { readonly kind: "failure"; readonly code: ImageCaptureFailureCode };

export async function captureImage(url: string): Promise<ImageCaptureResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "failure", code: "invalid_url" };
  }
  if (parsed.protocol !== "https:") {
    return { kind: "failure", code: "invalid_url" };
  }

  let response: Response;
  try {
    response = await fetch(parsed, { redirect: "follow" });
  } catch {
    return { kind: "failure", code: "network_error" };
  }
  if (!response.ok) return { kind: "failure", code: "http_error" };

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return { kind: "failure", code: "unsupported_content_type" };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { kind: "failure", code: "response_too_large" };
  }

  return {
    kind: "success",
    bytes,
    contentType,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
