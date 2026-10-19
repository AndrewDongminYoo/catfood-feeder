import { it, expect, vi, beforeEach } from "vitest";
import { SAMPLE_FOODS } from "./fixtures";
import { getDecisionCatalog } from "./decision-catalog";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./catalog", () => ({
  getAdvisorCatalog: async () => ({
    available: true,
    foods: SAMPLE_FOODS,
    evidenceByFoodId: new Map(),
  }),
  isSupabaseConfigured: () => false,
}));
vi.mock("./adequacy-repository", () => ({ getAdequacyProofs: mocks.read }));
beforeEach(() => vi.clearAllMocks());
it("does not erase captured declarations under a successful refresh when retrieval fails", async () => {
  mocks.read.mockRejectedValue(new Error("connection failed"));
  expect((await getDecisionCatalog({ fresh: true })).available).toBe(false);
});
it("still accepts a successfully read empty evidence set", async () => {
  mocks.read.mockResolvedValue({});
  expect((await getDecisionCatalog({ fresh: true })).available).toBe(true);
});
