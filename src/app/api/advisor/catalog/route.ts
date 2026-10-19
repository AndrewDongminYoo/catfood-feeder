import { NextResponse } from "next/server";
import { getDecisionCatalog } from "@/lib/decision-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await getDecisionCatalog({ fresh: true });
  return NextResponse.json(catalog, {
    status: catalog.available ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
