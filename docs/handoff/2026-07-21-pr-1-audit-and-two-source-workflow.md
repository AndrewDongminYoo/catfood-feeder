# PR #1 audit and two-source workflow handoff — 2026-07-21

## Outcome

PR [#1](https://github.com/AndrewDongminYoo/catfood-feeder/pull/1) contains the full-codebase audit fixes and the authenticated two-source workflow has now passed against the linked production Supabase project.
The branch is `fix/audit-2026-07-21`.

## Live workflow evidence

The test product was DRAFT `#197 내추럴발란스 캣 팻캣 닭&연어 저칼로리 고양이 6.8kg`.
The manufacturer page was registered as fetched source `#3`, extracted, and applied first with protein 35%, fat 9.5%, fiber 9%, moisture 10%, and 3,200 kcal/kg.
The Korean importer page and supplied label image were transcribed manually and registered as fetched source `#4`.
Extracting both current sources produced the five manufacturer-backed overlaps plus calcium 0.9% and phosphorus 0.8% from the Korean label.
The second apply completed without rollback.

The Supabase SQL Editor confirmed:

- Manufacturer-backed values and evidence still point to source `#3`.
- `calcium_pct = 0.9` and `phosphorus_pct = 0.8` point to KR-label source `#4`.
- Exactly seven current evidence rows exist for the seven persisted nutrients.
- `ash_pct` remains `NULL` because neither source supplied ash.
- `data_verified_at` remains `NULL`, so the product is still a DRAFT.

This proves the updated `apply_food_evidence_draft` behavior on the real authenticated UI path: already-populated nutrients are skipped and later source-only nutrients persist.

## Additional runtime findings fixed

- `/api/foods/drafts` returned only the first 100 DRAFT rows, which made product `#197` impossible to select.
  The cap is now 1000; searchable server-side selection remains deferred with the curator workspace UI.
- IPv4-translatable IPv6 addresses such as `::ffff:0:127.0.0.1` are reduced through the IPv4 deny rules.
- Nutrient sentences ending in punctuation, such as `조단백질 36.0% 이상.`, no longer become `null` because of a second period.

## Remaining scope

The authoritative open list is in [the audit note](../notes/2026-07-21-full-codebase-audit.md#still-open).
The next product-facing PR should cover the transcript viewer, failed-source list, retry/replace UI, searchable DRAFT picker, and the deferred component test.
Database follow-ups remain the non-transactional `replaceCurrentFoodSource`, DNS rebinding TOCTOU, minimum excerpt length, and the `food_sources.kind` type mismatch.

## Verification contract

Before merging or extending this branch, run:

```bash
CI=true pnpm typecheck
CI=true pnpm lint
CI=true pnpm test
CI=true pnpm exec knip
trunk check
CI=true pnpm build
```

Do not call the workflow verified from SQL inspection alone.
The decisive evidence is the real browser sequence above plus the final database query linking each nutrient to its source.
