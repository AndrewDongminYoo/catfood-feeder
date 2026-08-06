import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  applyFoodEvidenceDraft: vi.fn(),
  captureSource: vi.fn(),
  createFailedFoodSource: vi.fn(),
  getCurrentFetchedFoodSources: vi.fn(),
  getResearchTarget: vi.fn(),
  recordFoodResearchRun: vi.fn(),
  replaceUnclaimedFoodSource: vi.fn(),
}));

vi.mock("@/lib/research-repository", () => ({
  getResearchTarget: mocks.getResearchTarget,
  recordFoodResearchRun: mocks.recordFoodResearchRun,
}));

vi.mock("@/lib/source-fetcher", () => ({
  captureSource: mocks.captureSource,
}));

vi.mock("@/lib/source-repository", () => ({
  applyFoodEvidenceDraft: mocks.applyFoodEvidenceDraft,
  createFailedFoodSource: mocks.createFailedFoodSource,
  getCurrentFetchedFoodSources: mocks.getCurrentFetchedFoodSources,
  replaceUnclaimedFoodSource: mocks.replaceUnclaimedFoodSource,
}));

const LABEL_URL = "https://example.com/label";
const LABEL_TEXT = "조단백질 36% 이상, 조지방 18% 이상";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    foodId: 7,
    proposal: {
      agent: {
        model: "gpt-5.4-codex",
        name: "codex-cli",
        promptVersion: "2026-08-06",
        schemaVersion: "1",
      },
      evidence: [
        {
          excerpt: "조단백질 36% 이상",
          nutrientKey: "protein_pct",
          sourceUrl: LABEL_URL,
          value: 36,
        },
      ],
      sources: [
        {
          kind: "manufacturer",
          reason: "제조사 공식 보장성분표",
          url: LABEL_URL,
        },
      ],
      ...overrides,
    },
  };
}

function callRoute(body: unknown, secret: string | null = "research-secret") {
  return POST(
    new NextRequest("http://localhost/api/research/proposals", {
      body: JSON.stringify(body),
      headers: secret === null ? {} : { "x-research-agent-secret": secret },
      method: "POST",
    }),
  );
}

describe("POST /api/research/proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEARCH_AGENT_SECRET = "research-secret";
    mocks.getResearchTarget.mockResolvedValue({
      brandName: "ACANA",
      id: 7,
      kind: "skeleton",
      productName: "Grasslands",
    });
    mocks.captureSource.mockResolvedValue({
      capturedText: LABEL_TEXT,
      contentHash: "hash",
      contentType: "text/html",
      kind: "success",
      url: LABEL_URL,
    });
    mocks.replaceUnclaimedFoodSource.mockResolvedValue({
      claim: "claimed",
      result: { contentStatus: "initial", sourceId: 91 },
    });
    mocks.getCurrentFetchedFoodSources.mockResolvedValue([
      { capturedText: LABEL_TEXT, id: 91, kind: "manufacturer" },
    ]);
    mocks.applyFoodEvidenceDraft.mockImplementation(
      async (_foodId: number, evidence: readonly { nutrientKey: string }[]) =>
        evidence.map((item) => ({ ...item, status: "applied" })),
    );
    mocks.recordFoodResearchRun.mockResolvedValue(1234);
  });

  it("rejects a request without the research secret before touching the database", async () => {
    const response = await callRoute(envelope(), null);

    expect(response.status).toBe(401);
    expect(mocks.getResearchTarget).not.toHaveBeenCalled();
  });

  it("rejects the admin automation secret", async () => {
    process.env.ADMIN_WRITE_SECRET = "admin-secret";

    const response = await callRoute(envelope(), "admin-secret");

    expect(response.status).toBe(401);
    expect(mocks.getResearchTarget).not.toHaveBeenCalled();
  });

  it("captures the proposed source and applies verified evidence as a draft", async () => {
    const response = await callRoute(envelope());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("applied");
    expect(body.appliedCount).toBe(1);
    expect(body.evidence[0].status).toBe("applied");
    expect(body.runId).toBe(1234);
    // 서버가 직접 재수집한다 — 에이전트가 준 본문을 쓰지 않는다.
    expect(mocks.captureSource).toHaveBeenCalledWith({
      kind: "manufacturer",
      url: LABEL_URL,
    });
    expect(mocks.applyFoodEvidenceDraft).toHaveBeenCalledWith(7, [
      {
        excerpt: "조단백질 36% 이상",
        nutrientKey: "protein_pct",
        sourceId: 91,
        value: 36,
      },
    ]);
  });

  it("refuses a target that already carries a current source", async () => {
    mocks.getResearchTarget.mockResolvedValue({ kind: "not_skeleton" });

    const response = await callRoute(envelope());

    expect(response.status).toBe(409);
    expect(mocks.captureSource).not.toHaveBeenCalled();
    expect(mocks.replaceUnclaimedFoodSource).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown food", async () => {
    mocks.getResearchTarget.mockResolvedValue({ kind: "not_found" });

    const response = await callRoute(envelope());

    expect(response.status).toBe(404);
    expect(mocks.captureSource).not.toHaveBeenCalled();
  });

  it("records a capture failure without applying evidence", async () => {
    mocks.captureSource.mockResolvedValue({
      code: "http_error",
      kind: "failure",
    });
    mocks.createFailedFoodSource.mockResolvedValue(92);

    const response = await callRoute(envelope());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("capture_failed");
    expect(body.captures[0]).toMatchObject({
      failureCode: "http_error",
      status: "failed",
    });
    expect(body.evidence[0].status).toBe("source_unavailable");
    expect(mocks.applyFoodEvidenceDraft).not.toHaveBeenCalled();
    expect(mocks.recordFoodResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "capture_failed" }),
    );
  });

  it("records evidence whose excerpt is absent from the captured text as unverified", async () => {
    const response = await callRoute(
      envelope({
        evidence: [
          {
            excerpt: "조단백질 42% 이상",
            nutrientKey: "protein_pct",
            sourceUrl: LABEL_URL,
            value: 42,
          },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("rejected");
    expect(body.evidence[0].status).toBe("unverified");
    expect(mocks.applyFoodEvidenceDraft).not.toHaveBeenCalled();
  });

  it("writes nothing when the target is claimed while the source is fetching", async () => {
    mocks.replaceUnclaimedFoodSource.mockResolvedValue({ claim: "conflict" });

    const response = await callRoute(envelope());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("claim_conflict");
    expect(body.captures[0]).toMatchObject({ status: "claim_conflict" });
    expect(body.evidence[0].status).toBe("claim_conflict");
    expect(body.appliedCount).toBe(0);
    expect(mocks.applyFoodEvidenceDraft).not.toHaveBeenCalled();
    expect(mocks.recordFoodResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "claim_conflict" }),
    );
  });

  it("stops capturing the remaining sources once the claim is lost", async () => {
    mocks.replaceUnclaimedFoodSource.mockResolvedValue({ claim: "conflict" });

    await callRoute(
      envelope({
        sources: [
          { kind: "manufacturer", reason: "제조사", url: LABEL_URL },
          { kind: "kr_label", reason: "수입사", url: "https://example.com/kr" },
        ],
      }),
    );

    expect(mocks.captureSource).toHaveBeenCalledTimes(1);
    expect(mocks.replaceUnclaimedFoodSource).toHaveBeenCalledTimes(1);
  });

  it("applies no evidence when a later source loses the claim", async () => {
    const KR_URL = "https://example.com/kr";
    // 첫 출처는 정상적으로 잡히고, 두 번째에서 대상을 뺏긴다.
    mocks.replaceUnclaimedFoodSource
      .mockResolvedValueOnce({
        claim: "claimed",
        result: { contentStatus: "initial", sourceId: 91 },
      })
      .mockResolvedValueOnce({ claim: "conflict" });

    const response = await callRoute(
      envelope({
        sources: [
          { kind: "manufacturer", reason: "제조사", url: LABEL_URL },
          { kind: "kr_label", reason: "수입사", url: KR_URL },
        ],
      }),
    );
    const body = await response.json();

    // 첫 출처를 이미 잡았더라도 근거는 하나도 쓰지 않는다.
    expect(mocks.applyFoodEvidenceDraft).not.toHaveBeenCalled();
    expect(body.status).toBe("claim_conflict");
    expect(body.appliedCount).toBe(0);
    expect(
      body.evidence.every(
        (e: { status: string }) => e.status === "claim_conflict",
      ),
    ).toBe(true);
    expect(mocks.recordFoodResearchRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "claim_conflict" }),
    );
  });

  it("rejects a proposal claiming the same nutrient key twice", async () => {
    const response = await callRoute(
      envelope({
        evidence: [
          {
            excerpt: "조단백질 36% 이상",
            nutrientKey: "protein_pct",
            sourceUrl: LABEL_URL,
            value: 36,
          },
          {
            excerpt: "조단백질 34% 이상",
            nutrientKey: "protein_pct",
            sourceUrl: LABEL_URL,
            value: 34,
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.captureSource).not.toHaveBeenCalled();
  });

  it("never sets publication metadata on the research path", async () => {
    await callRoute(envelope());

    const applied = mocks.applyFoodEvidenceDraft.mock.calls;
    expect(applied).toHaveLength(1);
    expect(JSON.stringify(applied)).not.toContain("published");
  });
});
