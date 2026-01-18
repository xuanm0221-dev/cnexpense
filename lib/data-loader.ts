/**
 * 비용 데이터 로딩
 */

import { CostData } from './types';

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
