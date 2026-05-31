import type { Source } from "@/lib/domain";

export function formatPct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

export function formatKcal(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${Math.round(value).toLocaleString("ko-KR")} kcal/kg`;
}

export function sourceLabel(source: Source | undefined) {
  switch (source) {
    case "manufacturer":
      return "제조사";
    case "kr_label":
      return "국내라벨";
    case "estimated":
      return "추정";
    case "derived":
      return "계산";
    default:
      return "미기록";
  }
}
