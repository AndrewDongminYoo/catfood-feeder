# Issue47 implementation plan

## Approved scope

The operator invoked pr-loop for issue47.
Use the current workspace and reuse the existing broker URL validation policy.
Oracle retrieval failed before search, so this plan relies on current repository code rather than claimed precedent.

## Steps

1. Add runner subprocess regressions for blank broker values and invalid model values, then observe their intended failure.
2. Make getBrokerBaseUrl accept an optional environment object and add a pure runner configuration parser.
3. Add pure parser cases for missing, blank, trimmed, valid and malformed settings.
4. Update .env.example and scripts/README.md, and check applicable README, AGENTS and CLAUDE claims.
5. Verify focused tests, the full suite, typecheck, lint, Knip, scoped Trunk and production build.
6. Review the final diff, commit by concern, push and open a PR closing issue47.
7. Observe exact-head CI and required hosted reviews, repair confirmed findings within scope, and merge only after all gates pass.

## Verification

The subprocess reader observes a synthetic fetch boundary and cannot contact the network.
The pure parser reader checks normalized outputs and validation errors against literal fixtures.
Project gates use pnpm test, pnpm typecheck, pnpm lint, pnpm exec knip and pnpm build.
No cleanup or memory recording was requested for this loop.
