# Search-First Catalog Output

## Status

Design approved on 2026-08-11.

Implemented on 2026-08-11.

Automated tests, typecheck, lint, production build, Trunk, and local server-rendered route checks passed.

Interactive browser automation was unavailable in this environment, so visual and keyboard smoke verification remains pending.

## Goal

Help a visitor who already has a product in mind understand its nutrition, ingredients, evidence, and recall context without turning incomplete data or marketing language into a recommendation.

## Product Position

The public surface is a search-first product dossier, not a ranked shopping list or a personalized curation engine.

It should lead a visitor through three outcomes in order.

1. Recognize that the catalog holds more relevant imported foods than the ones they already know.
2. Understand the strengths, trade-offs, limits, and unanswered questions of a food they planned to buy.
3. Leave with reusable questions for the next purchase rather than a universal definition of “the best food.”

Feeding history remains a separate retention surface for recording what a user has fed.

It must not influence public product interpretation or create personalized recommendations in this scope.

## Entry and Navigation

The primary entry point is product or brand search.

The catalog still exposes filters and the product collection for discovery, but those are secondary to finding an intended product quickly.

Search results must not imply popularity, quality, or a ranked recommendation.

Selecting a result opens the product dossier.

The dossier offers a direct comparison path for a second explicitly selected product.

## Product Dossier

The dossier presents one product through four connected lenses.

### Nutrition Balance

Show protein, fat, carbohydrate, energy density, protein/fat/carbohydrate energy shares, and Ca:P together where data exists.

Do not reduce these values to a composite health score.

Explain that the meaning of energy density and PFC balance can vary with life stage and physical condition.

Explain that Ca:P is a relationship to inspect, not an isolated high-or-low badge.

When a value is unavailable, estimated, or derived, show that state directly instead of substituting zero or presenting it as a measured fact.

### Ingredients and Product Context

Show the recorded ingredient list as source data, not as a simplistic whitelist or blacklist.

Use contextual explanations to invite the next question a buyer should investigate.

Do not label a product better solely because it uses a marketing term such as “human grade.”

Do not imply that animal organs are intrinsically low quality.

### Evidence and Unknowns

Keep the per-nutrient source distinction visible.

Manufacturer, Korean-label, estimated, and derived values are different kinds of information and must never share the same visual certainty.

Show what is absent or not verified as a first-class result.

This prevents a missing field or a source outside the catalog’s reach from reading as a favorable conclusion.

### Brand and Recall History

Show recall history as scoped historical evidence with its source, date, reason, and affected-lot information when present.

Never convert a lack of records into a claim that a food has no recall history.

In particular, absence of a Korean recall record is not evidence of an absence of recalls because a comparable domestic recall data source is not part of this catalog’s verified coverage.

Keep the existing notice that recall information is not real-time safety advice.

## Comparison

Comparison is a buyer-controlled, two-product view.

It should organize the same four lenses side by side and emphasize differences in balance, evidence state, and missing information.

It must not identify a winner or calculate a universal recommendation.

The useful output is a clear explanation of what changes when a buyer moves from one explicitly chosen product to another.

## Contextual Learning

Short explanations belong beside the value or condition that prompted them.

For example, a Ca:P value can explain why the ratio matters and an estimated ash value can explain why a calculated carbohydrate value carries uncertainty.

This is preferable to a detached, lecture-style education section because visitors arrive with a product question first.

Long-form educational content is out of scope until the product dossier proves which questions users actually need answered.

## Content Rules

- Use factual, source-scoped language rather than safety or medical conclusions.
- Avoid “best,” “safe,” “risk-free,” “no recall,” “high quality,” and similar definitive claims unless the catalog holds evidence that supports the exact claim and scope.
- Do not use a single score, ranking, or color-only signal to summarize product quality.
- Keep guaranteed-analysis bounds, measured values, estimates, derivations, and missing data legible as distinct states.
- Preserve Korean UI copy and the existing mobile-first, accessible design system.

## Scope Boundaries

This work may reshape the public catalog, food detail, and two-product comparison surfaces.

It does not require a new nutrient schema, a new data-collection path, a recall-data expansion, personalized curation, medical or lifecycle recommendations, or changes to the feeding-history domain.

## Acceptance Criteria

- A visitor can search for a known brand or product before browsing the full catalog.
- A food detail view makes balance, ingredient context, provenance, recall scope, and unknowns discoverable without a composite quality score.
- A two-product comparison explains differences without declaring a winner.
- Estimated, derived, and unavailable values remain visually and textually distinct from measured source-backed values.
- Recall output never infers “no recalls” from missing local records.
- Keyboard navigation, visible labels, and non-color status cues remain intact on mobile and desktop layouts.

## Verification Direction

Implementation should add focused component tests for search entry, evidence-state rendering, missing-data copy, recall-scope copy, and comparison semantics.

Run the project’s existing lint, typecheck, test, and build commands after implementation.
