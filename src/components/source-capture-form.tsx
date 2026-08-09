import { useMemo, useState } from "react";
import {
  sourceCaptureStatusMessage,
  sourceCaptureTone,
} from "@/lib/source-capture-response";
import type { SourceContentStatus } from "@/lib/source-capture-response";

type SourceKind = "manufacturer" | "kr_label";

type DraftOption = {
  readonly brands: {
    readonly ko_name: string | null;
    readonly name: string;
  } | null;
  readonly id: number;
  readonly product_name: string;
};

type SourceCaptureFormProps = {
  readonly busy: boolean;
  readonly captureStatus: SourceContentStatus | null;
  readonly fetchedSourceCount: number;
  readonly foodId: string;
  readonly foods: readonly DraftOption[];
  readonly kind: SourceKind;
  readonly manualText: string;
  readonly onFoodIdChange: (foodId: string) => void;
  readonly onKindChange: (kind: SourceKind) => void;
  readonly onManualTextChange: (text: string) => void;
  readonly onRegisterSource: () => void;
  readonly onUrlChange: (url: string) => void;
  readonly url: string;
};

export function SourceCaptureForm({
  busy,
  captureStatus,
  fetchedSourceCount,
  foodId,
  foods,
  kind,
  manualText,
  onFoodIdChange,
  onKindChange,
  onManualTextChange,
  onRegisterSource,
  onUrlChange,
  url,
}: SourceCaptureFormProps) {
  const [filter, setFilter] = useState("");
  // Draft가 400개가 넘으면 네이티브 select 하나로는 고를 수 없다. 목록만 좁히고
  // 현재 선택은 항상 남긴다 — 선택이 옵션에서 사라지면 select는 비었는데 버튼은
  // 살아 있는 상태가 되고, 그건 이 컴포넌트가 이미 막고 있는 버그다.
  const visibleFoods = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return foods;
    return foods.filter(
      (food) =>
        String(food.id) === foodId ||
        `${food.brands?.name ?? ""} ${food.brands?.ko_name ?? ""} ${food.product_name}`
          .toLowerCase()
          .includes(query),
    );
  }, [filter, foodId, foods]);

  // 제품명은 국내 표기 브랜드로 시작한다("로얄캐닌 캣 인도어 7+"). 그 앞에 정규명을
  // 또 붙이면 한 줄에 브랜드가 두 번 나온다 — optgroup이 이미 브랜드를 말하므로
  // 옵션에서는 뗀다.
  function withoutBrandPrefix(productName: string, koName: string | null) {
    if (!koName) return productName;
    const stripped = productName.slice(koName.length).trim();
    return productName.startsWith(koName) && stripped !== ""
      ? stripped
      : productName;
  }

  // id 순은 사람에게 의미가 없어 같은 브랜드가 목록 전체에 흩어진다. 브랜드로 묶고
  // 브랜드·제품명 순으로 정렬한다.
  const groupedFoods = useMemo(() => {
    const groups = new Map<
      string,
      { koName: string | null; foods: DraftOption[] }
    >();
    for (const food of visibleFoods) {
      const label = food.brands?.name ?? "미분류";
      const group: { koName: string | null; foods: DraftOption[] } = groups.get(
        label,
      ) ?? {
        foods: [],
        koName: food.brands?.ko_name ?? null,
      };
      group.foods.push(food);
      groups.set(label, group);
    }
    return [...groups.entries()]
      .map(([label, group]) => ({
        ...group,
        foods: [...group.foods].sort((a, b) =>
          a.product_name.localeCompare(b.product_name, "ko"),
        ),
        label,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }, [visibleFoods]);

  return (
    <>
      <label>
        Draft 제품 검색
        <input
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`브랜드 또는 제품명 (전체 ${foods.length}개)`}
          value={filter}
        />
      </label>
      <label>
        Draft 제품
        <select
          value={foodId}
          onChange={(event) => onFoodIdChange(event.target.value)}
        >
          <option value="">선택하세요</option>
          {groupedFoods.map((group) => (
            <optgroup
              key={group.label}
              label={
                group.koName && group.koName !== group.label
                  ? `${group.label} (${group.koName}) · ${group.foods.length}`
                  : `${group.label} · ${group.foods.length}`
              }
            >
              {group.foods.map((food) => (
                <option key={food.id} value={food.id}>
                  {withoutBrandPrefix(
                    food.product_name,
                    group.koName ?? food.brands?.ko_name ?? null,
                  )}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {filter.trim() !== "" && (
        <p className="muted" role="status">
          {visibleFoods.length}개 표시 중 (전체 {foods.length}개) ·{" "}
          {groupedFoods.length}개 브랜드
        </p>
      )}
      <label>
        출처 종류
        <select
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value;
            if (nextKind === "manufacturer" || nextKind === "kr_label") {
              onKindChange(nextKind);
            }
          }}
        >
          <option value="manufacturer">제조사</option>
          <option value="kr_label">국내 라벨</option>
        </select>
      </label>
      <label>
        제품 URL
        <input
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://..."
        />
      </label>
      <label>
        수동 전사본 (선택)
        <textarea
          className="sm"
          value={manualText}
          onChange={(event) => onManualTextChange(event.target.value)}
        />
      </label>
      <button
        className="primary"
        // 목록에 없는 foodId가 남을 수 있다(loadDrafts는 현재 선택을 보존한다).
        // !foodId로 판단하면 select는 비었는데 버튼만 살아 클릭이 조용히 무시된다.
        disabled={
          busy || !foods.some((food) => String(food.id) === foodId) || !url
        }
        onClick={onRegisterSource}
      >
        출처 수집
      </button>
      {captureStatus && (
        <p
          className={
            sourceCaptureTone(captureStatus) === "warning"
              ? "flag warn"
              : "okbox"
          }
          role={
            sourceCaptureTone(captureStatus) === "warning" ? "alert" : "status"
          }
        >
          {sourceCaptureStatusMessage(captureStatus)}
        </p>
      )}
      {fetchedSourceCount > 0 && (
        <div className="flag warn" role="status">
          수집 완료 출처 {fetchedSourceCount}개
        </div>
      )}
    </>
  );
}
