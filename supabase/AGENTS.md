# SUPABASE KNOWLEDGE

## OVERVIEW

`supabase` contains local CLI configuration and the ordered Postgres migrations that define the application schema and access controls.

## WHERE TO LOOK

| Task                                | Location                                                                   | Notes                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Base schema and RLS                 | `migrations/0001_init.sql`                                                 | Defines the original catalog policies; cats and feeding logs are owner-scoped.                                                                |
| Remote reconciliation and hardening | `migrations/0002_reconcile_remote.sql`                                     | Aligns remote policy/index state with the intended baseline.                                                                                  |
| External catalog identity           | `migrations/0003_foods_external_source.sql`                                | Stable `(source, external_id)` ingest identity.                                                                                               |
| Catalog integrity                   | `migrations/0004_catalog_integrity.sql`                                    | Constraints and generated Ca:P ratio.                                                                                                         |
| Extraction quota                    | `migrations/0006_extraction_rate_limit.sql`                                | Service-role-only RPC and rate-limit table.                                                                                                   |
| Source and evidence ledger          | `migrations/20260715151932_food_source_ledger.sql`                         | Curator-only source captures, field evidence, and DRAFT apply RPC.                                                                            |
| Evidence apply semantics            | `migrations/20260721022014_fix_evidence_apply_semantics.sql`               | Skips populated nutrients and aligns evidence normalization.                                                                                  |
| Retired research state and indexes  | `migrations/20260721022500_retire_research_columns_and_add_fk_indexes.sql` | Drops obsolete food-level research columns and adds FK indexes.                                                                               |
| Evidence normalization              | `migrations/20260721074238_align_evidence_trim_after_nfkc.sql`             | Applies NFKC, whitespace collapse, and trim in the RPC.                                                                                       |
| Source refresh outcomes             | `migrations/20260721121348_source_refresh_provenance.sql`                  | Returns applied, skipped, and conflict results.                                                                                               |
| Evidence precision                  | `migrations/20260721131159_compare_evidence_precision.sql`                 | Compares refresh values against exact evidence rather than rounded food fields.                                                               |
| Evidence-only refresh               | `migrations/20260721133137_evidence_only_equal_refresh.sql`                | Keeps equal same-kind refreshes from touching the food row.                                                                                   |
| Verified catalog visibility         | `migrations/20260721142248_restrict_public_foods_to_verified.sql`          | Superseded: first gated reads on `data_verified_at`.                                                                                          |
| Verified feeding references         | `migrations/20260721231454_restrict_feeding_logs_to_verified_foods.sql`    | Prevents owner writes from referencing hidden DRAFT foods.                                                                                    |
| Publication state and human publish | `migrations/20260805105048_separate_food_publication_state.sql`            | Splits `published_at` from `data_verified_at`; public reads now gate on the former, and `publish_food_draft` requires a non-null human actor. |
| Research run ledger                 | `migrations/20260806111500_food_research_runs.sql`                         | Private agent-proposal ledger; RLS on with no policy, service-role only.                                                                      |

## CONVENTIONS

- Add schema changes as a new, ordered migration; do not revise an applied migration.
- Treat `supabase/migrations/` as the schema source of truth.
- Apply migrations with the Supabase CLI against the linked project.
- Keep `nutrient_sources` aligned with the `Source` union in `src/lib/domain.ts`.
- Verify RLS, function security, and grants whenever tables or RPC functions change.

## ANTI-PATTERNS

- Do not relax RLS or grant service-role capabilities to `anon`, `authenticated`, or `public` without an explicit security decision.
- Do not expose JWT signing keys, provider secrets, or other credentials in committed config.
- Do not replace owner-scoped `cats` and `feeding_logs` policies with public access.
- Do not make automated research output appear human-verified or published by setting `data_verified_at`, `published_at`, `published_by`, or `verification_method`; only `publish_food_draft`, called with a human actor, may set them.
