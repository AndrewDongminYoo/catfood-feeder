import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { secretsMatch } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type OpenFdaRecall = {
  event_id?: string;
  recall_number?: string;
  recalling_firm?: string;
  reason_for_recall?: string;
  classification?: string;
  code_info?: string;
  report_date?: string;
  product_description?: string;
  distribution_pattern?: string;
};

const OPENFDA_ENDPOINT = "https://api.fda.gov/food/enforcement.json";

export async function GET(req: NextRequest) {
  return syncRecalls(req);
}

export async function POST(req: NextRequest) {
  return syncRecalls(req);
}

async function syncRecalls(req: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!configuredSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }
  const bearer = auth?.startsWith("Bearer ")
    ? auth.slice("Bearer ".length)
    : null;
  if (!secretsMatch(configuredSecret, bearer)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${OPENFDA_ENDPOINT}?sort=report_date:desc&limit=100`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `openFDA ${response.status}` },
        { status: 502 },
      );
    }

    const json = (await response.json()) as { results?: OpenFdaRecall[] };
    const results = (json.results ?? []).filter(isPetFoodRecall);
    const supabase = createAdminClient();

    const { data: brands, error: brandError } = await supabase
      .from("brands")
      .select("id, name");
    if (brandError) throw new Error(brandError.message);

    const recordsByExternalId = new Map<
      string,
      {
        brand_id: number | null;
        source: string;
        source_url: string;
        external_id: string;
        recalling_firm: string | null;
        reason: string | null;
        classification: string | null;
        affected_lots: string | null;
        recall_date: string | null;
        region: string;
      }
    >();
    for (const recall of results) {
      const externalId = recallExternalId(recall);
      if (!externalId) continue;
      recordsByExternalId.set(externalId, {
        brand_id: matchBrandId(brands ?? [], recall),
        source: "openFDA",
        source_url: recall.event_id
          ? `${OPENFDA_ENDPOINT}?search=event_id:${encodeURIComponent(recall.event_id)}`
          : `${OPENFDA_ENDPOINT}?search=recall_number:${encodeURIComponent(recall.recall_number ?? "")}`,
        external_id: externalId,
        recalling_firm: recall.recalling_firm ?? null,
        reason: recall.reason_for_recall ?? null,
        classification: recall.classification ?? null,
        affected_lots: recall.code_info ?? null,
        recall_date: toDate(recall.report_date),
        region: "US",
      });
    }
    const records = [...recordsByExternalId.values()];
    const skipped = results.length - records.length;

    if (records.length === 0) {
      return NextResponse.json({ inserted: 0, skipped });
    }

    const { error } = await supabase
      .from("recalls")
      .upsert(records, { onConflict: "source,external_id" });

    if (error) throw new Error(error.message);

    return NextResponse.json({ inserted: records.length, skipped });
  } catch (error) {
    console.error("recalls sync failed", error);
    return NextResponse.json(
      { error: "리콜 동기화에 실패했습니다." },
      { status: 500 },
    );
  }
}

function recallExternalId(recall: OpenFdaRecall): string | null {
  if (recall.recall_number) return `recall:${recall.recall_number}`;
  if (!recall.event_id) return null;

  const productIdentity = [recall.product_description, recall.code_info]
    .filter(Boolean)
    .join("\u0000");
  if (!productIdentity) return null;
  const digest = createHash("sha256").update(productIdentity).digest("hex");
  return `event:${recall.event_id}:${digest}`;
}

function isPetFoodRecall(recall: OpenFdaRecall) {
  const text = [
    recall.product_description,
    recall.reason_for_recall,
    recall.distribution_pattern,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(cat|kitten|pet|dog|canine|feline)\b/.test(text);
}

function matchBrandId(
  brands: { id: number; name: string }[],
  recall: OpenFdaRecall,
) {
  const haystack = [
    recall.recalling_firm,
    recall.product_description,
    recall.reason_for_recall,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    brands.find((brand) => haystack.includes(brand.name.toLowerCase()))?.id ??
    null
  );
}

function toDate(value: string | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
