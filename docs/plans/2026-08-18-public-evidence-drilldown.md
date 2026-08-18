# Public Evidence Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor expand any published nutrient value on the food detail page to the literal source excerpt that produced it, or to the formula when the value was computed.

**Architecture:** One migration opens column-scoped, published-only reads on the two evidence tables. A new cached loader in `src/lib/catalog.ts` fetches one food's current evidence. The presentation layer attaches a `proof` to each fact, and the dossier renders it inside a native `<details>` disclosure with the value marked inside its quote.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres with RLS, Vitest, pgTAP.

**Spec:** `docs/specs/2026-08-18-public-evidence-drilldown.md`

## Global Constraints

- Korean stays Korean in UI strings and code comments; identifiers and commit messages stay English.
- Add no new dependency.
- Do not import `createAdminClient` into any public catalog path.
- Do not change `src/lib/domain.ts`.
- Do not change the behavior of `excerptContainsValue`; it is a capture-time correctness guard.
- Preserve the `SAMPLE_FOODS` fallback: with Supabase unconfigured the catalog renders as it does today.
- Create the migration with `pnpm supabase migration new <name>`; never hand-edit an applied migration.
- Verification commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `supabase test db`, `trunk check`.

## File Structure

| File                                                | Responsibility                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_public_evidence_read.sql` | Create the anon-facing RLS policies and column grants.                           |
| `supabase/tests/public_evidence_read_test.sql`      | Assert the boundary: published readable, draft not, `captured_text` denied.      |
| `src/lib/excerpt-match.ts`                          | Shared numeric-token normalizer, plus the display-side value matcher.            |
| `src/lib/source-extraction.ts`                      | Modified: import the normalizer instead of holding a private copy.               |
| `src/lib/catalog.ts`                                | Modified: `NutrientEvidence` type, `loadFoodEvidence`, cached `getFoodEvidence`. |
| `src/lib/catalog-presentation.ts`                   | Modified: `NutritionProof`, `proof` on `NutritionFact`, formula construction.    |
| `src/app/foods/[id]/page.tsx`                       | Modified: load evidence and pass it to the dossier.                              |
| `src/components/food-dossier.tsx`                   | Modified: `<details>` disclosure rendering quoted and computed proofs.           |
| `src/app/globals.css`                               | Modified: disclosure and quote styles.                                           |

## Scope Boundaries

Facts that receive a proof in this plan:

- `protein_pct`, `fat_pct`, `kcal_per_kg` — quoted when a current evidence row exists.
- `carb_pct` — quoted for the 12 rows with evidence, computed for the other 113.
- `ca_p_ratio` — computed from calcium and phosphorus.

`energy_p_pct`, `energy_f_pct`, and `energy_c_pct` receive no proof in this pass.
Production carries zero evidence rows for those keys, and their two-path derivation is not specified.
They keep their existing badge and simply do not expand, which is the same behavior as any fact without evidence.

---

### Task 1: Open Published Evidence to Public Reads

**Files:**

- Create: `supabase/migrations/<timestamp>_public_evidence_read.sql`
- Test: `supabase/tests/public_evidence_read_test.sql`

**Interfaces:**

- Consumes: nothing.
- Produces: `anon` and `authenticated` may select `food_nutrient_evidence` rows, and the columns `(id, food_id, kind, url, capture_method, captured_at)` of `food_sources`, for current rows belonging to a food whose `published_at` is not null.

- [ ] **Step 1: Write the failing pgTAP suite**

Create `supabase/tests/public_evidence_read_test.sql`.
The local role setup mirrors `supabase/tests/foods_publication_rls_test.sql`, where in-transaction grants are required because local default privileges lack them.

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(5);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-93001, 'pgTAP evidence brand', 'pgTAP evidence brand', 'pgTAP manufacturer');

INSERT INTO public.foods (id, brand_id, product_name, published_at, verification_method)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'pgTAP published food', '2026-08-18 00:00:00+00'::timestamptz, 'legacy_human'),
  (-93002, -93001, 'pgTAP draft food', NULL, NULL);

INSERT INTO public.food_sources
  (id, food_id, kind, url, capture_method, fetch_status, captured_at, captured_text, is_current)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'manufacturer', 'https://example.test/published', 'fetch', 'fetched',
   '2026-08-18 00:00:00+00'::timestamptz, 'published body', true),
  (-93002, -93002, 'manufacturer', 'https://example.test/draft', 'fetch', 'fetched',
   '2026-08-18 00:00:00+00'::timestamptz, 'draft body', true);

INSERT INTO public.food_nutrient_evidence
  (id, food_id, nutrient_key, source_id, value, excerpt, captured_at, is_current)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'protein_pct', -93001, 36, 'Crude Protein 36.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true),
  (-93002, -93002, 'protein_pct', -93002, 30, 'Crude Protein 30.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true);

SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE food_id = -93001),
  1,
  'anon reads evidence for a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE food_id = -93002),
  0,
  'anon cannot read evidence for a draft food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_sources WHERE food_id = -93001),
  1,
  'anon reads the source backing a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_sources WHERE food_id = -93002),
  0,
  'anon cannot read the source of a draft food'
);

SELECT throws_ok(
  'SELECT captured_text FROM public.food_sources WHERE food_id = -93001',
  '42501',
  NULL,
  'anon cannot select captured_text from any source'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the suite and verify it fails**

Run: `supabase db start && supabase test db`

Expected: FAIL. The first assertion returns 0 instead of 1 because `anon` currently holds no privilege on `food_nutrient_evidence`.

Record which assertions failed. This is the fail-first evidence that the suite reads the policy rather than passing vacuously.

- [ ] **Step 3: Create the migration**

Run: `pnpm supabase migration new public_evidence_read`

Write into the generated file:

```sql
-- 발행된 사료의 근거만 공개한다. 초안(published_at IS NULL)의 근거는 계속 비공개다.
-- captured_text 는 페이지 본문 전체라 컬럼 단위로 제외한다 — 인용 구절은 evidence.excerpt 가 가진다.

CREATE POLICY "public read evidence of published foods"
  ON public.food_nutrient_evidence FOR SELECT
  TO anon, authenticated
  USING (
    is_current
    AND EXISTS (
      SELECT 1 FROM public.foods f
      WHERE f.id = food_id AND f.published_at IS NOT NULL
    )
  );

CREATE POLICY "public read sources of published foods"
  ON public.food_sources FOR SELECT
  TO anon, authenticated
  USING (
    is_current
    AND fetch_status = 'fetched'
    AND EXISTS (
      SELECT 1 FROM public.foods f
      WHERE f.id = food_id AND f.published_at IS NOT NULL
    )
  );

GRANT SELECT ON TABLE public.food_nutrient_evidence TO anon, authenticated;
GRANT SELECT (id, food_id, kind, url, capture_method, captured_at)
  ON TABLE public.food_sources TO anon, authenticated;
```

- [ ] **Step 4: Apply and verify the suite passes**

Run: `supabase db reset && supabase test db`

Expected: PASS, all 5 assertions.

- [ ] **Step 5: Regenerate types and run the gates**

Run: `pnpm typecheck && pnpm lint && trunk check supabase/migrations supabase/tests`

Expected: no issues. Regenerate `src/types/supabase.d.ts` only if the project's generation script reports drift.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(db): expose published food evidence to public reads"
```

---

### Task 2: Extract the Shared Excerpt Matcher

**Files:**

- Create: `src/lib/excerpt-match.ts`
- Create: `src/lib/excerpt-match.test.ts`
- Modify: `src/lib/source-extraction.ts:286-357` (remove the private copies, import instead)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `normalizeDecimalLiteral(value: string): string | null`
  - `normalizeNumericToken(token: string): string | null`
  - `matchExcerptValue(excerpt: string, value: number): { before: string; match: string; after: string } | null`

`excerptContainsValue` stays in `src/lib/source-extraction.ts` with its behavior unchanged, importing the normalizers instead of defining them.

- [ ] **Step 1: Write the failing test**

Create `src/lib/excerpt-match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchExcerptValue } from "./excerpt-match";

describe("matchExcerptValue", () => {
  it("marks a token whose trailing zeros differ from the stored value", () => {
    expect(matchExcerptValue("Crude Fat 14.00%", 14)).toEqual({
      before: "Crude Fat ",
      match: "14.00",
      after: "%",
    });
  });

  it("reads a decimal comma as a decimal point rather than deleting it", () => {
    expect(matchExcerptValue("조섬유 2,5 %", 2.5)).toEqual({
      before: "조섬유 ",
      match: "2,5",
      after: " %",
    });
    expect(matchExcerptValue("조섬유 2,5 %", 25)).toBeNull();
  });

  it("selects the token matching the value when the excerpt carries several", () => {
    expect(
      matchExcerptValue(
        "Metabolizable Energy (ME) 3,200 kcal/kg; 320 kcal/cup",
        3200,
      ),
    ).toEqual({
      before: "Metabolizable Energy (ME) ",
      match: "3,200",
      after: " kcal/kg; 320 kcal/cup",
    });
  });

  it("returns null when no token equals the value", () => {
    expect(matchExcerptValue("Crude Protein 36%", 30)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/excerpt-match.test.ts`

Expected: FAIL, cannot resolve `./excerpt-match`.

- [ ] **Step 3: Create the shared module**

Create `src/lib/excerpt-match.ts`.
Move `DECIMAL_COMMA` and `normalizeDecimalLiteral` verbatim out of `src/lib/source-extraction.ts`, then add the two new exports:

```ts
/**
 * 유럽 라벨의 소수점 쉼표("조섬유 2,5 %"). 쉼표 뒤 자릿수가 1~2개면 천 단위 묶음일
 * 수 없으므로(묶음은 정확히 3자리) 소수점으로 읽는 것 외에 다른 해석이 없다.
 * "1,500"처럼 3자리인 것은 여기 걸리지 않고 천 단위로 남는다 — 그 둘은 겹치지 않는다.
 */
const DECIMAL_COMMA = /^-?\d+,\d{1,2}$/;

const NUMERIC_TOKEN = /-?(?=[\d,.]*\d)[\d,.]+/g;

const PLAIN_NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/;

export function normalizeDecimalLiteral(value: string): string | null {
  // (source-extraction.ts 에 있던 본문을 그대로 옮긴다)
}

/** 토큰 하나를 정규화한 십진 문자열로. 모양이 소수점 쉼표면 소수점으로, 아니면 천 단위로 읽는다. */
export function normalizeNumericToken(token: string): string | null {
  if (!DECIMAL_COMMA.test(token) && !PLAIN_NUMBER.test(token)) return null;
  return normalizeDecimalLiteral(
    DECIMAL_COMMA.test(token)
      ? token.replace(",", ".")
      : token.replaceAll(",", ""),
  );
}

/**
 * 표시용 매처. 값과 같은 토큰의 위치를 돌려준다.
 * 추출 시점 가드인 excerptContainsValue 와 달리 토큰이 여럿이어도 허용한다 —
 * 그쪽은 모호한 구절을 거절해야 하고, 이쪽은 이미 확정된 값을 가리키기만 한다.
 */
export function matchExcerptValue(
  excerpt: string,
  value: number,
): { before: string; match: string; after: string } | null {
  if (!Number.isFinite(value)) return null;
  const normalized = excerpt.normalize("NFKC").replace(/−/g, "-");
  if (normalized.includes("⁄")) return null;
  const target = normalizeDecimalLiteral(String(value));
  if (target === null) return null;

  for (const found of normalized.matchAll(NUMERIC_TOKEN)) {
    const token = found[0];
    if (normalizeNumericToken(token) !== target) continue;
    const start = found.index;
    return {
      after: normalized.slice(start + token.length),
      before: normalized.slice(0, start),
      match: token,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/excerpt-match.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Point source-extraction at the shared module**

In `src/lib/source-extraction.ts`, delete the local `DECIMAL_COMMA` and `normalizeDecimalLiteral`, add `import { DECIMAL_COMMA, normalizeDecimalLiteral } from "./excerpt-match";` (exporting `DECIMAL_COMMA` from the new module), and leave the body of `excerptContainsValue` otherwise untouched.

Its single-token rejection must survive this edit.

- [ ] **Step 6: Verify the extraction suite still passes**

Run: `pnpm vitest run src/lib && pnpm typecheck`

Expected: PASS. `src/lib/source-first-boundary.test.ts` must stay green, confirming the new module did not disturb the single-caller boundary.

- [ ] **Step 7: Commit**

```bash
git add src/lib/excerpt-match.ts src/lib/excerpt-match.test.ts src/lib/source-extraction.ts
git commit -m "refactor(lib): share the excerpt numeric matcher with a display-side variant"
```

---

### Task 3: Load One Food's Evidence

**Files:**

- Modify: `src/lib/catalog.ts`
- Create: `src/lib/food-evidence.test.ts`

**Interfaces:**

- Consumes: Task 1's public read policies.
- Produces:
  - `export interface NutrientEvidence { nutrient_key: NutrientSourceKey; value: number; excerpt: string; captured_at: string; source: { url: string; kind: string; capture_method: string } }`
  - `export async function loadFoodEvidence(supabase: SupabaseClient<Database>, foodId: number): Promise<NutrientEvidence[]>`
  - `export async function getFoodEvidence(foodId: number): Promise<NutrientEvidence[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/food-evidence.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadFoodEvidence } from "./catalog";

function clientReturning(data: unknown, error: unknown = null) {
  const eqSecond = vi.fn().mockResolvedValue({ data, error });
  const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
  const select = vi.fn().mockReturnValue({ eq: eqFirst });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select };
}

describe("loadFoodEvidence", () => {
  it("requests only the granted columns of the embedded source", async () => {
    const { client, from, select } = clientReturning([]);
    await loadFoodEvidence(client, 95);
    expect(from).toHaveBeenCalledWith("food_nutrient_evidence");
    const requested = select.mock.calls[0]?.[0] as string;
    expect(requested).toContain(
      "food_sources!inner(url, kind, capture_method)",
    );
    expect(requested).not.toContain("*");
    expect(requested).not.toContain("captured_text");
  });

  it("flattens the embedded source onto each evidence row", async () => {
    const { client } = clientReturning([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        food_sources: {
          capture_method: "fetch",
          kind: "manufacturer",
          url: "https://example.test/label",
        },
        nutrient_key: "protein_pct",
        value: 36,
      },
    ]);

    await expect(loadFoodEvidence(client, 95)).resolves.toEqual([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        nutrient_key: "protein_pct",
        source: {
          capture_method: "fetch",
          kind: "manufacturer",
          url: "https://example.test/label",
        },
        value: 36,
      },
    ]);
  });

  it("throws when the query errors so the caller can degrade deliberately", async () => {
    const { client } = clientReturning(null, { message: "permission denied" });
    await expect(loadFoodEvidence(client, 95)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/food-evidence.test.ts`

Expected: FAIL, `loadFoodEvidence` is not exported from `./catalog`.

- [ ] **Step 3: Implement the loader and its cache**

Add to `src/lib/catalog.ts`, next to `loadPublicFoods`:

```ts
export interface NutrientEvidence {
  nutrient_key: NutrientSourceKey;
  value: number;
  excerpt: string;
  captured_at: string;
  source: { url: string; kind: string; capture_method: string };
}

// food_sources 는 컬럼 단위로만 열려 있다. `*` 나 생략형은 permission denied 로 전체
// 쿼리를 실패시키므로 임베디드 컬럼을 반드시 나열한다. !inner 는 소스가 RLS 로 가려진
// 근거를 통째로 떨어뜨린다 — 출처 없는 인용문은 보여주지 않는다는 규칙과 같다.
const FOOD_EVIDENCE_SELECT =
  "nutrient_key, value, excerpt, captured_at, food_sources!inner(url, kind, capture_method)";

export async function loadFoodEvidence(
  supabase: SupabaseClient<Database>,
  foodId: number,
): Promise<NutrientEvidence[]> {
  const { data, error } = await supabase
    .from("food_nutrient_evidence")
    .select(FOOD_EVIDENCE_SELECT)
    .eq("food_id", foodId)
    .eq("is_current", true);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { food_sources: source, ...rest } = row as unknown as Omit<
      NutrientEvidence,
      "source"
    > & { food_sources: NutrientEvidence["source"] };
    return { ...rest, source };
  });
}

export async function getFoodEvidence(
  foodId: number,
): Promise<NutrientEvidence[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    return await unstable_cache(
      async () => loadFoodEvidence(createPublicClient(), foodId),
      ["public-food-evidence", String(foodId)],
      { revalidate: 3600, tags: ["public-foods"] },
    )();
  } catch (error) {
    console.error("Failed to load food evidence", error);
    return [];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/food-evidence.test.ts && pnpm typecheck`

Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the query works against a real database**

This is the step the spec calls out: the column grant makes a wrong select string fail at request time, not at type-check time.

Run against the local stack started in Task 1:

```bash
supabase db reset
supabase test db
```

Then, with the local anon key and URL exported, issue the exact select through PostgREST for a published food and confirm HTTP 200 with rows rather than `permission denied for table food_sources`.

Expected: 200. If it returns 403, the embedded column list disagrees with the grant in Task 1; reconcile the two before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog.ts src/lib/food-evidence.test.ts
git commit -m "feat(catalog): load current evidence for one published food"
```

---

### Task 4: Attach Proofs to Nutrition Facts

**Files:**

- Modify: `src/lib/catalog-presentation.ts`
- Modify: `src/lib/catalog-presentation.test.ts` (create if absent)

**Interfaces:**

- Consumes: `NutrientEvidence` from Task 3, `matchExcerptValue` from Task 2.
- Produces:
  - `export type NutritionProof = { kind: "quoted"; excerpt: string; url: string; capturedAt: string; captureMethod: string } | { kind: "computed"; formula: string; inputs: readonly NutritionPresentationKey[] }`
  - `NutritionFact` gains `proof: NutritionProof | null`.
  - `nutritionFacts(food: FoodWithBrand, evidence?: readonly NutrientEvidence[]): readonly NutritionFact[]`

The second parameter defaults to an empty array so `src/components/food-comparison.tsx` keeps compiling and behaving unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/catalog-presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nutritionFacts } from "./catalog-presentation";
import { SAMPLE_FOODS } from "./fixtures";

const food = SAMPLE_FOODS[0]!;

describe("nutritionFacts proofs", () => {
  it("quotes a fact that has a current evidence row", () => {
    const facts = nutritionFacts(food, [
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        nutrient_key: "protein_pct",
        source: {
          capture_method: "fetch",
          kind: "manufacturer",
          url: "https://example.test/label",
        },
        value: food.protein_pct!,
      },
    ]);

    expect(facts.find((fact) => fact.key === "protein_pct")?.proof).toEqual({
      captureMethod: "fetch",
      capturedAt: "2026-08-18T00:00:00Z",
      excerpt: "Crude Protein 36.00%",
      kind: "quoted",
      url: "https://example.test/label",
    });
  });

  it("computes carbohydrate when no evidence row exists", () => {
    const proof = nutritionFacts(food, []).find(
      (fact) => fact.key === "carb_pct",
    )?.proof;

    expect(proof?.kind).toBe("computed");
    expect(proof).toMatchObject({
      inputs: [
        "protein_pct",
        "fat_pct",
        "fiber_pct",
        "moisture_pct",
        "ash_pct",
      ],
    });
  });

  it("leaves a fact without evidence unproven rather than guessing", () => {
    expect(
      nutritionFacts(food, []).find((fact) => fact.key === "protein_pct")
        ?.proof,
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/catalog-presentation.test.ts`

Expected: FAIL, `proof` is undefined on every fact.

- [ ] **Step 3: Implement the proof mapping**

In `src/lib/catalog-presentation.ts`, add the type and thread an evidence lookup through `foodFact`:

```ts
export type NutritionProof =
  | {
      kind: "quoted";
      excerpt: string;
      url: string;
      capturedAt: string;
      captureMethod: string;
    }
  | {
      kind: "computed";
      formula: string;
      inputs: readonly NutritionPresentationKey[];
    };

function quotedProof(
  evidence: NutrientEvidence | undefined,
): NutritionProof | null {
  if (!evidence) return null;
  return {
    captureMethod: evidence.source.capture_method,
    capturedAt: evidence.captured_at,
    excerpt: evidence.excerpt,
    kind: "quoted",
    url: evidence.source.url,
  };
}
```

`NutritionFact` gains `proof: NutritionProof | null`, and `foodFact` takes the evidence map so every fact resolves its own key.

- [ ] **Step 4: Add the computed branches**

Carbohydrate resolves its ash term through `resolveAsh`, never through `food.ash_pct`.
On the 44 published rows where `carb_is_estimated` is true the raw column is null while the value is still reconstructible, and reading the column would print a blank inside the equation.

```ts
import { resolveAsh } from "@/lib/domain";

function carbProof(
  food: FoodWithBrand,
  evidence: NutrientEvidence | undefined,
): NutritionProof | null {
  const quoted = quotedProof(evidence);
  if (quoted) return quoted;
  if (food.carb_pct === null) return null;

  const ash = resolveAsh(
    food.ash_pct,
    food.nutrient_sources.ash_pct ?? null,
    food.cooking_method,
  );
  if (ash.value === null) return null;

  const terms = [
    food.protein_pct,
    food.fat_pct,
    food.fiber_pct,
    food.moisture_pct,
  ];
  if (terms.some((term) => term === null)) return null;

  return {
    formula: `100 − (${terms.join(" + ")} + ${ash.value}${ash.estimated ? " 추정" : ""}) = ${food.carb_pct}`,
    inputs: ["protein_pct", "fat_pct", "fiber_pct", "moisture_pct", "ash_pct"],
    kind: "computed",
  };
}
```

Ca:P takes the same shape with `formula: \`${food.calcium_pct} ÷ ${food.phosphorus_pct} = ${food.ca_p_ratio}\``and`inputs: ["calcium_pct", "phosphorus_pct"]`, returning null when either input or the ratio is null.

The three energy-ratio facts receive `proof: null`; see Scope Boundaries.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib && pnpm typecheck`

Expected: PASS. `src/lib/fixtures.test.ts` must stay green, since no domain math changed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-presentation.ts src/lib/catalog-presentation.test.ts
git commit -m "feat(catalog): attach quoted and computed proofs to nutrition facts"
```

---

### Task 5: Render the Drilldown

**Files:**

- Modify: `src/app/foods/[id]/page.tsx`
- Modify: `src/components/food-dossier.tsx`
- Modify: `src/components/food-dossier.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `getFoodEvidence` from Task 3, `NutritionProof` from Task 4, `matchExcerptValue` from Task 2.
- Produces: the rendered detail page; nothing downstream depends on it.

- [ ] **Step 1: Write the failing test**

Add to `src/components/food-dossier.test.tsx`, which already carries `// @vitest-environment jsdom` at the top.

`@testing-library/jest-dom` is not installed and must not be added, so assertions use the house matchers already used across `src/components/*.test.tsx`: `toBeTruthy`, `toBeNull`, and `toContain`.

```tsx
it("expands a quoted fact to its excerpt, source, and capture time", () => {
  render(
    <FoodDossier
      food={SAMPLE_FOODS[0]!}
      evidence={[
        {
          captured_at: "2026-08-18T00:00:00Z",
          excerpt: "Crude Protein 36.00%",
          nutrient_key: "protein_pct",
          source: {
            capture_method: "fetch",
            kind: "manufacturer",
            url: "https://example.test/label",
          },
          value: SAMPLE_FOODS[0]!.protein_pct!,
        },
      ]}
    />,
  );

  expect(screen.getByText("36.00").tagName).toBe("MARK");
  expect(
    document.querySelector('a[href="https://example.test/label"]'),
  ).toBeTruthy();
});

it("renders an unmatched excerpt without marking any number", () => {
  render(
    <FoodDossier
      food={SAMPLE_FOODS[0]!}
      evidence={[
        {
          captured_at: "2026-08-18T00:00:00Z",
          excerpt: "Crude Protein not stated",
          nutrient_key: "protein_pct",
          source: {
            capture_method: "fetch",
            kind: "manufacturer",
            url: "https://example.test/label",
          },
          value: SAMPLE_FOODS[0]!.protein_pct!,
        },
      ]}
    />,
  );

  expect(screen.getByText("Crude Protein not stated")).toBeTruthy();
  expect(document.querySelector("mark")).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/food-dossier.test.tsx`

Expected: FAIL, `FoodDossier` accepts no `evidence` prop.

- [ ] **Step 3: Pass evidence into the dossier**

In `src/app/foods/[id]/page.tsx`, load both in parallel and pass the result down:

```tsx
const [food, evidence] = await Promise.all([
  getFood(Number(id)),
  getFoodEvidence(Number(id)),
]);
if (!food) notFound();
```

```tsx
<FoodDossier food={food} evidence={evidence} />
```

- [ ] **Step 4: Render the disclosure**

In `src/components/food-dossier.tsx`, accept `evidence: readonly NutrientEvidence[] = []`, pass it to `nutritionFacts`, and wrap each `dossier-fact` whose `proof` is non-null in a `<details>`.
A fact with `proof === null` renders exactly as it does today, with no disclosure affordance.

```tsx
function ProofQuote({ excerpt, value }: { excerpt: string; value: number }) {
  const marked = matchExcerptValue(excerpt, value);
  if (!marked)
    return <blockquote className="proof-quote">{excerpt}</blockquote>;
  return (
    <blockquote className="proof-quote">
      {marked.before}
      <mark>{marked.match}</mark>
      {marked.after}
    </blockquote>
  );
}
```

The `<summary>` holds the existing label, value, and badge markup unchanged, so a collapsed fact is visually identical to today's row.

- [ ] **Step 5: Style the disclosure**

In `src/app/globals.css`, reusing existing tokens per `DESIGN.md`:

```css
.dossier-fact summary {
  cursor: pointer;
  list-style: none;
}
.dossier-fact summary::-webkit-details-marker {
  display: none;
}
.proof-quote mark {
  background: transparent;
  font-weight: 700;
  text-decoration: underline;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`

Expected: PASS across the suite, including the untouched comparison tests that still call `nutritionFacts(food)` with one argument.

- [ ] **Step 7: Look at the page**

Run: `pnpm dev`, open a published food such as an ACANA row, expand a quoted fact and the computed carbohydrate fact.

Confirm the marked number sits inside its sentence, the source link resolves, and the carbohydrate panel names the estimated ash tier when `carb_is_estimated` is true.
A rendering check is required here because no test asserts that the disclosure is legible.

- [ ] **Step 8: Commit**

```bash
git add src/app/foods src/components/food-dossier.tsx src/components/food-dossier.test.tsx src/app/globals.css
git commit -m "feat(catalog): expand nutrient values to their source evidence"
```

---

## Self-Review

**Spec coverage.** Section 1 is Task 1. Section 2 is Task 3, including the spec's requirement to prove the column-scoped select against a running database (Task 3 Step 5). Section 3 is Task 4. Section 4 is Task 4 Step 4, with the `resolveAsh` sourcing rule carried into the code. Section 5 is Task 5, and its excerpt-marker subsection is Task 2 plus Task 5 Step 4. Section 6's three verification items map to Task 4's tests, Task 2's tests, and the `fixtures.test.ts` check in Task 4 Step 5.

**Deviation from the spec, recorded deliberately.** The spec names `num()` as the token parser; Task 2 uses the extraction-side normalizer instead, because `num()` deletes commas and would read `2,5` as 25. The spec was corrected to match before this plan was written.

**Scope note.** The energy-ratio facts have no proof in this plan, which the spec does not require and production data cannot support. This is stated under Scope Boundaries rather than left implicit.
