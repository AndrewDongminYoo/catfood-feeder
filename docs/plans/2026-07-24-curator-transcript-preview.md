# Curator Transcript Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human curator inspect each current fetched source URL, capture time, source kind, and transcript before requesting nutrient extraction.

**Architecture:** Extend the existing curator-only Draft list response with `captured_text`, validate it at the client boundary, and render current fetched sources as collapsed native disclosure panels immediately before the extraction action. Preserve the existing one-column research workflow, server-only service-role access, and extraction request contract.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict mode, Zod, Vitest, jsdom, Testing Library, CSS.

## Global Constraints

- `docs/specs/2026-07-15-source-first-catalog-collection.md` remains the product contract; do not create or expand a separate feature specification.
- Draft access remains behind `authorizeCurator`; automation credentials remain denied and no RLS policy is changed.
- Only current sources with `fetch_status === "fetched"` appear in the preview and extraction request.
- The preview shows source kind, exact URL, capture time, and retained transcript before the extraction button.
- Long transcripts start collapsed through native `<details>` behavior and preserve source line breaks when expanded.
- Korean user-facing strings remain Korean.
- Reuse the existing `card`, `panel`, `muted`, and action primitives from `DESIGN.md`; introduce no new tokens, animation, or component abstraction.
- Update `package.json` before regenerating `pnpm-lock.yaml`; never hand-edit the lockfile.
- Use `CI=true` for every `pnpm` command.

---

### Task 1: Component Test Harness and Preview Contract

**Files:**

- Modify: `package.json`
- Generated: `pnpm-lock.yaml`
- Create: `src/components/source-research-client.test.tsx`

**Interfaces:**

- Consumes: the existing `GET /api/foods/drafts` response and mounted `SourceResearchClient`.
- Produces: a component-level regression contract for collapsed transcript disclosure, source metadata, and DOM order before extraction.

- [x] **Step 1: Add the minimum DOM test dependencies**

Add `@testing-library/react` and `jsdom` to `devDependencies`, then regenerate the lockfile:

```bash
CI=true pnpm install --no-frozen-lockfile
```

Expected: `package.json` and `pnpm-lock.yaml` agree, with no production dependency change.

- [x] **Step 2: Write the failing component tests**

Create a jsdom test that returns one Draft food with a current fetched manufacturer source containing `captured_text`.
Render `SourceResearchClient`, wait for the Draft response, and assert:

```typescript
expect(screen.getByText("제조사 출처 원문")).toBeInTheDocument();
expect(screen.getByRole("link", { name: sourceUrl })).toHaveAttribute(
  "href",
  sourceUrl,
);
expect(screen.getByText(transcript).closest("details")).not.toHaveAttribute(
  "open",
);
```

In a separate test, assert that the transcript disclosure precedes the `수집 원문에서 추출` button in document order.
Use one narrow `fetch` stub because HTTP is the component's existing boundary; do not add production-only seams.

- [x] **Step 3: Verify RED**

```bash
CI=true pnpm test -- src/components/source-research-client.test.tsx
```

Expected: FAIL because the Draft schema rejects the missing client field and the transcript disclosure does not exist.

### Task 2: Draft Response and Transcript Preview

**Files:**

- Modify: `src/app/api/foods/drafts/route.ts`
- Modify: `src/components/source-research-client.tsx`
- Create: `src/components/source-transcript-previews.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `food_sources.captured_text` from the curator-only Supabase select.
- Produces: collapsed `<details>` panels for current fetched sources without changing the extraction POST body.

- [x] **Step 1: Expose retained transcript text**

Add `captured_text` to the nested `food_sources` select in `GET /api/foods/drafts`.
Keep authorization, Draft filtering, ordering, and result limits unchanged.

- [x] **Step 2: Validate and render the preview**

Add nullable `captured_text` to `sourceSchema`.
Pass `fetchedSources` to a focused `SourceTranscriptPreviews` component so the existing research client remains below the project code-size limit.
For each source, render:

```tsx
<details className="source-preview panel">
  <summary>{sourceKindLabel(source.kind)} 출처 원문</summary>
  <dl className="source-meta">
    <div>
      <dt>URL</dt>
      <dd>
        <a href={source.url} rel="noreferrer" target="_blank">
          {source.url}
        </a>
      </dd>
    </div>
    <div>
      <dt>수집 시각</dt>
      <dd>
        <time dateTime={source.captured_at ?? undefined}>
          {formatCapturedAt(source.captured_at)}
        </time>
      </dd>
    </div>
  </dl>
  <pre>{source.captured_text}</pre>
</details>
```

Place the preview list after the fetched-source status and before the extraction button.
Use explicit Korean labels for `manufacturer` and `kr_label`.

- [x] **Step 3: Apply existing visual tokens**

Style only `.source-preview` and `.source-meta`.
Use existing CSS custom properties, keep URL and transcript text wrap-safe, preserve transcript whitespace, and keep `<details>` collapsed by default.

- [x] **Step 4: Verify GREEN**

```bash
CI=true pnpm test -- src/components/source-research-client.test.tsx
```

Expected: PASS for collapsed metadata/transcript preview and its position before extraction.

### Task 3: Regression and Surface Verification

**Files:**

- Verify only: all changed files from Tasks 1 and 2

**Interfaces:**

- Consumes: the final feature branch worktree.
- Produces: compiler, lint, unit, dependency, build, and browser evidence for the current source.

- [x] **Step 1: Run repository verification**

```bash
CI=true pnpm typecheck
CI=true pnpm lint
CI=true pnpm test
CI=true pnpm exec knip
trunk check
CI=true pnpm build
```

Expected: all commands exit zero; Trunk may report only its explicitly grandfathered existing issues.

- [x] **Step 2: Verify the real curator surface**

Run the production build and inspect `/new/research` at 375px, 768px, and 1280px.
Confirm:

```plaintext
1. Current fetched source metadata is visible before extraction.
2. Transcript content is hidden until the native disclosure is opened.
3. Opening the disclosure preserves transcript line breaks and does not overflow horizontally.
4. URL and capture time remain readable at every viewport.
5. Keyboard focus and disclosure toggling work without a mouse.
```

- [x] **Step 3: Record completion**

Update this plan's checkboxes only after the corresponding command or observable check succeeds.
