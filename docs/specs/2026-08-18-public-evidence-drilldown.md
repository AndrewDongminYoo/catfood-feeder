# Public Evidence Drilldown

## Status

Approach and scope approved by the operator on 2026-08-18: the evidence drilldown, with the landing page deliberately split into a later spec.

The sections below are awaiting review; they have not been approved individually.

## Goal

Make the catalog's central claim verifiable on screen: a published nutrient value can be expanded to the literal source excerpt that produced it, and a computed value can be expanded to the formula and the evidence behind each of its inputs.

The evidence already exists in the database and is invisible to the public catalog.
Only `src/lib/publication-review.ts` reads `food_nutrient_evidence`, and that is an admin surface.
The public detail page shows a provenance _tone_ badge derived from `foods.nutrient_sources`, which asserts the claim without letting a visitor check it.

## Why This Scope

The operator's success criterion for this stage is a portfolio and technical demonstration, and the sentence the demonstration must prove is that no unbacked number is stored.

Measured against production on 2026-08-18, the claim holds.

| Measure                            | Value                       |
| ---------------------------------- | --------------------------- |
| Published foods                    | 125 of 349                  |
| Published non-null nutrient values | 946                         |
| Values with a current evidence row | 833                         |
| Values without one                 | 113, all of them `carb_pct` |

`carb_pct` is back-calculated from NFE rather than read off a label, so it has no phrase to quote.
The 12 published `carb_pct` values that _do_ carry evidence come from Korean 등록성분량 declarations that print carbohydrate directly.
The apparent gap is the measured-versus-derived separation working as designed, and surfacing it is the most demonstrative part of this work rather than a defect to hide.

Broad catalog coverage is explicitly not a goal here.
The unpublished volume brands (Royal Canin 45 rows, Hill's 20, PURINA 17, all at zero published) are blocked by image-only labels, dry-matter tables, and an unreachable Korean site.
A narrow, fully proven vertical slice is worth more to this stage than a wider shallow one.

## Constraints

- Keep Korean UI strings and comments in Korean; keep identifiers and commit messages in English.
- Add no new dependency.
- Do not widen the `createAdminClient` boundary; the public catalog keeps reading through the RLS-enforced SSR client.
- Do not change `src/lib/domain.ts`; the NFE inputs are the food's own columns and are reconstructed in the presentation layer.
- Preserve the `SAMPLE_FOODS` fallback path so the catalog still renders without Supabase configured.
- Apply TDD to every behavior change.
- Create the migration through the Supabase CLI.

## Section 1: Exposure Boundary

`food_nutrient_evidence` and `food_sources` currently grant nothing to `anon`; production ACLs show `service_role=r` only.
One migration opens read access, scoped to published foods.

Row policy on both tables, for `anon` and `authenticated`:

```sql
using (
  is_current
  and exists (
    select 1 from public.foods f
    where f.id = food_id and f.published_at is not null
  )
)
```

`food_sources` additionally restricts to `fetch_status = 'fetched'`.

The 224 draft foods keep their evidence private, which preserves the existing publication boundary rather than introducing a second one.

`captured_text` is not exposed.
It holds the full captured page body, and republishing manufacturer page text wholesale is a different act from quoting the phrase that justifies a number.
Access is granted per column instead:

```sql
grant select (id, food_id, kind, url, capture_method, captured_at)
  on public.food_sources to anon, authenticated;
grant select on public.food_nutrient_evidence to anon, authenticated;
```

The granted set is exactly what Section 5 renders, plus the two keys needed to join.

`content_hash` and `observed_at` are deliberately excluded.
A content hash is a fingerprint of the page body this design chose not to republish, and publishing it would let anyone confirm whether a candidate body matches — a small inference channel opened for a column nothing renders.
If a later revision wants an "unchanged since" marker, it adds the column to this grant then, with a reader that shows it.

`food_nutrient_evidence` needs no column restriction; `excerpt` is the quoted phrase and is the point of the feature.

### Evidence-to-Source Currency

Restricting `food_sources` to current, fetched rows only works while every current evidence row points at one.
Measured on 2026-08-18 across all 833 current evidence rows on published foods: none referenced a missing, retired, or unfetched source.

The policy does not enforce that invariant, and a past defect in this area is recorded in the evidence-source currency project memory.
So the read path treats a missing source join exactly as it treats an absent evidence row: the fact carries no `proof`, and the existing badge falls through to its established `tone: "unknown"` / `미기록` state.
An excerpt is never rendered detached from the source that produced it.

## Section 2: Read Path

Add `getFoodEvidence(id)` to `src/lib/catalog.ts`, joining current evidence rows to their source rows.

It caches the way the existing catalog reads cache: `unstable_cache` over a `createPublicClient()` call, with the same one-hour `revalidate` and its own tag, matching `loadCachedPublicFoods`.

It is called from the detail page only.
The list page keeps its current query: pulling evidence for 349 rows to render a list that shows none of it would be waste.

The result is bounded by the number of nutrient keys for one food, so it needs no pagination.
The `selectAll` helper that `publication-review.ts` uses exists for multi-food admin sweeps and would be ceremony here.

Because Section 1 grants `food_sources` per column, every select against it must enumerate columns.
A column-level grant does not silently drop ungranted columns: a `select *` that reaches one fails the whole statement with `permission denied for table food_sources`.
So the embedded resource is spelled out and never abbreviated:

```ts
.select("nutrient_key, value, excerpt, captured_at, food_sources(url, kind, capture_method, captured_at)")
```

The implementation plan must confirm against a running database that PostgREST requests only these columns for the embedded resource before the migration is treated as done.
This is the failure mode that reads correctly as prose and returns a 403 on the first request.

When `isSupabaseConfigured()` is false the function returns an empty collection, and the dossier renders exactly the badge-only view it renders today.
Degradation is silent and total; no partial or fabricated proof is ever shown.

The page keeps its one-hour ISR revalidation.

## Section 3: Presentation Layer

`NutritionFact` in `src/lib/catalog-presentation.ts` gains one optional field.
`evidenceState` and its `tone`/`label` output are unchanged, so the existing badge behavior and its tests stay as they are.

```ts
type QuotedProof = {
  kind: "quoted";
  excerpt: string;
  value: number;
  url: string;
  capturedAt: string;
  captureMethod: string;
};

proof?:
  | QuotedProof
  | {
      kind: "computed";
      formula: string;
      inputs: readonly {
        key: NutritionPresentationKey;
        label: string;
        value: string;
        evidence: EvidenceState;
        proof: QuotedProof | null;
      }[];
    };
```

The computed variant's `inputs` carry resolved per-term proofs rather than bare keys, so Section 5 can render each input's own quote without the component reaching back into the evidence array.
A term with no evidence row — the estimated ash term is the standing case — carries `proof: null` and states its status through `evidence` instead.

## Section 4: Derived Values

The discriminator between a quoted and a computed `carb_pct` is data, not inference: whether a current `food_nutrient_evidence` row exists for the `carb_pct` key.

- Evidence row present, as in the 12 Korean-declaration rows: render `kind: "quoted"` like any other measured value.
- No evidence row: render `kind: "computed"` with the NFE expression `100 − (protein + fat + fiber + moisture + ash)` filled with this food's own values, and each input expandable to its own quoted proof.

Two branches are sufficient, and that is measured rather than assumed.
Across the 113 published computed rows on 2026-08-18: none is missing protein, fat, fiber, or moisture, so every one of them reconstructs.

The ash term is where this would go wrong.
`ash_pct` is null on 44 of those 113, and all 44 are exactly the rows where `carb_is_estimated` is true; no row has a null ash column without being estimated.

So the formula sources its ash term from `resolveAsh`'s output, never from the raw `ash_pct` column.
Reading the column directly would render a blank inside the equation for 44 of 113 foods — a visibly broken proof on the screen whose entire purpose is to be checkable.

When the ash term comes from the estimated tier, the computed panel says so at that term, rather than presenting 9.0% as if it had been measured.
This keeps the estimated tier legible at the exact point where it enters the arithmetic.

## Section 5: Interface

Each `dossier-fact` in `src/components/food-dossier.tsx` becomes a native `<details>` disclosure.

No JavaScript and no library: the element carries its own keyboard and screen-reader behavior, which a hand-rolled accordion would have to reimplement.

An expanded quoted fact shows the excerpt as a blockquote, the source URL, the capture timestamp, and the capture method.
An expanded computed fact shows the formula and its inputs.

### Marking the Number Inside the Quote

The excerpt is the sentence; the value is the number taken out of it.
Marking that number where it sits makes the derivation legible without a caption: a reader sees `조회분 7% 이하` with `7` marked and needs no explanation of what was read from where.

Matching is numeric, not textual.
A literal substring search on the stored value fails on 34 of the 833 published rows, because a value of `14` was read from `14.00%` and a value of `9` from `9.0%`.

The matcher this needs already exists.
`excerptContainsValue` in `src/lib/source-extraction.ts` normalizes NFKC, reads a decimal comma as a decimal point rather than deleting it, and already locates the token's offset.
Its numeric core moves to a shared module that both the extraction path and the presentation path import, so no second number parser enters the codebase.

The extraction-side function keeps its own behavior unchanged.
It rejects an excerpt carrying more than one numeric token, which is a correctness guard at capture time and must not be loosened to serve a display feature.
The display matcher is a separate, more permissive function over the same normalizer: it wraps the token whose normalized value equals the evidence value.

That distinction is load-bearing rather than academic.
Of the 833 published excerpts, 832 carry exactly one numeric token; the single exception is `Metabolizable Energy (ME) 3,200 kcal/kg; 320 kcal/cup` for a value of 3200, where matching on value selects the correct token and a single-token rule would mark nothing.

Verified against production on 2026-08-18: this resolves all 833 rows, including every one the substring search missed.

When no token parses equal to the value, the excerpt renders unmarked.
A wrong number is never marked, because pointing at the wrong part of the sentence is worse than pointing at none of it.

Styling reuses the existing hand-rolled classes in `src/app/globals.css` per `DESIGN.md`; no new design tokens.

## Section 6: Verification

- `src/lib/catalog-presentation.test.ts` covers the fact-to-proof mapping and both branches of the derived-value discriminator.
- A focused test covers the excerpt marker: a trailing-zero case such as value `14` against `Crude Fat 14.00%`, a decimal-comma case, and the no-match case that must render unmarked rather than mark the wrong token.
- A pgTAP suite in `supabase/tests/`, following the existing `foods_publication_rls_test.sql` pattern, asserts that `anon` reads evidence for a published food, cannot read evidence for a draft food, and cannot select `captured_text` from `food_sources`.
- `src/lib/fixtures.test.ts` must stay green; the ACANA Grasslands case is unaffected because no domain math changes.

The pgTAP suite must be shown failing before the migration is applied, so that its pass is evidence about the policy rather than about the test running at all.

## Out of Scope

- The landing page. `src/app/page.tsx` still redirects to `/foods`; the demonstration's opening statement is a separate spec, deliberately written after the detail page settles what it should point at.
- The comparison view, the list page, and any `/evidence` ledger browser.
- Coverage backfill for the blocked volume brands.
- `captured_text` exposure in any form.
