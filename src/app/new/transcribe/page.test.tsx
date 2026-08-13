import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeHumanCurator: vi.fn(),
  loadPendingTranscripts: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeHumanCurator: mocks.authorizeHumanCurator,
}));
vi.mock("@/lib/label-transcripts", () => ({
  loadPendingTranscripts: mocks.loadPendingTranscripts,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

import TranscribePage from "./page";

describe("TranscribePage curator boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("미로그인 요청은 전사안을 읽기 전에 로그인으로 보낸다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    });

    await expect(TranscribePage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login?next=%2Fnew%2Ftranscribe",
    );
    expect(mocks.loadPendingTranscripts).not.toHaveBeenCalled();
  });

  it("권한 없는 로그인 요청은 전사안을 읽기 전에 404로 숨긴다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    });

    await expect(TranscribePage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadPendingTranscripts).not.toHaveBeenCalled();
  });

  it("허용된 인간 관리자만 초기 전사안을 읽는다", async () => {
    mocks.authorizeHumanCurator.mockResolvedValue({
      kind: "authorized",
      actorId: "curator-id",
      origin: "human",
      rateLimitKey: "curator-id",
    });
    mocks.loadPendingTranscripts.mockResolvedValue([]);

    await expect(TranscribePage()).resolves.toBeTruthy();
    expect(mocks.loadPendingTranscripts).toHaveBeenCalledOnce();
  });
});
