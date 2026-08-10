import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  authorizeResearchAgent: vi.fn(),
  recordFoodResearchRun: vi.fn(),
}));

vi.mock("@/lib/research-auth", () => ({
  authorizeResearchAgent: mocks.authorizeResearchAgent,
}));

vi.mock("@/lib/research-repository", () => ({
  recordFoodResearchRun: mocks.recordFoodResearchRun,
}));

const BODY = {
  agent: {
    model: "gpt-5.6-terra",
    name: "transcribe-brand",
    promptVersion: "1",
    schemaVersion: "1",
  },
  foodId: 498,
  images: [
    { contentHash: "a".repeat(64), url: "https://example.test/detail.jpg" },
  ],
  productPageUrl: "https://example.test/p/1",
  transcript: "등록성분량 조단백질 30.0% 이상",
  values: [
    { excerpt: "조단백질 30.0% 이상", nutrientKey: "protein_pct", value: 30 },
  ],
};

function post(body: unknown) {
  return POST(
    new NextRequest("https://app.test/api/research/transcripts", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeResearchAgent.mockReturnValue({ kind: "authorized" });
  mocks.recordFoodResearchRun.mockResolvedValue(77);
});

describe("전사 제안 적재", () => {
  it("pending_review 로만 적재한다", async () => {
    const response = await post(BODY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runId: 77 });
    expect(mocks.recordFoodResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({ foodId: 498, status: "pending_review" }),
    );
  });

  // 스키마가 .strict() 이므로 status 는 형식 오류로 거절된다. 거절을 명시적으로
  // 단언한다 — mock.calls 를 순회하며 검사하면 호출이 0건일 때 아무것도 확인하지
  // 않고 통과한다(공허한 통과).
  it("호출자가 상태를 정할 수 없다", async () => {
    const response = await post({ ...BODY, status: "applied" });

    expect(response.status).toBe(400);
    expect(mocks.recordFoodResearchRun).not.toHaveBeenCalled();
  });

  it("권한이 없으면 아무것도 적재하지 않는다", async () => {
    mocks.authorizeResearchAgent.mockReturnValue({
      kind: "denied",
      message: "no",
      status: 401,
    });

    const response = await post(BODY);

    expect(response.status).toBe(401);
    expect(mocks.recordFoodResearchRun).not.toHaveBeenCalled();
  });

  it("형식이 어긋나면 400 이고 적재하지 않는다", async () => {
    const response = await post({
      ...BODY,
      values: [{ nutrientKey: "protein_pct" }],
    });

    expect(response.status).toBe(400);
    expect(mocks.recordFoodResearchRun).not.toHaveBeenCalled();
  });
});
