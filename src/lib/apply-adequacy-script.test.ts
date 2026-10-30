import { describe, it, expect, vi } from "vitest";
import {
  applyAdequacyManifest,
  parseApplyAdequacyArgs,
} from "../../scripts/apply-adequacy.mjs";
const row = {
  foodId: 1,
  sourceId: 2,
  sourceProductName: "Cat Food",
  sourceContentHash: "hash",
  statement: "Cat Food is formulated to meet AAFCO cat profiles.",
};
const manifest = { version: 1, approved: [row] };
it("defaults to no database writes", async () => {
  const fetchImpl = vi.fn();
  expect(parseApplyAdequacyArgs(["review.json"]).apply).toBe(false);
  expect(
    await applyAdequacyManifest({ manifest, fetchImpl, apply: false }),
  ).toMatchObject({ dryRun: true, target: 1, applied: 0 });
  expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([
  "https://example.com",
  "http://localhost.evil.test",
  "http://localhost/path",
  // trunk-ignore(trufflehog/URI): Synthetic credential URL verifies broker rejection.
  "http://user:pass@localhost",
])("does not send credentials to %s", async (baseUrl) => {
  const fetchImpl = vi.fn();
  await expect(
    applyAdequacyManifest({
      manifest,
      apply: true,
      baseUrl,
      adminSecret: "test",
      fetchImpl,
    }),
  ).rejects.toThrow("local broker");
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("fails fast on conflicting evidence without overwriting", async () => {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { status: "conflict" } }),
  });
  await expect(
    applyAdequacyManifest({
      manifest: { version: 1, approved: [row, { ...row, foodId: 3 }] },
      apply: true,
      baseUrl: "http://127.0.0.1:3000",
      adminSecret: "test",
      fetchImpl,
    }),
  ).rejects.toThrow("conflicts");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
describe("review manifest", () => {
  it("rejects duplicate identities and unknown flags", async () => {
    expect(() => parseApplyAdequacyArgs(["review.json", "--force"])).toThrow();
    await expect(
      applyAdequacyManifest({
        manifest: { version: 1, approved: [row, row] },
        apply: false,
      }),
    ).rejects.toThrow("duplicate");
  });
});
