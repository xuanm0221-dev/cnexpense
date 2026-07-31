/**
 * 환율 (CNY → KRW)
 *
 * 비용 대시보드는 **평균환율**을 쓴다.
 * - 당월      : 해당 월의 `월평균`
 * - 누적(YTD) : 해당 월의 `기간평균` (예: 1~2월 YTD → 2월 기간평균)
 * `월말`은 표 참고용이며 환산에 사용하지 않는다.
 */

import type { ViewMode } from './types';

export const RATE_COLUMNS = ['월말', '월평균', '기간평균'] as const;
export type RateColumn = (typeof RATE_COLUMNS)[number];

/** 한 달치 환율 (미입력은 null) */
export type MonthlyRate = Record<RateColumn, number | null>;

/** "2026" → { "01": {...}, ... "12": {...} } */
export type YearRates = Record<string, MonthlyRate>;

export interface ExchangeRateData {
  metadata: {
    unit: string;
    note?: string;
    updatedAt: string;
  };
  rates: Record<string, YearRates>;
}

export type Currency = 'CNY' | 'KRW';

export const MONTH_KEYS = [
  '01', '02', '03', '04', '05', '06',
  '07', '08', '09', '10', '11', '12',
] as const;

export function emptyMonthlyRate(): MonthlyRate {
  return { 월말: null, 월평균: null, 기간평균: null };
}

/** 연도 12개월 뼈대 (누락 월 채움) */
export function normalizeYearRates(year: YearRates | undefined): YearRates {
  const out: YearRates = {};
  for (const m of MONTH_KEYS) {
    const src = year?.[m];
    out[m] = {
      월말: toRateValue(src?.월말),
      월평균: toRateValue(src?.월평균),
      기간평균: toRateValue(src?.기간평균),
    };
  }
  return out;
}

/** 소수점 2자리로 정규화. 빈 값·비정상 값은 null */
export function toRateValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * 해당 기간에 적용할 환율.
 * @param month "2026-02"
 * @returns 환율(KRW/CNY). 미입력이면 null
 */
export function rateForPeriod(
  data: ExchangeRateData | null,
  month: string,
  viewMode: ViewMode
): number | null {
  if (!data?.rates || !month) return null;
  const [year, mm] = month.split('-');
  const cell = data.rates[year]?.[mm];
  if (!cell) return null;
  return viewMode === '누적(YTD)' ? cell.기간평균 : cell.월평균;
}

/**
 * 환율표에 표시할 연도 목록 (오름차순).
 *
 * 환율 파일에 있는 연도를 기준으로 하고, 비용 데이터에 새 연도가 생기면 자동으로 추가한다.
 * 단 **환율 파일의 최소 연도보다 이전 연도는 제외** — 2026년 기준 YoY만 보면 되므로
 * 2024년처럼 비교에 쓰지 않는 과거 연도가 표에 다시 생기지 않게 하기 위함.
 */
export function yearsForRateTable(
  data: ExchangeRateData | null,
  months: string[] = []
): string[] {
  const rateYears = Object.keys(data?.rates ?? {}).sort();
  const monthYears = [...new Set(months.map(m => m.split('-')[0]).filter(Boolean))];

  if (rateYears.length === 0) return monthYears.sort();

  const minYear = rateYears[0];
  const set = new Set(rateYears);
  monthYears.forEach(y => {
    if (y >= minYear) set.add(y);
  });
  return [...set].sort();
}

/**
 * 금액 환산. CNY면 그대로, KRW면 환율 곱.
 * 환율이 없으면 null (화면에서 '—' 처리)
 */
export function convertAmount(
  amountCny: number,
  currency: Currency,
  rate: number | null
): number | null {
  if (currency === 'CNY') return amountCny;
  if (rate === null) return null;
  return amountCny * rate;
}
