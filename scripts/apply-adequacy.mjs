#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSecrets } from "./with-secrets.mjs";

export function parseApplyAdequacyArgs(args) {
  const apply = args.includes("--apply");
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (
    files.length !== 1 ||
    args.some((arg) => arg.startsWith("--") && arg !== "--apply") ||
    args.filter((arg) => arg === "--apply").length > 1
  )
    throw new Error(
      "usage: node scripts/apply-adequacy.mjs reviewed.json [--apply]",
    );
  return { file: files[0], apply };
}
export async function applyAdequacyManifest({
  manifest,
  apply,
  baseUrl = "http://127.0.0.1:3000",
  adminSecret = "",
  fetchImpl = fetch,
}) {
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.approved) ||
    !manifest.approved.length ||
    manifest.approved.length > 200
  )
    throw new Error("A bounded reviewed adequacy manifest is required");
  const seen = new Set();
  for (const row of manifest.approved) {
    if (
      !Number.isSafeInteger(row.foodId) ||
      row.foodId <= 0 ||
      !Number.isSafeInteger(row.sourceId) ||
      row.sourceId <= 0 ||
      !row.sourceContentHash ||
      typeof row.statement !== "string" ||
      typeof row.sourceProductName !== "string" ||
      !row.statement.includes(row.sourceProductName) ||
      seen.has(`${row.foodId}:${row.sourceId}`)
    )
      throw new Error("Invalid or duplicate reviewed declaration");
    seen.add(`${row.foodId}:${row.sourceId}`);
  }
  const tally = {
    dryRun: !apply,
    target: manifest.approved.length,
    applied: 0,
    skipped: 0,
    conflict: 0,
    refused: 0,
  };
  if (!apply) return tally;
  const root = new URL(baseUrl);
  // Never send the curator secret to an arbitrary remote endpoint.
  if (
    root.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(root.hostname) ||
    root.username ||
    root.password ||
    root.pathname !== "/" ||
    root.search ||
    root.hash ||
    !adminSecret
  )
    throw new Error("Apply requires a local broker and curator secret");
  for (const row of manifest.approved) {
    const { sourceId, statement, sourceProductName, sourceContentHash } = row;
    const response = await fetchImpl(
      new URL(`/api/foods/${row.foodId}/sources/adequacy`, root),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "content-type": "application/json",
          "x-admin-secret": adminSecret,
        },
        body: JSON.stringify({
          sourceId,
          statement,
          sourceProductName,
          sourceContentHash,
        }),
      },
    );
    const payload = await response.json();
    const result = payload?.result?.status;
    if (!response.ok || !["applied", "skipped", "conflict"].includes(result)) {
      tally.refused++;
      throw new Error(
        `Food ${row.foodId} refused (${response.status}); stopped after ${tally.applied + tally.skipped + tally.conflict} results`,
      );
    }
    tally[result]++;
    if (result === "conflict")
      throw new Error(
        `Food ${row.foodId} conflicts; stopped without overwriting evidence`,
      );
  }
  return tally;
}
async function main() {
  const args = parseApplyAdequacyArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(args.file, "utf8"));
  loadSecrets();
  console.log(
    JSON.stringify(
      await applyAdequacyManifest({
        manifest,
        apply: args.apply,
        baseUrl: process.env.CATFOOD_BASE_URL ?? "http://127.0.0.1:3000",
        adminSecret: process.env.ADMIN_WRITE_SECRET,
      }),
      null,
      2,
    ),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
