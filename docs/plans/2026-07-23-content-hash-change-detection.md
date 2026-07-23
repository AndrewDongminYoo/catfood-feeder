# Content Hash Change Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare each successful source capture with the current same-kind capture and expose `initial`, `unchanged`, or `changed` without mutating nutrient values or nutrient evidence.

**Architecture:** Extend the existing transactional `replace_current_food_source` RPC so hash comparison, source replacement, and compatibility URL updates remain one database transaction. Parse the RPC row at the repository boundary, preserve the existing source API payload while adding `contentStatus`, and let the curator UI display the status without introducing persistent review state or extraction caching.

**Tech Stack:** PostgreSQL and pgTAP, Supabase CLI and generated TypeScript types, Next.js App Router, TypeScript strict mode, Zod, React, Vitest, Trunk.

## Global Constraints

- Previously applied migrations remain unchanged; create the next migration with `CI=true pnpm exec supabase migration new content_hash_change_detection`.
- `replace_current_food_source` remains `SECURITY DEFINER`, uses `SET search_path = ''`, schema-qualifies every relation, and grants execution only to `service_role`.
- No RLS policy is relaxed.
- Every successful capture is inserted and becomes current even when its normalized content hash is unchanged.
- Content comparison never mutates `foods` nutrient columns or `food_nutrient_evidence`.
- `content_hash` alone never skips extraction or reuses extraction output.
- Korean user-facing strings remain Korean.
- Regenerate `src/types/supabase.d.ts` from the linked schema; never edit it manually.
- Use `CI=true` for every `pnpm` command.

---

### Task 1: Database Content-Status Contract

**Files:**

- Modify: `supabase/tests/source_replacement_transaction_test.sql`
- Create with Supabase CLI: the single `supabase/migrations/*_content_hash_change_detection.sql` file emitted by Task 1 Step 4

**Interfaces:**

- Consumes: `public.replace_current_food_source(bigint, public.nutrient_source, text, text, timestamptz, text, text, timestamptz, uuid)`.
- Produces: one RPC row shaped as `{ source_id: bigint, content_status: text }`, where `content_status` is `initial`, `unchanged`, or `changed`.

- [x] **Step 1: Extend the pgTAP fixtures for all three statuses**

Add independent foods so each result is observed once:

```sql
INSERT INTO public.foods (id, brand_id, product_name, manufacturer_url)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'changed replacement', 'https://example.test/changed-old'),
  (-93002, -93001, 'failed replacement', 'https://example.test/failure-old'),
  (-93003, -93001, 'unchanged replacement', 'https://example.test/unchanged-old'),
  (-93004, -93001, 'initial replacement', NULL);
```

Seed `-93001`, `-93002`, and `-93003` with current manufacturer sources.
Use different incoming hash text for `-93001`, the same incoming hash text for `-93003`, and no prior source for `-93004`.

- [x] **Step 2: Write failing status assertions**

Capture the RPC output inside pgTAP assertions:

```sql
SELECT is(
  (
    SELECT content_status
    FROM public.replace_current_food_source(
      -93003,
      'manufacturer',
      'https://example.test/unchanged-new',
      'fetch',
      '2026-07-23 12:00:00+00'::timestamptz,
      'unchanged-hash',
      'Protein 33%',
      NULL,
      NULL
    )
  ),
  'unchanged',
  'equal current and incoming hashes return unchanged'
);
```

Add equivalent assertions for `changed` and `initial`.
Keep the existing role-denial, invalid-kind, successful-write, and forced-final-write rollback assertions.
End with `SELECT * FROM finish(TRUE);` so a failed plan exits nonzero through the linked query path.

- [x] **Step 3: Run the linked contract to verify RED**

Run from the linked primary checkout:

```bash
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/source_replacement_transaction_test.sql
```

Expected: nonzero exit with pgTAP failures because the current RPC returns `bigint` rather than columns named `source_id` and `content_status`.

- [x] **Step 4: Create the migration through the CLI**

Run from the feature worktree:

```bash
CI=true pnpm exec supabase migration new content_hash_change_detection
```

Record the exact generated filename from `git status --short supabase/migrations` and use only that file for the new RPC definition.

- [x] **Step 5: Implement hash comparison and the table result**

Drop the current function before changing its return type, then recreate the same argument signature:

```sql
CREATE FUNCTION public.replace_current_food_source(
  p_food_id bigint,
  p_kind public.nutrient_source,
  p_url text,
  p_capture_method text,
  p_captured_at timestamptz,
  p_content_hash text,
  p_captured_text text,
  p_observed_at timestamptz DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(source_id bigint, content_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_hash text;
BEGIN
  PERFORM 1
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  SELECT content_hash
  INTO v_previous_hash
  FROM public.food_sources
  WHERE food_id = p_food_id
    AND kind = p_kind
    AND fetch_status = 'fetched'
    AND is_current;

  content_status := CASE
    WHEN NOT FOUND THEN 'initial'
    WHEN v_previous_hash = p_content_hash THEN 'unchanged'
    ELSE 'changed'
  END;

  -- Preserve the existing validation, retirement, insertion, and URL update.
  RETURN NEXT;
END;
$$;
```

Assign the inserted row ID directly into the output parameter with `RETURNING id INTO source_id`.
Keep the existing input validation before any source mutation.
Revoke `PUBLIC`, `anon`, and `authenticated`, then grant only `service_role`.

- [x] **Step 6: Apply the candidate definition and verify GREEN**

Use the previously approved linked alternative path from the primary checkout:

Resolve the one migration path without reading any environment file:

```bash
typeset -a migration_files
migration_files=(
  /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/migrations/*_content_hash_change_detection.sql
)
test ${#migration_files[@]} -eq 1
CI=true pnpm exec supabase db query --linked --file "${migration_files[1]}"
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/source_replacement_transaction_test.sql
```

Expected: pgTAP exits zero with every planned assertion passing, including rollback after a forced compatibility URL failure.

- [x] **Step 7: Run database regression contracts**

```bash
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/source_refresh_provenance_test.sql
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/foods_publication_rls_test.sql
```

Expected: the final rows remain `ok 11` and `ok 10`.

---

### Task 2: Typed RPC and API Response Contracts

**Files:**

- Create: `src/lib/source-capture-response.ts`
- Create: `src/lib/source-capture-response.test.ts`
- Modify: `src/lib/source-repository.ts`
- Generated: `src/types/supabase.d.ts`

**Interfaces:**

- Consumes: generated RPC rows `{ source_id: number; content_status: string }[]`.
- Produces: `SourceContentStatus`, `SourceReplacementResult`, `sourceCaptureResponseSchema`, `sourceCaptureTone`, and `sourceCaptureStatusMessage`.

- [x] **Step 1: Write the failing TypeScript contract tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  parseSourceReplacementResult,
  sourceCaptureResponseSchema,
  sourceCaptureTone,
} from "./source-capture-response";

describe("parseSourceReplacementResult", () => {
  it("parses one RPC outcome", () => {
    expect(
      parseSourceReplacementResult([
        { content_status: "unchanged", source_id: 23 },
      ]),
    ).toEqual({ contentStatus: "unchanged", sourceId: 23 });
  });
});

describe("sourceCaptureResponseSchema", () => {
  it.each(["initial", "unchanged", "changed"] as const)(
    "accepts the %s content status",
    (contentStatus) => {
      const result = sourceCaptureResponseSchema.safeParse({
        contentStatus,
        source: {
          capturedAt: "2026-07-23T12:00:00.000Z",
          capturedText: "Protein 33%",
          contentHash: "a".repeat(64),
          id: 1,
          kind: "manufacturer",
          observedAt: null,
          url: "https://example.test/product",
        },
      });

      expect(result.success).toBe(true);
    },
  );

  it("rejects an unknown content status", () => {
    const result = sourceCaptureResponseSchema.safeParse({
      contentStatus: "reviewed",
      source: {},
    });

    expect(result.success).toBe(false);
  });
});

describe("sourceCaptureTone", () => {
  it("uses a warning only for changed content", () => {
    expect(sourceCaptureTone("initial")).toBe("success");
    expect(sourceCaptureTone("unchanged")).toBe("success");
    expect(sourceCaptureTone("changed")).toBe("warning");
  });
});
```

- [x] **Step 2: Run the focused test to verify RED**

```bash
CI=true pnpm test -- src/lib/source-capture-response.test.ts
```

Expected: FAIL because `source-capture-response.ts` does not exist.

- [x] **Step 3: Implement the shared response contract**

```typescript
import { z } from "zod";

export const SOURCE_CONTENT_STATUS_VALUES = [
  "initial",
  "unchanged",
  "changed",
] as const;

export type SourceContentStatus = (typeof SOURCE_CONTENT_STATUS_VALUES)[number];

export const sourceCaptureResponseSchema = z.object({
  contentStatus: z.enum(SOURCE_CONTENT_STATUS_VALUES),
  source: z.object({
    capturedAt: z.string(),
    capturedText: z.string(),
    contentHash: z.string(),
    id: z.number(),
    kind: z.enum(["manufacturer", "kr_label"]),
    observedAt: z.string().nullable(),
    url: z.string(),
  }),
});

export function sourceCaptureStatusMessage(
  status: SourceContentStatus,
): string {
  switch (status) {
    case "initial":
      return "출처를 수집했습니다.";
    case "unchanged":
      return "이전 수집본과 출처 내용이 같습니다.";
    case "changed":
      return "출처 내용이 변경되었습니다. 추출 후 근거를 검토하세요.";
  }
}
```

- [x] **Step 4: Parse the RPC result in the repository**

Define the database-row Zod schema at the shared response boundary:

```typescript
const sourceReplacementRowsSchema = z
  .array(
    z.object({
      content_status: z.enum(SOURCE_CONTENT_STATUS_VALUES),
      source_id: z.number(),
    }),
  )
  .length(1);
```

Change `replaceCurrentFoodSource` to return:

```typescript
type SourceReplacementResult = {
  readonly contentStatus: SourceContentStatus;
  readonly sourceId: number;
};
```

Parse `data` and throw `SourceRepositoryError("replace_current_source", "Source replacement RPC returned an invalid result")` when parsing fails.

- [x] **Step 5: Regenerate linked types and verify the focused contract**

Run code generation from the linked primary checkout and format only the generated file:

```bash
CI=true pnpm exec supabase gen types --linked --lang typescript > /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/src/types/supabase.d.ts
trunk fmt src/types/supabase.d.ts
CI=true pnpm test -- src/lib/source-capture-response.test.ts
CI=true pnpm typecheck
```

Expected: generated RPC returns `{ content_status: string; source_id: number }[]`; the focused test and typecheck pass.

---

### Task 3: Route and Curator Status Presentation

**Files:**

- Modify: `src/app/api/foods/[id]/sources/route.ts`
- Modify: `src/components/source-research-client.tsx`
- Test: `src/lib/source-capture-response.test.ts`

**Interfaces:**

- Consumes: `SourceReplacementResult` from the repository.
- Produces: the existing `{ source }` success payload plus `contentStatus`, parsed by `sourceCaptureResponseSchema`.

- [x] **Step 1: Pin warning versus non-warning presentation**

Test the machine-consumed presentation tone rather than coupling the contract test to Korean prose:

```typescript
expect(sourceCaptureTone("initial")).toBe("success");
expect(sourceCaptureTone("unchanged")).toBe("success");
expect(sourceCaptureTone("changed")).toBe("warning");
```

Run the focused test and confirm RED until the status-to-tone mapping is implemented.

- [x] **Step 2: Add `contentStatus` to both successful route branches**

For manual and fetched captures:

```typescript
const replacement = await replaceCurrentFoodSource(source);

return NextResponse.json({
  contentStatus: replacement.contentStatus,
  source: {
    // Preserve every existing source field.
    id: replacement.sourceId,
  },
});
```

Do not alter the failed-capture `422` response.

- [x] **Step 3: Parse the success response before clearing input**

In `registerSource`:

```typescript
const parsed = sourceCaptureResponseSchema.safeParse(result);
if (!parsed.success) {
  setMessage("출처 수집 결과를 확인하지 못했습니다.");
  return;
}

setCaptureStatus(parsed.data.contentStatus);
setUrl("");
setManualText("");
setCandidates([]);
await loadDrafts();
```

Keep the existing behavior that preserves URL and manual transcript when the request or response contract fails.
Store `parsed.data.contentStatus` in a separate `captureStatus` state so ordinary request errors continue to use the existing error message state.

- [x] **Step 4: Render warning and non-warning statuses distinctly**

```tsx
const captureStatusNotice = captureStatus ? (
  <p
    className={captureStatus === "changed" ? "flag warn" : "okbox"}
    role={captureStatus === "changed" ? "alert" : "status"}
  >
    {sourceCaptureStatusMessage(captureStatus)}
  </p>
) : null;
```

Clear `captureStatus` when a new request begins.
Render `{captureStatusNotice}` next to the existing request error message.
Do not render successful `initial` or `unchanged` results with the existing `.err` class.

- [x] **Step 5: Verify the TypeScript surface**

```bash
CI=true pnpm test -- src/lib/source-capture-response.test.ts
CI=true pnpm typecheck
CI=true pnpm lint
```

Expected: focused tests, strict typecheck, and lint pass.

---

### Task 4: Linked Migration Finalization and Full Verification

**Files:**

- Modify: `docs/notes/2026-07-21-full-codebase-audit.md`
- Modify: `docs/plans/2026-07-16-source-first-catalog-collection.md`
- Modify: `docs/specs/2026-07-23-content-hash-change-detection.md`

**Interfaces:**

- Consumes: the final linked RPC definition and application behavior.
- Produces: linked migration history, generated types, updated implementation status, and final verification evidence.

- [x] **Step 1: Finalize linked migration history without touching parallel migrations**

Confirm remote history first:

```bash
CI=true pnpm exec supabase migration list --linked
```

Preserve remote-only `20260722015424` if it remains present.
Use the approved linked alternative path to mark only the new content-hash migration applied, mirroring only that migration into the linked primary checkout temporarily if `migration repair` requires a local file.
Remove the temporary mirror after repair and verify the primary checkout again contains only its pre-existing `.omo/` path.

- [x] **Step 2: Verify the final linked function definition and privileges**

Query `pg_proc` and `information_schema.routine_privileges` to prove:

- The final argument signature resolves.
- The return columns are `source_id` and `content_status`.
- `prosecdef` is true.
- `proconfig` contains `search_path=""`.
- `anon` and `authenticated` lack execute privilege.
- `service_role` has execute privilege.

- [x] **Step 3: Run every database contract and linked lint**

```bash
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/source_replacement_transaction_test.sql
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/source_refresh_provenance_test.sql
CI=true pnpm exec supabase db query --linked --file /Volumes/dongminyu/Development/01_personal/catfood-feeder-worktrees/content-hash-change-detection/supabase/tests/foods_publication_rls_test.sql
CI=true pnpm exec supabase db lint --linked --schema public --level warning --fail-on error
```

Expected: every pgTAP plan ends with its final `ok` row and DB lint reports no schema errors.

- [x] **Step 4: Update implementation status documents**

- Move `content_hash` change detection from **Still open** to **Follow-up fixes** in the audit note.
- Mark the plan step that compares capture hashes and presents a curator result complete.
- Change the new design spec status to `Implemented`.
- Do not mark transcript viewing, failed-source UI, persistent review state, or extraction caching complete.

- [x] **Step 5: Run the complete repository gate**

```bash
CI=true pnpm typecheck
CI=true pnpm lint
CI=true pnpm test
CI=true pnpm exec knip
trunk check --no-progress --color=false --cache=false
CI=true pnpm build
git diff --check
```

Expected: at least 10 Vitest files and more than 66 tests pass, Trunk reports no new issues, and Next.js completes all static page generation.

- [x] **Step 6: Exercise the matching surface** — The feature worktree intentionally had no environment file, so linked pgTAP exercised the real rollback-only RPC while Chrome exercised the same current UI with isolated `unchanged` and `changed` API responses. Both fresh visual QA passes returned `PASS`.

Use an authenticated curator browser session when available:

1. Capture a manual transcript for a DRAFT source.
2. Capture the same normalized transcript again and observe the unchanged message.
3. Capture changed transcript text and observe the changed warning.
4. Confirm the current source ID changes on each successful capture.
5. Confirm no nutrient value or evidence row changes before explicit apply.

If no authenticated browser session is available, run the real linked RPC for unchanged and changed captures inside a rollback-only SQL transaction and report the UI portion as unverified rather than claiming success.

- [x] **Step 7: Prepare concern-split commits**

Commit groups:

1. `chore(tooling): upgrade pnpm to 11.15.1` for the package-manager pin.
2. `feat(collection): detect source content changes` for migration, pgTAP, repository, API, UI contract, tests, and generated types.
3. `docs(collection): record content hash change detection` for plan, spec status, source-first plan status, and audit note.

Before each commit, inspect the complete staged patch and run the verification appropriate to that group.
