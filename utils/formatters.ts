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
 * 원화를 백만원(M) 단위로 포맷팅.
 * 위안 천단위(K)와 자릿수를 맞추기 위함 (85,624K CNY ≈ 17,956M KRW)
 * @param amountKrw 원 단위 금액
 */
export function toMillionKRW(amount: number): string {
  const m = Math.round(amount / 1_000_000);
  return m.toLocaleString('en-US') + 'M';
}

/**
 * 통화에 맞춘 금액 포맷.
 * @param amountCny 위안 금액 (원본)
 * @param currency 'CNY' | 'KRW'
 * @param rate KRW 환산 환율 (CNY면 무시). 없으면 '—'
 */
export function formatAmountByCurrency(
  amountCny: number,
  currency: 'CNY' | 'KRW',
  rate: number | null
): string {
  if (currency === 'CNY') return toThousandCNY(amountCny);
  if (rate === null) return '—';
  return toMillionKRW(amountCny * rate);
}

/** 통화 단위 라벨 (K = 천위안 / M = 백만원) */
export function currencyUnitLabel(currency: 'CNY' | 'KRW'): string {
  return currency === 'CNY' ? '천위안(K)' : '백만원(M)';
}

/**
 * 이미 통화 환산이 끝난 금액을 포맷.
 * 환산 자체는 lib/period.ts 가 담당한다 (분기는 누적 차감이라 단순 곱셈이 아님).
 * @param value CNY면 위안, KRW면 원. null이면 '—' (환율 미입력)
 */
export function formatAmount(value: number | null, currency: 'CNY' | 'KRW'): string {
  if (value === null) return '—';
  return currency === 'CNY' ? toThousandCNY(value) : toMillionKRW(value);
}

/** 증감액 포맷 (부호 포함). 값이 없으면 null */
export function formatDelta(
  current: number | null,
  prev: number | null,
  currency: 'CNY' | 'KRW'
): string | null {
  if (current === null || prev === null) return null;
  const diff = current - prev;
  if (currency === 'CNY') {
    const k = Math.round(diff / 1000);
    return `${k >= 0 ? '+' : ''}${k.toLocaleString('en-US')}K`;
  }
  const m = Math.round(diff / 1_000_000);
  return `${m >= 0 ? '+' : ''}${m.toLocaleString('en-US')}M`;
}

/** YoY 지수(전년=100). 전년이 0이거나 값이 없으면 null */
export function yoyIndex(current: number | null, prev: number | null): number | null {
  if (current === null || prev === null || prev === 0) return null;
  return Math.round((current / prev) * 100);
}

/**
 * 인당 금액 — 위안은 천위안 소수1자리(30.2K), 원화는 천원 정수(6,334K).
 * 인당 금액은 단위가 작아 백만원 대신 천원을 쓴다.
 */
export function formatPerPerson(
  value: number | null,
  currency: 'CNY' | 'KRW'
): string {
  if (value === null) return '—';
  if (currency === 'CNY') {
    return `${Number((value / 1000).toFixed(1)).toLocaleString('en-US')}K`;
  }
  return `${Math.round(value / 1000).toLocaleString('en-US')}K`;
}

/** 인당 금액 증감 (부호 포함) */
export function formatPerPersonDelta(
  current: number | null,
  prev: number | null,
  currency: 'CNY' | 'KRW'
): string | null {
  if (current === null || prev === null) return null;
  const diff = current - prev;
  if (currency === 'CNY') {
    return `${diff >= 0 ? '+' : ''}${(diff / 1000).toFixed(1)}K`;
  }
  return `${diff >= 0 ? '+' : ''}${Math.round(diff / 1000).toLocaleString('en-US')}K`;
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
