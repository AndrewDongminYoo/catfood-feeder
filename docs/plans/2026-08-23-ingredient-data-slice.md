# Ingredient Data Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the ingredient composition of published foods from already-retained source captures, so that the ingredient axis exists for every monetization path that depends on it.

**Architecture:** Store only what the label states verbatim — the ingredient name and its position in the declared order — and derive form and specificity deterministically from the name in server code. Ingredients reach the catalog through a sibling RPC that mirrors the nutrient path's invariants (unverified food, source ownership, literal evidence in the retained capture, no silent overwrite) rather than by extending the numeric-evidence RPC.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Supabase Postgres with plpgsql `SECURITY DEFINER` RPCs, pgtap, Vitest.

**Spec:** [Product Direction](../product-direction.md)

## Global Constraints

- **Literal evidence.** An ingredient list is rejected unless its cited excerpt occurs in the retained capture of a current fetched source, and unless every ingredient name occurs inside that excerpt. Same rule the nutrient path enforces.
- **No silent overwrite.** A non-empty existing list is never replaced. Differing source kind yields `skipped`; differing list yields `conflict`.
- **No new dependencies.** Everything here uses Zod, Supabase, and the standard library already installed.
- **`pct` is not modelled.** These labels rarely state per-ingredient percentages, and the field is being removed, not carried forward.
- **Korean is intentional** for UI strings and code comments. Identifiers and commit messages stay English.
- **Shape stored is `{name, position}` only.** `form` and `specificity` are derived, never stored and never asked of the model. The direction doc's earlier `{name, position, form}` is superseded by Task 2; update it there.
- **No backfill migration.** All 125 published rows hold `[]`, so the shape change has nothing to migrate. Do not write defensive migration code for rows that do not exist.
- **Secrets** load through `node scripts/with-secrets.mjs …`. There is no dotenv file at the repository root by design.

---

### Task 1: Measure the identity-matched tranche

The direction doc's upper bound of 75 proves a capture holds _an_ ingredient list, not _this product's_. This task produces the number the rest of the slice is sized against, using no model calls: the paid extraction pass in Task 7 doubles as the real yield measurement, once the prompt emits the shape we want.

**Files:**

- Create: `scripts/measure-ingredient-tranche.mjs`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: a printed count and a sample; no exported symbols.

- [ ] **Step 1: Write the measurement script**

This is a curator-side script, so direct Supabase access is correct here — the same family as `scripts/research-missing.mjs` and `scripts/transcribe-brand.mjs`. Do **not** put it near `scripts/research-run.mjs`, whose no-database boundary `src/lib/source-first-boundary.test.ts` polices.

```javascript
// 발행된 사료 중, 현재 소스의 보관 캡처가 "그 제품의" 원재료 나열을 담고 있는 건수를 센다.
// 쉼표 나열만으로는 사이트 내비게이션 문구도 잡히므로, 나열 앞 창에서 제품 식별자를
// 함께 확인한다. 모델은 호출하지 않는다 — 이 단계의 산출물은 숫자다.
import { loadSecrets } from "./with-secrets.mjs";

loadSecrets();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error("Supabase 자격 증명을 찾을 수 없습니다.");

const HEADERS = { Authorization: `Bearer ${KEY}`, apikey: KEY };

/** 최소 8개 항목이 쉼표로 이어지는 구간. 내비게이션 문구는 이 밀도가 나오지 않는다. */
const RUN =
  /(?:[A-Za-z][A-Za-z ()./-]{2,40}, ){7,}[A-Za-z][A-Za-z ()./-]{2,40}/;

/** 브랜드명과 제품명에서 식별에 쓸 만한 토큰만. 2자 이하와 순수 숫자는 버린다. */
function identityTokens(food) {
  const raw = `${food.brands?.name ?? ""} ${food.product_name ?? ""}`;
  return [...new Set(raw.split(/[\s·&/()]+/))]
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2 && !/^\d+$/.test(token));
}

async function publishedFoods() {
  const query =
    "foods?select=id,product_name,brands(name)&published_at=not.is.null&order=id";
  const response = await fetch(`${URL}/rest/v1/${query}`, { headers: HEADERS });
  if (!response.ok) throw new Error(`foods 조회 실패: ${response.status}`);
  return response.json();
}

async function currentCapture(foodId) {
  const query = `food_sources?select=id,captured_text&food_id=eq.${foodId}&is_current=is.true&fetch_status=eq.fetched`;
  const response = await fetch(`${URL}/rest/v1/${query}`, { headers: HEADERS });
  if (!response.ok)
    throw new Error(`food_sources 조회 실패: ${response.status}`);
  return response.json();
}

const foods = await publishedFoods();
const matched = [];
const runOnly = [];

for (const food of foods) {
  const tokens = identityTokens(food);
  let bestWindow = null;
  for (const source of await currentCapture(food.id)) {
    const text = source.captured_text ?? "";
    const hit = RUN.exec(text);
    if (!hit) continue;
    const window = text
      .slice(Math.max(0, hit.index - 300), hit.index)
      .toLowerCase();
    const found = tokens.filter((token) => window.includes(token));
    if (!bestWindow || found.length > bestWindow.found.length) {
      bestWindow = {
        found,
        run: hit[0].slice(0, 120),
        sourceId: source.id,
        window,
      };
    }
  }
  if (!bestWindow) continue;
  // 토큰 하나로는 브랜드만 스쳐도 통과한다. 둘 이상을 요구한다.
  if (bestWindow.found.length >= 2) matched.push({ food, ...bestWindow });
  else runOnly.push({ food, ...bestWindow });
}

console.log(`published:        ${foods.length}`);
console.log(`comma run only:   ${runOnly.length}`);
console.log(`identity matched: ${matched.length}`);
console.log("\n--- 손으로 검증할 표본 10건 ---");
for (const row of matched.slice(0, 10)) {
  console.log(`\n[${row.food.id}] ${row.food.product_name}`);
  console.log(`  matched tokens: ${row.found.join(", ")}`);
  console.log(`  run: ${row.run}`);
}
console.log("\n--- 식별 실패로 제외된 표본 5건 ---");
for (const row of runOnly.slice(0, 5)) {
  console.log(`\n[${row.food.id}] ${row.food.product_name}`);
  console.log(`  matched tokens: ${row.found.join(", ") || "(none)"}`);
  console.log(`  run: ${row.run}`);
}
console.log(
  `\nmatched food ids: ${matched.map((row) => row.food.id).join(",")}`,
);
```

- [ ] **Step 2: Run it and read the samples**

Run: `node scripts/measure-ingredient-tranche.mjs`

Do not accept the printed `identity matched` count on its own — the direction doc records that a marker count already lied once. Read all ten matched samples and all five excluded samples. For each matched sample, confirm the run really is that product's ingredient list and not another product on the same page. If more than one of the ten is wrong, tighten `identityTokens` or raise the token threshold and re-run before continuing.

Record the validated counts and both id lists; Task 7 consumes them.

The check cannot establish identity on its own, and tightening the pattern does not fix that — the residual failures are semantic. Treat tranche A (one run) as the higher-yield set and tranche B (several runs) as the set where the model must disambiguate, and let Task 7's extraction be the arbiter for both.

- [ ] **Step 3: Commit**

```bash
git add scripts/measure-ingredient-tranche.mjs
git commit -m "chore(ingredients): measure the identity-matched capture tranche"
```

---

### Task 2: Ingredient shape and derived form

Store what the label says; derive the interpretation. `form` and `specificity` are both encoded in the ingredient name itself, so deriving them keeps re-extraction from freezing an interpretation into 125 rows and lets the rules improve without another paid pass.

**Files:**

- Create: `src/lib/ingredient-form.ts`
- Create: `src/lib/ingredient-form.test.ts`
- Modify: `src/lib/catalog.ts` (the `Ingredient` interface)
- Modify: `src/lib/fixtures.ts` (the sample rows' `ingredients`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Ingredient { name: string; position: number }` exported from `src/lib/catalog.ts`.
  - `type IngredientForm = "fresh" | "dried" | "meal" | "by_product" | "unspecified"`.
  - `type IngredientSpecificity = "species" | "category" | "unspecified"`.
  - `deriveIngredientForm(name: string): IngredientForm`.
  - `deriveIngredientSpecificity(name: string): IngredientSpecificity`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import {
  deriveIngredientForm,
  deriveIngredientSpecificity,
} from "./ingredient-form";

describe("deriveIngredientForm", () => {
  it("렌더링된 분말을 meal 로 읽는다", () => {
    expect(deriveIngredientForm("chicken meal")).toBe("meal");
    expect(deriveIngredientForm("계육분")).toBe("meal");
    expect(deriveIngredientForm("닭고기분말")).toBe("meal");
  });

  it("건조 원료를 dried 로 읽는다", () => {
    expect(deriveIngredientForm("dehydrated chicken")).toBe("dried");
    expect(deriveIngredientForm("dried egg product")).toBe("dried");
    expect(deriveIngredientForm("말린 닭고기")).toBe("dried");
  });

  it("생물 표기를 fresh 로 읽는다", () => {
    expect(deriveIngredientForm("fresh chicken")).toBe("fresh");
    expect(deriveIngredientForm("deboned salmon")).toBe("fresh");
    expect(deriveIngredientForm("생닭고기")).toBe("fresh");
  });

  it("부산물을 by_product 로 읽는다", () => {
    expect(deriveIngredientForm("chicken by-product meal")).toBe("by_product");
    expect(deriveIngredientForm("가금 부산물")).toBe("by_product");
  });

  it("형태를 알 수 없으면 unspecified 를 돌려준다", () => {
    expect(deriveIngredientForm("peas")).toBe("unspecified");
    expect(deriveIngredientForm("완두")).toBe("unspecified");
  });

  it("by_product 가 meal 보다 우선한다", () => {
    // "by-product meal" 은 두 규칙에 모두 걸린다. 더 구체적인 쪽이 이겨야 한다.
    expect(deriveIngredientForm("poultry by-product meal")).toBe("by_product");
  });
});

describe("deriveIngredientSpecificity", () => {
  it("종을 밝힌 표기를 species 로 읽는다", () => {
    expect(deriveIngredientSpecificity("chicken meal")).toBe("species");
    expect(deriveIngredientSpecificity("닭고기")).toBe("species");
    expect(deriveIngredientSpecificity("연어")).toBe("species");
  });

  it("종을 밝히지 않은 상위 범주를 category 로 읽는다", () => {
    expect(deriveIngredientSpecificity("poultry meal")).toBe("category");
    expect(deriveIngredientSpecificity("가금육")).toBe("category");
    expect(deriveIngredientSpecificity("meat and bone meal")).toBe("category");
    expect(deriveIngredientSpecificity("육류")).toBe("category");
  });

  it("동물성 원료가 아니면 판단하지 않는다", () => {
    expect(deriveIngredientSpecificity("peas")).toBe("unspecified");
    expect(deriveIngredientSpecificity("완두")).toBe("unspecified");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test src/lib/ingredient-form.test.ts`
Expected: FAIL — the module `./ingredient-form` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * 원재료 이름에서 형태와 특이성을 읽어낸다.
 *
 * 두 축 모두 라벨이 쓴 이름 안에 이미 들어 있다. 저장하면 재추출이 그 해석을
 * 행에 얼어붙이고, 파생하면 규칙이 나아질 때 다시 계산하면 된다. 열량비와 충돌을
 * 모델이 아니라 서버가 계산하는 것과 같은 이유다.
 *
 * 판단할 수 없으면 추측하지 않고 unspecified 를 돌려준다.
 */

export type IngredientForm =
  "fresh" | "dried" | "meal" | "by_product" | "unspecified";

export type IngredientSpecificity = "species" | "category" | "unspecified";

/** 순서가 곧 우선순위다. 앞의 규칙이 이긴다 — by-product meal 은 by_product 다. */
const FORM_RULES: readonly (readonly [IngredientForm, RegExp])[] = [
  ["by_product", /by[-\s]?products?|부산물/i],
  ["meal", /\bmeals?\b|\bpowder\b|분말|육분|어분|골분/i],
  ["dried", /\bdried\b|\bdehydrated\b|말린|건조/i],
  ["fresh", /\bfresh\b|\braw\b|\bdeboned\b|\bwhole\b|생(?=[가-힣])|신선/i],
];

const SPECIES =
  /chicken|turkey|duck|salmon|trout|herring|tuna|lamb|beef|pork|venison|rabbit|cod|mackerel|닭|오리|칠면조|연어|송어|청어|참치|양고기|소고기|돼지|사슴|토끼|대구|고등어/i;

const CATEGORY =
  /\bpoultry\b|\bmeat\b|\bfish\b|\banimal\b|가금|육류|어류|동물성|생선/i;

export function deriveIngredientForm(name: string): IngredientForm {
  for (const [form, pattern] of FORM_RULES) {
    if (pattern.test(name)) return form;
  }
  return "unspecified";
}

export function deriveIngredientSpecificity(
  name: string,
): IngredientSpecificity {
  // 종 이름이 있으면, 상위 범주 단어가 같이 있어도 종을 밝힌 것이다.
  if (SPECIES.test(name)) return "species";
  if (CATEGORY.test(name)) return "category";
  return "unspecified";
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test src/lib/ingredient-form.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Change the `Ingredient` interface**

In `src/lib/catalog.ts`, replace the existing interface:

```typescript
export interface Ingredient {
  name: string;
  /** 라벨의 함량 내림차순 기재 순서. 1부터 시작하고 배열 순서와 같다. */
  position: number;
}
```

`pct` and `type` are gone. `type` is superseded by `deriveIngredientForm` and `deriveIngredientSpecificity`; `pct` is not modelled.

- [ ] **Step 6: Update the fixtures**

In `src/lib/fixtures.ts`, rewrite each sample's `ingredients` to the new shape, keeping the same names in the same order and dropping `pct`/`type`. For example, an entry that read `{ name: "닭고기", pct: 30, type: "meat" }` at index 0 becomes `{ name: "닭고기", position: 1 }`.

- [ ] **Step 7: Run typecheck and the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck fails in the consumer sites that still read `ingredient.pct` — `src/components/food-dossier.tsx` and `src/components/food-comparison.tsx`. That is expected and Task 6 fixes them. Every other file must pass. Do not silence the two component errors here.

- [ ] **Step 8: Update the direction doc's shape line**

In `docs/product-direction.md`, replace the `{name, position, form}` sentence in the Slice scope section with the decision made here: the stored shape is `{name, position}`, and form and specificity are derived from the name so re-extraction does not freeze an interpretation.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ingredient-form.ts src/lib/ingredient-form.test.ts src/lib/catalog.ts src/lib/fixtures.ts docs/product-direction.md
git commit -m "feat(ingredients): store name and position, derive form and specificity"
```

---

### Task 3: Ingredient evidence table and apply RPC

The numeric-evidence RPC is 277 lines of per-nutrient validation with a per-field conflict model. An ingredient list is one whole-list value, so it gets a sibling function rather than a tenth `nutrient_key` — the same mistake `20260810030000_source_kind_is_meaning_not_slot.sql` already corrected once in this schema.

**Files:**

- Create: `supabase/migrations/20260823090000_food_ingredient_evidence.sql`
- Create: `supabase/tests/food_ingredient_apply_test.sql`

**Interfaces:**

- Consumes: `public.foods`, `public.food_sources`, the `public.nutrient_source` enum.
- Produces:
  - Table `public.food_ingredient_evidence (id, food_id, source_id, excerpt, captured_at, is_current, created_at)`.
  - `public.apply_food_ingredients_draft(p_food_id bigint, p_source_id bigint, p_excerpt text, p_ingredients jsonb, p_owned_source_ids bigint[] DEFAULT NULL) RETURNS jsonb` returning `{"status": "applied" | "skipped" | "conflict", "count": n}`.

- [ ] **Step 1: Write the migration**

```sql
-- 원재료는 아홉 개 영양소 키와 같은 모양이 아니다. 값 하나가 아니라 목록 하나이고,
-- 충돌도 필드별이 아니라 목록 전체 단위다. apply_food_evidence_draft 에 열 번째
-- nutrient_key 로 밀어 넣으면 kind 를 슬롯으로 쓰는 것과 같은 실수가 된다.
-- 그래서 형제 함수를 두고, 지켜야 할 불변식만 그대로 따라 간다.

CREATE TABLE public.food_ingredient_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
  source_id bigint NOT NULL REFERENCES public.food_sources(id) ON DELETE RESTRICT,
  excerpt text NOT NULL CHECK (btrim(excerpt) <> ''),
  captured_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 현재 근거가 무엇인지 정의되게 만드는 인덱스. 영양소 쪽과 같은 모양이되,
-- 사료 하나에 목록이 하나이므로 nutrient_key 자리가 없다.
CREATE UNIQUE INDEX food_ingredient_evidence_current_idx
  ON public.food_ingredient_evidence (food_id)
  WHERE is_current;

CREATE INDEX food_ingredient_evidence_source_idx
  ON public.food_ingredient_evidence (source_id);

ALTER TABLE public.food_ingredient_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.food_ingredient_evidence
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.food_ingredient_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.apply_food_ingredients_draft(
  p_food_id bigint,
  p_source_id bigint,
  p_excerpt text,
  p_ingredients jsonb,
  p_owned_source_ids bigint[] DEFAULT NULL::bigint[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_excerpt text := btrim(p_excerpt);
  v_norm_excerpt text;
  v_source_kind public.nutrient_source;
  v_captured_at timestamptz;
  v_captured_text text;
  v_existing jsonb;
  v_existing_kind public.nutrient_source;
  v_item jsonb;
  v_index int := 0;
  v_name text;
  v_status text;
BEGIN
  IF p_ingredients IS NULL
    OR jsonb_typeof(p_ingredients) <> 'array'
    OR jsonb_array_length(p_ingredients) = 0 THEN
    RAISE EXCEPTION 'Ingredients must be a non-empty JSON array';
  END IF;

  IF v_excerpt = '' THEN
    RAISE EXCEPTION 'Each ingredient draft requires a non-empty excerpt';
  END IF;

  PERFORM 1
  FROM public.foods
  WHERE id = p_food_id
    AND data_verified_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food % does not exist or is already human-verified', p_food_id;
  END IF;

  -- 수집 시점에 잡은 소유권을 적용 시점에 다시 확인한다. 영양소 경로와 같은 이유다.
  IF p_owned_source_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.food_sources
    WHERE food_id = p_food_id
      AND fetch_status = 'fetched'
      AND is_current
      AND NOT (id = ANY (p_owned_source_ids))
  ) THEN
    RAISE EXCEPTION 'Research claim lost for food %', p_food_id
      USING ERRCODE = 'CFCLM';
  END IF;

  SELECT kind, captured_at, captured_text
    INTO v_source_kind, v_captured_at, v_captured_text
  FROM public.food_sources
  WHERE id = p_source_id
    AND food_id = p_food_id
    AND is_current
    AND fetch_status = 'fetched'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source % is not a current fetched source for food %', p_source_id, p_food_id;
  END IF;

  v_norm_excerpt := lower(btrim(regexp_replace(normalize(v_excerpt, NFKC), E'\\s+', ' ', 'g')));

  IF position(
    v_norm_excerpt
    IN lower(btrim(regexp_replace(normalize(v_captured_text, NFKC), E'\\s+', ' ', 'g')))
  ) = 0 THEN
    RAISE EXCEPTION 'Evidence excerpt is absent from source %', p_source_id;
  END IF;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_ingredients) AS ingredient(item)
  LOOP
    v_index := v_index + 1;

    IF coalesce(jsonb_typeof(v_item), '') <> 'object'
      OR NOT (v_item ? 'name')
      OR NOT (v_item ? 'position') THEN
      RAISE EXCEPTION 'Each ingredient requires name and position';
    END IF;

    v_name := btrim(v_item ->> 'name');

    IF v_name = '' THEN
      RAISE EXCEPTION 'Ingredient name must not be empty';
    END IF;

    -- 순서가 이 데이터의 값이다. 배열 순서와 position 이 어긋나면 조용히 잘못
    -- 정렬된 목록이 발행되므로, 1..n 연속만 받는다.
    IF jsonb_typeof(v_item -> 'position') <> 'number'
      OR (v_item ->> 'position')::numeric <> v_index THEN
      RAISE EXCEPTION 'Ingredient positions must be 1..n in array order';
    END IF;

    IF position(
      lower(btrim(regexp_replace(normalize(v_name, NFKC), E'\\s+', ' ', 'g')))
      IN v_norm_excerpt
    ) = 0 THEN
      RAISE EXCEPTION 'Ingredient name % is absent from its excerpt', v_name;
    END IF;
  END LOOP;

  SELECT ingredients INTO v_existing FROM public.foods WHERE id = p_food_id;

  SELECT source.kind INTO v_existing_kind
  FROM public.food_ingredient_evidence AS evidence
  JOIN public.food_sources AS source ON source.id = evidence.source_id
  WHERE evidence.food_id = p_food_id
    AND evidence.is_current;

  IF v_existing IS NULL OR jsonb_array_length(v_existing) = 0 THEN
    UPDATE public.foods
    SET ingredients = p_ingredients,
        updated_at = statement_timestamp()
    WHERE id = p_food_id;
    v_status := 'applied';
  ELSIF v_existing_kind IS DISTINCT FROM v_source_kind THEN
    -- 출처 종류가 다르면 기존 값과 provenance 를 지킨다. 영양소 경로와 같다.
    v_status := 'skipped';
  ELSIF v_existing = p_ingredients THEN
    -- 값이 같으면 근거만 새 capture 로 교체한다.
    v_status := 'applied';
  ELSE
    v_status := 'conflict';
  END IF;

  IF v_status = 'applied' THEN
    UPDATE public.food_ingredient_evidence
    SET is_current = false
    WHERE food_id = p_food_id
      AND is_current;

    INSERT INTO public.food_ingredient_evidence (
      food_id,
      source_id,
      excerpt,
      captured_at
    ) VALUES (
      p_food_id,
      p_source_id,
      v_excerpt,
      v_captured_at
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'count', jsonb_array_length(p_ingredients)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, bigint[])
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, bigint[])
  TO service_role;

COMMENT ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, bigint[]) IS
  '보관된 캡처가 증명하는 원재료 목록만 사료에 적용한다. 기존 목록은 덮어쓰지 않는다.';
```

- [ ] **Step 2: Write the pgtap test**

`supabase test db` runs against the local stack, whose default privileges lack `SELECT` — grant inside the transaction, per the convention the existing tests use.

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(9);

GRANT SELECT ON public.foods, public.food_sources, public.food_ingredient_evidence TO service_role;

INSERT INTO public.brands (id, name) VALUES (9001, 'Test Brand');
INSERT INTO public.foods (id, brand_id, product_name, ingredients)
VALUES (9001, 9001, 'Test Recipe', '[]'::jsonb);
INSERT INTO public.food_sources (
  id, food_id, kind, url, capture_method, fetch_status, captured_at, captured_text, is_current
) VALUES (
  9001, 9001, 'manufacturer', 'https://example.test/a', 'fetch', 'fetched', now(),
  'Ingredients chicken, chicken meal, peas, pea fiber.', true
);

-- 1. 정상 적용
SELECT is(
  (SELECT apply_food_ingredients_draft(
     9001, 9001, 'chicken, chicken meal, peas, pea fiber',
     '[{"name":"chicken","position":1},{"name":"chicken meal","position":2},{"name":"peas","position":3},{"name":"pea fiber","position":4}]'::jsonb
   ) ->> 'status'),
  'applied',
  '보관 캡처가 증명하는 목록은 적용된다'
);

SELECT is(
  (SELECT jsonb_array_length(ingredients) FROM public.foods WHERE id = 9001),
  4,
  '적용된 목록이 foods 에 기록된다'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_ingredient_evidence WHERE food_id = 9001 AND is_current),
  1,
  '현재 근거가 하나 남는다'
);

-- 2. 캡처에 없는 구절은 거절
SELECT throws_ok(
  $$SELECT apply_food_ingredients_draft(9001, 9001, 'salmon, potato', '[{"name":"salmon","position":1}]'::jsonb)$$,
  NULL,
  NULL,
  '캡처에 없는 구절은 거절된다'
);

-- 3. 구절에 없는 이름은 거절
SELECT throws_ok(
  $$SELECT apply_food_ingredients_draft(9001, 9001, 'chicken, chicken meal', '[{"name":"chicken","position":1},{"name":"salmon","position":2}]'::jsonb)$$,
  NULL,
  NULL,
  '구절이 증명하지 못하는 이름은 거절된다'
);

-- 4. position 이 배열 순서와 어긋나면 거절
SELECT throws_ok(
  $$SELECT apply_food_ingredients_draft(9001, 9001, 'chicken, chicken meal', '[{"name":"chicken","position":2},{"name":"chicken meal","position":1}]'::jsonb)$$,
  NULL,
  NULL,
  'position 은 배열 순서와 같은 1..n 이어야 한다'
);

-- 5. 같은 출처 종류의 다른 목록은 conflict, 덮어쓰지 않는다
SELECT is(
  (SELECT apply_food_ingredients_draft(
     9001, 9001, 'chicken, peas',
     '[{"name":"chicken","position":1},{"name":"peas","position":2}]'::jsonb
   ) ->> 'status'),
  'conflict',
  '기존 목록과 다르면 conflict 다'
);

SELECT is(
  (SELECT jsonb_array_length(ingredients) FROM public.foods WHERE id = 9001),
  4,
  'conflict 는 기존 목록을 덮어쓰지 않는다'
);

-- 6. 사람이 검증한 사료에는 쓰지 않는다
UPDATE public.foods SET data_verified_at = now() WHERE id = 9001;
SELECT throws_ok(
  $$SELECT apply_food_ingredients_draft(9001, 9001, 'chicken, chicken meal', '[{"name":"chicken","position":1},{"name":"chicken meal","position":2}]'::jsonb)$$,
  NULL,
  NULL,
  '사람이 검증한 사료에는 적용하지 않는다'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the migration and the test locally**

Run: `supabase db reset && supabase test db`
Expected: the new test file reports `ok 1` through `ok 9` and every pre-existing test file still passes.

- [ ] **Step 4: Make the test fail before trusting its pass**

Temporarily change the RPC's excerpt-presence check to `= -1` instead of `= 0` so it never fires, re-run `supabase test db`, and confirm assertion 4 fails. Then revert the change and re-run to confirm it passes again. A guard that has never failed has not been tested.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260823090000_food_ingredient_evidence.sql supabase/tests/food_ingredient_apply_test.sql
git commit -m "feat(ingredients): add the ingredient evidence table and apply RPC"
```

---

### Task 4: Repository wrapper and apply route channel

**Files:**

- Modify: `src/lib/source-apply.ts`
- Modify: `src/lib/source-repository.ts`
- Create: `src/app/api/foods/[id]/sources/ingredients/route.ts`
- Modify: `src/lib/food-payload.ts`
- Create: `src/lib/ingredient-apply.test.ts`

**Interfaces:**

- Consumes: `Ingredient` from Task 2, `apply_food_ingredients_draft` from Task 3, `authorizeCurator` from `@/lib/admin-auth`, `readJsonBody`/`SMALL_JSON_BODY_BYTES` from `@/lib/request-body`, `getCurrentFetchedFoodSources` from `@/lib/source-repository`.
- Produces:
  - `ingredientCandidateSchema` and `ingredientDraftSchema` exported from `src/lib/source-apply.ts`.
  - `applyFoodIngredientsDraft(foodId: number, draft: IngredientDraft): Promise<IngredientApplyResult>` exported from `src/lib/source-repository.ts`, where `IngredientApplyResult = { status: "applied" | "skipped" | "conflict"; count: number }`.
  - `POST /api/foods/[id]/sources/ingredients`.

- [ ] **Step 1: Write the failing schema test**

```typescript
import { describe, expect, it } from "vitest";
import { ingredientDraftSchema } from "./source-apply";

const valid = {
  excerpt: "chicken, chicken meal, peas",
  ingredients: [
    { name: "chicken", position: 1 },
    { name: "chicken meal", position: 2 },
    { name: "peas", position: 3 },
  ],
  sourceId: 12,
};

describe("ingredientDraftSchema", () => {
  it("연속된 1..n 순서를 받는다", () => {
    expect(ingredientDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("배열 순서와 어긋난 position 을 거절한다", () => {
    const swapped = {
      ...valid,
      ingredients: [
        { name: "chicken", position: 2 },
        { name: "chicken meal", position: 1 },
        { name: "peas", position: 3 },
      ],
    };
    expect(ingredientDraftSchema.safeParse(swapped).success).toBe(false);
  });

  it("빈 목록을 거절한다", () => {
    expect(
      ingredientDraftSchema.safeParse({ ...valid, ingredients: [] }).success,
    ).toBe(false);
  });

  it("빈 구절을 거절한다", () => {
    expect(
      ingredientDraftSchema.safeParse({ ...valid, excerpt: "  " }).success,
    ).toBe(false);
  });

  it("알 수 없는 키를 거절한다", () => {
    const extra = {
      ...valid,
      ingredients: [{ name: "chicken", pct: 30, position: 1 }],
    };
    expect(ingredientDraftSchema.safeParse(extra).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test src/lib/ingredient-apply.test.ts`
Expected: FAIL — `ingredientDraftSchema` is not exported from `./source-apply`.

- [ ] **Step 3: Add the schemas**

Append to `src/lib/source-apply.ts`:

```typescript
export const ingredientCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    position: z.number().int().positive(),
  })
  .strict();

export const ingredientDraftSchema = z
  .object({
    excerpt: z.string().trim().min(1).max(4000),
    ingredients: z.array(ingredientCandidateSchema).min(1).max(200),
    sourceId: z.number().int().positive(),
  })
  .strict()
  // 순서가 이 데이터의 값이므로, RPC 에 닿기 전에 클라이언트 쪽에서도 막는다.
  .refine(
    (draft) =>
      draft.ingredients.every(
        (ingredient, index) => ingredient.position === index + 1,
      ),
    { message: "position 은 배열 순서와 같은 1..n 이어야 합니다." },
  );

export type IngredientDraft = Readonly<z.infer<typeof ingredientDraftSchema>>;

export type IngredientApplyResult = Readonly<{
  count: number;
  status: "applied" | "skipped" | "conflict";
}>;

const databaseIngredientApplyResultSchema = z
  .object({
    count: z.number().int().nonnegative(),
    status: z.enum(["applied", "skipped", "conflict"]),
  })
  .strict();

export function parseIngredientApplyResult(
  value: unknown,
): IngredientApplyResult {
  return databaseIngredientApplyResultSchema.parse(value);
}
```

Note the `excerpt` cap of 4000 rather than the nutrient path's 500: an ingredient list is a paragraph, not a phrase.

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test src/lib/ingredient-apply.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Add the repository wrapper**

Append to `src/lib/source-repository.ts`, next to `applyFoodEvidenceDraft`:

```typescript
export async function applyFoodIngredientsDraft(
  foodId: number,
  draft: IngredientDraft,
): Promise<IngredientApplyResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("apply_food_ingredients_draft", {
    p_excerpt: draft.excerpt,
    p_food_id: foodId,
    p_ingredients: draft.ingredients.map((ingredient) => ({
      name: ingredient.name,
      position: ingredient.position,
    })),
    p_source_id: draft.sourceId,
  });
  if (error)
    throw new SourceRepositoryError("apply_food_ingredients", error.message);
  return parseIngredientApplyResult(data);
}
```

Add `IngredientDraft`, `IngredientApplyResult`, and `parseIngredientApplyResult` to the existing `@/lib/source-apply` import in that file.

- [ ] **Step 6: Add the route**

Create `src/app/api/foods/[id]/sources/ingredients/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { ingredientDraftSchema } from "@/lib/source-apply";
import {
  applyFoodIngredientsDraft,
  foodExists,
  getCurrentFetchedFoodSources,
} from "@/lib/source-repository";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied")
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  const foodId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await context.params).id);
  if (!foodId.success)
    return NextResponse.json(
      { error: "사료 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  try {
    const parsed = ingredientDraftSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "원재료 적용 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    if (!(await foodExists(foodId.data)))
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    const sources = await getCurrentFetchedFoodSources(foodId.data, [
      parsed.data.sourceId,
    ]);
    if (sources.length === 0)
      return NextResponse.json(
        { error: "출처가 현재 수집본과 일치하지 않습니다." },
        { status: 400 },
      );
    const result = await applyFoodIngredientsDraft(foodId.data, parsed.data);
    return NextResponse.json({ result });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    console.error("applyFoodIngredientsDraft failed", error);
    // 영양소 경로와 같은 이유로 거절과 장애를 가른다. RPC 가 근거를 거절한 것은
    // 요청이 틀린 것이지 서버가 고장난 것이 아니다.
    if (isIngredientRefusal(error)) {
      return NextResponse.json(
        { error: "근거가 검증을 통과하지 못했습니다." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "원재료 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}

function isIngredientRefusal(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return [
    "Evidence excerpt is absent from source",
    "Ingredient name",
    "Ingredient positions must be",
    "Ingredient name must not be empty",
    "Each ingredient requires",
    "Ingredients must be a non-empty JSON array",
    "Each ingredient draft requires",
  ].some((refusal) => message.includes(refusal));
}
```

- [ ] **Step 7: Tighten the curator payload schema**

In `src/lib/food-payload.ts`, replace the untyped `ingredients: z.array(z.json()).max(200).default([])` with the real shape so `/api/foods` cannot write the old form:

```typescript
    ingredients: z.array(ingredientCandidateSchema).max(200).default([]),
```

Import `ingredientCandidateSchema` from `./source-apply` at the top of the file.

- [ ] **Step 8: Run typecheck and the suite**

Run: `pnpm typecheck && pnpm test`
Expected: same two component errors from Task 2 remain; everything else passes, including `src/lib/food-payload.test.ts`. If that test asserts the old ingredient shape, update its fixtures to `{name, position}` as part of this step.

- [ ] **Step 9: Commit**

```bash
git add src/lib/source-apply.ts src/lib/source-repository.ts src/lib/food-payload.ts src/lib/ingredient-apply.test.ts src/lib/food-payload.test.ts "src/app/api/foods/[id]/sources/ingredients/route.ts"
git commit -m "feat(ingredients): open the evidence-backed ingredient apply channel"
```

---

### Task 5: Extraction output shape

The prompt currently asks for `{name, pct, type}`, and `extractCapturedSources` drops the array on the floor because only nutrient candidates are returned. Both change here.

**Files:**

- Modify: `src/lib/source-extraction.ts`
- Modify: `src/lib/source-extraction.test.ts`
- Modify: `src/app/api/foods/[id]/sources/extract/route.ts`

**Interfaces:**

- Consumes: `Ingredient` from Task 2.
- Produces:
  - `SourceExtractionResult`'s success variant gains `ingredientDraft: { excerpt: string; ingredients: Ingredient[]; sourceId: number } | null`.
  - `POST /api/foods/[id]/sources/extract` responds with `{ candidates, ingredientDraft }`, which is exactly the body Task 7 forwards to the ingredient apply route.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/source-extraction.test.ts`:

```typescript
describe("parseModelOutput 의 원재료", () => {
  it("이름과 순서와 구절을 읽고 pct 와 type 을 받지 않는다", () => {
    const parsed = parseModelOutput(
      JSON.stringify({
        ingredient_excerpt: "chicken, chicken meal, peas",
        ingredient_source_id: 7,
        ingredients: [
          { name: "chicken" },
          { name: "chicken meal" },
          { name: "peas" },
        ],
      }),
    );

    expect(parsed?.ingredients).toEqual([
      { name: "chicken", position: 1 },
      { name: "chicken meal", position: 2 },
      { name: "peas", position: 3 },
    ]);
    expect(parsed?.ingredientExcerpt).toBe("chicken, chicken meal, peas");
    expect(parsed?.ingredientSourceId).toBe(7);
  });

  it("구절이 없으면 원재료를 버린다", () => {
    // 근거 없는 값은 없는 값이다 — 영양소와 같은 규칙.
    const parsed = parseModelOutput(
      JSON.stringify({
        ingredient_excerpt: null,
        ingredient_source_id: 7,
        ingredients: [{ name: "chicken" }],
      }),
    );

    expect(parsed?.ingredients).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test src/lib/source-extraction.test.ts`
Expected: FAIL — `ingredients` still carries `pct`/`type`, and `ingredientExcerpt` is undefined.

- [ ] **Step 3: Change the model output schema**

In `src/lib/source-extraction.ts`, replace the `ingredients` entry of `modelOutputSchema` and add the two evidence fields:

```typescript
  ingredient_excerpt: z.string().nullable().default(null),
  ingredient_source_id: z.number().int().positive().nullable().default(null),
  ingredients: z
    .array(z.object({ name: z.string().trim().min(1) }).strip())
    .default([]),
```

The model no longer assigns `type`; `deriveIngredientForm` does. `position` is not asked of the model either — the array order is the position, so assign it in code where it cannot drift.

- [ ] **Step 4: Assign position and enforce the evidence rule**

Where `parseModelOutput` builds its result, map the array and drop it when unproven:

```typescript
// 순서를 모델에게 묻지 않는다. 배열 순서가 곧 순서이므로 코드에서 매긴다.
// 그리고 구절이 없으면 목록 전체를 버린다 — 영양소와 같은 환각 방지 규칙이다.
const ingredientExcerpt = modelOutput.ingredient_excerpt?.trim() || null;
const ingredients = ingredientExcerpt
  ? modelOutput.ingredients.map((ingredient, index) => ({
      name: ingredient.name.trim(),
      position: index + 1,
    }))
  : [];
```

Expose `ingredients`, `ingredientExcerpt`, and `ingredientSourceId` on the returned object, and carry them onto the success result as `ingredientDraft` when `ingredients.length > 0` and `ingredientSourceId` is present, otherwise `null`.

- [ ] **Step 5: Update the prompt**

In `buildExtractionPrompt`, replace the `"ingredients"` clause of the JSON schema line with:

```text
"ingredient_excerpt":string|null,"ingredient_source_id":number|null,"ingredients":[{"name":string}]
```

Then add this instruction next to the existing evidence rule, verbatim:

```text
Copy the ingredient list in the exact order the label declares it, one entry per
ingredient, using the label's own wording. Do not translate, normalize, reorder,
or classify the entries. Set ingredient_excerpt to the literal run of text you
read the names from, and ingredient_source_id to the source it came from. If you
cannot quote that literal run, return "ingredients": [].
```

- [ ] **Step 6: Pass the draft through the extract route**

`src/app/api/foods/[id]/sources/extract/route.ts` currently returns `{ candidates: result.candidates }` and would drop the new draft on the floor. Widen that one response:

```typescript
if (result.kind === "success")
  return NextResponse.json({
    candidates: result.candidates,
    ingredientDraft: result.ingredientDraft,
  });
```

`toManualExtraction` already forwards `result.metadata.ingredients` to `/api/extract` for the curator form, so that path picks up the new shape with no further change. The `/new` page's ingredient textarea now holds `{name, position}` objects, which is what Task 4's tightened `food-payload.ts` schema accepts.

- [ ] **Step 7: Run the test and verify it passes**

Run: `pnpm test src/lib/source-extraction.test.ts`
Expected: PASS, both new cases and every pre-existing case in the file.

- [ ] **Step 8: Confirm the single-caller guard still holds**

Run: `pnpm test src/lib/source-first-boundary.test.ts`
Expected: PASS — `src/lib/source-extraction.ts` remains the only file containing `api.anthropic.com`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/source-extraction.ts src/lib/source-extraction.test.ts "src/app/api/foods/[id]/sources/extract/route.ts"
git commit -m "feat(ingredients): extract names in declared order with a literal excerpt"
```

---

### Task 6: Render order and derived form — FOLDED INTO TASK 2

Done as part of Task 2 on 2026-08-23, because deferring it left `pnpm typecheck` and one dossier test red across four commits, which makes every commit in between unbisectable and unshippable. The chip block was identical in both components, so it was extracted to `src/components/ingredient-chips.tsx` rather than edited twice.

The original task text follows for reference; do not execute it again.

**Files:**

- Modify: `src/components/food-dossier.tsx`
- Modify: `src/components/food-comparison.tsx`
- Modify: `src/components/food-dossier.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `Ingredient` and the two derive functions from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Add to `src/components/food-dossier.test.tsx`:

```typescript
it("원재료를 라벨 기재 순서대로 보여준다", () => {
  render(
    <FoodDossier
      food={{
        ...sampleFood,
        ingredients: [
          { name: "chicken meal", position: 2 },
          { name: "deboned chicken", position: 1 },
        ],
      }}
    />,
  );

  const chips = screen.getAllByTestId("ingredient-chip");
  expect(chips.map((chip) => chip.textContent)).toEqual([
    expect.stringContaining("deboned chicken"),
    expect.stringContaining("chicken meal"),
  ]);
});

it("파생된 형태를 표기한다", () => {
  render(
    <FoodDossier
      food={{ ...sampleFood, ingredients: [{ name: "chicken meal", position: 1 }] }}
    />,
  );

  expect(screen.getByText("분말")).toBeTruthy();
});
```

Reuse whatever `sampleFood` helper the file already defines; if it defines its food inline, extract that object into a `sampleFood` constant first so both new cases can spread it.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test src/components/food-dossier.test.tsx`
Expected: FAIL — no element carries `data-testid="ingredient-chip"`.

- [ ] **Step 3: Render position order and the derived form**

Replace the ingredient block in `src/components/food-dossier.tsx`:

```tsx
<div className="chips">
  {[...food.ingredients]
    .sort((left, right) => left.position - right.position)
    .map((ingredient) => (
      <span
        data-testid="ingredient-chip"
        key={`${ingredient.position}-${ingredient.name}`}
      >
        {ingredient.name}
        {formLabel(ingredient.name) && (
          <em className="ingredient-form">{formLabel(ingredient.name)}</em>
        )}
      </span>
    ))}
  {food.ingredients.length === 0 && <span>원재료 미기록</span>}
</div>
```

Add the label helper near the top of the file:

```tsx
/** 파생값이므로 라벨이 명시한 값과 섞이지 않게 별도 표기로 둔다. */
const FORM_LABELS: Partial<Record<IngredientForm, string>> = {
  by_product: "부산물",
  dried: "건조",
  fresh: "생",
  meal: "분말",
};

function formLabel(name: string): string | undefined {
  return FORM_LABELS[deriveIngredientForm(name)];
}
```

Apply the same block and helper to `src/components/food-comparison.tsx`. Both files need the `deriveIngredientForm` and `IngredientForm` imports from `@/lib/ingredient-form`.

- [ ] **Step 4: Add the style**

In `src/app/globals.css`, next to the existing `.chips` rule:

```css
.ingredient-form {
  margin-left: 0.25rem;
  font-size: 0.75em;
  font-style: normal;
  opacity: 0.65;
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS everywhere. This is the first point since Task 2 where typecheck is clean — confirm it actually is rather than assuming.

- [ ] **Step 6: Commit**

```bash
git add src/components/food-dossier.tsx src/components/food-comparison.tsx src/components/food-dossier.test.tsx src/app/globals.css
git commit -m "feat(ingredients): render declared order with the derived form"
```

---

### Task 7: Backfill the matched tranche

This is the paid pass, and it doubles as the real yield measurement the direction doc asked for.

**Files:**

- Create: `scripts/backfill-ingredients.mjs`
- Modify: `package.json` (one script entry)
- Modify: `scripts/README.md`

**Interfaces:**

- Consumes: the matched food id list from Task 1, `POST /api/foods/[id]/sources/extract`, and `POST /api/foods/[id]/sources/ingredients` from Task 4.
- Produces: filled `foods.ingredients` rows and a printed per-food outcome tally.

- [ ] **Step 1: Write the backfill script**

Curator-side family, like `scripts/research-missing.mjs`: it reads Supabase directly and writes only through the admin-authenticated HTTP boundary.

```javascript
// Task 1이 식별 확인까지 마친 사료만 대상으로, 보관된 캡처에서 원재료를 다시 뽑아
// 적용한다. 새 조사도 새 수집도 하지 않는다.
//
// 사용법: node scripts/backfill-ingredients.mjs 22,38,51
//         node scripts/backfill-ingredients.mjs --dry-run 22,38,51
import { loadSecrets } from "./with-secrets.mjs";

loadSecrets();

const BASE = process.env.CATFOOD_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.ADMIN_WRITE_SECRET;
if (!SECRET) throw new Error("ADMIN_WRITE_SECRET 를 찾을 수 없습니다.");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ids = (args.find((arg) => !arg.startsWith("--")) ?? "")
  .split(",")
  .map((id) => Number.parseInt(id, 10))
  .filter((id) => Number.isInteger(id) && id > 0);
if (ids.length === 0)
  throw new Error("대상 사료 ID를 쉼표로 구분해 넘겨 주세요.");

const HEADERS = {
  "content-type": "application/json",
  "x-admin-secret": SECRET,
};
const tally = { applied: 0, conflict: 0, no_draft: 0, refused: 0, skipped: 0 };

for (const id of ids) {
  const extracted = await fetch(`${BASE}/api/foods/${id}/sources/extract`, {
    body: JSON.stringify({}),
    headers: HEADERS,
    method: "POST",
  });
  if (!extracted.ok) {
    console.log(`[${id}] extract 실패 ${extracted.status}`);
    tally.refused += 1;
    continue;
  }
  const { ingredientDraft } = await extracted.json();
  if (!ingredientDraft) {
    // 근거로 증명되지 않은 목록은 추출 단계에서 이미 버려졌다.
    console.log(`[${id}] 원재료 근거 없음`);
    tally.no_draft += 1;
    continue;
  }
  if (dryRun) {
    console.log(
      `[${id}] dry-run: ${ingredientDraft.ingredients.length}개 항목`,
    );
    continue;
  }
  const applied = await fetch(`${BASE}/api/foods/${id}/sources/ingredients`, {
    body: JSON.stringify(ingredientDraft),
    headers: HEADERS,
    method: "POST",
  });
  if (!applied.ok) {
    console.log(`[${id}] apply 거절 ${applied.status}`);
    tally.refused += 1;
    continue;
  }
  const { result } = await applied.json();
  tally[result.status] += 1;
  console.log(`[${id}] ${result.status} (${result.count}개 항목)`);
}

console.log("\n--- 수율 ---");
console.log(`대상:      ${ids.length}`);
for (const [key, value] of Object.entries(tally)) {
  console.log(`${key.padEnd(10)} ${value}`);
}
```

- [ ] **Step 2: Dry-run against three foods first**

Start the dev server (`pnpm dev`), then run with three ids from Task 1's matched list and `--dry-run`. Read the printed item counts and confirm they look like ingredient lists rather than navigation fragments. Do not proceed to the full tranche until all three look right.

Run: `node scripts/backfill-ingredients.mjs --dry-run <id>,<id>,<id>`

- [ ] **Step 3: Run tranche A, then tranche B**

Run tranche A first — one run per capture, the higher-yield set:

Run: `node scripts/backfill-ingredients.mjs <tranche A ids from Task 1>`

Read the tally before starting tranche B. If tranche A's `no_draft` share is above half, stop and report rather than spending the second tranche's budget on the same failure.

Run: `node scripts/backfill-ingredients.mjs <tranche B ids from Task 1>`

Record the printed tally. `applied / 대상` is the measured yield, and it — not the 75 upper bound — is the number that goes into the direction doc.

- [ ] **Step 4: Register the script**

Add to `package.json` scripts:

```json
    "ingredients:backfill": "node scripts/backfill-ingredients.mjs",
```

Add a short section to `scripts/README.md` describing both new scripts: `measure-ingredient-tranche.mjs` selects the tranche, `backfill-ingredients.mjs` fills it from retained captures only, and neither performs new research.

- [ ] **Step 5: Record the measured yield**

In `docs/product-direction.md`, replace the "The real yield is set by a measured extraction pass, not by this figure" sentence with the measured result: how many of the tranche applied, how many returned no provable list, and how many conflicted. State the run date.

- [ ] **Step 6: Run the gate**

Run: `pnpm typecheck && pnpm test && pnpm lint && trunk check --no-fix`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill-ingredients.mjs scripts/README.md package.json docs/product-direction.md
git commit -m "feat(ingredients): backfill the matched tranche from retained captures"
```

---

## Out of scope

- The roughly 50 published foods whose current capture holds no provable ingredient list. That set splits into fresh-fetch and vision-transcription cases and needs its own plan.
- Ingredient exclusion filters in the public catalog. The data has to exist before a filter over it is worth building.
- Public read of `food_ingredient_evidence` for the evidence drilldown. `foods.ingredients` is already publicly readable; the excerpt drilldown is a separate decision.
- The dead grain-free and functional-flag filters. The direction doc records them as retirement candidates, which is a separate decision from this slice.
