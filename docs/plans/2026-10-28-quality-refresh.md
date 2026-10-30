# Quality Tooling Refresh Plan

## Work

1. Verify repository identity, instructions, current changes and Oracle precedent.
2. Refresh compatible dependency and linter versions with pinned pnpm 11.15.1, and inspect the regenerated graph before retaining security overrides.
3. Run the declared local gates, direct lockfile vulnerability scans, and `trunk check --all --no-fix --jobs=2 --monitor=false`.
4. Reconcile affected knowledge and review the scoped candidate.
5. Commit locally and prepare visible evidence before requesting publication approval.

## Declared Gates

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm exec next build`
- `trunk check --all --no-fix --jobs=2 --monitor=false`

The direct Next.js build runs in the public verification copy described below, with an allowlisted environment and a separate HOME.
Do not execute `scripts/with-secrets.mjs` or provider-backed maintenance scripts for this verification.
Prove TruffleHog's offline command with a synthetic canary and a clean control, and verify that both Pinact commands execute against the workflow files.
The reader follow-up adds decoded/literal/clean controls and CI regression tests, explicitly enables Pinact upgrade, and refreshes Checkov without changing application dependencies.
The operator confirmed private runtime input in the original checkout; the resumed public-copy procedure replaces the earlier presence-only precondition.

## Resumed build verification

Use an explicit public-source allowlist to create a disposable verification copy, preserving current source hashes and the generated lockfile.
Run fixed installation, lint, tests, typecheck and direct Next production build with a separate HOME and an allowlisted environment.
Keep logs in the surviving review directory and remove the owned fixture after validation and process checks.
Do not run the original checkout’s build or the secrets loader.
