"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { FoodWithBrand } from "@/lib/catalog";
import type { FeedingLog } from "@/lib/feeding";

export function FeedingLogEditor({
  foods,
  log,
}: {
  foods: FoodWithBrand[];
  log: FeedingLog;
}) {
  const router = useRouter();
  const [foodId, setFoodId] = useState(
    String(log.foods?.id ?? foods[0]?.id ?? ""),
  );
  const [startedOn, setStartedOn] = useState(log.started_on);
  const [endedOn, setEndedOn] = useState(log.ended_on ?? "");
  const [note, setNote] = useState(log.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hasDateOrderError = !!endedOn && endedOn < startedOn;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (hasDateOrderError) {
      setError("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/feeding-logs/${log.id}`, {
        body: JSON.stringify({
          ended_on: endedOn || null,
          food_id: Number(foodId),
          note: note || null,
          started_on: startedOn,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        setError(await responseError(response, "급여 기록 수정 실패"));
        return;
      }
      router.refresh();
    } catch {
      setError("급여 기록 수정 요청에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!window.confirm("이 급여 기록을 삭제할까요?")) return;

    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/feeding-logs/${log.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await responseError(response, "급여 기록 삭제 실패"));
        return;
      }
      router.refresh();
    } catch {
      setError("급여 기록 삭제 요청에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="feeding-log-editor">
      <summary>기록 수정</summary>
      <form onSubmit={save}>
        <label>
          제품
          <select
            value={foodId}
            onChange={(event) => setFoodId(event.target.value)}
          >
            {foods.map((food) => (
              <option key={food.id} value={food.id}>
                {food.brands?.name} {food.product_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          시작일
          <input
            type="date"
            value={startedOn}
            onChange={(event) => setStartedOn(event.target.value)}
          />
        </label>
        <label>
          종료일
          <input
            type="date"
            value={endedOn}
            onChange={(event) => setEndedOn(event.target.value)}
          />
        </label>
        <label>
          메모
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <span className="inline-actions">
          <button
            className="ghost"
            disabled={pending || !foodId || !startedOn || hasDateOrderError}
            type="submit"
          >
            저장
          </button>
          <button
            className="ghost"
            disabled={pending}
            onClick={remove}
            type="button"
          >
            삭제
          </button>
        </span>
        {hasDateOrderError && (
          <span className="err" role="alert">
            종료일은 시작일보다 빠를 수 없습니다.
          </span>
        )}
        {error && (
          <span className="err" role="alert">
            {error}
          </span>
        )}
      </form>
    </details>
  );
}

async function responseError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}
