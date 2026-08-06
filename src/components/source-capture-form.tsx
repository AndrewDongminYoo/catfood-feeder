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
  return (
    <>
      <label>
        Draft 제품
        <select
          value={foodId}
          onChange={(event) => onFoodIdChange(event.target.value)}
        >
          <option value="">선택하세요</option>
          {foods.map((food) => (
            <option key={food.id} value={food.id}>
              {food.brands?.name ?? "미분류"} — {food.product_name}
            </option>
          ))}
        </select>
      </label>
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
        <div className="warn" role="status">
          수집 완료 출처 {fetchedSourceCount}개
        </div>
      )}
    </>
  );
}
