# Application CI Implementation Plan

**Goal:** Add a reproducible GitHub Actions quality gate for application changes while keeping Supabase migration and pgTAP validation in the existing database workflow.

**Architecture:** Use one application-only workflow with explicit path filters and read-only repository permissions. Resolve the repository-pinned pnpm version through `pnpm/action-setup`, run Node.js 24 to match the verified development runtime, install the existing lockfile without mutation, and execute the repository's declared lint, typecheck, test, and production-build scripts in order.

**Tech Stack:** GitHub Actions, Node.js 24, pnpm 11.15.1, ESLint, TypeScript, Vitest, and Next.js 16.

## Constraints

- Do not change `.github/workflows/db-tests.yml` or combine application and database jobs.
- Use immutable full commit SHAs for third-party actions.
- Do not add dependencies or modify the package manifest or lockfile.
- Do not provide application secrets; `scripts/with-secrets.mjs` intentionally continues when its external secret file is absent.
- Do not stage, commit, or push until the operator explicitly requests it.

## Success Criteria

1. Application and workflow changes trigger `.github/workflows/app-ci.yml`, while Supabase-only changes remain owned by `db-tests.yml`.
2. The job runs a frozen pnpm install followed by lint, typecheck, Vitest, and the production build.
3. Actionlint, Pinact, YAML validation, the frozen install, and every application command pass locally.
4. The package manifest, lockfile, and database workflow are unchanged.

## Tasks

- [x] Create the separate application workflow with explicit application path filters.
- [x] Pin checkout, pnpm setup, and Node setup actions to immutable commits.
- [x] Validate the workflow with the configured Trunk linters.
- [x] Run the frozen install and all four application quality commands.
- [x] Record the exact verification results and confirm that no unrelated files changed.

## Verification Record

- `trunk check --no-fix .github/workflows/app-ci.yml docs/plans/2026-08-13-application-ci.md` checked both files with no issues after Actionlint rejected a YAML alias in `push.paths` and the workflow was corrected to use an explicit sequence.
- `pnpm install --frozen-lockfile` completed with pnpm 11.15.1 and reported that the lockfile installation was already up to date.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed 39 files and 284 tests.
  The pre-existing Vite native-config and PostCSS module-format warnings remain tracked by Task 6.2.
- `pnpm build` completed the Next.js 16.2.11 Turbopack production build.
- A second build in a secret-free temporary copy was not established: Turbopack rejected an external `node_modules` symlink, and a replacement offline install lacked one cached package tarball.
  Neither failure reached application compilation, and neither is counted as successful verification.
- The final explicit-path `trunk check --no-fix` checked all 28 changed and untracked files with no new issues; it reported 10 pre-existing issues.
- `git diff --check` passed.
- `.github/workflows/db-tests.yml`, `package.json`, `pnpm-lock.yaml`, `supabase/config.toml`, and `supabase/migrations/0002_reconcile_remote.sql` have no diff.
- The GitHub-hosted run remains pending until this uncommitted workflow is pushed or opened in a pull request.
