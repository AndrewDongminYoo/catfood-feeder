# Adversarial Decision Review and Repair

## Trigger and authority

The operator requested adversarial review after the initial three implementation commits.
Two independent read-only reviewers returned `REQUEST_CHANGES` against `cbab949e359a5300f9bd7c192eba20c5ec19531a`.
The operator then requested continuation under the existing implementation mandate.
The initial completion claim was withdrawn.

## Reproduced defects

- A recognized chicken exclusion concealed an additional unsupported pork exclusion.
- An explicit 8% calorie tolerance was dropped and the 10% default remained.
- The owner's qualitative calorie, health, and poultry-preference question could produce empty conditions while candidates were labeled met.
- Single-word Korean wheat, flounder, and unspecified liver or blood ingredients received incorrect exclusion results.
- Week-age and CKD questions bypassed the clinical/life-stage boundary.
- Markdown omitted the current food's calorie evidence.
- Restoring a saved request did not restore the editor for unresolved requirements.
- Explicit current-data rechecks reused initial client props without reading the server.

## Repairs

Regression tests reproduced each original defect before its implementation repair.
Explicit percentage tolerances now remain exact numbers from 0 to 100%.
Qualitative calorie wording requires confirmation of visible tolerance and current-food ceiling settings.
Poultry preference can be confirmed as poultry appearing before fish in the declared ingredient list.
This condition does not establish taste, meat proportion, or health suitability.
Unsupported health judgments remain unresolved until the owner explicitly omits them.
An empty set of comparison conditions no longer produces a successful report.
Saved unresolved and omitted requirements drive their own editor without another model call.
Fresh rechecks request public rows and evidence through a no-store server route that bypasses the advisor cache.
If retrieval fails, the displayed report and its timestamp remain unchanged.
The portable Markdown includes the baseline calorie quote, source URL, and capture date.

## Verification status

Both independent reviewers approved their bounded repair scopes with no remaining blockers.
The consumer reviewer also reported a non-blocking duplicate React key caused by identical clarification questions.
The report now removes duplicate displayed questions.

- Mutation proof: export the known-bug `cbab949` tree to a task-owned temporary directory and overlay the current regression tests.
  The selected regression command failed 15 cases across four files, including the missing baseline source, stale catalog, lost request, and exclusion errors.
  The directory was removed after the test process finished.
- Blast radius: `pnpm test --reporter=dot` passed 67 files and 566 tests after the final code edit.
  This includes decision-engine, interpreter, legacy advisor, cache, public-route, storage, and component coverage.
  The thin new catalog route was exercised on the production server rather than given a mock-only unit test.
- Invariant: supported conditions must retain their meaning, and unsupported or unconfirmed requirements cannot become fulfilled conditions.
  Caller and sibling checks covered `food-decision.ts`, `decision-question.ts`, `decision-workspace.tsx`, the question and catalog routes, `catalog.ts`, and the legacy advisor page.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, scoped Markdown checks, and `git diff --check` passed.
- `codex doctor --summary --ascii --no-color`: 24 OK, 2 notes, 0 warnings, 0 failures.
  This is an advisory environment diagnostic, not evidence of product correctness.

## Rendered owner-question evidence

The isolated `catfood-review-fix` session used the question from the operator's screenshot and ACANA Homestead Harvest as the current food.
The baseline was 3,760 kcal/kg.
The real question request used the fallback path, which now explicitly says that AI did not interpret the complete question.
Before confirmation, the result contained zero met candidates, 78 unknown candidates, and 33 failed candidates.
After confirming the current-food calorie ceiling, a 10% maximum difference, and poultry-before-fish label order, the QA session explicitly omitted the unsupported health judgment.
The explicit fresh server recheck then returned 8 met candidates, 70 unknown candidates, and 33 failed candidates.
These are dated observations, not claims of health suitability or permanent catalog coverage.

The first displayed candidate was Blackwood Adult at 3,733 kcal/kg, a displayed -0.7% change.
Its evidence-backed original ingredient order placed chicken meal first and whitefish meal sixth.
The interface labels this as an ingredient-order comparison, not a prediction of taste or meat proportion.

- [Desktop owner-question result](2026-10-19-decision-qa/desktop-owner-result.png)
- [Mobile candidate](2026-10-19-decision-qa/mobile-owner-candidate.png)

At 375px the document scroll width was also 375px.
Both captures were visually inspected.
The chosen QA candidate and reason were saved, the page was reopened, and the saved brief was restored with its omitted-health editor intact.
A real Markdown download preserved the baseline calorie evidence, poultry condition, omitted health request, failed conditions, and baseline source URL.
An empty-document control failed the same validator before the real downloaded document passed.
The named browser session was closed after testing.

The final production build is running at `http://localhost:3000`.
The production `/advisor` and `/api/advisor/catalog` reads returned HTTP 200, and the catalog response carried `Cache-Control: no-store`.
There was no remote push, deployment, schema mutation, RLS change, payment, or purchase.

## Precedent limit

The earlier Oracle retrieval was blocked by the project identity gate before a project query.
No absence-of-precedent claim is made.
