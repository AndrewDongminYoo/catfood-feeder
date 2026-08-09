-- 이름으로는 잡히지 않는 중복 10쌍을 병합하고, 성공으로 기록된 실패 캡처를 되돌린다.
--
-- 앞선 병합들은 (brand_id, product_name)이 정확히 같은 행만 묶었다. 그래서 같은
-- 레시피가 영문명과 한글명으로 갈려 있거나(ACANA Highest Protein Kitten ↔ 아카나 캣
-- 하이프로틴 키튼), 음차가 다르거나(오븐베이크 ↔ 오븐베이크드, 화이버 ↔ 파이버),
-- 포장 단위가 이름에 남아 있으면(인도어 대용량 ↔ 인도어) 그대로 두 행이었다.
-- 그중 넷은 양쪽 다 발행돼 공개 카탈로그에 같은 사료가 두 번 보이고 있었다.
--
-- 찾은 방법: 같은 브랜드의 여러 사료가 같은 content_hash 의 현행 출처를 들고 있는지.
-- 이름이 아니라 "무엇을 읽었는가"로 묶으므로 표기 차이를 통과한다. 근거가 아예 없는
-- 두 건(ACANA 4, LEONARDO 699)은 출처가 없어 이 방법에 걸리지 않았고, 같은 브랜드에서
-- 값이 완전히 일치하는 형제를 찾아 확인했다.
--
-- 같은 페이지를 공유하는 것이 전부 중복은 아니다. 쉐리 623·630·640 은 한 목록
-- 페이지에 실린 서로 다른 세 레시피이고, 퍼스트초이스 4건은 아래 B에서 따로 다룬다.
--
-- 적용한 뒤 sqlfluff 지적을 반영해 줄바꿈·대소문자·noqa 주석만 고쳤다. 로직은 적용
-- 당시와 같다. 새 복원본에 재생할 일이 있으면 먼저 ROLLBACK 으로 건수를 확인할 것
-- (적용 시점 기록: 근거 이동 52, 출처 이동 14, 조사이력 6, 삭제 10, 빈 캡처 은퇴 4).

BEGIN;

CREATE TEMP TABLE merge_plan (
  loser_id bigint,
  survivor_id bigint,
  why text
);

INSERT INTO merge_plan (loser_id, survivor_id, why) VALUES
-- 생존 행은 근거가 있는 쪽. 근거 수가 같으면 제품명이 정확한 쪽을 남긴다.
(4, 95, '영문명/한글명. 95가 근거 8개, 4는 0개'),
(699, 53, '영문명/한글명(fresh Duck = 순수생육 오리). 53이 근거 7개, 699는 0개'),
(14, 136, '중량 변형. 136이 kcal 을 갖고 있다'),
(629, 636, '힐스 캣 c/d 는 잘린 이름. C/D 멀티케어가 정식 제품명'),
(220, 186, '인스팅트 = 생식본능. 같은 말이 두 번 들어간 쪽을 버린다'),
(450, 449, '음차 변형. 449가 kcal 을 갖고 있다'),
(438, 283, '음차 변형. 값·근거 수가 같아 낮은 id 를 남긴다'),
(497, 308, '음차 변형. 308이 kcal 을 갖고 있다'),
(271, 390, '"대용량"은 포장 단위 잔재다. 사료 행은 레시피이지 판매 단위가 아니다'),
(610, 105, '화이버/파이버 음차. 제조사 페이지는 둘 다 안 쓰고 FIBRE/FIBER 로만 쓴다');

-- 병합이 값을 바꾸지 않는지 먼저 확인한다. 앞선 병합은 어긋나는 값을 source_conflicts
-- 에 적어 두었는데, 그 기록이 몇 주 동안 브랜드 전체의 발행을 막았다. 이번 10쌍은
-- 적용 시점에 불일치 0건·생존 행에 없는 키 0건이었다. 그 전제가 깨지면 조용히
-- 값을 잃는 대신 여기서 멈춘다.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM merge_plan p
  JOIN public.food_nutrient_evidence e ON e.food_id = p.loser_id AND e.is_current
  JOIN public.food_nutrient_evidence sv ON sv.food_id = p.survivor_id
    AND sv.nutrient_key = e.nutrient_key AND sv.is_current
  WHERE sv.value IS DISTINCT FROM e.value;
  IF bad <> 0 THEN
    RAISE EXCEPTION '생존 행과 값이 어긋나는 근거 %건 — 순수 중복이 아니다', bad;
  END IF;

  SELECT count(*) INTO bad
  FROM merge_plan p
  JOIN public.food_nutrient_evidence e ON e.food_id = p.loser_id AND e.is_current
  WHERE NOT EXISTS (
    SELECT 1 FROM public.food_nutrient_evidence sv
    WHERE sv.food_id = p.survivor_id AND sv.nutrient_key = e.nutrient_key AND sv.is_current
  );
  IF bad <> 0 THEN
    RAISE EXCEPTION '생존 행에 없는 키를 loser 가 %건 갖고 있다 — 보완 병합이 필요하다', bad;
  END IF;

  -- 한 쌍당 loser 하나. loser 가 다른 쌍의 survivor 이면 이동이 꼬인다.
  IF EXISTS (SELECT 1 FROM merge_plan WHERE loser_id IN (SELECT survivor_id FROM merge_plan)) THEN
    RAISE EXCEPTION 'loser 가 동시에 survivor 인 쌍이 있다';
  END IF;

  -- 자식 테이블 중 옮기지 않는 것에 행이 걸려 있으면 CASCADE 로 사라진다.
  SELECT count(*) INTO bad FROM merge_plan p
  WHERE EXISTS (SELECT 1 FROM public.prices x WHERE x.food_id = p.loser_id)
     OR EXISTS (SELECT 1 FROM public.feeding_logs x WHERE x.food_id = p.loser_id);
  IF bad <> 0 THEN RAISE EXCEPTION '가격·급여기록이 걸린 loser %건', bad; END IF;
END $$;

-- 옮기기 전에 강등한다. UNIQUE (food_id, nutrient_key) WHERE is_current 와
-- UNIQUE (food_id, kind) WHERE is_current AND fetched 때문에, 생존 행이 이미 가진
-- 키·종류를 그대로 옮기면 제약을 위반한다. 값이 같음은 위에서 확인했으므로 버리는
-- 쪽을 내려도 잃는 것이 없다.
UPDATE public.food_nutrient_evidence e
SET is_current = false
FROM merge_plan p
WHERE e.food_id = p.loser_id
  AND e.is_current
  AND EXISTS (
    SELECT 1 FROM public.food_nutrient_evidence sv
    WHERE sv.food_id = p.survivor_id  -- noqa: RF01
      AND sv.nutrient_key = e.nutrient_key
      AND sv.is_current
  );

UPDATE public.food_sources s
SET is_current = false
FROM merge_plan p
WHERE s.food_id = p.loser_id
  AND s.is_current AND s.fetch_status = 'fetched'
  AND EXISTS (
    SELECT 1 FROM public.food_sources sv
    WHERE sv.food_id = p.survivor_id  -- noqa: RF01
      AND sv.kind = s.kind
      AND sv.is_current AND sv.fetch_status = 'fetched'
  );

-- 자식을 옮긴 뒤에 지운다. foods 의 FK 가 전부 CASCADE 라, 먼저 지우면 출처·근거·
-- 조사 이력이 함께 사라진다. recalls 는 SET NULL 이라 링크만 끊긴다.
UPDATE public.food_nutrient_evidence e SET food_id = p.survivor_id
FROM merge_plan p
WHERE e.food_id = p.loser_id;
UPDATE public.food_sources s SET food_id = p.survivor_id
FROM merge_plan p
WHERE s.food_id = p.loser_id;
UPDATE public.food_research_runs r SET food_id = p.survivor_id
FROM merge_plan p
WHERE r.food_id = p.loser_id;
UPDATE public.recalls rc SET food_id = p.survivor_id
FROM merge_plan p
WHERE rc.food_id = p.loser_id;

DELETE FROM public.foods
WHERE id IN (SELECT loser_id FROM merge_plan);

-- ── B. 성공으로 기록된 봇 차단 캡처 ───────────────────────────────────────────
-- 퍼스트초이스 4건의 현행 출처는 본문이 37바이트짜리 "Verifying that you are not a
-- robot..." 이다. fetch_status 는 'fetched' 이므로 파이프라인에는 성공으로 보이고,
-- 그래서 아무도 다시 시도하지 않는다 — 영양값이 전부 비어 있는데도 조사를 마친
-- 행처럼 취급된다. 은퇴시켜 조사 큐로 돌려보낸다.
--
-- 문구만 보고 지우지 않는다. 카나간·맥아담스의 캡처에도 같은 문구가 들어 있지만
-- 7.5KB 본문에 근거 6개가 붙어 있는 정상 페이지다(푸터 안내문). 길이로 가른다.

UPDATE public.food_sources
SET is_current = false
WHERE is_current
  AND fetch_status = 'fetched'
  AND length(captured_text) < 200;

-- ── C. 근거 없이 발행된 행 ────────────────────────────────────────────────────
-- ACANA 3 은 근거가 하나도 없는 채로 발행돼 있다. 값은 초기 큐레이션의 산물이라
-- 지우지 않지만, 검증할 수 없는 값을 공개해 두는 것은 이 파이프라인의 전제를
-- 정면으로 어긴다(발행 RPC 는 값마다 현행 근거를 요구한다). 초안으로 되돌려
-- 검토 화면에 "근거 0" 으로 드러나게 한다. 출처가 붙으면 다시 발행하면 된다.
--
-- 같은 증상이던 ACANA 4 와 LEONARDO 699 는 위에서 병합돼 사라졌다. 근거를 가진
-- 형제가 이미 발행돼 있으므로 공개 카탈로그에서 빠지는 것은 없다.
--
-- foods_publication_state_valid 가 세 컬럼을 함께 묶는다: published_at 이 NULL 이면
-- verification_method 와 published_by 도 NULL 이어야 한다. published_at 만 지우면
-- 제약 위반으로 막힌다. data_verified_at 은 발행 상태일 때만 요구되므로 언제
-- 검증했는지의 기록으로 남겨 둔다.

UPDATE public.foods
SET published_at = null,
    verification_method = null,
    published_by = null,
    updated_at = statement_timestamp()
WHERE id = 3;

-- ── 단언 ──────────────────────────────────────────────────────────────────────

DO $$
DECLARE bad int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.foods WHERE id IN (4, 699, 14, 629, 220, 450, 438, 497, 271, 610)) THEN
    RAISE EXCEPTION 'loser 가 남아 있다';
  END IF;

  SELECT count(*) INTO bad FROM merge_plan p
  WHERE NOT EXISTS (SELECT 1 FROM public.foods f WHERE f.id = p.survivor_id);
  IF bad <> 0 THEN RAISE EXCEPTION '생존 행이 사라진 쌍 %건', bad; END IF;

  SELECT count(*) INTO bad FROM public.food_nutrient_evidence e
  WHERE NOT EXISTS (SELECT 1 FROM public.foods f WHERE f.id = e.food_id);
  IF bad <> 0 THEN RAISE EXCEPTION '고아 근거 %건', bad; END IF;

  SELECT count(*) INTO bad FROM public.food_sources s
  WHERE NOT EXISTS (SELECT 1 FROM public.foods f WHERE f.id = s.food_id);
  IF bad <> 0 THEN RAISE EXCEPTION '고아 출처 %건', bad; END IF;

  -- 같은 브랜드가 같은 페이지를 현행으로 들고 있는 그룹은 쉐리 하나만 남아야 한다
  -- (한 목록 페이지의 서로 다른 세 레시피).
  SELECT count(*) INTO bad FROM (
    SELECT s.content_hash, f.brand_id
    FROM public.food_sources s
    JOIN public.foods f ON f.id = s.food_id
    WHERE s.is_current AND s.fetch_status = 'fetched'
    GROUP BY 1, 2 HAVING count(DISTINCT f.id) > 1
  ) x;
  IF bad <> 1 THEN RAISE EXCEPTION '같은 페이지를 공유하는 그룹이 %개 (쉐리 1개만 남아야 한다)', bad; END IF;

  -- 내용 없는 캡처가 현행으로 남아 있으면 안 된다.
  SELECT count(*) INTO bad FROM public.food_sources
  WHERE is_current AND fetch_status = 'fetched' AND length(captured_text) < 200;
  IF bad <> 0 THEN RAISE EXCEPTION '빈 캡처가 현행인 출처 %건', bad; END IF;

  -- 발행된 행은 실측 태그가 붙은 값마다 현행 근거가 있어야 한다.
  SELECT count(*) INTO bad
  FROM public.foods f
  CROSS JOIN unnest(ARRAY['protein_pct','fat_pct','fiber_pct','ash_pct','moisture_pct',
                          'calcium_pct','phosphorus_pct','kcal_per_kg','carb_pct']) AS k(key)
  WHERE f.published_at IS NOT NULL
    AND f.nutrient_sources->>k.key IN ('manufacturer','kr_label')
    AND (to_jsonb(f)->>k.key) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.food_nutrient_evidence e
      JOIN public.food_sources s ON s.id = e.source_id
      WHERE e.food_id = f.id AND e.nutrient_key = k.key AND e.is_current
        AND s.is_current AND s.fetch_status = 'fetched'
    );
  IF bad <> 0 THEN RAISE EXCEPTION '근거 없이 발행된 값 %건', bad; END IF;
END $$;

COMMIT;
