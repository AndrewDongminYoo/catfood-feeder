# Bounded grain-free interpretation and owner confirmation

Issue #49 is the parent acceptance gate for child issues #50–#53.
This PR completes the grain-free interpretation work in #52 and verifies the unchanged behavior of the other children.
After repeated expression-specific review findings, the operator approved a bounded grammar with explicit owner confirmation rather than expanding regex rules to cover arbitrary Korean or English.

## Behavior

Automatically propose a grain exclusion only when every grain-free mention has a supported interpretation and the latest supported intent requests it.
Supported forms retain the existing tested requests, permissions, named withdrawals, and direct confirmation replies.
Within those forms, later recognized requests, permissions, and withdrawals determine the condition in order.
A grain-free mention whose intent is unknown suspends automatic grain exclusion for the entire question, including a separately recognized earlier request or a generic `no grain` clause.
This is pending confirmation, not a withdrawal or permission inferred from ambiguous text.
Other ingredient exclusions and explicit calorie limits remain available.
An explicitly selected condition remains the owner's choice and is not silently removed during question interpretation.

The conditions screen asks `곡물 표기 제외를 적용할까요?` with two actions: `곡물 표기 제외하기` and `곡물 표기 허용하기`.
Until the owner answers, the unresolved requirement remains in the decision and prevents candidates from being presented as eligible.
The answer changes only grain exclusion, clears that confirmation requirement, and becomes a direct owner choice.
Saved decisions and exported briefs reflect the selected condition; historical pending records retain their original state.
The existing unresolved-requirement and snapshot schemas remain compatible.
Model output cannot bypass confirmation or restore a suspended condition using a partial quotation.

## Supported grammar boundary

The regression fixtures define the supported forms, not a promise of complete natural-language understanding.
Representative supported requests are `I want grain-free food` and `그레인프리 사료를 찾아주세요`.
Representative permissions are `grain-free is okay` and `그레인프리도 괜찮아요`.
Representative withdrawals are `I do not need grain-free food` and `그레인프리 사료는 필요 없습니다`.
Direct replies to tested standalone preference-confirmation questions retain their existing withdrawal behavior.
A comparative question such as `Is grain-free better?` has no supported exclusion intent and therefore asks for owner confirmation even beside an earlier request.
Untested wording does not become supported merely because its meaning seems similar to one of these examples.

The current review examples `however, I want grain-free food` and `그레인프리 사료는 필요하지 않습니다` may remain outside the supported grammar.
Their acceptance result is a visible confirmation request with no automatic grain exclusion, not another grammar extension.
This boundary concerns detected grain-free wording; it does not claim to detect every implicit reference or resolve all free-text requests.

## Acceptance

1. Existing supported requests, permissions, withdrawals, and connected transitions retain their tested behavior.
2. Unknown English and Korean grain-free wording produces no inferred grain exclusion and an explicit confirmation requirement, including both current hosted review examples.
3. An accepted model proposal preserves that requirement; a proposal or partial quotation adding grain is rejected.
4. Before confirmation, fully sourced Wheat remains unresolved rather than eligible; either owner answer produces the corresponding saved candidate classification and exported brief.
5. Separate chicken exclusion, an explicit 8% calorie limit, historical snapshots, and the unchanged #50, #51, and #53 behavior remain verified.

## Boundaries

Do not expand generic ingredient matching, protein preference ranking, saved schemas, dependencies, data collection, or database state.
Reuse the existing condition screen and visual styles for the confirmation section.
Source-based security concerns remain a separate incomplete gate and are not waived by this product decision.
