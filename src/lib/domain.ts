// 도메인 로직 — 서버/클라이언트 공용. BLUEPRINT "핵심 도메인 규칙" 구현.

export const SOURCE_VALUES = [
  "manufacturer",
  "kr_label",
  "estimated",
  "derived",
] as const;
export type Source = (typeof SOURCE_VALUES)[number];

export const COOKING_METHOD_VALUES = [
  "extrusion",
  "baked",
  "freeze_dried",
  "dried",
] as const;
export type CookingMethod = (typeof COOKING_METHOD_VALUES)[number];

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
  const text = String(v).normalize("NFKC").replace(/−/g, "-");
  // 붙여넣기와 OCR에서 범위 구분자는 ASCII 하이픈 외에도 en/em dash와 물결표가 흔하다.
  // 숫자 사이의 구분자를 먼저 거부하지 않으면 뒤의 정리 단계에서 "36–40"이 3640이 된다.
  if (/\d\s*[-–—~〜]\s*\d/.test(text)) return null;
  const cleaned = text
    // 약어의 마침표는 소수점이 아니다. 이걸 남기면 AAFCO 라벨을 그대로 붙여넣은
    // "Crude ash (max.) 7 %"가 ".7" → 0.7로 읽혀 10배 틀린 값이 들어간다.
    .replace(/([a-zA-Z])\./g, "$1")
    .replace(/\.(?=\s*$)/, "")
    .replace(/[^0-9.\-]/g, "");
  // parseFloat은 앞부분만 읽고 멈춘다. 범위("1.9-2.1" → 1.9)나 소수점이 둘 이상인
  // 값("10.5.2" → 10.5)을 조용히 절단하느니 미기록으로 두고 큐레이터가 확정하게 한다.
  if (/\d-/.test(cleaned)) return null;
  if ((cleaned.match(/\./g)?.length ?? 0) > 1) return null;
  const x = parseFloat(cleaned);
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
  if (ca !== null && ph !== null && ph > 0) caP = round(ca / ph, 3);

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

export interface SourceConflict {
  key: NutrientKey;
  label: string;
  manufacturer: number;
  kr_label: number;
}

export function validate(n: NutrientInput, d: Derived): Flag[] {
  const flags: Flag[] = [];
  const p = num(n.protein_pct),
    f = num(n.fat_pct);
  for (const [key, label] of NUTRIENT_FIELDS) {
    const value = num(n[key]);
    if (value !== null && value < 0) {
      flags.push({ level: "error", msg: `${label} ${value} — 음수 입력 불가` });
    }
  }
  const sum = ["protein_pct", "fat_pct", "fiber_pct", "ash_pct", "moisture_pct"]
    .map((k) => num((n as Record<string, unknown>)[k]))
    .filter((v): v is number => v !== null)
    .reduce((a, b) => a + b, 0);

  // 부동소수점 누적 오차 허용. 십진 합이 정확히 100.0인 라벨이 100.00000000000001로 계산돼
  // "합계 100% — 100% 초과"라는 자기모순 오류로 차단되던 문제를 막는다.
  if (sum > 100 + 1e-9)
    flags.push({
      level: "error",
      msg: `보장성분 합계 ${round(sum, 1)}% — 100% 초과(입력 오류 가능)`,
    });
  if (d.carb_pct !== null && d.carb_pct < 0)
    flags.push({ level: "error", msg: "탄수화물(NFE) 음수 — 수치 재확인" });

  // 열량 자릿수 사고 방지. "3.850 kcal/kg"(유럽식 천단위 구분)이 3.85로 파싱되면
  // 여기서만 잡힌다 — num()은 문법만 보고 자릿수 의도를 알 수 없다.
  const kcal = num(n.kcal_per_kg);
  if (kcal !== null && kcal >= 0 && (kcal < 500 || kcal > 8000))
    flags.push({
      level: "error",
      msg: `열량 ${kcal} kcal/kg — 사료로 불가능한 값(자릿수 확인)`,
    });
  else if (kcal !== null && (kcal < 2000 || kcal > 6000))
    flags.push({
      level: "warn",
      msg: `열량 ${kcal} kcal/kg — 건사료 통상 범위(2,000–6,000) 밖`,
    });

  // 제조사가 P/F/C를 직접 표기한 경우 그 값은 그대로 저장되므로(BLUEPRINT 41행)
  // 합계 검증이 여기 없으면 OCR 자릿수 누락이 "실측"으로 공개된다.
  // NFE 역산 경로는 구성상 항상 100이 되므로 이 검사에 걸리지 않는다.
  const energy = [d.energy_p_pct, d.energy_f_pct, d.energy_c_pct];
  if (energy.every((v): v is number => v !== null)) {
    const total = energy.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 2)
      flags.push({
        level: "error",
        msg: `열량비 합계 ${round(total, 1)}% — 100%에서 벗어남(원문 확인)`,
      });
  }
  if (p !== null && p >= 0 && p < 30)
    flags.push({ level: "warn", msg: `단백질 ${p}% (30% 미만)` });
  if (f !== null && f > 30)
    flags.push({ level: "warn", msg: `지방 ${f}% (30% 초과)` });
  if (d.carb_pct !== null && d.carb_pct > 35)
    flags.push({
      level: "warn",
      msg: `탄수화물 ${d.carb_pct}%${d.carb_is_estimated ? " (추정)" : ""} (35% 초과)`,
    });
  if (d.ca_p_ratio !== null && d.ca_p_ratio < 1.0)
    flags.push({ level: "warn", msg: `Ca:P 역전 (Ca:P=${d.ca_p_ratio})` });
  return flags;
}

/**
 * 원문이 제공되지 않은 출처로 태깅된 성분을 찾는다.
 *
 * 프로젝트의 핵심 자산은 "출처 태그가 붙은 검증 데이터"인데, `/new`는 원문 없이도
 * 태그를 붙일 수 있다. 국내 라벨 원문을 비워둔 채 열량을 `kr_label`로 태깅하면
 * 근거 없는 값이 실측으로 공개된다. 저장을 막지는 않고 큐레이터에게 보이게만 한다.
 */
export function detectUnbackedSources(
  entries: Partial<
    Record<NutrientKey, { value: unknown; source: Source | null }>
  >,
  texts: { manufacturer: string; krLabel: string },
): Flag[] {
  const available: Partial<Record<Source, boolean>> = {
    manufacturer: texts.manufacturer.trim().length > 0,
    kr_label: texts.krLabel.trim().length > 0,
  };
  const labels: Record<string, string> = {
    manufacturer: "제조사 원문",
    kr_label: "국내 라벨 원문",
  };

  return NUTRIENT_FIELDS.flatMap(([key, label]) => {
    const entry = entries[key];
    if (!entry || num(entry.value) === null) return [];
    const source = entry.source;
    // estimated·derived는 원문에서 오지 않으므로 대상이 아니다.
    if (source !== "manufacturer" && source !== "kr_label") return [];
    if (available[source]) return [];
    return [
      {
        level: "warn" as const,
        msg: `${label} — ${labels[source]}이 비어 있는데 해당 출처로 표시됨(근거 확인)`,
      },
    ];
  });
}

const CONFLICT_PATTERNS: Record<NutrientKey, RegExp[]> = {
  protein_pct: [
    /crude\s+protein[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /조단백(?:질)?[^\d]{0,30}(\d+(?:\.\d+)?)/i,
  ],
  fat_pct: [
    /crude\s+fat[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /조지방[^\d]{0,30}(\d+(?:\.\d+)?)/i,
  ],
  fiber_pct: [
    /crude\s+fiber[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /조섬유[^\d]{0,30}(\d+(?:\.\d+)?)/i,
  ],
  ash_pct: [
    /crude\s+ash[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /조회분[^\d]{0,30}(\d+(?:\.\d+)?)/i,
  ],
  moisture_pct: [
    /moisture[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /수분[^\d]{0,30}(\d+(?:\.\d+)?)/i,
  ],
  calcium_pct: [
    /calcium[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /칼슘[^\d]{0,30}(\d+(?:\.\d+)?)/i,
  ],
  phosphorus_pct: [
    /phosphorus[^\d]{0,30}(\d+(?:\.\d+)?)/i,
    /(?:^|\s|[,:])인\s*[:：]?[\s]*(\d+(?:\.\d+)?)/i,
  ],
  // `\/?`가 `\/`를 포함하므로 패턴 하나로 충분하다.
  kcal_per_kg: [/(\d{1,2}(?:,\d{3})+|\d{3,4})(?:\.\d+)?\s*kcal\s*\/?\s*kg/i],
};

export function extractNutrientHints(
  text: string,
): Partial<Record<NutrientKey, number>> {
  const hints: Partial<Record<NutrientKey, number>> = {};
  for (const [key, patterns] of Object.entries(CONFLICT_PATTERNS) as [
    NutrientKey,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;
      hints[key] = parseFloat(match[1].replace(/,/g, ""));
      break;
    }
  }
  return hints;
}

export function detectSourceConflicts(
  manufacturerText: string,
  krLabelText: string,
): SourceConflict[] {
  const manufacturer = extractNutrientHints(manufacturerText);
  const krLabel = extractNutrientHints(krLabelText);

  return NUTRIENT_FIELDS.flatMap(([key, label]) => {
    const mfg = manufacturer[key];
    const kr = krLabel[key];
    if (mfg === undefined || kr === undefined) return [];
    const tolerance = key === "kcal_per_kg" ? 25 : 0.05;
    if (Math.abs(mfg - kr) <= tolerance) return [];
    return [{ key, label, manufacturer: mfg, kr_label: kr }];
  });
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
