import { selectAll } from "../../scripts/select-all.mjs";
import { createAdminClient } from "./supabase/admin";
import type { ResearchRunStatus } from "./research-repository";

const EXCEPTION_STATUSES = [
  "capture_failed",
  "claim_conflict",
  "errored",
  "invalid",
  "rejected",
] as const satisfies readonly ResearchRunStatus[];

type ResearchExceptionRow = {
  readonly created_at: string;
  readonly evidence_results: unknown;
  readonly food_id: number;
  readonly foods: {
    readonly brands: { readonly name: string } | null;
    readonly product_name: string;
  } | null;
  readonly id: number;
  readonly proposal: unknown;
  readonly status: string;
};

export type ResearchException = {
  readonly brandName: string | null;
  readonly createdAt: string;
  readonly foodId: number;
  readonly id: number;
  readonly productName: string;
  readonly reason: string;
  readonly status: (typeof EXCEPTION_STATUSES)[number];
};

export async function loadResearchExceptions(): Promise<
  readonly ResearchException[]
> {
  const supabase = createAdminClient();
  const rows = (await selectAll(
    async (from, to) =>
      await supabase
        .from("food_research_runs")
        .select(
          "id, food_id, status, created_at, proposal, evidence_results, foods:food_id(product_name, brands:brand_id(name))",
        )
        .in("status", [...EXCEPTION_STATUSES])
        .order("id", { ascending: false })
        .range(from, to),
  )) as ResearchExceptionRow[];

  return rows.flatMap((row) => {
    if (!isExceptionStatus(row.status)) return [];
    if (row.status === "rejected" && !isSourceResearchProposal(row.proposal)) {
      return [];
    }
    return [toResearchException({ ...row, status: row.status })];
  });
}

function isSourceResearchProposal(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "sources" in value &&
    Array.isArray(value.sources)
  );
}

export function toResearchException(
  row: ResearchExceptionRow & {
    readonly status: (typeof EXCEPTION_STATUSES)[number];
  },
): ResearchException {
  return {
    brandName: row.foods?.brands?.name ?? null,
    createdAt: row.created_at,
    foodId: row.food_id,
    id: row.id,
    productName: row.foods?.product_name ?? `Food ${row.food_id}`,
    reason: readTerminalReason(row.evidence_results) ?? row.status,
    status: row.status,
  };
}

function isExceptionStatus(
  value: string,
): value is (typeof EXCEPTION_STATUSES)[number] {
  return EXCEPTION_STATUSES.some((status) => status === value);
}

function readTerminalReason(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "terminalReason" in value &&
    typeof value.terminalReason === "string" &&
    value.terminalReason.length > 0
  ) {
    return value.terminalReason;
  }
  return null;
}
