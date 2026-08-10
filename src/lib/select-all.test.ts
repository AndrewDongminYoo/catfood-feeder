import { describe, expect, it } from "vitest";
import { selectAll } from "../../scripts/select-all.mjs";

/**
 * PostgREST caps a plain .select() at max_rows (1000) with no error — release-stranded.mjs
 * hit this for real when food_nutrient_evidence crossed 1501 rows. These pin the paging
 * loop offline, against canned pages, so the stop condition can't regress silently.
 */
describe("selectAll", () => {
  it("stops on a short page without an extra trailing call", async () => {
    const calls: { from: number; to: number }[] = [];
    const rows = await selectAll((from, to) => {
      calls.push({ from, to });
      return Promise.resolve({
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        error: null,
      });
    }, 5);

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls).toEqual([{ from: 0, to: 4 }]);
  });

  it("fetches the trailing empty page when the total is an exact multiple of the page size", async () => {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], []];
    const calls: { from: number; to: number }[] = [];
    const rows = await selectAll((from, to) => {
      calls.push({ from, to });
      return Promise.resolve({ data: pages.shift() ?? [], error: null });
    }, 2);

    // This is the case release-stranded.mjs actually hit: had the loop stopped as soon
    // as a page came back exactly `pageSize` long, it would have under-counted by
    // whatever sat on the never-fetched next page.
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    expect(calls).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
      { from: 4, to: 5 },
    ]);
  });

  it("returns an empty array for an empty table without looping", async () => {
    let callCount = 0;
    const rows = await selectAll(() => {
      callCount += 1;
      return Promise.resolve({ data: [], error: null });
    }, 5);

    expect(rows).toEqual([]);
    expect(callCount).toBe(1);
  });

  it("propagates a query error instead of treating it as an empty page", async () => {
    await expect(
      selectAll(
        () => Promise.resolve({ data: null, error: new Error("boom") }),
        5,
      ),
    ).rejects.toThrow("boom");
  });

  it("throws instead of under-counting when a page exceeds the requested page size", async () => {
    // A page longer than asked-for means pageSize itself exceeded PostgREST's max_rows
    // and got silently clamped server-side — the same shape of bug this helper exists
    // to prevent, just one level up. It must fail loud, not return a short result.
    await expect(
      selectAll(
        () =>
          Promise.resolve({
            data: Array.from({ length: 1500 }, (_, i) => ({ id: i })),
            error: null,
          }),
        1000,
      ),
    ).rejects.toThrow(/max_rows/);
  });
});
