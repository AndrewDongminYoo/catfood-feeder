"use client";

import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import type { ReviewBrand, ReviewFood } from "@/lib/publication-review";

const conflictSchema = z.object({
  key: z.string(),
  merged_value: z.number().nullable().optional(),
  survivor_value: z.number().nullable().optional(),
});

const foodSchema = z.object({
  brandId: z.number(),
  carbIsEstimated: z.boolean(),
  carbPct: z.number().nullable(),
  conflicts: z.array(z.unknown()),
  evidenceCount: z.number(),
  id: z.number(),
  nutrients: z.record(z.string(), z.number().nullable()),
  nutrientSources: z.record(
    z.string(),
    z.enum(["manufacturer", "kr_label", "estimated", "derived"]),
  ),
  productName: z.string(),
  sources: z.array(z.object({ kind: z.string(), url: z.string() })),
  weightKg: z.number().nullable(),
});

const reviewSchema = z.object({
  brands: z.array(
    z.object({
      conflicts: z.number(),
      country: z.string().nullable(),
      id: z.number(),
      koName: z.string().nullable(),
      name: z.string(),
      pending: z.number(),
    }),
  ),
  foods: z.array(foodSchema),
});

const COLUMNS = [
  ["protein_pct", "단백"],
  ["fat_pct", "지방"],
  ["fiber_pct", "섬유"],
  ["ash_pct", "회분"],
  ["moisture_pct", "수분"],
  ["kcal_per_kg", "kcal"],
] as const;

type PublicationReviewClientProps = {
  readonly initialBrands: readonly ReviewBrand[];
  readonly initialFoods: readonly ReviewFood[];
};

export function PublicationReviewClient({
  initialBrands,
  initialFoods,
}: PublicationReviewClientProps) {
  const [brands, setBrands] = useState<readonly ReviewBrand[]>(initialBrands);
  const [foods, setFoods] = useState<readonly ReviewFood[]>(initialFoods);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetBrandId: number | null) => {
    const query =
      targetBrandId === null ? "" : `?brandId=${String(targetBrandId)}`;
    const response = await fetch(`/api/foods/review${query}`);
    const data: unknown = await response.json();
    if (!response.ok) {
      setError(
        z.object({ error: z.string() }).safeParse(data).data?.error ??
          "목록을 불러오지 못했습니다.",
      );
      return;
    }
    const parsed = reviewSchema.safeParse(data);
    if (!parsed.success) {
      setError("목록 형식이 올바르지 않습니다.");
      return;
    }
    setError(null);
    setBrands(parsed.data.brands);
    setFoods(parsed.data.foods);
  }, []);

  const pendingBrands = useMemo(
    () => brands.filter((brand) => brand.pending > 0 || brand.id === brandId),
    [brandId, brands],
  );

  // 충돌이 있거나 탄수화물이 계산되지 않는 행은 기본으로 고르지 않는다. 검토가
  // 필요한 것을 일괄 발행에 딸려 보내지 않기 위해서다.
  function isRoutine(food: ReviewFood) {
    return food.conflicts.length === 0 && food.carbPct !== null;
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function publishSelected() {
    setBusy(true);
    setLog([]);
    const targets = foods.filter((food) => selected.has(food.id));
    const lines: string[] = [];
    for (const food of targets) {
      try {
        const response = await fetch(`/api/foods/${String(food.id)}/publish`, {
          body: "{}",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const data: unknown = await response.json();
        lines.push(
          response.ok
            ? `✓ ${food.productName}`
            : `✗ ${food.productName} — ${
                z.object({ error: z.string() }).safeParse(data).data?.error ??
                "실패"
              }`,
        );
      } catch {
        lines.push(`✗ ${food.productName} — 네트워크 오류`);
      }
      setLog([...lines]);
    }
    setSelected(new Set());
    await load(brandId);
    setBusy(false);
  }

  return (
    <>
      <label>
        브랜드
        <select
          disabled={busy}
          onChange={(event) => {
            const next =
              event.target.value === "" ? null : Number(event.target.value);
            setBrandId(next);
            setSelected(new Set());
            setExpanded(null);
            void load(next);
          }}
          value={brandId === null ? "" : String(brandId)}
        >
          <option value="">브랜드를 고르세요 (전체 {foods.length}건)</option>
          {pendingBrands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
              {brand.koName && brand.koName !== brand.name
                ? ` (${brand.koName})`
                : ""}
              {brand.country ? ` · ${brand.country}` : ""} · {brand.pending}건
              {brand.conflicts > 0 ? ` · 충돌 ${brand.conflicts}` : ""}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="flag warn" role="alert">
          {error}
        </p>
      )}

      {brandId === null ? (
        <p className="muted">
          브랜드를 고르면 그 브랜드의 발행 대기 건만 봅니다. 전체 {foods.length}
          건을 한 번에 훑는 화면이 아닙니다.
        </p>
      ) : (
        <>
          <div className="review-actions">
            <span className="muted">
              {foods.length}건 · 검토 필요{" "}
              {foods.filter((f) => !isRoutine(f)).length}건 · 선택{" "}
              {selected.size}건
            </span>
            <button
              disabled={busy || foods.length === 0}
              onClick={() =>
                setSelected(new Set(foods.filter(isRoutine).map((f) => f.id)))
              }
            >
              이상 없는 것 모두 선택
            </button>
            <button
              disabled={busy || selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              선택 해제
            </button>
            <button
              className="primary"
              disabled={busy || selected.size === 0}
              onClick={() => void publishSelected()}
            >
              선택 {selected.size}건 발행
            </button>
          </div>

          <div className="panel">
            {foods.map((food) => (
              <div className="review-row" key={food.id}>
                <input
                  aria-label={`${food.productName} 선택`}
                  checked={selected.has(food.id)}
                  disabled={busy}
                  onChange={() => toggle(food.id)}
                  type="checkbox"
                />
                <div className="review-body">
                  <button
                    onClick={() =>
                      setExpanded(expanded === food.id ? null : food.id)
                    }
                  >
                    {food.productName}
                  </button>
                  <div className="review-nutrients">
                    {COLUMNS.map(([key, label]) => (
                      <span key={key}>
                        {label} <b>{food.nutrients[key] ?? "—"}</b>
                        {food.nutrientSources[key] === "estimated" ? "*" : ""}
                      </span>
                    ))}
                    <span>
                      탄수 <b>{food.carbPct ?? "계산불가"}</b>
                      {food.carbIsEstimated ? "*" : ""}
                    </span>
                  </div>
                  <div className="review-badges">
                    <span className="tag">근거 {food.evidenceCount}</span>
                    {food.conflicts.length > 0 && (
                      <span className="flag warn">
                        충돌 {food.conflicts.length}
                      </span>
                    )}
                    {food.carbPct === null && (
                      <span className="flag warn">탄수 계산불가</span>
                    )}
                  </div>
                  {expanded === food.id && (
                    <ul className="review-detail muted">
                      {food.sources.map((source) => (
                        <li key={source.url}>
                          {source.kind}: {source.url}
                        </li>
                      ))}
                      {food.conflicts.map((raw, index) => {
                        const conflict = conflictSchema.safeParse(raw);
                        return (
                          <li key={index}>
                            {conflict.success
                              ? `${conflict.data.key}: ${String(conflict.data.survivor_value)} ↔ ${String(conflict.data.merged_value)}`
                              : "충돌 기록"}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="muted">* 표시는 추정값(회분 익스트루전 폴백 등)</p>
        </>
      )}

      {log.length > 0 && (
        <div className="panel" role="status">
          {log.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
}
