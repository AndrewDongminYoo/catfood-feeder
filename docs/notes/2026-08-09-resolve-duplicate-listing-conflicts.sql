-- 병합이 남긴 duplicate_listing 충돌 16건을 해소한다.
--
-- 이 충돌은 두 출처가 지금 다투는 것이 아니다. 중량·표기 변형 병합(2026-08-09)이
-- 사라지는 행의 값과 생존 행의 값이 어긋난 사실을 source_conflicts에 적어 둔 기록이고,
-- 그 뒤로 아무도 지우지 않아 발행 검토 화면에 "충돌"로 계속 남아 있었다. 운영자는
-- 브랜드 단위로 발행하므로, 한 건이 남으면 그 브랜드 전체가 묶인다.
--
-- 44개 충돌 키를 전부 살펴본 결과 처분은 네 가지로 갈렸다. "생존값이 이겼으니 기록만
-- 지운다"로 일괄 처리하면 안 된다 — 생존값에 현행 근거가 있다는 것은 인용이 정확하다는
-- 뜻이지 그 페이지가 맞는 제품이라는 뜻이 아니다. 실제로 두 건이 다른 제품의 표였다.
--
--   재지정  쉐리 623·640 — 같은 페이지의 다른 줄을 읽었다.
--   교체    로얄캐닌 178 — 한국 판매 제형 대신 미국 제형이 실려 있었다.
--   회수    오리젠 10   — 현행 출처가 개 사료 페이지였다.
--   기록삭제 나머지 13  — 현행 출처가 맞다. 기록만 지운다.
--
-- 적용한 뒤 sqlfluff 지적을 반영해 줄바꿈·대소문자·noqa 주석만 고쳤다. 로직은 적용
-- 당시와 같다. 다만 이 파일을 다시 돌려서 확인한 것은 "이미 적용된 상태에서 단언이
-- 통과한다"는 것뿐이고, 재지정 UPDATE 자체는 그때 0건을 건드렸다 — 새 복원본에 대고
-- 재생할 일이 있으면 먼저 ROLLBACK 으로 건수를 확인할 것.

BEGIN;

-- ── 1. 쉐리: 같은 페이지의 다른 줄 ─────────────────────────────────────────────
-- cheriepetfood.eu/dry-food 는 여러 레시피를 한 표에 싣는 목록 페이지다. 사료마다
-- 이 페이지를 따로 캡처해 두었는데(623·630·640 모두), 623의 현행 근거는 Turkey 줄을
-- 읽어 왔다. 623은 "생육 닭고기"이고 630이 "생육 칠면조"다 — 두 행이 같은 값을 갖고
-- 있었던 것이 그 증거다. 은퇴한 출처 593이 Chicken 줄을 정확히 읽었다.
--
--   Chicken  단백 32 / 지방 12 / 섬유 3.5 / 회분 12 / 칼슘 1.9 / 인 1.1 / 탄수 33 / 3823 kcal
--   Turkey   단백 34 / 지방 14 / 섬유 3   / 회분 10.5 / 칼슘 1.7 / 인 1.0 /          3880 kcal
--
-- kcal 3823은 현행 근거가 이미 Chicken 값을 들고 있으므로 건드리지 않는다.
--
-- 출처를 교체하지 않고 근거만 옮긴다. 다섯 캡처의 content_hash가 전부 같아서, 옮긴
-- 근거의 구절도 새 출처의 보관 원문에 그대로 있다 — apply 엔드포인트가 하는 검증과
-- 같은 것이 성립한다. 아래에서 해시와 구절을 둘 다 단언한다.

CREATE TEMP TABLE repoint AS
SELECT * FROM (VALUES
  -- (근거를 옮겨올 은퇴 출처, 옮겨 붙일 현행 출처)
  (593::bigint, 442::bigint),   -- 쉐리 닭고기: Chicken 줄 8개 키
  (594::bigint, 444::bigint)    -- 쉐리 그레인프리 오리: 탄수 24.8 (다른 키는 현행에 이미 있다)
) AS t(from_source, to_source);

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM repoint r
  JOIN public.food_sources a ON a.id = r.from_source
  JOIN public.food_sources b ON b.id = r.to_source
  WHERE a.content_hash IS DISTINCT FROM b.content_hash
     OR a.food_id <> b.food_id
     OR NOT b.is_current OR b.fetch_status <> 'fetched';
  IF bad <> 0 THEN
    RAISE EXCEPTION '재지정 대상이 같은 사료의 동일 캡처가 아니다 (%건)', bad;
  END IF;

  -- 옮길 근거의 구절이 새 출처의 보관 원문에 문자 그대로 있는지. 신뢰 경계는
  -- 다른 경로와 같다: 원문에 없는 구절은 값을 쓰지 못한다.
  SELECT count(*) INTO bad
  FROM repoint r
  JOIN public.food_nutrient_evidence e ON e.source_id = r.from_source
  JOIN public.food_sources b ON b.id = r.to_source
  WHERE position(e.excerpt IN b.captured_text) = 0;
  IF bad <> 0 THEN
    RAISE EXCEPTION '옮길 근거의 구절이 새 출처 원문에 없다 (%건)', bad;
  END IF;
END $$;

-- 먼저 내린다. UNIQUE (food_id, nutrient_key) WHERE is_current 때문에 올리기 전에
-- 자리를 비워야 한다. 옮겨올 키만 내리므로 623의 kcal 근거는 현행으로 남는다.
UPDATE public.food_nutrient_evidence e
SET is_current = false
FROM repoint r, public.food_sources b
WHERE b.id = r.to_source
  AND e.food_id = b.food_id
  AND e.is_current
  -- 상관 참조(바깥 UPDATE ... FROM repoint r)를 sqlfluff 가 따라가지 못한다.
  AND e.nutrient_key IN (
    SELECT x.nutrient_key
    FROM public.food_nutrient_evidence x
    WHERE x.source_id = r.from_source  -- noqa: RF01
  );

UPDATE public.food_nutrient_evidence e
SET source_id = r.to_source, is_current = true
FROM repoint r
WHERE e.source_id = r.from_source;

-- ── 2. 로얄캐닌 샴: 한국 제형으로 교체 ────────────────────────────────────────
-- 현행이 royalcanin.com/us(단백 35·지방 14·섬유 3.5), 은퇴가 /kr(단백 38·지방 16·
-- 섬유 1.4·회분 7.7)이다. 값이 이 정도로 벌어지면 캡처 실수가 아니라 지역별 제형이
-- 다른 것이고, 한국에서 파는 것은 유럽 제형이다. 카탈로그가 문서화하는 것은 한국
-- 시장이므로 /kr 을 현행으로 세운다.
--
-- 대가가 있다: /kr 캡처에는 kcal과 수분이 없어 두 값이 근거를 잃고 비워진다(회분은
-- 새로 얻는다). 수분이 없으면 탄수화물이 계산되지 않으므로 이 사료는 "충돌"에서
-- "탄수 계산불가"로 옮겨가 수분 조사 큐에 들어간다. 미국 제형의 숫자를 한국 제품에
-- 붙여 두는 것보다 낫다.

UPDATE public.food_sources SET is_current = false
WHERE id = 240;  -- royalcanin.com/us
UPDATE public.food_sources SET is_current = true
WHERE id = 251;  -- royalcanin.com/kr

-- ── 3. 오리젠 캣 오리지널: 회수 ───────────────────────────────────────────────
-- 현행 출처가 /en-CA/dogs/dog-food/original/ 이다. 고양이 사료 행에 개 사료의
-- 보증분석이 실려 있었다. 전체 대기 행을 훑어 같은 증상은 이 한 건뿐임을 확인했다.
--
-- 은퇴해 있던 apac 페이지로 넘기지 않는다. 그쪽은 ap-ori-ns-catkitten(Cat & Kitten)
-- 이고 그 값은 이미 74번 "오리젠 캣 키튼"이 들고 있는 것과 거의 같다 — 쉐리에서
-- 본 것과 같은 신호다. 넘기면 다른 제품의 표를 다시 붙이게 된다. 10번과 74번이
-- 같은 레시피인지는 이름 문제이고 운영자가 판단할 몫이므로, 값을 비우고 조사 큐로
-- 돌려보낸다.

UPDATE public.food_sources SET is_current = false
WHERE id = 44;  -- .../dogs/dog-food/original/

-- 현행이 아닌 출처에 걸린 근거는 내린다. 그대로 두면 발행이 없는 출처를 찾는다.
UPDATE public.food_nutrient_evidence e
SET is_current = false
WHERE e.is_current
  AND e.food_id IN (10, 178)
  AND NOT EXISTS (
    SELECT 1 FROM public.food_sources s
    WHERE s.id = e.source_id AND s.is_current AND s.fetch_status = 'fetched'
  );

-- 새로 현행이 된 출처의 근거를 올린다. 키당 하나만 남기려면 위의 내리기가 먼저다.
UPDATE public.food_nutrient_evidence e
SET is_current = true
WHERE e.source_id = 251
  AND NOT e.is_current;

-- ── 4. 값과 태그를 현재 근거에서 다시 만든다 ──────────────────────────────────
-- 근거를 잃은 값은 지운다. 컬럼에 남겨 두면 발행이 missing_evidence로 막히는데,
-- 화면에는 실측처럼 보인다. 넷 다 초안이고 저장된 파생값(energy_*)이 없어서
-- nutrient_sources를 통째로 다시 만들어도 안전하다.

DO $$
DECLARE k text; ids bigint[] := ARRAY[10, 178, 623, 640];
BEGIN
  FOREACH k IN ARRAY ARRAY['protein_pct','fat_pct','fiber_pct','ash_pct','moisture_pct',
                           'calcium_pct','phosphorus_pct','kcal_per_kg','carb_pct']
  LOOP
    EXECUTE format($f$
      UPDATE public.foods f
      SET %1$I = (
        SELECT e.value
        FROM public.food_nutrient_evidence e
        JOIN public.food_sources s ON s.id = e.source_id
        WHERE e.food_id = f.id AND e.nutrient_key = %1$L AND e.is_current
          AND s.is_current AND s.fetch_status = 'fetched'
      )
      WHERE f.id = ANY($1)
    $f$, k) USING ids;
  END LOOP;
END $$;

UPDATE public.foods f
SET nutrient_sources = coalesce((
      SELECT jsonb_object_agg(e.nutrient_key, s.kind::text)
      FROM public.food_nutrient_evidence e
      JOIN public.food_sources s ON s.id = e.source_id
      WHERE e.food_id = f.id AND e.is_current
        AND s.is_current AND s.fetch_status = 'fetched'
    ), '{}'::jsonb),
    updated_at = statement_timestamp()
WHERE f.id = any(ARRAY[10, 178, 623, 640]);

-- ── 5. 나머지 13건: 현행 출처가 맞다 ──────────────────────────────────────────
-- 18·48·137·201·309 로얄캐닌, 254·298 블랙우드, 277 후새: 현행이 한국 페이지이고
--   병합된 쪽이 /id·/us·/au·대만·영국이다. 한국 시장 표기가 이긴다.
-- 57·415 로얄캐닌, 499 카니러브: 한국 페이지가 아예 없다. 현행 제조사 페이지가
--   최선이고 키도 더 많다. 수분 조사에서 한국 페이지가 나오면 그때 다시 본다.
-- 30·123 아카나: en-CA 와 apac/ko-KR 이 칼슘만 다르다(1.5↔1.8, 1.6↔2.0). 나머지
--   값은 전부 같다. 이미 발행된 아카나 38·67·95·141 이 모두 en-CA 를 현행으로
--   쓰고 있으므로 en-CA 를 유지한다 — 한 브랜드 안에서 출처가 갈리는 편이 나쁘다.
--   한국 표기 칼슘이 필요해지면 apac 출처가 은퇴 상태로 남아 있어 되살릴 수 있다.
--
-- 기록을 지우는 것은 "사람이 봤다"는 뜻이다. 남겨 두면 다음 검토가 같은 44개를
-- 다시 판단해야 하고, 화면은 영원히 충돌을 띄운다.

UPDATE public.foods
SET source_conflicts = '[]'::jsonb, updated_at = statement_timestamp()
WHERE id IN (10, 18, 30, 48, 57, 123, 137, 178, 201, 254, 277, 298, 309, 415, 499, 623);

-- ── 6. 단언 ───────────────────────────────────────────────────────────────────

DO $$
DECLARE bad int; v numeric;
BEGIN
  SELECT count(*) INTO bad FROM public.foods
  WHERE id IN (10, 18, 30, 48, 57, 123, 137, 178, 201, 254, 277, 298, 309, 415, 499, 623)
    AND jsonb_array_length(source_conflicts) > 0;
  IF bad <> 0 THEN RAISE EXCEPTION '충돌이 남은 사료 %건', bad; END IF;

  -- 근거는 반드시 현행·수집완료 출처가 받쳐야 한다.
  SELECT count(*) INTO bad
  FROM public.food_nutrient_evidence e
  JOIN public.food_sources s ON s.id = e.source_id
  WHERE e.is_current AND NOT (s.is_current AND s.fetch_status = 'fetched');
  IF bad <> 0 THEN RAISE EXCEPTION '받쳐지지 않는 근거 %건', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT food_id, kind FROM public.food_sources
    WHERE is_current AND fetch_status = 'fetched'
    GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF bad <> 0 THEN RAISE EXCEPTION '종류당 현행 출처가 여럿인 사료 %건', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT food_id, nutrient_key FROM public.food_nutrient_evidence
    WHERE is_current GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF bad <> 0 THEN RAISE EXCEPTION '키당 현행 근거가 여럿인 사료 %건', bad; END IF;

  -- 실측 태그가 붙은 값은 전부 현행 근거가 있어야 한다(대기 중인 사료 전체).
  SELECT count(*) INTO bad
  FROM public.foods f
  CROSS JOIN unnest(ARRAY['protein_pct','fat_pct','fiber_pct','ash_pct','moisture_pct',
                          'calcium_pct','phosphorus_pct','kcal_per_kg','carb_pct']) AS k(key)
  WHERE f.published_at IS NULL
    AND f.nutrient_sources->>k.key IN ('manufacturer','kr_label')
    AND (to_jsonb(f)->>k.key) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.food_nutrient_evidence e
      JOIN public.food_sources s ON s.id = e.source_id
      WHERE e.food_id = f.id AND e.nutrient_key = k.key AND e.is_current
        AND s.is_current AND s.fetch_status = 'fetched'
    );
  IF bad <> 0 THEN RAISE EXCEPTION '근거 없는 실측값 %건', bad; END IF;

  -- 쉐리 닭고기가 Chicken 줄로 바뀌었는지. 칠면조(630)와 같은 값이면 실패다.
  -- IS DISTINCT FROM 을 쓴다: 값이 NULL 로 비워지는 실패에서 `<> 32`는 NULL 이 되어
  -- IF 가 통과한다 — 근거를 못 올린 채 컬럼만 지운 경우가 그대로 빠져나갔다.
  SELECT protein_pct INTO v FROM public.foods WHERE id = 623;
  IF v IS DISTINCT FROM 32 THEN RAISE EXCEPTION '623 단백질이 % (Chicken 32 이어야 한다)', v; END IF;
  SELECT ash_pct INTO v FROM public.foods WHERE id = 623;
  IF v IS DISTINCT FROM 12 THEN RAISE EXCEPTION '623 회분이 % (Chicken 12 이어야 한다)', v; END IF;
  SELECT carb_pct INTO v FROM public.foods WHERE id = 623;
  IF v IS DISTINCT FROM 33 THEN RAISE EXCEPTION '623 탄수화물이 % (Chicken 33 이어야 한다)', v; END IF;
  SELECT kcal_per_kg INTO v FROM public.foods WHERE id = 623;
  IF v IS DISTINCT FROM 3823 THEN RAISE EXCEPTION '623 kcal이 % (3823 이어야 한다)', v; END IF;
  SELECT carb_pct INTO v FROM public.foods WHERE id = 640;
  IF v IS DISTINCT FROM 24.8 THEN RAISE EXCEPTION '640 탄수화물이 % (24.8 이어야 한다)', v; END IF;

  -- 178은 한국 페이지로 갈아탔다. 회분을 얻고 수분·kcal 을 잃는 것이 의도한 결과다.
  SELECT ash_pct INTO v FROM public.foods WHERE id = 178;
  IF v IS DISTINCT FROM 7.7 THEN RAISE EXCEPTION '178 회분이 % (kr 7.7 이어야 한다)', v; END IF;
  SELECT protein_pct INTO v FROM public.foods WHERE id = 178;
  IF v IS DISTINCT FROM 38 THEN RAISE EXCEPTION '178 단백질이 % (kr 38 이어야 한다)', v; END IF;
  SELECT moisture_pct INTO v FROM public.foods WHERE id = 178;
  IF v IS NOT NULL THEN RAISE EXCEPTION '178 수분이 남아 있다 (%) — 근거 없는 값이다', v; END IF;

  -- 오리젠 10은 값이 비워져 조사 큐로 돌아가야 한다.
  SELECT protein_pct INTO v FROM public.foods WHERE id = 10;
  IF v IS NOT NULL THEN RAISE EXCEPTION '10번이 아직 값을 들고 있다 (%)', v; END IF;
END $$;

COMMIT;
