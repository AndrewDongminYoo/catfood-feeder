# Broker configuration implementation plan

1. Add a regression that imports curate-source before loading a temporary environment fixture, then inspects the actual stubbed fetch destinations.
2. Replace the eager BASE_URL capture with a shared validated resolver and call it after loadSecrets in all five entrypoints.
3. Add coverage for configuration precedence, origin validation, and CLI initialization before side effects.
4. Check README.md, CLAUDE.md, AGENTS.md, and scripts/README.md for implementation-caused drift; document the affected script configuration contract.
5. Run targeted and complete tests, typecheck, lint, build, and scoped formatting checks; review the complete candidate before semantic commits.
6. Push the scoped branch, open the PR, and complete hosted review and CI within the recorded budget; merge after all required gates pass under the operator's updated pr-loop authority.

## Owned paths

- scripts/curate-source.mjs
- scripts/curate-brand.mjs
- scripts/research-brand.mjs
- scripts/transcribe-brand.mjs
- scripts/research-missing.mjs
- src/lib/curation-broker-config.test.ts
- scripts/README.md
- This plan and its companion specification.

## Verification

Minimum regression command: pnpm test src/lib/curation-broker-config.test.ts.
Completion checks: pnpm test, pnpm typecheck, pnpm lint, pnpm build, and trunk check on the explicit changed paths.
The fetch regression inspects destinations and authentication headers without making network requests.
The CLI initialization tests inspect execution order and block side effects.
