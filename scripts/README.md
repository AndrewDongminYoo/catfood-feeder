# Catalog ingestion & research-agent pipeline

Two-phase pipeline that turns an external product list into the project's core asset (human-verified, source-tagged nutrient data).
Both scripts read credentials from `.env.local` via `node --env-file=.env.local`.

## Phase A — `ingest-petfriends.mjs` (worklist)

Filters `pet-fritends.json` to dry cat food (kg-weight >= 1, excluding wet/treat/sample), normalizes brand names, and inserts `brands` + `foods` skeleton rows (`brand` + `product_name` + `weight_kg`, no nutrients).
Prices are omitted per `BLUEPRINT.md` (pricing is deferred).
The skeleton rows are the **curation worklist** — the input queue for Phase B.

```bash
node --env-file=.env.local scripts/ingest-petfriends.mjs --dry   # preview, no writes
node --env-file=.env.local scripts/ingest-petfriends.mjs         # ingest
```

Idempotent on `(source, external_id)` once migration `0003_foods_external_source.sql` is applied; until then it dedups by `(brand_id, product_name)`, which collapses same-name listings.

## Phase B — `research-enrich.mjs` (research agent)

For a skeleton row (a food with `protein_pct` null), the agent uses Claude + `web_search` to retrieve the **manufacturer guaranteed-analysis text** and the **Korean importer label text** from the live web, then extracts values under the same evidence-gating discipline as `src/app/api/extract/route.ts`: every value needs a literal evidence phrase from retrieved text, otherwise value/source is null (no hallucination).
It writes a **draft** — measured values + `nutrient_sources` — and deliberately leaves `data_verified_at` null, because machine extraction is not human verification.
Derived values (NFE carb, P/F/C energy ratios) stay in `src/lib/domain.ts` and are computed when a human reviews and saves.

```bash
node --env-file=.env.local scripts/research-enrich.mjs --name "오리젠"      # dry, 1 row
node --env-file=.env.local scripts/research-enrich.mjs --limit 3            # dry, sample
node --env-file=.env.local scripts/research-enrich.mjs --id 42 --write      # persist draft
```

Default is dry-run; `--write` is required to persist.

## Reference data — `수입사료정리 - DB.csv`

The founder's 2023 curated nutrient sheet (~290 rows, English brand names).
It is a **reference / validation source, not a direct ingest source**: it has final nutrient values but **no per-field source tags**, so ingesting it would violate the measured-vs-estimated source-tagging invariant — and it is stale (BLUEPRINT says re-collect).
Use it to cross-check Phase B output, not to populate `nutrient_sources` directly.
