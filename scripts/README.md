# Catalog ingestion & research-agent pipeline

Two-phase pipeline that turns an external product list into the project's core asset (human-verified, source-tagged nutrient data).
Both scripts read credentials from `.env.local` via `node --env-file=.env.local`.

## Phase A — `ingest-petfriends.mjs` (worklist)

Filters `pet-fritends.json` to dry cat food (kg-weight >= 1, excluding wet/treat/sample), normalizes brand names, and inserts `brands` + `foods` skeleton rows (`brand` + `product_name` + `weight_kg`, no nutrients).
Prices are omitted per `BLUEPRINT.md` (pricing is deferred).
The skeleton rows are the **curation worklist** for the protected `/new/research` workflow.

```bash
node --env-file=.env.local scripts/ingest-petfriends.mjs --dry   # preview, no writes
node --env-file=.env.local scripts/ingest-petfriends.mjs         # ingest
```

Requires migration `0003_foods_external_source.sql` and is idempotent on `(source, external_id)`.
Rows created by the pre-0003 fallback have NULL identifiers and are skipped rather than guessed into a new source identity.

## Phase B — source-first curation

For a skeleton row, a human curator registers manufacturer or Korean-label product URLs in `/new/research`.
The server captures bounded source text, an LLM extracts candidates from that captured text only, and the curator explicitly applies evidence-backed values as a DRAFT.
The workflow leaves `data_verified_at` null until human verification.
Derived values remain server-derived.

## Phase B′ — `research-run.mjs` (local research agent)

The AI-native path for the same skeleton rows, added by `docs/notes/2026-08-05-ai-native-catalog-turnaround.md`.
A local Codex agent researches the public web and proposes source URLs, values, and literal excerpts; the server re-fetches every URL itself and re-verifies every excerpt before anything reaches a DRAFT.

```bash
pnpm dev                                  # the broker runs inside the app
pnpm research:run --food 123              # research one skeleton draft
```

Requires `RESEARCH_AGENT_SECRET` in `.env.local` and a logged-in `codex` CLI.
Optional: `RESEARCH_BROKER_URL` (default `http://localhost:3000`), `RESEARCH_AGENT_MODEL` (default `gpt-5.6-terra`).

What holds the boundary:

- `RESEARCH_AGENT_SECRET` opens **only** `/api/research/*`. No admin or publish route accepts it, and `src/lib/research-boundary.test.ts` pins that.
- The child `codex exec` process gets an allowlisted environment (`PATH`, `HOME` → an empty temp dir, `CODEX_HOME`, `LANG`, `TMPDIR`) and runs `--sandbox read-only --ephemeral --ignore-user-config` outside the repo. It never sees the broker secret or any Supabase key.
- The target must be a **skeleton** draft: unpublished _and_ carrying no current source. An agent URL must never displace a curator's captured source.
- Every proposal that reaches capture — including one whose evidence is rejected or whose fetch fails — is appended to `food_research_runs` so the next run does not re-research the same dead end. A proposal rejected at the schema or target check is refused with a 4xx and leaves no ledger row.
- A partial capture (manufacturer succeeds, importer page fails) still makes the row non-skeleton, so the agent path will not revisit it; register the missing half by hand in `/new/research`.
- Publication stays human-only. This path writes DRAFT nutrient values and never sets `published_at`.

## Reference data — `수입사료정리 - DB.csv`

The founder's 2023 curated nutrient sheet (~290 rows, English brand names).
It is a **reference / validation source, not a direct ingest source**: it has final nutrient values but **no per-field source tags**, so ingesting it would violate the measured-vs-estimated source-tagging invariant — and it is stale (BLUEPRINT says re-collect).
Use it to cross-check the source-first curation output, not to populate `nutrient_sources` directly.
