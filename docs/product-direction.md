# Product Direction

> Status: Accepted product-direction record. Supersedes the Advisor v0 observed pilot gate.
> Decision date: 2026-08-22.
> This file owns the positioning statement, the non-goals, the measured coverage baseline, and the monetization posture.
> `BLUEPRINT.md` cites this file rather than restating it.

## Positioning

> A service that helps an owner choosing the next imported dry cat food compare the nutrient change and the ingredient composition against the food currently being fed, together with the evidence level behind each value.

The scope is locked to that sentence.
A candidate is shown because it satisfies stated deterministic conditions, never because the service judged it healthier.

## Non-goals

- Dogs, wet food, prescription and disease-specific diets.
- Automatic health scores, safety verdicts, or any composite quality ranking.
- Price crawling and lowest-price discovery (`Phase 5` remains deferred).
- Public contribution, reputation, and community moderation systems.
- Natural-language chat input and an MCP adapter, both of which stay later than a working ingredient slice.

## Measured baseline (2026-08-22)

Evidence basis: Supabase REST count queries with the service-role key, plus direct `psql` reads over `POSTGRES_URL_NON_POOLING`.
No truncated output.

| Dimension                                            | Measured  |
| ---------------------------------------------------- | --------- |
| `foods` total / published                            | 349 / 125 |
| `food_nutrient_evidence` rows                        | 2,251     |
| `food_research_runs`                                 | 430       |
| `brands`                                             | 107       |
| Published rows with protein, fat, carb, energy split | 125 / 125 |
| Published rows with `kcal_per_kg`                    | 83 / 125  |
| Published rows with `ash_pct`                        | 78 / 125  |
| Published rows with a non-empty `ingredients` array  | 0 / 125   |
| Published rows with `grain_free = true`              | 0 / 125   |
| `recalls` rows                                       | 2         |
| `auth.users` / `cats` / `feeding_logs`               | 1 / 1 / 0 |
| Advisor v0 observed pilot sessions                   | 0 of 8    |

Two readings follow from this table.

**The research engine works and the presentation layer oversold it.**
430 research runs produced 2,251 evidence rows across 125 published products, and every published row carries a complete protein/fat/carb/energy profile.
Meanwhile `Phase 2`, `Phase 3`, and `Phase 4` are all marked complete in `BLUEPRINT.md` while the data behind their features is empty: the grain-free filter filters nothing, the recall badge reads two rows, and the feeding log that was designed as the return-visit driver has never been written to, including by the owner.
A completed checkbox proves the code exists, not that the data does.

**Retention and revenue premises are untested.**
With one account, one cat, and zero feeding logs, any subscription or retention framing rests on an unmeasured assumption.
This document therefore does not select a revenue model.

## Why the ingredient slice comes first

Every monetization path the project has floated is blocked on a different measured gap.

| Path                     | Requires                                           | Measured state                                                                                               |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Affiliate and commerce   | a join from a catalog row to a purchasable listing | no such join exists; a `foods` row is a manufacturer recipe and weight variants were deliberately merged out |
| B2B data API or MCP      | ingredients and coverage as the sellable asset     | ingredients are empty on every published row                                                                 |
| Consumer advisor product | `kcal_per_kg` on both sides of a comparison        | absent on 42 of 125 published rows                                                                           |

Ingredient data is the only asset that all three paths need, so it is the common precondition rather than a revenue model of its own.
The slice deliberately keeps all three paths open.

### What would settle the revenue model later

- **B2B**: an inbound request from a Korean pet commerce or content service that names coverage and provenance as the reason.
- **Consumer advisor**: repeated evidence that owners open the evidence detail and connect a chosen candidate to a feeding log.
- **Affiliate**: demonstrated traffic on the published catalog, which does not exist yet and is not measured by any instrumentation in the product.

None of these can be observed today, and adding analytics to manufacture them is out of scope.

## Root cause of the empty ingredient column

The gap is missing plumbing, not missing data.

- The extraction prompt already requests `ingredients` (`src/lib/source-extraction.ts`), and `/api/foods` writes the field for the curator form path.
- The evidence-apply route accepts only an `evidence` array bounded to the nine nutrient keys (`src/app/api/foods/[id]/sources/apply/route.ts`), so ingredients have no channel through the research pipeline.
- Every product published through that pipeline therefore lands with `ingredients: []` regardless of what the extractor found.

Retained captures already hold the source text.
Of the 125 published products, **104 have a comma-separated ingredient run inside the capture of their current (`is_current`) source**, and 21 have none.
Of those 104, sixty hold exactly one such run and forty-four hold several.

An earlier pass reported 75 rather than 104.
That count capped an ingredient entry at 40 characters, so a long parenthetical such as `chicken fat (preserved with tocopherols and citric acid)` broke the chain and split one list into fragments — which also inflated the apparent per-page ambiguity.
Widening the entry pattern to break only on commas, semicolons, and newlines corrected both.

The 104 is still an upper bound, and the residual failures are semantic rather than syntactic.
Reading fourteen samples by hand on 2026-08-23: of ten one-run captures, seven held a real ingredient list, two matched only a parenthetical herb sub-list, and one was marketing prose; among several-run captures the first match is sometimes site navigation.
No regular expression separates those cases, so this figure selects and orders candidates while the extraction pass settles identity and completeness.
The real yield is set by that pass, not by this figure.

## Slice scope

1. **Measure the yield.** Run the existing extraction against 10 to 15 of the 75 matching products and count how many return a list that matches the product identity. That measured rate, not 75, is the planning number.
2. **Fix the shape before re-extraction freezes it.** The stored model is `{name, position}` and nothing more. `position` carries the descending-weight order that labels encode and is the actual value of ingredient data. Form (fresh / dried / meal / by-product) and specificity (a named species versus 가금육 or 육류) are both already encoded in the label's own wording, so they are derived in `src/lib/ingredient-form.ts` rather than stored: storing them would freeze one interpretation into every row at re-extraction time, while deriving them lets the rules improve without another paid pass. This follows the pattern the project already uses for energy ratios and conflicts, which the server computes rather than trusting from the model. `pct` is not modelled because these labels rarely state it. Eight source files consume the field today, excluding tests and generated types.
3. **Open the apply channel.** Extend the evidence-apply route to carry ingredients under the same literal-evidence requirement the nutrient path enforces.
4. **Re-extract the matching set** using only retained captures, with no new research.
5. **Defer the remainder.** The roughly 50 products without an in-capture list split into those needing a fresh fetch and those needing vision transcription. That split is a follow-on and must not block step 4.

## Surface retirement

Each pivot has added surface without retiring the previous one: 31 routes and 11 scripts now stand behind four phases marked complete over partly-empty data.
Before the next surface is added, the dead ones are candidates for removal rather than repair — the grain-free and functional-flag filters that match nothing, and the recall badge reading two rows.
Retirement is a separate decision from this slice and is recorded here so it is not lost.

## What this retires

The Advisor v0 observed pilot gate is withdrawn at 0 of 8 sessions, without having run.
It is retired rather than deleted so a later session does not read its scaffolding as work in flight.

- `BLUEPRINT.md` sections «Next Product Slice» and «Advisor v0 관찰 파일럿 게이트».
- `docs/plans/2026-08-20-advisor-v0-pilot.md`.
- The owner-only ledger root named in that plan, which holds protocol scaffolding and a one-byte ledger.

Advisor v0 itself is not withdrawn.
The shipped `/advisor` surface stays as built; what is withdrawn is the eight-session observation as the gate that decides the next slice.
