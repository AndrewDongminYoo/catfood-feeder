# SHARED LIBRARY KNOWLEDGE

## OVERVIEW

`src/lib` holds the shared nutrient domain model, catalog and feeding data access, authorization, request limiting, formatting, fixtures, and Supabase clients.

## WHERE TO LOOK

| Task                     | Location                | Notes                                                    |
| ------------------------ | ----------------------- | -------------------------------------------------------- |
| Nutrient types and rules | `domain.ts`             | Shared server/client invariants.                         |
| Public catalog queries   | `catalog.ts`            | Cached reads with fixture fallback.                      |
| Feeding insights         | `feeding.ts`            | User-aware dashboard queries and transitions.            |
| Curator access           | `admin-auth.ts`         | Session email or timing-safe header secret.              |
| Extraction quota         | `request-rate-limit.ts` | Calls `consume_extract_quota` through Supabase REST RPC. |
| Supabase trust levels    | `supabase/`             | Server, browser, middleware, and admin clients.          |

## CONVENTIONS

- Keep `domain.ts` independent of Next.js server-only APIs because it is shared with client flows.
- Preserve `Source` values and field-level `nutrient_sources` metadata when adding nutrients.
- Run `computeDerived` and `validate` together for catalog writes.
- Keep catalog fallback behavior when public Supabase configuration is absent.
- Create Supabase SSR clients per request; do not place them in global state.

## ANTI-PATTERNS

- Do not treat `estimated` or `derived` data as manufacturer or Korean-label measurements.
- Do not calculate NFE when ash cannot be resolved.
- Do not override manufacturer-declared P/F/C energy ratios with a recalculation.
- Do not use `createAdminClient` for user-scoped reads or browser work.
- Do not weaken the timing-safe admin-secret comparison or database-backed quota boundary.
