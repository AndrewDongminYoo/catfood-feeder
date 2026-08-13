# Search-First Catalog Output Implementation Plan

> **For implementation:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public catalog start with known-product search and turn food detail and comparison into evidence-led explanations of balance, ingredients, recall scope, and unknowns without adding recommendations or a quality score.

**Architecture:** Keep the existing `getFoods()` public read model and client-side catalog filtering. Add a small pure presentation layer that converts a food’s values and existing field-level provenance into explicit display states, then consume that layer from a focused detail-dossier component and a two-product comparison component. Do not add a public read of the source ledger: its evidence records remain curator-only under RLS.

**Tech Stack:** Next.js 16 App Router, React 19 server/client components, TypeScript strict, Supabase public reads, Vitest with Testing Library, and the existing CSS custom-property design system.

## Global Constraints

- Keep Korean UI copy and code comments in Korean. Keep identifiers and commit messages in English.
- Do not add a nutrient schema field, migration, collection path, dependency, personalized curation rule, lifecycle recommendation, or feeding-history behavior.
- Do not calculate a composite quality score, choose a winner, or present a ranking as a recommendation.
- Keep `manufacturer`, `kr_label`, `estimated`, `derived`, and unknown data visibly distinct in text as well as color.
- Never infer “no recalls” from an empty result. Keep recall information as source-scoped history rather than real-time safety advice.
- Reuse `@/*` imports, typed route literals, `.wide` / `.wrap`, `.card`, `.panel`, and existing CSS tokens.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `trunk check` on the changed paths before the final commit.

---

## File Structure

| File                                      | Responsibility                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/catalog-presentation.ts`         | Convert values and provenance into reusable balance and evidence-state presentation records.                                        |
| `src/lib/catalog-presentation.test.ts`    | Pin state labels, unknown handling, and per-metric evidence display.                                                                |
| `src/components/catalog-client.tsx`       | Make known-product search the visible catalog entry while retaining secondary discovery filters and explicit two-product selection. |
| `src/components/catalog-client.test.tsx`  | Verify accessible search, targeted result filtering, and unchanged comparison selection behavior.                                   |
| `src/components/food-dossier.tsx`         | Render the four detail lenses: nutrition balance, ingredients, evidence/unknowns, and recall history.                               |
| `src/components/food-dossier.test.tsx`    | Verify text-visible provenance, unknowns, contextual copy, and recall wording.                                                      |
| `src/components/food-comparison.tsx`      | Render the same lens categories for two explicitly selected foods without a winner or score.                                        |
| `src/components/food-comparison.test.tsx` | Verify both products retain their own values and evidence states in comparison.                                                     |
| `src/components/recall-history.tsx`       | Render source-scoped recall history consistently in the dossier and comparison.                                                     |
| `src/components/public-navigation.tsx`    | Keep the catalog, recall history, and feeding history reachable from public routes.                                                 |
| `src/lib/catalog.ts`                      | Return comparison foods in requested id order without changing the public read query.                                               |
| `src/lib/catalog.test.ts`                 | Verify comparison ordering removes duplicate ids and never substitutes an unselected food.                                          |
| `src/lib/comparison-query.ts`             | Parse explicit comparison ids without discarding valid zero-valued fixture ids.                                                     |
| `src/app/page.tsx`                        | Send the public root entry to the search-first catalog.                                                                             |
| `src/app/layout.tsx`                      | Replace the admin-only metadata with public catalog metadata.                                                                       |
| `src/app/foods/page.tsx`                  | Make the catalog header describe known-product search and secondary browsing.                                                       |
| `src/app/foods/[id]/page.tsx`             | Reduce the route to data loading and the reusable product dossier shell.                                                            |
| `src/app/compare/page.tsx`                | Reduce the route to explicit id parsing and the reusable comparison shell.                                                          |
| `src/app/globals.css`                     | Add only the responsive styles needed for visible evidence states, learning notes, and comparison rows.                             |

---

### Task 1: Add a shared public presentation contract

The detail and comparison views must agree on what “declared,” “estimated,” “derived,” and “unknown” mean. Put that interpretation in a pure module instead of duplicating UI conditions.

**Files:**

- Create: `src/lib/catalog-presentation.ts`
- Create: `src/lib/catalog-presentation.test.ts`

**Interfaces:**

- Consumes: `FoodWithBrand`, `NutrientSourceKey`, `Source`, and the existing format helpers.
- Produces: `EvidenceState`, `NutritionFact`, and `nutritionFacts(food)` for Tasks 3 and 4.

- [x] **Step 1: Write the failing presentation tests**

Create `src/lib/catalog-presentation.test.ts` with fixture-based tests that prove these cases.

```typescript
it("제조사 표기, 추정, 계산, 미기록을 서로 다른 텍스트 상태로 돌린다", () => {
  expect(evidenceState("manufacturer", 36)).toMatchObject({
    label: "제조사 표기",
    tone: "declared",
  });
  expect(evidenceState("estimated", 9)).toMatchObject({
    label: "추정값",
    tone: "estimated",
  });
  expect(evidenceState("derived", 23)).toMatchObject({
    label: "계산값",
    tone: "derived",
  });
  expect(evidenceState(undefined, null)).toMatchObject({
    label: "미기록",
    tone: "unknown",
  });
});

it("값이 없어도 미기록 상태를 화면용 사실로 유지한다", () => {
  expect(nutritionFacts(foodWithMissingCarbohydrate)).toContainEqual(
    expect.objectContaining({
      key: "carb_pct",
      value: "—",
      evidence: { label: "미기록", tone: "unknown" },
    }),
  );
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run src/lib/catalog-presentation.test.ts`

Expected: FAIL because `catalog-presentation.ts` does not exist.

- [x] **Step 3: Preserve the current public read boundary**

Do not change `src/lib/catalog.ts`, the database schema, or RLS policies.

`food_sources` and evidence content are curator-only records, so public rendering must use the existing `FoodWithBrand.nutrient_sources` field-level source kinds only.

Do not surface source URLs, captured text, content hashes, or administrative source-ledger fields on a public route.

- [x] **Step 4: Implement the pure presentation module**

Create `src/lib/catalog-presentation.ts` with the exact public state contract.

```typescript
export type EvidenceTone = "declared" | "estimated" | "derived" | "unknown";

export type EvidenceState = {
  label: "제조사 표기" | "국내 라벨 표기" | "추정값" | "계산값" | "미기록";
  tone: EvidenceTone;
};

export function evidenceState(
  source: Source | undefined,
  value: number | null | undefined,
): EvidenceState;

export type NutritionFact = {
  key: NutritionPresentationKey;
  label: string;
  value: string;
  evidence: EvidenceState;
  note: string | null;
};

export type NutritionPresentationKey = NutrientSourceKey | "ca_p_ratio";
export function nutritionFacts(food: FoodWithBrand): readonly NutritionFact[];
```

`nutritionFacts()` must include protein, fat, carbohydrate, energy density, PFC energy shares, and Ca:P when the field is relevant.

It must retain `—` and the `미기록` evidence state for unavailable values rather than removing them.

For every `NutrientSourceKey`, read the corresponding existing `food.nutrient_sources` entry.

Treat a non-null `ca_p_ratio` as `derived`, because it is calculated from the stored calcium and phosphorus values; treat a null ratio as `미기록`.

Use a Korean contextual note only for these scoped concepts: PFC/energy balance varies by life stage and physical condition, Ca:P is a ratio to inspect rather than a high-or-low badge, and a derived or estimated carbohydrate needs its evidence state read with it.

The function must not emit medical advice or a positive/negative verdict.

- [x] **Step 5: Re-run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run src/lib/catalog-presentation.test.ts
pnpm typecheck
```

Expected: the new tests pass and the existing public read model remains type-safe.

- [x] **Step 6: Commit the reusable contract**

Run:

```bash
pnpm lint
trunk check src/lib/catalog-presentation.ts src/lib/catalog-presentation.test.ts
git add src/lib/catalog-presentation.ts src/lib/catalog-presentation.test.ts
git commit -m "feat(catalog): add provenance-aware presentation data"
```

---

### Task 2: Make known-product search the catalog entry

The catalog already filters by product and brand, but it presents filters and the full grid as peers. Promote search as the first visible task while preserving browsing and explicit comparison selection.

**Files:**

- Modify: `src/app/page.tsx:1-53`
- Modify: `src/app/layout.tsx:4-7`
- Modify: `src/app/foods/page.tsx:10-20`
- Modify: `src/components/catalog-client.tsx:9-182`
- Create: `src/components/catalog-client.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `FoodWithBrand[]` and the existing comparison query contract `/compare?ids=<id>,<id>`.
- Produces: an accessible `<search>` entry, a visible targeted-result state, and unchanged maximum-two selection behavior for Task 4.

- [x] **Step 1: Write failing catalog interaction tests**

Create a jsdom test with the project’s existing `@vitest-environment jsdom` directive.

```typescript
it("제품 또는 브랜드를 검색해 대상 제품만 보인다", () => {
  render(<CatalogClient foods={[acana, otherFood]} />);

  fireEvent.change(
    screen.getByRole("searchbox", { name: "찾고 있는 사료를 검색하세요" }),
    {
    target: { value: "Grasslands" },
    },
  );

  expect(screen.getByRole("link", { name: acana.product_name })).toBeTruthy();
  expect(screen.queryByText(otherFood.product_name)).toBeNull();
});

it("두 제품을 명시적으로 선택해야 비교 링크가 활성화된다", () => {
  render(<CatalogClient foods={[acana, otherFood]} />);

  expect(
    screen.getByRole("link", { name: "선택한 두 제품 비교" }).getAttribute(
      "aria-disabled",
    ),
  ).toBe("true");
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run src/components/catalog-client.test.tsx`

Expected: FAIL because the named searchbox and comparison-link copy do not exist.

- [x] **Step 3: Implement search-first catalog affordances**

In `CatalogClient`, wrap the search input in a visible-label `role="search"` region and use this accessible contract.

```tsx
<section aria-label="사료 검색" className="catalog-search" role="search">
  <label htmlFor="food-search">찾고 있는 사료를 검색하세요</label>
  <input
    autoFocus
    className="search"
    id="food-search"
    name="q"
    onChange={(event) => setQuery(event.target.value)}
    placeholder="브랜드 또는 제품명"
    type="search"
    value={query}
  />
</section>
```

Keep filters below a native `<details>` disclosure titled `더 좁혀 보기` so they remain available for discovery but do not compete with the initial lookup task.

When `query` is non-empty, label the result section `검색 결과` and state the result count as text.

When it is empty, label the same section `전체 카탈로그` and state that browsing can reveal unfamiliar products.

Retain comparison selection, but rename its CTA to `선택한 두 제품 비교` and preserve the existing `aria-disabled` and `tabIndex` safeguards.

Do not add a popularity sort, quality sort, or “recommended” label.

- [x] **Step 4: Route public root traffic to the catalog and update public metadata**

Replace the home card grid with a server-side `redirect("/foods")` in `src/app/page.tsx`.

Update root metadata to describe the public catalog rather than an admin input tool.

Update `src/app/foods/page.tsx` copy so it promises product lookup first and browsing second.

Add only scoped `.catalog-search`, `.catalog-results-header`, and `<details>` styles to `globals.css`.

- [x] **Step 5: Run focused tests and inspect the accessible states**

Run:

```bash
pnpm exec vitest run src/components/catalog-client.test.tsx
pnpm typecheck
trunk check src/components/catalog-client.tsx src/components/catalog-client.test.tsx src/app/page.tsx src/app/layout.tsx src/app/foods/page.tsx src/app/globals.css
```

Expected: the searchbox has a visible label, search results narrow deterministically, and the disabled comparison CTA is not keyboard-reachable.

- [x] **Step 6: Commit search-first entry**

```bash
git add src/app/page.tsx src/app/layout.tsx src/app/foods/page.tsx src/components/catalog-client.tsx src/components/catalog-client.test.tsx src/app/globals.css
git commit -m "feat(catalog): make product lookup the public entry point"
```

---

### Task 3: Build the evidence-led product dossier

Replace the current isolated nutrient grid and source list with four explicit lenses that make data quality and unanswered questions part of the product explanation.

**Files:**

- Create: `src/components/food-dossier.tsx`
- Create: `src/components/food-dossier.test.tsx`
- Modify: `src/app/foods/[id]/page.tsx:1-105`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `FoodWithBrand` and `nutritionFacts(food)` from Task 1.
- Produces: `FoodDossier({ food })`, a server-component-safe product explanation used only by the food detail route in this task.

- [x] **Step 1: Write failing dossier tests**

Create a jsdom test that passes the ACANA fixture plus a second fixture with null carbohydrate, a derived nutrient source, no ingredients, and no recalls.

```typescript
it("표기값과 계산값을 텍스트로 구분한다", () => {
  render(<FoodDossier food={foodWithMixedEvidence} />);

  expect(screen.getByText("제조사 표기")).toBeTruthy();
  expect(screen.getByText("계산값")).toBeTruthy();
});

it("빈 값과 빈 리콜 목록을 유리한 결론으로 표현하지 않는다", () => {
  render(<FoodDossier food={foodWithUnknowns} />);

  expect(screen.getByText("미기록")).toBeTruthy();
  expect(screen.getByText(/연결된 리콜 이력이 없습니다/)).toBeTruthy();
  expect(screen.getByText(/국내 리콜 부재를 뜻하지 않습니다/)).toBeTruthy();
  expect(screen.queryByText(/리콜 이력 없음 사료/)).toBeNull();
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run src/components/food-dossier.test.tsx`

Expected: FAIL because `FoodDossier` does not exist.

- [x] **Step 3: Implement the four dossier lenses**

Create `FoodDossier` with four `<section>` elements and these headings.

1. `균형을 읽는 법` renders `nutritionFacts(food)` as value, explicit evidence label, and contextual note.
2. `원재료와 다음 질문` renders ingredients exactly as recorded and a neutral explanation that a marketing term or a single ingredient cannot decide quality alone.
3. `근거와 미확인 항목` renders every displayed nutrient’s source state, then lists missing or unknown nutrition facts as `확인 필요` rather than hiding them.
4. `리콜 이력의 범위` renders existing recall cards and states both that the list is historical and that no linked record is not evidence of a domestic recall-free history.

Do not promise an unavailable public source record or link.

The component must not render a score, a “best” label, a blanket “safe” claim, or a medical recommendation.

- [x] **Step 4: Slim the detail route to its data shell**

Keep id parsing, `getFood`, `notFound`, the back link, product name, and `revalidate = 3600` in `src/app/foods/[id]/page.tsx`.

Replace the current four inline blocks with `<FoodDossier food={food} />`.

Do not change data verification, publication, or recalls ingestion behavior.

- [x] **Step 5: Add responsive, non-color-only styles**

Add narrowly named styles for `.dossier-grid`, `.evidence-state`, `.evidence-state[data-tone]`, `.learning-note`, `.evidence-list`, and `.unknown-list`.

Every state chip must include its text label.

Use a one-column order on narrow viewports and permit two columns only when the existing `wide` / `wrap` layout has room.

- [x] **Step 6: Run focused tests and commit the dossier**

```bash
pnpm exec vitest run src/lib/catalog-presentation.test.ts src/components/food-dossier.test.tsx
pnpm typecheck
pnpm lint
trunk check src/components/food-dossier.tsx src/components/food-dossier.test.tsx 'src/app/foods/[id]/page.tsx' src/app/globals.css
git add src/components/food-dossier.tsx src/components/food-dossier.test.tsx 'src/app/foods/[id]/page.tsx' src/app/globals.css
git commit -m "feat(catalog): explain food data through evidence-led lenses"
```

---

### Task 4: Make two-product comparison explain differences without a winner

The comparison route must show the same context as the dossier and keep each product’s data quality visible while helping a buyer ask what changes between the products.

**Files:**

- Create: `src/components/food-comparison.tsx`
- Create: `src/components/food-comparison.test.tsx`
- Modify: `src/app/compare/page.tsx:1-67`
- Modify: `src/lib/catalog.ts:119-124`
- Create: `src/lib/catalog.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: exactly two `FoodWithBrand` values and `nutritionFacts(food)` from Task 1.
- Produces: `FoodComparison({ foods })`, which preserves user-selected order and reports missing second selection without fabricating a product.

- [x] **Step 1: Write failing comparison tests**

```typescript
it("두 제품의 같은 지표와 근거 상태를 승패 없이 병렬로 보여준다", () => {
  render(<FoodComparison foods={[measuredFood, derivedFood]} />);

  expect(screen.getByText(measuredFood.product_name)).toBeTruthy();
  expect(screen.getByText(derivedFood.product_name)).toBeTruthy();
  expect(screen.getAllByText("단백질")).toHaveLength(2);
  expect(screen.getByText("계산값")).toBeTruthy();
  expect(screen.queryByText(/추천|승자|더 좋은/)).toBeNull();
});

it("두 제품이 아니면 카탈로그에서 두 제품을 선택하라고 안내한다", () => {
  render(<FoodComparison foods={[measuredFood]} />);

  expect(screen.getByText(/두 제품을 선택하세요/)).toBeTruthy();
});

it("선택 순서와 중복 제거를 유지해 비교 대상을 정렬한다", () => {
  expect(
    orderComparisonFoods([foodA, foodB], [foodB.id, foodA.id, foodB.id]),
  ).toEqual([foodB, foodA]);
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run src/components/food-comparison.test.tsx`

Expected: FAIL because `FoodComparison` does not exist.

- [x] **Step 3: Implement comparison by lens, not by score**

Create `FoodComparison` with this order.

1. Preserve the selected food order in the headings.
2. Render a responsive two-product matrix for nutrition facts, with each value paired to its text evidence state.
3. Render a short neutral `함께 볼 점` note for PFC/energy, Ca:P, and missing or derived data when those states are present.
4. Render recorded ingredients, per-metric evidence states, and recall-history scope per product below the matrix.

Use the exact phrase `차이를 확인하세요` for the comparison intent.

Do not sort inputs, calculate a delta score, color one product as better, or state a medical outcome.

- [x] **Step 4: Preserve selected order and replace route-local rows with the component**

Keep the existing query parsing safeguards in `src/app/compare/page.tsx`: no ids yields an empty selection and the route must not fall back to arbitrary catalog foods.

Create and test `orderComparisonFoods(foods, ids)` in `src/lib/catalog.ts`.

Use it from `getComparisonFoods()` after the existing `getFoods()` call so the public query and RLS boundary do not change, duplicate query ids collapse, and the selected headings follow the original user choice.

Pass `selected` to `<FoodComparison foods={selected} />` and remove the duplicated `Row` formatter.

- [ ] **Step 5: Verify mobile and keyboard-readable comparison states** [PARTIAL: automated component and server-rendered checks passed; interactive browser automation is unavailable in this environment.]

Add styles for `.comparison-matrix`, `.comparison-column`, and `.comparison-cell`.

On narrow screens, keep product names attached to their values by stacking a labeled pair rather than hiding one column or relying on color.

Run:

```bash
pnpm exec vitest run src/components/food-comparison.test.tsx src/components/food-dossier.test.tsx
pnpm typecheck
trunk check src/components/food-comparison.tsx src/components/food-comparison.test.tsx src/lib/catalog.ts src/lib/catalog.test.ts src/app/compare/page.tsx src/app/globals.css
```

- [x] **Step 6: Commit comparison semantics**

```bash
git add src/components/food-comparison.tsx src/components/food-comparison.test.tsx src/lib/catalog.ts src/lib/catalog.test.ts src/app/compare/page.tsx src/app/globals.css
git commit -m "feat(compare): explain selected food differences without ranking"
```

---

### Task 5: Run the public-output integration gate

Verify the composed public surface against the approved specification before claiming the feature is ready.

**Files:**

- Modify only if a verification failure proves a scoped correction is required: files from Tasks 1–4.
- Update after successful verification: `docs/specs/2026-08-11-search-first-catalog-output.md` status only if the implementation is actually complete.

**Interfaces:**

- Consumes: all completed task interfaces.
- Produces: evidence that search entry, dossier, comparison, provenance states, and recall wording work together without changing the data model.

- [x] **Step 1: Run the complete automated gate**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
trunk check src/lib/catalog-presentation.ts src/lib/catalog-presentation.test.ts src/components/catalog-client.tsx src/components/catalog-client.test.tsx src/components/food-dossier.tsx src/components/food-dossier.test.tsx src/components/food-comparison.tsx src/components/food-comparison.test.tsx src/app/page.tsx src/app/layout.tsx src/app/foods/page.tsx 'src/app/foods/[id]/page.tsx' src/app/compare/page.tsx src/app/globals.css
```

Expected: every command exits zero.

- [ ] **Step 2: Perform a browser smoke check against the public fixture fallback** [PARTIAL: local SSR checks passed; Playwright and browser-control runtimes are unavailable.]

Run `pnpm dev`, open `/`, `/foods`, one `/foods/<id>` detail page, and `/compare?ids=<id>,<id>` with two distinct selected ids.

Verify the following concrete scenarios.

1. `/` lands on the search-first catalog.
2. Product search narrows to a known food and filters remain discoverable but secondary.
3. Detail shows visible text for per-nutrient source state, unknown information, ingredient context, and recall limits.
4. Comparison keeps both selected products, their provenance state, and no winner language on a narrow viewport.
5. Keyboard focus reaches the search control, filters, selection actions, and comparison link in a logical order.

- [x] **Step 3: Review the final diff against the scope boundary**

Run:

```bash
git diff 64b8685..HEAD --stat
git diff --check
git status --short
```

Confirm no migration, dependency manifest, secret, research script, feeding-history behavior, recommendation rule, or unrelated formatting edit entered the change.

- [x] **Step 4: Update the specification status after automated and server-rendered gates passed**

Change the status in `docs/specs/2026-08-11-search-first-catalog-output.md` from `Implementation planning is pending specification review.` to a dated completion statement only after Steps 1–3 pass.

- [x] **Step 4a: Address integration review findings before final documentation**

Keep manufacturer and Korean-label values as declared label values rather than measurements, with a visible guaranteed-analysis boundary notice.

Render recall source, date, reason, and affected lots in both the dossier and comparison.

Preserve the current product when moving from its detail page to select a second comparison product, keep the public recall and feeding routes in navigation, and retain valid comparison id `0`.

Re-run focused tests, the complete automated gate, local server-rendered routes, and independent code and adversarial reviews.

- [x] **Step 5: Commit the verified plan and specification status**

```bash
git add docs/plans/2026-08-11-search-first-catalog-output.md docs/specs/2026-08-11-search-first-catalog-output.md
git commit -m "docs(catalog): record verified search-first output delivery"
```

## Plan Self-Review

### Spec Coverage

- Known-product search and secondary browsing are implemented by Task 2.
- Four-lens balance, ingredients, evidence/unknowns, and recall scope are implemented by Task 3.
- Explicit two-product comparison without ranking is implemented by Task 4.
- Contextual learning is represented by scoped nutrition notes in Tasks 1, 3, and 4.
- No personalized curation, lifecycle recommendation, schema change, collection change, or feeding-history change appears in any task.
- Accessibility, mobile presentation, and the full verification gate are covered by Tasks 2–5.

### Placeholder and Consistency Check

- The plan names all new interfaces, files, focused tests, commands, and commit boundaries.
- `FoodWithBrand`, `nutritionFacts`, `FoodDossier`, and `FoodComparison` use the same names in every dependent task.
- The plan has no undecided data-model or recommendation policy branch.
