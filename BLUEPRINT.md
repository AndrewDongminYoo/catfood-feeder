# BLUEPRINT — Next Food Decision

Status: The operator approved the consumer decision direction and autonomous implementation on 2026-10-18.

## Goal

Let an owner ask what imported dry cat food to buy next for their cat and receive a useful, source-backed decision brief.
[Product Direction](docs/product-direction.md) owns positioning, scope, delivery standards, and revenue hypotheses.
The [implementation spec](docs/specs/2026-10-18-next-food-decision.md) defines the current slice.

## Product architecture

- `/` enters `/advisor`: current food, reason to change, relevant conditions, then candidates.
- The question interpreter proposes explicit, editable conditions.
- The decision engine evaluates calorie-density tolerance and declared-ingredient exclusions against evidence.
- Qualitative calorie wording requires owner confirmation before counting as a fulfilled condition.
- Optional protein preferences prioritize evidence-backed ingredient order without excluding alternatives or predicting taste.
- Hard ingredient exclusions take precedence over preferences; older saved poultry-order conditions retain their original meaning.
- Explicit numeric calorie tolerances are preserved rather than rounded to a preset.
- Results distinguish conditions met, unresolved, and conditions failed.
- The result leads with up to three matching candidates, their reasons and tradeoffs; remaining candidates, sources, and calorie sensitivity are expandable.
- Versioned local snapshots preserve the decision, sources, and selection reason.
- The public catalog, two-food comparison, recalls, feeding history, and curator workbench remain supporting surfaces.
- Legacy `/advisor?current=...` links retain their original behavior.

## Non-negotiable evidence rules

- Separate manufacturer, Korean-label, estimated, and derived values throughout storage, reads, calculations, presentation, and export.
- A literal quote proves what the source says, not product identity, market identity, current formulation, or health suitability.
- Check source identity and currentness, product identity, numeric value, and unit before using evidence.
- Missing evidence is unknown, never a negative ingredient assertion or zero nutrient value.
- Broad animal names cannot establish exclusion of a specific animal.
- Label ingredient absence cannot establish allergy safety or absence of cross-contact.
- Guaranteed-analysis minima and maxima are bounds, not exact measured concentrations.
- Do not score overall health, safety, or quality.
- Do not relax the owner's conditions without an explicit action.
- Reinterpreting question wording replaces prior inferred exclusions, calorie conditions, and preferences while preserving direct choices and legacy poultry-order conditions.
- A missing new calorie percentage restores the last direct selection, or the initial 10% default; restored brief conditions count as owner selections without changing historical snapshots.
- An unclassified leading ingredient cannot be skipped to claim a later preferred animal as the first animal ingredient.

## Domain calculations

`src/lib/domain.ts` remains the shared calculation and validation implementation.
NFE is `100 − (protein + fat + fiber + ash + moisture)` when the necessary inputs are present.
A literal manufacturer or Korean-label NFE value takes precedence over an inferred one.
Ash resolution is a label value, then the explicitly estimated 9.0% extrusion fallback, otherwise no calculation.
Manufacturer-declared energy ratios take precedence over derived ratios.
ACANA Grasslands remains the arithmetic regression fixture.
These formulas provide consistent label comparisons, not exact intake measurements or clinical advice.

## Trust boundaries

- The server retains the only Anthropic transport in `src/lib/source-extraction.ts`.
- Optional public question interpretation is bounded, validates its response, and cannot write catalog data.
- Existing quota infrastructure limits paid interpretation requests globally; failures retain the structured form.
- Curator routes own source capture, extraction, evidence application, and publication authorization.
- Research agents propose evidence through the broker and cannot publish.
- Public ingredient evidence is projected on the server only for the already-public food IDs and matching current sources.
- Never expose service credentials or private captured source text to a client.
- User feeding data remains RLS-scoped.

## Implementation and delivery

Use Next.js App Router, TypeScript, the existing CSS tokens, and the pinned pnpm toolchain.
Keep the webpack development fallback until its ADR reversal criteria are met.
No new framework, state library, database migration, or dependency is needed for the first complete decision workflow.
Run tests, typecheck, lint, production build, and actual rendered desktop/mobile checks.
Do not stop at a plan, checklist, or request that the operator interview users with an incomplete product.

## Operational limits

This release does not claim fresh background research, stock or price verification, automatic source-change monitoring, or cloud-synced decision records.
An owner can explicitly recheck a saved decision using the current catalog and retain the old snapshot.
The recheck reads the server through `/api/advisor/catalog` with no response cache and bypasses the advisor catalog cache.
Explicit manufacturer adequacy declarations are collected from retained current captures and applied only after product-name review.
They are independent source-linked evidence, displayed with the original capture date, life stage, method, and quoted source.
They do not inherit the nutrient verification stamp or alter eligibility.
Sales market, current package equivalence, and standard edition remain unverified; a manufacturer claim does not establish app certification or complete numerical compliance.
Retired or private sources disappear from current public reads; saved decisions retain their historical copy.

## Historical decisions

The previous phases, their completion marks, and historical coverage are preserved in [the earlier blueprint](docs/notes/2026-10-18-blueprint-before-consumer-decision.md).
They are implementation history and do not define acceptance of the consumer product.
The old observed pilot gate is retired and must not be resumed as an outstanding delivery task.
