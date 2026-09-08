import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAttemptedResearchUrls,
  getResearchRetryContext,
} from "./research-repository";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

type RunRow = {
  readonly captures?: unknown;
  readonly id?: number;
  readonly proposal: unknown;
  readonly status?: string;
};

function clientReturning(rows: readonly RunRow[]) {
  const query = {
    eq: vi.fn(),
    limit: vi.fn((limit: number) =>
      Promise.resolve({ data: rows.slice(0, limit), error: null }),
    ),
    order: vi.fn(),
    range: vi.fn((from: number, to: number) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    ),
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

  it("allows retry after transient capture and claim failures", async () => {
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        {
          captures: [
            {
              failureCode: "network_error",
              status: "failed",
              url: "https://retry.example/network",
            },
          ],
          id: 13,
          proposal: {
            sources: [{ url: "https://retry.example/network" }],
          },
          status: "capture_failed",
        },
        {
          captures: [
            { status: "claim_conflict", url: "https://retry.example/claim" },
          ],
          id: 12,
          proposal: {
            sources: [{ url: "https://retry.example/claim" }],
          },
          status: "claim_conflict",
        },
        {
          captures: [
            {
              failureCode: "unsafe_destination",
              status: "failed",
              url: "https://dead.example/private",
            },
          ],
          id: 11,
          proposal: {
            sources: [{ url: "https://dead.example/private" }],
          },
          status: "capture_failed",
        },
      ]),
    );

    await expect(getAttemptedResearchUrls(7)).resolves.toEqual([
      "https://dead.example/private",
    ]);
    await expect(getResearchRetryContext(7)).resolves.toEqual({
      reason: "transient_capture_failure",
      runId: 13,
    });
  });

  it("retains terminal URLs beyond the first 20 runs", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      captures: [
        {
          failureCode: "unsafe_destination",
          status: "failed",
          url: `https://dead.example/${String(index + 1)}`,
        },
      ],
      id: 21 - index,
      proposal: {
        sources: [{ url: `https://dead.example/${String(index + 1)}` }],
      },
      status: "capture_failed",
    }));
    mocks.createAdminClient.mockReturnValue(clientReturning(rows));

    const attempted = await getAttemptedResearchUrls(7);

    expect(attempted).toHaveLength(21);
    expect(attempted).toContain("https://dead.example/21");
  });

  it("uses the latest outcome when a URL was retried", async () => {
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        {
          captures: [
            {
              failureCode: "network_error",
              status: "failed",
              url: "https://retry.example/source",
            },
          ],
          id: 2,
          proposal: {
            sources: [{ url: "https://retry.example/source" }],
          },
          status: "capture_failed",
        },
        {
          captures: [
            {
              failureCode: "unsafe_destination",
              status: "failed",
              url: "https://retry.example/source",
            },
          ],
          id: 1,
          proposal: {
            sources: [{ url: "https://retry.example/source" }],
          },
          status: "capture_failed",
        },
      ]),
    );

    await expect(getAttemptedResearchUrls(7)).resolves.toEqual([]);
  });

  it("does not report an older retry reason after a terminal retry", async () => {
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        {
          captures: [
            {
              failureCode: "unsafe_destination",
              status: "failed",
              url: "https://retry.example/source",
            },
          ],
          id: 2,
          proposal: {
            sources: [{ url: "https://retry.example/source" }],
          },
          status: "capture_failed",
        },
        {
          captures: [
            {
              failureCode: "network_error",
              status: "failed",
              url: "https://retry.example/source",
            },
          ],
          id: 1,
          proposal: {
            sources: [{ url: "https://retry.example/source" }],
          },
          status: "capture_failed",
        },
      ]),
    );

    await expect(getResearchRetryContext(7)).resolves.toBeNull();
  });

  it("keeps a transient URL retryable after another source was captured", async () => {
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        {
          captures: [
            {
              sourceId: 91,
              status: "captured",
              url: "https://done.example/source",
            },
            {
              failureCode: "network_error",
              sourceId: 92,
              status: "failed",
              url: "https://retry.example/source",
            },
          ],
          id: 3,
          proposal: {
            sources: [
              { url: "https://done.example/source" },
              { url: "https://retry.example/source" },
            ],
          },
          status: "rejected",
        },
      ]),
    );

    await expect(getAttemptedResearchUrls(7)).resolves.toEqual([
      "https://done.example/source",
    ]);
    await expect(getResearchRetryContext(7)).resolves.toEqual({
      reason: "transient_capture_failure",
      runId: 3,
    });
  });
});
