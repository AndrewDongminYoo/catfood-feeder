# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A mobile-first Next.js 16 (App Router) app for curating **imported cat-food nutrition data**.
There is no public structured dataset for these products in Korea, so the core asset is human-verified, source-tagged nutrient data — not crawled prices.
The app has three surfaces: an **admin input tool** (`/new`) that extracts label text into structured data, a **curator source workspace** (`/new/research` plus `api/foods/[id]/sources/*`) that captures approved sources and applies evidence-backed drafts, and a **public catalog** (`/foods`, `/compare`, `/recalls`, `/feeding`).

`BLUEPRINT.md` is the authoritative spec (decisions, phases, domain rules). Read it before changing domain logic.

## Commands

```bash
pnpm dev          # local dev — uses --webpack ON PURPOSE (see below), http://localhost:3000
pnpm build        # next build (Turbopack — unaffected by the dev hang)
pnpm start        # production server
pnpm lint         # eslint .
pnpm test         # vitest run (src/**/*.test.ts)
pnpm typecheck    # tsc --noEmit
pnpm exec knip    # find unused files/exports/deps
trunk check       # markdownlint, prettier, yamllint, trufflehog, checkov (pre-push gate)
trunk fmt         # format
```

**`pnpm dev` deliberately uses `next dev --webpack`.** Next 16 defaults to Turbopack, which reaches `Ready` but hangs on the first request on this project (build and `next start` are fine). See `docs/specs/dev-server-webpack-fallback-adr.md` for the reversal criteria — do not "fix" this back to plain `next dev` without meeting them.

`pnpm test` runs Vitest over `src/**/*.test.ts`.
The "ACANA Grasslands" case in `src/lib/fixtures.ts` drives `src/lib/fixtures.test.ts` — the fixture's recorded values are asserted against live `computeDerived`/`validate` output, so a change to the domain math fails there.

## Architecture

### Source-tagged nutrient model (the central idea)

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
- `admin.ts` (`createAdminClient`) — **service-role key, bypasses RLS**. Only for privileged writes (`/api/foods`, `/api/recalls/sync`, `/api/foods/drafts`, and `src/lib/source-repository.ts`). Never import into client components.

`src/proxy.ts` wires `updateSession` and redirects unauthenticated `/new` requests to login while preserving the original path.
API routes enforce their own authorization as well.
`/api/foods` accepts only a session email in `ADMIN_EMAILS` or an `x-admin-secret` matching `ADMIN_WRITE_SECRET`.
`/api/extract` accepts only an allowlisted human session and consumes a database-backed quota before calling Claude.

### Data access & graceful degradation (`src/lib/catalog.ts`, `feeding.ts`)

`getFoods()` / `getRecalls()` are `react.cache`-wrapped server reads. When Supabase env vars are missing (`isSupabaseConfigured()` is false), they fall back to `SAMPLE_FOODS` fixtures so the catalog renders without a backend. `getFood`/`getComparisonFoods` filter the cached list client-side (dataset is small by design — no server-side search).

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
- Hand-rolled classes in `src/app/globals.css` (`.card`, `.panel`, `.primary`) — see `DESIGN.md`. Tailwind v4, config-less. `radix-ui`/`lucide-react`/`class-variance-authority` are installed but unused; there is no `@/components/ui` directory yet.
- Env: `ANTHROPIC_API_KEY` is server-only (never `NEXT_PUBLIC_`). See `.env.example` for the Supabase key set.
