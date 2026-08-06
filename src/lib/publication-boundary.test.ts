import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("explicit publication boundary", () => {
  it("uses published_at for public catalog reads and private draft reads", () => {
    const catalog = source("src/lib/catalog.ts");
    const drafts = source("src/app/api/foods/drafts/route.ts");

    expect(catalog).toContain('.not("published_at", "is", null)');
    expect(catalog).not.toContain('.not("data_verified_at", "is", null)');
    expect(drafts).toContain('.is("published_at", null)');
    expect(drafts).not.toContain('.is("data_verified_at", null)');
  });

  it("sets verification and publication metadata together on human create", () => {
    const createRoute = source("src/app/api/foods/route.ts");

    expect(createRoute).toContain("const publishedAt =");
    expect(createRoute).toContain("data_verified_at: publishedAt");
    expect(createRoute).toContain("published_at: publishedAt");
    expect(createRoute).toContain("published_by:");
    expect(createRoute).toContain("verification_method:");
  });
});
