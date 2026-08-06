import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeResearchAgent } from "@/lib/research-auth";
import { researchProposalSchema } from "@/lib/research-proposal";
import type { ResearchProposal } from "@/lib/research-proposal";
import {
  getResearchTarget,
  recordFoodResearchRun,
} from "@/lib/research-repository";
import type { ResearchRunStatus } from "@/lib/research-repository";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { validateExtractedEvidence } from "@/lib/source-extraction";
import { captureSource } from "@/lib/source-fetcher";
import {
  applyUnclaimedFoodEvidenceDraft,
  createFailedFoodSource,
  getCurrentFetchedFoodSources,
  replaceUnclaimedFoodSource,
} from "@/lib/source-repository";

const requestSchema = z
  .object({
    foodId: z.number().int().positive(),
    proposal: researchProposalSchema,
  })
  .strict();

type CaptureOutcome =
  | {
      readonly url: string;
      readonly kind: string;
      readonly status: "captured";
      readonly sourceId: number;
    }
  | {
      readonly url: string;
      readonly kind: string;
      readonly status: "failed";
      readonly failureCode: string;
      readonly sourceId: number;
    }
  | {
      readonly url: string;
      readonly kind: string;
      readonly status: "claim_conflict";
    }
  | {
      readonly url: string;
      readonly kind: string;
      readonly status: "errored";
    };

type EvidenceOutcome = {
  readonly nutrientKey: string;
  readonly sourceUrl: string;
  readonly value: number;
  readonly status:
    | "applied"
    | "skipped"
    | "conflict"
    | "unverified"
    | "source_unavailable"
    | "claim_conflict"
    | "errored";
};

/**
 * 로컬 조사 에이전트의 제안 봉투를 받는 좁은 broker.
 *
 * 에이전트의 판단은 데이터베이스 권한이 아니다. 서버가 URL을 직접 재수집하고,
 * 근거 문구·숫자·현재 출처를 다시 검증한 뒤에야 private DRAFT에 반영한다.
 * 발행(published_at)은 이 경로에서 절대 일어나지 않는다.
 */
export async function POST(req: NextRequest) {
  const authorization = authorizeResearchAgent(req);
  if (authorization.kind === "denied")
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );

  try {
    const parsed = requestSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "조사 제안 형식이 올바르지 않습니다." },
        { status: 400 },
      );

    const { foodId, proposal } = parsed.data;
    const target = await getResearchTarget(foodId);
    if (target.kind === "not_found")
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    if (target.kind === "not_skeleton")
      return NextResponse.json(
        {
          error:
            "이미 발행됐거나 출처가 등록된 사료는 자동 조사 대상이 아닙니다.",
        },
        { status: 409 },
      );

    const { captures, claimLost, errored, sourceIdByUrl } =
      await captureProposedSources(foodId, proposal);

    // 클레임은 제안 전체 단위다. 출처 하나라도 뺏겼다면 이미 잡아 둔 출처의 근거도
    // 적용하지 않는다 — 그 사이 대상을 잡은 사람이 값을 쓰고 있을 수 있다.
    // 수집이 예외로 끊긴 경우도 같다: DB 상태를 모르는 채로 값을 쓰지 않는다.
    //
    // 근거 적용도 캡처와 같은 이유로 감싼다. 캡처만 감싸면 apply RPC가 CFCLM이
    // 아닌 사유(도메인 규칙 위반, 그 사이 human-verified로 바뀜, 일시적 DB 오류)로
    // 던질 때 원장 기록을 건너뛰고, 이미 커밋된 출처 때문에 그 사료는 재조사
    // 대상에서 영구히 빠진다 — 원장을 만든 이유가 바로 그 복구다.
    const applied = await applyOrSkip(
      foodId,
      proposal,
      sourceIdByUrl,
      claimLost,
      errored,
    );
    const status = applied.failed
      ? "errored"
      : applied.outcomes.some((outcome) => outcome.status === "claim_conflict")
        ? "claim_conflict"
        : runStatus(captures, applied.outcomes);

    const runId = await recordFoodResearchRun({
      captures,
      evidenceResults: applied.outcomes,
      foodId,
      proposal,
      status,
    });

    return NextResponse.json(
      {
        appliedCount: applied.appliedCount,
        captures,
        evidence: applied.outcomes,
        runId,
        status,
        // 실패 응답에도 error를 싣는다. 러너는 이 키로 메시지를 만들고, 그것이
        // 없으면 방금 남긴 runId까지 함께 버려진다.
        ...(applied.failed
          ? { error: "조사 실행이 중단됐습니다. 원장을 확인하세요." }
          : {}),
      },
      // 부분적으로 쓰고 끊긴 실행은 성공이 아니다. 원장에 남긴 뒤 실패로 알린다.
      applied.failed ? { status: 500 } : undefined,
    );
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    console.error("research proposal failed", error);
    return NextResponse.json(
      { error: "조사 제안 처리에 실패했습니다." },
      { status: 500 },
    );
  }
}

/**
 * 근거 적용 단계. 클레임을 잃었거나 캡처가 끊겼으면 아예 시도하지 않고, 시도한
 * 경우의 예외도 여기서 흡수해 호출자가 항상 원장을 남길 수 있게 한다.
 */
async function applyOrSkip(
  foodId: number,
  proposal: ResearchProposal,
  sourceIdByUrl: ReadonlyMap<string, number>,
  claimLost: boolean,
  captureErrored: boolean,
): Promise<{
  readonly appliedCount: number;
  readonly failed: boolean;
  readonly outcomes: readonly EvidenceOutcome[];
}> {
  const skipped = (status: EvidenceOutcome["status"]) =>
    proposal.evidence.map((item) => ({
      nutrientKey: item.nutrientKey,
      sourceUrl: item.sourceUrl,
      status,
      value: item.value,
    }));

  if (claimLost)
    return {
      appliedCount: 0,
      failed: false,
      outcomes: skipped("claim_conflict"),
    };
  if (captureErrored)
    return { appliedCount: 0, failed: true, outcomes: skipped("errored") };

  try {
    const { appliedCount, outcomes } = await applyProposedEvidence(
      foodId,
      proposal,
      sourceIdByUrl,
    );
    return { appliedCount, failed: false, outcomes };
  } catch (error: unknown) {
    console.error("research evidence apply failed", error);
    return { appliedCount: 0, failed: true, outcomes: skipped("errored") };
  }
}

/**
 * 실패한 수집도 원장에 남긴다. 수집 실패는 근거를 못 만들 뿐 DRAFT 값은 건드리지
 * 않으므로, 다른 출처의 근거 적용을 막지 않는다.
 */
async function captureProposedSources(
  foodId: number,
  proposal: ResearchProposal,
): Promise<{
  readonly captures: readonly CaptureOutcome[];
  readonly claimLost: boolean;
  readonly errored: boolean;
  readonly sourceIdByUrl: ReadonlyMap<string, number>;
}> {
  const captures: CaptureOutcome[] = [];
  const sourceIdByUrl = new Map<string, number>();
  let claimLost = false;
  let errored = false;

  for (const source of proposal.sources) {
    // 한 출처가 던져도 그때까지의 진행 상황은 원장에 남겨야 한다. 예외가 그대로
    // 빠져나가면 DB는 이미 바뀐 채 기록이 없고, 그 사료는 skeleton에서 빠져
    // 재조사 대상에서 영구히 사라진다.
    try {
      await captureOneSource(foodId, source, captures, sourceIdByUrl);
    } catch (error: unknown) {
      console.error("research source capture failed", error);
      captures.push({
        kind: source.kind,
        status: "errored",
        url: source.url,
      });
      errored = true;
      break;
    }
    const last = captures.at(-1);
    if (last?.status === "claim_conflict") {
      claimLost = true;
      break;
    }
  }

  return { captures, claimLost, errored, sourceIdByUrl };
}

async function captureOneSource(
  foodId: number,
  source: ResearchProposal["sources"][number],
  captures: CaptureOutcome[],
  sourceIdByUrl: Map<string, number>,
): Promise<void> {
  const captured = await captureSource({
    kind: source.kind,
    url: source.url,
  });
  if (captured.kind === "failure") {
    const sourceId = await createFailedFoodSource({
      capturedAt: null,
      capturedText: null,
      captureMethod: "fetch",
      contentHash: null,
      createdBy: null,
      failureCode: captured.code,
      fetchStatus: "failed",
      foodId,
      kind: source.kind,
      observedAt: null,
      url: source.url,
    });
    captures.push({
      failureCode: captured.code,
      kind: source.kind,
      sourceId,
      status: "failed",
      url: source.url,
    });
    return;
  }

  const replacement = await replaceUnclaimedFoodSource({
    capturedAt: new Date().toISOString(),
    capturedText: captured.capturedText,
    captureMethod: "fetch",
    contentHash: captured.contentHash,
    createdBy: null,
    failureCode: null,
    fetchStatus: "fetched",
    foodId,
    kind: source.kind,
    observedAt: null,
    // 이번 실행이 이미 만든 출처만 소유로 인정된다. 큐레이터 출처든 동시에 도는
    // 다른 실행의 출처든, 내 것이 아니면 RPC가 잠금 안에서 거절한다.
    ownedSourceIds: [...sourceIdByUrl.values()],
    url: captured.url,
  });
  // 수집하는 동안 큐레이터가 출처를 붙였거나 발행했다면 아무것도 쓰지 않는다.
  // 남은 출처도 같은 이유로 거절될 것이므로 더 진행하지 않는다.
  if (replacement.claim === "conflict") {
    captures.push({
      kind: source.kind,
      status: "claim_conflict",
      url: source.url,
    });
    return;
  }
  sourceIdByUrl.set(source.url, replacement.result.sourceId);
  captures.push({
    kind: source.kind,
    sourceId: replacement.result.sourceId,
    status: "captured",
    url: source.url,
  });
}

async function applyProposedEvidence(
  foodId: number,
  proposal: ResearchProposal,
  sourceIdByUrl: ReadonlyMap<string, number>,
): Promise<{
  readonly appliedCount: number;
  readonly outcomes: readonly EvidenceOutcome[];
}> {
  const candidates = proposal.evidence.flatMap((item) => {
    const sourceId = sourceIdByUrl.get(item.sourceUrl);
    return sourceId === undefined
      ? []
      : [
          {
            excerpt: item.excerpt,
            nutrientKey: item.nutrientKey,
            sourceId,
            value: item.value,
          },
        ];
  });

  const sources = candidates.length
    ? await getCurrentFetchedFoodSources(foodId, [
        ...new Set(candidates.map((candidate) => candidate.sourceId)),
      ])
    : [];
  const accepted = validateExtractedEvidence(candidates, sources);
  // 수집 시점의 클레임은 적용 시점까지 유효해야 한다. 그 사이 큐레이터가 다른
  // kind의 출처를 붙였다면 이 실행의 출처는 은퇴되지 않아 검사를 통과하지만,
  // 대상은 이미 사람의 것이다 — RPC가 잠금 안에서 그것을 다시 본다.
  const applied = accepted.length
    ? await applyUnclaimedFoodEvidenceDraft(foodId, accepted, [
        ...sourceIdByUrl.values(),
      ])
    : ({ claim: "claimed", results: [] } as const);

  if (applied.claim === "conflict") {
    return {
      appliedCount: 0,
      outcomes: proposal.evidence.map((item) => ({
        nutrientKey: item.nutrientKey,
        sourceUrl: item.sourceUrl,
        status: "claim_conflict" as const,
        value: item.value,
      })),
    };
  }

  const results = new Map<string, EvidenceOutcome["status"]>(
    applied.results.map((result) => [result.nutrientKey, result.status]),
  );

  const outcomes = proposal.evidence.map((item): EvidenceOutcome => ({
    nutrientKey: item.nutrientKey,
    sourceUrl: item.sourceUrl,
    // ponytail: validateExtractedEvidence는 생존자만 돌려주므로 거절 사유
    // (출처 없음 / 문구 불일치 / 중복 키 / 검증 오류)를 구분하지 못한다.
    // 원인별 진단이 필요해지면 그 함수가 사유를 반환하도록 넓히면 된다.
    status:
      sourceIdByUrl.get(item.sourceUrl) === undefined
        ? "source_unavailable"
        : (results.get(item.nutrientKey) ?? "unverified"),
    value: item.value,
  }));

  return {
    appliedCount: outcomes.filter((outcome) => outcome.status === "applied")
      .length,
    outcomes,
  };
}

function runStatus(
  captures: readonly CaptureOutcome[],
  outcomes: readonly EvidenceOutcome[],
): ResearchRunStatus {
  // 수집 실패와 대상을 뺏긴 것은 다른 사건이다. 전자는 URL이 나빴다는 뜻이고
  // 후자는 대상 선정이 낡았다는 뜻이라, 다음 실행이 달리 행동해야 한다.
  // 클레임을 잃으면 근거를 적용하지 않으므로 이 판정이 가장 먼저 온다.
  if (captures.some((capture) => capture.status === "claim_conflict"))
    return "claim_conflict";
  if (outcomes.some((outcome) => outcome.status === "applied"))
    return "applied";
  if (captures.some((capture) => capture.status === "captured"))
    return "rejected";
  return "capture_failed";
}
