import type { NutrientEvidence, NutrientSourceKey } from "@/lib/catalog";

// foods 영양 컬럼의 numeric(_,2) 캐스트와 같은 반올림을 적용해, 원장 정밀도가
// 더 높은 정상 근거를 놓치지 않으면서 저장값과 다른 근거는 거부한다.
const COLUMN_SCALE = 2;

function toColumnScale(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return null;

  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(
    ".",
  );
  const sign = negative ? "-" : "";
  if (fraction.length <= COLUMN_SCALE) {
    return `${sign}${whole}.${fraction.padEnd(COLUMN_SCALE, "0")}`;
  }

  const kept = Number(`${whole}${fraction.slice(0, COLUMN_SCALE)}`);
  if (!Number.isSafeInteger(kept)) return null;
  const roundedUp = Number(fraction[COLUMN_SCALE]) >= 5 ? kept + 1 : kept;
  const scaled = String(roundedUp).padStart(COLUMN_SCALE + 1, "0");
  return `${sign}${scaled.slice(0, -COLUMN_SCALE)}.${scaled.slice(-COLUMN_SCALE)}`;
}

export function nutrientEvidenceMatchesValue(
  evidence: NutrientEvidence,
  value: number | null,
): boolean {
  if (value === null) return false;
  const quoted = toColumnScale(evidence.value);
  return quoted !== null && quoted === toColumnScale(value);
}

export function findMatchingNutrientEvidence(
  evidence: readonly NutrientEvidence[],
  nutrientKey: NutrientSourceKey,
  value: number | null,
): NutrientEvidence | null {
  return (
    evidence.find(
      (row) =>
        row.nutrient_key === nutrientKey &&
        nutrientEvidenceMatchesValue(row, value),
    ) ?? null
  );
}
