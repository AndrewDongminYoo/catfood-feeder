import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ authorizeCurator: mocks.authorize }));
vi.mock("@/lib/adequacy-repository", () => ({
  applyAdequacy: mocks.apply,
  AdequacyRefusal: class extends Error {},
}));
const body = {
  sourceId: 1,
  statement: "Example Cat Food is formulated to meet AAFCO cat profiles.",
  sourceProductName: "Example Cat Food",
  sourceContentHash: "hash",
};
const post = (payload: unknown) =>
  POST(
    new NextRequest("http://localhost/api/foods/2/sources/adequacy", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: "2" }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    kind: "authorized",
    origin: "automation",
  });
  mocks.apply.mockResolvedValue({ status: "applied", id: 1 });
});
it("rejects unauthorized writes before reading or applying the request", async () => {
  mocks.authorize.mockResolvedValue({
    kind: "denied",
    status: 403,
    message: "denied",
  });
  expect((await post(body)).status).toBe(403);
  expect(mocks.apply).not.toHaveBeenCalled();
});
it("uses server authorization origin, not a submitted human stamp", async () => {
  expect((await post({ ...body, appliedByOrigin: "human" })).status).toBe(400);
  expect(mocks.apply).not.toHaveBeenCalled();
  expect((await post(body)).status).toBe(200);
  expect(mocks.apply).toHaveBeenCalledWith(2, body, "automation");
});
