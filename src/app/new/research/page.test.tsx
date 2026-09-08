import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeHumanCurator: vi.fn(),
  loadResearchExceptions: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeHumanCurator: mocks.authorizeHumanCurator,
}));
vi.mock("@/lib/research-exceptions", () => ({
  loadResearchExceptions: mocks.loadResearchExceptions,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

import ResearchPage from "./page";

describe("ResearchPage curator boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects before reading the private ledger when signed out", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      message: "관리자 로그인이 필요합니다.",
      status: 401,
    });

    await expect(ResearchPage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login?next=%2Fnew%2Fresearch",
    );
    expect(mocks.loadResearchExceptions).not.toHaveBeenCalled();
  });

  it("loads the exception queue for an authorized human curator", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      actorId: "curator-id",
      kind: "authorized",
      origin: "human",
      rateLimitKey: "curator-id",
    });
    mocks.loadResearchExceptions.mockResolvedValue([]);

    await expect(ResearchPage()).resolves.toBeTruthy();
    expect(mocks.loadResearchExceptions).toHaveBeenCalledOnce();
  });
});
