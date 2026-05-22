# 키움증권 경쟁사 광고 모니터링 대시보드 (MVP)

매일 10:00 / 15:00 KST에 6개 경쟁 증권사의 Meta + Google 활성 광고를 수집해 KPI·갤러리 형태로 보여주는 대시보드.

## MVP 상태 (2026-05-11 기준)

| 구성 | 상태 |
|---|---|
| **Google Ads Transparency 수집** | ✅ 작동 — 4,296건 적재 검증 |
| **Meta Ad Library API 수집** | ✅ 코드 완성 — `META_ACCESS_TOKEN` env 받으면 즉시 실행 |
| **DB (SQLite, Postgres 호환 스키마)** | ✅ |
| **Diff 엔진 (신규/종료/계속)** | ✅ |
| **대시보드 UI (Next.js + Tailwind)** | ✅ |
| **광고 디테일 enrichment (썸네일·LP URL·카피)** | ⏳ Phase 2 |
| **자동 PDF 클라이언트 리포트** | ⏳ Phase 2 |
| **Cloud Scheduler / 운영 배포** | ⏳ 사용자 인프라 결정 후 |

## 모니터링 대상

| 경쟁사 | Meta Page | Google Advertiser (Primary) | 활성 광고 (수집 시점) |
|---|---|---|---:|
| 삼성증권 | `319384881497144` | `AR11621934095679881217` | **1,760** |
| 미래에셋증권 | `170679759615120` | `AR11442509105290280961` | **1,526** |
| NH투자증권 | `130795396974886` | `AR04004909127795998721` ⚠️ alias `엔에이치투자증권` | **348** |
| 한국투자증권 | `306222562786526` | `AR14106116241651400705` | **298** |
| KB증권 | `526540400777484` | `AR07030169028924538881` | **154** |
| 토스증권 | `103399848375983` | `AR06938601451455250433` | **48** |
| (본인) 키움증권 | `131281780274622` | `AR16987959307796480001` | **162** |

> 카카오페이증권은 Meta·Google에 별도 advertiser가 없어 모니터링 대상에서 제외 (2026-05-11 결정).

## 발견된 인사이트

- **삼성증권의 매우 짧은 광고 수명 (중간값 0.2일)** — 약 1,760건 중 절반이 5시간 이내 운영. 자동화된 다수 A/B 변형 패턴.
- **미래에셋·KB증권은 운영기간 길게 가져감** (median 23-30일) — 검증된 메인 소재 중심.
- **Google이 Meta보다 광고량 압도적** — 7사 합산 Meta ≈ 60건, Google ≈ 4,300건.
- **토스증권 Meta 0건 + Google 48건만**으로 한국 시장 활동량 낮은 편 → Naver/Kakao 등 한국 채널에 집중 추정.

## 디렉터리 구조

```
config/
  competitors.json           # 6사 + 키움 식별자
packages/
  db/                        # 스키마 + 시드 + DB 헬퍼
  collectors/
    src/google.mjs           # Google 수집 (Playwright + RPC 가로채기)
    src/meta.mjs             # Meta 수집 (Graph API, 토큰 필요)
  diff/
    src/run.mjs              # 최근 2 스냅샷 비교
  dashboard/                 # Next.js 앱 (포트 3300)
data/dashboard.sqlite        # 로컬 DB
logs/                        # 컬렉션 / dev 서버 로그
recon/                       # 정찰 산출물 (재현 가능)
```

## 실행 방법

```bash
# 의존성
npm install

# DB 초기화 (스키마 + 시드)
node packages/db/src/init.mjs

# Google 수집 (전체 6사, ~5분)
node packages/collectors/src/google.mjs
# 또는 단일 경쟁사
node packages/collectors/src/google.mjs --only=toss

# Meta 수집 — META_ACCESS_TOKEN 환경변수 필요
$env:META_ACCESS_TOKEN="EAAxxx..."         # PowerShell
export META_ACCESS_TOKEN=EAAxxx...          # bash
node packages/collectors/src/meta.mjs

# 두 스냅샷 비교 (신규/종료 광고)
node packages/diff/src/run.mjs

# 대시보드 dev 서버
npm --workspace=@kcd/dashboard run dev
# → http://localhost:3300
```

## 사용자가 다음으로 해야 할 것

1. **Meta Marketing API 토큰 발급**
   - https://developers.facebook.com → 앱 생성 → Marketing API 권한 (`ads_read`)
   - 토큰 받으면 `META_ACCESS_TOKEN` env로 설정하고 `meta.mjs` 실행
2. **클라우드 인프라 결정**
   - 권장: Supabase Postgres + Cloudflare R2 + Vercel(대시보드) + Cloud Run(수집 worker) + Cloud Scheduler(cron)
   - 결정되면 SQLite → Postgres 마이그레이션 + 수집기 컨테이너화 진행
3. **Phase 2 우선순위 결정** (택일)
   - (a) 광고 썸네일/카피/CTA 디테일 enrichment
   - (b) 자동 PDF 클라이언트 리포트
   - (c) Naver/Kakao 별도 수집 파이프라인 (수동 스크린샷 업로드 등)

## Phase 2 후보 작업

- 광고 디테일 enrichment: 각 광고의 transparency 페이지를 fetch해 YouTube 썸네일, 카피, CTA, LP URL 추출 (~4,300건 첫 실행, 이후 신규 광고만 추가 fetch)
- 카피 임베딩 + 유사 광고 그룹핑 (pgvector)
- Slack/이메일 알림 (신규/종료 광고 발생 시)
- 자동 PDF/PPT 클라이언트 리포트
- Naver 검색결과 캡처 + OCR
- 카카오 비즈보드 수동 업로드 인터페이스
