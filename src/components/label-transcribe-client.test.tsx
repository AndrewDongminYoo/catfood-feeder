// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelTranscribeClient } from "./label-transcribe-client";
import type { PendingTranscript } from "@/lib/label-transcripts";

const item: PendingTranscript = {
  brandName: "테스트 브랜드",
  foodId: 42,
  imageUrls: [],
  productName: "테스트 제품",
  productPageUrl: "https://example.com/product",
  runId: 501,
  transcript: "조단백질 32% 이상",
  values: [
    { excerpt: "조단백질 32% 이상", nutrientKey: "protein_pct", value: 32 },
  ],
};

describe("LabelTranscribeClient 승인 실패", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // 근거 적용이 실패해도 그 앞의 출처 등록은 이미 커밋됐다. release-stranded.mjs는
  // 근거가 붙은 다른 출처가 있으면 사료를 "최신"으로 보고 이 미아 출처를 건드리지
  // 않으므로, 화면이 출처 id를 보여주지 않으면 운영자는 DB가 바뀐 것조차 모른다.
  it("근거 적용이 실패하면 등록된 출처 id를 로그에 남긴다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/sources/apply")) {
          return new Response(JSON.stringify({ error: "근거 적용 실패" }), {
            status: 400,
          });
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("출처 #99");
    expect(status.textContent).toContain("근거 적용 실패");
  });
});
