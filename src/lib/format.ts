export function formatPct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

export function formatKcal(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${formatKcalValue(value)} kcal/kg`;
}

/** 단위 없는 열량. 단위가 라벨 쪽에 있는 자리(카탈로그 metric-row)에서 쓴다. */
export function formatKcalValue(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : Math.round(value).toLocaleString("ko-KR");
}

/** Ca:P는 생성 컬럼이 소수 3자리까지 준다. 라벨이 주장하지 않는 정밀도다. */
export function formatRatio(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}
