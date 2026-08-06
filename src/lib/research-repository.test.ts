import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAttemptedResearchUrls } from "./research-repository";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

function clientReturning(rows: readonly { proposal: unknown }[]) {
  const query = {
    eq: vi.fn(),
    limit: mocks.limit.mockResolvedValue({ data: rows, error: null }),
    order: vi.fn(),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return { from: vi.fn().mockReturnValue(query) };
}

describe("getAttemptedResearchUrls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers URLs from a proposal the strict schema would reject", async () => {
    // 거절된 제안이야말로 기억해야 할 대상이다. 엄격 스키마로 읽으면 정작 그것을
    // 놓쳐 다음 실행이 같은 막다른 URL을 또 제안한다.
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        {
          proposal: {
            agent: {
              model: "m",
              name: "n",
              promptVersion: "1",
              schemaVersion: "1",
            },
            evidence: [],
            sources: [
              {
                kind: "manufacturer",
                reason: "첫 번째",
                url: "http://a.example/x",
              },
              {
                kind: "manufacturer",
                reason: "중복 kind",
                url: "https://b.example/y",
              },
            ],
          },
        },
      ]),
    );

    await expect(getAttemptedResearchUrls(7)).resolves.toEqual([
      "http://a.example/x",
      "https://b.example/y",
    ]);
  });

  it("deduplicates across runs and tolerates unreadable rows", async () => {
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        { proposal: { sources: [{ url: "https://a.example/x" }] } },
        { proposal: { sources: [{ url: "https://a.example/x" }] } },
        { proposal: { nonsense: true } },
      ]),
    );

    await expect(getAttemptedResearchUrls(7)).resolves.toEqual([
      "https://a.example/x",
    ]);
  });
});
