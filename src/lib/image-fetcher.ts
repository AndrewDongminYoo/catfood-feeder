import { createHash } from "node:crypto";
import type { Dispatcher } from "undici";
import {
  cancelResponseBody,
  createPinnedDispatcher,
  isUnsafeAddress,
  readResponseBody,
  REQUEST_TIMEOUT_MS,
  resolveAddresses,
  resolvePublicHostname,
} from "./source-fetcher";

/**
 * 상세페이지 이미지 한 장을 받아 온다.
 *
 * 텍스트 수집(`source-fetcher.ts`)과 같은 이유로 가드가 먼저다: 서버가 임의의 URL을
 * 바이트로 받는 자리이므로, 형식과 크기를 확인하기 전에는 아무것도 신뢰하지 않는다.
 * SSRF 가드(DNS 해석, 사설/루프백/링크로컬 차단, 리다이렉트 재검증, 스트리밍 상한,
 * 타임아웃)는 `source-fetcher.ts`가 이미 푼 문제라 그대로 재사용한다 — 여기서 다시
 * 구현하지 않는다.
 * 라벨 이미지는 본문 텍스트보다 훨씬 크다 — 캐츠랑의 상세 이미지는 10.9 MB,
 * 1000 × 34288 px 였다(실측 2026-08-10). 상한을 그보다 낮게 잡으면 첫 실제 이미지부터
 * 거부된다.
 */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

const MAX_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ImageCaptureFailureCode =
  | "http_error"
  | "invalid_url"
  | "network_error"
  | "redirect_limit"
  | "response_too_large"
  | "unsafe_destination"
  | "unsupported_content_type";

export type ImageCaptureResult =
  | {
      readonly kind: "success";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly contentHash: string;
    }
  | { readonly kind: "failure"; readonly code: ImageCaptureFailureCode };

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

export async function captureImage(url: string): Promise<ImageCaptureResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(url);
  } catch {
    return { kind: "failure", code: "invalid_url" };
  }
  if (currentUrl.protocol !== "https:") {
    return { kind: "failure", code: "invalid_url" };
  }

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const addresses = await resolveAddresses(
      currentUrl.hostname,
      resolvePublicHostname,
    );
    if (addresses === null || addresses.some(isUnsafeAddress)) {
      return { kind: "failure", code: "unsafe_destination" };
    }

    const dispatcher = createPinnedDispatcher(currentUrl.hostname, addresses);
    try {
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          // Node의 fetch가 사용하는 undici 전용 옵션이다.
          dispatcher,
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        } as RequestInit & { dispatcher: Dispatcher });
      } catch {
        return { kind: "failure", code: "network_error" };
      }

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        await cancelResponseBody(response);
        if (!location) return { kind: "failure", code: "http_error" };
        if (redirectCount === MAX_REDIRECTS) {
          return { kind: "failure", code: "redirect_limit" };
        }

        const redirected = new URL(location, currentUrl);
        if (redirected.protocol !== "https:") {
          return { kind: "failure", code: "unsafe_destination" };
        }
        currentUrl = redirected;
        continue;
      }

      if (!response.ok) {
        await cancelResponseBody(response);
        return { kind: "failure", code: "http_error" };
      }

      const contentType = (response.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        await cancelResponseBody(response);
        return { kind: "failure", code: "unsupported_content_type" };
      }

      const bytes = await readResponseBody(response, MAX_IMAGE_BYTES);
      if (bytes === null)
        return { kind: "failure", code: "response_too_large" };

      return {
        kind: "success",
        bytes,
        contentType,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      };
    } finally {
      await dispatcher.close();
    }
  }

  return { kind: "failure", code: "redirect_limit" };
}
