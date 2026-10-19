# Next Food Decision Delivery Evidence

Date: 2026-10-18.
Scope: The consumer question-to-decision flow approved in this session.

## Delivered behavior

The application starts at `/advisor` with a question, current-food selection or manual calorie baseline, ingredient-label exclusions, and an editable calorie-density tolerance.
AI proposes visible conditions; deterministic code checks matching catalog evidence.
Unsupported requests remain unresolved until the owner explicitly leaves them out of this comparison.
Clinical and unsupported life-stage requests stop the flow.
The result separates met, failed, and unknown conditions, preserves literal sources and dates, and supplies follow-up questions.
Owners can select a candidate, record a reason, save the exact historical brief in this browser, restore it, explicitly recheck current data, download Markdown, and open an unverified seller search.

## Automated verification

| Command                                     | Observed result                              | What it inspects                                                                                                                     |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                                 | 66 files, 542 tests passed                   | Domain evidence rules, interpreter validation, HTTP boundaries, storage and component interactions, and existing regression coverage |
| `pnpm typecheck`                            | Passed                                       | TypeScript consistency                                                                                                               |
| `pnpm lint`                                 | Passed                                       | Configured ESLint rules                                                                                                              |
| `pnpm build`                                | Passed                                       | Production compilation and route generation                                                                                          |
| `pnpm exec knip`                            | Passed with two existing configuration hints | Unused-code analysis; hints concern the Supabase dependency ignore and CSS extension configuration                                   |
| Scoped `trunk check --filter=markdownlint`  | Passed                                       | Active changed Markdown documents                                                                                                    |
| `git diff --check`                          | Passed                                       | Whitespace errors in tracked changes                                                                                                 |
| `codex doctor --summary --ascii --no-color` | 23 OK, 3 notes, 1 warning, 0 failures        | Advisory Codex environment diagnostics, not product correctness                                                                      |

Independent read-only correctness and first-use reviews completed.
Material findings were repaired with failing regression tests followed by passing tests: ambiguous grain and protein labels, invented AI constraints, clinical/life-stage coverage, complete failed-candidate exports, and unsupported exclusions being silently omitted.
Additional component coverage verifies that selecting a candidate focuses the reason field and that stored snapshots survive catalog changes.
The production browser session reported no JavaScript errors during the final pass.

## Observed runtime scenario

This is a hypothetical QA example, not the operator's cat profile or a personalized health recommendation.

- Question: “지금 먹는 사료와 열량 차이는 10% 이내로, 닭고기 표기는 빼고 싶어요.”
- Current food: ACANA Grasslands, catalog ID 141, evidence-backed baseline 3,930 kcal/kg.
- Real AI interpretation visibly populated chicken exclusion and a 10% tolerance.
- Result at the observed catalog state: 4 met, 40 unknown, and 67 failed candidates.
  Known kitten and therapeutic products are excluded from this adult, non-prescription comparison.
- The first candidate was ACANA Pacifica at 3,930 kcal/kg, a displayed 0.0% change.
  Preference sensitivity showed 4 eligible at 5%, 4 at 10%, and 5 at 15%.
- A candidate and an explicitly labeled QA reason were saved in the isolated browser session, restored after a production-server restart, and rechecked against the current catalog.
  The original saved version remained separate.
- Clicking a candidate focused `decision-reason` in the actual browser.
- A real Markdown download was inspected for the question, selected candidate, reason, failed conditions, and source links.
  An empty-input negative control failed before the actual artifact passed that check.
- At a 375px viewport, document and body scroll widths both measured 375px.
  The screenshots below were also visually inspected for the entry, summary, and comparison content.

## Rendered evidence

- [Desktop entry](2026-10-18-decision-qa/desktop-entry.png)
- [Desktop result](2026-10-18-decision-qa/desktop-result.png)
- [Mobile result](2026-10-18-decision-qa/mobile-result.png)
- [Mobile candidate](2026-10-18-decision-qa/mobile-candidate.png)

The named isolated browser session `catfood-decision` was closed after verification.
Its QA saved record does not populate the operator's regular browser.
The production server was left running at `http://localhost:3000` using `pnpm start --hostname 127.0.0.1`.

## Limits and provenance

This release supports adult, non-prescription dry-food comparisons using published catalog evidence.
Label exclusions do not establish allergy safety, clinical suitability, palatability, or cross-contact absence.
Calorie tolerance is an owner preference, not a medical threshold.
Minimum and maximum nutrient declarations remain bounds; unspecified bounds are labeled rather than treated as exact measured quantities.
Seller searches do not verify stock, price, destination market, or formulation.
Snapshots are stored in the current browser only and can be downloaded; they are not account-synchronized or automatically monitored.
No deployment, schema migration, RLS change, remote push, payment, or purchase occurred.

The supplied Google document informed the separation of AI proposals, evidence checks, and decisions.
Oracle retrieval was attempted but blocked before a project query by its canonical-identity gate: `[PARTIAL]`, not an absence-of-precedent claim.
The authoritative current product direction is [product-direction.md](../product-direction.md), supported by the [implementation spec](../specs/2026-10-18-next-food-decision.md).
