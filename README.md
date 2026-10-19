# Catfood Feeder — Next Food Decision

Ask what imported dry cat food to buy next for your cat.
The app turns your question into editable conditions and builds a comparison brief with matching candidates, evidence, uncertainties, and specific follow-up questions.

## Use the product

Open `/` or `/advisor`.
Start with the current food, then choose a reason to change or write your own question.
Enter the package name and optional kcal/kg when the current food is missing from the catalog.
Confirm the calorie condition and any relevant ingredient exclusions or preferences in the next step.
Qualitative calorie requests require explicit confirmation; an explicitly requested number from 0 to 100% is preserved.
Ingredient preferences only prioritize candidates and never exclude alternatives; original ingredient order does not predict taste or establish the proportion of meat.
Compare the first three matching candidates, expand the rest when needed, inspect their sources, and save or download the actual brief with your choice or reason for deferring it.
Saved briefs preserve their original data; rechecking against the current catalog is a separate action.
That action requests fresh public catalog rows and evidence from the server rather than reusing the page's initial data.

The comparison covers adult-cat non-prescription dry food.
It does not establish health suitability, allergy safety, or exact nutrient concentrations.
Seller search does not verify stock, price, formulation, or the sales market.

## Run locally

```bash
pnpm install
mkdir -p ~/.config/catfood-feeder
cp .env.example ~/.config/catfood-feeder/env
chmod 600 ~/.config/catfood-feeder/env
pnpm dev
```

Configure the external secrets file with Supabase and Anthropic credentials.
Without catalog configuration the app identifies its sample mode; sample fixtures are not a usable buying catalog.
Without optional AI interpretation, the structured comparison conditions remain usable.
The development server is at `http://localhost:3000` and intentionally uses webpack.

## Product and technical sources

- [Product direction](docs/product-direction.md): the owner's job, scope, revenue hypothesis, and delivery standard.
- [Blueprint](BLUEPRINT.md): domain and trust-boundary decisions.
- [Current spec](docs/specs/2026-10-18-next-food-decision.md): question-to-decision contract.
- [Design](DESIGN.md): the existing visual system and decision workspace.
- [Scripts](scripts/README.md): catalog research and curator operations.

## Architecture

```plaintext
src/app/advisor/                   Consumer decision workspace and legacy advisor URLs
src/app/api/advisor/question/      Bounded question interpretation, no catalog mutation
src/lib/food-decision.ts           Evidence-gated conditions, briefs, snapshot schema, export
src/lib/decision-question.ts       Question interpretation and response validation
src/lib/decision-catalog.ts        Published-only ingredient evidence projection
src/components/decision-*.tsx      Question, conditions, candidate briefs, saved decisions
src/lib/catalog.ts                Public catalog and nutrient evidence
src/lib/source-extraction.ts       Server-only Anthropic transport
src/app/new/                      Curator capture, extraction, review, and publication
supabase/migrations/              Ordered schema source of truth
```

## Verify

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Data and privacy

The model proposes comparison conditions; catalog facts come from validated evidence.
Reinterpreting an edited question adds proposed exclusions and preferences without silently removing existing selections; removal uses the explicit controls.
Ingredient exclusions require the complete current ingredient proof and preserve ambiguous wording as unknown.
Question interpretation uses the existing server-side provider and a site-wide ceiling of 30 paid attempts per 24-hour quota window.
No account is required for the first comparison.
Decision records are saved only in this browser, up to 12 records, and can be exported as Markdown.
There is no automatic investigation, purchase, background monitoring, or account synchronization in this slice.

## License

Copyright (c) 2026 Dongmin Yu.
All rights reserved.
This source is reference-only and is not open source.
See [LICENSE](LICENSE).
