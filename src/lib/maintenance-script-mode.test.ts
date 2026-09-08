import { describe, expect, it } from "vitest";
import {
  findStrandedSources,
  parseReleaseStrandedArgs,
} from "../../scripts/release-stranded.mjs";
import {
  parseBrandIdentityArgs,
  updateBrandIfUnchanged,
} from "../../scripts/research-brand-identity.mjs";

function inMemoryBrandClient(live: Record<string, unknown>) {
  return {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return query;
          },
          is(column: string, value: unknown) {
            filters.push([column, value]);
            return query;
          },
          select() {
            return query;
          },
          async maybeSingle() {
            if (filters.some(([column, value]) => live[column] !== value)) {
              return { data: null, error: null };
            }
            Object.assign(live, patch);
            return { data: { id: live.id }, error: null };
          },
        };
        return query;
      },
    }),
  };
}

describe("maintenance script write mode", () => {
  it("keeps stranded-source release read-only unless --apply is explicit", () => {
    expect(parseReleaseStrandedArgs([])).toEqual({
      apply: false,
      sourceIds: [],
    });
    expect(
      parseReleaseStrandedArgs(["--apply", "--source-ids", "13,21"]),
    ).toEqual({ apply: true, sourceIds: [13, 21] });
    expect(() => parseReleaseStrandedArgs(["--apply"])).toThrow(/source-ids/);
    expect(() => parseReleaseStrandedArgs(["--dry"])).toThrow(/--apply/);
    expect(() =>
      parseReleaseStrandedArgs([
        "--apply",
        "--source-ids",
        "13",
        "--source-ids",
        "21",
      ]),
    ).toThrow(/source-ids.*once/);
    expect(() =>
      parseReleaseStrandedArgs(["--apply", "--apply", "--source-ids", "13"]),
    ).toThrow(/apply.*once/);
  });

  it("does not classify ingredient-backed sources as stranded", () => {
    expect(
      findStrandedSources(
        [
          { id: 13, food_id: 7 },
          { id: 21, food_id: 8 },
        ],
        [],
        [{ source_id: 21 }],
      ),
    ).toEqual([{ id: 13, food_id: 7 }]);
  });

  it("keeps brand identity research read-only unless --apply is explicit", () => {
    expect(parseBrandIdentityArgs(["--limit", "4"])).toEqual({
      apply: false,
      brandIds: [],
      limit: 4,
    });
    expect(parseBrandIdentityArgs(["--apply", "--brand-ids", "4,9"])).toEqual({
      apply: true,
      brandIds: [4, 9],
      limit: 20,
    });
    expect(() => parseBrandIdentityArgs(["--apply"])).toThrow(/brand-ids/);
    expect(() => parseBrandIdentityArgs(["--limit", "0"])).toThrow(/limit/);
    expect(() => parseBrandIdentityArgs(["--dry"])).toThrow(/--apply/);
    expect(() =>
      parseBrandIdentityArgs([
        "--apply",
        "--brand-ids",
        "4",
        "--brand-ids",
        "9",
      ]),
    ).toThrow(/brand-ids.*once/);
    expect(() =>
      parseBrandIdentityArgs(["--apply", "--apply", "--brand-ids", "4"]),
    ).toThrow(/apply.*once/);
  });

  it("does not overwrite a brand that changed during model research", async () => {
    const original = {
      country: null,
      homepage_url: null,
      id: 4,
      importer: null,
      ko_name: "아카나",
      manufacturer: "Old maker",
      name: "ACANA",
    };
    const live = { ...original, manufacturer: "Curator edit" };

    await expect(
      updateBrandIfUnchanged(inMemoryBrandClient(live), original, {
        country: "Canada",
        manufacturer: "Model edit",
      }),
    ).resolves.toBe("stale");
    expect(live).toEqual({ ...original, manufacturer: "Curator edit" });
  });
});
