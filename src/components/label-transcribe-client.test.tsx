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

  // apply RPC는 사료가 이미 다른 출처 종류의 현재값을 갖고 있으면 그 영양소를
  // skipped로 건너뛴다 — 9개 부분값 사료(ANF·퓨어네이쳐 등)에서 이게 흔한
  // 200 응답이다. 전부 skipped면 아무것도 저장되지 않았으니, run을 닫거나
  // 미아 출처 플래그를 지우면 안 된다.
  it("적용된 근거가 0건이면 run을 닫지 않고 미아 출처를 알린다", async () => {
    const patchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/sources/apply")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  excerpt: "조단백질 32% 이상",
                  nutrientKey: "protein_pct",
                  sourceId: 99,
                  status: "skipped",
                  value: 32,
                },
              ],
            }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (init?.method === "PATCH") patchCalls.push(path);
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("출처 #99");
    expect(status.textContent).toContain("적용된 근거가 없습니다");
    expect(patchCalls).toHaveLength(0);
  });

  // 부분 적용(일부는 applied, 일부는 skipped/conflict)은 근거가 최소 하나는
  // 붙었으니 run을 닫아도 되지만, 무엇이 빠졌는지는 알려야 한다 — 맹목적인
  // 체크 표시는 나머지가 조용히 비었다는 사실을 감춘다.
  it("일부만 적용되면 run은 닫되 몇 건이 빠졌는지 알린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/sources/apply")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  excerpt: "조단백질 32% 이상",
                  nutrientKey: "protein_pct",
                  sourceId: 99,
                  status: "applied",
                  value: 32,
                },
                {
                  excerpt: "조지방 10%",
                  nutrientKey: "fat_pct",
                  sourceId: 99,
                  status: "skipped",
                  value: 10,
                },
              ],
            }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          // 로그 패널은 items가 비면 통째로 숨는다(이 컴포넌트의 기존 동작이라
          // 이 픽스 범위 밖이다) — 목록에 다른 대기 항목이 남아 있다고 가정해
          // 방금 로그를 계속 볼 수 있게 한다.
          return new Response(JSON.stringify({ transcripts: [item] }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(
      <LabelTranscribeClient
        initialTranscripts={[
          {
            ...item,
            values: [
              ...item.values,
              { excerpt: "조지방 10%", nutrientKey: "fat_pct", value: 10 },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("적용 1");
    expect(status.textContent).not.toBe(`✓ ${item.productName}`);
  });
});
