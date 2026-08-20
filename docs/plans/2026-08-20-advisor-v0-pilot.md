# Advisor v0 Observed Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide whether the structured `/advisor` workflow helps people find and evaluate replacement-food candidates through eight directly observed sessions, without adding product analytics or collecting identifying information.

**Architecture:** Keep the product unchanged.
Record only observer-scored, non-identifying evidence in an owner-only local ledger outside Git, then commit one anonymous aggregate decision to the repository.
The pilot ends at eight completed valid sessions and routes the next product slice to `proceed`, `revise`, or `stop`.

**Tech Stack:** Existing Next.js application without analytics integration, Markdown and JSONL for the external ledger, and a small external Node.js validator.

**Spec:** [Evidence-aware Food Advisor v0 Implementation Plan](./2026-08-20-evidence-aware-food-advisor-v0.md), [BLUEPRINT](../../BLUEPRINT.md), and [Product-direction consultation](../../.omo/2026-08-20-catfoodfeeder_발전_방향_consult.md).

## Product Decision

The pilot collects judgment evidence only from directly observed sessions.
It does not collect general visitor behavior and does not add Vercel custom events, GA4, Plausible, Umami, a first-party analytics endpoint, a Supabase event table, cookies, consent UI, or another analytics service.

The existing unused `@vercel/analytics` dependency predates this pilot and remains outside this change.
Do not mount it or emit events from it.
Removing a pre-existing unused dependency is a separate maintenance decision.

The pilot ends when the ledger contains eight completed valid sessions.
This is a session-count gate, not a unique-participant count or a time-box.
A valid session is one in which a participant consents to observation, attempts one real replacement-food task on the pilot build, reaches an outcome or explicitly stops, and leaves enough non-identifying observations to score the protocol.
Sessions that end before the task begins or fail because the application is unavailable do not count toward eight; record only the non-identifying exclusion reason.

## Privacy and Storage Contract

The raw ledger root is:

```plaintext
/Users/dongminyu/.local/share/catfood-feeder/advisor-v0-pilot/
```

The repository `.omo` directory, the repository `.codex` directory, and `/Users/dongminyu/.codex` are not raw-ledger locations.
The raw root and its subdirectories use mode `0700`; files use mode `0600`.

Use pseudonymous session IDs such as `S001` only inside the external ledger.
Do not record a participant name, cat name, email, phone number, contact handle, account ID, food ID/name, raw advisor URL/query, IP address, device identifier, analytics identifier, or identity mapping.
Replace incidental identifying details in a note or quote with `[REDACTED]` before saving.

Retain raw session notes and `ledger.jsonl` only until the anonymous repository decision note has been reviewed, committed, and verified.
At that closure checkpoint, request confirmation immediately before deleting the raw notes and ledger; retain the non-identifying protocol, validator, retention policy, and aggregate decision summary.

## Observation Contract

Each observed session records only these structured fields:

| Field                            | Allowed values                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `session_id`                     | Sequential `SNNN` value                                                                                |
| `status`                         | `completed_valid` or `excluded`                                                                        |
| `observed_at`                    | Local calendar date in `YYYY-MM-DD`                                                                    |
| `task_outcome`                   | `completed`, `stopped`, or `technical_failure`                                                         |
| `candidate_state`                | `ready`, `no_candidates`, `invalid_query`, `data_unavailable`, `current_food_not_found`, `not_reached` |
| `candidate_count`                | Integer `0` through `3`                                                                                |
| `evidence_opened`                | Boolean                                                                                                |
| `health_claim_confusion`         | Boolean                                                                                                |
| `ingredient_exclusion_requested` | Boolean                                                                                                |
| `natural_language_requested`     | Boolean                                                                                                |
| `notes_file`                     | Relative path `sessions/SNNN.md`                                                                       |

The observer scores `evidence_opened` from direct observation rather than an analytics event.
The session note may contain redacted behavioral observations and paraphrased feedback, but the JSONL index contains no free text.

## Pilot Decision Rules

At the eighth valid completed session, choose exactly one outcome:

- `proceed`: participants can obtain useful candidate coverage, understand evidence and unknown states, and use evidence details without interpreting the page as health or safety advice.
- `revise`: the structured workflow is directionally useful, but no-result frequency, unclear uncertainty, or a bounded interaction/data gap blocks the observed tasks.
- `stop`: the structured workflow does not materially aid replacement-food decisions or cannot be used safely after bounded copy and interaction corrections.

If ingredient exclusions recur, write a separate ingredient form/specificity and evidence-ingest plan before exposing a filter.
If `unspecified` comparisons dominate observed tasks, write a separate persistent qualifier and interval-propagation plan instead of weakening literal-evidence rules.
Natural-language input is eligible only after `proceed` and explicit operator approval.
MCP remains later than the natural-language input decision.

## Success Criteria

1. The product contains no pilot analytics code or analytics configuration changes.
   Verify with a scoped source search and the Git changed-path list.
2. The external ledger structure is owner-only and its validator rejects unknown keys, invalid enums, identifiers, duplicate session IDs, missing notes, and more than eight valid sessions.
   Verify with a deliberate failure canary, an empty-ledger pass, and permission inspection.
3. Recruitment stops at exactly eight completed valid sessions.
   Verify with the external validator after every session.
4. The repository receives only one anonymous aggregate decision note and no session-level data.
   Verify with a manual privacy review, `trunk check --no-fix` on changed Markdown paths, and `git diff --check`.

## File Scope

| Path                                                      | Change                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `BLUEPRINT.md`                                            | Record the observed pilot gate, no-analytics boundary, and next-slice sequencing.                   |
| `docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md` | Link its pending release decision to this observed pilot.                                           |
| `docs/plans/2026-08-20-advisor-v0-pilot.md`               | Define the approved observation, privacy, validation, retention, and decision protocol.             |
| `docs/notes/2026-08-20-advisor-v0-pilot-decision.md`      | Future aggregate-only `proceed`, `revise`, or `stop` decision after eight completed valid sessions. |

External operational files are stored under the approved raw ledger root and never staged in Git.
Do not modify product source, a Supabase migration, generated Supabase types, a package manifest, lockfile, cookie, auth path, advisor ranking rule, or ingredient data model.

## Task 1: Lock the Observed Pilot Gate in Product Documentation

**Files:**

- Modify: `BLUEPRINT.md`
- Modify: `docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md`
- Modify: `docs/plans/2026-08-20-advisor-v0-pilot.md`

- [x] **Step 1: Record the approved boundary in `BLUEPRINT.md`**

Immediately after the Advisor v0 product slice, record that:

- Eight completed valid observed sessions end the pilot.
- No product analytics or general visitor tracking is part of the pilot.
- Only non-identifying observer evidence is stored in the external owner-only ledger.
- The structured advisor must receive `proceed` before natural-language input is planned.
- MCP, ingredient filtering, and schema expansion remain separate later decisions.

- [x] **Step 2: Connect the original release gate to this plan**

Update the release-decision prose in `docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md` to link to this plan.
Leave its release-decision checkbox unchecked until Task 4 records the aggregate decision.
Do not check completed implementation steps mechanically.

- [x] **Step 3: Verify documentation consistency**

```bash
rg -n "eight completed valid|product analytics|observed pilot|natural-language|MCP" BLUEPRINT.md docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md docs/plans/2026-08-20-advisor-v0-pilot.md
trunk check --no-fix BLUEPRINT.md docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md docs/plans/2026-08-20-advisor-v0-pilot.md
git diff --check
```

Expected: all three documents agree on the session-count gate, no-analytics boundary, and next-slice ordering.

## Task 2: Provision and Validate the Owner-only Ledger

**External files:**

- Create: `protocol.md`
- Create: `retention-policy.md`
- Create: `ledger.jsonl`
- Create: `validate-ledger.mjs`
- Create: `sessions/TEMPLATE.md`
- Create: `aggregates/decision-summary-template.md`

- [x] **Step 1: Create the external structure**

Create the root plus `sessions/` and `aggregates/` directories with mode `0700`.
Create every file with mode `0600`.
Do not create an identity map or participant contact file.

- [x] **Step 2: Implement a deterministic external validator**

The validator must:

- Parse every non-empty JSONL line.
- Accept only the exact Observation Contract keys and enum values.
- Reject unknown keys, duplicate session IDs, non-sequential IDs, missing note files, absolute note paths, and forbidden identifying keys or strings.
- Require excluded technical failures to use `candidate_state=not_reached` and `candidate_count=0`.
- Report `completed_valid`, `excluded`, and `remaining` counts.
- Reject a ninth `completed_valid` session so recruitment cannot silently exceed the approved gate.

- [x] **Step 3: Prove the validator fails and passes**

Create a throwaway invalid JSONL file under `/tmp` and require a non-zero exit.
Then validate the empty real ledger and require:

```plaintext
completed_valid=0 excluded=0 remaining=8
```

Delete only the explicit throwaway file after the canary.

- [x] **Step 4: Verify permissions and repository separation**

```bash
find /Users/dongminyu/.local/share/catfood-feeder/advisor-v0-pilot -type d -exec stat -f '%Sp %N' {} \;
find /Users/dongminyu/.local/share/catfood-feeder/advisor-v0-pilot -type f -exec stat -f '%Sp %N' {} \;
git -C /Volumes/dongminyu/Development/01_personal/catfood-feeder status --short
git -C /Users/dongminyu/.codex status --short
```

Expected: directories are `drwx------`, files are `-rw-------`, and no ledger path appears in either Git worktree.

## Task 3: Run Eight Directly Observed Sessions

**External files:**

- Modify after each session: `ledger.jsonl`
- Create after each session: `sessions/SNNN.md`

- [ ] **Step 1: Use one fixed observation protocol**

For each session:

1. Confirm consent and assign the next pseudonymous `SNNN` ID in the ledger only.
2. Ask the participant to find a possible next food using the current structured advisor and a real replacement-food task.
3. Observe the result state, candidate count, evidence-detail opening, understanding of unknown/bound language, and any health or safety inference.
4. Ask what blocked the decision and whether ingredient exclusions or natural-language input were needed.
5. Redact incidental identifying information before saving the session note.
6. Validate the ledger and permissions after every write.

- [ ] **Step 2: Count only valid completed sessions**

Stop recruitment as soon as the validator reports `completed_valid=8` and `remaining=0`.
Do not continue to a round participant count or a time deadline.

- [ ] **Step 3: Apply early privacy and safety stops**

Pause before eight if identifying information enters the ledger or participants repeatedly interpret results as medical or safety advice.
Correct and re-verify the boundary before resuming; do not count a compromised session as valid.

## Task 4: Aggregate, Decide, and Route the Next Slice

**Files:**

- Create externally: `aggregates/decision-summary.md`
- Create in repository: `docs/notes/2026-08-20-advisor-v0-pilot-decision.md`
- Modify: `BLUEPRINT.md`
- Modify: `docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md`

- [ ] **Step 1: Validate closure at exactly eight valid sessions**

Require validator output `completed_valid=8 excluded=<count> remaining=0` with no validation errors.

- [ ] **Step 2: Produce a non-identifying aggregate**

The external summary and repository note may contain only:

- Pilot window and valid/excluded session counts.
- Counts for task outcomes, result states, candidate counts, evidence-detail opens, and health-claim confusion.
- Counts of ingredient-exclusion and natural-language requests.
- Repeated interaction themes paraphrased without names, food identifiers, contact details, session IDs, or linkable quotes.
- The selected `proceed`, `revise`, or `stop` outcome and its decision-rule evidence.
- One next slice, or an explicit stop, without bundling ingredient schema, chat, and MCP work.

The repository note must not contain raw transcripts or one-row-per-session data.

- [ ] **Step 3: Review privacy and record the final decision**

Manually review the repository note because pattern matching cannot prove the absence of identifying prose.
Update `BLUEPRINT.md` with the outcome and the single authorized next slice.
Mark the original advisor plan's release-decision checkbox complete only now, linking the aggregate note.

- [ ] **Step 4: Verify the repository aggregate**

```bash
trunk check --no-fix BLUEPRINT.md docs/plans/2026-08-20-evidence-aware-food-advisor-v0.md docs/notes/2026-08-20-advisor-v0-pilot-decision.md
git diff --check
```

- [ ] **Step 5: Close raw-data retention**

After the aggregate decision note is reviewed, committed, and verified, request confirmation immediately before deleting `sessions/SNNN.md` and `ledger.jsonl`.
Retain the protocol, validator, retention policy, and non-identifying external aggregate.

## Execution Checkpoint

Tasks 1 and 2 prepare the pilot without changing the product.
Task 3 requires real observed sessions and cannot be completed from repository code.
Task 4 begins only when the external validator reports exactly eight completed valid sessions.
If any preparation step requires product analytics, a participant identifier, a new dependency, or a database write, stop and revise this plan instead of expanding scope.
