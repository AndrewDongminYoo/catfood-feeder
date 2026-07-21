# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-21
**Commit:** e317ecf
**Branch:** main

## OVERVIEW

Catfood Admin is a mobile-first Next.js App Router application for curated, source-tagged imported cat-food nutrition data and feeding records.
The core asset is human-verified nutrient data, not price crawling.

## STRUCTURE

```plaintext
catfood-feeder/
├── src/app/                 # App Router pages, API routes, and auth routes
├── src/components/          # Client-side catalog, feeding, and auth UI
├── src/lib/                 # Domain rules, data access, authorization, Supabase clients
├── supabase/                # Local Supabase config and ordered schema migrations
├── scripts/                 # Pet Friends catalog ingest
├── docs/                    # ADR, investigation notes, and plans
├── BLUEPRINT.md             # Authoritative product and domain decisions
└── CLAUDE.md                # Detailed implementation guidance and commands
```

## WHERE TO LOOK

| Task                               | Location                            | Notes                                                       |
| ---------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Domain calculations and validation | `src/lib/domain.ts`                 | Shared by server and client.                                |
| Catalog reads and offline fallback | `src/lib/catalog.ts`                | Uses `react.cache`; fixtures apply without Supabase config. |
| Nutrition extraction               | `src/lib/source-extraction.ts`      | The only Anthropic caller; routes adapt payloads to it.     |
| Catalog writes                     | `src/app/api/foods/route.ts`        | Curator authorization, source validation, and admin client. |
| Auth and session refresh           | `src/lib/supabase/`, `src/proxy.ts` | Select client by trust boundary.                            |
| Database changes                   | `supabase/migrations/`              | Ordered migrations are the schema source of truth.          |
| Catalog ingest                     | `scripts/README.md`                 | Writing is the default; pass `--dry` for a dry run.         |
| Product decisions                  | `BLUEPRINT.md`                      | Read before changing domain logic or scope.                 |

## CODE MAP

| Symbol                | Type                  | Location                         | Refs         | Role                                                     |
| --------------------- | --------------------- | -------------------------------- | ------------ | -------------------------------------------------------- |
| `computeDerived`      | function              | `src/lib/domain.ts`              | [UNMEASURED] | Computes NFE, energy ratios, and Ca:P.                   |
| `validate`            | function              | `src/lib/domain.ts`              | [UNMEASURED] | Produces blocking errors and warnings for nutrient data. |
| `getFoods`            | cached async function | `src/lib/catalog.ts`             | 9 imports    | Catalog read model and fixture fallback.                 |
| `getFeedingDashboard` | async function        | `src/lib/feeding.ts`             | 2 imports    | User-scoped feeding data and insights.                   |
| `authorizeCurator`    | async function        | `src/lib/admin-auth.ts`          | 2 imports    | Human curator or automation authorization boundary.      |
| `updateSession`       | async function        | `src/lib/supabase/middleware.ts` | 1 import     | Cookie refresh and `/new` route gate.                    |

Reference centrality is not measured because this session has no LSP or codegraph surface.

## CONVENTIONS

- Keep Korean UI strings and comments in Korean.
- Keep identifiers and commit messages in English.
- Use the `@/*` alias for `src/*` imports.
- Keep route literals compatible with enabled `typedRoutes`.
- Use Tailwind v4 through `src/app/globals.css`; add shadcn-style primitives under `src/components/ui`.
- Use `pnpm` as pinned by `package.json`.

## ANTI-PATTERNS (THIS PROJECT)

- Do not replace `pnpm dev` with plain `next dev`; the webpack fallback is intentional until its ADR criteria are met.
- Do not silently mix measured, estimated, or derived nutrient values.
- Do not trust an extraction value that lacks literal source evidence.
- Do not call Anthropic from a client component or expose `ANTHROPIC_API_KEY` with a `NEXT_PUBLIC_` prefix.
- Do not use the Supabase service-role client in browser or client-component code.
- Do not treat price crawling or Korean recall syncing as current scope.

## UNIQUE STYLES

- The ACANA Grasslands fixture drives `src/lib/fixtures.test.ts`, the regression case for domain math.
- Public catalog routes remain usable without Supabase configuration through sample fixtures.
- API routes own authorization even though `/new` is protected by the proxy.
- Catalog verification is represented by `data_verified_at`; the ingest writes drafts without setting it, and `apply_food_evidence_draft` refuses to touch rows where it is set.

## COMMANDS

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
pnpm exec knip
trunk check
trunk fmt
```

## NOTES

- `pnpm test` runs Vitest over `src/**/*.test.ts`; `src/lib/source-first-boundary.test.ts` guards the source-first boundary.
- Regenerate `src/types/supabase.d.ts` with the Supabase CLI after applying migrations; never hand-edit it.
- Run Supabase migrations through the Supabase CLI against the linked project; do not hand-edit generated database state.
- The build uses Turbopack, while development deliberately uses webpack.
