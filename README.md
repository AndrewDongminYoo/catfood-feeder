# 수입 건사료 큐레이션 — 관리자 입력 도구

성분표 텍스트(제조사 + 국내 라벨)를 구조화 데이터로 추출하고, 출처별로 태깅·검증한 뒤 저장하는 모바일 우선 Next.js 앱.

## 빠른 시작

```bash
pnpm install
mkdir -p ~/.config/catfood-feeder
cp .env.example ~/.config/catfood-feeder/env   # ANTHROPIC_API_KEY 등 입력
chmod 600 ~/.config/catfood-feeder/env         # 비밀은 저장소 밖에 둔다
pnpm dev                                       # http://localhost:3000
```

`/new` 에서 "샘플" 버튼 → ACANA Grasslands 해피케이스가 채워집니다.

## 핵심 설계

- **이중 입력**: 제조사 원문(P/F/C·kcal 명시 자동 인식) + 국내 라벨(회분·열량 보충).
- **출처 분리**: 모든 성분 값에 manufacturer / kr_label / estimated / derived 태그. 실측과 추정을 섞지 않음.
- **회분 3단 폴백**: 라벨 실측 → 익스트루전이면 9.0% 추정 → 그 외 계산 보류.
- **P/F/C 2경로**: 제조사 "X% from protein" 직접 명시 우선, 없으면 NFE 역산.
- **환각 방지**: 모든 추출 수치에 원문 근거 구절 표시. 근거 없으면 빨갛게 격리, 저장 전 수동 확인 강제.
- **AI 호출은 서버에서만**(`/api/extract`) — API 키 비노출.

## 도메인 검산 (ACANA Grasslands)

제조사 명시 P/F/C 37/23/40, 3850 kcal/kg. 국내 라벨 회분 9.0%.
NFE = 100 − (단백질36 + 지방18 + 섬유4 + 회분9 + 수분10) = 23% → 제조사 명시 23%와 일치.

## 구조

```log
supabase/migrations/     확정 스키마 (brands/foods/recalls/prices/cats/feeding_logs + RLS)
src/lib/domain.ts        파생 계산·검증·제조사 P/F/C 파싱 (서버/클라 공용)
src/app/api/extract/     Claude 추출 서버 라우트
src/app/api/foods/       관리자 저장·출처·발행 라우트(Supabase server key)
src/app/api/research/    로컬 조사 에이전트 broker (서버가 출처를 재수집·재검증)
src/app/api/recalls/     openFDA 리콜 동기화 라우트
src/app/new/             입력 도구 (모바일 우선)
src/app/foods/           공개 카탈로그/상세
src/app/compare/         제품 비교
src/app/feeding/         급여 기록/교체 인사이트
```

## 배포 (Vercel)

1. GitHub 푸시 → Vercel 임포트.
2. 환경변수 설정(`ANTHROPIC_API_KEY`, Supabase 키, `ADMIN_EMAILS`, `ADMIN_WRITE_SECRET`, `CRON_SECRET`).
3. Supabase CLI로 `supabase/migrations/`의 모든 마이그레이션 적용.
4. 스케줄러가 `/api/recalls/sync`를 호출할 때 `Authorization: Bearer $CRON_SECRET` 헤더를 설정.

## 보류 범위

- 가격/알림은 BLUEPRINT Phase 5의 보류 범위입니다.
- 한국 리콜 데이터는 공개 API 엔드포인트와 이용조건이 확인되기 전까지 동기화하지 않습니다.
