# Source-First Catalog Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human curator register exact product sources, capture their text safely, extract evidence-backed DRAFT nutrients from only that captured text, and retain source-level audit history.

**Scope decision (2026-07-21):** This phase includes charset-aware capture and extraction retry. Transcript preview, per-source status/history, failed-source listing, retry/replace controls, and their component tests are deferred to a separate curator-workspace PR.

**Architecture:** A new private source ledger stores versioned product-source captures and field-level evidence.
Curator-only route handlers own URL fetching, LLM extraction, and draft application.
The existing public `foods` read model remains unchanged and still requires `data_verified_at`.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Supabase Postgres, Supabase SSR and service-role clients, Vitest, Cheerio, Anthropic Messages API.

## Global Constraints

- Humans register or approve the product-specific manufacturer and Korean-label sources.
- No LLM request may browse the web or choose a source URL during a catalog write.
- Every stored nutrient must trace to a product-specific source URL and a captured evidence excerpt.
- Automated draft writes leave `data_verified_at` null.
- Existing `nutrient_sources` remains the source-category map used by catalog readers.
- Derived carbohydrate, energy-ratio, and Ca:P values remain server-derived and receive no source-evidence row.
- Only allowlisted human curators may register sources, extract values, apply drafts, or verify catalog data.
- Automation credentials cannot access the source-registration or source-extraction endpoints.
- No service-role client may enter browser or client-component code.
- Add no price, recall, or public-catalog feature in this work.

---

## File Map

- `package.json` and `pnpm-lock.yaml`: Add the test runner and server-side HTML parser in one lockfile-consistent dependency change.
- `vitest.config.ts`: Alias and Node test configuration for server-side unit tests.
- `src/lib/source-collection.ts`: Pure URL, text-normalization, hash, evidence, and source-state contracts.
- `src/lib/source-fetcher.ts`: Server-only bounded HTTP retrieval and HTML-to-text conversion.
- `src/lib/source-extraction.ts`: Server-only prompt construction, Anthropic request, Zod parsing, and excerpt validation against captured text.
- `src/lib/source-repository.ts`: Server-only typed source-ledger reads and draft-application RPC call.
- `src/app/api/foods/drafts/route.ts`: Curator-only DRAFT inventory endpoint.
- `src/app/api/foods/[id]/sources/route.ts`: Curator-only source registration and capture endpoint.
- `src/app/api/foods/[id]/sources/extract/route.ts`: Curator-only extraction endpoint that reads source rows rather than client text.
- `src/app/api/foods/[id]/sources/apply/route.ts`: Curator-only evidence persistence endpoint that applies accepted candidates transactionally.
- `src/app/new/research/page.tsx`: Server page for the protected research workspace.
- `src/components/source-research-client.tsx`: Client interaction surface for source registration, transcript review, extraction, and explicit DRAFT application.
- `src/types/supabase.d.ts`: Generated-type equivalent updates for the two tables and RPC.
- `supabase/migrations/<generated>_food_source_ledger.sql`: Source/evidence schema, RLS, indexes, and service-role-only transactional RPC.
- `scripts/research-enrich.mjs`: Remove autonomous web-search enrichment so it cannot remain a bypass path.
- `scripts/README.md` and `src/app/new/page.tsx`: Point curators to source-first research while preserving manual new-food entry.

### Task 1: Establish Test and Source-Collection Primitives

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `src/lib/source-collection.ts`
- Create: `src/lib/source-collection.test.ts`

**Interfaces:**

- Produces: `SourceKind`, `SourceCaptureMethod`, `SourceFetchStatus`, `normalizeSourceText`, `hashSourceText`, `isEvidenceExcerpt`, and `isPublicHttpUrl`.
- Consumes: no Next.js request objects or Supabase clients.

- [x] **Step 1: Add a failing source-normalization test.**

Create `src/lib/source-collection.test.ts` with these cases.

```ts
import { describe, expect, it } from "vitest";
import {
  hashSourceText,
  isEvidenceExcerpt,
  normalizeSourceText,
} from "./source-collection";

describe("normalizeSourceText", () => {
  it("matches an evidence excerpt across case and whitespace differences", () => {
    const source = "Crude Protein\n(min.)  37 %";
    const excerpt = "crude protein (min.) 37 %";

    expect(isEvidenceExcerpt(source, excerpt)).toBe(true);
  });

  it("does not accept an excerpt absent from the captured text", () => {
    expect(isEvidenceExcerpt("Crude fat 18%", "Crude protein 37%")).toBe(false);
  });

  it("creates the same SHA-256 hash for equivalent normalized text", () => {
    expect(hashSourceText("Protein  37%\n")).toBe(
      hashSourceText("protein 37%"),
    );
  });
});
```

- [x] **Step 2: Run the test to verify it fails because the module is absent.**

Run: `pnpm exec vitest run src/lib/source-collection.test.ts`

Expected: FAIL with a module-resolution error for `./source-collection`.

- [x] **Step 3: Add Vitest and Cheerio deliberately.**

Run `pnpm add -D vitest` and `pnpm add cheerio`.

Use Cheerio because Node has no browser DOM for reliable HTML-to-text extraction, while source evidence validation requires text that can be reproduced from the fetched page.

Regenerate `pnpm-lock.yaml` with the same pnpm install command and include both manifests in this task.

- [x] **Step 4: Implement the pure source contract.**

Implement the following public contract in `src/lib/source-collection.ts`.

```ts
export const SOURCE_KIND_VALUES = ["manufacturer", "kr_label"] as const;
export type SourceKind = (typeof SOURCE_KIND_VALUES)[number];
export const SOURCE_CAPTURE_METHOD_VALUES = ["fetch", "manual"] as const;
export type SourceCaptureMethod = (typeof SOURCE_CAPTURE_METHOD_VALUES)[number];
export const SOURCE_FETCH_STATUS_VALUES = ["fetched", "failed"] as const;
export type SourceFetchStatus = (typeof SOURCE_FETCH_STATUS_VALUES)[number];

export function normalizeSourceText(value: string): string;
export function hashSourceText(value: string): string;
export function isEvidenceExcerpt(sourceText: string, excerpt: string): boolean;
export function isPublicHttpUrl(value: string): boolean;
```

Normalize with Unicode normalization, collapsed whitespace, trimming, and lowercasing.

Hash normalized text with Node `crypto.createHash("sha256")`.

Accept only `https:` URLs at this pure boundary.

- [x] **Step 5: Run the focused test and type check.**

Run: `pnpm exec vitest run src/lib/source-collection.test.ts && pnpm typecheck`

Expected: PASS.

- [x] **Step 6: Commit the test foundation.**

Run:

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/lib/source-collection.ts src/lib/source-collection.test.ts
git commit -m "test(collection): add source provenance primitives"
```

### Task 2: Add the Private, Versioned Source Ledger

**Files:**

- Create: `supabase/migrations/<generated>_food_source_ledger.sql`
- Modify: `src/types/supabase.d.ts`
- Test: `supabase/migrations/<generated>_food_source_ledger.sql` through the linked Supabase project.

**Interfaces:**

- Produces: `food_sources`, `food_nutrient_evidence`, and `apply_food_evidence_draft(p_food_id bigint, p_evidence jsonb)`.
- Consumes: `foods`, `auth.users`, `nutrient_source`, and `foods.nutrient_sources`.

- [x] **Step 1: Create the migration with the Supabase CLI.**

Run: `supabase migration new food_source_ledger`

Expected: a timestamped migration file appears under `supabase/migrations/`.

- [x] **Step 2: Write a failing database verification query.**

Before applying the migration, run a linked read-only query that selects `food_sources`.

Expected: PostgreSQL reports that relation `food_sources` does not exist.

- [x] **Step 3: Implement the ledger schema.**

Create `food_sources` with these columns and constraints.

```sql
id bigint generated always as identity primary key,
food_id bigint not null references foods(id) on delete cascade,
kind nutrient_source not null check (kind in ('manufacturer', 'kr_label')),
url text not null,
capture_method text not null check (capture_method in ('fetch', 'manual')),
fetch_status text not null check (fetch_status in ('fetched', 'failed')),
failure_code text,
attempted_at timestamptz not null default now(),
captured_at timestamptz,
observed_at timestamptz,
content_hash text,
captured_text text,
created_by uuid references auth.users(id) on delete set null,
is_current boolean not null default true,
created_at timestamptz not null default now()
```

Require `captured_at`, `content_hash`, and `captured_text` when `fetch_status = 'fetched'`.

Require `failure_code` and prohibit captured content when `fetch_status = 'failed'`.

Add a partial unique index allowing one current fetched source for each `(food_id, kind)`.

Create `food_nutrient_evidence` with `food_id`, `nutrient_key`, `source_id`, `value`, `excerpt`, `captured_at`, `is_current`, and `created_at`.

Limit `nutrient_key` to the eight stored nutrient fields.

Add a partial unique index allowing one current evidence row for each `(food_id, nutrient_key)`.

Enable RLS on both tables with no `anon` or `authenticated` policies because captured source text and evidence are curator-only.

- [x] **Step 4: Implement the transactional draft RPC.**

Create `apply_food_evidence_draft` as `SECURITY DEFINER`, `SET search_path = public`, and revoke `PUBLIC` execution.

Grant execution only to `service_role`.

The function receives a JSON array of `{nutrient_key, source_id, value, excerpt}` objects.

It must verify that every source belongs to `p_food_id`, is current, and has `fetch_status = 'fetched'`.

It must mark prior current evidence for each supplied nutrient as non-current, insert the new evidence, update only currently null `foods` nutrient columns, merge the corresponding `manufacturer` or `kr_label` category into `foods.nutrient_sources`, and leave `data_verified_at` unchanged.

It must reject unsupported nutrient keys, duplicate nutrient keys, non-finite values, source-kind mismatch, and excerpts absent from `food_sources.captured_text` after whitespace-and-case normalization.

- [x] **Step 5: Apply and verify the migration.**

Run:

```bash
supabase db push
supabase migration list --linked
supabase db advisors
```

Expected: the migration is listed remotely, the two tables have RLS enabled, and the RPC is not executable by `PUBLIC`, `anon`, or `authenticated`.

- [x] **Step 6: Regenerate the Supabase TypeScript declaration.**

Run the repository’s Supabase type-generation command if configured.

If none exists, update `src/types/supabase.d.ts` from the remote schema output rather than hand-inventing unrelated existing declarations.

Expected: `food_sources`, `food_nutrient_evidence`, and `apply_food_evidence_draft` are present with nullable fields matching the migration.

- [x] **Step 7: Commit the schema boundary.**

Run:

```bash
git add supabase/migrations src/types/supabase.d.ts
git commit -m "feat(schema): add food source provenance ledger"
```

### Task 3: Implement Bounded Source Capture

**Files:**

- Create: `src/lib/source-fetcher.ts`
- Create: `src/lib/source-fetcher.test.ts`
- Create: `src/lib/source-repository.ts`
- Create: `src/app/api/foods/[id]/sources/route.ts`

**Interfaces:**

- Produces: `captureSource`, `createFoodSource`, and `POST /api/foods/:id/sources`.
- Consumes: `SourceKind`, `SourceCaptureMethod`, `food_sources`, `authorizeCurator`, and `createAdminClient`.

- [x] **Step 1: Write failing fetch-policy tests.**

Cover these cases in `src/lib/source-fetcher.test.ts`.

```ts
it("rejects loopback and private resolved addresses", async () => {
  await expect(
    captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      fakePrivateResolver,
    ),
  ).rejects.toMatchObject({ code: "unsafe_destination" });
});

it("rejects a response over the configured byte limit", async () => {
  await expect(
    captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      fakePublicResolver,
      oversizedResponse,
    ),
  ).rejects.toMatchObject({ code: "response_too_large" });
});

it("returns normalized visible HTML text and a SHA-256 hash", async () => {
  const source = await captureSource(
    { url: "https://example.test", kind: "manufacturer" },
    fakePublicResolver,
    htmlResponse("<p>Crude protein 37%</p>"),
  );
  expect(source.capturedText).toContain("Crude protein 37%");
  expect(source.contentHash).toMatch(/^[a-f0-9]{64}$/);
});
```

- [x] **Step 2: Run the tests to verify they fail because `captureSource` is absent.**

Run: `pnpm exec vitest run src/lib/source-fetcher.test.ts`

Expected: FAIL with a missing export or module error.

- [x] **Step 3: Implement server-only capture.**

Use `dns.promises.lookup` with `{ all: true }` before every requested URL and every redirect target.

Reject loopback, link-local, private, multicast, unspecified, and IPv6 unique-local addresses.

Allow only HTTPS, at most three redirects, `text/html` or `text/plain`, a 20-second timeout, one retry for transient network or 5xx errors, and a 256 KiB streamed response limit.

Use Cheerio to remove scripts, styles, and hidden text before collecting visible text.

Return a discriminated `CaptureResult` or `CaptureFailure` rather than throwing expected fetch failures.

- [x] **Step 4: Implement the repository and source route.**

Accept this request body.

```ts
{
  kind: "manufacturer" | "kr_label";
  captureMethod: "fetch" | "manual";
  url: string;
  capturedText?: string;
  observedAt?: string | null;
}
```

Require `capturedText` for `manual` and forbid it for `fetch`.

Use `authorizeCurator` and reject `authorization.origin === "automation"` with HTTP 403.

Confirm the food exists before attempting a fetch.

Insert a failed source row for expected capture failures and return Korean error text with the source ID.

For success, set prior current sources of the same food and kind to `is_current = false`, insert the new current source, and return the captured transcript and metadata.

- [x] **Step 5: Run focused tests and static checks.**

Run: `pnpm exec vitest run src/lib/source-collection.test.ts src/lib/source-fetcher.test.ts && pnpm lint && pnpm typecheck`

Expected: PASS.

- [x] **Step 6: Commit bounded source capture.**

Run:

```bash
git add src/lib/source-fetcher.ts src/lib/source-fetcher.test.ts src/lib/source-repository.ts 'src/app/api/foods/[id]/sources/route.ts'
git commit -m "feat(collection): capture curator-approved food sources"
```

### Task 4: Extract and Apply Evidence-Backed Drafts

**Files:**

- Create: `src/lib/source-extraction.ts`
- Create: `src/lib/source-extraction.test.ts`
- Modify: `src/app/api/extract/route.ts`
- Create: `src/app/api/foods/[id]/sources/extract/route.ts`
- Create: `src/app/api/foods/[id]/sources/apply/route.ts`

**Interfaces:**

- Produces: `extractCapturedSources`, `POST /api/foods/:id/sources/extract`, and `POST /api/foods/:id/sources/apply`.
- Consumes: current fetched `food_sources`, Anthropic API, `apply_food_evidence_draft`, and `NUTRIENT_FIELDS`.

- [x] **Step 1: Write failing extraction validation tests.**

Create tests that prove source IDs and excerpts cannot be fabricated.

```ts
it("drops a nutrient whose excerpt is absent from its cited source", () => {
  const sources = [
    {
      id: 11,
      kind: "manufacturer" as const,
      capturedText: "Crude protein 37%",
    },
  ];
  const output = [
    {
      nutrientKey: "protein_pct",
      sourceId: 11,
      value: 37,
      excerpt: "Crude protein 40%",
    },
  ];

  expect(validateExtractedEvidence(output, sources)).toEqual([]);
});

it("drops a nutrient that cites a source from the wrong source set", () => {
  const sources = [
    {
      id: 11,
      kind: "manufacturer" as const,
      capturedText: "Crude protein 37%",
    },
  ];
  const output = [
    {
      nutrientKey: "protein_pct",
      sourceId: 12,
      value: 37,
      excerpt: "Crude protein 37%",
    },
  ];

  expect(validateExtractedEvidence(output, sources)).toEqual([]);
});
```

- [x] **Step 2: Run the tests to verify the shared extractor is absent.**

Run: `pnpm exec vitest run src/lib/source-extraction.test.ts`

Expected: FAIL with a missing module error.

- [x] **Step 3: Implement a shared, source-ID-aware extractor.**

Move the current Anthropic request, response schema, and evidence normalization from `src/app/api/extract/route.ts` into `src/lib/source-extraction.ts`.

The new prompt accepts an array of `{id, kind, capturedText}` records and requires `{nutrientKey, sourceId, value, excerpt}` for every candidate nutrient.

Use `AbortSignal.timeout(30_000)` and retain the current Korean user-facing API errors.

Validate the returned source ID, nutrient key, numeric value, and excerpt before returning candidates.

Keep the existing `/api/extract` request and response contract working by adapting its two manual text blocks into synthetic source records without database IDs.

- [x] **Step 4: Implement extraction and explicit apply routes.**

The extraction route accepts `{ sourceIds: number[] }`, limits selection to one manufacturer and one Korean-label current fetched source for that food, and returns validated candidate evidence without writing food nutrients.

The apply route accepts `{ evidence: Array<{ nutrientKey: string; sourceId: number; value: number; excerpt: string }> }`.

It re-reads the selected sources, revalidates every excerpt, invokes only `apply_food_evidence_draft`, and returns the changed draft fields.

Both routes require a human curator and return HTTP 403 for automation credentials.

- [x] **Step 5: Run extraction tests and type checks.**

Run: `pnpm exec vitest run src/lib/source-extraction.test.ts && pnpm lint && pnpm typecheck`

Expected: PASS.

- [x] **Step 6: Commit extraction and application.**

Run:

```bash
git add src/lib/source-extraction.ts src/lib/source-extraction.test.ts src/app/api/extract/route.ts 'src/app/api/foods/[id]/sources/extract/route.ts' 'src/app/api/foods/[id]/sources/apply/route.ts'
git commit -m "feat(collection): extract evidence from captured sources"
```

### Task 5: Provide the Curator Research Workspace

**Files:**

- Create: `src/app/api/foods/drafts/route.ts`
- Create: `src/app/new/research/page.tsx`
- Create: `src/components/source-research-client.tsx`
- Modify: `src/app/new/page.tsx`

**Interfaces:**

- Produces: `/new/research` and curator-only draft inventory, source capture, extraction, and apply interactions.
- Consumes: the Task 3 and Task 4 endpoints.

- [ ] **Step 1: Write a failing component test for the source-first action order.** — NOT DONE: needs jsdom + a React testing library, deferred with the workspace UI work.

Use a mocked HTTP boundary only for the component’s fetch calls.

The test must show that the extract button is disabled until at least one source has `fetch_status = "fetched"`, and the apply button is disabled until validated candidates are displayed.

- [ ] **Step 2: Run the component test to verify it fails before the workspace exists.** — NOT DONE: needs jsdom + a React testing library, deferred with the workspace UI work.

Run: `pnpm exec vitest run src/components/source-research-client.test.tsx`

Expected: FAIL with a missing component error.

- [x] **Step 3: Implement the draft inventory endpoint.**

Return only foods with `data_verified_at IS NULL`.

Select the food ID, product name, brand name, current sources, and research state.

Require a human curator and never return `captured_text` from this inventory endpoint.

- [ ] **Step 4: Implement the complete research page and client.** — PARTIAL: source registration, extraction candidates, and explicit DRAFT apply are implemented; transcript preview, per-source status/history, and failed-source controls are deferred by the scope decision above.

Add a visible link from `/new` to `/new/research`.

The page shows one unverified product at a time, separate manufacturer and Korean-label URL fields, an optional manual transcript path, source capture status, captured transcript preview, evidence candidates, and an explicit `DRAFT로 적용` action.

Display `captured_at`, `observed_at`, URL, source kind, and failure reason for every source.

Do not expose source transcript or evidence on public catalog pages.

- [ ] **Step 5: Run the focused component test and browser scenario.** — NOT DONE: needs jsdom + a React testing library, deferred with the workspace UI work.

Run: `pnpm exec vitest run src/components/source-research-client.test.tsx && pnpm lint && pnpm typecheck`

Then use Playwright against a local authenticated curator session to prove this sequence: select draft, register manual source, review capture, extract candidates, apply DRAFT, and observe no public verification timestamp. The 2026-07-21 smoke test proved every step except the deferred in-UI capture review.

Expected: PASS and the public catalog remains unchanged for the DRAFT food.

- [x] **Step 6: Commit the curator workflow.**

Run:

```bash
git add 'src/app/api/foods/drafts/route.ts' src/app/new/research/page.tsx src/components/source-research-client.tsx src/app/new/page.tsx
git commit -m "feat(collection): add curator source research workspace"
```

### Task 6: Retire Autonomous Enrichment and Verify the Full Boundary

**Files:**

- Delete: `scripts/research-enrich.mjs`
- Modify: `scripts/README.md`
- Modify: `docs/specs/2026-07-15-source-first-catalog-collection.md`

**Interfaces:**

- Produces: no executable path that gives an LLM web-search authority during catalog writes.
- Consumes: the curator workspace as the supported replacement.

- [x] **Step 1: Add a failing repository guard test.**

Create a small Node test that fails when `scripts/research-enrich.mjs` exists or when a catalog collection module contains the Anthropic `web_search` tool identifier.

- [x] **Step 2: Run the guard test to prove the old autonomous path still exists.**

Run: `pnpm exec vitest run src/lib/source-first-boundary.test.ts`

Expected: FAIL because the legacy script contains `web_search_20260209`.

- [x] **Step 3: Remove the legacy script and update operator documentation.**

Delete `scripts/research-enrich.mjs`.

Replace its README section with the `/new/research` source-first procedure and explain that manual text is for product labels that cannot be safely fetched as HTML or plain text.

Update the design spec’s migration section with the completed `fetch_status`, `failure_code`, and `attempted_at` fields so the document matches the migration.

- [x] **Step 4: Run all verification gates.**

Run:

```bash
pnpm exec vitest run
pnpm lint
pnpm typecheck
pnpm build
pnpm exec knip
trunk check
supabase db advisors
```

Expected: all repository checks pass, the old `web_search` collection path is absent, and Supabase advisors report no new security issue.

- [x] **Step 5: Perform a remote data smoke test.**

Use one existing unverified ACANA or Orijen food row.

Capture a known product-specific source, run extraction, apply only source-backed candidates, and re-query the food, source, and evidence rows.

Expected: the row remains DRAFT, each applied nutrient has one current evidence row, and public `getFoods()` still excludes it.

- [x] **Step 6: Commit the retirement and documentation.**

Run:

```bash
git add -A scripts docs/specs src/lib/source-first-boundary.test.ts
git commit -m "refactor(collection): retire autonomous web enrichment"
```

## Plan Self-Review

Spec coverage maps to tasks as follows.

- Source timestamps, hashes, captured text, and field evidence are implemented by Task 2.
- Bounded collection and independent failure records are implemented by Task 3.
- Captured-text-only extraction and evidence verification are implemented by Task 4.
- Curator review before DRAFT application is implemented by Task 5.
- Retirement of autonomous web search and full security verification are implemented by Task 6.

The plan contains no placeholder implementation steps.

The only new runtime dependency is Cheerio, justified by the absence of a server-side DOM in the existing dependency set.

The only new development dependency is Vitest, justified by the repository’s lack of a test runner and the need for failing-first tests around SSRF protection and provenance validation.
