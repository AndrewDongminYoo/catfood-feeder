# Product Direction

Status: Accepted by the operator on 2026-10-18.
This document owns the product positioning, delivery standard, scope, and monetization hypothesis.
The former direction is preserved in [the historical record](notes/2026-10-18-product-direction-before-consumer-decision.md).

## Positioning

Help an owner decide what imported dry cat food to buy next by turning their question into explicit conditions, comparing those conditions with source-backed product facts, and preserving the reasons and remaining questions behind their choice.
The first person this product must serve is the operator choosing the next food for their own cat.

## The job to complete

An owner arrives with a current food and a reason to consider a change.
They leave with a manageable set of candidates, the differences that matter to their conditions, original evidence, and specific questions that could change the decision.
They can save or download the actual brief and revisit it without silently replacing its evidence with today's data.

The deliverable is a completed decision workflow.
A working research pipeline, an issue backlog, a generic chat box, and a catalog page alone do not satisfy it.
Do not make the operator invent a sales pitch or interview protocol to compensate for a product that cannot yet answer a useful question.

## AI and judgment

AI interprets a question and proposes editable conditions.
Deterministic code checks supported conditions against the catalog and its current evidence.
The owner confirms the interpretation and makes the purchase decision.
A model may not invent product facts, decide that a food is healthier, convert a missing value to zero, or erase an inconvenient unknown.

Preference sensitivity is useful: show how candidate availability changes when the owner changes the permitted calorie-density difference.
Nutrient interval simulation requires evidence-backed bounds and is not implemented by inventing ranges around a fallback constant.

## First complete experience

1. Choose the current food, then select a reason to change or write a question.
2. Confirm the permitted calorie-density change and reveal relevant ingredient follow-ups.
   Separate ingredients that must be excluded from preferred proteins that only change candidate order.
   Clarify qualitative calorie wording; ingredient order never predicts taste or establishes meat proportions.
   Preserve an explicit numerical limit exactly.
3. Start with up to three matching candidates and their specific reasons and tradeoffs.
   Expand other matching candidates, unresolved candidates, failed conditions, or calorie sensitivity when needed.
4. Inspect source excerpts, original ingredient wording and order, capture dates, tradeoffs, and the next concrete question.
5. Select or defer a candidate and save the exact brief with a reason.
6. Reopen the historical brief or explicitly compare again using the current catalog.
7. Search for sellers, then verify the package, market, formulation, stock, and price before buying.

## Scope

The first release compares adult-cat non-prescription dry foods.
Disease-specific diets, prescription replacement, kitten diets, pregnancy, and lactation require a different product and are stopped in this flow.
Ingredient exclusion means absence of a declared ingredient in the reviewed list; it does not establish cross-contact absence or allergy safety.
Guaranteed-analysis minima and maxima do not establish actual point quantities.
The product has no overall health score, safety verdict, or composite quality rank.

Keep the public catalog and curator tools as supporting surfaces.
The main entry point is the decision workspace, not an empty database browser.
Existing advisor query links retain their earlier deterministic behavior.

## Revenue hypothesis

The first unit of value is one useful food-selection brief for an owner.
Do not gate the first useful result behind an account, payment, or an interview.
A paid investigation or decision service is a hypothesis to evaluate using the product's concrete output and the unresolved work it exposes.
A business-embedded version may later distribute the same decision capability.
Neither a consumer subscription nor B2B data licensing has demonstrated demand in this repository.

Ongoing paid monitoring requires persistent decision-to-evidence dependencies and reliable re-evaluation after source changes.
Browser snapshots and a recheck button do not establish that capability, so do not sell or advertise automatic monitoring yet.

## Delivery standard

A release must let a person complete a meaningful question-to-brief flow using actual catalog data.
Tests must cover missing evidence, mismatching quotes, ambiguous ingredients, clinical requests, unsupported questions, denied browser storage, saved-result preservation, and model failure.
Inspect the rendered experience at desktop and narrow mobile widths.
A green unit suite does not prove usable coverage or a compelling decision brief.

Only after the product produces that material should evaluation ask which part changed an owner's choice, which unanswered question prevented a choice, and whether resolving it is worth paying for.
This is a follow-on learning activity, never a substitute for delivery.

## Historical coverage

Historical measured counts are in the archived direction document.
Re-measure before making a current completeness claim.
The public experience must expose its own missing evidence rather than advertise historical counts as guaranteed coverage.

## Current limits

The local AI interpreter uses the existing Anthropic integration with a durable site-wide daily budget; structured conditions remain usable if it is unavailable.
It interprets questions and does not perform a fresh consumer-initiated web investigation.
Saved briefs live in this browser and can be exported; they are not account-synced or monitored in the background.
Explicit rechecks read fresh server catalog data and preserve a historical brief if that read fails.
Retailer search is not verified availability, an affiliate integration, or a price comparison.
