/**
 * 비용 데이터 로딩
 */

import { CostData, HeadcountData, StoreHeadcountData, RetailSalesData, ViewMode } from './types';

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
 * Snowflake에서 리테일 매출 데이터 로드
 * @param selectedMonth "2025-12" 형식
 * @param viewMode '당월' 또는 '누적(YTD)'
 * @returns 리테일 매출 데이터
 */
export async function loadRetailSalesData(
  selectedMonth: string,
  viewMode: ViewMode
): Promise<RetailSalesData | null> {
  try {
    const isYTD = viewMode === '누적(YTD)';
    const response = await fetch(
      `/api/retail-sales?month=${selectedMonth}&ytd=${isYTD}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log(`[리테일매출] 데이터 로드 완료: ${Object.keys(data).join(', ')}`);
    
    return data as RetailSalesData;
  } catch (err) {
    console.warn('[리테일매출] 데이터 로드 실패:', err);
    return null;
  }
}
