# Catfood Feeder Design System

## 1. Purpose

The consumer decision workspace helps an owner turn a question into a readable food-selection brief.
Supporting curator and catalog screens prioritize legible nutrition data and explicit evidence state.
Copy voice: warm.

## 2. Tokens

Use the existing CSS custom properties in `src/app/globals.css` for background, card, ink, muted text, lines, accent, success, warning, and error states.
Use the existing `--app-font-sans` for UI and `--app-font-heading` only where already established.

## 3. Layout

Use `.wrap` for narrow detail screens and `.wide` for the consumer worksheet, curator review tables, and data lists.
Use 14px mobile gutters and existing `.card`, `.panel`, and `.split` primitives.

## 4. Interaction

Use native form controls with visible labels.
Primary actions use `.primary`; irreversible or committed actions use `.save`.
Disabled actions remain visible with the existing opacity treatment.

## 5. Primitives

`card` and `panel` provide bordered white surfaces.
`primary`, `ghost`, and `save` provide action states.
`err`, `warn`, and `ok` communicate operation results.

## 6. Accessibility

Every control has a visible label.
Operation status uses `role="status"` or `role="alert"`.
Do not use color as the only status signal.

## 7. Responsive Behavior

Curator forms remain one column on small screens.
Existing `.split` grids may expand only when space allows.

## 8. Accepted Debt

This documents the existing visual system without a visual redesign.
No new tokens or animation are introduced for the research workflow.

## 9. Consumer decision worksheet

The main screen starts with the current food and proceeds through the reason to change, relevant conditions, and candidates.
Show a visible four-step progress indicator and preserve input when moving back.
Use the existing teal accent, white cards, and neutral surfaces.
A large opening question anchors an asymmetric desktop layout; the same content stacks at narrow widths.
Keep a single visual language with the existing tokens and no new font or component dependency.

Offer everyday reasons before asking the owner to write a question.
Keep ingredient exclusions separate from optional protein preferences and reveal these follow-ups when relevant or requested.
Lead the comparison with up to three matching candidates and their reasons and tradeoffs; expand the other candidates and calorie sensitivity on demand.
Separate condition confirmation, comparison, evidence, and saving into a visible sequence.
The summary uses counts for met, unresolved, and failed conditions rather than a health score.
Candidate cards expose signed calorie-density differences, original ingredient order, source excerpts and dates, and concrete follow-up questions.
The full source material is expandable so the initial comparison remains readable.

Every action has a 44px target and a visible keyboard focus state.
At 375px the page must have no horizontal overflow.
Do not use animation to imply an investigation is running when only local comparison is taking place.
Historical saved briefs must be visibly distinguished from a fresh comparison.
