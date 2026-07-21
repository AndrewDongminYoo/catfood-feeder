# ADR: Use Webpack For Local Next Dev Server

Date: 2026-05-31
Status: Accepted

## Context

The workaround was accepted after reproducing the issue on Next.js 16.2.6: `next dev` started with Turbopack, reached the `Ready` state, and then hung on the first `/` request while CPU usage increased quickly.

The project now pins Next.js 16.2.10, but the reversal criteria below have not been rerun on that version. The workaround remains active pending that recorded retest.

`pnpm build` is not affected by this issue, and `next dev --webpack` served the app successfully.

## Decision

Use webpack for the local dev server until the Turbopack hang is understood.

Implementation:

```json
{
  "scripts": {
    "dev": "next dev --webpack"
  }
}
```

## Scope

In scope:

- Change only the local development command.
- Preserve the existing `build`, `start`, `lint`, and `typecheck` scripts.
- Document that the workaround is temporary.

Out of scope:

- Downgrading Next.js.
- Changing app code to fit a suspected bundler issue before root cause is known.
- Replacing `next/font`, Tailwind, or PostCSS without a focused reproduction.

## Consequences

Positive:

- `pnpm dev` opens the project reliably for local development.
- The workaround is reversible and limited to one script.

Negative:

- Local development no longer exercises Turbopack.
- A future Turbopack fix will not be noticed unless we explicitly retest it.

## Reversal Criteria

Revert `dev` to `next dev` only after all of these are true:

- `pnpm exec next dev -p 3001` serves `/` with `HTTP/1.1 200 OK`.
- CPU usage does not spike during the first page compile.
- `/new` also loads successfully.
- The tested Next.js, Node.js, pnpm, and OS versions are recorded in `docs/notes/`.

## Verification

Current workaround verification:

```plaintext
pnpm dev
curl --max-time 20 -I http://localhost:3000
```

Expected result:

```plaintext
HTTP/1.1 200 OK
```
