# Plan: Investigate Turbopack Dev Hang

This plan exists so the webpack fallback does not become permanent by accident. The goal is to determine whether the Turbopack hang is a project bug, a framework bug, or a local environment issue.

## Success Criteria

- Reproduce or disprove the Turbopack hang with a clean command sequence.
- Identify the smallest trigger if the hang is project-specific.
- Decide whether to keep the webpack fallback, upgrade dependencies, or revert to Turbopack.
- Record the outcome in `docs/notes/`.

## Investigation Steps

1. Record local versions.

   ```plaintext
   node --version
   pnpm --version
   pnpm exec next --version
   sw_vers
   ```

2. Retest Turbopack on a different port with a timeout.

   ```plaintext
   pnpm exec next dev -p 3001
   curl --max-time 20 -I http://localhost:3001
   ```

3. Retest the webpack fallback as the control.

   ```plaintext
   pnpm exec next dev --webpack -p 3002
   curl --max-time 20 -I http://localhost:3002
   ```

4. If Turbopack still hangs, isolate likely compile triggers one at a time:
   - Temporarily replace `src/app/page.tsx` with a minimal static page.
   - Temporarily remove `next/font/google` usage from `src/app/layout.tsx`.
   - Temporarily reduce `src/app/globals.css` to a minimal stylesheet.
   - Temporarily disable `typedRoutes` in `next.config.ts`.

5. If one trigger is identified, create a minimal reproduction branch or note.

6. Check whether the issue still occurs on the latest compatible Next.js patch before changing app code.

7. Choose a final action:
   - Keep `next dev --webpack` if Turbopack remains unstable.
   - Upgrade Next.js if a patch fixes the issue without regressions.
   - Revert `dev` to `next dev` if Turbopack is verified stable.

## Guardrails

- Do not refactor app code while isolating the bundler issue.
- Change only one variable per test run.
- Do not keep temporary isolation edits unless they are the confirmed fix.
- Do not remove the webpack fallback until Turbopack is verified on `/` and `/new`.

## Minimum Final Verification

```plaintext
pnpm build
pnpm dev
curl --max-time 20 -I http://localhost:3000
```
