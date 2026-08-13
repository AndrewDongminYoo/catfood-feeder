# Supabase Clean Replay and RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the complete Supabase migration history replay on an empty database, make database tests exercise the final schema and real Data API privileges, prove cross-user ownership isolation, and regenerate the checked-in database types from the applied local schema.

**Architecture:** Keep ordered migrations as the schema authority.
Replace the operational six-row snapshot assertion inside the blocking historical migration with a row-relative invariant that is valid on an empty database.
Add one forward migration that grants only the current Data API surface, including column-scoped transcript status updates and identity-sequence usage.
Use pgTAP against the real local roles and RLS policies, then generate TypeScript declarations from the successfully replayed local schema.

**Tech Stack:** Supabase CLI 2.111.0, PostgreSQL 17, pgTAP, SQL migrations, TypeScript generated declarations, pnpm.

## Global Constraints

- Do not contact or mutate the linked remote project.
- Do not edit `src/types/supabase.d.ts` by hand.
- Do not add dependencies or modify application CI in this stream.
- Do not weaken RLS or expose `food_sources`, `food_nutrient_evidence`, `food_research_runs`, or `extraction_rate_limits` to `anon` or `authenticated`.
- Keep the service-role transcript update limited to `food_research_runs.status`.
- Use a new migration created by `pnpm exec supabase migration new data_api_privileges` for the forward privilege contract.
- Keep each pgTAP test inside `BEGIN` and `ROLLBACK`.
- Do not stage, commit, or push until the operator explicitly requests it.

## File Structure

| File                                                                  | Responsibility                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260809020000_stated_carbohydrate_evidence.sql` | Terminate the replacement function definition so PostgreSQL can parse the following constraint statements. |
| `supabase/migrations/20260810140000_brand_scope.sql`                  | Replace the six-row operational snapshot with an empty-database-safe scope invariant.                      |
| `supabase/migrations/<generated>_data_api_privileges.sql`             | Declare current table, column-update, and identity-sequence privileges.                                    |
| `supabase/tests/data_api_privileges_test.sql`                         | Prove required API privileges and sensitive-table denials.                                                 |
| `supabase/tests/owner_data_rls_test.sql`                              | Prove one authenticated user cannot read or mutate another user's cats or feeding logs.                    |
| `supabase/tests/food_research_runs_privileges_test.sql`               | Pin service-role transcript status update access.                                                          |
| `supabase/tests/foods_publication_rls_test.sql`                       | Use the production privilege contract while preserving publication-policy coverage.                        |
| `supabase/tests/source_replacement_transaction_test.sql`              | Exercise the final URL-based source replacement contract instead of the retired kind-slot contract.        |
| Nine existing pgTAP fixture files                                     | Add the required unique `ko_name` value to every brand fixture.                                            |
| `src/types/supabase.d.ts`                                             | Regenerate from the successfully replayed local schema.                                                    |

## Task 1: Reproduce the Clean-Replay Failure

- [x] Confirm no local Supabase stack is running with `pnpm exec supabase status`.
- [x] Run `pnpm exec supabase db start` before editing SQL.
- [x] Record each clean-replay blocker in migration order, beginning with the unterminated function definition in `20260809020000_stated_carbohydrate_evidence.sql` and then the empty-database assertion in `20260810140000_brand_scope.sql`.

## Task 2: Make the Historical Scope Migration Empty-Safe

- [x] Terminate the `apply_food_evidence_draft` function definition in `20260809020000_stated_carbohydrate_evidence.sql` and replay from empty state until the next migration is reached.
- [x] In `20260810140000_brand_scope.sql`, retain the invariant that no non-Korean brand is excluded.
- [x] Replace the exact count of six required rows with a check that any matching keep-target row that exists remains `in_scope = true`.
- [x] Re-run `pnpm exec supabase db start` and require all migrations to apply successfully.

The mutation caught by the replay is reintroducing a requirement that operational catalog rows exist during schema installation.

## Task 3: Repair Schema-Invalid pgTAP Fixtures

- [x] Add a unique `ko_name` to the brand inserts in `source_replacement_transaction_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `foods_publication_rls_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `source_refresh_provenance_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `food_research_runs_privileges_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `food_publication_transition_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `food_evidence_validation_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `research_apply_claim_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `research_claim_guard_test.sql`.
- [x] Add a unique `ko_name` to the brand inserts in `publication_precision_test.sql`.
- [x] Update source replacement cases to reuse the same URL when asserting `changed`, `unchanged`, and previous-capture retirement under the final URL-based uniqueness rule.
- [x] Run `pnpm exec supabase test db` and confirm the fixtures advance to privilege assertions rather than failing their brand inserts.

## Task 4: Pin the Data API Privilege Contract Before Implementing It

- [x] Add `data_api_privileges_test.sql` with literal `has_table_privilege`, `has_column_privilege`, and `has_sequence_privilege` assertions.
- [x] Assert public catalog reads for `anon` and `authenticated` on `brands`, `foods`, `recalls`, and `prices`.
- [x] Assert authenticated CRUD reachability on `cats` and `feeding_logs`, plus identity-sequence usage for inserts.
- [x] Assert service-role access used by the repository: read/insert/update for `brands`, `foods`, `recalls`, and `food_sources`; evidence reads; research-run reads/inserts; and required identity-sequence usage.
- [x] Assert `anon` and `authenticated` remain denied on the private source, evidence, research-run, and rate-limit tables.
- [x] Extend `food_research_runs_privileges_test.sql` with a service-role `status` column-update assertion while asserting another research-run column is not updateable.
- [x] Run the two privilege tests and verify RED before creating the forward migration.

The mutations caught by these tests are a missing grant that makes a legitimate Data API path fail, a broadened research-run update grant, or accidental public reachability of a private ledger.

## Task 5: Add the Minimum Forward Privilege Migration

- [x] Create the migration with `pnpm exec supabase migration new data_api_privileges`.
- [x] Grant public catalog table reads to `anon` and `authenticated`.
- [x] Grant authenticated CRUD on owner-scoped `cats` and `feeding_logs`, plus `USAGE` on their identity sequences.
- [x] Grant the service-role table and sequence privileges exercised by current routes, repositories, and scripts.
- [x] Revoke table-wide `UPDATE` on `food_research_runs` from `service_role`, then grant `UPDATE (status)` only.
- [x] Re-run the focused privilege tests and verify GREEN.

## Task 6: Prove Cross-User Ownership Isolation

- [x] Add `owner_data_rls_test.sql` with two real `auth.users`, one cat per user, one published food, and one feeding log per cat.
- [x] Assert the active authenticated user has table reachability before testing row behavior.
- [x] Prove the active user sees only their cat and feeding log.
- [x] Prove attempts to insert another owner's cat or feeding log fail with RLS.
- [x] Prove attempts to update or delete another owner's cat or feeding log affect zero rows.
- [x] Run the focused owner-data test and perform a mutation check by temporarily weakening one ownership predicate, verifying the test fails, and restoring the policy.

## Task 7: Replay, Run All pgTAP, and Regenerate Types

- [x] Stop the local stack, then run a fresh `pnpm exec supabase db start` so the entire migration history is replayed from empty state.
- [x] Run `pnpm exec supabase test db` and require every pgTAP file to pass.
- [x] Generate types with `pnpm exec supabase gen types --local --lang typescript` into `src/types/supabase.d.ts`.
- [x] Inspect the generated declaration for `brands.in_scope`, `brands.ko_name`, the final `apply_food_evidence_draft`, `publish_food_draft`, and `replace_current_food_source` signatures.
- [x] Run `pnpm typecheck` to prove the application accepts the generated contract.

## Task 8: Full Verification and Review

- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.
- [x] Run `trunk check` on the exact changed SQL, TypeScript declaration, plan, and previously approved first-stream paths.
- [x] Run `git diff --check`.
- [x] Request a structured review of the complete branch diff, fix only concrete in-scope findings, and repeat the affected verification.
- [x] Stop the local Supabase stack after verification.

## Verification Record

- `pnpm exec supabase db reset --local` exited 0 after replaying every migration through `20260813015150_data_api_privileges.sql` from empty state.
- `pnpm exec supabase test db` passed 12 pgTAP files and 170 tests.
- The owner-data mutation check failed after temporarily weakening the final `cats` ownership predicate, then passed after restoring the predicate and replaying migrations.
- `pnpm test` passed 39 Vitest files and 284 tests.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` exited 0.
- `trunk check` checked the 26 explicit tracked and untracked paths with no new issues; it reported 10 pre-existing issues.
- `git diff --check` exited 0.
- The structured implementation review found no functional correctness issue and requested only this durable verification record before clearing its evidence gate.
- `pnpm exec supabase stop --no-backup` stopped only project `lxqjxhfopltvwvuszjwf`; the temporary local DB port override was restored and is absent from the diff.
