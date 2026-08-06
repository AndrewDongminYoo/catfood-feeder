import { useMemo, useState } from "react";
import {
  sourceCaptureStatusMessage,
  sourceCaptureTone,
} from "@/lib/source-capture-response";
import type { SourceContentStatus } from "@/lib/source-capture-response";

type SourceKind = "manufacturer" | "kr_label";

type DraftOption = {
  readonly brands: { readonly name: string } | null;
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
  // Draft가 700개 가까이 되면 네이티브 select 하나로는 고를 수 없다. 목록만 좁히고
  // 현재 선택은 항상 남긴다 — 선택이 옵션에서 사라지면 select는 비었는데 버튼은
  // 살아 있는 상태가 되고, 그건 이 컴포넌트가 이미 막고 있는 버그다.
  const visibleFoods = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return foods;
    return foods.filter(
      (food) =>
        String(food.id) === foodId ||
        `${food.brands?.name ?? ""} ${food.product_name}`
          .toLowerCase()
          .includes(query),
    );
  }, [filter, foodId, foods]);

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
          {visibleFoods.map((food) => (
            <option key={food.id} value={food.id}>
              {food.brands?.name ?? "미분류"} — {food.product_name}
            </option>
          ))}
        </select>
      </label>
      {filter.trim() !== "" && (
        <p className="muted" role="status">
          {visibleFoods.length}개 표시 중 (전체 {foods.length}개)
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
