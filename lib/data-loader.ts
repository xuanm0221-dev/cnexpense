/**
 * 비용 데이터 로딩
 */

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
 * Snowflake에서 리테일 매출 로드 — (mei)리테일 스킬 정의.
 * 한 번의 호출로 당월·누적(YTD) × 당년·전년을 모두 받는다 (브랜드 5개 + 법인 + 경영지원).
 * @param selectedMonth "2025-12" 형식
 */
export async function loadRetailSales(
  selectedMonth: string
): Promise<RetailSalesResponse | null> {
  try {
    const response = await fetch(`/api/retail-sales?month=${selectedMonth}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as RetailSalesResponse;

    console.log(`[리테일매출] 데이터 로드 완료: ${Object.keys(data.units ?? {}).join(', ')}`);
    if (data.unmappedBrandCodes?.length) {
      console.warn(
        '[리테일매출] 법인 합산에서 제외된 brd_cd:',
        data.unmappedBrandCodes.map(b => `${b.brdCd}(${Math.round(b.ytdSale / 1000)}K)`).join(', ')
      );
    }

    return data;
  } catch (err) {
    console.warn('[리테일매출] 데이터 로드 실패:', err);
    return null;
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
