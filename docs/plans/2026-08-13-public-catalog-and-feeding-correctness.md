# Public Catalog and Feeding Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every published catalog record visible, surface product- and brand-scoped recall history without overstating applicability, enforce one current feeding period per cat, expose personalized-read failures, and persist public catalog reads for one hour.

**Architecture:** Separate public anonymous catalog reads from cookie-aware authenticated reads. Normalize recall rows into explicit `product` or `brand` scope and reuse that presentation contract in catalog, comparison, dossier, and feeding insights. Serialize current-period switches in a short RLS-respecting PostgreSQL function guarded by a partial unique index, while retaining ordinary row-level PATCH and DELETE as the minimum correction path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase JavaScript client, PostgreSQL 17, RLS, pgTAP, Vitest, and Testing Library.

## Global Constraints

- Keep fixture fallback only for missing Supabase configuration.
- Keep configured public reads on the anonymous publishable-key role and never use the service-role client for caching.
- Keep authenticated feeding reads cookie-aware and dynamic.
- Treat a brand-scoped recall as historical brand context, not proof that the selected product or lot was recalled.
- Preserve recall date, firm, reason, affected lots, and original source wherever the recall is rendered.
- Use `published_at IS NOT NULL` as the only public food visibility predicate.
- Set an existing current period's `ended_on` to the next period's `started_on`; the schema calls this the switch date and permits same-day boundaries.
- Use a new migration created by `pnpm exec supabase migration new feeding_period_integrity`; never invent its timestamp.
- Use a `SECURITY INVOKER` switch function, lock the owned cat row before updating logs, revoke default `PUBLIC` execution, and grant execution only to `authenticated`.
- Do not add dependencies, broadly refactor components, or change curator/research behavior.
- Do not stage, commit, or push Stream 3 changes until the operator explicitly requests it.

---

## File Structure

| File                                                           | Responsibility                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/supabase/public.ts`                                   | Create a cookie-free publishable-key client for public RLS reads.                                                                        |
| `src/lib/supabase/public.test.ts`                              | Pin the URL, key, and disabled session persistence contract.                                                                             |
| `src/lib/catalog.ts`                                           | Load published foods and recalls, attach explicit recall scope, and wrap public reads in a one-hour Next.js data cache.                  |
| `src/lib/catalog.test.ts`                                      | Prove partial published rows survive, brand recalls attach without becoming product recalls, and configured reads use the public client. |
| `src/components/catalog-client.tsx`                            | Render missing protein as unknown and distinguish brand-scoped recall badges.                                                            |
| `src/components/catalog-client.test.tsx`                       | Prove a partial published record remains navigable and visibly unknown.                                                                  |
| `src/components/recall-history.tsx`                            | Label product and brand scope next to the bounded recall evidence.                                                                       |
| `src/components/food-dossier.test.tsx`                         | Prove a brand record does not claim the product or lot is affected.                                                                      |
| `src/components/food-comparison.test.tsx`                      | Prove comparison preserves recall scope and bounded evidence.                                                                            |
| `src/lib/feeding.ts`                                           | Return explicit dashboard errors, attach recall scopes to dynamic feeding data, and produce scope-aware insights.                        |
| `src/lib/feeding.test.ts`                                      | Prove query errors are not empty states and brand recalls produce qualified messages.                                                    |
| `src/app/api/feeding-logs/route.ts`                            | Route current periods through the transactional switch RPC while retaining closed-period inserts.                                        |
| `src/app/api/feeding-logs/route.test.ts`                       | Prove current-period POST uses the RPC and maps validation, auth, and database conflicts.                                                |
| `src/app/api/feeding-logs/[id]/route.ts`                       | Provide owner-scoped PATCH and DELETE correction endpoints.                                                                              |
| `src/app/api/feeding-logs/[id]/route.test.ts`                  | Prove corrections remain behind Auth and RLS-visible rows.                                                                               |
| `src/components/feeding-log-editor.tsx`                        | Offer the minimum product/date/note correction and delete controls.                                                                      |
| `src/components/feeding-log-editor.test.tsx`                   | Prove PATCH/DELETE payloads and failures are visible to the operator.                                                                    |
| `src/app/feeding/page.tsx`                                     | Render an explicit retryable dashboard error and mount correction controls.                                                              |
| `src/app/feeding/page.test.tsx`                                | Prove a configured query failure is not rendered as an empty account.                                                                    |
| `supabase/migrations/<generated>_feeding_period_integrity.sql` | Repair duplicate open periods, enforce one open period, and add the transactional switch function.                                       |
| `supabase/tests/feeding_period_switch_test.sql`                | Prove ownership, serialization outcome, unique enforcement, and switch-date behavior.                                                    |
| `src/types/supabase.d.ts`                                      | Regenerate the final switch-function signature from the replayed schema.                                                                 |

---

### Task 1: Normalize Recall Scope and Keep Partial Published Foods Visible

**Files:**

- Modify: `src/lib/catalog.test.ts`
- Modify: `src/lib/catalog.ts`
- Modify: `src/components/catalog-client.test.tsx`
- Modify: `src/components/catalog-client.tsx`
- Modify: `src/components/food-dossier.test.tsx`
- Modify: `src/components/food-comparison.test.tsx`
- Modify: `src/components/recall-history.tsx`

**Interfaces:**

- Produces: `RecallScope = "product" | "brand"` and required `RecallSummary.scope`.
- Produces: `attachRecallScopes<T extends FoodWithBrand>(foods, brandRecalls): T[]` as the shared pure merge boundary.
- Preserves: `getFoods(): Promise<FoodWithBrand[]>`, `getFood()`, and comparison selection behavior.

- [x] **Step 1: Write the failing pure recall merge test**

Add a literal food with one `food_id` recall and one `food_id = null` recall for the same brand.

Assert that the first returns with `scope: "product"`, the second with `scope: "brand"`, both IDs occur once, and a recall for another brand is absent.

The production mutation caught is either dropping nullable-`food_id` events or labeling every brand event as a product recall.

- [x] **Step 2: Write the failing partial-publication query test**

Mock only the external Supabase query boundary.

Return a row with `published_at` set and `protein_pct: null`; make the fake query remove that row if production calls `.not("protein_pct", "is", null)`.

Call the raw public-food loader and assert the row remains in the result with `protein_pct: null`.

- [x] **Step 3: Run catalog tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/catalog.test.ts
```

Expected: FAIL because recall scope/merge is absent and the protein predicate removes the partial row.

- [x] **Step 4: Implement the minimum catalog normalization**

Add the required scope field, normalize nested product recalls, load `food_id IS NULL` recalls for the selected brand IDs, merge by `brand_id`, deduplicate by recall ID, and sort newest dates first.

Remove only the `.not("protein_pct", "is", null)` predicate; retain `.not("published_at", "is", null)`.

- [x] **Step 5: Run catalog tests and verify GREEN**

Run the same focused command and require every new case to pass.

- [x] **Step 6: Write failing presentation tests**

In `catalog-client.test.tsx`, render a food with `protein_pct: null` and assert its product link and the `단백질` metric value `—` remain visible.

In dossier and comparison tests, provide a brand-scoped recall and assert `브랜드 범위 이력` plus `이 제품·로트의 해당 여부는 확인되지 않았습니다.`.

Assert a product-scoped recall uses `제품 연결 이력` and does not render the brand qualification for that row.

- [x] **Step 7: Run presentation tests and verify RED**

Run:

```bash
pnpm exec vitest run src/components/catalog-client.test.tsx src/components/food-dossier.test.tsx src/components/food-comparison.test.tsx
```

Expected: FAIL because recall scope is not rendered.

- [x] **Step 8: Implement the minimum scope-aware UI**

Render a Korean scope label inside each recall entry.

For brand rows, add the qualification sentence directly beside the bounded evidence.

Change the catalog chip to `브랜드 범위 리콜 이력` when any brand row exists, otherwise retain `recall history` for product rows.

- [x] **Step 9: Verify Task 1**

Run all four focused files plus `pnpm typecheck` and `pnpm lint`.

---

### Task 2: Add a Cookie-Free One-Hour Public Data Cache

**Files:**

- Create: `src/lib/supabase/public.test.ts`
- Create: `src/lib/supabase/public.ts`
- Modify: `src/lib/catalog.test.ts`
- Modify: `src/lib/catalog.ts`

**Interfaces:**

- Produces: `createPublicClient()` using `@supabase/supabase-js` and `Database`.
- Produces: one-hour cached `getFoods()` and `getRecalls()` with separate stable keys and tags.
- Preserves: immediate fixture fallback when Supabase configuration is absent.

- [x] **Step 1: Write the failing public-client boundary test**

Mock `@supabase/supabase-js` at the network boundary and call `createPublicClient()`.

Assert the current `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are used with `persistSession: false`, `autoRefreshToken: false`, and `detectSessionInUrl: false`.

The production mutation caught is accidentally restoring a cookie-aware or persistent-session public reader.

- [x] **Step 2: Run the public-client test and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/supabase/public.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement `createPublicClient()` and verify GREEN**

Use the existing generated `Database` type and no `next/headers`, cookie adapter, or service key.

- [x] **Step 4: Write the failing catalog cache boundary test**

Mock `next/cache` before importing `catalog.ts` and capture each `unstable_cache` registration.

Assert public foods and global recalls receive distinct keys, `revalidate: 3600`, and distinct tags.

This test checks this repository's one-hour boundary, not Next.js cache mechanics.

- [x] **Step 5: Run the cache test and verify RED**

Run `pnpm exec vitest run src/lib/catalog.test.ts` and expect the current React request cache to fail the registration assertions.

- [x] **Step 6: Replace request cache with persistent data cache**

Keep raw database loaders free of `cookies()` and wrap only configured Supabase reads with `unstable_cache` because this application has not enabled Next.js Cache Components.

Catch loader errors outside the cached function so transient configured-backend failures are not stored as empty one-hour results; preserve the current empty result at the public call boundary.

- [x] **Step 7: Verify Task 2**

Run public-client/catalog tests, typecheck, lint, and `pnpm build`.

Confirm authenticated `getFeedingDashboard()` still imports the cookie-aware server client.

---

### Task 3: Enforce One Current Feeding Period Transactionally

**Files:**

- Create: `supabase/tests/feeding_period_switch_test.sql`
- Create: `supabase/migrations/<generated>_feeding_period_integrity.sql`
- Modify: `src/types/supabase.d.ts` only through CLI regeneration after GREEN

**Interfaces:**

- Produces: `public.switch_current_feeding(p_cat_id bigint, p_food_id bigint, p_started_on date, p_note text) RETURNS bigint`.
- Produces: unique partial index on `feeding_logs(cat_id) WHERE ended_on IS NULL`.
- Preserves: direct authenticated CRUD through existing owner RLS for correction routes.

- [x] **Step 1: Write the failing pgTAP switch contract**

Create two users, two cats, two verified foods, and one current period.

As the owner with `SET LOCAL ROLE authenticated`, assert:

- `authenticated` can execute the function and `anon` cannot.
- Switching closes the prior row at the new `started_on` date.
- Exactly one open period remains.
- The new row contains the selected food and note.
- A second switch again leaves exactly one open row.
- A backdated switch raises SQLSTATE `22023`.
- Switching another user's cat raises `42501`.
- A direct second open insert raises `23505` after the index exists.

- [x] **Step 2: Run pgTAP and verify RED**

Start the current project Postgres-only stack on a verified free local port if another project owns the configured port.

Run:

```bash
pnpm exec supabase test db --local supabase/tests/feeding_period_switch_test.sql
```

Expected: FAIL because the function and unique index do not exist.

- [x] **Step 3: Create the migration with the CLI**

Run:

```bash
pnpm exec supabase migration new feeding_period_integrity
```

Do not rename or replace the generated timestamp.

- [x] **Step 4: Implement duplicate repair and the unique partial index**

For every cat with multiple open rows, keep the row with greatest `(started_on, id)` open and set every older open row's `ended_on` to that kept row's `started_on`.

Then create the unique partial index.

- [x] **Step 5: Implement the short invoker transaction**

The function must lock the caller-owned cat row with `FOR UPDATE`, reject a missing/unowned cat as `42501`, read the current row, reject `p_started_on < current.started_on` as `22023`, close the current row at `p_started_on`, insert the new open row, and return its ID.

Use `SECURITY INVOKER SET search_path = ''`, revoke from `PUBLIC`, `anon`, and `service_role`, and grant only to `authenticated`.

- [x] **Step 6: Replay from clean state and verify GREEN**

Run:

```bash
pnpm exec supabase db reset --local --no-seed
pnpm exec supabase test db --local
```

Require every migration and every pgTAP file to pass.

- [x] **Step 7: Regenerate types**

Run:

```bash
pnpm exec supabase gen types --local --lang typescript > src/types/supabase.d.ts
trunk fmt src/types/supabase.d.ts
```

Confirm the generated declaration contains the exact switch-function signature.

- [x] **Step 8: Stop and restore local infrastructure**

Stop only this repository's local Supabase project with `pnpm exec supabase stop --no-backup`.

Restore any temporary `supabase/config.toml` port and prove that file has no diff.

---

### Task 4: Route Current Creates Through the RPC and Add Correction Endpoints

**Files:**

- Create: `src/app/api/feeding-logs/route.test.ts`
- Modify: `src/app/api/feeding-logs/route.ts`
- Create: `src/app/api/feeding-logs/[id]/route.test.ts`
- Create: `src/app/api/feeding-logs/[id]/route.ts`

**Interfaces:**

- POST with `ended_on: null` calls `switch_current_feeding` and returns `{ feeding_log: { id } }`.
- POST with a non-null `ended_on` retains the existing owner-RLS INSERT path for a closed historical period.
- PATCH accepts a strict partial object of `food_id`, `started_on`, `ended_on`, and `note` with at least one key.
- DELETE removes one owner-visible row.

- [x] **Step 1: Write failing POST route tests**

Cover invalid JSON/body, 401, current-period RPC success, closed-period INSERT success, SQLSTATE `22023` as 409, and other database errors as 500.

Use a complete Auth result and Supabase RPC/query doubles; assert the HTTP response, not only mock calls.

- [x] **Step 2: Run POST tests and verify RED**

Run `pnpm exec vitest run src/app/api/feeding-logs/route.test.ts`.

Expected: current POST returns through direct INSERT rather than the RPC.

- [x] **Step 3: Implement the minimum POST branch and verify GREEN**

Do not alter validation or closed-history semantics beyond using `?? null` instead of truthiness for nullable fields.

- [x] **Step 4: Write failing correction route tests**

Cover 401, invalid ID, empty/invalid PATCH, successful PATCH, RLS-hidden row as 404, unique/date conflicts as 409, successful DELETE, and hidden DELETE as 404.

- [x] **Step 5: Run correction tests and verify RED**

Run `pnpm exec vitest run 'src/app/api/feeding-logs/[id]/route.test.ts'`.

Expected: FAIL because the route does not exist.

- [x] **Step 6: Implement owner-scoped PATCH and DELETE**

Use the cookie-aware server client, require `auth.getUser()`, and rely on existing RLS for row ownership and verified-food checks.

Select the affected ID and use `maybeSingle()` so an invisible row is a 404 instead of a false success.

- [x] **Step 7: Verify Task 4**

Run both route test files, typecheck, and lint.

---

### Task 5: Surface Feeding Errors, Scoped Recall Insights, and Corrections

**Files:**

- Create: `src/lib/feeding.test.ts`
- Modify: `src/lib/feeding.ts`
- Create: `src/components/feeding-log-editor.test.tsx`
- Create: `src/components/feeding-log-editor.tsx`
- Create: `src/app/feeding/page.test.tsx`
- Modify: `src/app/feeding/page.tsx`

**Interfaces:**

- `getFeedingDashboard()` always returns `error: string | null` in addition to the existing fields.
- `FeedingFood` includes `brand_id`, `brands.id`, and `RecallSummary[]`.
- `FeedingLogEditor` receives one `FeedingLog` and the published `FoodWithBrand[]` list.

- [x] **Step 1: Write failing dashboard and insight tests**

Assert a configured authenticated cats-query error returns the same user plus `error: "급여 기록을 불러오지 못했습니다."`, not a successful empty account.

Build one current product recall and one current brand recall and assert the product message asks the user to check affected lots while the brand message says product/lot applicability is unconfirmed.

- [x] **Step 2: Run feeding tests and verify RED**

Run `pnpm exec vitest run src/lib/feeding.test.ts`.

Expected: error field and scoped messages are absent.

- [x] **Step 3: Implement explicit error and dynamic recall attachment**

Select `foods.brand_id` and `brands(id, name)` in the authenticated dashboard query.

Load brand-scoped recalls through the same cookie-aware client, treat that query's failure as a dashboard failure, attach scope with the shared catalog helper, and keep the read uncached.

- [x] **Step 4: Write the failing editor test**

Render an existing log, change product/date/note, submit, and assert a PATCH to `/api/feeding-logs/<id>` with the literal corrected payload.

Confirm delete requires browser confirmation, sends DELETE, and displays a server error instead of reloading on failure.

- [x] **Step 5: Run the editor test and verify RED**

Run `pnpm exec vitest run src/components/feeding-log-editor.test.tsx`.

Expected: FAIL because the component does not exist.

- [x] **Step 6: Implement the minimum correction UI**

Use a collapsed `<details>` block under each timeline row.

Reuse the existing API error parsing pattern, reload only after a successful mutation, and add no new state-management abstraction.

- [x] **Step 7: Write the failing page error test**

Mock the two data loaders, return an authenticated dashboard error, render `FeedingPage()`, and assert a role `alert` with `급여 기록을 불러오지 못했습니다.` plus a `다시 시도` link.

Assert neither the form nor `기록 없음` is rendered in that state.

- [x] **Step 8: Run the page test and verify RED**

Run `pnpm exec vitest run src/app/feeding/page.test.tsx`.

- [x] **Step 9: Implement the explicit page state and editor mount**

Insert the error branch after configured/authenticated checks and before the successful account UI.

Mount one editor per timeline row.

- [x] **Step 10: Verify Task 5**

Run feeding library, editor, page, and route tests plus typecheck and lint.

---

### Task 6: Verify Stream 3 as One Cross-Layer Contract

**Files:**

- Verify all Stream 3 paths; modify only when a failed acceptance check proves a scoped defect.

- [x] **Step 1: Run focused application suites**

Run:

```bash
pnpm exec vitest run src/lib/catalog.test.ts src/lib/supabase/public.test.ts src/components/catalog-client.test.tsx src/components/food-dossier.test.tsx src/components/food-comparison.test.tsx src/lib/feeding.test.ts src/app/api/feeding-logs/route.test.ts 'src/app/api/feeding-logs/[id]/route.test.ts' src/components/feeding-log-editor.test.tsx src/app/feeding/page.test.tsx
```

- [x] **Step 2: Run full application gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- [x] **Step 3: Re-run clean database gates**

Run a clean local reset and all pgTAP tests, then stop this repository's stack and restore config.

- [x] **Step 4: Run repository quality checks**

Run `trunk check --no-fix` on the exact union of modified and untracked paths, followed by `git diff --check`.

- [x] **Step 5: Perform mutation checks**

Temporarily remove the partial unique predicate or weaken the owner check and prove `feeding_period_switch_test.sql` fails, then restore the migration exactly.

Temporarily omit brand recall attachment and prove a focused catalog/feeding test fails, then restore the implementation.

- [x] **Step 6: Run large-scope structured review**

Because Stream 3 crosses more than 15 files and core public/user-data paths, use independent read-only reviewers for catalog/cache, feeding/RLS, and an adversarial cross-check.

Resolve only concrete findings within Stream 3 scope and repeat affected verification.

- [x] **Step 7: Record the verification result**

Append exact commands, test counts, warnings, local infrastructure teardown, reviewer verdicts, and any unverified external boundary to this plan.

## Verification Result

Completed on 2026-08-13 on branch `fix/codebase-audit-remediation`.

- `pnpm test`: 47 files and 319 tests passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed with the new `/api/feeding-logs/[id]` route and `/recalls` at a one-hour revalidation interval.
- `pnpm exec knip`: passed with the existing CSS import-tracing configuration hint.
- Clean local migration replay plus `pnpm exec supabase test db`: 13 files and 186 pgTAP tests passed.
- `trunk check --no-fix` on the exact tracked-diff and untracked-path union: 26 files passed with no issues.
- `git diff --check`: passed.
- Mutation checks proved that removing brand recall attachment fails `src/lib/feeding.test.ts` and removing the partial unique-index predicate fails `supabase/tests/feeding_period_switch_test.sql`; both mutations were restored before the final gates.
- Catalog/cache review, feeding/RLS review, and adversarial cross-check reported no remaining findings after bounded fixes and re-review.
- Existing Vite native-config and PostCSS module-type warnings remain unchanged and are outside Stream 3.
- The temporary local database port was restored, this repository's Supabase stack was stopped with `--no-backup`, and `supabase/config.toml` has no diff.
- Remote Supabase migration application and production smoke testing were not performed in this local implementation stream.
