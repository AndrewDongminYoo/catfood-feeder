import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { proposeDecisionConditions } from "@/lib/source-extraction";

vi.mock("@/lib/request-rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/source-extraction", () => ({
  proposeDecisionConditions: vi.fn(),
}));
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/advisor/question", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.mocked(consumeRateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});
afterEach(() => vi.resetAllMocks());

describe("public decision question", () => {
  it("refuses another browser origin before spending quota", async () => {
    const req = request({ question: "닭고기 없는 사료" });
    req.headers.set("origin", "https://unrelated.test");
    expect((await POST(req)).status).toBe(403);
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });
  it("returns validated, editable AI conditions without recommending or changing foods", async () => {
    vi.mocked(proposeDecisionConditions).mockResolvedValue({
      exclusions: ["chicken"],
      maxKcalDeltaPct: null,
      citations: ["닭고기 없는"],
      unhandled: [],
    });
    const response = await POST(request({ question: "닭고기 없는 사료" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "ai",
      interpretation: { exclusions: ["chicken"] },
    });
  });
  it("falls back to editable rules when the global daily budget is exhausted", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 86400,
    });
    const response = await POST(request({ question: "닭고기 없는 사료" }));
    expect(await response.json()).toMatchObject({
      mode: "rules",
      interpretation: { exclusions: ["chicken"] },
    });
    expect(proposeDecisionConditions).not.toHaveBeenCalled();
  });
  it("does not send unsupported clinical questions to a paid model", async () => {
    const response = await POST(request({ question: "신장병 처방식 대신" }));
    expect(await response.json()).toMatchObject({
      mode: "rules",
      interpretation: { outsideScope: true },
    });
    expect(proposeDecisionConditions).not.toHaveBeenCalled();
  });
  it("rejects invented supporting quotes and retains the actual question's conditions", async () => {
    vi.mocked(proposeDecisionConditions).mockResolvedValue({
      exclusions: ["beef"],
      maxKcalDeltaPct: 5,
      citations: ["invented"],
      unhandled: [],
    });
    expect(
      await (await POST(request({ question: "닭고기 없는 사료" }))).json(),
    ).toMatchObject({
      mode: "rules",
      interpretation: { exclusions: ["chicken"] },
    });
  });
  it("rejects oversized questions before spending model quota", async () => {
    expect((await POST(request({ question: "a".repeat(1201) }))).status).toBe(
      400,
    );
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });
});
