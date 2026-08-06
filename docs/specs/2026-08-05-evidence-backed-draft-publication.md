# Evidence-Backed Draft Publication

> Status: Implemented and verified.
> Decision date: 2026-08-05.
> Parent direction: [AI-Native Catalog Turnaround](../notes/2026-08-05-ai-native-catalog-turnaround.md).

## Purpose

Create the first shippable transition from the human-only source-first workflow to the AI-native research agency.

An authenticated human admin must be able to publish an existing evidence-backed DRAFT without manually re-entering its nutrient values.
Publication eligibility, human verification time, and verification method must stop sharing one ambiguous `data_verified_at` state.

This feature establishes the publication boundary that later local-agent research will feed.
It does not grant an agent permission to publish.

## Scope

This implementation:

- adds an explicit publication state to `foods`;
- preserves `data_verified_at` as the last human verification time;
- records whether a published row was migrated from the legacy model or approved through the new human workflow;
- records the human admin who performed a new publication when that identity is available;
- changes public catalog and feeding eligibility to use publication state rather than human verification time;
- adds an atomic database transition for an evidence-backed DRAFT;
- exposes that transition through a human-only server route;
- adds an admin action to the existing source research workspace.

## Non-Goals

- Local-agent discovery, capture, extraction, and machine-principal credentials are separate implementation slices.
- Automatic publication is not allowed.
- Research-run persistence and `verification_run_id` are deferred until the research ledger exists.
- Unpublish, rollback, bulk publication, public contribution, and multi-admin workflow are not included.
- Existing nutrient or source evidence is not rewritten during publication.
- Missing nutrient values are not synthesized during publication.

## Data Model

Add a `food_verification_method` enum with these initial values:

- `legacy_human`: the row was already public under the historical `data_verified_at` gate and its exact actor is unavailable;
- `human`: an authenticated human admin used the new publication transition.

Add these columns to `foods`:

| Column                | Type                       | Meaning                                                                    |
| --------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `published_at`        | `timestamptz`              | Null means private DRAFT; non-null means eligible for public reads.        |
| `published_by`        | `uuid`                     | Authenticated admin who used the new publication transition, when known.   |
| `verification_method` | `food_verification_method` | How the published row crossed the verification and publication transition. |

`published_by` references `auth.users(id)` with `ON DELETE SET NULL` so deleting an auth identity does not delete catalog history.

The row-state constraint is:

```sql
CHECK (
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
)
```

An unpublished row may retain `data_verified_at` in a future workflow, but it is not publicly eligible until `published_at` is set.

## Migration and Compatibility

Existing rows where `data_verified_at IS NOT NULL` are backfilled atomically:

```sql
UPDATE public.foods
SET published_at = data_verified_at,
    verification_method = 'legacy_human'
WHERE data_verified_at IS NOT NULL;
```

No historical `published_by` value is fabricated.

The migration replaces public `foods` RLS and feeding-log eligibility checks with `published_at IS NOT NULL`.
The application catalog query uses the same condition.
Draft listing uses `published_at IS NULL`.

The existing `data_verified_at` index remains because human verification time still supports audit and refresh prioritization.
Add an index on `published_at` for publication eligibility queries.

The existing `apply_food_evidence_draft` RPC remains unchanged in this slice.
Because the new publication transition sets `data_verified_at` and `published_at` together, its current `data_verified_at IS NULL` guard still prevents evidence mutation after publication.
A future workflow that creates human-verified but unpublished rows must revisit that guard explicitly.

The existing human `POST /api/foods` behavior remains public-on-create.
One server timestamp populates `data_verified_at` and `published_at`, the authenticated actor populates `published_by`, and `verification_method` is `human`.
Automation-origin inserts leave all publication and verification fields null.

## Publication Eligibility

The new transition publishes only a row that satisfies every condition below:

1. The food exists and `published_at` is null.
2. The caller is an authenticated allowlisted human curator with a non-null actor ID.
3. The draft has at least one current `food_nutrient_evidence` row.
4. Every non-null measured nutrient among `protein_pct`, `fat_pct`, `fiber_pct`, `ash_pct`, `moisture_pct`, `calcium_pct`, `phosphorus_pct`, and `kcal_per_kg` has exactly one current evidence row with the same numeric value.
5. Every cited evidence row points to a current fetched source belonging to the same food.
6. Server-side domain validation reports no blocking error.
7. The food has not changed since the server loaded it for domain calculation.

Null nutrients remain explicit gaps and do not block publication.
A populated nutrient without exact retained evidence blocks publication rather than being silently treated as legacy data.

Publication computes only the existing derived catalog fields from the current measured values.
It does not populate a missing measured nutrient or manufacture evidence.

## Atomic Database Transition

Create `publish_food_draft` as a `SECURITY DEFINER` function executable only by `service_role`.

The function consumes:

```typescript
type PublishFoodDraftInput = {
  readonly actorId: string;
  readonly derived: {
    readonly carbIsEstimated: boolean;
    readonly carbPct: number | null;
    readonly energyCPct: number | null;
    readonly energyFPct: number | null;
    readonly energyPPct: number | null;
    readonly nutrientSources: Readonly<Record<string, string>>;
  };
  readonly expectedUpdatedAt: string;
  readonly foodId: number;
};
```

The SQL function locks the food, compares `updated_at` with `expectedUpdatedAt`, revalidates current evidence, updates derived fields and their source tags, and sets the publication fields in one transaction.

It returns one of these structured results:

```typescript
type PublishFoodDraftResult =
  | {
      readonly published_at: string;
      readonly status: "published";
    }
  | {
      readonly status:
        "already_published" | "no_evidence" | "not_found" | "stale";
    }
  | {
      readonly nutrient_key: string;
      readonly status: "evidence_mismatch" | "missing_evidence";
    };
```

Expected eligibility failures return a status and do not partially mutate the row.
Unexpected SQL failures raise and roll back the transaction.

## Server Route

Add `POST /api/foods/[id]/publish`.

The route accepts no nutrient payload.
It derives the target entirely from the current stored DRAFT and retained evidence.

The route performs these steps:

1. Authorize the curator.
2. Reject automation-origin credentials with HTTP 403.
3. Parse the positive integer food ID.
4. Load the current DRAFT fields required by `computeDerived` and `validate`.
5. Return HTTP 404 when the food does not exist.
6. Return HTTP 409 when the food is already published.
7. Compute derived values and return HTTP 400 when domain validation has a blocking error.
8. Call `publish_food_draft` with the actor ID, expected `updated_at`, and derived values.
9. Parse the RPC result before mapping it to an HTTP response.

Response mapping:

| RPC status          | HTTP status | Behavior                                                     |
| ------------------- | ----------- | ------------------------------------------------------------ |
| `published`         | 200         | Return food ID, publication time, and method `human`.        |
| `not_found`         | 404         | Return a Korean not-found error.                             |
| `already_published` | 409         | Return a Korean already-published error.                     |
| `stale`             | 409         | Ask the client to reload the DRAFT before retrying.          |
| `no_evidence`       | 400         | Explain that at least one retained evidence row is required. |
| `missing_evidence`  | 400         | Name the nutrient whose retained evidence is missing.        |
| `evidence_mismatch` | 400         | Name the nutrient whose stored value and evidence differ.    |

Unexpected repository or RPC failures return the existing generic Korean catalog-save error and HTTP 500.

## Admin Workspace

The existing source research workspace adds a `검증 및 발행` action for the selected DRAFT.

The action is disabled while a request is busy or while unapplied extraction candidates remain in client state.
The server remains the authority for publication eligibility.

On success, the client:

- shows the publication completion message;
- clears the selected DRAFT and extraction candidates;
- reloads the DRAFT list, causing the published food to disappear because the list uses `published_at IS NULL`.

On failure, the client retains the selected DRAFT and all candidate state so the admin can inspect or retry without redoing research.

## Security

- Only an allowlisted authenticated human admin can call the publication route.
- Automation credentials receive HTTP 403.
- The browser never receives service-role credentials.
- The RPC is revoked from `PUBLIC`, `anon`, and `authenticated` and granted only to `service_role`.
- The RPC obtains `published_by` from the server-authorized actor ID and does not accept a verification method from the browser.
- Public RLS remains the final catalog visibility boundary.

## Acceptance Criteria

- An existing evidence-backed DRAFT can be published without resubmitting nutrient values.
- A published row disappears from the DRAFT list and appears through the public catalog query.
- Existing public rows remain public after migration with `verification_method = 'legacy_human'` and no fabricated actor.
- A missing or mismatched evidence row blocks publication and leaves the food unchanged.
- A concurrent change blocks publication with `stale` and leaves the food unchanged.
- An automation credential cannot publish.
- Direct `anon` and `authenticated` Data API reads cannot see rows where `published_at` is null even when `data_verified_at` is non-null.
- Feeding logs cannot reference an unpublished food.
- Existing source evidence remains unchanged by publication.

## Verification

Automated verification includes Vitest coverage for publication preparation, route status mapping, and the admin action.
pgTAP coverage includes migration backfill, RLS visibility, RPC privileges, evidence completeness, mismatch rejection, stale-write rejection, and the successful atomic transition.

Manual QA uses an authenticated admin session and a disposable local Supabase DRAFT with retained evidence.
It observes the DRAFT in the research workspace, publishes it once, confirms it disappears from the DRAFT list, and confirms it appears in the public catalog.
