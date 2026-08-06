import { z } from "zod";
import { nutrientKeySchema } from "./source-apply";
import { SOURCE_KIND_VALUES, isPublicHttpUrl } from "./source-collection";

/**
 * 로컬 조사 에이전트가 제출하는 단일 제안 봉투(proposal envelope).
 *
 * 에이전트는 URL·선정 이유·값·근거 문구만 제안한다. 수집과 근거 검증은 서버가
 * 다시 수행하므로 이 스키마는 "무엇을 주장했는가"만 규정하고 신뢰하지 않는다.
 */
const sourceProposalSchema = z
  .object({
    kind: z.enum(SOURCE_KIND_VALUES),
    reason: z.string().min(1).max(500),
    url: z.string().url(),
  })
  .strict();

const evidenceProposalSchema = z
  .object({
    excerpt: z.string().min(1).max(500),
    nutrientKey: nutrientKeySchema,
    sourceUrl: z.string().url(),
    value: z.number().finite().nonnegative(),
  })
  .strict();

export const researchProposalSchema = z
  .object({
    agent: z
      .object({
        model: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        promptVersion: z.string().min(1).max(40),
        schemaVersion: z.string().min(1).max(40),
      })
      .strict(),
    evidence: z.array(evidenceProposalSchema).min(1).max(8),
    // 출처는 origin regime당 하나다. 같은 kind를 둘 제안하면 뒤엣것이 앞엣것을
    // current에서 밀어내 자기 근거를 무효화하므로 스키마에서 막는다.
    sources: z
      .array(sourceProposalSchema)
      .min(1)
      .max(SOURCE_KIND_VALUES.length),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    const kinds = new Set(proposal.sources.map((source) => source.kind));
    if (kinds.size !== proposal.sources.length) {
      ctx.addIssue({
        code: "custom",
        message: "Each source kind may appear at most once",
        path: ["sources"],
      });
    }

    const urls = new Set<string>();
    for (const [index, source] of proposal.sources.entries()) {
      if (!isPublicHttpUrl(source.url)) {
        ctx.addIssue({
          code: "custom",
          message: "Only public HTTPS URLs are accepted",
          path: ["sources", index, "url"],
        });
      }
      // 같은 URL을 두 regime으로 내면 근거가 어느 출처로 해소될지 모호해지고,
      // apply RPC는 source의 kind에서 source tag를 뽑으므로 manufacturer 값에
      // kr_label 태그가 붙을 수 있다. 측정 출처를 섞지 않는다는 불변식의 문제다.
      if (urls.has(source.url)) {
        ctx.addIssue({
          code: "custom",
          message: "Each source URL may appear at most once",
          path: ["sources", index, "url"],
        });
      }
      urls.add(source.url);
    }

    for (const [index, evidence] of proposal.evidence.entries()) {
      if (!urls.has(evidence.sourceUrl)) {
        ctx.addIssue({
          code: "custom",
          message: "Evidence must cite a proposed source URL",
          path: ["evidence", index, "sourceUrl"],
        });
      }
    }
  });

export type ResearchProposal = Readonly<z.infer<typeof researchProposalSchema>>;
