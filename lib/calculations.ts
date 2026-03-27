/**
 * 비용 데이터 계산 로직
 */

import { MonthlyAmounts, CategoryData, YoYResult } from './types';

/**
 * 특정 월의 금액 가져오기
 * @param data 월별 금액 데이터
 * @param month "2024-12" 형식
 * @returns 금액 (위안)
 */
export function getAmountForMonth(
  data: MonthlyAmounts,
  month: string
): number {
  return data[month] || 0;
}

/**
 * YTD (Year-To-Date) 계산
 * @param data 월별 금액 데이터
 * @param endMonth "2024-12" 형식
 * @returns 누적 금액 (위안)
 */
export function calculateYTD(
  data: MonthlyAmounts,
  endMonth: string
): number {
  const [year, month] = endMonth.split('-');
  const endMonthNum = parseInt(month);
  
  let total = 0;
  for (let m = 1; m <= endMonthNum; m++) {
    const monthKey = `${year}-${m.toString().padStart(2, '0')}`;
    total += data[monthKey] || 0;
  }
  
  return total;
}

/**
 * YTD 구간의 월 개수 (1월~endMonth, endMonth의 월 번호와 동일)
 * @param endMonth "2026-03" 형식
 */
export function getYTDMonthCount(endMonth: string): number {
  if (!endMonth || typeof endMonth !== 'string') return 1;
  const parts = endMonth.split('-');
  const m = parseInt(parts[1] || '1', 10);
  if (Number.isNaN(m) || m < 1) return 1;
  return Math.min(12, Math.max(1, m));
}

/**
 * YoY (Year-over-Year) 계산
 * @param data 월별 금액 데이터
 * @param currentMonth "2025-12" 형식
 * @param isYTD true면 YTD 비교, false면 단월 비교
 * @returns YoY 결과 (증감률%, 증감액K)
 */
export function calculateYoY(
  data: MonthlyAmounts,
  currentMonth: string,
  isYTD: boolean = false
): YoYResult {
  const [currentYear, currentMonthNum] = currentMonth.split('-');
  const prevYear = (parseInt(currentYear) - 1).toString();
  const prevMonth = `${prevYear}-${currentMonthNum}`;
  
  let currentAmount: number;
  let prevAmount: number;
  
  if (isYTD) {
    currentAmount = calculateYTD(data, currentMonth);
    prevAmount = calculateYTD(data, prevMonth);
  } else {
    currentAmount = getAmountForMonth(data, currentMonth);
    prevAmount = getAmountForMonth(data, prevMonth);
  }
  
  // 전년 데이터가 없으면 N/A
  if (prevAmount === 0) {
    return { pct: 'N/A', deltaK: 'N/A' };
  }
  
  // 증감률 (소수점 없음)
  const pct = Math.round((currentAmount - prevAmount) / Math.abs(prevAmount) * 100);
  
  // 증감액 (K 단위, 소수점 없음)
  const deltaK = Math.round((currentAmount - prevAmount) / 1000);
  
  return { pct, deltaK };
}

/**
 * YoY 증감률(pct)을 전년=100 기준 지수%로 표시 (예: pct=16 → 116)
 */
export function yoYDeltaToIndexPercent(pct: number | string): number | 'N/A' {
  if (pct === 'N/A' || typeof pct === 'string') return 'N/A';
  return 100 + pct;
}

/**
 * 카테고리별 총합 계산
 * @param categoryData 대분류별 데이터
 * @param month "2024-12" 형식
 * @param isYTD true면 YTD, false면 단월
 * @returns 총 금액 (위안)
 */
export function calculateCategoryTotal(
  categoryData: CategoryData,
  month: string,
  isYTD: boolean = false
): number {
  let total = 0;
  
  for (const category in categoryData) {
    const monthlyData = categoryData[category];
    if (isYTD) {
      total += calculateYTD(monthlyData, month);
    } else {
      total += getAmountForMonth(monthlyData, month);
    }
  }
  
  return total;
}

// 대분류 정렬 순서 정의 (직접비·영업비 공통, 마스터 대분류와 일치)
// 홈 대시보드: 인건비(급여)→복리비→광고비→수주회→출장비→나머지(기존 순 유지)
const DIRECT_COST_ORDER = [
  '급여',
  '복리비',
  '광고비',
  '수주회',
  '출장비',
  '플랫폼수수료',
  'TP수수료',
  '대리상지원금',
  '지급수수료',
  '임차료',
  '물류비',
  '진열/포장',
  '감가상각비',
  '세금과공과',
  '기타',
];

/**
 * 대분류 목록을 지정된 순서로 정렬
 * @param categoryData 대분류별 데이터
 * @param month "2024-12" 형식
 * @param isYTD true면 YTD, false면 단월
 * @param costType '직접비' 또는 '영업비' (선택사항, 지정 안하면 금액순)
 * @returns 정렬된 대분류 이름 배열
 */
export function getSortedCategories(
  categoryData: CategoryData,
  month: string,
  isYTD: boolean = false,
  costType?: '직접비' | '영업비'
): string[] {
  const categories = Object.keys(categoryData);
  
  // 금액이 0이 아닌 항목만 표시 (음수 상계·환입 등도 행으로 노출)
  const validCategories = categories.filter(category => {
    const monthlyData = categoryData[category];
    const amount = isYTD
      ? calculateYTD(monthlyData, month)
      : getAmountForMonth(monthlyData, month);
    return amount !== 0;
  });
  
  // 비용 구분이 지정되지 않으면 금액 순으로 정렬
  if (!costType) {
    return validCategories
      .map(category => {
        const monthlyData = categoryData[category];
        const amount = isYTD
          ? calculateYTD(monthlyData, month)
          : getAmountForMonth(monthlyData, month);
        return { category, amount };
      })
      .sort((a, b) => b.amount - a.amount)
      .map(item => item.category);
  }
  
  // 지정된 순서대로 정렬 (직접비·영업비 동일 순서)
  const order = DIRECT_COST_ORDER;
  
  return validCategories.sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    
    // 둘 다 순서에 있으면 순서대로
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    
    // A만 순서에 있으면 A가 앞
    if (indexA !== -1) return -1;
    
    // B만 순서에 있으면 B가 앞
    if (indexB !== -1) return 1;
    
    // 둘 다 순서에 없으면 가나다순
    return a.localeCompare(b, 'ko');
  });
}

/**
 * 전년 동월 계산
 * @param currentMonth "2025-12" 형식
 * @returns "2024-12" 형식
 */
export function getPreviousYearMonth(currentMonth: string): string {
  const [year, month] = currentMonth.split('-');
  const prevYear = (parseInt(year) - 1).toString();
  return `${prevYear}-${month}`;
}

/**
 * 기간 내 어느 달이든 금액이 0이 아닌 대분류만 모아, getSortedCategories와 동일 규칙으로 정렬
 */
export function getSortedCategoriesForMonths(
  categoryData: CategoryData,
  months: string[],
  costType?: '직접비' | '영업비'
): string[] {
  const categories = Object.keys(categoryData);
  const validCategories = categories.filter(category => {
    const monthlyData = categoryData[category];
    return months.some(m => getAmountForMonth(monthlyData, m) !== 0);
  });

  if (!costType) {
    let maxByCat: Record<string, number> = {};
    for (const category of validCategories) {
      const monthlyData = categoryData[category];
      let max = 0;
      for (const m of months) {
        const v = getAmountForMonth(monthlyData, m);
        if (Math.abs(v) > Math.abs(max)) max = v;
      }
      maxByCat[category] = max;
    }
    return validCategories
      .map(category => ({ category, amount: maxByCat[category] }))
      .sort((a, b) => b.amount - a.amount)
      .map(item => item.category);
  }

  const order = DIRECT_COST_ORDER;
  return validCategories.sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b, 'ko');
  });
}
