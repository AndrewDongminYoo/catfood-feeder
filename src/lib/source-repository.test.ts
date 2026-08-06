import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUnclaimedFoodEvidenceDraft,
  replaceUnclaimedFoodSource,
} from "./source-repository";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

/**
 * 이 계층은 라우트 테스트가 모듈째 mock 하고 pgTAP은 SQL 함수를 직접 부르므로,
 * 그 사이의 RPC 페이로드는 아무도 보지 않는다. `p_owned_source_ids` 키 하나가
 * 빠지면 SQL 쪽 기본값이 NULL이라 소유권 가드가 통째로 꺼지는데(fail-open),
 * 타입은 optional이라 tsc도 잡지 못한다. 여기서 고정한다.
 */
describe("research RPC payloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  });

  const capture = {
    capturedAt: "2026-08-06T00:00:00.000Z",
    capturedText: "조단백질 36% 이상",
    captureMethod: "fetch",
    contentHash: "a".repeat(64),
    createdBy: null,
    failureCode: null,
    fetchStatus: "fetched",
    foodId: 7,
    kind: "manufacturer",
    observedAt: null,
    ownedSourceIds: [91],
    url: "https://example.com/label",
  } as const;

  const evidence = [
    {
      excerpt: "조단백질 36% 이상",
      nutrientKey: "protein_pct",
      sourceId: 91,
      value: 36,
    },
  ] as const;

  it("sends the owned source ids when replacing a source", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { claim_status: "claimed", content_status: "initial", source_id: 92 },
      ],
      error: null,
    });

    await replaceUnclaimedFoodSource(capture);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "replace_current_food_source",
      expect.objectContaining({ p_owned_source_ids: [91] }),
    );
  });

  it("sends the owned source ids when applying evidence", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await applyUnclaimedFoodEvidenceDraft(7, [], [91]);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_food_evidence_draft",
      expect.objectContaining({ p_owned_source_ids: [91] }),
    );
  });

  it("maps the claim-lost SQLSTATE to a conflict rather than throwing", async () => {
    // PostgREST는 커스텀 SQLSTATE를 error.code에 그대로 싣는다. 이 매핑이 깨지면
    // 클레임 충돌이 500으로 바뀌어 원장 없이 사료만 묶인다.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "CFCLM", message: "Research claim lost for food 7" },
    });

    await expect(
      applyUnclaimedFoodEvidenceDraft(7, evidence, [91]),
    ).resolves.toEqual({ claim: "conflict" });
  });

  it("still throws for any other database error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Evidence values violate rules" },
    });

    await expect(
      applyUnclaimedFoodEvidenceDraft(7, evidence, [91]),
    ).rejects.toThrow("Evidence values violate rules");
  });

  it("throws when the RPC returns fewer results than candidates", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      applyUnclaimedFoodEvidenceDraft(7, evidence, [91]),
    ).rejects.toThrow("incomplete result");
  });
});
