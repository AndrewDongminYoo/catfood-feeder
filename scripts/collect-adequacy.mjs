#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadSecrets, SECRETS_FILE } from "./with-secrets.mjs";
import { selectAll } from "./select-all.mjs";
import { buildAdequacyCollection } from "../src/lib/adequacy-collection.ts";

export function parseAdequacyArgs(args) {
  let output = null;
  let foodIds = [];
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--out", "--food-ids"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      seen.has(flag)
    ) {
      throw new Error(
        "usage: node scripts/collect-adequacy.mjs [--out review.json] [--food-ids 30,141]",
      );
    }
    seen.add(flag);
    if (flag === "--out") output = value;
    else {
      if (!/^\d+(?:,\d+)*$/.test(value))
        throw new Error("Food IDs must be comma-separated positive integers.");
      foodIds = value.split(",").map(Number);
      if (
        foodIds.length > 200 ||
        foodIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(foodIds).size !== foodIds.length
      )
        throw new Error("Provide 1–200 unique positive food IDs.");
    }
  }
  return { output, foodIds };
}

export async function collectAdequacyCaptures(client, foodIds = []) {
  const sources = await selectAll((from, to) => {
    let query = client
      .from("food_sources")
      .select(
        "id,food_id,kind,fetch_status,is_current,url,captured_at,content_hash,captured_text,foods!inner(id,product_name,published_at)",
      )
      .eq("is_current", true)
      .eq("fetch_status", "fetched")
      .eq("kind", "manufacturer")
      .not("foods.published_at", "is", null)
      .order("id");
    if (foodIds.length) query = query.in("food_id", foodIds);
    return query.range(from, to);
  });
  return buildAdequacyCollection(sources, new Date().toISOString());
}

async function main() {
  const { output, foodIds } = parseAdequacyArgs(process.argv.slice(2));
  loadSecrets();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      `Supabase read credentials are missing from ${SECRETS_FILE}.`,
    );
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const manifest = await collectAdequacyCaptures(client, foodIds);
  if (output)
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
  console.log(
    JSON.stringify(
      {
        generatedAt: manifest.generatedAt,
        sourceCount: manifest.sourceCount,
        foodCount: manifest.foodCount,
        declarationCount: manifest.declarations.length,
        declarationSourceCount: manifest.declarationSourceCount,
        declarationFoodCount: manifest.declarationFoodCount,
        unresolvedSources: manifest.unresolved.length,
        identityReviewSources: manifest.identityReview.length,
        status: "draft_only",
        databaseWrites: 0,
        output,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
