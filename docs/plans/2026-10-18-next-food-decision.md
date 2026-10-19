# Next Food Decision Implementation Plan

**Goal:** Deliver the owner's question-to-decision experience in the running application.

**Spec:** `docs/specs/2026-10-18-next-food-decision.md`.

**Method:** Native implementation in the main workspace, as authorized by the operator.
The operator's autonomous mandate supersedes separate approval, PR lifecycle, and worktree defaults.

## Tasks

- [x] Define and test a pure decision engine in `src/lib/food-decision.ts` with deterministic ingredient exclusion, evidence-gated comparisons, preference sensitivity, and versioned snapshots.
      Verify: `pnpm test src/lib/food-decision.test.ts` observes RED before implementation and GREEN after it.
- [x] Implement bounded question interpretation through `src/lib/decision-question.ts`, the existing single Anthropic caller, and `src/app/api/advisor/question/route.ts`.
      Verify: interpreter and route tests cover unsupported requests, malformed output, daily quota, and usable fallback.
- [x] Implement `src/components/decision-workspace.tsx` and report presentation with editable conditions, concrete next questions, local save/reopen/recheck, export, and retailer search.
      Update `/advisor`, `/`, navigation, metadata, and scoped CSS.
      Verify: component interaction tests and rendered desktop/mobile workflow.
- [x] Align `README.md`, `BLUEPRINT.md`, `CLAUDE.md`, `AGENTS.md`, nested guidance, `DESIGN.md`, and `docs/product-direction.md` with the implemented product.
      Preserve superseded decisions as dated history.
- [x] Review the complete change independently and repair material findings.
      Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and named browser-session checks.

## Review focus

- Negated or conditional exclusion language must not silently turn into an opposite hard constraint.
- Unknown ingredient wording, absent evidence, and stale evidence must remain unknown.
- Existing advisor URLs must not lose their meaning.
- Manual baseline and saved results must retain their origin and date.
- Failure to load the catalog, model, or browser storage must have an actionable state.

## Evidence ledger

- Initial state: clean main workspace at `d7fcd2101eba42f0f62a8d425d844b45f5432e07`, matching GitHub main during the preceding audit.
- Direction approved in the current conversation; no additional design approval is pending.
- Oracle retrieval blocked by its canonical-identity gate; available repository documents and supplied project memory remain the grounded context.
- Independent correctness and first-use reviews identified exclusion ambiguity, unsupported requests silently dropped by fallback, invented AI conditions, incomplete clinical gates, and incomplete export evidence.
  Each material finding received a failing regression test before its repair; the final suite passes.
- Final checks: 66 test files and 542 tests passed; lint, typecheck, production build, unused-code check, and scoped Markdown checks passed.
- The production application was exercised with live catalog evidence and real question interpretation, then saved, restored, explicitly rechecked, and exported.
  Desktop and 375px mobile captures, exact observations, and remaining product limits are recorded in [the QA receipt](../notes/2026-10-18-decision-qa.md).
- The local production server is left running at `http://localhost:3000` for the operator.
  No remote push, deployment, database migration, or purchase was performed.
