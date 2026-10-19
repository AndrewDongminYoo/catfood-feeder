# Next Food Decision

Status: Approved for autonomous implementation by the operator on 2026-10-18.

## Outcome

An owner can ask what imported dry cat food to buy next, describe the current food and reasons for changing it, and receive a useful decision brief with candidates, differences, evidence, unresolved questions, and a next action.
The product must do the comparison work before asking the owner to validate demand.

## Product contract

- Serve adult cats eating non-prescription dry food.
  Explicitly stop disease-specific, prescription, kitten, and pregnancy requests rather than infer suitability.
  Apply the same clinical stop to English and Korean urinary, renal, and intestinal diet terminology, including rules-only fallback.
  Evaluate candidate brand and product names with the same clinical and life-stage gate, including Babycat wording.
- Accept a natural-language question, current food, optional manual baseline when the food is missing, ingredient exclusions, and a maximum calorie-density change.
- Translate the question into visible, editable conditions before evaluation.
  Preserve explicit calorie-density tolerance numbers from 0 to 100%.
  Ask the owner to confirm the meaning of qualitative calorie wording and interpreted poultry preferences.
  Negated lower-calorie wording remains unresolved and never selects a calorie ceiling automatically.
  Permissive wording does not impose a ceiling; explicit sensitivity selection confirms the calorie tolerance without clearing other pending criteria.
  Optional protein preferences change candidate order only; hard exclusions always take precedence.
  Assess preferred proteins from the first declared animal ingredient with complete literal source proof, ignoring standalone fat, oil, broth, stock, and flavor entries for this preference assessment.
  Preserve the original meaning of older saved hard poultry-order requests.
  Ingredient order does not predict taste or establish the proportion of meat.
  AI proposes conditions and identifies unsupported requests; deterministic code evaluates catalog evidence.
  An unavailable model must leave a fully usable structured form and explain the fallback.
- Separate conditions met, conditions failed, and conditions that cannot be determined.
  Missing or broad ingredient names never establish absence of an excluded ingredient.
  Recognize compact animal and grain derivatives such as `chickenmeal`, `chickenfat`, `fishmeal`, `cornmeal`, and `oatmeal` without matching unrelated longer words.
  Label absence never establishes allergy safety.
- Compare calorie density only with matching evidence, or an explicitly identified owner-entered baseline.
  Use a manual baseline only when manual mode is selected; a missing selected catalog food must not silently reuse earlier manual values.
  Minimum and maximum guaranteed-analysis figures are not exact quantities.
  Do not rank calculated carbohydrate, health, or overall food quality.
- Show why each candidate appears, signed calorie change, original ingredient wording and order, source links and capture dates, tradeoffs, and specific follow-up questions.
  A missing value produces a useful question, not a fabricated completion.
- Show how tightening or relaxing the calorie condition changes the eligible set.
  This is sensitivity to the owner's preference, not a health probability or a fabricated nutrient interval.
- Save the exact brief, conditions, source excerpts, and selection reason on this browser.
  Restoring a saved brief must preserve the historical result.
  Rechecking against the current catalog is an explicit action and must not overwrite the saved version.
  This action must fetch fresh public rows and evidence from the server, bypass the advisor catalog cache, and retain the earlier report if retrieval fails.
  An initial manufacturer-declaration retrieval failure must leave the base comparison usable and persist an explicit unavailable status in the report, saved rendering, and export.
  A failed explicit refresh still preserves the earlier report and captured declarations.
- Provide a portable downloadable brief and an explicitly labeled retailer search.
  Search is not stock, price, region, or formulation verification.
- No required account or payment to obtain the first useful result.
  No automated purchase or fabricated background investigation.

## Architecture

Keep the existing catalog, extraction, curator, and research authorization boundaries.
Add a pure decision engine, a bounded question interpreter, and a client decision workspace on `/advisor`.
Make `/` enter that experience.
Keep legacy advisor query URLs and exported domain APIs compatible.
Use the existing Anthropic integration for optional question interpretation only; never let its output establish catalog facts.
Rate-limit public model work through the existing durable quota with a global daily ceiling and fail to the structured form when unavailable.
Persist personal decision snapshots in browser storage with a validated versioned schema, storage failure handling, and export.
The original question-to-decision slice requires no database migration, dependency addition, or weakening of RLS.
The manufacturer-declaration follow-up adds an independent evidence table and service-only apply function; it does not relax existing nutrient or source access rules.

## Design contract

Preserve the existing teal accent, white cards, neutral background, Korean sans body, and serif display tokens.
Use four guided steps: current food, reason to change or custom question, relevant conditions, then candidates and saving.
Offer everyday reason choices and reveal optional exclusion and preference questions when relevant or requested.
Lead results with up to three matching candidates and their reasons and tradeoffs; allow expansion of the remaining candidates, evidence, and calorie sensitivity.
At wide widths use an asymmetric introduction and form, followed by readable comparison cards.
Use visible labels, native controls, 44px targets, keyboard focus, status announcements, reduced-motion support, and no horizontal page overflow at 375px.
Copy voice: warm.
Use the existing Korean register for new product copy and do not expose implementation details in the normal flow.

## Acceptance

1. A real catalog request produces candidates or explicit failed/unknown conditions, with no silent relaxation.
2. Chicken exclusions catch chicken derivatives and treat unspecified poultry as unknown.
3. Evidence mismatch cannot justify a calorie comparison; missing current food can use an owner-entered baseline without becoming a manufacturer fact.
4. Unsupported clinical questions stop the decision flow even when other conditions are valid.
5. Saved briefs survive reload and catalog changes; corrupt storage and denied storage do not crash the page.
6. Question interpretation failure leaves an actionable form and preserves the question.
   Mixed questions keep unverified kibble size, shape, and texture requests unresolved even when an exclusion or calorie condition is recognized.
7. Full Vitest, TypeScript, ESLint, production build, and rendered desktop/mobile checks pass.

## Authority and limits

The operator authorized foundational document changes and continued implementation in the main workspace.
The initial local delivery did not require a PR, remote push, production schema write, account change, or purchase.
The operator later authorized applying reviewed manufacturer declarations to the linked database and publishing the completed work as a PR.
Merge, account changes, and purchases remain outside this authorization.
Historical data counts remain dated observations rather than live coverage claims.
The Google document supplied in this session informs the separation of proposal, evidence, and decision.
The initial Oracle retrieval was blocked by an identity gate.
The guided-flow follow-up resolved the personal `catfood-feeder` project identity and consulted source-currency and nutrient-provenance precedent.
The resulting constraints are reflected in the source and guaranteed-analysis rules in [BLUEPRINT](../../BLUEPRINT.md).
