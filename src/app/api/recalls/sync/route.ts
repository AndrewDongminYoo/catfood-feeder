import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (configuredSecret && auth !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${OPENFDA_ENDPOINT}?sort=report_date:desc&limit=100`,
      { next: { revalidate: 60 * 60 * 24 * 7 } },
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

    const records = results.map((recall) => {
      const externalId = recall.event_id ?? recall.recall_number ?? null;
      return {
        brand_id: matchBrandId(brands ?? [], recall),
        source: "openFDA",
        source_url: externalId
          ? `${OPENFDA_ENDPOINT}?search=event_id:${encodeURIComponent(externalId)}`
          : OPENFDA_ENDPOINT,
        external_id: externalId,
        recalling_firm: recall.recalling_firm ?? null,
        reason: recall.reason_for_recall ?? null,
        classification: recall.classification ?? null,
        affected_lots: recall.code_info ?? null,
        recall_date: toDate(recall.report_date),
        region: "US",
      };
    });

    if (records.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0 });
    }

    const { error } = await supabase
      .from("recalls")
      .upsert(records, { onConflict: "source,external_id" });

    if (error) throw new Error(error.message);

    return NextResponse.json({ inserted: records.length, skipped: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
