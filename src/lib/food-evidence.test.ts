import { describe, expect, it, vi } from "vitest";
import { loadFoodEvidence } from "./catalog";

function clientReturning(data: unknown, error: unknown = null) {
  const eqSecond = vi.fn().mockResolvedValue({ data, error });
  const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
  const select = vi.fn().mockReturnValue({ eq: eqFirst });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select };
}

describe("loadFoodEvidence", () => {
  it("requests only the granted columns of the embedded source", async () => {
    const { client, from, select } = clientReturning([]);
    await loadFoodEvidence(client, 95);
    expect(from).toHaveBeenCalledWith("food_nutrient_evidence");
    const requested = select.mock.calls[0]?.[0] as string;
    expect(requested).toContain(
      "food_sources!inner(url, kind, capture_method)",
    );
    expect(requested).not.toContain("*");
    expect(requested).not.toContain("captured_text");
  });

  it("flattens the embedded source onto each evidence row", async () => {
    const { client } = clientReturning([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        food_sources: {
          capture_method: "fetch",
          kind: "manufacturer",
          url: "https://example.test/label",
        },
        nutrient_key: "protein_pct",
        value: 36,
      },
    ]);

    await expect(loadFoodEvidence(client, 95)).resolves.toEqual([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        nutrient_key: "protein_pct",
        source: {
          capture_method: "fetch",
          kind: "manufacturer",
          url: "https://example.test/label",
        },
        value: 36,
      },
    ]);
  });

  it("throws when the query errors so the caller can degrade deliberately", async () => {
    const { client } = clientReturning(null, { message: "permission denied" });
    await expect(loadFoodEvidence(client, 95)).rejects.toBeTruthy();
  });
});
