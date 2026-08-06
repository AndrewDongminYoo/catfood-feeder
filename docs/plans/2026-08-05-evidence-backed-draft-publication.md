# Evidence-Backed Draft Publication Implementation Plan

> Status: Completed and verified on 2026-08-05.
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated human admin publish an existing evidence-backed DRAFT without re-entering nutrient values while separating public visibility from `data_verified_at`.

**Architecture:** A single migration introduces explicit publication fields, migrates the public RLS gate to `published_at`, and adds a service-role-only atomic publication RPC. A small TypeScript publication module computes derived fields and parses the RPC result, a human-only route owns authorization, and the existing source research workspace invokes that route.

**Tech Stack:** Next.js App Router, strict TypeScript, Zod, Supabase Postgres and pgTAP, Vitest, React Testing Library, pnpm, Trunk.

## Global Constraints

- Treat [the approved specification](../specs/2026-08-05-evidence-backed-draft-publication.md) as the behavioral contract.
- Preserve every provenance, literal-evidence, current-source, and conflict rule from the historical source-first workflow.
- Keep `SUPABASE_SERVICE_ROLE_KEY` and all privileged RPC calls server-only.
- Keep public publication human-only in this implementation.
- Keep Korean UI strings in Korean and identifiers in English.
- Do not add a dependency.
- Generate `src/types/supabase.d.ts` with Supabase CLI 2.109.1 after applying the migration; never hand-edit it.
- Use `pnpm` and the repository's existing commands.
- Preserve the uncommitted turnaround documentation already present in the worktree.
- Do not commit or push unless the operator explicitly requests it; use the checkpoint steps to inspect concern-scoped diffs.

---

## File Map

| Path                                                                     | Responsibility                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `supabase/migrations/20260805105048_separate_food_publication_state.sql` | Publication columns, legacy backfill, RLS cutover, and atomic publication RPC.             |
| `supabase/tests/food_publication_transition_test.sql`                    | Publication state, evidence, stale-write, privilege, and atomic-transition pgTAP coverage. |
| `supabase/tests/foods_publication_rls_test.sql`                          | Existing public-read and feeding-log tests updated to use `published_at`.                  |
| `src/types/supabase.d.ts`                                                | CLI-generated schema and RPC types.                                                        |
| `src/lib/food-publication.ts`                                            | Pure publication preparation and RPC result parsing.                                       |
| `src/lib/food-publication.test.ts`                                       | Domain preparation and result-schema tests.                                                |
| `src/app/api/foods/[id]/publish/route.ts`                                | Human-only HTTP publication boundary.                                                      |
| `src/app/api/foods/[id]/publish/route.test.ts`                           | Authorization and HTTP status mapping tests.                                               |
| `src/app/api/foods/route.ts`                                             | Preserve public-on-create behavior using the new publication fields.                       |
| `src/app/api/foods/drafts/route.ts`                                      | List unpublished rows using `published_at IS NULL`.                                        |
| `src/lib/catalog.ts`                                                     | Read public rows using `published_at IS NOT NULL`.                                         |
| `src/components/source-research-client.tsx`                              | Add the admin publication action and state handling.                                       |
| `src/components/source-research-client.test.tsx`                         | Exercise success, failure, and disabled publication behavior.                              |

---

### Task 1: Publication State and Atomic Database Transition

**Files:**

- Create: `supabase/migrations/20260805105048_separate_food_publication_state.sql`
- Create: `supabase/tests/food_publication_transition_test.sql`
- Modify: `supabase/tests/foods_publication_rls_test.sql`
- Regenerate: `src/types/supabase.d.ts`

**Interfaces:**

- Produces enum: `public.food_verification_method` with `legacy_human` and `human`.
- Produces columns: `foods.published_at`, `foods.published_by`, and `foods.verification_method`.
- Produces RPC: `public.publish_food_draft(bigint, uuid, timestamptz, jsonb) RETURNS jsonb`.
- RPC result statuses: `published`, `not_found`, `already_published`, `stale`, `no_evidence`, `missing_evidence`, and `evidence_mismatch`.

- [x] **Step 1: Write failing pgTAP coverage before the migration**

Create `food_publication_transition_test.sql` with a transaction-scoped brand, two private foods, current fetched sources, and current evidence.
The assertions must cover these exact behaviors:

```sql
BEGIN;
SELECT plan(12);

SELECT has_column('public', 'foods', 'published_at', 'foods has published_at');
SELECT has_column('public', 'foods', 'published_by', 'foods has published_by');
SELECT has_column(
  'public',
  'foods',
  'verification_method',
  'foods has verification_method'
);
SELECT has_function(
  'public',
  'publish_food_draft',
  ARRAY['bigint', 'uuid', 'timestamp with time zone', 'jsonb']
);

SELECT * FROM finish();
ROLLBACK;
```

After the structural assertions, insert one fully evidence-backed DRAFT, one DRAFT with a populated nutrient whose current evidence value differs, one DRAFT without evidence, and one already-published food.
Use `set_config('request.jwt.claim.sub', <actor UUID>, true)` only where the existing pgTAP auth fixture requires it.
Assert the matching DRAFT returns `published`, the mismatch returns `evidence_mismatch`, the absent evidence returns `no_evidence`, a deliberately old timestamp returns `stale`, and the published fixture returns `already_published`.
After each rejected result, query the row and assert `published_at IS NULL` and `verification_method IS NULL`.

Update `foods_publication_rls_test.sql` so its public/private fixtures differ by `published_at`, including one row where `data_verified_at` is non-null but `published_at` is null.
Assert that the latter remains invisible to `anon` and `authenticated` and cannot be referenced by feeding logs.

- [x] **Step 2: Run the database tests and confirm the intended red state**

Run:

```bash
pnpm exec supabase test db --local supabase/tests/food_publication_transition_test.sql supabase/tests/foods_publication_rls_test.sql
```

Expected: FAIL because the publication columns and `publish_food_draft` do not exist.
If local Supabase is not running, start it once with `pnpm exec supabase start`, then rerun the same test command and require the schema failure.

- [x] **Step 3: Add the publication schema and legacy backfill**

Create the migration with this state model before defining policies or functions:

```sql
CREATE TYPE public.food_verification_method AS ENUM (
  'legacy_human',
  'human'
);

ALTER TABLE public.foods
  ADD COLUMN published_at timestamptz,
  ADD COLUMN published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN verification_method public.food_verification_method;

UPDATE public.foods
SET published_at = data_verified_at,
    verification_method = 'legacy_human'
WHERE data_verified_at IS NOT NULL;

ALTER TABLE public.foods
  ADD CONSTRAINT foods_publication_state_valid CHECK (
    (
      published_at IS NULL
      AND verification_method IS NULL
      AND published_by IS NULL
    )
    OR
    (
      published_at IS NOT NULL
      AND data_verified_at IS NOT NULL
      AND verification_method IS NOT NULL
    )
  );

CREATE INDEX foods_published_idx ON public.foods (published_at);
```

Do not populate `published_by` for migrated rows.

- [x] **Step 4: Cut public and mutable-DRAFT policy over atomically**

In the same migration:

```sql
DROP POLICY IF EXISTS "public read foods" ON public.foods;
CREATE POLICY "public read foods"
ON public.foods
FOR SELECT
TO anon, authenticated
USING (published_at IS NOT NULL);
```

Recreate the feeding-log policy with the publication gate changed in its `WITH CHECK` clause:

```sql
DROP POLICY IF EXISTS "owner manages logs" ON public.feeding_logs;
CREATE POLICY "owner manages logs"
ON public.feeding_logs
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cats AS cat
    WHERE cat.id = feeding_logs.cat_id
      AND cat.owner_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cats AS cat
    WHERE cat.id = feeding_logs.cat_id
      AND cat.owner_id = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM public.foods AS food
    WHERE food.id = feeding_logs.food_id
      AND food.published_at IS NOT NULL
  )
);
```

Leave `apply_food_evidence_draft` unchanged.
The new transition sets `data_verified_at` and `published_at` together, so its existing `data_verified_at IS NULL` guard remains conservative and correct for this slice.

- [x] **Step 5: Implement the atomic publication RPC**

Define the exact signature and privilege boundary:

```sql
CREATE OR REPLACE FUNCTION public.publish_food_draft(
  p_food_id bigint,
  p_actor_id uuid,
  p_expected_updated_at timestamptz,
  p_derived jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_food public.foods%ROWTYPE;
  v_nutrient_key text;
  v_food_value numeric;
  v_evidence_value numeric;
  v_published_at timestamptz;
BEGIN
  SELECT *
    INTO v_food
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_food.published_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_published');
  END IF;
  IF v_food.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A human actor is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.food_nutrient_evidence AS evidence
    JOIN public.food_sources AS source ON source.id = evidence.source_id
    WHERE evidence.food_id = p_food_id
      AND evidence.is_current
      AND source.food_id = p_food_id
      AND source.is_current
      AND source.fetch_status = 'fetched'
  ) THEN
    RETURN jsonb_build_object('status', 'no_evidence');
  END IF;

  FOREACH v_nutrient_key IN ARRAY ARRAY[
    'protein_pct',
    'fat_pct',
    'fiber_pct',
    'ash_pct',
    'moisture_pct',
    'calcium_pct',
    'phosphorus_pct',
    'kcal_per_kg'
  ]
  LOOP
    EXECUTE format(
      'SELECT %1$I FROM public.foods WHERE id = $1',
      v_nutrient_key
    )
    INTO v_food_value
    USING p_food_id;

    IF v_food_value IS NULL THEN
      CONTINUE;
    END IF;

    SELECT evidence.value
      INTO v_evidence_value
    FROM public.food_nutrient_evidence AS evidence
    JOIN public.food_sources AS source ON source.id = evidence.source_id
    WHERE evidence.food_id = p_food_id
      AND evidence.nutrient_key = v_nutrient_key
      AND evidence.is_current
      AND source.food_id = p_food_id
      AND source.is_current
      AND source.fetch_status = 'fetched';

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'status', 'missing_evidence',
        'nutrient_key', v_nutrient_key
      );
    END IF;
    IF v_evidence_value IS DISTINCT FROM v_food_value THEN
      RETURN jsonb_build_object(
        'status', 'evidence_mismatch',
        'nutrient_key', v_nutrient_key
      );
    END IF;
  END LOOP;

  IF p_derived IS NULL
    OR jsonb_typeof(p_derived) <> 'object'
    OR jsonb_typeof(p_derived -> 'nutrientSources') <> 'object'
    OR jsonb_typeof(p_derived -> 'carbIsEstimated') <> 'boolean' THEN
    RAISE EXCEPTION 'Derived publication payload is invalid';
  END IF;

  v_published_at := statement_timestamp();
  UPDATE public.foods
  SET carb_pct = (p_derived ->> 'carbPct')::numeric,
      carb_is_estimated = (p_derived ->> 'carbIsEstimated')::boolean,
      energy_p_pct = (p_derived ->> 'energyPPct')::numeric,
      energy_f_pct = (p_derived ->> 'energyFPct')::numeric,
      energy_c_pct = (p_derived ->> 'energyCPct')::numeric,
      nutrient_sources = p_derived -> 'nutrientSources',
      data_verified_at = v_published_at,
      published_at = v_published_at,
      published_by = p_actor_id,
      verification_method = 'human'
  WHERE id = p_food_id;

  RETURN jsonb_build_object(
    'status', 'published',
    'published_at', v_published_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_food_draft(bigint, uuid, timestamptz, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_food_draft(bigint, uuid, timestamptz, jsonb)
TO service_role;
```

Use one `statement_timestamp()` value for both `data_verified_at` and `published_at`.
Set `verification_method = 'human'` inside SQL rather than accepting it in `p_derived`.
Compare each non-null measured food value with the exact numeric value in its single current evidence row joined to a current fetched source for the same food.
Return before the update on every expected failure so the function remains atomic without exception-message parsing.

- [x] **Step 6: Apply the migration locally and regenerate types**

Run:

```bash
pnpm exec supabase db reset --local
pnpm exec supabase gen types --local --lang=typescript > src/types/supabase.d.ts
```

Inspect the generated diff and require the enum, three columns, and RPC signature to appear.
Do not hand-correct generated output.

- [x] **Step 7: Run the focused database suite**

Run:

```bash
pnpm exec supabase test db --local supabase/tests/food_publication_transition_test.sql supabase/tests/foods_publication_rls_test.sql supabase/tests/food_evidence_validation_test.sql
```

Expected: all pgTAP assertions pass, including the unchanged evidence-validation suite.

- [x] **Step 8: Review the database checkpoint**

Run:

```bash
git diff --check
git diff -- supabase/migrations/20260805105048_separate_food_publication_state.sql supabase/tests/food_publication_transition_test.sql supabase/tests/foods_publication_rls_test.sql src/types/supabase.d.ts
```

Require one concern only: publication state and its database contract.
Do not stage or commit without operator authorization.

---

### Task 2: Publication Preparation Contract

**Files:**

- Create: `src/lib/food-publication.ts`
- Create: `src/lib/food-publication.test.ts`

**Interfaces:**

- Consumes: stored measured nutrients, `cookingMethod`, `nutrientSources`, and `updatedAt`.
- Produces: `prepareFoodPublication(draft: FoodPublicationDraft): FoodPublicationPreparation`.
- Produces: `publishFoodDraftResultSchema` and `PublishFoodDraftResult` matching the RPC union.

- [x] **Step 1: Write failing preparation and result-parsing tests**

Create tests for a publishable draft, a blocking domain error, derived source tags, every RPC status, and malformed RPC JSON.
Use distinct inputs so the test fails if the helper ignores a field.

```typescript
it("prepares derived values when an evidence-backed draft is valid", () => {
  const result = prepareFoodPublication({
    ashPct: 9,
    calciumPct: 1.6,
    cookingMethod: "extrusion",
    fatPct: 18,
    fiberPct: 4,
    kcalPerKg: 3850,
    moisturePct: 10,
    nutrientSources: {
      ash_pct: "kr_label",
      fat_pct: "manufacturer",
      fiber_pct: "manufacturer",
      moisture_pct: "manufacturer",
      protein_pct: "manufacturer",
    },
    phosphorusPct: 1.2,
    proteinPct: 36,
    updatedAt: "2026-08-05T10:00:00.000Z",
  });

  expect(result.kind).toBe("ready");
  if (result.kind === "ready") {
    expect(result.expectedUpdatedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(result.derived.nutrientSources.carb_pct).toBe("derived");
  }
});
```

- [x] **Step 2: Run the focused test and confirm red**

Run:

```bash
pnpm exec vitest run src/lib/food-publication.test.ts
```

Expected: FAIL because `food-publication.ts` does not exist.

- [x] **Step 3: Implement the typed publication preparation**

Define these exported types without `any`, assertions, or non-null operators:

```typescript
export type FoodPublicationPreparation =
  | {
      readonly derived: {
        readonly carbIsEstimated: boolean;
        readonly carbPct: number | null;
        readonly energyCPct: number | null;
        readonly energyFPct: number | null;
        readonly energyPPct: number | null;
        readonly nutrientSources: Readonly<Record<string, Source>>;
      };
      readonly expectedUpdatedAt: string;
      readonly kind: "ready";
    }
  | {
      readonly kind: "invalid";
      readonly message: string;
    };

export function prepareFoodPublication(
  draft: FoodPublicationDraft,
): FoodPublicationPreparation;
```

Construct the measured nutrient object once.
Call `computeDerived` with the stored cooking method, stored ash source, and no manufacturer energy override.
Return `invalid` only for blocking `validate` flags.
Preserve measured source tags and add `carb_pct` plus energy-ratio source tags exactly as the existing catalog-write path does.

- [x] **Step 4: Implement strict RPC result parsing**

Use a Zod discriminated union:

```typescript
export const publishFoodDraftResultSchema = z.discriminatedUnion("status", [
  z.object({ published_at: z.iso.datetime(), status: z.literal("published") }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("already_published") }),
  z.object({ status: z.literal("stale") }),
  z.object({ status: z.literal("no_evidence") }),
  z.object({
    nutrient_key: z.string().min(1),
    status: z.literal("missing_evidence"),
  }),
  z.object({
    nutrient_key: z.string().min(1),
    status: z.literal("evidence_mismatch"),
  }),
]);
```

Export `PublishFoodDraftResult = z.infer<typeof publishFoodDraftResultSchema>`.
Do not parse SQL exception messages.

- [x] **Step 5: Run the focused test and typecheck**

Run:

```bash
pnpm exec vitest run src/lib/food-publication.test.ts
pnpm typecheck
```

Expected: both commands exit 0.

- [x] **Step 6: Review the contract checkpoint**

Run:

```bash
git diff --check
git diff -- src/lib/food-publication.ts src/lib/food-publication.test.ts
```

Confirm the file owns only publication preparation and result parsing.
Do not stage or commit without operator authorization.

---

### Task 3: Human-Only Publication API and Read Gates

**Files:**

- Create: `src/app/api/foods/[id]/publish/route.ts`
- Create: `src/app/api/foods/[id]/publish/route.test.ts`
- Modify: `src/app/api/foods/route.ts`
- Modify: `src/app/api/foods/drafts/route.ts`
- Modify: `src/lib/catalog.ts`

**Interfaces:**

- Consumes: `prepareFoodPublication`, `publishFoodDraftResultSchema`, generated Supabase RPC types, and `authorizeCurator`.
- Produces: `POST /api/foods/[id]/publish` with no nutrient request body.
- Successful response: `{ food: { id: number, publishedAt: string, verificationMethod: "human" } }`.

- [x] **Step 1: Write failing route tests**

Test the route through exported `POST` with narrow boundary fakes for authorization and the admin Supabase client.
Cover human success, automation 403, malformed ID 400, missing food 404, blocking domain error 400, stale RPC result 409, no evidence 400, missing evidence 400, malformed RPC result 500, and unexpected RPC error 500.

```typescript
it("rejects automation credentials before loading a draft", async () => {
  authorizeCuratorMock.mockResolvedValue({
    actorId: null,
    kind: "authorized",
    origin: "automation",
    rateLimitKey: "automation",
  });

  const response = await POST(
    new NextRequest("http://localhost/api/foods/1/publish", { method: "POST" }),
    { params: Promise.resolve({ id: "1" }) },
  );

  expect(response.status).toBe(403);
  expect(createAdminClientMock).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the route test and confirm red**

Run:

```bash
pnpm exec vitest run 'src/app/api/foods/[id]/publish/route.test.ts'
```

Expected: FAIL because the route does not exist.

- [x] **Step 3: Implement the human-only publication route**

Implement the route in this order:

```typescript
const authorization = await authorizeCurator(req);
if (authorization.kind === "denied") {
  return NextResponse.json(
    { error: authorization.message },
    { status: authorization.status },
  );
}
if (authorization.origin === "automation" || authorization.actorId === null) {
  return NextResponse.json(
    { error: "자동화 자격 증명으로는 사료를 발행할 수 없습니다." },
    { status: 403 },
  );
}
```

Parse the route ID with `z.coerce.number().int().positive()`.
Select the exact stored fields required by `FoodPublicationDraft`, including `updated_at`, `published_at`, `cooking_method`, all eight measured nutrients, and `nutrient_sources`.
Return 409 before preparation when `published_at` is non-null.
Call the RPC only with the authorized actor ID, prepared expected timestamp, and prepared derived object.
Parse the returned JSON before an exhaustive `switch` over every result status.

- [x] **Step 4: Preserve public-on-create behavior and cut application reads over**

In `src/app/api/foods/route.ts`, compute one nullable publication timestamp before insert:

```typescript
const publishedAt =
  authorization.origin === "human" ? new Date().toISOString() : null;
```

Set all four fields together:

```typescript
data_verified_at: publishedAt,
published_at: publishedAt,
published_by: authorization.origin === "human" ? authorization.actorId : null,
verification_method: authorization.origin === "human" ? "human" : null,
```

In `src/app/api/foods/drafts/route.ts`, select `published_at` and filter with `.is("published_at", null)`.
In `src/lib/catalog.ts`, add `published_at` to the row type and filter with `.not("published_at", "is", null)`.
Do not remove `data_verified_at` from types or reads because it remains human verification history.

- [x] **Step 5: Run route, source-first, catalog, and type checks**

Run:

```bash
pnpm exec vitest run 'src/app/api/foods/[id]/publish/route.test.ts' src/lib/food-publication.test.ts src/lib/source-first-boundary.test.ts src/lib/fixtures.test.ts
pnpm typecheck
```

Expected: all tests pass and typecheck exits 0.

- [x] **Step 6: Review the API checkpoint**

Run:

```bash
git diff --check
git diff -- 'src/app/api/foods/[id]/publish/route.ts' 'src/app/api/foods/[id]/publish/route.test.ts' src/app/api/foods/route.ts src/app/api/foods/drafts/route.ts src/lib/catalog.ts
```

Confirm automation remains rejected and no browser-visible code receives privileged credentials.
Do not stage or commit without operator authorization.

---

### Task 4: Admin Publication Action

**Files:**

- Modify: `src/components/source-research-client.tsx`
- Modify: `src/components/source-research-client.test.tsx`

**Interfaces:**

- Consumes: `POST /api/foods/[id]/publish` success and error responses.
- Produces: a `검증 및 발행` action for the selected DRAFT.

- [x] **Step 1: Write failing UI tests**

Add three observable scenarios with the existing fetch harness:

```typescript
it("publishes the selected draft without resubmitting nutrient values", async () => {
  await user.click(await screen.findByRole("button", { name: "테스트 사료" }));
  await user.click(screen.getByRole("button", { name: "검증 및 발행" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/foods/42/publish",
    expect.objectContaining({ body: "{}", method: "POST" }),
  );
  expect(
    await screen.findByText("근거 검증을 완료하고 카탈로그에 발행했습니다."),
  ).toBeInTheDocument();
});

it("keeps the selected draft when publication fails", async () => {
  await user.click(await screen.findByRole("button", { name: "테스트 사료" }));
  await user.click(screen.getByRole("button", { name: "검증 및 발행" }));

  expect(await screen.findByText("근거가 부족합니다.")).toBeInTheDocument();
  expect(screen.getByText("테스트 사료")).toBeInTheDocument();
});

it("disables publication while unapplied candidates remain", async () => {
  await user.click(await screen.findByRole("button", { name: "성분 추출" }));
  expect(
    await screen.findByRole("button", { name: "검증 및 발행" }),
  ).toBeDisabled();
});
```

Use the existing request fakes in this test file and assert user-visible behavior rather than component internals.

- [x] **Step 2: Run the focused UI test and confirm red**

Run:

```bash
pnpm exec vitest run src/components/source-research-client.test.tsx
```

Expected: FAIL because the publication action does not exist.

- [x] **Step 3: Implement publication state handling**

Add a `publish` async function beside `registerSource`, `extract`, and `apply`.
It must call the endpoint with an empty object through the existing `request` helper, parse the success response, clear selection only on success, and always reload the DRAFT list after success.

```typescript
async function publish() {
  if (!selected || candidates.length > 0) return;
  const result = await request(`/api/foods/${selected.id}/publish`, {});
  const parsed = publishFoodResponseSchema.safeParse(result);
  if (!parsed.success) {
    setMessage("발행 결과를 확인하지 못했습니다.");
    return;
  }
  setSelectedId(null);
  setCandidates([]);
  setMessage("근거 검증을 완료하고 카탈로그에 발행했습니다.");
  await loadDrafts();
}
```

Keep the current failure behavior of `request`: it returns null and preserves state.
Place the button with the existing DRAFT actions and disable it when `busy`, no food is selected, or `candidates.length > 0`.

- [x] **Step 4: Run the focused UI and publication tests**

Run:

```bash
pnpm exec vitest run src/components/source-research-client.test.tsx src/lib/food-publication.test.ts 'src/app/api/foods/[id]/publish/route.test.ts'
```

Expected: all tests pass.

- [x] **Step 5: Review the UI checkpoint**

Run:

```bash
git diff --check
git diff -- src/components/source-research-client.tsx src/components/source-research-client.test.tsx
```

Confirm no nutrient values are sent by the publication action and failure preserves research state.
Do not stage or commit without operator authorization.

---

### Task 5: End-to-End Verification and Documentation Closure

**Files:**

- Modify after successful QA: `docs/specs/2026-08-05-evidence-backed-draft-publication.md`
- Verify only: all files listed in the File Map.

**Interfaces:**

- Consumes: the complete migration, RPC, server route, public read gates, and admin action.
- Produces: an exact-HEAD validation record in the final implementation report.

- [x] **Step 1: Run the complete automated gate**

Run one command at a time and stop on the first failure:

```bash
pnpm exec supabase db reset --local
pnpm exec supabase test db --local supabase/tests
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm exec knip
trunk check supabase/migrations/20260805105048_separate_food_publication_state.sql supabase/tests/food_publication_transition_test.sql supabase/tests/foods_publication_rls_test.sql src/lib/food-publication.ts src/lib/food-publication.test.ts 'src/app/api/foods/[id]/publish/route.ts' 'src/app/api/foods/[id]/publish/route.test.ts' src/app/api/foods/route.ts src/app/api/foods/drafts/route.ts src/lib/catalog.ts src/components/source-research-client.tsx src/components/source-research-client.test.tsx docs/specs/2026-08-05-evidence-backed-draft-publication.md
git diff --check
```

Expected: every command exits 0.
Do not run a formatter without these explicit paths.

- [x] **Step 2: Exercise the real admin surface against disposable local data**

Start the application with its existing local Supabase environment:

```bash
pnpm dev
```

Use an authenticated allowlisted admin session and one disposable DRAFT containing a retained current source plus matching current evidence.
Open `/new/research`, select the DRAFT, and click `검증 및 발행` once.
Observe all of these outcomes:

1. The completion message appears.
2. The food disappears from the DRAFT list after reload.
3. `/foods` displays the food through the public query.
4. A second direct call to the publication endpoint returns HTTP 409.
5. The evidence rows and source rows remain unchanged.

Do not exercise this scenario against a production food or production database.

- [x] **Step 3: Verify anonymous and automation boundaries through HTTP**

Against the same local process:

```bash
curl -i -X POST http://localhost:3000/api/foods/1/publish
```

Expected without a session: HTTP 401.

Call the same endpoint with the configured local automation header.
Expected: HTTP 403 and no food mutation.
Do not print the credential in terminal output or the final report.

- [x] **Step 4: Close the specification only after the manual gate passes**

Change the spec status line from:

```markdown
> Status: Approved for implementation.
```

to:

```markdown
> Status: Implemented and verified.
```

Do not change the status if any automated or manual acceptance criterion remains unverified.

- [x] **Step 5: Review the full working-tree scope**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Confirm the diff contains only the already-approved turnaround documentation plus the publication feature files in this plan.
Report any author-unknown file separately and do not stage it.
Do not commit or push without operator authorization.
