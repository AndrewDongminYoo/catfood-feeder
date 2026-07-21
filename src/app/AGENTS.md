# APP ROUTER KNOWLEDGE

## OVERVIEW

`src/app` contains App Router pages, route handlers, authentication endpoints, and the shared layout.

## WHERE TO LOOK

| Task                   | Location                                                                         | Notes                                                             |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Public catalog         | `foods/`, `compare/`, `recalls/`                                                 | Data comes from `@/lib/catalog`.                                  |
| Feeding experience     | `feeding/`, `api/cats/`, `api/feeding-logs/`                                     | User-scoped Supabase data.                                        |
| Curator workflow       | `new/`, `new/research/`, `api/extract/`, `api/foods/`, `api/foods/[id]/sources/` | Source capture and extraction precede validated catalog creation. |
| Recall synchronization | `api/recalls/sync/route.ts`                                                      | Protected cron endpoint.                                          |
| Login lifecycle        | `auth/`                                                                          | Callback, login page, and logout handler.                         |
| Session gating         | `../proxy.ts`                                                                    | Refreshes sessions and gates `/new`.                              |

## CONVENTIONS

- Keep page route strings compatible with `typedRoutes`.
- Keep public catalog routes public; `/new` is the proxy-protected curator route.
- Enforce API authorization inside each route handler.
- Use `authorizeCurator` before extraction or catalog write work.
- Return Korean user-facing messages from existing API and UI flows.

## ANTI-PATTERNS

- Do not import `@/lib/supabase/admin` into client components.
- Do not move Anthropic extraction to a client-side path.
- Do not let extraction-derived values bypass the validation in `api/foods`.
- Do not remove evidence checks, request-body limits, or extraction quotas from `api/extract`.
