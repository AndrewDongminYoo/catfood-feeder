# Issue39 implementation plan

## Direction

The operator directly invoked pr-loop39, superseding the earlier security-review start condition.
Keep PR68 connector polling stopped.
Normalize invalid measured provenance rather than blocking otherwise valid partial catalog drafts.
Oracle precedent confirms separating stated, derived, estimated and unknown values, including direct Korean-label NFE without moisture.

## Steps and checks

1. Add direct-route insert-payload regressions and publication preparation cases, then observe the old tag decision fail.
2. Pass the actual stated carbohydrate value into the existing direct-route provenance helper.
3. Normalize missing stated values in both paths and clear the carb tag when calculation is impossible.
4. Verify both measured source regimes, explicit zero, ash fallback and human/automation behavior.
5. Check applicable BLUEPRINT, AGENTS, CLAUDE and README claims without unrelated edits.
6. Run focused tests, mutation proof, full pnpm test, typecheck, lint, Knip, scoped Trunk and production build.
7. Complete the required scoped local review, commit one coherent fix, push and open a PR closing issue39.
8. Observe required current-head hosted reviews and CI, then merge the exact verified head under the invocation authority.

## Scope

Own src/app/api/foods/route.ts, its new route.test.ts, src/lib/food-publication.ts, its existing test file, and these spec/plan documents.
Do not introduce a shared abstraction, dependency, migration, legacy-data rewrite or visual change.
Branch cleanup and memory recording were not requested.
