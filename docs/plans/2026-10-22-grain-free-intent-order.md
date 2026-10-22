# Grain-free intent follow-up plan

The operator invoked pr-loop for #49 on 2026-10-22 after the parent acceptance review found two unmet #52 conditions.
Use the current main workspace and one branch; no worktree is required.

## Steps and checks

1. Add formal-withdrawal and ordered-permission/request regressions to the parser and existing offline workspace fixtures.
   Verify the intended pre-fix assertion failures with `pnpm test src/lib/decision-question.test.ts src/components/decision-workspace.test.tsx`.
2. Repair named Korean withdrawal recognition, its generic-parser masking, and ordered grain-free intent aggregation.
   Apply the separately recorded bounded repair to conversational reply attachment.
   Rerun the same regressions and preserve ambiguous-context behavior.
3. Clarify the existing consumer spec and map #50–#53 acceptance criteria to the actual fixtures and observed candidate or saved states.
   Run the domain, parser, and workspace tests, then test, typecheck, lint, build, Knip, and scoped Trunk checks.
4. Review the complete candidate and affected documentation, then create one coherent fix commit and PR.
   Track review and CI against the exact pushed head within the recorded budget.
5. Close #49 only after every parent acceptance criterion is verified.
   Merge only after all required technical and review gates pass under the explicit pr-loop authority.

## Owned paths

- src/lib/decision-question.ts
- src/lib/decision-question.test.ts
- src/components/decision-workspace.test.tsx
- docs/specs/2026-10-18-next-food-decision.md
- This plan and its companion specification.

## Bounded review repair

The parser review reproduced `I want grain-free food. Is grain-free better? No.` cancelling the earlier explicit request and erasing the ambiguous comparison.
The equivalent Korean question also failed before the repair.
This is a pre-existing omission of #52's ambiguous-context and explicit-request criteria, not a separate ingredient feature.
Before changing code, add a failing regression that preserves the supported request and leaves the comparison unresolved.
Limit conversational withdrawal attachment to a recognized request or a standalone grain-free confirmation question.
Keep direct bare confirmation replies working and do not change general ingredient interpretation.
Hosted review found that ordinary preference confirmations were excluded by that guard.
Add failing English and Korean confirmation regressions, then recognize bounded preference-question forms while retaining the comparative-question guard.
The next hosted round found repeated transitions joined within one sentence were not classified locally.
Add failing connected-transition regressions and split only grain-bearing transition segments, preserving original question context and source offsets for reply masking.
Require grain-free wording in the immediate following segment so conjunctions inside companion ingredient lists remain intact.

## Evidence limits

The fixtures exercise actual parsing, deterministic proposal validation, DOM interactions, local saved records, candidate assessment, and exported briefs.
They do not exercise a live model, broker, database, or deployment.
No layout or visual judgment is changed, so visual approval is not applicable.
Branch cleanup and durable memory recording were not requested by this invocation.
