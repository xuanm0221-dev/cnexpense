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

// 대분류 정렬 순서 정의
const DIRECT_COST_ORDER = [
  '광고선전비',
  '직접광고비',
  '급여',
  '복리비',
  '플랫폼수수료',
  'TP수수료',
  '임차료',
  '운송/보관',
  '감가상각비',
  '진열/포장',
  '용역비',
  '지급수수료',
  '출장비',
  '기타',
];

const OPERATING_COST_ORDER = [
  '광고선전비',
  '급여',
  '복리비',
  '임차료',
  '지급수수료',
  '용역비',
  '출장비',
  '운송/보관',
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
  
  // 지정된 순서대로 정렬
  const order = costType === '직접비' ? DIRECT_COST_ORDER : OPERATING_COST_ORDER;
  
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
