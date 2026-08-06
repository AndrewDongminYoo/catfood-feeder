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
  applyFoodEvidenceDraft,
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
    };

type EvidenceOutcome = {
  readonly nutrientKey: string;
  readonly sourceUrl: string;
  readonly value: number;
  readonly status:
    "applied" | "skipped" | "conflict" | "unverified" | "source_unavailable";
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

    const { captures, sourceIdByUrl } = await captureProposedSources(
      foodId,
      proposal,
    );
    const { appliedCount, outcomes } = await applyProposedEvidence(
      foodId,
      proposal,
      sourceIdByUrl,
    );

    const status = runStatus(captures, outcomes);
    const runId = await recordFoodResearchRun({
      captures,
      evidenceResults: outcomes,
      foodId,
      proposal,
      status,
    });

    return NextResponse.json({
      appliedCount,
      captures,
      evidence: outcomes,
      runId,
      status,
    });
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
 * 실패한 수집도 원장에 남긴다. 수집 실패는 근거를 못 만들 뿐 DRAFT 값은 건드리지
 * 않으므로, 다른 출처의 근거 적용을 막지 않는다.
 */
async function captureProposedSources(
  foodId: number,
  proposal: ResearchProposal,
): Promise<{
  readonly captures: readonly CaptureOutcome[];
  readonly sourceIdByUrl: ReadonlyMap<string, number>;
}> {
  const captures: CaptureOutcome[] = [];
  const sourceIdByUrl = new Map<string, number>();

  for (const source of proposal.sources) {
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
      continue;
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
      break;
    }
    sourceIdByUrl.set(source.url, replacement.result.sourceId);
    captures.push({
      kind: source.kind,
      sourceId: replacement.result.sourceId,
      status: "captured",
      url: source.url,
    });
  }

  return { captures, sourceIdByUrl };
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
  const results = new Map<string, EvidenceOutcome["status"]>(
    accepted.length
      ? (await applyFoodEvidenceDraft(foodId, accepted)).map((result) => [
          result.nutrientKey,
          result.status,
        ])
      : [],
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
  if (outcomes.some((outcome) => outcome.status === "applied"))
    return "applied";
  if (captures.some((capture) => capture.status === "captured"))
    return "rejected";
  // 수집 실패와 대상을 뺏긴 것은 다른 사건이다. 전자는 URL이 나빴다는 뜻이고
  // 후자는 대상 선정이 낡았다는 뜻이라, 다음 실행이 달리 행동해야 한다.
  if (captures.some((capture) => capture.status === "claim_conflict"))
    return "claim_conflict";
  return "capture_failed";
}
