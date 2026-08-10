#!/usr/bin/env node
// PostgREST caps every response at `max_rows` (1000 by default) and returns the
// truncated page with no error — a plain `.select()` past that count is silently
// wrong for anything whose caller treats the result as complete (a dedup Set, an
// "already handled" filter, a backed-by-evidence check). release-stranded.mjs hit
// this for real: `food_nutrient_evidence` crossed 1501 rows and the unbounded query
// came back with 1000, so 501 rows' worth of sources were misclassified as
// unbacked and retired.
//
// This walks a query in pages via `.range()` until a short page proves nothing is
// left, so the result is provably complete regardless of table size.
//
// The builder passed in MUST end in a deterministic `.order()` on a unique column
// (this schema's tables are all `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY
// KEY` — order by that). Without it, Postgres is free to hand back rows in a
// different order per page and skip some across the page boundary.
const PAGE_SIZE = 1000;

/**
 * @param {(from: number, to: number) => Promise<{data: unknown[] | null, error: unknown}>} buildQuery
 * @param {number} [pageSize]
 */
export async function selectAll(buildQuery, pageSize = PAGE_SIZE) {
  // PostgREST clamps a page DOWN to max_rows, never up — asking for more per page
  // than the server will ever return means every page comes back shorter than
  // `pageSize`, which the loop's own stop condition below (page.length < pageSize)
  // would then read as "no more rows" and return early. Reject the knob itself
  // instead of silently reproducing the truncation this helper exists to prevent.
  if (pageSize > PAGE_SIZE) {
    throw new Error(
      `selectAll: pageSize ${String(pageSize)} exceeds PostgREST max_rows (${String(PAGE_SIZE)})`,
    );
  }
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    // A page wider than the range we asked for means the builder never applied
    // `.range()`, or the server's max_rows is above our PAGE_SIZE. Either way the
    // `page.length < pageSize` stop below can never fire, so the loop would spin
    // forever — fail loud instead of hanging.
    if (page.length > pageSize) {
      throw new Error(
        `selectAll: server returned ${String(page.length)} rows for a ${String(pageSize)}-row page — .range() was ignored or max_rows exceeds ${String(pageSize)}`,
      );
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
