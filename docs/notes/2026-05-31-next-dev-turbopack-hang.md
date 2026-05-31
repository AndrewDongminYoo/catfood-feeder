# Next Dev Turbopack Hang Note

Date: 2026-05-31
Status: Open

## Summary

`pnpm build` succeeds, but the default `pnpm dev` path was not usable for local development. The immediate workaround is to run the Next.js dev server with webpack instead of the default Turbopack dev server.

## Observed Behavior

- `package.json` originally had `dev: next dev`.
- `next dev` started Next.js 16.2.6 with Turbopack and printed `Ready`.
- The first request to `/` stayed open without receiving a response.
- CPU usage increased quickly while the request was pending.
- `next dev --webpack` served `/` successfully.

## Evidence Captured

```plaintext
$ pnpm dev
$ next dev
Next.js 16.2.6 (Turbopack)
Ready in 152ms
Compiling / ...
```

```plaintext
$ curl --max-time 12 -v http://localhost:3000
Connected to localhost (::1) port 3000
GET / HTTP/1.1
Operation timed out after 12005 milliseconds with 0 bytes received
```

```plaintext
$ pnpm exec next dev --webpack -p 3001
Next.js 16.2.6 (webpack)
Ready in 212ms
GET / 200 in 1897ms
```

```plaintext
$ curl --max-time 20 -I http://localhost:3000
HTTP/1.1 200 OK
```

## Environment Notes

- The Codex sandbox blocked local port binding with `listen EPERM: operation not permitted 0.0.0.0:3000`.
- Running the dev server outside the sandbox allowed the server to bind normally.
- The sandbox `EPERM` is separate from the Turbopack hang: after the server was allowed to bind, Turbopack still hung while compiling `/`.

## Current Workaround

`package.json` now uses:

```json
"dev": "next dev --webpack"
```

This keeps local development usable while the Turbopack behavior remains unresolved.

## Open Question

Is the Turbopack hang a transient Next.js 16.2.6 issue, a dependency interaction, a font/CSS compilation issue, or a local machine/environment issue?
