# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-21

## OVERVIEW

Catfood Feeder is a mobile-first Next.js App Router product that helps an owner choose the next imported dry cat food using explicit conditions and source-backed comparison briefs.
`/` enters the decision workspace at `/advisor`; catalog, research, and feeding surfaces support that decision.
The product must complete a useful question-to-brief flow before asking the operator to run interviews or sell it.
`docs/product-direction.md` owns the product direction; issue lists are backlogs, not strategy.
Copy voice: warm.

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

| Task                               | Location                                | Notes                                                          |
| ---------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| Consumer decision engine           | `src/lib/food-decision.ts`              | Conditions, evidence gates, snapshots, and export.             |
| Consumer question and brief UI     | `src/components/decision-workspace.tsx` | Owner input, comparison, local saved decisions.                |
| Question interpretation            | `src/app/api/advisor/question/`         | Bounded proposals, editable conditions, no catalog writes.     |
| Ingredient evidence projection     | `src/lib/decision-catalog.ts`           | Server-only; public IDs and matching current sources only.     |
| Domain calculations and validation | `src/lib/domain.ts`                     | Shared by server and client.                                   |
| Catalog reads and offline fallback | `src/lib/catalog.ts`                    | Uses `unstable_cache`; fixtures apply without Supabase config. |
| Nutrition extraction               | `src/lib/source-extraction.ts`          | The only Anthropic caller; routes adapt payloads to it.        |
| Catalog writes                     | `src/app/api/foods/route.ts`            | Curator authorization, source validation, and admin client.    |
| Auth and session refresh           | `src/lib/supabase/`, `src/proxy.ts`     | Select client by trust boundary.                               |
| Database changes                   | `supabase/migrations/`                  | Ordered migrations are the schema source of truth.             |
| Catalog ingest                     | `scripts/README.md`                     | Writing is the default; pass `--dry` for a dry run.            |
| Product decisions                  | `BLUEPRINT.md`                          | Read before changing domain logic or scope.                    |

## CODE MAP

| Symbol                | Type                  | Location                         | Refs         | Role                                                     |
| --------------------- | --------------------- | -------------------------------- | ------------ | -------------------------------------------------------- |
| `computeDerived`      | function              | `src/lib/domain.ts`              | [UNMEASURED] | Computes NFE, energy ratios, and Ca:P.                   |
| `validate`            | function              | `src/lib/domain.ts`              | [UNMEASURED] | Produces blocking errors and warnings for nutrient data. |
| `getFoods`            | cached async function | `src/lib/catalog.ts`             | [UNMEASURED] | Catalog read model and fixture fallback.                 |
| `getFeedingDashboard` | async function        | `src/lib/feeding.ts`             | [UNMEASURED] | User-scoped feeding data and insights.                   |
| `authorizeCurator`    | async function        | `src/lib/admin-auth.ts`          | [UNMEASURED] | Human curator or automation authorization boundary.      |
| `updateSession`       | async function        | `src/lib/supabase/middleware.ts` | [UNMEASURED] | Cookie refresh and `/new` route gate.                    |

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
- Do not silently relax an owner condition, infer ingredient absence from missing data, or present label exclusions as allergy safety.
- Do not advertise local snapshots and manual rechecks as automatic monitoring.
- Keep legacy `/advisor?current=...` links compatible; the default workspace is the consumer product.

## UNIQUE STYLES

- The ACANA Grasslands fixture drives `src/lib/fixtures.test.ts`, the regression case for domain math.
- Public catalog routes remain usable without Supabase configuration through sample fixtures.
- API routes own authorization even though `/new` is protected by the proxy.
- Public catalog visibility is represented by `published_at`; verification is a separate column, `data_verified_at`. The ingest writes drafts without setting either, and `apply_food_evidence_draft` refuses to touch rows where `data_verified_at` is set.

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

- `pnpm test` runs Vitest over `src/**/*.test.{ts,tsx}`. `src/lib/source-first-boundary.test.ts` guards that the server never searches the web itself and that the research runner reaches the database only through the broker; `src/lib/research-boundary.test.ts` guards the research credential and the out-of-repo secrets path.
- Regenerate `src/types/supabase.d.ts` with the Supabase CLI after applying migrations; never hand-edit it.
- Run Supabase migrations through the Supabase CLI against the linked project; do not hand-edit generated database state.
- The build uses Turbopack, while development deliberately uses webpack.
