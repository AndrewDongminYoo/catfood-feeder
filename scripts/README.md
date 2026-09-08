# Catalog ingestion & research-agent pipeline

Two-phase pipeline that turns an external product list into the project's core asset (human-verified, source-tagged nutrient data).

## Where credentials live

**Secrets live outside the repository, at `$HOME/.config/catfood-feeder/env` (mode 600).**
`scripts/with-secrets.mjs` is the single loader: package scripts run through it (`node scripts/with-secrets.mjs next dev --webpack`), and the `.mjs` scripts import its `loadSecrets()` directly.
It uses `process.loadEnvFile` rather than `node --env-file`, because Next propagates the parent's `execArgv` into its Workers' `NODE_OPTIONS`, where `--env-file` is rejected outright.
A missing file is tolerated so platform-provided environments (Vercel) still build.

The reason is the research runner: its `codex` child runs under a read-only sandbox, and read-only restricts writes, not reads.
An agent following instructions injected into a product page would look for a dotenv file at the repository root first, so there is nothing there to find.
The runner also copies only `auth.json` into an ephemeral `CODEX_HOME`; it never gives the child the operator's real home path, from which the fixed secrets path could be derived.
The staged file is a byte copy with a distinct inode, so filesystem searches cannot use it to rediscover the operator's credential path.
Because a copy does not need the credential's filesystem, the workdir is always created under the system temp root — never beside the credential, whose sibling entries a read-only child could still read.
The system temp root is resolved before use and rejected when it is inside the operator's real `HOME`.
The runner also stages the resolved `codex` executable under the workdir and gives the child only that directory plus system binary directories in `PATH`, so home-scoped package-manager paths do not disclose the operator's home.
That executable is copied rather than hard-linked for the same reason as the credential: a shared inode is a searchable handle back to the original path, which for a home-scoped install is the operator's home.
Nothing staged into the workdir shares an inode with a file the operator owns.
This runner therefore requires Codex's file credential store; a keyring-only login is rejected with an explicit error because an isolated `CODEX_HOME` hashes to a different keyring entry.
The child also forces `cli_auth_credentials_store = "file"` on the command line because `--ignore-user-config` deliberately omits the operator's setting.
The copy is discarded with the workdir, so the parent compares it against the staging-time bytes afterwards and writes it back when the CLI refreshed the login; otherwise a rotated refresh token would be lost and the next run would fail to authenticate.
That write-back replaces the original only while it still holds those staging-time bytes, so a login another run or a `codex login` refreshed meanwhile is reported and left alone rather than rolled back to this run's older copy.
Only the parent knows the original path, and the read-only sandbox refuses the child every write into the workdir, so nothing the child controls can reach that write-back.
These measures shrink the exposure; they are not a same-UID filesystem boundary.
The boundary is a separate OS account or a container, which stays the next hardening step.
`src/lib/research-boundary.test.ts` pins that no package script reads an in-repo dotenv file.

## Phase A — `ingest-petfriends.mjs` (worklist)

Filters `pet-friends.json` to dry cat food (kg-weight >= 1, excluding wet/treat/sample), normalizes brand names, and inserts `brands` + `foods` skeleton rows (`brand` + `product_name` + `weight_kg`, no nutrients).
Prices are omitted per `BLUEPRINT.md` (pricing is deferred).
The skeleton rows are the **curation worklist** for the protected `/new/research` workflow.

```bash
node scripts/ingest-petfriends.mjs --dry   # preview, no writes
node scripts/ingest-petfriends.mjs         # ingest
```

Requires migration `0003_foods_external_source.sql` and is idempotent on `(source, external_id)`.
Rows created by the pre-0003 fallback have NULL identifiers and are skipped rather than guessed into a new source identity.

## Phase B — source-first curation

For a skeleton row, a human curator registers manufacturer or Korean-label product URLs in `/new/research`.
The server captures bounded source text, an LLM extracts candidates from that captured text only, and the curator explicitly applies evidence-backed values as a DRAFT.
The workflow leaves `data_verified_at` null until human verification.
Derived values remain server-derived.

## Phase B′ — `research-run.mjs` (local research agent)

The AI-native path for the same skeleton rows, added by `docs/notes/2026-08-05-ai-native-catalog-turnaround.md`.
A local Codex agent researches the public web and proposes source URLs, values, and literal excerpts; the server re-fetches every URL itself and re-verifies every excerpt before anything reaches a DRAFT.

```bash
pnpm dev                                  # the broker runs inside the app
pnpm research:run --food 123              # research one skeleton draft
```

Requires `RESEARCH_AGENT_SECRET` in `$HOME/.config/catfood-feeder/env`, a standalone `codex` executable, and a CLI login using `cli_auth_credentials_store = "file"`.
Optional: `RESEARCH_BROKER_URL` (default `http://localhost:3000`), `RESEARCH_AGENT_MODEL` (default `gpt-5.6-terra`).

What holds the boundary:

- `RESEARCH_AGENT_SECRET` opens **only** `/api/research/*`. No admin or publish route accepts it, and `src/lib/research-boundary.test.ts` pins that.
- The child `codex exec` process gets an allowlisted environment (`PATH` → a staged Codex executable plus system binary directories, `HOME` and `CODEX_HOME` → an empty temp dir, `LANG`, `TMPDIR`) and runs `--sandbox read-only --ephemeral --ignore-user-config` outside the repo. Only Codex's `auth.json` is staged into that temporary home; the child never receives the operator's real home path, broker secret, or any Supabase key.
- The target must be a **skeleton** draft: unpublished _and_ carrying no current source. An agent URL must never displace a curator's captured source. The broker checks this before fetching, and both the replacement RPC and the evidence-apply RPC re-check it inside their own row locks — capture and apply are separate transactions, so a curator registering a source in between must be caught at both points. A curator who claims the food mid-run wins the race and the run ends as `claim_conflict` having written no nutrient value.
- URLs from prior proposals are returned by `GET /api/research/foods/[id]` as "already tried" unless their latest outcome is retryable, so a re-run does not spend a research call on the same dead end.
  URLs from a claim conflict, broker error, or transient network capture failure stay retryable, and the next proposal records the prior run ID and retry reason.
- Each schema-valid proposal records the exact search queries, and each terminal ledger result records a structured reason.
- Every proposal whose envelope identifies a real target is appended to `food_research_runs`, including one refused by the proposal schema (`status: invalid`), so the next run does not re-research the same dead end. Only a request that fails the envelope's own shape, or names a food that is not a skeleton, is refused without a ledger row.
- A partial capture (manufacturer succeeds, importer page fails) still makes the row non-skeleton, so the agent path will not revisit it; register the missing half by hand in `/new/research`.
- Publication stays human-only. This path writes DRAFT nutrient values and never sets `published_at`.

## Retained-capture ingredient backfill

`measure-ingredient-tranche.mjs` selects candidate published foods from their current fetched captures without model calls and prints an explicit `foodId:sourceId` target list.
Review its samples for product identity before using that list; the comma-run heuristic alone does not prove that a captured list belongs to the target product.
`backfill-ingredients.mjs` sends only those explicit source IDs to the existing extraction boundary, paces calls below its request limit, and never performs new research or capture.

```bash
node scripts/measure-ingredient-tranche.mjs
pnpm ingredients:backfill --dry-run FOOD_ID:SOURCE_ID,...
pnpm ingredients:backfill FOOD_ID:SOURCE_ID,...
```

The dry-run still spends extraction quota and model budget, but it does not call the ingredient apply route.
Run a small dry-run and inspect the printed ingredient names before approving any non-dry production tranche.

## Review-first maintenance scripts

`release-stranded.mjs` previews current sources on unpublished foods that have no current nutrient or ingredient evidence.
An apply run requires the exact source IDs copied from that preview. A database RPC locks each food and rechecks the full source set before writing.

```bash
node scripts/release-stranded.mjs
node scripts/release-stranded.mjs --apply --source-ids 101,102
```

`research-brand-identity.mjs` previews brands with an unknown country.
An apply run requires the exact reviewed brand IDs. The write is rejected if any selected brand changed while the model was researching it.

```bash
node scripts/research-brand-identity.mjs --limit 20
node scripts/research-brand-identity.mjs --apply --brand-ids 4,9
```

## Reference data — `수입사료정리 - DB.csv`

The founder's 2023 curated nutrient sheet (~290 rows, English brand names).
It is a **reference / validation source, not a direct ingest source**: it has final nutrient values but **no per-field source tags**, so ingesting it would violate the measured-vs-estimated source-tagging invariant — and it is stale (BLUEPRINT says re-collect).
Use it to cross-check the source-first curation output, not to populate `nutrient_sources` directly.
