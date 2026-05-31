"use client";

import { useMemo, useState } from "react";
import {
  NUTRIENT_FIELDS,
  computeDerived,
  resolveAsh,
  validate,
  num,
  type NutrientKey,
  type Source,
  type CookingMethod,
  type SourceConflict,
} from "@/lib/domain";

// ACANA Grasslands — 해피케이스 테스트 픽스처
const ACANA_MFG = `
Guaranteed Analysis
Crude protein (min.) 36 %
Crude fat (min.) 18 %
Crude fiber (max.) 4 %
Moisture (max.) 10 %
EPA (eicosapentaenoic acid) (min.) 0.1 %
DHA (docosahexaenoic acid) (min.) 0.15 %
Calcium (min.) 1.9 %
Phosphorus (min.) 1.3 %
Magnesium (min.) 0.1%
Taurine (min.) 0.1%
Omega-3 fatty acids* (min.) 0.8 %
Omega-6 fatty acids* (min.) 3 %
Total Microorganisms* (min.) 1 Million CFU/lb
(Lactobacillus acidophilus Bifidobacterium animalis Lactobacillus casei)
*Not recognized as an essential nutrient by the AAFCO Cat Food Nutrient Profiles.
Contains a source of live (viable) naturally occurring microorganisms.
Duck, chicken, eggs, chicken meal, turkey meal, catfish meal, whole red lentils, whole pinto beans, chicken fat, turkey, whole green lentils, whole chickpeas, pea starch, chicken liver, quail, fish oil, duck meal, lentil fiber, chicken hearts, natural chicken flavor, duck liver, freeze-dried turkey, choline chloride,whole cranberries,whole pumpkin, collard greens, whole pears, whole apples, dried kelp, zinc proteinate, vitamin E supplement, mixed tocopherols (preservative), taurine, vitamin D3 supplement, vitamin A acetate, niacin, thiamine mononitrate, riboflavin, calcium pantothenate, pyridoxine hydrochloride, folic acid, vitamin B12 supplement, biotin, copper proteinate, DL-methionine, ascorbic acid (vitamin C), dried chicory root, turmeric, sarsaparilla root, althea root, rosehips, juniper berries, citric acid (preservative), rosemary extract, dried Lactobacillus acidophilus fermentation product, dried Bifidobacterium animalis fermentation product, dried Lactobacillus casei fermentation product.
METABOLIZABLE ENERGY: 3850 kcal/kg (439 kcal per 8 fl. oz cup), with 37% from protein, 23% from carbohydrates, and 40% from fat.
ACANA™ Highest Protein Grasslands™ Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for All Life Stages.`;
const ACANA_KR = `
재료 : 신선한 오리고기(11%), 신선한 닭고기(11%), 신선한 통 계란(8%), 닭고기 (건조육 (7%), 칠면조고기 (건조육)(7%), 송어 (건조육)(7%), 강낭콩, 콩, 신선한 칠면조고기(6%), 오리 지방(5%), 붉은 렌틸콩, 병아리 콩, 녹색 렌틸콩, 생 메추리 고기(4%), 신선한 닭 내장육(간, 심장)(2%), 대구유 (2%), 신선한 칠면조 내장육(간, 심장)(2%), 렌틸 섬유질, 오리고기 (건조육)(1%), 오리 간(1%), 오리 연골(0.5%), 동결건조된 닭 간과 칠면조 간(0.5%), 건조된 켈프, 신선한 통 호박, 신선한 통 버터넛 스쿼시, 신선한 케일, 신선한 시금치, 신선한 순무잎, 신선한 당근, 신선한 사과, 신선한 배, 신선한 통 크랜베리, 신선한 통 블루베리, 치커리 뿌리, 강황 뿌리, 밀크 시슬, 우엉뿌리, 라벤더, 마시멜로 뿌리,로즈힙. 첨가물 (per kg) 기술적인 첨가물: 천연 항산화제. 자연적인 첨가물: 염화콜린: 1200 mg, 타우린: 400 mg, 아연 (수산화 아미노산 킬레이트 아연): 150 mg, 비타민 B1: 25 mg, 비타민 B2: 10 mg, 니아신: 50 mg, 비타민 B5: 8 mg, 비타민 B6: 7.5 mg, 엽산: 0.75 mg, 비오틴: 0.01 mg, 비타민 B12: 0.1 mg, 비타민 A: 1875 IU, 비타민 D: 250 IU, 비타민 E: 150 IU, 구리 (수산화 아미노산 킬레이트 구리): 11mg, DL-메티오닌: 99 mg.축산학적 첨가물: 엔테로코커스패슘 유산균 NCIMB10415: 60x10^6CFU.
칼로리 : 신진대사 에너지는 3930Kcal/kg (120g 당 472Kcal) 이며, 최상의 신체 상태를 위해 분포되었습니다. 칼로리의 38%는  단백질에서, 23%는 탄수화물에서, 39%는 지방에서 나옵니다.
등록성분량 : 조단백질 36.0% 이상, 조지방 18.0% 이상, 조섬유 3.0% 이하, 조회분 9.0% 이하, 칼슘 1.9% 이상, 인 1.3% 이상, 수분 10.0% 이하, 마그네슘 0.1% 이하, 타우린 0.1% 이상, 오메가-6 2.5% 이상, 오메가-3 0.8% 이상, DHA 0.2% 이상, EPA 0.2% 이상`;

type NutrientState = Record<
  NutrientKey,
  { value: string; evidence: string | null; source: Source | null }
>;

type FeatureFlags = {
  grain_free: boolean;
  meal_free: boolean;
  has_probiotics: boolean;
  has_cranberry: boolean;
  has_yucca: boolean;
};

const emptyFlags = (): FeatureFlags => ({
  grain_free: false,
  meal_free: false,
  has_probiotics: false,
  has_cranberry: false,
  has_yucca: false,
});

const emptyNutrients = (): NutrientState =>
  Object.fromEntries(
    NUTRIENT_FIELDS.map(([k]) => [
      k,
      { value: "", evidence: null, source: null },
    ]),
  ) as NutrientState;

export default function NewFoodPage() {
  const [mfgText, setMfgText] = useState("");
  const [krText, setKrText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [cooking, setCooking] = useState<CookingMethod | "">("");
  const [nutrients, setNutrients] = useState<NutrientState>(emptyNutrients());
  const [mfgEnergy, setMfgEnergy] = useState<{
    p: number | null;
    f: number | null;
    c: number | null;
  } | null>(null);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(emptyFlags());
  const [ingredientsText, setIngredientsText] = useState("[]");
  const [conflicts, setConflicts] = useState<SourceConflict[]>([]);
  const [extracted, setExtracted] = useState(false);
  const [saved, setSaved] = useState<object | null>(null);

  const ashSource = nutrients.ash_pct.source;
  const nutrientValues = useMemo(
    () =>
      Object.fromEntries(NUTRIENT_FIELDS.map(([k]) => [k, nutrients[k].value])),
    [nutrients],
  );
  const derived = useMemo(
    () =>
      computeDerived(
        nutrientValues,
        cooking || null,
        ashSource,
        mfgEnergy ?? undefined,
      ),
    [nutrientValues, cooking, ashSource, mfgEnergy],
  );
  const flags = useMemo(
    () => validate(nutrientValues, derived),
    [nutrientValues, derived],
  );
  const hasError = flags.some((f) => f.level === "error");
  const energyFromMfg = !!(
    mfgEnergy &&
    mfgEnergy.p !== null &&
    mfgEnergy.f !== null &&
    mfgEnergy.c !== null
  );

  async function extract() {
    setErr(null);
    setLoading(true);
    setSaved(null);
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manufacturerText: mfgText,
          krLabelText: krText,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "추출 실패");

      const p = data.parsed;
      setProductName(p.product_name ?? "");
      setBrand(p.brand ?? "");
      setCooking(p.cooking_method ?? "");
      const ns = emptyNutrients();
      for (const [k] of NUTRIENT_FIELDS) {
        const cell = p.nutrients?.[k];
        ns[k] = {
          value: cell?.value != null ? String(cell.value) : "",
          evidence: cell?.evidence ?? null,
          source: cell?.source ?? null,
        };
      }
      setNutrients(ns);
      setMfgEnergy(data.mfgEnergy ?? null);
      setFeatureFlags({ ...emptyFlags(), ...(p.flags ?? {}) });
      setIngredientsText(JSON.stringify(p.ingredients ?? [], null, 2));
      setConflicts(data.conflicts ?? []);
      setExtracted(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    setMfgText(ACANA_MFG);
    setKrText(ACANA_KR);
  }

  function setCell(k: NutrientKey, patch: Partial<NutrientState[NutrientKey]>) {
    setNutrients((n) => ({ ...n, [k]: { ...n[k], ...patch } }));
  }

  async function save() {
    setErr(null);
    setSaved(null);
    let ingredients;
    try {
      ingredients = JSON.parse(ingredientsText || "[]");
    } catch {
      setErr("원료 JSON 형식을 확인해 주세요.");
      return;
    }

    const resolvedAsh = resolveAsh(
      nutrients.ash_pct.value,
      nutrients.ash_pct.source,
      cooking || null,
    );
    const sources: Record<string, Source> = {};
    for (const [k] of NUTRIENT_FIELDS)
      if (nutrients[k].source) sources[k] = nutrients[k].source!;
    if (!sources.ash_pct && resolvedAsh.estimated)
      sources.ash_pct = "estimated";
    if (energyFromMfg) {
      sources.energy_p_pct = "manufacturer";
      sources.energy_f_pct = "manufacturer";
      sources.energy_c_pct = "manufacturer";
    } else if (derived.energy_p_pct !== null) {
      sources.energy_p_pct = "derived";
      sources.energy_f_pct = "derived";
      sources.energy_c_pct = "derived";
    }
    if (derived.carb_pct !== null)
      sources.carb_pct = derived.carb_is_estimated ? "estimated" : "derived";

    const payload = {
      product_name: productName,
      brand,
      cooking_method: cooking || null,
      ...Object.fromEntries(
        NUTRIENT_FIELDS.map(([k]) => [
          k,
          k === "ash_pct" ? resolvedAsh.value : num(nutrients[k].value),
        ]),
      ),
      carb_pct: derived.carb_pct,
      carb_is_estimated: derived.carb_is_estimated,
      energy_p_pct: derived.energy_p_pct,
      energy_f_pct: derived.energy_f_pct,
      energy_c_pct: derived.energy_c_pct,
      ca_p_ratio: derived.ca_p_ratio,
      mfg_energy: mfgEnergy,
      nutrient_sources: sources,
      ingredients,
      flags: featureFlags,
      source_conflicts: conflicts,
      data_verified_at: new Date().toISOString(),
    };

    const response = await fetch("/api/foods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setErr(data.error ?? "저장 실패");
      return;
    }
    setSaved(data);
  }

  return (
    <main className="wrap">
      <header className="hd">
        <h1>사료 성분 입력</h1>
        <p>제조사 + 국내 라벨 → 출처별 구조화 · 검증 후 저장</p>
      </header>

      <section className="card">
        <div className="lblrow">
          <label>제조사 원문 (Guaranteed Analysis)</label>
          <button className="ghost" onClick={loadSample}>
            샘플
          </button>
        </div>
        <textarea
          value={mfgText}
          onChange={(e) => setMfgText(e.target.value)}
          placeholder="제조사 영문 성분표. P/F/C·kcal 명시가 있으면 자동 인식됩니다."
        />

        <label>
          국내 수입 라벨 원문 <span className="muted">(회분·열량 보충용)</span>
        </label>
        <textarea
          className="sm"
          value={krText}
          onChange={(e) => setKrText(e.target.value)}
          placeholder="조회분 9.0% 이하 등. 제조사 원문에 없는 회분/열량을 채웁니다."
        />

        <button
          className="primary"
          onClick={extract}
          disabled={loading || (!mfgText && !krText)}
        >
          {loading ? "추출 중…" : "→ 구조화 추출"}
        </button>
        {err && <div className="err">{err}</div>}
      </section>

      {extracted && (
        <section className="card">
          <div className="frow">
            <div className="f">
              <span>제품명</span>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
            </div>
            <div className="f">
              <span>브랜드</span>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
          </div>
          <div className="f">
            <span>
              제조법{" "}
              <em className="muted">(익스트루전이면 회분 9.0% 추정 허용)</em>
            </span>
            <select
              value={cooking}
              onChange={(e) => setCooking(e.target.value as CookingMethod | "")}
            >
              <option value="">미지정</option>
              <option value="extrusion">익스트루전(팽화)</option>
              <option value="baked">오븐 베이크</option>
              <option value="freeze_dried">동결건조</option>
              <option value="dried">건조</option>
            </select>
          </div>

          <div className="checks">
            {[
              ["grain_free", "그레인프리"],
              ["meal_free", "밀프리"],
              ["has_probiotics", "프로바이오틱스"],
              ["has_cranberry", "크랜베리"],
              ["has_yucca", "유카"],
            ].map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={featureFlags[key as keyof FeatureFlags]}
                  onChange={(e) =>
                    setFeatureFlags((flags) => ({
                      ...flags,
                      [key]: e.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>

          <label>
            원료 구조화 JSON <span className="muted">(name, pct, type)</span>
          </label>
          <textarea
            className="sm"
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
          />

          <h2>
            보장성분 <span className="tag">편집 · 출처 · 근거 대조</span>
          </h2>
          <div className="nutrients">
            {NUTRIENT_FIELDS.map(([k, label]) => {
              const cell = nutrients[k];
              const missing = !cell.evidence && !cell.value;
              return (
                <div className="nrow" key={k}>
                  <div className="nlabel">{label}</div>
                  <input
                    className="ninput"
                    inputMode="decimal"
                    value={cell.value}
                    onChange={(e) => setCell(k, { value: e.target.value })}
                    placeholder="—"
                  />
                  <select
                    className="nsrc"
                    value={cell.source ?? ""}
                    onChange={(e) =>
                      setCell(k, {
                        source: (e.target.value || null) as Source | null,
                      })
                    }
                  >
                    <option value="">출처</option>
                    <option value="manufacturer">제조사</option>
                    <option value="kr_label">국내라벨</option>
                    <option value="estimated">추정</option>
                  </select>
                  <div className={"ev" + (missing ? " evmiss" : "")}>
                    {cell.evidence
                      ? `↤ "${cell.evidence}"`
                      : "근거 없음 — 수동 확인"}
                  </div>
                </div>
              );
            })}
          </div>

          <h2>
            파생값{" "}
            <span className="tag">
              {energyFromMfg ? "P/F/C 제조사 명시" : "P/F/C NFE 계산"}
            </span>
          </h2>
          <div className="derived">
            <Cell
              label="탄수화물(NFE)"
              v={derived.carb_pct}
              unit="%"
              note={
                derived.carb_pct !== null
                  ? derived.carb_is_estimated
                    ? "회분 추정"
                    : "실측"
                  : "회분 없음"
              }
            />
            <Cell label="Ca:P" v={derived.ca_p_ratio} unit="" />
            <Cell label="단백질 열량비" v={derived.energy_p_pct} unit="%" />
            <Cell label="지방 열량비" v={derived.energy_f_pct} unit="%" />
            <Cell label="탄수 열량비" v={derived.energy_c_pct} unit="%" />
          </div>

          {flags.length > 0 && (
            <div className="flags">
              {flags.map((f, i) => (
                <div key={i} className={"flag " + f.level}>
                  {f.level === "error" ? "✕" : "⚠"} {f.msg}
                </div>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="flags">
              {conflicts.map((conflict) => (
                <div key={conflict.key} className="flag warn">
                  소스 충돌: {conflict.label} 제조사 {conflict.manufacturer} /
                  국내라벨 {conflict.kr_label}
                </div>
              ))}
            </div>
          )}

          <button className="save" onClick={save} disabled={hasError}>
            {hasError ? "오류 해결 후 저장" : "✓ 검증 완료 · 저장"}
          </button>
        </section>
      )}

      {saved && (
        <section className="card">
          <h2>
            저장 payload <span className="tag">Supabase insert</span>
          </h2>
          <pre>{JSON.stringify(saved, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}

function Cell({
  label,
  v,
  unit,
  note,
}: {
  label: string;
  v: number | null;
  unit: string;
  note?: string;
}) {
  return (
    <div className="dcell">
      <div className="dlabel">{label}</div>
      <div className="dval">
        {v === null || v === undefined ? "—" : `${v}${unit}`}
      </div>
      {note && <div className="dnote">{note}</div>}
    </div>
  );
}
