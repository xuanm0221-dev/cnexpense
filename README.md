# F&F CHINA 비용 대시보드

FP&A 관점의 월별 비용 데이터를 시각화하는 인터랙티브 대시보드입니다.

## 🎯 주요 기능

- 📊 **4개 사업부 비용 모니터링**: MLB, KIDS, DISCOVERY, 경영지원
- 📅 **당월/YTD 전환**: 단월 또는 누적 데이터 즉시 전환
- 📈 **YoY 분석**: 전년 대비 증감률 및 증감액 자동 계산
- 🏷️ **대분류별 집계**: 직접비/영업비 탭으로 세분화된 비용 분석
- 🔄 **동적 데이터 로딩**: 월별 CSV 추가 시 자동 반영

## 🚀 시작하기

### 1. 의존성 설치

```bash
# Node.js 의존성
npm install

# Python 의존성 (전처리용)
pip install -r scripts/requirements.txt
```

### 2. 데이터 준비

비용 CSV 파일들을 `비용파일/` 폴더에 배치합니다:

```
비용파일/
├── 24.01.csv
├── 24.02.csv
├── ...
└── 25.12.csv
```

**CSV 파일 형식**:
- 파일명: `YY.MM.csv` (예: `24.01.csv`)
- 필수 컬럼:
  - 코스트 센터
  - 금액(전표 통화)
  - 전표 유형
  - G/L 계정
  - G/L 계정 설명
  - 텍스트

### 3. 데이터 전처리

```bash
python scripts\preprocess.py
```

이 스크립트는:
- 월별 CSV 파일을 자동으로 로드
- 코스트센터 및 계정과목 마스터와 조인
- 사업부별/비용구분별/대분류별로 집계
- `data/processed/aggregated-costs.json` 생성

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속

## 📁 프로젝트 구조

```
dashboard/
├── app/                    # Next.js 앱 라우터
│   ├── page.tsx           # 홈 대시보드
│   ├── layout.tsx         # 레이아웃
│   ├── globals.css        # 전역 스타일
│   └── cost/
│       └── [businessUnit]/
│           └── page.tsx   # 상세 대시보드 (향후 구현)
├── components/            # React 컴포넌트
│   ├── DashboardHeader.tsx
│   ├── MonthSelector.tsx
│   ├── BusinessUnitCard.tsx
│   └── CostTypeTabs.tsx
├── lib/                   # 비즈니스 로직
│   ├── types.ts          # TypeScript 타입 정의
│   ├── calculations.ts   # 계산 로직 (YTD, YoY)
│   └── data-loader.ts    # 데이터 로딩
├── utils/                 # 유틸리티 함수
│   └── formatters.ts     # 포맷팅 (금액, 날짜 등)
├── data/
│   ├── masters/          # 마스터 파일 (GitHub 포함)
│   │   ├── 코스트센터마스터.csv
│   │   └── 계정과목마스터.csv
│   └── processed/        # 전처리된 데이터 (GitHub 포함)
│       └── aggregated-costs.json
├── scripts/              # Python 스크립트
│   ├── preprocess.py     # 데이터 전처리
│   └── requirements.txt  # Python 의존성
└── 비용파일/              # 원본 CSV (gitignore)
    └── *.csv
```

## 🔄 데이터 업데이트 워크플로우

1. 새 월의 CSV 파일 추가 (예: `비용파일/26.01.csv`)
2. 전처리 스크립트 실행:
   ```bash
   python scripts\preprocess.py
   ```
3. Git 커밋 및 푸시:
   ```bash
   git add data/processed/aggregated-costs.json
   git commit -m "Update: 2026년 1월 비용 데이터 추가"
   git push origin main
   ```
4. Vercel 자동 재배포 확인

## 📊 데이터 처리 규칙

### 필터링
- ❌ 전표 유형 = 'CO' 제외
- ✅ 분석 대상 사업부만 (경영지원, MLB, MLB KIDS, Discovery)
- ✅ 코스트센터 및 계정과목 마스터 조인 성공한 데이터만

### 집계
- **그룹**: [연월, 사업부, 영업비/직접비, 대분류]
- **합계**: 금액(전표 통화)

### 금액 단위
- **내부 계산**: 위안 (CNY)
- **화면 표시**: 천위안 (K)
  - 예: 21,600,000 CNY → 21,600K

### YoY 계산
- **증감률**: `Math.round((현재 - 전년) / |전년| * 100)` (소수점 없음)
- **증감액**: `Math.round((현재 - 전년) / 1000)` (K 단위)
- **표시 예**: `YoY 93% (-1,540K)`

## 🚀 배포 (Vercel)

### 초기 배포

1. GitHub 레포지토리 생성 및 푸시
2. [Vercel](https://vercel.com)에서 프로젝트 임포트
3. 빌드 설정은 자동 감지됨
4. 배포 완료!

### 환경변수 (필요시)

현재는 환경변수가 필요하지 않습니다. 모든 데이터는 정적 JSON 파일로 관리됩니다.

## 🛠️ 기술 스택

- **프론트엔드**: Next.js 15 (App Router), React 19, TypeScript
- **스타일링**: Tailwind CSS
- **데이터 처리**: Python 3.x, Pandas
- **배포**: Vercel

## 📝 개발 원칙

1. **금액 하드코딩 금지**: 모든 금액은 데이터에서 동적 계산
2. **타입 안정성**: TypeScript로 타입 안전성 보장
3. **로직 분리**: 계산 로직과 UI 로직 철저히 분리
4. **확장성**: 상세 페이지 추가 용이한 구조
5. **동적 로딩**: 월별 파일 추가 시 코드 수정 불필요

## 📌 향후 개선 사항

- [ ] 상세 대시보드 페이지 구현
- [ ] 차트 라이브러리 추가 (월별 트렌드)
- [ ] CSV 다운로드 기능
- [ ] 코스트센터별 상세 분석
- [ ] 예산 대비 실적 비교
- [ ] 드릴다운 분석 (중분류, 텍스트)

## 📄 라이센스

Private - F&F China Internal Use Only

## 👥 문의

프로젝트 관련 문의사항은 FP&A 팀으로 연락주세요.
