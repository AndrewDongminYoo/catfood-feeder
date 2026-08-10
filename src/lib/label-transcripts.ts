import { createAdminClient } from "./supabase/admin";

/**
 * 사람의 확인을 기다리는 전사 제안. 화면과 API 가 같은 것을 보아야 하므로 한 곳에 둔다.
 *
 * 값은 아직 어디에도 저장되지 않았다. 여기 실린 것은 전부 제안이며, 승인될 때에만
 * `manual` 출처와 근거가 된다.
 */
export type PendingTranscript = {
  readonly brandName: string;
  readonly foodId: number;
  readonly imageUrls: readonly string[];
  readonly productName: string;
  readonly productPageUrl: string;
  readonly runId: number;
  readonly transcript: string;
  readonly values: readonly {
    readonly excerpt: string;
    readonly nutrientKey: string;
    readonly value: number;
  }[];
};

export async function loadPendingTranscripts(): Promise<
  readonly PendingTranscript[]
> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_research_runs")
    .select(
      "id, food_id, proposal, captures, foods!inner(product_name, brands!inner(ko_name))",
    )
    .eq("status", "pending_review")
    .order("id");
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) => {
    const proposal = row.proposal as {
      transcript?: unknown;
      values?: unknown;
    } | null;
    // captures 는 쓰는 곳마다 모양이 다르다 — 형제 라우트(research/proposals)는
    // 배열을 적재하고, 이 전사 경로는 { images, productPageUrl } 객체를 적재한다.
    // status = pending_review 는 오직 이 경로만 쓰므로 실전에서는 항상 객체지만,
    // 아래 typeof 가드는 배열이 들어와도(.productPageUrl 이 undefined) 조용히
    // 걸러내므로 모양을 안 가리고 안전하다.
    const captures = row.captures as {
      images?: { url?: unknown }[];
      productPageUrl?: unknown;
    } | null;
    if (
      typeof proposal?.transcript !== "string" ||
      typeof captures?.productPageUrl !== "string"
    ) {
      // 조용히 버리면 화면에도 안 뜨고 운영자도 모른다 — 다음 브랜드 실행이 같은
      // 사료를 다시 전사해 codex 비용을 또 쓴다.
      console.warn(`pending_review run ${String(row.id)} 형식이 어긋나 건너뜀`);
      return [];
    }
    return [
      {
        brandName: row.foods.brands.ko_name,
        foodId: row.food_id,
        imageUrls: (captures.images ?? [])
          .map((image) => image.url)
          .filter((url): url is string => typeof url === "string"),
        productName: row.foods.product_name,
        productPageUrl: captures.productPageUrl,
        runId: row.id,
        transcript: proposal.transcript,
        values: Array.isArray(proposal.values)
          ? (proposal.values as PendingTranscript["values"])
          : [],
      },
    ];
  });
}
