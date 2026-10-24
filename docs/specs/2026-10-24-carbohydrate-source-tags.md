# Carbohydrate source-tag correctness

## Problem

Issue39 identifies a direct food-write path that preserves measured source tags from the supplied tag alone even when carb input is null or missing and the stored value is computed.
Publication preparation already uses stated-input nullness for computed values, but both paths can retain a tag when no carbohydrate value exists.

## Contract

A manufacturer or Korean-label carbohydrate tag is preserved only with an explicit numeric input, including zero.
Explicit NFE remains usable when moisture is absent.
Without a stated numeric carb value, computed carbohydrate is tagged derived or estimated according to the existing ash fallback.
When calculation is impossible, carbohydrate remains null and its source tag is absent.
The direct food route and publication preparation apply the same rule.
Human writes retain their existing publication metadata; automation remains draft-only.
No existing public API shape, domain arithmetic, schema, RLS, authorization rule, existing database row or source-capture policy changes.

## Acceptance

Exercise the actual direct-route insert payload for measured tags with null and missing inputs, valid measured numbers and zero, derived or estimated calculation, and non-computable input.
Exercise both human and automation authorization results without a live database write.
Check publication preparation with the corresponding cases and independent literal expectations.
A regression must fail against the old provenance decision and pass after the fix.
