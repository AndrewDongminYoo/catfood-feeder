# Grain-free question intent

The operator approved issue #52 through `pr-loop` on 2026-10-20.
The [consumer decision spec](../specs/2026-10-18-next-food-decision.md) and [issue #52](https://github.com/AndrewDongminYoo/catfood-feeder/issues/52) define the contract.

## Scope

Interpret an explicit grain-free request as a grain exclusion, without treating permission, negation, or an ambiguous mention as a hard condition.
Preserve other ingredient exclusions and explicit calorie limits.
Do not change saved-record formats, question reinterpretation state, ingredient matching, dependencies, or database state.
Unrecognized contexts remain visible for owner confirmation.

## Implementation and verification

1. Add regressions in `src/lib/decision-question.test.ts` for affirmative requests, permission, negation, ambiguous mentions, mixed conditions, and partial-quote model proposals.
   Run the tests before implementation and verify that the current hard grain exclusion causes the failures.
2. Add offline interaction regressions in `src/components/decision-workspace.test.tsx` using a candidate with complete Wheat ingredient evidence and a supported calorie difference.
   Check the actual grain checkbox, saved request, candidate classification, and exported brief.
3. Update only the grain-free intent path in `src/lib/decision-question.ts`.
   Keep the generic ingredient matcher from independently treating the Korean phrase as an exclusion.
4. Clarify the grain-free contract in the existing consumer decision spec.
   Check `AGENTS.md`, `CLAUDE.md`, `README.md`, `BLUEPRINT.md`, and `docs/product-direction.md` for implementation-caused drift.
5. Run focused regressions, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm exec knip`, and scoped Trunk checks.
   Review the final diff against the issue, then commit and open one PR for #52.

## Review boundaries

The operator approved a bounded parser restructuring after repeated wording regressions.
Keep surface normalization, clause-level request and retraction decisions, and final condition aggregation separate inside the existing parser.
Preserve source offsets when masking recognized withdrawal text from the generic ingredient matcher.
Verify named-condition withdrawals, comma-only companion clauses, spaced Korean requests, handled withdrawal state, and unrelated unknown clauses before another hosted review.

No visual design changes are planned.
The offline rendered interaction tests verify behavior, not visual approval.
Issue #53 owns replacement of stale inferred conditions after a question changes.
Issue #51 owns animal-fat preference ordering.
Merge remains an operator action.
