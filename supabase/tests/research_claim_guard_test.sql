BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(8);

INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000094001'::uuid);

INSERT INTO public.brands (id, name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-94001, 'pgTAP claim brand', 'pgTAP manufacturer');

INSERT INTO public.foods (id, brand_id, product_name)
OVERRIDING SYSTEM VALUE
VALUES
  (-94001, -94001, 'pgTAP untouched skeleton'),
  (-94002, -94001, 'pgTAP curator-claimed food'),
  (-94003, -94001, 'pgTAP research-only food'),
  (-94004, -94001, 'pgTAP published food');

-- 큐레이터가 잡은 출처는 created_by가 non-null이다. 라우트가 automation 자격
-- 증명을 거부하므로 이 방향은 항상 참이며, 아래 두 assertion이 그것을 고정한다.
INSERT INTO public.food_sources (
  food_id, kind, url, capture_method, fetch_status,
  captured_at, content_hash, captured_text, created_by, is_current
)
VALUES (
  -94002, 'manufacturer', 'https://example.com/curator', 'fetch', 'fetched',
  now(), repeat('a', 64), 'curator captured text',
  '00000000-0000-0000-0000-000000094001'::uuid, true
);

-- 조사 실행이 남긴 출처는 created_by가 NULL이다. 같은 실행이 두 번째 kind를
-- 얹는 것은 정상 흐름이므로 막히면 안 된다.
INSERT INTO public.food_sources (
  food_id, kind, url, capture_method, fetch_status,
  captured_at, content_hash, captured_text, created_by, is_current
)
VALUES (
  -94003, 'manufacturer', 'https://example.com/agent', 'fetch', 'fetched',
  now(), repeat('b', 64), 'agent captured text', null, true
);

UPDATE public.foods
SET data_verified_at = now(),
    published_at = now(),
    verification_method = 'human'
WHERE id = -94004;

SELECT is(
  (
    SELECT claim_status
    FROM public.replace_current_food_source(
      p_food_id => -94001,
      p_kind => 'manufacturer',
      p_url => 'https://example.com/fresh',
      p_capture_method => 'fetch',
      p_captured_at => now(),
      p_content_hash => repeat('c', 64),
      p_captured_text => 'fresh text',
      p_owned_source_ids => ARRAY[]::bigint[]
    )
  ),
  'claimed',
  'an untouched skeleton can be claimed for research'
);

SELECT is(
  (
    SELECT claim_status
    FROM public.replace_current_food_source(
      p_food_id => -94003,
      p_kind => 'kr_label',
      p_url => 'https://example.com/agent-kr',
      p_capture_method => 'fetch',
      p_captured_at => now(),
      p_content_hash => repeat('d', 64),
      p_captured_text => 'agent kr text',
      p_owned_source_ids => (
        SELECT array_agg(id)
        FROM public.food_sources
        WHERE food_id = -94003
      )
    )
  ),
  'claimed',
  'a research run may add its second source over its own capture'
);

-- 동시에 도는 두 번째 실행은 첫 실행의 출처를 소유하지 않으므로 거절돼야 한다.
-- created_by로 판별하면 둘 다 NULL이라 통과해 서로의 출처를 은퇴시킨다.
SELECT is(
  (
    SELECT claim_status
    FROM public.replace_current_food_source(
      p_food_id => -94003,
      p_kind => 'manufacturer',
      p_url => 'https://example.com/second-runner',
      p_capture_method => 'fetch',
      p_captured_at => now(),
      p_content_hash => repeat('1', 64),
      p_captured_text => 'second runner text',
      p_owned_source_ids => ARRAY[]::bigint[]
    )
  ),
  'conflict',
  'a concurrent research run cannot retire another run''s source'
);

SELECT is(
  (
    SELECT claim_status
    FROM public.replace_current_food_source(
      p_food_id => -94002,
      p_kind => 'manufacturer',
      p_url => 'https://example.com/agent-steal',
      p_capture_method => 'fetch',
      p_captured_at => now(),
      p_content_hash => repeat('e', 64),
      p_captured_text => 'agent text',
      p_owned_source_ids => ARRAY[]::bigint[]
    )
  ),
  'conflict',
  'research cannot claim a food whose current source a curator captured'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.food_sources
    WHERE food_id = -94002
      AND is_current
      AND url = 'https://example.com/curator'
  ),
  1::bigint,
  'the curator source stays current after a refused research claim'
);

SELECT is(
  (
    SELECT claim_status
    FROM public.replace_current_food_source(
      p_food_id => -94004,
      p_kind => 'manufacturer',
      p_url => 'https://example.com/agent-published',
      p_capture_method => 'fetch',
      p_captured_at => now(),
      p_content_hash => repeat('f', 64),
      p_captured_text => 'agent text',
      p_owned_source_ids => ARRAY[]::bigint[]
    )
  ),
  'conflict',
  'research cannot claim a published food'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.food_sources
    WHERE food_id = -94004
  ),
  0::bigint,
  'a refused research claim writes no source row at all'
);

-- 큐레이터 경로는 이 가드를 켜지 않으므로, 자기 출처를 계속 교체할 수 있어야 한다.
SELECT is(
  (
    SELECT claim_status
    FROM public.replace_current_food_source(
      p_food_id => -94002,
      p_kind => 'manufacturer',
      p_url => 'https://example.com/curator-refresh',
      p_capture_method => 'fetch',
      p_captured_at => now(),
      p_content_hash => repeat('0', 64),
      p_captured_text => 'curator refreshed text',
      p_created_by => '00000000-0000-0000-0000-000000094001'::uuid
    )
  ),
  'claimed',
  'the curator path is unaffected because it does not require an unclaimed food'
);

SELECT * FROM finish();
ROLLBACK;
