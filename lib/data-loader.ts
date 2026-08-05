/**
 * 비용 데이터 로딩
 */

import type { AccountAnalysisData } from './account-analysis';
import type { ExchangeRateData } from './exchange-rates';
import {
  CostData,
  HeadcountData,
  StoreHeadcountData,
  RetailChannelBreakdown,
  RetailRangeMetrics,
  RetailSalesData,
  RetailSalesResponse,
  ViewMode,
} from './types';

/**
 * 전처리된 비용 데이터 로드
 * @returns 비용 데이터
 */
export async function loadCostData(): Promise<CostData> {
  // 프로덕션: 전처리된 JSON 파일 로드
  const data = await import('@/data/processed/aggregated-costs.json');
  return data.default as CostData;
}

/**
 * 데이터가 비어있는지 확인
 * @param data 비용 데이터
 * @returns true면 빈 데이터
 */
export function isDataEmpty(data: CostData | null): boolean {
  if (!data) return true;
  if (!data.metadata.months || data.metadata.months.length === 0) return true;
  if (!data.data || Object.keys(data.data).length === 0) return true;
  return false;
}

/**
 * 월 선택 드롭다운에 쓸 월 목록 (오름차순).
 *
 * 인원수·매장인원수 파일은 2024년부터 있지만 비용 데이터는 2025년부터라, 그냥 합치면
 * 비용이 하나도 없는 연도가 드롭다운에 남는다. **비용 데이터의 첫 달을 하한**으로 잡아
 * 그 이전 월은 뺀다. 인원수 데이터 자체는 그대로 두므로 전년 대비 조회에는 영향이 없다.
 *
 * @param costMonths 비용 데이터의 월 목록 (하한 기준)
 * @param extra 인원수 등 추가 월 목록 (신규 월을 먼저 보여주기 위해 합침)
 */
export function selectableMonths(
  costMonths: string[],
  ...extra: string[][]
): string[] {
  const merged = [...new Set([...costMonths, ...extra.flat()])].sort();
  const floor = [...costMonths].sort()[0];
  return floor ? merged.filter(m => m >= floor) : merged;
}

/**
 * 전처리된 인원수 데이터 로드
 * @returns 인원수 데이터
 */
export async function loadHeadcountData(): Promise<HeadcountData | null> {
  try {
    // 전처리된 JSON 파일 로드
    const data = await import('@/data/processed/headcount.json');
    const headcountData = data.default as {
      metadata: {
        generatedAt: string;
        years: number[];
        businessUnits: string[];
      };
      data: HeadcountData;
    };
    
    console.log(`[인원수] 데이터 로드 완료: ${headcountData.metadata.businessUnits.join(', ')}`);
    console.log(`[인원수] 연도: ${headcountData.metadata.years.join(', ')}`);
    
    return headcountData.data;
  } catch (err) {
    console.warn('[인원수] 데이터 로드 실패:', err);
    console.warn('[인원수] Python 전처리 스크립트를 실행하여 headcount.json 파일을 생성해주세요.');
    return null;
  }
}

/**
 * 전처리된 매장 인원수 데이터 로드
 * @returns 매장 인원수 데이터
 */
export async function loadStoreHeadcountData(): Promise<StoreHeadcountData | null> {
  try {
    // 전처리된 JSON 파일 로드
    const data = await import('@/data/processed/store-headcount.json');
    const storeHeadcountData = data.default as {
      metadata: {
        generatedAt: string;
        years: number[];
        businessUnits: string[];
      };
      data: StoreHeadcountData;
    };
    
    console.log(`[매장인원수] 데이터 로드 완료: ${storeHeadcountData.metadata.businessUnits.join(', ')}`);
    console.log(`[매장인원수] 연도: ${storeHeadcountData.metadata.years.join(', ')}`);
    
    return storeHeadcountData.data;
  } catch (err) {
    console.warn('[매장인원수] 데이터 로드 실패:', err);
    console.warn('[매장인원수] Python 전처리 스크립트를 실행하여 store-headcount.json 파일을 생성해주세요.');
    return null;
  }
}

/**
 * 계정별 분석 데이터 로드 (적요 기반 구성).
 * 없으면 null — 패널만 숨기고 나머지 화면은 그대로 동작한다.
 */
export async function loadAccountAnalysis(): Promise<AccountAnalysisData | null> {
  try {
    const data = await import('@/data/processed/account-analysis.json');
    return data.default as unknown as AccountAnalysisData;
  } catch (err) {
    console.warn('[계정별분석] 데이터 로드 실패:', err);
    return null;
  }
}

/**
 * 환율 로드 (CNY → KRW).
 * 정적 JSON을 import — 배포 번들에 포함되므로 런타임 파일 접근이 필요 없다.
 * (수정은 로컬에서 /api/exchange-rates PUT 으로만 가능)
 */
export async function loadExchangeRates(): Promise<ExchangeRateData | null> {
  try {
    const data = await import('@/data/masters/환율.json');
    return data.default as unknown as ExchangeRateData;
  } catch (err) {
    console.warn('[환율] 데이터 로드 실패:', err);
    return null;
  }
}

/**
 * 리테일 매출 로드.
 *
 * - 로컬 개발: /api/retail-sales 로 **Snowflake 실시간 조회** (지금까지와 동일)
 * - 배포(정적): API가 없으므로 전처리 스냅샷 JSON 사용
 *   (scripts/fetch-retail-sales.mjs 가 API 응답을 월별로 구워둔 것)
 *
 * 개발 중 API가 실패해도 스냅샷으로 떨어져 화면이 비지 않는다.
 * @param selectedMonth "2025-12" 형식
 */
async function loadRetailSnapshot(
  selectedMonth: string
): Promise<RetailSalesResponse | null> {
  try {
    const snapshot = await import('@/data/processed/retail-sales.json');
    const byMonth = (snapshot.default ?? snapshot) as unknown as Record<
      string,
      RetailSalesResponse
    >;
    return byMonth[selectedMonth] ?? null;
  } catch (err) {
    console.warn('[리테일매출] 스냅샷 로드 실패:', err);
    return null;
  }
}

export async function loadRetailSales(
  selectedMonth: string
): Promise<RetailSalesResponse | null> {
  if (process.env.NODE_ENV !== 'development') {
    return loadRetailSnapshot(selectedMonth);
  }

  try {
    const response = await fetch(`/api/retail-sales?month=${selectedMonth}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = (await response.json()) as RetailSalesResponse;

    console.log(`[리테일매출] 실시간 조회 완료: ${Object.keys(data.units ?? {}).join(', ')}`);
    if (data.unmappedBrandCodes?.length) {
      console.warn(
        '[리테일매출] 법인 합산에서 제외된 brd_cd:',
        data.unmappedBrandCodes.map(b => `${b.brdCd}(${Math.round(b.ytdSale / 1000)}K)`).join(', ')
      );
    }
    return data;
  } catch (err) {
    console.warn('[리테일매출] API 실패 — 스냅샷으로 대체:', err);
    return loadRetailSnapshot(selectedMonth);
  }
}

/**
 * 스킬 응답 → 컴포넌트가 쓰는 월별 금액 맵.
 * 기준월에는 당년 실판(V+), 전년 동월 키에는 전년 실판을 담아 기존 YoY 계산 로직과 호환된다.
 */
export function toRetailSalesData(
  response: RetailSalesResponse | null,
  viewMode: ViewMode
): RetailSalesData | null {
  if (!response?.units) return null;
  const key: 'mtd' | 'ytd' = viewMode === '누적(YTD)' ? 'ytd' : 'mtd';
  const out: RetailSalesData = {};

  for (const [unit, metrics] of Object.entries(response.units)) {
    const range = metrics?.[key];
    if (!range) continue;
    out[unit] = {
      [response.month]: range.sale,
      [response.prevMonth]: range.pySale,
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** 해당 사업부의 채널 분해 (직영 ON/OFF · 대리상 ON/OFF · 미지정) */
export function retailChannelsFor(
  response: RetailSalesResponse | null,
  unit: string,
  viewMode: ViewMode
): RetailChannelBreakdown[] {
  const metrics = response?.units?.[unit];
  if (!metrics?.channels) return [];
  const key: 'mtd' | 'ytd' = viewMode === '누적(YTD)' ? 'ytd' : 'mtd';
  return metrics.channels
    .map(c => ({ channel: c.channel, ...c[key] }))
    .filter(c => c.sale !== 0 || c.pySale !== 0);
}

/** 해당 사업부의 기간 지표 (실판·Tag·할인율·YoY) */
export function retailMetricsFor(
  response: RetailSalesResponse | null,
  unit: string,
  viewMode: ViewMode
): RetailRangeMetrics | null {
  const metrics = response?.units?.[unit];
  if (!metrics) return null;
  return viewMode === '누적(YTD)' ? metrics.ytd : metrics.mtd;
}
