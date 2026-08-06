# Unify the two publication paths

Status: **proposed, not implemented.**
Raised by a local Codex cross-review of `feature/ai-native-catalog` on 2026-08-06 and deferred deliberately — this is a product decision about the `/new` workflow, not a defect fix.

## The asymmetry

`docs/specs/2026-08-05-evidence-backed-draft-publication.md` introduced an evidence-checked publication step, but it did not become the only way a food turns public.
Two paths set publication state today, and they hold different bars:

| Path                                 | Actor          | Evidence required                                                         | Result                |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------- | --------------------- |
| `POST /api/foods`                    | human session  | none — `nutrient_sources` tags only                                       | published on the spot |
| `POST /api/foods/[id]/publish`       | human session  | every non-null nutrient must match a current `food_nutrient_evidence` row | published             |
| `POST /api/foods` + `x-admin-secret` | automation     | n/a — `published_at` stays null                                           | private draft         |
| `POST /api/research/proposals`       | research agent | server re-captures and re-verifies each excerpt                           | private draft         |

The machine boundary is intact: no automation credential can publish.
The asymmetry is between two _human_ paths.

## Why it is currently defensible

The direct path is the `/new` admin input tool.
A curator reads a physical bag or a 상세페이지 image and types the guaranteed analysis in.
There is no captured source text to check an excerpt against, so `publish_food_draft`'s evidence join would reject every such row — the curator's own reading _is_ the verification, which is what `verification_method` records.

Requiring a round trip through the publish endpoint would mean either weakening that endpoint's evidence rule or blocking hand entry entirely.

## Why it is worth revisiting

- A reviewer reading `supabase/AGENTS.md` reasonably concluded the publish RPC was the only way to set publication fields. The invariant is harder to state than it should be, and a rule that needs an exception clause is a rule that will be misapplied.
- Public catalog rows are no longer uniform: some carry a source ledger and per-field evidence, some carry only source _tags_. Nothing in the schema or the UI distinguishes them.
- The 상세페이지-transcription case already has a home in the source ledger (`captureMethod: "manual"` with the image URL as reference). If `/new` routed through that, hand entry would produce evidence too, and the exemption could disappear.

## Options

1. **Keep the exemption, document it precisely.** Done for now — `supabase/AGENTS.md` names both paths and this file holds the open question. Zero code change.
2. **Make `/new` create a DRAFT, then publish through the endpoint.** Requires `publish_food_draft` to accept a "curator attestation" evidence kind, or a second verification method that skips the evidence join. Changes the `/new` flow from one action to two.
3. **Make `/new` write a manual source transcript.** The curator pastes or transcribes what they read into a `manual` `food_sources` row, and evidence is derived from it. Highest integrity — every public value becomes traceable — and the largest UX cost.

Option 3 is the one that actually removes the asymmetry rather than describing it; option 2 only moves it into the RPC.

## Related: declared energy has no evidence tier

Found by an adversarial review on 2026-08-06 and only partly closed.

`energy_p/f/c_pct` are not evidence-able keys — `apply_food_evidence_draft` rejects them, so no `food_nutrient_evidence` row can ever back them, and `publish_food_draft`'s evidence loop covers only the eight measured nutrient columns.
A draft can therefore reach the public catalog with energy tagged `manufacturer` (the measured tier) and nothing behind it.

What was fixed: publication now validates what it publishes.
`prepareFoodPublication` previously ran `validate` against a recomputed split and then substituted the stored one, so the sum check in `domain.ts` never saw the published values and a digit-dropped split (7/20/10) could publish as measured.
The declared triple is now passed into `computeDerived`, so the check applies.

What remains: internal consistency is not provenance.
A draft created by an automation credential with `mfg_energy` still carries a `manufacturer` tag no human attested to, and nothing records who wrote a given draft field.
Closing that needs the same thing option 3 above needs — a per-field provenance trail — which is why it is recorded here rather than patched separately.

## Related: the evidence-apply gate still reads `data_verified_at`

Raised by a code review on 2026-08-06; observation accepted, no change made.

`apply_food_evidence_draft` refuses a food where `data_verified_at IS NOT NULL`, while the rest of the branch moved visibility to `published_at`.
`foods_publication_state_valid` permits `data_verified_at IS NOT NULL AND published_at IS NULL`, so in principle a row could be listed by `/api/foods/drafts` and then fail every apply with a generic 500.

Not reachable today: the only two writers of `data_verified_at` are the direct `/api/foods` insert and `publish_food_draft`, and both set `published_at` in the same statement — verified by grep over `src/` and `supabase/migrations/`.
The 20260805 migration also backfilled `published_at` from `data_verified_at`, so no legacy row is in that state either.

Left alone deliberately: the apply gate asks "has a human verified this?", and `data_verified_at` is the column that answers it — switching it to `published_at` would let evidence overwrite a verified-but-unpublished row, which is the opposite of the invariant.
If the divergence is worth closing, the right end is the CHECK constraint, which currently sanctions a state no code produces.

## Related: a changed label has no acceptance path

Reproduced by an executing database review on 2026-08-06. Real, and deliberately not patched — the fix is a product decision, and the obvious patch contradicts three tested invariants.

When a manufacturer changes a label and the source is re-captured, the previous `food_sources` row is retired but the `food_nutrient_evidence` row stays current, still pointing at the retired source.
`replace_current_food_source` never re-points evidence; the subsequent re-apply does.
So the two refresh outcomes diverge:

- **Identical content** — re-apply returns `applied`, evidence re-points to the new capture, publication works. Covered by `source_refresh_provenance_test.sql`.
- **Changed content** — re-apply returns `conflict` and writes nothing, by design (`20260721121348`, `20260721133137`, and five assertions in that test file). The stored value keeps its old number, its evidence stays orphaned, and `publish_food_draft` returns `no_evidence` because it only joins current sources.

The result is a food that can be neither published nor updated through the normal flow.
The only escape found is clearing the column (a full-row re-submit through `POST /api/foods` does it), and nothing in the UI says so — `/new/research` reports only `저장값과 다른 후보 N건을 남겼습니다`.

`no_evidence` is arguably correct here: the stored number genuinely has no live support.
The missing piece is not a database guard but a curator action — an explicit "accept the changed value" that supersedes the old evidence after a human looks at it.
An attempted fix that made apply overwrite whenever evidence was orphaned was reverted: it broke `an identical same-source refresh preserves nutrient source tags`, `… does not touch the food timestamp`, and `a changed same-source refresh reports conflict`, which are the deliberate behaviors that keep the machine from silently replacing measured data.

## Not blocking

Nothing here is a live defect. The current behavior predates the evidence-backed publication work (on `main`, `/api/foods` already set `data_verified_at` on human create and public reads gated on it), so this plan documents an inherited design question, not a regression.
