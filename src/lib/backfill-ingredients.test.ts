import { describe, expect, it, vi } from "vitest";
import {
  parseBackfillArgs,
  runIngredientBackfill,
} from "../../scripts/backfill-ingredients.mjs";

describe("parseBackfillArgs", () => {
  it("keeps each food paired with its identity-matched source ids", () => {
    expect(parseBackfillArgs(["--dry-run", "22:101,38:202+203"])).toEqual({
      dryRun: true,
      targets: [
        { foodId: 22, sourceIds: [101] },
        { foodId: 38, sourceIds: [202, 203] },
      ],
    });
  });

  it("rejects food-only input instead of guessing a current source", () => {
    expect(() => parseBackfillArgs(["22,38"])).toThrow(/foodId:sourceId/);
  });

  it("rejects duplicate food and source ids", () => {
    expect(() => parseBackfillArgs(["22:101,22:102"])).toThrow(
      /사료 ID가 중복/,
    );
    expect(() => parseBackfillArgs(["22:101+101"])).toThrow(/출처 ID가 중복/);
  });
});

describe("runIngredientBackfill", () => {
  it("posts explicit sourceIds and never calls the apply route in dry-run mode", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ingredientDraft: {
            excerpt: "chicken, chicken meal, turkey",
            ingredients: [
              { name: "chicken", position: 1 },
              { name: "chicken meal", position: 2 },
              { name: "turkey", position: 3 },
            ],
            sourceId: 101,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const log = vi.fn();

    const tally = await runIngredientBackfill({
      adminSecret: "secret",
      baseUrl: "http://localhost:3000/",
      dryRun: true,
      fetchImpl,
      log,
      paceMs: 0,
      targets: [{ foodId: 22, sourceIds: [101] }],
      wait: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/foods/22/sources/extract",
      expect.objectContaining({
        body: JSON.stringify({ sourceIds: [101] }),
        method: "POST",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("chicken, chicken meal, turkey"),
    );
    expect(tally).toMatchObject({ dry_run: 1, applied: 0, refused: 0 });
  });

  it("forwards a proven draft to the apply route outside dry-run mode", async () => {
    const ingredientDraft = {
      excerpt: "chicken, chicken meal",
      ingredients: [
        { name: "chicken", position: 1 },
        { name: "chicken meal", position: 2 },
      ],
      sourceId: 101,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ingredientDraft }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: { count: 2, status: "applied" } }),
          { status: 200 },
        ),
      );

    const tally = await runIngredientBackfill({
      adminSecret: "secret",
      baseUrl: "http://localhost:3000",
      dryRun: false,
      fetchImpl,
      log: vi.fn(),
      paceMs: 0,
      targets: [{ foodId: 22, sourceIds: [101] }],
      wait: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/foods/22/sources/ingredients",
      expect.objectContaining({
        body: JSON.stringify(ingredientDraft),
        method: "POST",
      }),
    );
    expect(tally).toMatchObject({ applied: 1, failed: 0, refused: 0 });
  });

  it("counts a 429 separately and honors Retry-After", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "2" },
      }),
    );
    const wait = vi.fn();

    const tally = await runIngredientBackfill({
      adminSecret: "secret",
      baseUrl: "http://localhost:3000",
      dryRun: true,
      fetchImpl,
      log: vi.fn(),
      paceMs: 0,
      targets: [{ foodId: 22, sourceIds: [101] }],
      wait,
    });

    expect(wait).toHaveBeenCalledWith(3_000);
    expect(tally).toMatchObject({ rate_limited: 1, refused: 0 });
  });

  it("counts an extraction service failure separately from a refused draft", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Claude API 추출에 실패했습니다." }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const tally = await runIngredientBackfill({
      adminSecret: "secret",
      baseUrl: "http://localhost:3000",
      dryRun: true,
      fetchImpl,
      log: vi.fn(),
      paceMs: 0,
      targets: [{ foodId: 22, sourceIds: [101] }],
      wait: vi.fn(),
    });

    expect(tally).toMatchObject({ failed: 1, refused: 0 });
  });
});
