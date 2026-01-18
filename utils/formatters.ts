/**
 * 데이터 포맷팅 유틸리티
 */

import { YoYResult } from '@/lib/types';

/**
 * 위안을 천위안(K) 단위로 변환하여 포맷팅
 * @param amount 위안 단위 금액
 * @returns "21,600K" 형식의 문자열
 */
export function toThousandCNY(amount: number): string {
  const k = Math.round(amount / 1000);
  return k.toLocaleString('en-US') + 'K';
}

/**
 * YoY 정보를 포맷팅
 * @param yoy YoY 계산 결과
 * @returns "YoY 93% (-1,540K)" 형식의 문자열
 */
export function formatYoY(yoy: YoYResult): string {
  if (yoy.pct === 'N/A' || yoy.deltaK === 'N/A') {
    return 'N/A';
  }
  
  const sign = yoy.deltaK >= 0 ? '+' : '';
  return `YoY ${yoy.pct}% (${sign}${yoy.deltaK.toLocaleString('en-US')}K)`;
}

/**
 * 퍼센트 포맷팅
 * @param value 퍼센트 값 (0.031 → 3.1%)
 * @param decimals 소수점 자릿수 (기본: 1)
 * @returns "3.1%" 형식의 문자열
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * 연월 문자열을 한글로 포맷팅
 * @param yearMonth "2024-12" 형식
 * @returns "2024년 12월" 형식
 */
export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year}년 ${parseInt(month)}월`;
}

/**
 * 연월 배열에서 년도 추출
 * @param months ["2024-01", "2024-02", ...]
 * @returns ["2024", "2025"]
 */
export function extractYears(months: string[]): string[] {
  const years = [...new Set(months.map(m => m.split('-')[0]))];
  return years.sort();
}

/**
 * 특정 연도의 월 목록 추출
 * @param months 전체 월 목록
 * @param year 연도
 * @returns ["01", "02", ...]
 */
export function extractMonthsForYear(months: string[], year: string): string[] {
  return months
    .filter(m => m.startsWith(year))
    .map(m => m.split('-')[1])
    .sort();
}
