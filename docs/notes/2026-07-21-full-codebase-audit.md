# Full codebase audit — 2026-07-21

Status: Mostly resolved on branch `fix/audit-2026-07-21`

Most findings below are fixed; each remaining one is marked OPEN with the reason.
`src/types/supabase.d.ts` was regenerated from the linked project after the migrations were applied; it was never hand-edited. The curator workspace UI is untouched.

Read-only audit of the whole repository at commit `e317ecf`, covering 5,189 LOC across 46 source files and 8 migrations.
Five parallel reviewers each read their scope in full; numeric claims in the domain section were confirmed by executing the real functions rather than by inspection.
Findings are ordered by severity, not by area.

## What was fixed

Everything below is on branch `fix/audit-2026-07-21`, verified by `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm exec knip`, and `trunk check`.

**Correctness**

- `apply_food_evidence_draft` no longer aborts the batch on an already-populated nutrient, normalizes excerpts with NFKC on both sides, and refuses foods where `data_verified_at` is set (`supabase/migrations/20260721022014_fix_evidence_apply_semantics.sql`).
- `validate` accepts labels whose decimal sum is exactly 100%, and now blocks impossible `kcal_per_kg` and a manufacturer P/F/C split missing 100% by more than 2 points (`src/lib/domain.ts`).
- `num()` returns null for ranges and multi-dot values instead of silently truncating to the leading run.
- `/compare` with no `ids` renders nothing rather than presenting two arbitrary products as a comparison.

**Trust boundaries**

- Every POST route streams its body through `src/lib/request-body.ts` with an explicit cap; oversize bodies get 413 before being buffered.
- `/api/cats` validates with zod like every other write route.
- `CRON_SECRET` is compared with `timingSafeEqual` via the newly shared `secretsMatch`.
- Raw Postgres messages are no longer returned to clients; they go to `console.error` instead.
- `/api/foods/[id]/sources/extract` charges the quota before its DB lookups, closing the unmetered existence oracle.
- The IPv6 deny-list now parses addresses into bytes and reduces every IPv4-bearing form (6to4, NAT64, Teredo, mapped, compatible) back through the IPv4 rules.

**Collection pipeline**

- Responses are decoded with the declared charset, so euc-kr importer pages no longer capture as mojibake.
- Extraction retries once on 5xx or socket errors, and `max_tokens` is raised so long ingredient lists stop truncating the JSON.
- A failed request no longer wipes the curator's pasted transcript or extraction candidates.

**Verification layer**

- `pnpm test` exists and collects only `src/**/*.test.ts`; the suite went from 191 failing files to 6 passing files / 36 tests.
- `src/lib/fixtures.test.ts` makes the ACANA case drive real domain math, so the "regression check" claim is now true.
- `src/lib/source-first-boundary.test.ts` fails if the autonomous-enrichment script returns or a second Anthropic caller appears.
- `knip.json` and `eslint.config.mjs` exclude `.trunk`/`.remember` correctly; knip reports clean without being told to ignore live code.

**Cleanup**

- `research_attempted_at` / `research_last_result` dropped; `recalls.food_id` and `feeding_logs.food_id` indexed (`supabase/migrations/20260721022500_...sql`).
- `@ai-sdk/anthropic` and `ai` removed with the lockfile.
- `prices` is no longer fetched on every catalog read (schema kept for Phase 5).
- `nutrient_sources` is keyed by `NutrientSourceKey` instead of `string`.
- The duplicated ACANA constants in `/new` now import from `fixtures.ts`.
- Dead branch in `parseModelOutput`, redundant `kcal_per_kg` regex, and the unused `SOURCE_FETCH_STATUS_VALUES` export removed.

**Accessibility**

- `maximumScale: 1` removed from the viewport (WCAG 1.4.4).
- The three `/new` textareas are associated with their labels via `htmlFor`/`id`.
- The comparison toggle exposes `aria-pressed`.

**Docs** — `CLAUDE.md`, `AGENTS.md`, the spec's two field tables, and the plan checkboxes now match the code.

## Found during live testing (not in the original audit)

**`/api/foods` rejected every product whose manufacturer text lacks an explicit energy split.**

`parseManufacturerEnergy` returns `null` when the text has no "X% from protein" phrasing, `/new` serializes that `null` straight into the payload, and the schema declared `mfg_energy` as `.optional()` — which accepts `undefined`, not `null`. Confirmed by running the real schema:

```log
parseManufacturerEnergy(LEONARDO label) -> null
JSON.stringify({ mfg_energy: null })    -> {"mfg_energy":null}
schema.safeParse: undefined -> true, null -> false, object -> true
```

The curator saw only `요청 형식이 올바르지 않습니다` with no indication of which field was at fault. The ACANA fixture _does_ carry the phrasing, which is exactly why neither the fixture regression test nor the audit's static reading caught it — the one label the project tests with is the one label that avoids the bug.

Fixed by accepting `null` and normalizing it to `undefined` at the schema boundary. The schema moved to `src/lib/food-payload.ts` so `src/lib/food-payload.test.ts` can pin the contract against the exact payload `/new` builds. `vitest.config.ts` also gained the `@/*` alias, without which any test touching a module that uses `@/` fails to resolve.

This is a reminder that the audit was a static reading. Three parallel reviewers read `/api/foods` in full and none flagged it, because spotting it required knowing what the client actually sends at runtime.

## Still open

| Item                                                                                     | Why it was not fixed                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSRF DNS rebinding (TOCTOU) in `source-fetcher.ts`                                       | Closing it needs a pinned-lookup undici `Agent` — a new dependency. Fetching the validated IP directly would break HTTPS certificate validation. Marked with a `ponytail:` comment naming the upgrade path. Reachable only with a curator session.                                                                                               |
| `food_sources.kind` typed wider than its CHECK constraint                                | Not drift after all, and not fixable by regeneration: the column's Postgres type genuinely is `nutrient_source`, and the two-value restriction lives in a CHECK the generator cannot see. `insert({ kind: "estimated" })` still typechecks and fails at runtime. Narrowing needs a dedicated enum for the column or a hand-written wrapper type. |
| Curator workspace UI: transcript viewer, failed-source list and retry                    | Deferred by decision — needs a screen design pass. The data is already in the ledger and partly on the wire.                                                                                                                                                                                                                                     |
| `source-research-client.test.tsx` (action-order invariant)                               | Needs jsdom and a React testing library. Deferred with the UI work above; the three plan steps are left unchecked and annotated.                                                                                                                                                                                                                 |
| `replaceCurrentFoodSource` is not transactional                                          | Folding its three writes into an RPC is a new migration and a design decision beyond this pass.                                                                                                                                                                                                                                                  |
| Minimum excerpt length                                                                   | `isEvidenceExcerpt` still accepts a two-character excerpt like `"37"`. A safe minimum needs real-label data to calibrate.                                                                                                                                                                                                                        |
| `radix-ui` / `lucide-react` / `class-variance-authority` / `shadcn` installed but unused | Removing them presumes shadcn/ui will never be adopted — a product call. `CLAUDE.md` now describes the actual styling instead.                                                                                                                                                                                                                   |

## Original findings

## 1. Shipped behavior that is broken

### A. The two-source curation workflow cannot be completed (fixed)

`apply_food_evidence_draft` updated `WHERE <col> IS NULL` and then raised `Nutrient % is already populated` whenever `ROW_COUNT <> 1`.
`source-research-client.tsx:96` always posts the entire candidate array with no per-nutrient selection, so this was deterministic:

```log
apply manufacturer evidence  → protein_pct, fat_pct written
register KR label, extract   → protein re-emitted alongside ash
apply (2nd)                  → raises on protein_pct → transaction rolls back → ash_pct lost
```

The spec (`docs/specs/2026-07-15-source-first-catalog-collection.md:117`) scopes the write to "missing DRAFT food fields", so a populated column is a skip, not an error.

### B. Labels summing to exactly 100% were rejected (fixed)

`domain.ts` summed raw floats with no epsilon while the message rounded to 1 dp, so the predicate and the text disagreed:

```log
protein 25, fat 32.2, fiber 11.9, ash 15.9, moisture 15   (decimal sum 100.0)
float sum → 100.00000000000001
flag      → error "보장성분 합계 100% — 100% 초과(입력 오류 가능)"
```

`/api/foods/route.ts:115` rejects on any `error` flag, so the curator was blocked by a self-contradictory message.

### C. The evidence gate diverged between TypeScript and SQL (fixed)

`normalizeSourceText` (`src/lib/source-collection.ts:13`) applies NFKC; the RPC's `position(...)` check did not.
A page containing fullwidth text (`Ｐｒｏｔｅｉｎ 37%`) passed `validateExtractedEvidence` and was then rejected by the RPC, surfacing through the bare `catch` at `apply/route.ts:85` as a generic 500 with no indication of which nutrient failed or why.

Note `20260715153018_fix_food_evidence_excerpt_normalization.sql` claims this fix in its filename but shipped a byte-identical copy of the function body — added in the _same_ commit (`caf2fed`) as the original, with no subsequent edit under `git log --follow`.
The only delta is a trailing `REVOKE`/`GRANT` block outside the function body.

### D. `num()` silently truncates values — OPEN

`src/lib/domain.ts:36` strips everything except `[0-9.\-]` then takes the leading `parseFloat` run:

```log
num("1.9-2.1") → 1.9      // stated range collapses to its lower bound
num("3.850")   → 3.85     // EU thousands separator → 3850 kcal/kg becomes 3.85
num("10.5.2")  → 10.5
```

`validate` applies no bound to `kcal_per_kg`, so the `3.850` case saves cleanly and renders as "4 kcal/kg".

### E. Manufacturer-stated P/F/C is accepted unvalidated — OPEN

`domain.ts:252` returns whatever three regexes capture; `validate` never checks that the three sum to ~100.
An OCR typo dropping a digit (`37% protein, 23% carbs, 4% fat` = 64%) is stored verbatim and tagged `manufacturer`, i.e. presented as measured.
The NFE path is never consulted as a cross-check even when every input for it is present.

## 2. Trust boundaries — all OPEN

| Location                   | Issue                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger.sql:101`           | The apply RPC never checks the food is a DRAFT. A POST to a verified food's id fills a NULL nutrient on a public row and merges a machine source tag while `data_verified_at` stays set.                                               |
| 5 POST routes              | No body-size limit. `sources/route.ts:68` fully buffers via `req.json()` _before_ the 256 KiB check at line 83; `cats`, `feeding-logs`, `apply`, `sources/extract` have no check at all. Only `/api/extract` has a real streaming cap. |
| `source-fetcher.ts:64`     | SSRF guard is TOCTOU — `resolveAddresses` validates one resolution, `fetchWithRetry` performs its own; the 5xx retry is a third, unvalidated. Requires a curator session.                                                              |
| `source-fetcher.ts:159`    | IPv6 deny-list misses 6to4 (`2002:7f00:0001::`) and NAT64 (`64:ff9b::7f00:1`), both reaching loopback.                                                                                                                                 |
| `recalls/sync/route.ts:36` | `CRON_SECRET` compared with `!==`; `admin-auth.ts:78` already uses `timingSafeEqual`.                                                                                                                                                  |
| `cats/route.ts:6`          | The only write route with no zod schema — hand-rolled destructure, no length bound on `name`, `birth_date` passed through unchecked.                                                                                                   |
| 4 routes                   | Raw Postgres `error.message` returned to clients, exposing constraint and column names. `sources`/`drafts`/`apply` correctly return fixed strings, so the leak is inconsistent rather than systemic.                                   |

Verified correct, for the record: `feeding_logs` has no IDOR (the RLS policy at `0002_reconcile_remote.sql:48` joins through `cats.owner_id = auth.uid()`), `createAdminClient` never reaches a client component (6 call sites, all server-side), `safeNextUrl` correctly allowlists redirect targets, and both privileged RPCs are `REVOKE`d from `anon`/`authenticated`.

## 3. Why these survived — the verification layer

- **The suite was unrunnable** (fixed). `docs/plans/…:558` names `pnpm exec vitest run` as a release gate; run as written it reported 191 failed / 3 passed. There was no `test` script, so the suite only passed when someone remembered `--dir src`.
- **The documented regression check executes nothing.** CLAUDE.md calls the ACANA case in `src/lib/fixtures.ts` "the manual regression check for domain math", but `SAMPLE_FOODS` is a literal with `carb_pct: 23` etc. already filled in; no domain function is ever called on it. Breaking the NFE formula leaves build, lint and typecheck green. (The values _are_ what the current code produces — verified — they simply cannot fail.)
- **The dead-code gate is configured not to look.** `knip.json` sets `ignoreIssues: {"src/lib/fixtures.ts": ["exports"]}`, which hides the two dead fixture exports below, and `ignoreExportsUsedInFile: true`, which hides four more. Its `.trunk` exclusion `"!.trunk"` is also malformed — should be `"!.trunk/**"`.
- **The RPC has zero coverage.** No pgTAP, no seeded integration test. Defects A, C and the open DRAFT gap all live inside this untested surface.
- **Two guard tests from the plan were never written**: `source-research-client.test.tsx` (the action-order invariant that stops a curator applying unvalidated candidates) and `source-first-boundary.test.ts` (a regression guard against the autonomous-search path returning). The autonomous path is currently removed but unguarded.

## 4. Dead code — all OPEN

- `20260715153018_fix_food_evidence_excerpt_normalization.sql` — no-op duplicate; superseded by this pass's migration but still in the chain.
- `prices` is selected on every catalog read (`catalog.ts:96`) and rendered nowhere.
- `foods.research_attempted_at` / `research_last_result` — two migrations (0004, 0005) evolved a CHECK constraint on columns with zero application references. Leftovers from the removed autonomous enrichment (`6a155fb`). Retiring them needs a migration.
- `foods.weight_kg` — written by the ingest script, displayed nowhere.
- `fixtures.ts:3,25` — `ACANA_MFG` / `ACANA_KR` exported, never imported, and duplicated verbatim as locals at `new/page.tsx:17,38`.
- `source-extraction.ts:263` — both `catch` arms are identical, so the `instanceof SyntaxError` test has no effect.
- `domain.ts:210` — the first `kcal_per_kg` conflict pattern is subsumed by the second (`\/` vs `\/?`).
- `source-collection.ts:9` — `SOURCE_FETCH_STATUS_VALUES` exported but only used to derive its own type.
- `@ai-sdk/anthropic` and `ai` — declared dependencies with zero imports, knip-silenced rather than removed.

## 5. Spec gaps in the collection subsystem — all OPEN

- **The curator cannot see the transcript.** Spec 113 requires inspection before extraction; `captured_text` is not in `sourceSchema` and not selected by `drafts/route.ts:25`, so it never reaches the wire. A cookie-consent interstitial captured as HTTP 200 is indistinguishable from a real label page, and the curator burns an LLM call to find out.
- **Failed sources are invisible.** Spec 127 requires showing and retrying them; `createFailedFoodSource` inserts with `is_current: false`, so they are unreachable even without the `fetch_status` filter.
- **Extraction has no retry.** Spec 130 mandates a timeout _and_ one retry; only `AbortSignal.timeout(30_000)` exists. `source-fetcher.ts:180` does implement the retry for the fetch path.
- **`content_hash` is written but never compared.** Spec 82 gives it the purpose "change detection"; nothing reads it against a prior row, so refresh-needed detection is unimplemented.
- **Charset is ignored.** `source-fetcher.ts:232` hardcodes UTF-8 while `parseContentType` discards the `; charset=` segment. A legacy Korean importer page served as `euc-kr` — exactly the `kr_label` case this subsystem exists for — decodes to mojibake and "succeeds".
- **No minimum excerpt length.** `isEvidenceExcerpt` is a bare substring test; a model returning `excerpt: "37"` passes both the zod `.min(1)` and the SQL non-empty check whenever `37` appears anywhere, including inside an unrelated SKU.
- **Failed requests clear curator input.** `source-research-client.tsx:70,96` do not check `request()`'s return value, so a 422 wipes a hand-pasted transcript and a failed apply discards the extraction result.
- **`replaceCurrentFoodSource` is not transactional** (`source-repository.ts:61`). Three un-wrapped statements; if the insert fails after the retire commits, the food is left with no current source of that kind. Spec 143 requires transactional draft writes — the evidence path honors it via the RPC, this path does not.

## 6. Schema and type drift — all OPEN

- `extraction_rate_limits` (migration 0006) was absent from `src/types/supabase.d.ts` — 9 tables in migrations, 8 in types. Nothing broke only because `request-rate-limit.ts:19` calls the RPC over raw REST. RESOLVED by regeneration.
- `food_sources.kind` is typed as the 4-value `nutrient_source` enum while the CHECK constraint allows 2. `insert({kind: "estimated"})` typechecks and fails at runtime.
- Missing index on `recalls.food_id` — `catalog.ts:96` embeds `recalls` on every listing read, resolved through the FK; degrades as the weekly openFDA cron accumulates rows.
- Missing index on `feeding_logs.food_id`, which is `ON DELETE RESTRICT` — every `foods` delete seq-scans the table.
- `Constants` is exported from a `.d.ts` and imported nowhere.

RLS is correct throughout: `food_sources`, `food_nutrient_evidence` and `extraction_rate_limits` all enable RLS with zero policies plus `REVOKE ALL`, i.e. service-role only.

## 7. Accessibility — all OPEN

- `layout.tsx:12` sets `maximumScale: 1`, blocking pinch-zoom on a mobile-first app (WCAG 1.4.4).
- `new/page.tsx:254,265,341` — three `<label>` elements with no `htmlFor` and no wrapping. `feeding-form.tsx` and `auth-form.tsx` wrap correctly, so `/new` diverges from the established convention.
- `catalog-client.tsx:149` — the comparison toggle conveys state only through its Korean text, with no `aria-pressed`.

## 8. Documentation drift — all OPEN

`AGENTS.md` still carries `Generated: 2026-07-15 / Commit: 968cf38`, which predates all seven source-first commits; most entries below follow from it never being regenerated.

- `CLAUDE.md:28` and `AGENTS.md:91` state there is no test runner. There is: vitest, plus four suites.
- `CLAUDE.md:46` places the Anthropic call in `api/extract/route.ts`; it moved to `src/lib/source-extraction.ts`. The raw-`fetch`-not-`@ai-sdk` detail is still accurate.
- `CLAUDE.md:54` lists two service-role callers; there are four.
- `CLAUDE.md:9` describes "two halves"; `/new/research` plus four `sources/*` routes are a third surface.
- `CLAUDE.md:87` claims shadcn/ui with components under `@/components/ui`. No such directory exists and there are zero `radix-ui` / `lucide-react` imports — `DESIGN.md:23` documents the actual hand-rolled `globals.css` classes.
- `AGENTS.md:36` says scripts default to dry runs; `ingest-petfriends.mjs:19` reads `--dry`, so writing is the default — inverted.
- `BLUEPRINT.md:31,77` describe SSG; the catalog pages use ISR (`revalidate = 3600`) with no `generateStaticParams`.
- `BLUEPRINT.md:89` marks the Korean recall API investigation done, but `docs/notes/2026-05-31-korean-recall-data-source.md` is `Status: Open` with four unresolved follow-ups.
- The turbopack ADR and note pin evidence to Next 16.2.6; `package.json` is now 16.2.10, and the ADR's own reversal criteria require a recorded retest that has not happened.
- All 36 plan checkboxes in `docs/plans/2026-07-16-…` are unchecked. Checked against the code: 33 shipped (checkbox drift), 3 genuinely unfinished — the two guard tests above, plus the spec's `food_sources` table definition still omitting `fetch_status`, `failure_code`, `attempted_at` and `is_current`.

## Unverified

`.env.example` could not be read (permission denied), so `CLAUDE.md:88`'s claim about it is unchecked.
Code references eight env vars: `ANTHROPIC_API_KEY`, `ADMIN_EMAILS`, `ADMIN_WRITE_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Note two different service-key names are accepted — worth confirming both are documented.

## Suggested next pass

1. Apply the new migration against the linked project and re-run the two-source workflow end to end (the fix is untested against a live database).
2. Close the DRAFT check (§2, one predicate in the same RPC) and the body-size gaps (§2).
3. Make `fixtures.ts` drive real domain math, or delete the CLAUDE.md claim that it does (§3).
4. Write the two guard tests the plan specified (§3).
5. Regenerate `AGENTS.md` and correct the CLAUDE.md drift in §8 — cheap, and it is the root of most stale guidance.
