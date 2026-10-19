export type AdequacyDeclarationDraft = {
  status: "draft";
  statement: string;
  standard: "AAFCO" | "FEDIAF" | "unspecified";
  method: "formulation" | "feeding_trial" | "product_family" | "unspecified";
  lifeStage:
    | "adult_maintenance"
    | "growth"
    | "growth_reproduction"
    | "growth_maintenance"
    | "all_life_stages"
    | "unspecified";
  species: "cat" | "dog" | "unspecified";
  edition: null;
};

/** Collect literal declarations for review, never a certification or numeric compliance verdict. */
export function extractAdequacyDeclarations(
  sourceText: string,
): AdequacyDeclarationDraft[] {
  const text = sourceText.replace(/\s+/g, " ").trim();
  const anchors =
    /\b(?:is|are) formulated to meet\b|\banimal feeding tests? using\b|\bcomparable in nutritional adequacy\b|\bmeets? the (?:AAFCO|FEDIAF)\b|(?:AAFCO|FEDIAF)[^.!?|]{0,120}(?:충족|제조)/gi;
  const declarations = new Map<string, AdequacyDeclarationDraft>();
  for (const anchor of text.matchAll(anchors)) {
    const at = anchor.index;
    const boundary = Math.max(
      text.lastIndexOf(". ", at),
      text.lastIndexOf("! ", at),
      text.lastIndexOf("? ", at),
      text.lastIndexOf("|", at),
    );
    let start =
      boundary < 0
        ? Math.max(0, at - 350)
        : Math.max(boundary + (text[boundary] === "|" ? 1 : 2), at - 350);
    const prefixStart = start;
    for (const marker of text
      .slice(prefixStart, at)
      .matchAll(
        /Nutritional Statement|Nutritional Guarantee|Detailed information|AAFCO Statement|\bCFU\b|•/gi,
      ))
      start = prefixStart + marker.index + marker[0].length;
    const tail = text.slice(at);
    const stop = tail.search(/[.!?](?=\s|$|[-A-Z])|\|/);
    const end =
      stop < 0 ? text.length : at + stop + (tail[stop] === "|" ? 0 : 1);
    if (end - start > 1200) continue;
    const statement = text.slice(start, end).trim();
    if (
      /\b(?:not|no|never|cannot|unable|fails?|failed|without)\b|n['’]t\b|(?:intermittent|supplemental) feeding only|충족하지|충족.*못|완전.*아닙/.test(
        statement.toLowerCase(),
      )
    )
      continue;
    const standard = /\bAAFCO\b/i.test(statement)
      ? "AAFCO"
      : /\bFEDIAF\b/i.test(statement)
        ? "FEDIAF"
        : "unspecified";
    const formulated =
      /\b(?:is|are) formulated to meet\b/i.test(statement) ||
      (standard !== "unspecified" && /충족.*제조/.test(statement));
    const feeding = /\banimal feeding tests? using\b.*\bsubstantiate\b/i.test(
      statement,
    );
    const family =
      /comparable in nutritional adequacy.*substantiated.*AAFCO feeding tests/i.test(
        statement,
      );
    const declared =
      /\bmeets? the (?:AAFCO|FEDIAF)\b.*\b(?:nutritional|nutrient)\b/i.test(
        statement,
      );
    if (!(
      standard !== "unspecified" &&
      (formulated || feeding || family || declared)
    ))
      continue;
    const target =
      statement.match(
        /(?:nutrition\s+for|profiles?\s+for|FEDIAF\s+for|AAFCO\s+for)\s+([^.!?]*)/i,
      )?.[1] ?? statement;
    const all = /all life stages|전체 생애|전 생애|전연령/i.test(target);
    const growth = /growth|kittens?|puppies|성장|자묘|키튼/i.test(target);
    const reproduction =
      /reproduction|gestation|lactation|임신|수유|번식/i.test(target);
    const adult =
      /\bmaintenance\b|adult cats?|adult dogs?|성묘|성견|성체 유지/i.test(
        target,
      );
    const cat = /\bcats?\b|\bkittens?\b|고양이|성묘|자묘|키튼/i.test(statement);
    const dog = /\bdogs?\b|\bpupp(?:y|ies)\b|강아지|성견/i.test(statement);
    declarations.set(statement.normalize("NFKC").toLowerCase(), {
      status: "draft",
      statement,
      standard,
      edition: null,
      method: family
        ? "product_family"
        : feeding
          ? "feeding_trial"
          : formulated
            ? "formulation"
            : "unspecified",
      lifeStage: all
        ? "all_life_stages"
        : growth && reproduction
          ? "growth_reproduction"
          : growth && adult
            ? "growth_maintenance"
            : growth
              ? "growth"
              : adult && !reproduction
                ? "adult_maintenance"
                : "unspecified",
      species: cat && !dog ? "cat" : dog && !cat ? "dog" : "unspecified",
    });
  }
  return [...declarations.values()];
}
