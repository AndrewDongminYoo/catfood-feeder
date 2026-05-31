# Korean Recall Data Source Check

Date: 2026-05-31
Status: Open

## Summary

BLUEPRINT Phase 3 asks whether a Korean public recall API exists for pet food or feed recall data. A quick search did not identify a stable public API endpoint equivalent to openFDA Food Enforcement for this product scope.

## Current Decision

- Implement the recall foundation with openFDA first.
- Keep Korean recall ingestion unimplemented until a specific endpoint and license/terms are confirmed.
- Show recall copy as "history information" rather than a real-time alert.

## Follow-up

Before adding Korean recall sync, confirm all of the following:

- Owning agency and dataset name.
- API endpoint and authentication method.
- Commercial reuse terms.
- Whether companion-animal dry food is included or only livestock/feed incidents are covered.
