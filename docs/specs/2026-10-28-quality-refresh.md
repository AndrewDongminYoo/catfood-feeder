# Quality Tooling Refresh

## Approved Scope

Refresh supported dependencies and existing quality tooling.
Preserve public APIs, generated artifacts and repository-specific boundaries.

## Acceptance

- Pinact remains locked to `4.1.1` with `lint` and `upgrade`.
- The full no-fix Trunk scan and declared project gates pass.
- Changed manifests have package-manager-generated lockfiles under repository policy.
- Advisory dispositions have specific evidence and affected knowledge claims are reconciled.
- TruffleHog preserves its target sandbox and runs with `--no-verification --no-update` using a local filesystem SARIF reader that retains decoded findings and rejects malformed records.
- The reader is copied through `direct_configs` and has independent standard-library tests in app CI; workflow filters include `.trunk/**` changes.
- Checkov uses `3.4.0`, published during the batch maintenance run.
- TypeScript stays on 6.x while the current TypeScript ESLint peer range is `>=4.8.4 <6.1.0`.
- Undici stays on the latest 7.x because its consumers pass v1 dispatchers to the Node.js built-in `fetch`; an 8.x migration needs a separately scoped dispatcher adaptation.

## Verification Boundaries

Run the existing mock and fixture tests without live provider access.
The maintenance production build uses `pnpm exec next build` with application credential variables cleared and no Next.js dotenv files present.
It exercises the same underlying Next.js production build as `pnpm build`, without executing the external secrets loader.
It does not verify configured Supabase or Anthropic integrations.

Direct npm audit and OSV checks must read the generated `pnpm-lock.yaml`.
Remove stale security overrides only after the natural dependency graph is inspected and scanned.
Retain separate selectors for incompatible major lines when an override remains necessary.

## Advisory Disposition

`deepmerge@4.3.1` is affected by [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), and the advisory lists no patched release.
It is reached through the production-declared `shadcn@4.23.0` CLI and `@shadcn/registry@0.2.1`; these dependencies are not classified as development-only.
The current `src` and `scripts` sources have no observed imports of either package, and the declared application and verification commands do not invoke the CLI.
Crafted null-prototype merge inputs still reproduce returned-object prototype poisoning in the installed library, so this issue is accepted under the maintenance scope rather than fixed.
The scoped OSV disposition belongs beside `pnpm-lock.yaml` and must not suppress unrelated advisories.
AndrewDongminYoo owns re-evaluation when a patched release appears, either parent dependency changes, an application consumer is added, or untrusted CLI input is introduced.

## Publication

Push and PR creation require explicit repository-specific approval.
After approval, continue the requested hosted gates, merge, cleanup and memory recording.

## Credential-free build evidence

The operator confirmed a private runtime input in the original home checkout.
Do not run the secrets-loading build or the direct Next build in that checkout for maintenance verification.
Use a separate source snapshot containing only the declared application/configuration paths and the generated lockfile, with a separate HOME and an allowlisted environment.
The fixture excludes private runtime files by construction and does not invoke `scripts/with-secrets.mjs`.
The resulting direct Next build validates the current application source and dependency graph, not configured provider integrations.

## Source-context verification

The filesystem reader has 17 standard-library regressions.
Each source read is capped at 1 MiB plus a sentinel byte; the cache retains eight source files.
Total JSONL input, result count, offset records, process memory and read time are not bounded by those limits.
Trunk uses `--monitor=false`, including hooks, and each one-off daemon is stopped from its exact checkout.

## Release-age hold

Keep Knip `6.43.0` while `6.44.0`, published at `2026-10-29T19:44:31.362Z`, is inside pnpm’s 24-hour release-age gate.
Do not carry an automatically added `minimumReleaseAgeExclude` entry into the candidate.
Re-evaluate after the age requirement is met; the fixture and candidate workspace policy must remain byte-identical.
