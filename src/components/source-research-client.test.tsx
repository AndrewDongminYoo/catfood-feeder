// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceResearchClient } from "./source-research-client";

const sourceUrl = "https://manufacturer.example/products/ocean-cat";
const transcript = "Crude Protein 32%\nCrude Fat 18%";
const draftResponse = {
  foods: [
    {
      brands: { name: "Example Brand" },
      food_sources: [
        {
          captured_at: "2026-07-24T01:23:45.000Z",
          captured_text: transcript,
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

describe("SourceResearchClient transcript preview", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(draftResponse))),
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
});
