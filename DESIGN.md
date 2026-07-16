# Catfood Admin Design System

## 1. Purpose

Mobile-first curator and catalog screens prioritize legible nutrition data and explicit verification state.

## 2. Tokens

Use the existing CSS custom properties in `src/app/globals.css` for background, card, ink, muted text, lines, accent, success, warning, and error states.
Use the existing `--app-font-sans` for UI and `--app-font-heading` only where already established.

## 3. Layout

Use `.wrap` for narrow curator forms and `.wide` for data lists.
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
