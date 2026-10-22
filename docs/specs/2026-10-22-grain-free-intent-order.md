# Grain-free intent order and formal withdrawals

Issue #49 is the parent acceptance gate for completed child issues #50–#53.
This change addresses the two unmet #52 conditions reproduced in PR #55 review comments 4332513025 and 4332513028, plus the same child's ambiguous-context omission found during local review.
These are existing negation, explicit-request, and ambiguous-context requirements, so no new issue or child-state change is needed.

## Behavior

Recognize formal Korean named withdrawals such as `그레인프리 사료는 필요 없습니다` alongside the existing conversational forms.
The latest recognized grain-free request, permission, or withdrawal determines the condition.
Recognized transitions retain their order when joined with commas or contrastive conjunctions within one sentence.
An earlier permission must not veto a later explicit request; a later permission or withdrawal must not retain an earlier hard request.
Ambiguous mentions remain unresolved and must not silently erase a separately supported request.
A short negative reply to a comparative question such as `Is grain-free better?` does not retract an earlier separate request.
Direct replies to a standalone grain-free confirmation question retain their existing withdrawal behavior.
This includes `Do you want grain-free food? No.` and `그레인프리로 할까요? 아니요.`; these preference confirmations do not resolve comparative questions.
Preserve other ingredient exclusions and explicit calorie limits.
Model proposals must match the full question and may not restore a withdrawn condition using a partial quotation.

## Acceptance

1. A request followed by a formal Korean withdrawal produces no grain exclusion and no unresolved requirement for that handled withdrawal.
2. Permission followed by an explicit request produces a grain exclusion without an artificial ambiguity warning.
3. The opposite ordering and repeated request/permission/withdrawal transitions preserve their actual order.
4. Offline UI, saved requests, candidate classification, and exported briefs agree, using complete Wheat evidence and an independently supported calorie difference.
5. Existing #50, #51, and #53 reproductions and acceptance checks remain passing before #49 is closed.

## Boundaries

Do not change generic ingredient matching, protein preference ranking, question reinterpretation state, saved schemas, dependencies, data collection, or database state.
No UI layout or style change is planned.
This is one #52 follow-up PR; verification of the other children does not authorize new fixes for them.
If another child criterion fails, retain #49 and report that separate work instead of expanding this diff.
