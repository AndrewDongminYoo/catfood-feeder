// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelTranscribeClient } from "./label-transcribe-client";
import type { PendingTranscript } from "@/lib/label-transcripts";

const item: PendingTranscript = {
  brandName: "테스트 브랜드",
  dataVerifiedAt: null,
  foodId: 42,
  imageUrls: [],
  ingredientDraft: null,
  productName: "테스트 제품",
  productPageUrl: "https://example.com/product",
  runId: 501,
  sourceKind: "kr_label",
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

  it("원재료만 있는 제안은 등록한 출처에 원재료를 적용한 뒤 run을 닫는다", async () => {
    const ingredientItem = {
      ...item,
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
      sourceKind: "manufacturer",
      values: [],
    } as PendingTranscript;
    const requests: { body?: string; method?: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        requests.push({
          body: typeof init?.body === "string" ? init.body : undefined,
          method: init?.method,
          path,
        });
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 2, status: "applied" } }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          return new Response(
            JSON.stringify({ transcripts: [ingredientItem] }),
          );
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[ingredientItem]} />);

    expect(
      (
        screen.getByRole("textbox", {
          name: "원재료 원문",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Chicken meal; Salmon meal.");
    expect(
      (
        screen.getByRole("textbox", {
          name: "원재료 목록 (한 줄에 하나)",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Chicken meal\nSalmon meal");

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain(`✓ ${item.productName}`);
    const sourceRequest = requests.find(({ path }) =>
      path.endsWith("/sources"),
    );
    expect(JSON.parse(sourceRequest?.body ?? "null")).toMatchObject({
      kind: "manufacturer",
    });
    const ingredientRequest = requests.find(({ path }) =>
      path.endsWith("/sources/ingredients"),
    );
    expect(JSON.parse(ingredientRequest?.body ?? "null")).toEqual({
      excerpt: "Chicken meal; Salmon meal.",
      ingredients: [
        { name: "Chicken meal", position: 1 },
        { name: "Salmon meal", position: 2 },
      ],
      sourceId: 99,
    });
    expect(
      requests.some(
        ({ method, path }) =>
          method === "POST" && path.endsWith("/sources/apply"),
      ),
    ).toBe(false);
    expect(
      requests.some(
        ({ method, path }) =>
          method === "PATCH" && path.endsWith("/transcripts/501"),
      ),
    ).toBe(true);
  });

  it("원재료 제안이 충돌하면 실제 결과를 알리고 run을 열어 둔다", async () => {
    const ingredientItem = {
      ...item,
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
      values: [],
    } as PendingTranscript;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        requests.push(path);
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 0, status: "conflict" } }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[ingredientItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("원재료 충돌");
    expect(status.textContent).toContain("출처 #99");
    expect(requests.some((path) => path.endsWith("/transcripts/501"))).toBe(
      false,
    );
  });

  it("출처 종류를 승인 전에 바꾸면 등록 요청에 반영한다", async () => {
    const requests: { body?: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        requests.push({
          body: typeof init?.body === "string" ? init.body : undefined,
          path,
        });
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
          return new Response(JSON.stringify({ transcripts: [item] }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[item]} />);

    const sourceKind = screen.getByRole("combobox", { name: "출처 종류" });
    expect((sourceKind as HTMLSelectElement).value).toBe("kr_label");
    fireEvent.change(sourceKind, { target: { value: "manufacturer" } });
    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    await screen.findByRole("status");
    const sourceRequest = requests.find(({ path }) =>
      path.endsWith("/sources"),
    );
    expect(JSON.parse(sourceRequest?.body ?? "null")).toMatchObject({
      kind: "manufacturer",
    });
  });

  it("수정한 원재료 원문과 목록을 적용 요청에 반영한다", async () => {
    const ingredientItem = {
      ...item,
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
      sourceKind: "manufacturer",
      transcript: "Ingredients: Chicken meal; Salmon meal.",
      values: [],
    } as PendingTranscript;
    const requests: { body?: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        requests.push({
          body: typeof init?.body === "string" ? init.body : undefined,
          path,
        });
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 2, status: "applied" } }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          return new Response(
            JSON.stringify({ transcripts: [ingredientItem] }),
          );
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[ingredientItem]} />);

    fireEvent.change(screen.getByRole("textbox", { name: "원재료 원문" }), {
      target: { value: "Chicken; Tuna." },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "원재료 목록 (한 줄에 하나)" }),
      { target: { value: "Chicken\n\n Tuna " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    await screen.findByRole("status");
    const sourceRequest = requests.find(({ path }) =>
      path.endsWith("/sources"),
    );
    expect(JSON.parse(sourceRequest?.body ?? "null")).toMatchObject({
      capturedText: "Ingredients: Chicken; Tuna.",
    });
    const ingredientRequest = requests.find(({ path }) =>
      path.endsWith("/sources/ingredients"),
    );
    expect(JSON.parse(ingredientRequest?.body ?? "null")).toEqual({
      excerpt: "Chicken; Tuna.",
      ingredients: [
        { name: "Chicken", position: 1 },
        { name: "Tuna", position: 2 },
      ],
      sourceId: 99,
    });
  });

  it("검증된 사료의 혼합 제안은 영양소를 건너뛰고 원재료를 적용한다", async () => {
    const combinedItem = {
      ...item,
      dataVerifiedAt: "2026-09-11T00:00:00.000Z",
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
    } as PendingTranscript;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        requests.push(path);
        if (path.endsWith("/sources/apply")) {
          return new Response(JSON.stringify({ error: "근거 적용 실패" }), {
            status: 400,
          });
        }
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 2, status: "applied" } }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          return new Response(JSON.stringify({ transcripts: [combinedItem] }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[combinedItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain(`✓ ${item.productName}`);
    expect(status.textContent).toContain("원재료 적용");
    expect(status.textContent).toContain("검증된 영양소 1건 건너뜀");
    expect(requests.some((path) => path.endsWith("/sources/apply"))).toBe(
      false,
    );
    expect(requests.some((path) => path.endsWith("/sources/ingredients"))).toBe(
      true,
    );
    expect(requests.some((path) => path.endsWith("/transcripts/501"))).toBe(
      true,
    );
  });

  it("같은 URL의 현재 출처가 있으면 교체하지 않고 그 출처에 원재료를 적용한다", async () => {
    const combinedItem = {
      ...item,
      dataVerifiedAt: "2026-09-11T00:00:00.000Z",
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
      sourceKind: "manufacturer",
    } as PendingTranscript;
    const requests: { body?: string; method?: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        requests.push({
          body: typeof init?.body === "string" ? init.body : undefined,
          method: init?.method,
          path,
        });
        if (path.endsWith("/sources") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: "이미 등록된 URL" }), {
            status: 409,
          });
        }
        if (path.endsWith("/sources")) {
          return new Response(
            JSON.stringify({
              sources: [
                {
                  captured_text: "Ingredients: Chicken meal; Salmon meal.",
                  id: 77,
                  kind: "manufacturer",
                  url: item.productPageUrl,
                },
              ],
            }),
          );
        }
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 2, status: "applied" } }),
          );
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          return new Response(JSON.stringify({ transcripts: [combinedItem] }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[combinedItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("원재료 적용");
    expect(status.textContent).not.toContain("직접 정리하세요");
    const sourcePost = requests.find(
      ({ method, path }) => method === "POST" && path.endsWith("/sources"),
    );
    expect(JSON.parse(sourcePost?.body ?? "null")).not.toHaveProperty(
      "replaceExisting",
    );
    const ingredientPost = requests.find(({ path }) =>
      path.endsWith("/sources/ingredients"),
    );
    expect(JSON.parse(ingredientPost?.body ?? "null")).toMatchObject({
      sourceId: 77,
    });
  });

  it("영양소 적용 뒤 원재료 충돌은 부분 성공으로 run을 닫는다", async () => {
    const combinedItem = {
      ...item,
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
    } as PendingTranscript;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        requests.push(path);
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
              ],
            }),
          );
        }
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 0, status: "conflict" } }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          return new Response(JSON.stringify({ transcripts: [combinedItem] }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[combinedItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("영양소 적용 1");
    expect(status.textContent).toContain("원재료 충돌");
    expect(requests.some((path) => path.endsWith("/transcripts/501"))).toBe(
      true,
    );
  });

  it("영양소가 거절돼도 원재료가 적용되면 부분 성공으로 run을 닫는다", async () => {
    const combinedItem = {
      ...item,
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
    } as PendingTranscript;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        requests.push(path);
        if (path.endsWith("/sources/apply")) {
          return new Response(
            JSON.stringify({ error: "근거가 검증을 통과하지 못했습니다." }),
            { status: 400 },
          );
        }
        if (path.endsWith("/sources/ingredients")) {
          return new Response(
            JSON.stringify({ result: { count: 2, status: "applied" } }),
          );
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        if (path.endsWith("/transcripts/501")) {
          return new Response(JSON.stringify({}));
        }
        if (path.endsWith("/transcripts")) {
          return new Response(JSON.stringify({ transcripts: [combinedItem] }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[combinedItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("원재료 적용");
    expect(status.textContent).toContain("영양소 실패");
    expect(requests.some((path) => path.endsWith("/sources/ingredients"))).toBe(
      true,
    );
    expect(requests.some((path) => path.endsWith("/transcripts/501"))).toBe(
      true,
    );
  });

  it("영양소와 원재료 적용이 모두 실패하면 두 원인을 모두 알린다", async () => {
    const combinedItem = {
      ...item,
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
    } as PendingTranscript;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        requests.push(path);
        if (path.endsWith("/sources/apply")) {
          return new Response(JSON.stringify({ error: "영양소 근거 거절" }), {
            status: 400,
          });
        }
        if (path.endsWith("/sources/ingredients")) {
          return new Response(JSON.stringify({ error: "원재료 적용 장애" }), {
            status: 500,
          });
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[combinedItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("영양소 근거 거절");
    expect(status.textContent).toContain("원재료 적용 장애");
    expect(status.textContent).toContain("출처 #99");
    expect(requests.some((path) => path.endsWith("/transcripts/501"))).toBe(
      false,
    );
  });

  it("검증된 혼합 제안의 원재료 실패 사유를 숨기지 않는다", async () => {
    const combinedItem = {
      ...item,
      dataVerifiedAt: "2026-09-11T00:00:00.000Z",
      ingredientDraft: {
        excerpt: "Chicken meal; Salmon meal.",
        ingredients: [
          { name: "Chicken meal", position: 1 },
          { name: "Salmon meal", position: 2 },
        ],
      },
    } as PendingTranscript;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        requests.push(path);
        if (path.endsWith("/sources/ingredients")) {
          return new Response(JSON.stringify({ error: "원재료 원문 불일치" }), {
            status: 400,
          });
        }
        if (path.endsWith("/sources")) {
          return new Response(JSON.stringify({ source: { id: 99 } }));
        }
        throw new Error(`unexpected fetch: ${path}`);
      }),
    );

    render(<LabelTranscribeClient initialTranscripts={[combinedItem]} />);

    fireEvent.click(screen.getByRole("button", { name: "승인·등록" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("원재료 원문 불일치");
    expect(status.textContent).toContain("출처 #99");
    expect(requests.some((path) => path.endsWith("/sources/apply"))).toBe(
      false,
    );
    expect(requests.some((path) => path.endsWith("/transcripts/501"))).toBe(
      false,
    );
  });
});
