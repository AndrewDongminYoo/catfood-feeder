import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

import { authorizeHumanCurator } from "./admin-auth";

describe("authorizeHumanCurator", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    mocks.getUser.mockReset();
    process.env.ADMIN_EMAILS = "curator@example.com";
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  it("설정된 관리자 이메일이 없으면 인증 서비스를 호출하지 않는다", async () => {
    process.env.ADMIN_EMAILS = "";

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "denied",
      status: 503,
      message: "ADMIN_EMAILS is not configured.",
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("로그인 사용자가 없으면 401을 반환한다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    });
  });

  it("허용 목록에 없는 로그인 사용자를 거부한다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "visitor-id", email: "visitor@example.com" } },
      error: null,
    });

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    });
  });

  it("허용 목록의 이메일은 대소문자와 공백을 정규화해 승인한다", async () => {
    process.env.ADMIN_EMAILS = " Curator@Example.com ";
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "curator-id", email: "curator@example.com" } },
      error: null,
    });

    await expect(authorizeHumanCurator()).resolves.toEqual({
      kind: "authorized",
      actorId: "curator-id",
      origin: "human",
      rateLimitKey: "curator-id",
    });
  });
});
