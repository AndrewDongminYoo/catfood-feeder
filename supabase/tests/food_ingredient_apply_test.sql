BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(15);

-- 로컬 스택의 기본 권한에는 SELECT 가 없다. 트랜잭션 안에서만 부여한다.
GRANT SELECT ON public.foods, public.food_sources, public.food_ingredient_evidence TO service_role;

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-93001, 'pgTAP ingredient brand', 'pgTAP ingredient brand', 'pgTAP manufacturer');

-- 이 채널의 실제 대상은 이미 발행되고 사람이 검증한 행이다. 발행된 125건이 전부
-- 그 모양이므로 픽스처도 그렇게 둔다 — 미발행 draft 로 검사하면 통과가 공허해진다.
INSERT INTO public.foods (
  id, brand_id, product_name, ingredients, published_at, data_verified_at, verification_method
)
OVERRIDING SYSTEM VALUE
VALUES (
  -93001,
  -93001,
  'ingredient apply',
  '[]'::jsonb,
  '2026-08-01T00:00:00Z',
  '2026-08-01T00:00:00Z',
  'human'
);

INSERT INTO public.food_sources (
  id, food_id, kind, url, capture_method, fetch_status, captured_at, content_hash, captured_text
)
OVERRIDING SYSTEM VALUE
VALUES (
  -93001,
  -93001,
  'manufacturer',
  'https://example.test/ingredient-apply',
  'fetch',
  'fetched',
  now(),
  'ingredient-apply',
  'Ingredients chicken, chicken meal, peas, pea flour, chicken fat (preserved with tocopherols), natural flavor, dried egg product, flax seed, pea fiber.'
);

-- 두 번째 소스는 출처 종류가 다르다. skipped 경로를 보기 위한 것이다.
INSERT INTO public.food_sources (
  id, food_id, kind, url, capture_method, fetch_status, captured_at, content_hash, captured_text
)
OVERRIDING SYSTEM VALUE
VALUES (
  -93002,
  -93001,
  'kr_label',
  'https://example.test/ingredient-apply-kr',
  'manual',
  'fetched',
  now(),
  'ingredient-apply-kr',
  '원재료 닭고기, 닭고기분, 완두, 타피오카, 비트펄프, 정어리분, 아마씨, 건조난황, 유카추출물.'
);

-- 1. 발행되고 검증된 행의 빈 원재료를 채우는 것이 이 채널의 존재 이유다.
SELECT is(
  (SELECT public.apply_food_ingredients_draft(
    -93001,
    -93001,
    'chicken, chicken meal, peas, pea flour',
    '[{"name":"chicken","position":1},{"name":"chicken meal","position":2},{"name":"peas","position":3},{"name":"pea flour","position":4}]'::jsonb
  ) ->> 'status'),
  'applied',
  '발행되고 검증된 사료의 빈 원재료에 적용된다'
);

SELECT is(
  (SELECT jsonb_array_length(ingredients) FROM public.foods WHERE id = -93001),
  4,
  '적용된 목록이 foods 에 기록된다'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_ingredient_evidence WHERE food_id = -93001 AND is_current),
  1,
  '현재 근거가 하나 남는다'
);

-- 2. 발행 상태와 검증 시각은 이 함수가 건드리지 않는다.
SELECT is(
  (SELECT published_at FROM public.foods WHERE id = -93001),
  '2026-08-01T00:00:00Z'::timestamptz,
  '발행 시각은 그대로다'
);

SELECT is(
  (SELECT data_verified_at FROM public.foods WHERE id = -93001),
  '2026-08-01T00:00:00Z'::timestamptz,
  '사람 검증 시각은 그대로다'
);

-- 3. 캡처에 없는 구절은 거절된다.
SELECT throws_ok(
  $$SELECT public.apply_food_ingredients_draft(
    -93001, -93001, 'salmon, potato, quinoa',
    '[{"name":"salmon","position":1}]'::jsonb
  )$$,
  'Evidence excerpt is absent from source -93001',
  '캡처에 없는 구절은 거절된다'
);

-- 4. 구절이 증명하지 못하는 이름은 거절된다.
SELECT throws_ok(
  $$SELECT public.apply_food_ingredients_draft(
    -93001, -93001, 'chicken, chicken meal',
    '[{"name":"chicken","position":1},{"name":"salmon","position":2}]'::jsonb
  )$$,
  'Ingredient name salmon is absent from its excerpt in declared order',
  '구절이 증명하지 못하는 이름은 거절된다'
);

-- 5. position 은 배열 순서와 같은 1..n 이어야 한다.
SELECT throws_ok(
  $$SELECT public.apply_food_ingredients_draft(
    -93001, -93001, 'chicken, chicken meal',
    '[{"name":"chicken","position":2},{"name":"chicken meal","position":1}]'::jsonb
  )$$,
  'Ingredient positions must be 1..n in array order',
  'position 은 배열 순서와 같은 1..n 이어야 한다'
);

-- 6. 구절 안의 순서와 어긋난 목록은 거절된다. 이름이 어딘가에 있기만 하면
-- 통과시키면 뒤섞인 목록이 그대로 저장되고, 순서가 이 데이터의 값이다.
SELECT throws_ok(
  $$SELECT public.apply_food_ingredients_draft(
    -93001, -93001, 'chicken, chicken meal, peas, pea flour',
    '[{"name":"peas","position":1},{"name":"chicken meal","position":2}]'::jsonb
  )$$,
  'Ingredient name chicken meal is absent from its excerpt in declared order',
  '구절 안의 순서와 어긋난 목록은 거절된다'
);

-- 7. 낱말 중간에 걸린 일치는 세지 않는다. "pea" 는 "peas" 안이 아니라
-- "pea flour" 에서 잡혀야 하고, 그러면 뒤따르는 "peas" 는 찾을 수 없다.
SELECT throws_ok(
  $$SELECT public.apply_food_ingredients_draft(
    -93001, -93001, 'peas, pea flour',
    '[{"name":"pea","position":1},{"name":"peas","position":2}]'::jsonb
  )$$,
  'Ingredient name peas is absent from its excerpt in declared order',
  '낱말 중간에 걸린 일치는 세지 않는다'
);

-- 8. 출처 종류가 다르면 기존 값과 provenance 를 지킨다.
SELECT is(
  (SELECT public.apply_food_ingredients_draft(
    -93001,
    -93002,
    '닭고기, 닭고기분, 완두, 타피오카',
    '[{"name":"닭고기","position":1},{"name":"닭고기분","position":2},{"name":"완두","position":3},{"name":"타피오카","position":4}]'::jsonb
  ) ->> 'status'),
  'skipped',
  '출처 종류가 다르면 skipped 다'
);

-- 9. 같은 출처 종류의 다른 목록은 conflict 이며 덮어쓰지 않는다.
-- 구절은 캡처에 실제로 있는 것을 쓴다. 없는 구절을 쓰면 conflict 판정에 닿기 전에
-- 근거 검사에서 먼저 거절되므로, 이 단언은 검사하려던 것을 검사하지 못한다.
SELECT is(
  (SELECT public.apply_food_ingredients_draft(
    -93001,
    -93001,
    'chicken, chicken meal',
    '[{"name":"chicken","position":1},{"name":"chicken meal","position":2}]'::jsonb
  ) ->> 'status'),
  'conflict',
  '같은 출처 종류의 다른 목록은 conflict 다'
);

-- 상태 문자열과 덮어쓰기 여부는 서로 다른 것이다. conflict 분기를 applied 로 바꿔도
-- 이 단언은 통과한다 — 쓰기가 첫 분기 안에서만 일어나기 때문이다. 이 단언이 실제로
-- 반응하는 것은 쓰기가 분기 밖으로 나갔을 때이고, 2026-08-23 에 그 카나리로 확인했다.
SELECT is(
  (SELECT jsonb_array_length(ingredients) FROM public.foods WHERE id = -93001),
  4,
  'conflict 는 기존 목록을 덮어쓰지 않는다'
);

-- 10. 값이 같으면 근거만 새 capture 로 교체한다.
SELECT is(
  (SELECT public.apply_food_ingredients_draft(
    -93001,
    -93001,
    'chicken, chicken meal, peas, pea flour',
    '[{"name":"chicken","position":1},{"name":"chicken meal","position":2},{"name":"peas","position":3},{"name":"pea flour","position":4}]'::jsonb
  ) ->> 'status'),
  'applied',
  '값이 같으면 applied 이고 근거만 새로 남는다'
);

-- 11. 없는 사료에는 적용하지 않는다.
SELECT throws_ok(
  $$SELECT public.apply_food_ingredients_draft(
    -93999, -93001, 'chicken, chicken meal',
    '[{"name":"chicken","position":1},{"name":"chicken meal","position":2}]'::jsonb
  )$$,
  'Food -93999 does not exist',
  '없는 사료에는 적용하지 않는다'
);

SELECT * FROM finish();
ROLLBACK;
