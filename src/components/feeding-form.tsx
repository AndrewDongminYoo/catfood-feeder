"use client";

import { useState } from "react";
import type { FoodWithBrand } from "@/lib/catalog";
import type { CatProfile } from "@/lib/feeding";

export function FeedingForm({
  cats,
  foods,
}: {
  cats: CatProfile[];
  foods: FoodWithBrand[];
}) {
  const [catName, setCatName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [catId, setCatId] = useState(cats[0]?.id ? String(cats[0].id) : "");
  const [foodId, setFoodId] = useState(foods[0]?.id ? String(foods[0].id) : "");
  const [startedOn, setStartedOn] = useState("");
  const [endedOn, setEndedOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasDateOrderError = !!endedOn && !!startedOn && endedOn < startedOn;

  async function createCat() {
    setError(null);
    try {
      const response = await fetch("/api/cats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: catName, birth_date: birthDate || null }),
      });
      if (!response.ok) {
        setError(await responseError(response, "고양이 등록 실패"));
        return;
      }
      window.location.reload();
    } catch {
      setError("고양이 등록 요청에 실패했습니다. 네트워크를 확인해 주세요.");
    }
  }

  async function createFeedingLog() {
    setError(null);
    if (hasDateOrderError) {
      setError("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }
    try {
      const response = await fetch("/api/feeding-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cat_id: Number(catId),
          food_id: Number(foodId),
          started_on: startedOn,
          ended_on: endedOn || null,
          note: note || null,
        }),
      });
      if (!response.ok) {
        setError(await responseError(response, "급여 기록 실패"));
        return;
      }
      window.location.reload();
    } catch {
      setError("급여 기록 요청에 실패했습니다. 네트워크를 확인해 주세요.");
    }
  }

  return (
    <section className="split">
      <div className="panel">
        <h2>반려묘 등록</h2>
        <label>
          이름
          <input
            value={catName}
            onChange={(event) => setCatName(event.target.value)}
          />
        </label>
        <label>
          생일
          <input
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
          />
        </label>
        <button className="primary" onClick={createCat} disabled={!catName}>
          등록
        </button>
      </div>

      <div className="panel">
        <h2>급여 로그</h2>
        <label>
          고양이
          <select
            value={catId}
            onChange={(event) => setCatId(event.target.value)}
          >
            {cats.map((cat) => (
              <option value={cat.id} key={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          제품
          <select
            value={foodId}
            onChange={(event) => setFoodId(event.target.value)}
          >
            {foods.map((food) => (
              <option value={food.id} key={food.id}>
                {food.brands?.name} {food.product_name}
              </option>
            ))}
          </select>
        </label>
        <div className="frow">
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
        </div>
        {hasDateOrderError && (
          <div className="err" role="alert">
            종료일은 시작일보다 빠를 수 없습니다.
          </div>
        )}
        <label>
          메모
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button
          className="primary"
          onClick={createFeedingLog}
          disabled={!catId || !foodId || !startedOn || hasDateOrderError}
        >
          기록
        </button>
      </div>
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
    </section>
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
