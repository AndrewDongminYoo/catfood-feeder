# Evidence-aware Food Advisor v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
> Do not delegate implementation unless the operator explicitly authorizes it and the repository delegation guardrails are satisfied.

**Goal:** Ship a deterministic `/advisor` baseline that finds up to three next-food candidates by explicit, currently supportable constraints while exposing evidence quality and uncertainty without making health or quality claims.

**Architecture:** Keep the existing Next.js and Supabase application as one deployable unit.
Add one pure advisor domain module, extend the public catalog read model with a bounded bulk-evidence query, and render a server-side GET form and results page.
Infer only literal minimum and maximum declarations from preserved evidence excerpts; do not add a schema column, guess an unprinted qualifier, rank by derived carbohydrate, or introduce an API or MCP transport in v0.

**Tech Stack:** Next.js App Router, React 19 server components, TypeScript strict mode, Supabase Postgres/Data API, Zod, Vitest, Testing Library, Tailwind v4 through `src/app/globals.css`.

**Spec:** `BLUEPRINT.md` Goal, Success Criteria, Constraints, core domain rules, and Open Question on guaranteed-analysis bounds; consultation source `.omo/2026-08-20-catfoodfeeder_발전_방향_consult.md`.

## Audit verdict

The consultation's product direction is sound, but its `Next 3 actions` cannot be executed unchanged.
The correct next slice is a narrower evidence-aware advisor v0, not the full ingredient-aware recommendation flow described in the consultation.

| Consultation claim                                                                                     | Current evidence                                                                                                                                                                                                                                                                  | Decision                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the existing application as the backend and treat MCP as a later adapter.                         | `BLUEPRINT.md` and the current research broker already place deterministic verification and authorized writes inside the application.                                                                                                                                             | Accept. Do not split a backend or add MCP in v0.                                                                                                                                            |
| Reuse the public catalog, evidence, transition, and recall assets.                                     | `getFoods()`, `getFoodEvidence()`, `compareFoodTransition()`, and scoped recall reads exist.                                                                                                                                                                                      | Accept with one correction: reuse the data and rules, but do not reuse the string-only transition output as an advisor ranking contract.                                                    |
| The current published data is sufficient for the complete proposed flow.                               | A read-only public Supabase check on 2026-08-20 returned 125 published foods, 83 with kcal/kg, 125 with carbohydrate, 12 with declared carbohydrate, 113 with derived or estimated carbohydrate, 0 with non-empty ingredients, and 0 true values for `grain_free` or `meal_free`. | Reject for the complete flow. The baseline supports kcal proximity, cooking method, and declared-carbohydrate availability; it does not support ingredient exclusions or grain/meal claims. |
| Guaranteed-analysis bounds must be handled before nutrient ranking.                                    | `BLUEPRINT.md` records that minimum and maximum declarations are currently reduced to point values and can bias NFE. Evidence excerpts preserve the printed relation.                                                                                                             | Accept. v0 may display the relation and refuse unsafe ranking without requiring a schema migration.                                                                                         |
| Use one `NutrientQualifier` enum containing `exact`, `minimum`, `maximum`, `estimated`, and `derived`. | `nutrient_sources` already models provenance and derivation, while minimum and maximum describe a separate value relation.                                                                                                                                                        | Reject. Keep provenance and value relation orthogonal.                                                                                                                                      |
| Start with 20 golden tests and validate with 10 users.                                                 | The consultation gives no repository or product evidence for those exact counts.                                                                                                                                                                                                  | Replace with behavior-based test coverage and a separately approved pilot protocol after the software baseline is usable.                                                                   |

## Global constraints

- Preserve `BLUEPRINT.md` as the authoritative product and domain decision source instead of creating a competing `docs/product-direction.md`.
- Preserve the existing public APIs and the current feeding insight behavior.
- Do not add a dependency, database migration, JSON API, server action, LLM call, chatbot, MCP server, health score, quality score, price feature, or write path.
- Do not infer a nutrient bound from the nutrient key alone.
- Parse a bound only when the retained excerpt literally contains a supported minimum or maximum marker.
- Treat conflicting markers or an unrecognized form as `unspecified`.
- Treat `manufacturer` and `kr_label` as declared provenance, and keep `estimated` and `derived` as calculation provenance.
- Never rank candidates by `carb_pct`, protein, energy ratios, ingredient order, recall count, or an aggregate quality score in v0.
- Sort eligible candidates only by absolute kcal/kg change from the current food, then by stable numeric food ID.
- Exclude a candidate when a requested hard constraint cannot be evaluated; do not silently treat missing data as a failed or satisfied preference.
- Keep Korean user-facing strings and comments in Korean.
- Do not modify or stage the author-unknown changes currently present in `.github/workflows/app-ci.yml`, `.github/workflows/db-tests.yml`, or `.trunk/trunk.yaml`.
- Do not commit, push, migrate, or deploy unless separately authorized.

## Scope

### In scope

- A product-direction section in `BLUEPRINT.md` that fixes the advisor v0 contract and non-goals.
- Literal minimum and maximum recognition from current evidence excerpts.
- A bulk, read-only public evidence loader with no N+1 query pattern.
- A pure deterministic candidate selector with explicit hard constraints and a stable sort.
- A mobile-first server-rendered `/advisor` GET form and candidate results.
- Evidence, uncertainty, recall-scope, and unsupported-condition disclosures.
- Automated tests, static verification, and concrete manual QA scenarios.

### Out of scope

- Ingredient exclusion, ingredient ordering, ingredient form or specificity scoring, and grain/meal filters.
- Any use of derived carbohydrate or derived energy ratios to order candidates.
- Personalized disease, allergy, prescription, safety, or health advice.
- Natural-language query parsing, conversational UI, public JSON API, MCP, OAuth, quotas, billing, and external integrations.
- Feeding-log writes or a one-click food switch.
- Product analytics instrumentation and a fixed user-research cohort size.

## Success criteria

1. Bound semantics are explicit and conservative.
   Verify with `pnpm test -- src/lib/advisor.test.ts src/lib/catalog-presentation.test.ts`.
2. Public advisor data loads foods and evidence in bounded bulk queries and preserves public RLS behavior.
   Verify with `pnpm test -- src/lib/food-evidence.test.ts`.
3. The same pure query returns the same ordered candidate IDs for tests and the `/advisor` page.
   Verify with `pnpm test -- src/lib/advisor.test.ts src/components/advisor-results.test.tsx`.
4. Unsupported and unknown conditions are visible instead of being converted to negative product claims.
   Verify with component tests and the manual scenarios in Task 6.
5. The production surface compiles and the repository quality gate reports no new failures.
   Verify with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm exec knip`, and `trunk check`.

## File map

| Path                                      | Responsibility                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BLUEPRINT.md`                            | Authoritative advisor v0 product contract and sequencing.                                                     |
| `src/lib/advisor.ts`                      | Bound parsing, query validation, comparison policy, candidate selection, and stable sorting.                  |
| `src/lib/advisor.test.ts`                 | Pure behavior tests for bound recognition and candidate selection.                                            |
| `src/lib/catalog.ts`                      | Bulk public evidence loading and grouped advisor catalog read model.                                          |
| `src/lib/food-evidence.test.ts`           | Bulk evidence query, grouping, RLS-compatible select shape, and failure behavior.                             |
| `src/lib/catalog-presentation.ts`         | Bound labels and comparison cautions in the existing evidence presentation model.                             |
| `src/lib/catalog-presentation.test.ts`    | Presentation tests for minimum, maximum, unspecified, and derived values.                                     |
| `src/components/advisor-results.tsx`      | Pure rendering of query summary, candidates, reasons, trade-offs, unknowns, evidence state, and recall scope. |
| `src/components/advisor-results.test.tsx` | Korean copy and disclosure tests for advisor results.                                                         |
| `src/app/advisor/page.tsx`                | Server-rendered GET form, search-parameter parsing, public data loading, and result composition.              |
| `src/app/globals.css`                     | Advisor-only responsive layout selectors when existing card and form styles are insufficient.                 |

## Task 1: Lock the corrected product contract in `BLUEPRINT.md`

**Files:**

- Modify: `BLUEPRINT.md` after Success Criteria and before Constraints / Non-goals.

**Produces:** One authoritative decision that a later implementation and reviewer can evaluate without consulting `.omo` history.

- [ ] **Step 1: Add the product direction and v0 boundary**

Add a `## Next Product Slice — Evidence-aware Food Advisor v0` section with this substance:

```markdown
The next user-facing slice helps a guardian compare the current imported dry food with up to three candidates by explicit, deterministic constraints.
v0 ranks only by absolute kcal/kg change and uses stable food ID as the tie-breaker.
It shows declared, estimated, derived, and unknown evidence states, plus literal minimum and maximum declarations when the retained excerpt proves them.
It does not infer health, safety, or overall quality and does not rank by carbohydrate, protein, ingredient order, recalls, or a composite score.

Ingredient exclusions, grain/meal claims, chatbot input, public API, and MCP remain blocked until their own data and interface contracts are verified.
```

- [ ] **Step 2: Reconcile the existing Open Question without pretending it is fully solved**

Append a dated decision to the guaranteed-analysis bounds item:

```markdown
2026-08-20 v0 decision: expose only literal minimum and maximum markers recovered from current evidence excerpts, return `unspecified` otherwise, and exclude unsafe nutrient point ranking from advisor v0.
Persistent qualifier storage and interval propagation remain separate follow-up decisions if literal excerpt coverage proves insufficient.
```

- [ ] **Step 3: Verify documentation consistency**

Run:

```bash
rg -n "Next Product Slice|MCP|보장성분의 경계값|advisor v0" BLUEPRINT.md
```

Expected: one advisor direction section, one updated bounds decision, and no claim that ingredient filters, health ranking, MCP, or persistent qualifiers are part of v0.

## Task 2: Add conservative bound semantics and advisor contracts

**Files:**

- Create: `src/lib/advisor.ts`
- Create: `src/lib/advisor.test.ts`

**Interfaces:**

- Consumes: `FoodWithBrand`, `NutrientEvidence`, `CookingMethod`, and existing `nutrient_sources` values.
- Produces: `NutrientBound`, `AdvisorQuery`, `AdvisorCandidate`, `parseAdvisorSearchParams()`, `classifyNutrientBound()`, and `findAdvisorCandidates()`.

- [ ] **Step 1: Write failing bound-classification tests**

Cover these exact cases:

```ts
expect(classifyNutrientBound("조단백질 32% 이상")).toBe("minimum");
expect(classifyNutrientBound("Crude Fat min. 18%")).toBe("minimum");
expect(classifyNutrientBound("수분 10% 이하")).toBe("maximum");
expect(classifyNutrientBound("Crude Fiber (max) 4%")).toBe("maximum");
expect(classifyNutrientBound("Protein 32%")).toBe("unspecified");
expect(classifyNutrientBound("minimum 30%, maximum 40%")).toBe("unspecified");
```

Run:

```bash
pnpm test -- src/lib/advisor.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement literal-only bound recognition**

Define the value relation separately from provenance:

```ts
export type NutrientBound = "minimum" | "maximum" | "unspecified";
```

Normalize excerpts with NFKC and lowercase before matching Korean `이상` / `이하` and English `min`, `minimum`, `at least`, `max`, `maximum`, `at most`, and `not more than` tokens.
Return `unspecified` when both directions match, neither direction matches, or the text is empty.

- [ ] **Step 3: Write failing search-parameter tests**

Use this v0 query contract:

```ts
export interface AdvisorQuery {
  currentFoodId: number;
  cookingMethod: CookingMethod | null;
  maxKcalDeltaPct: 5 | 10 | 15 | null;
  requireDeclaredCarb: boolean;
}
```

Test repeated parameters, invalid food IDs, unsupported kcal thresholds, invalid cooking methods, and a checked `declaredCarb=1` value.
Invalid optional values must normalize to `null`; an invalid or missing current food ID must return a query error and must not select a default food silently.

- [ ] **Step 4: Implement candidate contracts without score-shaped abstractions**

Use explicit reason and uncertainty codes instead of a numeric score:

```ts
export interface AdvisorCandidate {
  food: FoodWithBrand;
  kcalDeltaPct: number | null;
  matchedReasons: readonly AdvisorReason[];
  tradeoffs: readonly AdvisorTradeoff[];
  unknowns: readonly AdvisorUnknown[];
  evidence: readonly NutrientEvidence[];
}
```

Do not create a generic rules engine, plugin system, weighted score, repository class, or provider abstraction.

- [ ] **Step 5: Verify the pure contract**

Run:

```bash
pnpm test -- src/lib/advisor.test.ts
pnpm typecheck
```

Expected: PASS with no `any`, no type assertions around search parameters, and no source or bound concepts merged into one enum.

## Task 3: Add a bounded bulk public-evidence read model

**Files:**

- Modify: `src/lib/catalog.ts`
- Modify: `src/lib/food-evidence.test.ts`

**Interfaces:**

- Consumes: Existing public Supabase client, `loadPublicFoods()`, and `FOOD_EVIDENCE_SELECT`.
- Produces: `loadPublicFoodEvidence(supabase, foodIds)`, `getAdvisorCatalog()`, and evidence rows that include `food_id` for grouping.

Use this load-result contract so an empty catalog is not confused with an unavailable backend:

```ts
export type AdvisorCatalogLoadResult =
  | {
      available: true;
      foods: readonly FoodWithBrand[];
      evidenceByFoodId: ReadonlyMap<number, readonly NutrientEvidence[]>;
    }
  | {
      available: false;
      reason: "load_failed";
    };
```

- [ ] **Step 1: Write failing loader tests**

Test that the loader:

- Returns immediately for an empty ID list.
- Splits IDs into deterministic batches of at most 100 foods.
- Selects only `food_id`, `nutrient_key`, `value`, `excerpt`, `captured_at`, and the already-approved nested source fields.
- Requires `is_current = true` and relies on public RLS for published-food visibility.
- Groups evidence by food ID without losing foods that have no evidence rows.
- Throws from the low-level loader on a Supabase error while `getAdvisorCatalog()` returns a typed unavailable result for configured-backend failures and a literal-evidence-bearing catalog fixture when public Supabase configuration is absent.

Run:

```bash
pnpm test -- src/lib/food-evidence.test.ts
```

Expected: FAIL because the bulk loader is absent.

- [ ] **Step 2: Generalize the evidence row mapper once**

Extend `NutrientEvidence` with `food_id` or introduce `FoodNutrientEvidence extends NutrientEvidence` for bulk reads.
Keep `getFoodEvidence(foodId)` source-compatible by returning the same public fields its existing callers consume.
Reuse one mapper for the nested `food_sources` join instead of duplicating its cast and flattening logic.

- [ ] **Step 3: Implement bounded batching and grouping**

Use batches of 100 food IDs to bound response size without relying on a server-side maximum-row setting.
Use one query per batch, not one query per food.
Cache the serializable `{ foods, evidenceRows }` arrays for 3,600 seconds with the existing `public-foods` tag, then group evidence into a `ReadonlyMap<number, readonly NutrientEvidence[]>` outside the cached function.
Return the grouped map through `AdvisorCatalogLoadResult`.

- [ ] **Step 4: Preserve fail-closed public behavior**

If Supabase is not configured, preserve the public catalog fallback with the curated ACANA fixture and literal nutrient evidence extracted from its existing manufacturer text.
Do not invent additional products to force a candidate result; the single-product fixture may truthfully produce no alternatives.
If the public query fails, log one server error and return `{ available: false, reason: "load_failed" }`; do not present sample data as live candidate results.
When configured, call the low-level `loadPublicFoods()` and `loadPublicFoodEvidence()` functions inside the same guarded read path so the existing `getFoods()` catch-and-empty behavior cannot hide a backend failure.

- [ ] **Step 5: Verify data access**

Run:

```bash
pnpm test -- src/lib/food-evidence.test.ts
pnpm typecheck
```

Expected: PASS and no N+1 call path.

## Task 4: Implement deterministic, evidence-aware candidate selection

**Files:**

- Modify: `src/lib/advisor.ts`
- Modify: `src/lib/advisor.test.ts`

**Interfaces:**

- Consumes: The available branch of `AdvisorCatalogLoadResult`, a valid `AdvisorQuery`, literal bound classifications, and existing source tags.
- Produces: Up to three `AdvisorCandidate` values and aggregate exclusion diagnostics for the page.

Use an explicit selection result instead of returning an ambiguous empty array:

```ts
export type AdvisorSelection =
  | { kind: "current_food_not_found" }
  | {
      kind: "ready";
      candidates: readonly AdvisorCandidate[];
      excluded: {
        cookingMethod: number;
        currentKcalMissing: boolean;
        candidateKcalMissing: number;
        declaredCarb: number;
        kcalOutsideRange: number;
      };
    };
```

- [ ] **Step 1: Write failing eligibility and ordering tests**

Build a small synthetic catalog that proves all of these behaviors:

1. The current food never appears as a candidate.
2. A requested cooking method is a hard equality filter.
3. A requested kcal threshold excludes a candidate with missing kcal or without current literal evidence matching the stored kcal value and records `missing_kcal` in aggregate diagnostics.
4. `requireDeclaredCarb` accepts only `manufacturer` or `kr_label` carbohydrate with current literal evidence matching the stored value and rejects `derived`, `estimated`, missing, untagged, or unproven values.
5. Eligible rows sort by absolute kcal delta and then numeric food ID.
6. The result is capped at three after sorting.
7. Recall history becomes a scoped trade-off and never affects eligibility or ordering.
8. A derived carbohydrate is labeled unavailable for point comparison even when `carb_pct` is non-null.
9. Minimum and maximum excerpts are exposed as context but never converted into a quality score.
10. Repeating the same query returns the same ordered IDs.

Run:

```bash
pnpm test -- src/lib/advisor.test.ts
```

Expected: FAIL until the selector exists.

- [ ] **Step 2: Implement the hard-constraint pipeline**

Apply constraints in this order:

1. Resolve the selected current food; return `current_food_not_found` if absent.
2. Exclude the current food.
3. Apply cooking-method equality when requested.
4. Require both kcal values to have current literal evidence matching the stored value and enforce the absolute delta threshold when requested.
5. Require declared carbohydrate with current literal evidence matching the stored value when requested.
6. Build reasons, trade-offs, and unknowns for eligible candidates.
7. Sort by absolute kcal delta, then food ID.
8. Return the first three.

If no kcal threshold is requested, candidates with missing or unproven kcal remain eligible but sort after candidates with a calculable evidence-backed delta.
Carry `current_kcal_unknown` when the selected food lacks matching literal evidence and `candidate_kcal_unknown` when the candidate lacks it; do not conflate the two causes in card copy or exclusion diagnostics.
Do not substitute zero for null.

- [ ] **Step 3: Make comparison claims source-aware**

For each displayed nutrient:

- Declared value with a literal minimum marker: show `최소 보증치`.
- Declared value with a literal maximum marker: show `최대 보증치`.
- Declared value without a recognized marker: show `경계 미확인`.
- Derived or estimated value: show the existing source state and `우열 판단 제외`.
- Missing value or evidence: show `미확인`.

Do not claim that a `minimum` value is the actual amount or that a `maximum` value is a precise measurement.

- [ ] **Step 4: Verify candidate behavior**

Run:

```bash
pnpm test -- src/lib/advisor.test.ts
pnpm typecheck
```

Expected: PASS with exact ordered candidate IDs asserted in every ranking test.

## Task 5: Render the structured `/advisor` surface

**Files:**

- Create: `src/components/advisor-results.tsx`
- Create: `src/components/advisor-results.test.tsx`
- Create: `src/app/advisor/page.tsx`
- Modify: `src/app/globals.css` only for advisor-specific selectors that cannot reuse existing styles.

**Interfaces:**

- Consumes: `parseAdvisorSearchParams()`, `getAdvisorCatalog()`, and `findAdvisorCandidates()`.
- Produces: A public, mobile-first GET flow with shareable query parameters and no browser-side data fetch.

- [ ] **Step 1: Write failing result-component tests**

Assert the rendered Korean UI for:

- No query yet, rendered with `data-testid="advisor-empty"` for browser QA.
- Invalid or missing current food.
- Public data unavailable.
- No eligible candidates with exclusion diagnostics.
- One to three candidates in domain-provided order.
- Current-food name, kcal delta, matched reasons, trade-offs, unknowns, declared/derived state, minimum/maximum/unspecified relation, and recall scope.
- Candidate cards expose `data-food-id` with the numeric food ID for deterministic browser QA and display kcal/kg, protein, and carbohydrate evidence states.
- A link to each candidate's existing `/foods/[id]` evidence dossier.
- The global disclosure that ingredients, grain/meal claims, health conditions, and overall quality are not evaluated.

Run:

```bash
pnpm test -- src/components/advisor-results.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement a server-rendered GET form**

Use native form controls with these names and values:

```plaintext
current=<positive food id>
kcalDelta=5|10|15
cookingMethod=extrusion|baked|freeze_dried|dried
declaredCarb=1
```

Render all published foods in the current-food select.
Do not choose a current food by default.
Omit empty optional parameters from links and form submissions where practical.

- [ ] **Step 3: Render results without a new API boundary**

The page must parse `searchParams`, load the catalog on the server, call the pure selector, and pass only its result to `AdvisorResults`.
Do not add a route handler, server action, client state store, suspense abstraction, or provider context for this flow.

- [ ] **Step 4: Reuse existing visual primitives**

Reuse `.wide`, `.card`, existing form controls, evidence badges, and recall wording where their semantics match.
Add only namespaced selectors such as `.advisor-form`, `.advisor-results`, and `.advisor-candidate` if needed.
Preserve the public mobile-first layout and avoid changing unrelated selectors.

- [ ] **Step 5: Verify the surface**

Run:

```bash
pnpm test -- src/components/advisor-results.test.tsx
pnpm typecheck
pnpm build
```

Expected: PASS, including `typedRoutes` checks for `/advisor` and `/foods/[id]` links.

## Task 6: Run readiness, quality, and manual QA gates

**Files:**

- No product-file changes unless a verification failure identifies an in-scope defect.

**Produces:** Evidence that the plan's baseline is usable without overclaiming its data coverage.

- [ ] **Step 1: Re-query the public data baseline and discover live QA targets**

Use the public publishable-key client through the existing secrets wrapper and report only aggregate counts.
Re-check published foods, kcal coverage, declared versus derived carbohydrate, non-empty ingredients, grain-free true, and meal-free true.
Do not print URLs, keys, excerpts, product names, or private draft counts.

Run this read-only target discovery before starting the browser:

```bash
node scripts/with-secrets.mjs node --input-type=module - <<'NODE'
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("public Supabase config unavailable");

const client = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const [foodsResult, evidenceResult, recallsResult] = await Promise.all([
  client
    .from("foods")
    .select("id, brand_id, protein_pct, carb_pct, kcal_per_kg, nutrient_sources, ingredients, grain_free, meal_free")
    .not("published_at", "is", null)
    .limit(1000),
  client
    .from("food_nutrient_evidence")
    .select("food_id, nutrient_key, value, excerpt")
    .eq("is_current", true)
    .in("nutrient_key", ["protein_pct", "carb_pct"])
    .limit(2000),
  client.from("recalls").select("food_id, brand_id").limit(1000),
]);

for (const result of [foodsResult, evidenceResult, recallsResult]) {
  if (result.error) throw new Error(result.error.message);
}

const foods = foodsResult.data ?? [];
const foodsById = new Map(foods.map((food) => [food.id, food]));
const withKcal = foods.filter((food) => food.kcal_per_kg !== null);

function classifyBound(excerpt) {
  const text = String(excerpt).normalize("NFKC").toLowerCase();
  const minimum = /(?:이상|\bmin(?:imum)?\b\.?|\bat least\b)/u.test(text);
  const maximum = /(?:이하|\bmax(?:imum)?\b\.?|\bat most\b|\bnot more than\b)/u.test(text);
  if (minimum === maximum) return "unspecified";
  return minimum ? "minimum" : "maximum";
}

function pairFor(targetIds) {
  for (const targetId of targetIds) {
    const target = foodsById.get(targetId);
    if (!target || target.kcal_per_kg === null) continue;
    for (const current of withKcal) {
      if (current.id === targetId) continue;
      const rankedIds = withKcal
        .filter((food) => food.id !== current.id)
        .sort((left, right) => {
          const leftDelta = Math.abs((left.kcal_per_kg - current.kcal_per_kg) / current.kcal_per_kg);
          const rightDelta = Math.abs((right.kcal_per_kg - current.kcal_per_kg) / current.kcal_per_kg);
          return leftDelta - rightDelta || left.id - right.id;
        })
        .slice(0, 3)
        .map((food) => food.id);
      if (rankedIds.includes(targetId)) return { currentId: current.id, targetId };
    }
  }
  return null;
}

function excerptSha256(excerpt) {
  return createHash("sha256")
    .update(String(excerpt).normalize("NFKC").replaceAll("−", "-"))
    .digest("hex");
}

function toColumnScale(value) {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  if (text.includes("e") || text.includes("E") || text.startsWith("-")) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length <= 2) return `${whole}.${fraction.padEnd(2, "0")}`;
  const kept = Number(`${whole}${fraction.slice(0, 2)}`);
  if (!Number.isSafeInteger(kept)) return null;
  const rounded = Number(fraction[2]) >= 5 ? kept + 1 : kept;
  const scaled = String(rounded).padStart(3, "0");
  return `${scaled.slice(0, -2)}.${scaled.slice(-2)}`;
}

function evidenceMatchesPublishedValue(evidence) {
  const food = foodsById.get(evidence.food_id);
  if (!food) return false;
  const source = food.nutrient_sources?.[evidence.nutrient_key];
  if (source !== "manufacturer" && source !== "kr_label") return false;
  const publishedValue = food[evidence.nutrient_key];
  return (
    publishedValue !== null &&
    toColumnScale(evidence.value) === toColumnScale(publishedValue)
  );
}

function evidenceCase(bound) {
  for (const evidence of evidenceResult.data ?? []) {
    if (
      classifyBound(evidence.excerpt) !== bound ||
      !evidenceMatchesPublishedValue(evidence)
    ) {
      continue;
    }
    const pair = pairFor([evidence.food_id]);
    if (!pair) continue;
    return {
      ...pair,
      excerptSha256: excerptSha256(evidence.excerpt),
      nutrientKey: evidence.nutrient_key,
    };
  }
  return null;
}

const recalls = recallsResult.data ?? [];
const recallCandidates = foods.flatMap((food) => {
  const product = recalls.some((recall) => recall.food_id === food.id);
  const brand = recalls.some(
    (recall) => recall.food_id === null && recall.brand_id === food.brand_id,
  );
  return product || brand
    ? [{ foodId: food.id, scope: product ? "product" : "brand" }]
    : [];
});
const recallCandidatesWithProof = recallCandidates.filter((candidate) =>
  (evidenceResult.data ?? []).some(
    (evidence) =>
      evidence.food_id === candidate.foodId &&
      evidenceMatchesPublishedValue(evidence),
  ),
);
const recallPair = pairFor(
  recallCandidatesWithProof.map((candidate) => candidate.foodId),
);
const recallScope = recallPair
  ? recallCandidatesWithProof.find(
      (candidate) => candidate.foodId === recallPair.targetId,
    )?.scope ?? null
  : null;
const recallEvidence = recallPair
  ? (evidenceResult.data ?? []).find(
      (evidence) =>
        evidence.food_id === recallPair.targetId &&
        evidenceMatchesPublishedValue(evidence),
    ) ?? null
  : null;

const measuredCarb = foods.filter((food) =>
  ["manufacturer", "kr_label"].includes(food.nutrient_sources?.carb_pct),
).length;
const derivedCarb = foods.filter((food) =>
  ["derived", "estimated"].includes(food.nutrient_sources?.carb_pct),
).length;

console.log(
  JSON.stringify(
    {
      baseline: {
        declaredCarb: measuredCarb,
        derivedOrEstimatedCarb: derivedCarb,
        grainFreeTrue: foods.filter((food) => food.grain_free === true).length,
        ingredientsNonempty: foods.filter(
          (food) => Array.isArray(food.ingredients) && food.ingredients.length > 0,
        ).length,
        kcalPresent: withKcal.length,
        mealFreeTrue: foods.filter((food) => food.meal_free === true).length,
        published: foods.length,
      },
      qa: {
        maximum: evidenceCase("maximum"),
        minimum: evidenceCase("minimum"),
        recall:
          recallPair && recallEvidence
            ? {
                ...recallPair,
                excerptSha256: excerptSha256(recallEvidence.excerpt),
                nutrientKey: recallEvidence.nutrient_key,
                scope: recallScope,
              }
            : null,
        unspecified: evidenceCase("unspecified"),
      },
    },
    null,
    2,
  ),
);
NODE
```

Expected: the exact counts may differ from the 2026-08-20 snapshot, but any newly enabled form control must have non-zero, semantically trustworthy coverage.
The `qa` object supplies a current-food ID and a target candidate ID that the v0 stable sort places in the first three results for each live scenario, plus the selected declared evidence nutrient key and SHA-256 of its normalized public excerpt.
Target discovery applies the same two-decimal Postgres column-scale comparison as the public proof path, so every non-null target is eligible to render a quoted proof.
If a `qa` entry is null, record that scenario as `[PARTIAL] not present in current public data` and retain its deterministic component-test coverage; do not invent or publish fixture data to force a live pass.

- [ ] **Step 2: Run focused tests first**

```bash
pnpm test -- src/lib/advisor.test.ts src/lib/food-evidence.test.ts src/lib/catalog-presentation.test.ts src/components/advisor-results.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run repository verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec knip
trunk check
```

Expected: all commands exit zero.
If an existing author-unknown workflow or Trunk change causes a failure, report the exact boundary and do not modify those files without authorization.

- [ ] **Step 4: Run Playwright browser scenarios against the real local surface**

Use the `webapp-testing` helper and inspect its current CLI before starting the server:

```bash
python3 /Users/dongminyu/.codex/skills/webapp-testing/scripts/with_server.py --help
```

Create a temporary Python Playwright script outside the repository with `apply_patch`.
Use `sync_playwright()`, launch headless Chromium, set a 390 × 844 viewport, wait for `networkidle` before every assertion, collect browser console errors, and always close the browser.
Copy each non-null `currentId`, `targetId`, `nutrientKey`, `excerptSha256`, and recall `scope` from Step 1 into task-specific environment variables; do not use `eval` on command output.

Use this script body at `/tmp/catfood-advisor-qa.py`:

```python
import hashlib
import os
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def optional_case(prefix: str, expected: str):
  current_id = os.environ.get(f"ADVISOR_{prefix}_CURRENT")
  target_id = os.environ.get(f"ADVISOR_{prefix}_TARGET")
  nutrient_key = os.environ.get(f"ADVISOR_{prefix}_NUTRIENT")
  excerpt_sha256 = os.environ.get(f"ADVISOR_{prefix}_EXCERPT_SHA256")
  if not current_id or not target_id or not nutrient_key or not excerpt_sha256:
    return None
  return {
    "current_id": current_id,
    "expected": expected,
    "excerpt_sha256": excerpt_sha256,
    "name": prefix.lower(),
    "nutrient_key": nutrient_key,
    "target_id": target_id,
  }


cases = [
  optional_case("MINIMUM", "최소 보증치"),
  optional_case("MAXIMUM", "최대 보증치"),
  optional_case("UNSPECIFIED", "경계 미확인"),
]
recall_scope = os.environ.get("ADVISOR_RECALL_SCOPE")
recall_expected = (
  "제품 범위" if recall_scope == "product" else "브랜드 범위"
  if recall_scope == "brand"
  else ""
)
cases.append(optional_case("RECALL", recall_expected))
cases = [case for case in cases if case is not None and case["expected"]]

screenshots = Path(os.environ.get("ADVISOR_QA_OUTPUT", "/tmp/catfood-advisor-qa"))
screenshots.mkdir(parents=True, exist_ok=True)
nutrient_labels = {
  "carb_pct": "탄수화물",
  "protein_pct": "단백질",
}

with sync_playwright() as playwright:
  browser = playwright.chromium.launch(headless=True)
  try:
    page = browser.new_page(viewport={"height": 844, "width": 390})
    console_errors = []
    page.on(
      "console",
      lambda message: console_errors.append(message.text)
      if message.type == "error"
      else None,
    )

    page.goto("http://127.0.0.1:3000/advisor")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_test_id("advisor-empty")).to_be_visible()

    for case in cases:
      page.goto(
        f"http://127.0.0.1:3000/advisor?current={case['current_id']}"
      )
      page.wait_for_load_state("networkidle")
      cards = page.locator(".advisor-candidate")
      assert 0 < cards.count() <= 3
      first_order = cards.evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-food-id'))"
      )
      page.reload()
      page.wait_for_load_state("networkidle")
      assert first_order == cards.evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-food-id'))"
      )

      card = page.locator(f"[data-food-id=\"{case['target_id']}\"]")
      expect(card).to_be_visible()
      expect(card).to_contain_text(case["expected"])
      assert page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth"
      )
      page.screenshot(
        full_page=True,
        path=str(screenshots / f"{case['name']}.png"),
      )

      detail_link = card.locator(
        f"a[href=\"/foods/{case['target_id']}\"]"
      ).first
      expect(detail_link).to_be_visible()
      detail_link.click()
      page.wait_for_load_state("networkidle")
      expect(page.get_by_text("균형을 읽는 법", exact=True)).to_be_visible()
      expect(page.get_by_text("근거와 미확인 항목", exact=True)).to_be_visible()

      nutrient_label = nutrient_labels[case["nutrient_key"]]
      fact = page.locator(".dossier-fact").filter(
        has=page.get_by_text(nutrient_label, exact=True)
      ).first
      proof = fact.locator(":scope > details")
      expect(proof).to_be_visible()
      proof.locator("summary").click()
      quote = proof.locator("blockquote.proof-quote").first
      expect(quote).to_be_visible()
      normalized_quote = unicodedata.normalize("NFKC", quote.inner_text()).replace(
        "−", "-"
      )
      actual_sha256 = hashlib.sha256(normalized_quote.encode("utf-8")).hexdigest()
      assert actual_sha256 == case["excerpt_sha256"]
      source_link = proof.get_by_role("link", name="원문 보기").first
      expect(source_link).to_be_visible()
      source_href = source_link.get_attribute("href")
      assert source_href is not None and urlparse(source_href).scheme == "https"
  finally:
    browser.close()

assert console_errors == [], console_errors
```

The script must navigate to `/advisor?current=<currentId>`, locate the exact candidate with `[data-food-id="<targetId>"]`, and assert these texts:

| Target                        | Required card text |
| ----------------------------- | ------------------ |
| `minimum`                     | `최소 보증치`      |
| `maximum`                     | `최대 보증치`      |
| `unspecified`                 | `경계 미확인`      |
| `recall` with scope `product` | `제품 범위`        |
| `recall` with scope `brand`   | `브랜드 범위`      |

Also assert no horizontal overflow at 390 px, no console errors, and that the candidate's `/foods/<targetId>` link opens a dossier containing `균형을 읽는 법` and `근거와 미확인 항목`.
Within the selected nutrient fact, open the top-level proof details, hash the rendered normalized excerpt, compare it with `excerptSha256`, and require the `원문 보기` anchor to use HTTPS.
Save full-page screenshots under a temporary directory, not the repository.

Run the managed server and script:

```bash
python3 /Users/dongminyu/.codex/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm dev" --port 3000 \
  -- python3 /tmp/catfood-advisor-qa.py
```

Verify these additional scenarios on the rendered `/advisor` page with the same script or a short reconnaissance pass:

1. No current food selected: no recommendations and a clear selection prompt.
2. Current food selected with no optional constraints: at most three candidates, stable across reloads, with missing kcal sorted last.
3. `kcalDelta=10`: every result with calculable kcal is within 10% of the current food and missing-kcal rows are excluded.
4. `declaredCarb=1`: no result presents `derived` or `estimated` carbohydrate as declared.
5. Cooking method selected: every result has the requested exact cooking method.
6. Candidate with a recall: the UI states product or brand scope and does not label the candidate unsafe.
7. Candidate with a minimum or maximum token: the printed relation is visible beside the value.
8. Candidate with an unrecognized bound: the UI says `경계 미확인`.
9. Narrow mobile viewport: form labels, candidate cards, evidence states, and links remain readable without horizontal scrolling.
10. Direct food-detail link: the evidence dossier opens and shows the existing original excerpt and source link.

Expected: every non-null live target passes its DOM assertion, screenshots are available in the temporary directory, the process exits zero, and any null target is reported explicitly as `[PARTIAL]` with the corresponding component test named.

- [ ] **Step 5: Record the release decision**

Proceed to a separately planned natural-language or MCP adapter only after the structured page demonstrates useful candidate coverage and the operator approves the product behavior.
If users repeatedly request ingredient exclusions, create a separate ingredient form/specificity and evidence-ingest plan before exposing that filter.
If too many requested nutrient comparisons remain `unspecified`, create a separate persistent qualifier and interval-propagation design instead of weakening the literal-evidence rule.

## Risks and controls

| Risk                                                         | Control                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Treating a guaranteed minimum or maximum as an exact amount. | Parse only literal relation markers, display the relation, and exclude nutrient point ranking.                   |
| Conflating provenance with value relation.                   | Keep `nutrient_sources` unchanged and model `NutrientBound` separately.                                          |
| Presenting unknown booleans as confirmed negatives.          | Do not expose grain-free or meal-free filters while current published data has no trustworthy positive coverage. |
| Misleading ingredient comparison.                            | Exclude ingredient conditions until form, specificity, and evidence are modeled and populated.                   |
| N+1 evidence queries.                                        | Batch at most 100 food IDs per public evidence query and group results in the server read model.                 |
| Turning v0 into a framework.                                 | Use one pure advisor module, one server page, one presentational component, and no new dependency or transport.  |
| Accidental health or safety advice.                          | Restrict reasons to explicit query matches and retain recall-scope and non-medical disclosures.                  |
| Silent live-data drift.                                      | Re-query aggregate public coverage before enabling controls and before release.                                  |

## Execution checkpoint

This plan is ready to execute only after plan review confirms that every referenced file and interface exists or is created by an earlier task, that the literal-bound policy is internally consistent, and that the narrowed v0 still provides a useful result with the current public data.
If implementation evidence contradicts those conditions, stop and request a plan revision instead of adding a fallback guess or expanding scope.
