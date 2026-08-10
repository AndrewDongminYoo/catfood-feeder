import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * domain.ts는 9개 영양소 키를 정의한다(단백/지방/섬유/회분/수분/칼슘/인/kcal +
 * carb_pct). carb_pct는 나중에 추가됐고, 이 요청 스키마의 evidence 배열 상한은
 * 그때 함께 올라가지 않아 8에 머물러 있었다 — 한 라벨에서 9개가 모두 나오는
 * 정상적인 경우를 거절한다.
 */
const mocks = vi.hoisted(() => ({
  applyFoodEvidenceDraft: vi.fn(),
  authorizeCurator: vi.fn(),
  foodExists: vi.fn(),
  getCurrentFetchedFoodSources: vi.fn(),
  validateExtractedEvidence: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeCurator: mocks.authorizeCurator,
}));

vi.mock("@/lib/source-extraction", () => ({
  validateExtractedEvidence: mocks.validateExtractedEvidence,
}));

vi.mock("@/lib/source-repository", () => ({
  applyFoodEvidenceDraft: mocks.applyFoodEvidenceDraft,
  foodExists: mocks.foodExists,
  getCurrentFetchedFoodSources: mocks.getCurrentFetchedFoodSources,
}));

const AUTHORIZED = {
  actorId: "11111111-1111-4111-8111-111111111111",
  kind: "authorized",
  origin: "human",
  rateLimitKey: "human",
};

const NINE_VALUES = [
  {
    excerpt: "조단백질 32% 이상",
    nutrientKey: "protein_pct",
    sourceId: 7,
    value: 32,
  },
  {
    excerpt: "조지방 18% 이상",
    nutrientKey: "fat_pct",
    sourceId: 7,
    value: 18,
  },
  {
    excerpt: "조섬유 4% 이하",
    nutrientKey: "fiber_pct",
    sourceId: 7,
    value: 4,
  },
  { excerpt: "조회분 8% 이하", nutrientKey: "ash_pct", sourceId: 7, value: 8 },
  {
    excerpt: "수분 10% 이하",
    nutrientKey: "moisture_pct",
    sourceId: 7,
    value: 10,
  },
  { excerpt: "칼슘 1.2%", nutrientKey: "calcium_pct", sourceId: 7, value: 1.2 },
  { excerpt: "인 1.0%", nutrientKey: "phosphorus_pct", sourceId: 7, value: 1 },
  {
    excerpt: "대사에너지 3500kcal/kg",
    nutrientKey: "kcal_per_kg",
    sourceId: 7,
    value: 3500,
  },
  { excerpt: "탄수화물 28%", nutrientKey: "carb_pct", sourceId: 7, value: 28 },
];

function post(body: unknown) {
  return POST(
    new NextRequest("https://app.test/api/foods/1/sources/apply", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeCurator.mockResolvedValue(AUTHORIZED);
  mocks.foodExists.mockResolvedValue(true);
  mocks.getCurrentFetchedFoodSources.mockResolvedValue([]);
  // 실제 근거 검증(원문 대조)은 이 테스트의 관심사가 아니다 — 요청 스키마가
  // 9개짜리 배열을 통과시키는지만 본다. 그래서 후보를 그대로 승인한다.
  mocks.validateExtractedEvidence.mockImplementation(
    (evidence: unknown) => evidence,
  );
  mocks.applyFoodEvidenceDraft.mockImplementation(
    async (_foodId: number, evidence: (typeof NINE_VALUES)[number][]) =>
      evidence.map((item) => ({ ...item, status: "applied" as const })),
  );
});

describe("evidence 상한", () => {
  it("9개 영양소 키(carb_pct 포함)를 한 번에 받는다", async () => {
    const response = await post({ evidence: NINE_VALUES });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect((body as { results: unknown[] }).results).toHaveLength(9);
  });
});
