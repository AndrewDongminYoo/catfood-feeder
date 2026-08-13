import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export type CuratorAuthorization =
  | {
      readonly kind: "authorized";
      readonly actorId: string | null;
      readonly origin: "human" | "automation";
      readonly rateLimitKey: string;
    }
  | {
      readonly kind: "denied";
      readonly status: 401 | 403 | 503;
      readonly message: string;
    };

export type HumanCuratorAuthorization =
  | {
      readonly kind: "authorized";
      readonly actorId: string;
      readonly origin: "human";
      readonly rateLimitKey: string;
    }
  | Extract<CuratorAuthorization, { kind: "denied" }>;

export async function authorizeCurator(
  request: Request,
): Promise<CuratorAuthorization> {
  if (hasMatchingAdminSecret(request)) {
    return {
      kind: "authorized",
      actorId: null,
      origin: "automation",
      rateLimitKey: "automation",
    };
  }

  return authorizeHumanCurator();
}

export async function authorizeHumanCurator(): Promise<HumanCuratorAuthorization> {
  const allowedEmails = configuredAdminEmails();
  if (allowedEmails.length === 0) {
    return {
      kind: "denied",
      status: 503,
      message: "ADMIN_EMAILS is not configured.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      kind: "denied",
      status: 401,
      message: "관리자 로그인이 필요합니다.",
    };
  }

  if (!user.email || !allowedEmails.includes(user.email.toLowerCase())) {
    return {
      kind: "denied",
      status: 403,
      message: "카탈로그 편집 권한이 없습니다.",
    };
  }

  return {
    kind: "authorized",
    actorId: user.id,
    origin: "human",
    rateLimitKey: user.id,
  };
}

function configuredAdminEmails(): readonly string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function hasMatchingAdminSecret(request: Request): boolean {
  return secretsMatch(
    process.env.ADMIN_WRITE_SECRET,
    request.headers.get("x-admin-secret"),
  );
}

/** 공유 비밀 비교. 길이가 같을 때만 상수 시간 비교하므로 내용은 유출되지 않는다. */
export function secretsMatch(
  expected: string | undefined,
  supplied: string | null,
): boolean {
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
