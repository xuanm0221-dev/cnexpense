/**
 * 홈 법인 카드와 동일: 사무실 6개 사업부 합산, 매장은 경영지원 제외 합산
 */

import type { HeadcountData, MonthlyAmounts, StoreHeadcountData } from './types';
import { calculateYTD } from './calculations';
import { CORPORATE_BUSINESS_UNIT_IDS } from './corporate-cost-merge';

export function sumCorporateOfficeHeadcountSnapshot(
  headcountData: HeadcountData | null,
  month: string
): number | null {
  if (!headcountData) return null;
  let total = 0;
  let has = false;
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    const v = headcountData[buId]?.[month];
    if (v != null && v !== undefined) {
      total += v;
      has = true;
    }
  }
  return has ? total : null;
}

export function sumCorporateStoreHeadcountSnapshot(
  storeHeadcountData: StoreHeadcountData | null,
  month: string
): number | null {
  if (!storeHeadcountData) return null;
  let total = 0;
  let has = false;
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    if (buId === '경영지원') continue;
    const v = storeHeadcountData[buId]?.[month];
    if (v != null && v !== undefined) {
      total += v;
      has = true;
    }
  }
  return has ? total : null;
}

/** 월별 법인 사무실 인원 합 (YoY·YTD 분모용) */
export function buildCorporateOfficeHeadcountByMonth(
  headcountData: HeadcountData | null
): MonthlyAmounts | null {
  if (!headcountData) return null;
  const result: MonthlyAmounts = {};
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    const bu = headcountData[buId];
    if (!bu) continue;
    for (const month of Object.keys(bu)) {
      result[month] = (result[month] || 0) + bu[month];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 월별 법인 매장 인원 합 (경영지원 제외) */
export function buildCorporateStoreHeadcountByMonth(
  storeHeadcountData: StoreHeadcountData | null
): MonthlyAmounts | null {
  if (!storeHeadcountData) return null;
  const result: MonthlyAmounts = {};
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    if (buId === '경영지원') continue;
    const bu = storeHeadcountData[buId];
    if (!bu) continue;
    for (const month of Object.keys(bu)) {
      result[month] = (result[month] || 0) + bu[month];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export type CostSideDetail = '직접비' | '영업비';

/**
 * 홈 BusinessUnitCard.salarySubPerPersonDenominator 와 동일 (전체 탭 없음 → 직접/영업만)
 */
export function salarySubPerPersonDenominator(
  costType: CostSideDetail,
  isYTD: boolean,
  selectedMonth: string,
  officeSnapshot: number | null,
  storeSnapshot: number | null,
  officeSeries: MonthlyAmounts | null,
  storeSeries: MonthlyAmounts | null
): number {
  if (isYTD) {
    if (costType === '직접비') {
      return storeSeries ? calculateYTD(storeSeries, selectedMonth) : 0;
    }
    return officeSeries ? calculateYTD(officeSeries, selectedMonth) : 0;
  }
  if (costType === '직접비') {
    return storeSnapshot ?? 0;
  }
  return officeSnapshot ?? 0;
}
