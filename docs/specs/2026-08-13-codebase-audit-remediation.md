# Codebase Audit Remediation Program

## Status

Design approved by the operator on 2026-08-13.

Implementation must proceed as independently testable task streams rather than one repository-wide rewrite.

## Goal

Resolve the verified codebase-audit findings in risk order while preserving the source-backed catalog, human-curation boundary, public fixture fallback, and current APIs unless a finding explicitly requires a contract change.

## Delivery Approach

Use one working branch with concern-separated task streams and verification checkpoints.

This keeps the operator-requested current workspace while allowing each stream to be reviewed and committed independently later.

The alternatives are weaker for this program.

- A single cross-system patch would mix authentication, domain math, migrations, product behavior, scripts, and CI into a change that is difficult to review or roll back.
- One branch per individual finding would create avoidable coordination overhead because several findings share the same tests and source boundaries.

## Global Constraints

- Keep public APIs stable unless the verified finding requires a behavior change.
- Keep Korean UI strings and comments in Korean and keep identifiers and commit messages in English.
- Add no new dependency unless the existing Next.js, Supabase, Vitest, and PostgreSQL surfaces cannot express the required behavior.
- Apply TDD to every behavior change: write one focused failing test, verify the expected failure, implement the minimum change, and rerun the focused and affected suites.
- Create database migrations through the Supabase CLI and regenerate generated types only after the migrations replay successfully.
- Do not weaken RLS, expose service-role credentials, or treat proxy authentication as route or loader authorization.
- Preserve author-unknown and unrelated work.
- Do not commit or push until the operator requests it.

## Task Stream 1: Curator Read Boundary and Nutrition Validation

This is the first implementation stream because it addresses a private-data disclosure and a publication-integrity defect without requiring a schema change.

### Task 1.1: Require a Human Curator Before SSR Draft Loads

Add a human-only authorization function alongside `authorizeCurator()`.

`authorizeCurator(request)` continues to accept either the automation secret or an allowlisted human, while the new server-page path accepts only an allowlisted human session.

The `/new/review` and `/new/transcribe` pages must complete this authorization before calling any service-role loader.

Do not rely on a parent layout as the security boundary because nested server work may execute independently.

Unauthenticated users must be redirected to login, while authenticated but unlisted users and missing admin configuration must receive a response that contains no draft data.

Acceptance criteria:

- A denied review-page request never calls `loadPublicationReview()`.
- A denied transcription-page request never calls `loadPendingTranscripts()`.
- An allowlisted human still receives the current server-rendered initial data.
- Automation-secret API authorization remains unchanged.
- No service-role client is imported by a client component.

### Task 1.2: Include Stated NFE in Guaranteed-Analysis Totals

Include `NutrientInput.carb_pct` in the guaranteed-analysis sum only when it is explicitly present.

Do not add the derived NFE value when `carb_pct` is absent, because that would make every inverse-calculated total tautologically equal to 100%.

Acceptance criteria:

- Protein 40%, fat 30%, fiber 10%, ash 10%, and stated NFE 20% produces one blocking total-over-100 flag.
- The existing exact-100 floating-point tolerance remains valid.
- The ordinary derived-NFE path remains unchanged.
- Existing publication and fixture regression tests still pass.

## Task Stream 2: Reproducible Supabase Schema and CI

### Task 2.1: Make Clean Migration Replay Deterministic

Replace the final migration's assertion about six pre-existing brand rows with an invariant that also holds on an empty database.

Regenerate the migration only through the repository's Supabase CLI workflow and prove a clean local replay before treating the schema as fixed.

### Task 2.2: Repair Database Test Fixtures and Privileges

Add required `ko_name` values to the nine stale pgTAP brand fixtures.

Declare the exact table, column-update, and sequence privileges required by the Data API, including the transcript status transition.

Add cross-user `cats` and `feeding_logs` ownership tests and verify that RLS is reached rather than masked by missing table privileges.

### Task 2.3: Regenerate Supabase Types

Regenerate `src/types/supabase.d.ts` after every migration replays and confirm that `brands.in_scope` and the final function signatures match the schema.

### Task 2.4: Add Application CI

Add a separate GitHub workflow for frozen pnpm installation, lint, typecheck, Vitest, and production build on application changes.

Keep the existing pgTAP workflow focused on database changes.

## Task Stream 3: Public Catalog and Feeding Correctness

### Task 3.1: Surface Brand-Scoped Recalls

Combine product-specific and brand-scoped recalls in catalog and feeding reads without claiming that a brand-scoped event applies to every product lot.

Label the scope explicitly in detail, comparison, and feeding output.

### Task 3.2: Keep Published Partial Records Visible

Use `published_at` as the public visibility boundary and render missing protein as unknown rather than silently removing a successfully published record.

### Task 3.3: Enforce One Current Feeding Period

Add a transactional switch operation that closes the previous open feeding period before inserting the next one.

Back it with a partial unique index on `cat_id` where `ended_on IS NULL` and provide the minimum correction path for an erroneous period.

### Task 3.4: Expose Feeding Read Failures

Return an explicit dashboard error state instead of converting query failures to empty user data.

### Task 3.5: Implement Persistent Public Caching

Use a cookie-free anonymous Supabase client for public RLS reads and an explicit one-hour Next.js data cache.

Keep authenticated curator and feeding reads dynamic.

## Task Stream 4: Curator Workflow Consistency

### Task 4.1: Make Multi-Source Extraction Reachable

Allow the curator to select source inputs or extract them one at a time instead of sending every current source into a two-source, unique-kind API contract.

### Task 4.2: Resolve Manufacturer Energy Declarations Deterministically

Read every current manufacturer source, fail on database errors, select a complete declaration deterministically, and block publication when complete declarations conflict.

### Task 4.3: Support Human Transcript Corrections

Allow a curator to correct values and literal excerpts or deterministically reparse the edited transcript before applying evidence.

### Task 4.4: Make Transcript Approval Atomic

Lock the pending run and perform source registration, evidence application, conflict preservation, and terminal status transition in one transaction.

### Task 4.5: Add an Accepted-Change Transition

Provide a human-only transaction that supersedes current evidence and accepts a changed value from the same logical source while preserving the audit history.

## Task Stream 5: Research Operations and Provenance

### Task 5.1: Make Research Mutation and Ledger Recording Atomic

Create a provisional run before mutation or combine capture, evidence application, and ledger recording in one transactional database operation.

### Task 5.2: Add the Missing Research-Run Exception Queue

List `capture_failed`, `claim_conflict`, `invalid`, and `errored` runs for curator triage while retaining the existing transcript and source-conflict queues.

### Task 5.3: Make Research Runs Reproducible

Persist structured search queries, retry or superseding relationships, terminal reasons, and the run used for a publication decision.

### Task 5.4: Make Maintenance Scripts Review-First

Make `release-stranded.mjs` and `research-brand-identity.mjs` dry-run by default, require an explicit apply flag, and constrain candidates to evidence-backed human-approved selections.

### Task 5.5: Isolate the Research Agent Profile

Move the child agent to a dedicated OS account or container with a dedicated `CODEX_HOME` before treating read-only sandboxing as a credential boundary.

## Task Stream 6: Maintenance and Documentation

### Task 6.1: Tighten Database Maintenance Surfaces

Revoke public execution from the internal numeric parser and add the missing foreign-key support indexes after verifying their query plans and delete paths.

### Task 6.2: Pin the Runtime Contract

Declare the supported Node.js floor, use the same version in CI, and resolve the Vitest and PostCSS module-format warnings without changing application behavior.

### Task 6.3: Reconcile Durable Documentation

Mark Phase 6 items as partial or complete based on real behavior and update the stale transcript-viewer and transcription-plan status without rewriting historical findings.

## First Implementation Boundary

The first plan and implementation must contain only Task 1.1 and Task 1.2.

Likely modified or created files are:

- `src/lib/admin-auth.ts`
- `src/lib/admin-auth.test.ts`
- `src/app/new/review/page.tsx`
- `src/app/new/review/page.test.tsx`
- `src/app/new/transcribe/page.tsx`
- `src/app/new/transcribe/page.test.tsx`
- `src/lib/domain.ts`
- `src/lib/domain.test.ts`

No migration, generated type, package manifest, lockfile, public UI, or unrelated formatting change belongs in this first boundary.

## First Implementation Verification

Run the focused authorization and domain tests after each red-green cycle.

Then run:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Run `pnpm build` before the first stream is declared complete because the SSR page boundary is compiled differently from isolated Vitest modules.
