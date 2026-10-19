# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A mobile-first Next.js App Router product for choosing the next imported dry cat food for an adult cat.
The owner asks a question, confirms explicit conditions, reads source-backed candidates and remaining questions, and saves a decision brief.
`/` enters `/advisor`; the catalog, feeding history, curator tools, and local research broker are supporting surfaces.

Read `docs/product-direction.md` for the product direction and `BLUEPRINT.md` for domain and trust boundaries.
The operator approved this direction and autonomous implementation on 2026-10-18.
Do not replace a working consumer deliverable with an interview assignment or treat a backlog as a product strategy.
Copy voice: warm.

## Commands

```bash
pnpm dev          # local dev — uses --webpack ON PURPOSE (see below), http://localhost:3000
pnpm build        # next build (Turbopack — unaffected by the dev hang)
pnpm start        # production server
pnpm lint         # eslint .
pnpm test         # vitest run (src/**/*.test.{ts,tsx})
pnpm typecheck    # tsc --noEmit
pnpm exec knip    # find unused files/exports/deps
trunk check       # markdownlint, prettier, yamllint, trufflehog, checkov (pre-push gate)
trunk fmt         # format
```

**`pnpm dev` deliberately uses `next dev --webpack`.** Next 16 defaults to Turbopack, which reaches `Ready` but hangs on the first request on this project (build and `next start` are fine). See `docs/specs/dev-server-webpack-fallback-adr.md` for the reversal criteria — do not "fix" this back to plain `next dev` without meeting them.

`pnpm test` runs Vitest over `src/**/*.test.{ts,tsx}`.
The "ACANA Grasslands" case in `src/lib/fixtures.ts` drives `src/lib/fixtures.test.ts` — the fixture's recorded values are asserted against live `computeDerived`/`validate` output, so a change to the domain math fails there.

## Architecture

### Consumer decision workspace

`src/lib/food-decision.ts` evaluates declared ingredient exclusions and calorie-density tolerance, separates met/unknown/failed conditions, and defines versioned local snapshots and export.
`src/components/decision-workspace.tsx` owns the guided current-food, change-reason, condition, and candidate stages; `decision-report.tsx` leads with up to three matching candidates and exposes sources and specific follow-up questions.
Optional protein preferences prioritize the first declared animal ingredient supported by complete source proof, excluding standalone fat, oil, broth, stock, and flavor entries from that preference assessment.
Preferences never change hard eligibility, and ingredient order does not establish taste or meat proportions.
An unclassified leading ingredient blocks a positive preference claim, and a compound meat-and-fat entry is not a standalone fat.
Question reinterpretation unions exclusions and preferences with the current selections and retains the current-calorie ceiling and old hard poultry-order condition.
Only explicit controls remove those selections.
`src/lib/decision-question.ts` validates interpretation proposals; `/api/advisor/question` bounds optional model work using the existing durable quota with a 30-attempt daily ceiling.
The only Anthropic transport remains in `source-extraction.ts`.
The structured form continues to work when model interpretation is unavailable.

`src/lib/decision-catalog.ts` uses a server-only privileged read to project current ingredient proof only for IDs already returned by the published catalog, with matching current source ownership.
It must never return private draft rows, arbitrary captures, or credentials.
Do not relax RLS to provide this projection.

Saved briefs live in browser storage and preserve original evidence and results.
Rechecking is explicit and does not overwrite an older saved snapshot.
`/api/advisor/catalog` bypasses the advisor cache for that explicit fresh read and sends a no-store response.
Qualitative calorie requests and interpreted poultry preferences remain pending until the owner confirms their meaning.
New poultry preferences only change order; preserve the original hard `poultryFirst` behavior of older saved requests.
There is no consumer-triggered background web investigation, automatic monitoring, verified seller availability, or payment integration in this slice.
Legacy `/advisor?current=...` links retain their earlier deterministic behavior.

### Manufacturer adequacy declarations

`scripts/collect-adequacy.mjs` reads retained current manufacturer captures for published foods and writes an optional local JSON review file with exclusive creation.
`src/lib/food-adequacy.ts` recognizes explicit standard declarations, not nutrient footnotes or generic complete-food marketing.
`src/lib/adequacy-collection.ts` preserves capture provenance and quarantines multiple declarations before species filtering.
Collection results remain drafts until product identity is reviewed.
`scripts/apply-adequacy.mjs` defaults to a dry run; `--apply` sends a bounded reviewed manifest only to a local curator broker.
`POST /api/foods/[id]/sources/adequacy` validates a single literal declaration against the current same-food manufacturer capture before calling the service-only `apply_food_adequacy_declaration` RPC.
The RPC locks food then source, rechecks the hash and source ownership, and records the original capture date and applying origin without changing nutrients or publication/verification stamps.
`food_adequacy_declarations` is append-only through this RPC; repeated identical claims skip and conflicting claims are refused without overwriting.
Public reads use the anonymous client with RLS on published foods and current fetched manufacturer sources.
Read-time parsing supplies standard, life stage, and substantiation method; unknown market, package equivalence, and edition remain unknown.
A failed decision recheck retains the previous report; a declaration-only outage leaves the product dossier readable with an explicit unavailable state.
There is no numerical compliance verdict, model call, or fresh source capture in this workflow.

### Source-tagged nutrient model

A single label never fills a whole row, and which half is missing depends on the origin regime. AAFCO labels (North American brands — ACANA) state kcal and the P/F/C energy split but omit ash (회분); EU labels (LEONARDO) state crude ash but usually omit both kcal and the energy split. The Korean importer label fills whichever gap is left, but few importers publish it as text — most put 등록성분량 in a 상세페이지 image, so it typically arrives as a curator transcription (`captureMethod: "manual"` in the source ledger, with the 상세페이지 URL as the reference). So **every nutrient value carries a source tag** — `manufacturer | kr_label | estimated | derived` — stored per-field in `foods.nutrient_sources` (JSONB). Measured and estimated values must never be silently mixed. This invariant drives the schema, the extraction prompt, and the UI.

Three domain rules implemented in `src/lib/domain.ts` (shared server + client):

- **Ash 3-tier fallback** (`resolveAsh`): measured (KR label, or an EU manufacturer label) → if `extrusion`, default `9.0%` (estimated) → otherwise leave null (cannot compute). The estimated tier is the common path for AAFCO-origin products whose importer publishes no text label.
- **P/F/C energy ratio, 2 paths** (`computeDerived`): if the manufacturer states it directly ("X% from protein", parsed by regex in `parseManufacturerEnergy`), use it verbatim; otherwise back-calculate from NFE. NFE carb = `100 − (protein + fat + fiber + ash + moisture)`.
- **Validation** (`validate`): blocking `error`s are guaranteed-analysis sum > 100 (with a float epsilon — a label summing to exactly 100.0 must pass), negative NFE carb, an impossible `kcal_per_kg`, and a manufacturer-stated P/F/C split that misses 100% by more than 2 points. Low protein / high fat / high carb / inverted Ca:P / unusual kcal are `warn`s. `/api/foods` rejects on any `error`-level flag.

`detectSourceConflicts` flags when manufacturer vs KR-label values disagree beyond tolerance — handled by regex, independent of the LLM.
`detectUnbackedSources` flags a nutrient tagged `manufacturer` or `kr_label` when that source text was never supplied; `/new` warns but still saves, since a curator transcribing from a 상세페이지 image legitimately has the numbers before the transcript.

### AI extraction (`src/lib/source-extraction.ts`)

Claude is called **server-side only** (Node runtime, `ANTHROPIC_API_KEY` never exposed). The single caller is `src/lib/source-extraction.ts`, which hits the Anthropic Messages API via raw `fetch`; `/api/extract` and `/api/foods/[id]/sources/extract` both adapt their payloads to it. `src/lib/source-first-boundary.test.ts` pins that single-caller rule. The prompt forces an exact JSON schema and requires a literal `evidence` phrase for every value — no evidence means value/source set to null (hallucination guard). Energy ratios, kcal, and conflicts are then computed by regex on the server, not trusted from the model.

### Supabase layer (`src/lib/supabase/`)

Three clients, picked by trust level — do not interchange them:

- `server.ts` (`createClient`) — SSR client with cookies, **publishable/anon key**, RLS-enforced. Used for reads and user-scoped writes (cats, feeding_logs). Create a fresh client per request (Fluid Compute).
- `client.ts` — browser client, same anon key.
- `admin.ts` (`createAdminClient`) — **service-role key, bypasses RLS**. For scoped privileged operations (`/api/foods`, `/api/foods/[id]/publish`, `/api/recalls/sync`, `/api/foods/drafts`, `src/lib/source-repository.ts`, and `src/lib/research-repository.ts`). The published-only ingredient projection in `src/lib/decision-catalog.ts` is an additional read-only use.
  Never import into client components.

`src/proxy.ts` wires `updateSession` and redirects unauthenticated `/new` requests to login while preserving the original path.
API routes enforce their own authorization as well.
`/api/foods` accepts only a session email in `ADMIN_EMAILS` or an `x-admin-secret` matching `ADMIN_WRITE_SECRET`.
`/api/extract` accepts only an allowlisted human session and consumes a database-backed quota before calling Claude.

### Data access & graceful degradation (`src/lib/catalog.ts`, `feeding.ts`)

`getFoods()` / `getRecalls()` use `unstable_cache` server reads. When Supabase env vars are missing (`isSupabaseConfigured()` is false), they fall back to `SAMPLE_FOODS` fixtures so the catalog renders without a backend. `getFood`/`getComparisonFoods` filter the cached list client-side (dataset is small by design — no server-side search).

`feeding.ts` builds transition insights: it diffs consecutive feeding logs per cat and surfaces kcal/energy-ratio swings, plus flags recalls on the currently-fed product.

### Database (`supabase/migrations/`)

`brands → foods → {recalls, prices}` plus `cats → feeding_logs`. Notable:

- `foods.ca_p_ratio` is a generated stored column; `carb_pct` is a plain column paired with `carb_is_estimated` (computability varies by ash availability).
- `nutrient_sources` and `ingredients` are JSONB; functional flags (`grain_free`, etc.) are plain booleans for fast filtering.
- **RLS:** catalog tables (`foods`, `brands`, `recalls`, `prices`) are public-read; `cats`/`feeding_logs` are owner-only via `auth.uid()`.
- Apply migrations against the linked project with the Supabase CLI; `supabase/migrations/` is the source of truth for schema.

### Recalls sync

`/api/recalls/sync` pulls openFDA Food Enforcement, filters to pet-food entries, loosely matches `recalling_firm` to brands, and upserts on `(source, external_id)`.
Scheduled weekly by `vercel.json` cron and always protected by `CRON_SECRET` in the Bearer header.
Korean recall data is intentionally not synced (no confirmed public API — see `docs/notes/`).

## Conventions

- **Korean is intentional** for all UI strings and code comments. Do not translate them. Commit messages and identifiers stay English.
- Import alias `@/*` → `src/*`. `typedRoutes` is on — route strings are type-checked.
- `next.config.ts` sets `images.unoptimized` (catalog images are external).
- Hand-rolled classes in `src/app/globals.css` (`.card`, `.panel`, `.primary`) — see `DESIGN.md`.
  Tailwind v4 is config-less, and there is no `@/components/ui` directory yet.
- Env: `ANTHROPIC_API_KEY` is server-only (never `NEXT_PUBLIC_`). See `.env.example` for the Supabase key set.
- **Secrets live outside the repository**, at `$HOME/.config/catfood-feeder/env`. `scripts/with-secrets.mjs` loads that path via `process.loadEnvFile` — not `node --env-file`, which Next rejects when it forwards `execArgv` into its Workers' `NODE_OPTIONS`. There is no dotenv file at the repo root by design, because the research runner's `codex` child can read (not write) the filesystem. See `scripts/README.md`.
