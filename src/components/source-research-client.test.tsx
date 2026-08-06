// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceResearchClient } from "./source-research-client";

const sourceUrl = "https://manufacturer.example/products/ocean-cat";
const capturedAt = "2026-07-24T01:23:45.000Z";
const transcript = "Crude Protein 32%\nCrude Fat 18%";
// Draft 목록에는 captured_text가 실리지 않는다(최대 256 KiB, 지연 로드 대상).
const draftResponse = {
  foods: [
    {
      brands: { name: "Example Brand" },
      food_sources: [
        {
          captured_at: capturedAt,
          fetch_status: "fetched",
          id: 41,
          is_current: true,
          kind: "manufacturer",
          url: sourceUrl,
        },
      ],
      id: 7,
      product_name: "Ocean Cat",
    },
  ],
};
const sourcesResponse = {
  sources: [
    {
      captured_at: capturedAt,
      captured_text: transcript,
      id: 41,
      kind: "manufacturer",
      url: sourceUrl,
    },
  ],
};

describe("SourceResearchClient transcript preview", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/sources")
          ? new Response(JSON.stringify(sourcesResponse))
          : new Response(JSON.stringify(draftResponse)),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows source metadata and transcript in a collapsed disclosure", async () => {
    render(<SourceResearchClient />);

    const summary = await screen.findByText("제조사 출처 원문");
    const details = summary.closest("details");
    const link = screen.getByRole("link", { name: sourceUrl });
    const time = document.querySelector("time");

    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect(details?.open).toBe(false);
    expect(link.getAttribute("href")).toBe(sourceUrl);
    expect(time?.getAttribute("datetime")).toBe("2026-07-24T01:23:45.000Z");
    expect(details?.querySelector("pre")?.textContent).toBe(transcript);
  });

  it("places transcript review before the extraction action", async () => {
    render(<SourceResearchClient />);

    const summary = await screen.findByText("제조사 출처 원문");
    const extractButton = screen.getByRole("button", {
      name: "수집 원문에서 추출",
    });

    expect(
      summary.compareDocumentPosition(extractButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("publishes the selected draft without resubmitting nutrient values", async () => {
    let draftLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/publish")) {
        return new Response(
          JSON.stringify({
            food: {
              id: 7,
              publishedAt: "2026-08-05T10:01:00+00:00",
              verificationMethod: "human",
            },
          }),
        );
      }
      if (path.includes("/sources")) {
        return new Response(JSON.stringify(sourcesResponse));
      }
      draftLoads += 1;
      return new Response(
        JSON.stringify(draftLoads === 1 ? draftResponse : { foods: [] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SourceResearchClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "검증 및 발행" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/foods/7/publish",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
    expect(
      await screen.findByText("근거 검증을 완료하고 카탈로그에 발행했습니다."),
    ).toBeTruthy();
  });

  it("keeps the selected draft when publication fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/publish")) {
          return new Response(JSON.stringify({ error: "근거가 부족합니다." }), {
            status: 400,
          });
        }
        return new Response(
          JSON.stringify(
            path.includes("/sources") ? sourcesResponse : draftResponse,
          ),
        );
      }),
    );
    render(<SourceResearchClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "검증 및 발행" }),
    );

    expect(await screen.findByText("근거가 부족합니다.")).toBeTruthy();
    const select = screen.getByLabelText("Draft 제품");
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("Draft selector is not a select element");
    }
    expect(select.value).toBe("7");
  });

  it("disables publication while unapplied candidates remain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/sources/extract")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  excerpt: "Crude Protein 32%",
                  nutrientKey: "protein_pct",
                  sourceId: 41,
                  value: 32,
                },
              ],
            }),
          );
        }
        return new Response(
          JSON.stringify(
            path.includes("/sources") ? sourcesResponse : draftResponse,
          ),
        );
      }),
    );
    render(<SourceResearchClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "수집 원문에서 추출" }),
    );
    await screen.findByText(/protein_pct: 32/);

    const publishButton = screen.getByRole("button", {
      name: "검증 및 발행",
    });
    if (!(publishButton instanceof HTMLButtonElement)) {
      throw new Error("Publication action is not a button");
    }
    expect(publishButton.disabled).toBe(true);
  });
});
