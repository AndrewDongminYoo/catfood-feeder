/**
 * 유럽 라벨의 소수점 쉼표("조섬유 2,5 %"). 쉼표 뒤 자릿수가 1~2개면 천 단위 묶음일
 * 수 없으므로(묶음은 정확히 3자리) 소수점으로 읽는 것 외에 다른 해석이 없다.
 * "1,500"처럼 3자리인 것은 여기 걸리지 않고 천 단위로 남는다 — 그 둘은 겹치지 않는다.
 */
export const DECIMAL_COMMA = /^-?\d+,\d{1,2}$/;

const NUMERIC_TOKEN = /-?(?=[\d,.]*\d)[\d,.]+/g;

const PLAIN_NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/;

export function normalizeDecimalLiteral(value: string): string | null {
  const match = value.match(/^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || (!match[2] && !match[3])) return null;
  const sourceInteger = match[2] || "0";
  const sourceFraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;

  const digits = `${sourceInteger}${sourceFraction}`;
  const decimalIndex = sourceInteger.length + exponent;
  const expanded =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  const [expandedInteger = "0", expandedFraction = ""] = expanded.split(".");
  const integer = expandedInteger.replace(/^0+(?=\d)/, "") || "0";
  const fraction = expandedFraction.replace(/0+$/, "");
  const sign = match[1] === "-" && (integer !== "0" || fraction) ? "-" : "";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

/** 토큰 하나를 정규화한 십진 문자열로. 모양이 소수점 쉼표면 소수점으로, 아니면 천 단위로 읽는다. */
export function normalizeNumericToken(token: string): string | null {
  if (!DECIMAL_COMMA.test(token) && !PLAIN_NUMBER.test(token)) return null;
  return normalizeDecimalLiteral(
    DECIMAL_COMMA.test(token)
      ? token.replace(",", ".")
      : token.replaceAll(",", ""),
  );
}

/**
 * 표시용 매처. 값과 같은 토큰의 위치를 돌려준다.
 * 추출 시점 가드인 excerptContainsValue 와 달리 토큰이 여럿이어도 허용한다 —
 * 그쪽은 모호한 구절을 거절해야 하고, 이쪽은 이미 확정된 값을 가리키기만 한다.
 */
export function matchExcerptValue(
  excerpt: string,
  value: number,
): { before: string; match: string; after: string } | null {
  if (!Number.isFinite(value)) return null;
  const normalized = excerpt.normalize("NFKC").replace(/−/g, "-");
  if (normalized.includes("⁄")) return null;
  const target = normalizeDecimalLiteral(String(value));
  if (target === null) return null;

  for (const found of normalized.matchAll(NUMERIC_TOKEN)) {
    const token = found[0];
    if (normalizeNumericToken(token) !== target) continue;
    const start = found.index;
    return {
      after: normalized.slice(start + token.length),
      before: normalized.slice(0, start),
      match: token,
    };
  }
  return null;
}
