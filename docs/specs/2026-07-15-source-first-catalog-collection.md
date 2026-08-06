# Source-First Catalog Collection

> Status: Historical implementation decision, partially superseded on 2026-08-05.
> The [AI-Native Catalog Turnaround](../notes/2026-08-05-ai-native-catalog-turnaround.md) replaces human-only source discovery and the blanket prohibition on research-agent credentials as forward-looking product constraints.
> This document remains authoritative for retained captures, literal evidence, per-field provenance, conflict preservation, and bounded server-side writes, and it records the workflow that led to the current implementation.
> The current code still enforces human-only source discovery and evidence application. The replacement path implemented so far is the explicit publication of an existing evidence-backed DRAFT without value re-entry.

## Decision

Replace autonomous LLM web search in the catalog-enrichment path with a source-first workflow.

Humans register or approve the product-specific manufacturer and Korean-label sources.

The system fetches those exact sources with bounded requests.

The LLM receives only the captured source text and returns structured candidate values with literal evidence excerpts.

No LLM request may browse the web or choose a source URL during a catalog write.

## Goals

- Make every stored nutrient traceable to a product-specific source URL and a captured evidence excerpt.
- Prevent a slow or failed external search from blocking unrelated products.
- Preserve the distinction between machine-collected drafts and human-verified catalog data.
- Retain enough collection history to decide when a product needs refresh.

## Current Phase Scope

The current implementation phase covers source registration, charset-aware capture, extraction retry, evidence validation, and DRAFT apply.
Transcript preview, per-source status/history, failed-source listing, and retry/replace controls are explicitly deferred to a separate curator-workspace PR.
Requirements marked **DEFERRED** below remain product requirements, but are not acceptance gates for the current phase.

## Non-Goals

- This does not automate price collection, Korean recall synchronization, or catalog publication.
- This does not make source text or LLM output public without curator review.
- This does not replace the public-food publication gate: database RLS exposes only rows where `data_verified_at IS NOT NULL` to `anon` and `authenticated` clients.

## Current Timestamp Coverage

`foods.created_at` records when the food row was created.

`foods.updated_at` is updated by a database trigger whenever the food row changes.

`foods.data_verified_at` records the last human verification time.

`food_sources.captured_at` records when a fetched or manually transcribed source was captured.

`food_sources.observed_at` records the source page or label observation time when known.

`food_sources.content_hash` identifies repeated source content, and `food_nutrient_evidence.created_at` records when field-level evidence was applied.

The retired food-level `research_attempted_at` and `research_last_result` columns were removed after the source ledger replaced autonomous research state.

## Approaches Considered

### Keep Autonomous LLM Search

This minimizes manual URL entry but couples source discovery, retrieval, extraction, and model availability into one long-running request.

The observed stalled product request is an example of its poor failure isolation.

This approach is rejected.

### Use a Fixed Domain Allowlist

This is fast for a small set of manufacturers but fails when valid Korean importer or retailer label sources vary by brand.

It would also create an ongoing allowlist-maintenance task.

This approach is rejected.

### Register Sources First, Then Extract

This separates source choice from extraction.

It makes each source reviewable before a model sees it and allows retries to be scoped to a single URL or extraction request.

This is the selected approach.

## Data Model

Add a `food_sources` table with one row per captured product source.

| Field            | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `id`             | Immutable source identifier.                                   |
| `food_id`        | The existing food row that the source describes.               |
| `kind`           | `manufacturer` or `kr_label`.                                  |
| `url`            | Canonical product-specific source URL.                         |
| `captured_at`    | When this service fetched or a curator entered the source.     |
| `observed_at`    | Optional date printed on the source or label, when available.  |
| `content_hash`   | SHA-256 hash of normalized captured text for change detection. |
| `captured_text`  | The bounded source transcript used for extraction and review.  |
| `capture_method` | `manual` or `fetch`.                                           |
| `fetch_status`   | `fetched` or `failed`; failed attempts stay in the ledger.     |
| `failure_code`   | Why a fetch attempt failed, when `fetch_status` is `failed`.   |
| `attempted_at`   | When the capture was attempted, including failed attempts.     |
| `is_current`     | Whether this is the live source for its `(food_id, kind)`.     |
| `created_by`     | Nullable authenticated curator identity for manual entries.    |
| `created_at`     | Row creation time.                                             |

Add a `food_nutrient_evidence` table with one row for each current nutrient value backed by a source.

| Field          | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `food_id`      | The existing food row.                                             |
| `nutrient_key` | A supported nutrient field such as `protein_pct` or `kcal_per_kg`. |
| `source_id`    | The exact `food_sources` row used for the value.                   |
| `value`        | The source-backed numeric value before server-side derivation.     |
| `excerpt`      | Literal evidence excerpt from `captured_text`.                     |
| `captured_at`  | Copied source capture time for efficient audit reads.              |
| `is_current`   | Whether this row is the live evidence for its nutrient.            |
| `created_at`   | Evidence-row creation time.                                        |

Enforce one current evidence row for each `(food_id, nutrient_key)` pair.

Keep `foods.nutrient_sources` as the public and filtering-compatible source category map.

Keep `manufacturer_url` and `kr_label_source` during migration for existing readers, but populate them from the latest matching `food_sources` row.

Do not add a food-level `collected_at` field because one food can combine manufacturer and Korean-label sources collected at different times.

## Collection Workflow

1. A curator selects an existing DRAFT food row and enters one or two product-specific source URLs.
2. The server authorizes the curator before fetching any URL.
3. The fetcher validates the scheme, resolves and rejects private or loopback network destinations, follows only bounded redirects, applies a response-size limit, and uses a request timeout with one retry.
4. The server stores a normalized transcript, canonical URL, hash, capture method, and capture timestamp in `food_sources`.
5. **DEFERRED:** The curator can inspect the transcript before requesting extraction.
6. The extraction request sends only selected `food_sources.captured_text` values to the LLM.
7. The LLM returns candidate values, source kind, source ID, and literal evidence excerpts.
8. The server verifies that every excerpt appears in the cited captured transcript before inserting `food_nutrient_evidence` and updating missing DRAFT food fields.
9. The server updates `nutrient_sources` from the evidence source kind and leaves `data_verified_at` null.
10. A human curator reviews the evidence and uses the existing validated catalog-write path to compute derived values and set `data_verified_at`.

When a newer capture of the same source kind repeats the current evidence value, the server keeps the food value and replaces its current evidence with the new capture.
When that newer same-kind capture proposes a different value, the server returns `conflict`, leaves the food value and current evidence unchanged, and keeps the candidate visible for curator review.
When a different source kind overlaps a populated nutrient, the server returns `skipped` and preserves the existing value and provenance regardless of capture order.
Missing nutrients remain append-only and return `applied` when stored.

```mermaid
sequenceDiagram
  participant Client as SourceResearchClient
  participant Route as POST /api/foods/[id]/sources/apply
  participant Repository as source-repository
  participant RPC as apply_food_evidence_draft
  participant Foods as foods
  participant Sources as food_sources
  participant Evidence as food_nutrient_evidence

  Client->>Route: Submit evidence candidates
  Route->>Repository: Load cited current fetched sources
  Repository->>Sources: Select sources by food and source ID
  Sources-->>Repository: Current source captures
  Repository-->>Route: Source captures
  Route->>Route: Validate source IDs, values, and literal excerpts
  Route->>Repository: Apply validated evidence
  Repository->>RPC: Call with food ID and evidence array
  RPC->>Foods: Lock the DRAFT food row

  loop Each evidence candidate
    RPC->>Sources: Revalidate current fetched source
    RPC->>Evidence: Read exact current evidence value and source kind
    alt Nutrient is missing
      RPC->>Foods: Write value, source tag, and updated_at
      RPC->>Evidence: Insert current evidence
      Note right of RPC: applied
    else Same kind and exact evidence value
      RPC->>Evidence: Retire prior current evidence and insert refreshed evidence
      Note right of RPC: applied; foods remains unchanged
    else Same kind and changed evidence value
      Note right of RPC: conflict; value and evidence remain unchanged
    else Different source kind overlap
      Note right of RPC: skipped; value and provenance remain unchanged
    end
  end

  RPC-->>Repository: Per-candidate result array
  Repository->>Repository: Parse results and verify cardinality
  Repository-->>Route: applied, skipped, or conflict results
  Route-->>Client: Return results
  Client->>Client: Clear applied and skipped candidates; retain conflicts
```

## Failure Policy

Each source fetch is independent.

A timeout, non-success response, unsupported content type, oversized response, or source mismatch records a failed source attempt and leaves food nutrients unchanged.

**DEFERRED:** The UI must show the failed source and allow a curator to replace its URL or retry it.

The LLM extraction request has its own timeout and one retry.

An extraction failure leaves captured source rows available for a later retry and never causes source discovery to run again.

## Security and Provenance Rules

Only an allowlisted human curator can register sources, request extraction, review evidence, or verify catalog data.

Automation credentials cannot call the source-registration or extraction endpoints.

The service-role client remains server-only.

The server does not trust a client-supplied nutrient value, source category, source ID, evidence excerpt, or verification timestamp.

All draft writes are transactional so a food field and its evidence record are updated together.

Derived carbohydrate, energy-ratio, and Ca:P values remain server-derived and do not receive source evidence rows.

## Migration and Backfill

Existing `manufacturer_url` and `kr_label_source` values seed `food_sources` only when they are product-specific and reachable or manually confirmed.

Existing values without retained evidence remain legacy DRAFT data until a curator re-collects a source.

The ACANA regression fixture remains a domain-calculation test fixture and is not imported as evidence for another product.

## Acceptance Criteria

- **DEFERRED:** A curator can save an exact source URL and see its capture time and transcript before extraction.
- A stalled source request fails within the configured timeout and does not prevent processing another food.
- A DRAFT nutrient update has a matching evidence row whose excerpt appears in the retained source transcript.
- A source URL can be refreshed without invoking web search or modifying unrelated food rows.
- Public catalog queries and direct Data API reads exclude rows without `data_verified_at`; authorized curator routes retain DRAFT access through the server-only service-role client.
