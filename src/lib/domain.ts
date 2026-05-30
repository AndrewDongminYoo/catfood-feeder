// 도메인 로직 — 서버/클라이언트 공용. BLUEPRINT "핵심 도메인 규칙" 구현.

export type Source = "manufacturer" | "kr_label" | "estimated" | "derived";
export type CookingMethod = "extrusion" | "baked" | "freeze_dried" | "dried";

export const NUTRIENT_FIELDS = [
  ["protein_pct", "조단백 Crude Protein"],
  ["fat_pct", "조지방 Crude Fat"],
  ["fiber_pct", "조섬유 Crude Fiber"],
  ["ash_pct", "조회분 Crude Ash"],
  ["moisture_pct", "수분 Moisture"],
  ["calcium_pct", "칼슘 Calcium"],
  ["phosphorus_pct", "인 Phosphorus"],
  ["kcal_per_kg", "열량 kcal/kg"],
] as const;

export type NutrientKey = (typeof NUTRIENT_FIELDS)[number][0];

export const EXTRUSION_ASH_DEFAULT = 9.0; // 익스트루전 사료 회분 폴백값

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(x) ? null : x;
}
function round(v: number, dp: number) {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}

export interface NutrientInput {
  protein_pct?: unknown;
  fat_pct?: unknown;
  fiber_pct?: unknown;
  ash_pct?: unknown;
  moisture_pct?: unknown;
  calcium_pct?: unknown;
  phosphorus_pct?: unknown;
  kcal_per_kg?: unknown;
}

export interface Derived {
  carb_pct: number | null;
  carb_is_estimated: boolean;
  energy_p_pct: number | null;
  energy_f_pct: number | null;
  energy_c_pct: number | null;
  ca_p_ratio: number | null;
}

// 회분 3단 폴백: 라벨 실측 → 익스트루전 9.0 추정 → 계산 보류
export function resolveAsh(
  ashValue: unknown,
  ashSource: Source | null,
  cooking: CookingMethod | null,
): { value: number | null; estimated: boolean } {
  const v = num(ashValue);
  if (v !== null) return { value: v, estimated: ashSource === "estimated" };
  if (cooking === "extrusion")
    return { value: EXTRUSION_ASH_DEFAULT, estimated: true };
  return { value: null, estimated: false };
}

// 파생값 계산. 제조사가 P/F/C를 직접 준 경우(mfgEnergy)는 그것을 우선.
export function computeDerived(
  n: NutrientInput,
  cooking: CookingMethod | null,
  ashSource: Source | null,
  mfgEnergy?: { p: number | null; f: number | null; c: number | null },
): Derived {
  const p = num(n.protein_pct);
  const f = num(n.fat_pct);
  const fiber = num(n.fiber_pct);
  const moist = num(n.moisture_pct);
  const ca = num(n.calcium_pct);
  const ph = num(n.phosphorus_pct);

  const ash = resolveAsh(n.ash_pct, ashSource, cooking);

  // NFE 탄수화물: 회분 결정값이 있어야 계산
  let carb: number | null = null;
  let carbEstimated = false;
  if ([p, f, fiber, moist].every((v) => v !== null) && ash.value !== null) {
    carb = round(100 - (p! + f! + fiber! + moist! + ash.value), 1);
    carbEstimated = ash.estimated;
  }

  // P/F/C 열량비: 제조사 직접 명시 우선
  let pPct: number | null = null,
    fPct: number | null = null,
    cPct: number | null = null;
  if (
    mfgEnergy &&
    mfgEnergy.p !== null &&
    mfgEnergy.f !== null &&
    mfgEnergy.c !== null
  ) {
    pPct = mfgEnergy.p;
    fPct = mfgEnergy.f;
    cPct = mfgEnergy.c;
  } else if (p !== null && f !== null && carb !== null) {
    const pK = p * 4,
      fK = f * 9,
      cK = carb * 4;
    const tot = pK + fK + cK;
    if (tot > 0) {
      pPct = round((pK / tot) * 100, 1);
      fPct = round((fK / tot) * 100, 1);
      cPct = round((cK / tot) * 100, 1);
    }
  }

  let caP: number | null = null;
  if (ca !== null && ca > 0 && ph !== null) caP = round(ph / ca, 3);

  return {
    carb_pct: carb,
    carb_is_estimated: carbEstimated,
    energy_p_pct: pPct,
    energy_f_pct: fPct,
    energy_c_pct: cPct,
    ca_p_ratio: caP,
  };
}

export interface Flag {
  level: "error" | "warn";
  msg: string;
}

export function validate(n: NutrientInput, d: Derived): Flag[] {
  const flags: Flag[] = [];
  const p = num(n.protein_pct),
    f = num(n.fat_pct);
  const sum = ["protein_pct", "fat_pct", "fiber_pct", "ash_pct", "moisture_pct"]
    .map((k) => num((n as Record<string, unknown>)[k]))
    .filter((v): v is number => v !== null)
    .reduce((a, b) => a + b, 0);

  if (sum > 100)
    flags.push({
      level: "error",
      msg: `보장성분 합계 ${round(sum, 1)}% — 100% 초과(입력 오류 가능)`,
    });
  if (d.carb_pct !== null && d.carb_pct < 0)
    flags.push({ level: "error", msg: "탄수화물(NFE) 음수 — 수치 재확인" });
  if (p !== null && p < 30)
    flags.push({ level: "warn", msg: `단백질 ${p}% (30% 미만)` });
  if (f !== null && f > 30)
    flags.push({ level: "warn", msg: `지방 ${f}% (30% 초과)` });
  if (d.carb_pct !== null && d.carb_pct > 35)
    flags.push({
      level: "warn",
      msg: `탄수화물 ${d.carb_pct}%${d.carb_is_estimated ? " (추정)" : ""} (35% 초과)`,
    });
  if (d.ca_p_ratio !== null && d.ca_p_ratio > 1.0)
    flags.push({ level: "warn", msg: `Ca:P 역전 (P/Ca=${d.ca_p_ratio})` });
  return flags;
}

// 제조사 원문에서 "37% from protein, 23% from carbohydrates, 40% from fat" 패턴 추출
export function parseManufacturerEnergy(
  text: string,
): { p: number | null; f: number | null; c: number | null } | null {
  const grab = (kw: string) => {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*from\\s+${kw}`, "i");
    const m = text.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  const p = grab("protein");
  const c = grab("carbohydrate(?:s)?");
  const f = grab("fat");
  if (p === null && f === null && c === null) return null;
  return { p, f, c };
}

// 제조사 원문에서 kcal/kg 추출
export function parseKcal(text: string): number | null {
  const m = text.match(/(\d{3,4}(?:\.\d+)?)\s*kcal\s*\/\s*kg/i);
  return m ? parseFloat(m[1]) : null;
}
