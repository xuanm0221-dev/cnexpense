/**
 * 홈 법인 카드와 동일: 사무실 6개 사업부 합산, 매장은 경영지원 제외 합산
 */

import type { HeadcountData, MonthlyAmounts, StoreHeadcountData } from './types';
import { headcountBasis } from './calculations';
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

export type CostSideDetail = '직접비' | '영업비' | '전체';

/** 두 인원 시계열 합 (전체 탭 = 매장 + 사무실) */
function sumSeries(
  a: MonthlyAmounts | null,
  b: MonthlyAmounts | null
): MonthlyAmounts | null {
  if (!a) return b;
  if (!b) return a;
  const out: MonthlyAmounts = { ...a };
  for (const month of Object.keys(b)) {
    out[month] = (out[month] || 0) + b[month];
  }
  return out;
}

/**
 * 홈 BusinessUnitCard 와 동일한 '인당' 분모.
 * 직접비=매장, 영업비=사무실, 전체=둘의 합.
 * 당월=선택월 인원, YTD=1월~선택월 **평균** 인원 (인원은 스톡이라 누적 합 금지)
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
  const series =
    costType === '직접비'
      ? storeSeries
      : costType === '영업비'
        ? officeSeries
        : sumSeries(officeSeries, storeSeries);
  if (isYTD) {
    return headcountBasis(series, selectedMonth, true) ?? 0;
  }
  const snapshot =
    costType === '직접비'
      ? storeSnapshot
      : costType === '영업비'
        ? officeSnapshot
        : storeSnapshot === null && officeSnapshot === null
          ? null
          : (officeSnapshot ?? 0) + (storeSnapshot ?? 0);
  // 스냅샷이 없으면 시계열에서 해당 월 값을 찾는다 (전년 동월 계산 경로)
  return snapshot ?? headcountBasis(series, selectedMonth, false) ?? 0;
}
