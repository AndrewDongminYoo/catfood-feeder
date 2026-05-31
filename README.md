# 수입 건사료 큐레이션 — 관리자 입력 도구

성분표 텍스트(제조사 + 국내 라벨)를 구조화 데이터로 추출하고, 출처별로 태깅·검증한 뒤 저장하는 모바일 우선 Next.js 앱.

## 빠른 시작

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY 등 입력
npm run dev                  # http://localhost:3000/new
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
supabase/0001_init.sql   확정 스키마 (brands/foods/recalls/prices/cats/feeding_logs + RLS)
src/lib/domain.ts        파생 계산·검증·제조사 P/F/C 파싱 (서버/클라 공용)
src/app/api/extract/     Claude 추출 서버 라우트
src/app/new/             입력 도구 (모바일 우선)
```

## 배포 (Vercel)

1. GitHub 푸시 → Vercel 임포트.
2. 환경변수 설정(`ANTHROPIC_API_KEY`, Supabase 키 3종).
3. Supabase에서 `supabase/0001_init.sql` 실행.
4. `save()`의 주석대로 `/api/foods` 라우트를 추가해 service_role로 insert 연결.

## 다음 작업 (BLUEPRINT Phase 1 잔여)

- [ ] `/api/foods` insert 라우트 + brands upsert
- [ ] 두 소스 값 충돌 감지 경고
- [ ] 원료(ingredients) 편집 UI
