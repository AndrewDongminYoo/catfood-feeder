import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * 수동 전사본은 사람이 라벨을 읽었다는 진술이다. 자동화가 그것을 등록할 수 있으면
 * `captureMethod: "manual"` 태그가 거짓이 되고, 근거 검증은 자기가 써 넣은 글을
 * 자기가 대조하게 되어 hallucination 가드가 무의미해진다.
 *
 * 'fetch'는 반대로 자동화에 열려 있어야 한다 — 서버가 URL을 직접 수집한 원문에 대고
 * 구절을 검증하므로 경계가 성립하고, 조사 스크립트 전체가 이 경로에 얹혀 있다.
 */
const mocks = vi.hoisted(() => ({
  authorizeCurator: vi.fn(),
  captureSource: vi.fn(),
  createFailedFoodSource: vi.fn(),
  foodExists: vi.fn(),
  replaceCurrentFoodSource: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeCurator: mocks.authorizeCurator,
}));

vi.mock("@/lib/source-fetcher", () => ({
  captureSource: mocks.captureSource,
}));

vi.mock("@/lib/source-repository", () => ({
  createFailedFoodSource: mocks.createFailedFoodSource,
  foodExists: mocks.foodExists,
  getFoodSourceTranscripts: vi.fn(),
  replaceCurrentFoodSource: mocks.replaceCurrentFoodSource,
}));

const HUMAN = {
  actorId: "11111111-1111-4111-8111-111111111111",
  kind: "authorized",
  origin: "human",
  rateLimitKey: "human",
};
const AUTOMATION = {
  actorId: null,
  kind: "authorized",
  origin: "automation",
  rateLimitKey: "automation",
};

const MANUAL_BODY = {
  captureMethod: "manual",
  capturedText: "조단백질 32% 이상",
  kind: "kr_label",
  url: "https://example.com/label",
};
const FETCH_BODY = {
  captureMethod: "fetch",
  kind: "manufacturer",
  url: "https://example.com/product",
};

function post(body: unknown) {
  return POST(
    new NextRequest("https://app.test/api/foods/1/sources", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.foodExists.mockResolvedValue(true);
  mocks.replaceCurrentFoodSource.mockResolvedValue({
    contentStatus: "new",
    sourceId: 7,
  });
  mocks.captureSource.mockResolvedValue({
    capturedAt: "2026-08-09T00:00:00.000Z",
    capturedText: "Crude protein 32%",
    contentHash: "hash",
    kind: "success",
  });
});

describe("출처 등록 경계", () => {
  it("자동화 자격 증명은 수동 전사본을 등록할 수 없다", async () => {
    mocks.authorizeCurator.mockResolvedValue(AUTOMATION);

    const response = await post(MANUAL_BODY);

    expect(response.status).toBe(403);
    // 거절만으로는 부족하다 — 기록이 남지 않았음까지 확인한다.
    expect(mocks.replaceCurrentFoodSource).not.toHaveBeenCalled();
  });

  it("사람 세션은 수동 전사본을 등록할 수 있다", async () => {
    mocks.authorizeCurator.mockResolvedValue(HUMAN);

    const response = await post(MANUAL_BODY);

    expect(response.status).toBe(200);
    expect(mocks.replaceCurrentFoodSource).toHaveBeenCalledWith(
      expect.objectContaining({
        captureMethod: "manual",
        createdBy: HUMAN.actorId,
      }),
    );
  });

  it("자동화 자격 증명은 fetch 수집을 계속 쓸 수 있다", async () => {
    mocks.authorizeCurator.mockResolvedValue(AUTOMATION);

    const response = await post(FETCH_BODY);

    expect(response.status).toBe(200);
    expect(mocks.captureSource).toHaveBeenCalled();
  });
});
