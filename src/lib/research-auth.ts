import { secretsMatch } from "./admin-auth";

export type ResearchAuthorization =
  | { readonly kind: "authorized" }
  | {
      readonly kind: "denied";
      readonly status: 401 | 503;
      readonly message: string;
    };

/**
 * 로컬 조사 러너 전용 경계.
 *
 * ADMIN_WRITE_SECRET과 의도적으로 분리한다. 이 비밀은 research broker 한 곳에서만
 * 인정되며, 어떤 관리자·발행 API도 이것으로 열리지 않는다. 발행 권한은 사람에게만
 * 있으므로 여기에는 actor 개념 자체가 없다.
 */
export function authorizeResearchAgent(
  request: Request,
): ResearchAuthorization {
  const expected = process.env.RESEARCH_AGENT_SECRET;
  if (!expected) {
    return {
      kind: "denied",
      status: 503,
      message: "RESEARCH_AGENT_SECRET is not configured.",
    };
  }
  if (!secretsMatch(expected, request.headers.get("x-research-agent-secret"))) {
    return {
      kind: "denied",
      status: 401,
      message: "조사 에이전트 자격 증명이 올바르지 않습니다.",
    };
  }
  return { kind: "authorized" };
}
