/**
 * 조회 기간 (당월 / 누적(YTD) / 분기)
 *
 * 분기는 **누적 차감**으로 계산한다.
 *   1분기 = YTD(3월)
 *   2분기 = YTD(6월) − YTD(3월)
 *   3분기 = YTD(9월) − YTD(6월)
 *   4분기 = YTD(12월) − YTD(9월)
 *
 * 원화(KRW)도 분기 환율을 따로 쓰지 않고 **누적 원화끼리 차감**한다.
 *   2분기 KRW = YTD(6월)CNY × 기간평균(6월) − YTD(3월)CNY × 기간평균(3월)
 * 이렇게 해야 분기 합계가 누적(YTD) 원화와 정확히 일치한다.
 */

import { calculateYTD, getAmountForMonth } from './calculations';
import type { ExchangeRateData } from './exchange-rates';
import type { CategoryData, MonthlyAmounts, ViewMode } from './types';

export const QUARTER_VIEW_MODES = ['1분기', '2분기', '3분기', '4분기'] as const;
export type QuarterViewMode = (typeof QUARTER_VIEW_MODES)[number];

export const VIEW_MODES: ViewMode[] = ['당월', '누적(YTD)', ...QUARTER_VIEW_MODES];

export function isQuarterView(viewMode: ViewMode): viewMode is QuarterViewMode {
  return (QUARTER_VIEW_MODES as readonly string[]).includes(viewMode);
}

/** '2분기' → 2 */
export function quarterNumber(viewMode: QuarterViewMode): number {
  return parseInt(viewMode.charAt(0), 10);
}

/** 분기 구성 월 번호 (2분기 → [4,5,6]) */
export function quarterMonthNumbers(q: number): number[] {
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

export interface Period {
  viewMode: ViewMode;
  year: string;
  /** 당월·YTD = 선택월, 분기 = 분기 마지막 월 ("2026-06") */
  endMonth: string;
  /** 분기에서 차감할 직전 분기 말월. 당월·YTD·1분기는 null */
  baseMonth: string | null;
  /** 분기 구성 월 목록 (분기 전용, 그 외 빈 배열) */
  months: string[];
}

function monthKey(year: string, m: number): string {
  return `${year}-${String(m).padStart(2, '0')}`;
}

export function buildPeriod(selectedMonth: string, viewMode: ViewMode): Period {
  const year = (selectedMonth || '').split('-')[0] || '';

  if (isQuarterView(viewMode)) {
    const q = quarterNumber(viewMode);
    const nums = quarterMonthNumbers(q);
    return {
      viewMode,
      year,
      endMonth: monthKey(year, nums[2]),
      baseMonth: q > 1 ? monthKey(year, nums[0] - 1) : null,
      months: nums.map(m => monthKey(year, m)),
    };
  }

  return {
    viewMode,
    year,
    endMonth: selectedMonth,
    baseMonth: null,
    months: [],
  };
}

/** 전년 동기간 */
export function previousYearPeriod(period: Period): Period {
  const prevYear = String(parseInt(period.year, 10) - 1);
  const shift = (m: string | null) =>
    m ? `${prevYear}-${m.split('-')[1]}` : null;
  return {
    viewMode: period.viewMode,
    year: prevYear,
    endMonth: shift(period.endMonth) as string,
    baseMonth: shift(period.baseMonth),
    months: period.months.map(m => `${prevYear}-${m.split('-')[1]}`),
  };
}

/** 월별 금액에 접근하는 방법 — 단일 시계열 또는 대분류 묶음 */
export interface MonthlyAccessor {
  /** 해당 월 금액 */
  atMonth: (month: string) => number;
  /** 1월~해당 월 누적 */
  ytd: (month: string) => number;
}

export function fromMonthly(monthly: MonthlyAmounts | undefined): MonthlyAccessor {
  const data = monthly ?? {};
  return {
    atMonth: m => getAmountForMonth(data, m),
    ytd: m => calculateYTD(data, m),
  };
}

export function fromCategoryData(categoryData: CategoryData | undefined): MonthlyAccessor {
  const data = categoryData ?? {};
  return {
    atMonth: m => {
      let total = 0;
      for (const c in data) total += getAmountForMonth(data[c], m);
      return total;
    },
    ytd: m => {
      let total = 0;
      for (const c in data) total += calculateYTD(data[c], m);
      return total;
    },
  };
}

/** 여러 대분류 묶음(직접비+영업비 등)을 합친 접근자 */
export function combineAccessors(...accessors: MonthlyAccessor[]): MonthlyAccessor {
  return {
    atMonth: m => accessors.reduce((s, a) => s + a.atMonth(m), 0),
    ytd: m => accessors.reduce((s, a) => s + a.ytd(m), 0),
  };
}

/** 기간 금액 (위안) */
export function periodCny(accessor: MonthlyAccessor, period: Period): number {
  if (period.viewMode === '당월') {
    return accessor.atMonth(period.endMonth);
  }
  const end = accessor.ytd(period.endMonth);
  const base = period.baseMonth ? accessor.ytd(period.baseMonth) : 0;
  return end - base;
}

/** 해당 월에 적용할 환율 (당월=월평균, 그 외=기간평균) */
export function rateForMonth(
  rates: ExchangeRateData | null,
  month: string,
  column: '월평균' | '기간평균'
): number | null {
  if (!rates?.rates || !month) return null;
  const [year, mm] = month.split('-');
  return rates.rates[year]?.[mm]?.[column] ?? null;
}

/**
 * 기간 금액 (원화). 환율이 없으면 null.
 * 분기는 누적 원화끼리 차감 (환율을 분기에 따로 적용하지 않음).
 */
export function periodKrw(
  accessor: MonthlyAccessor,
  period: Period,
  rates: ExchangeRateData | null
): number | null {
  if (period.viewMode === '당월') {
    const r = rateForMonth(rates, period.endMonth, '월평균');
    return r === null ? null : accessor.atMonth(period.endMonth) * r;
  }

  const rEnd = rateForMonth(rates, period.endMonth, '기간평균');
  if (rEnd === null) return null;
  const endKrw = accessor.ytd(period.endMonth) * rEnd;

  if (!period.baseMonth) return endKrw;

  const rBase = rateForMonth(rates, period.baseMonth, '기간평균');
  if (rBase === null) return null;
  return endKrw - accessor.ytd(period.baseMonth) * rBase;
}

/** 통화에 맞는 기간 금액. KRW인데 환율이 없으면 null */
export function periodValue(
  accessor: MonthlyAccessor,
  period: Period,
  currency: 'CNY' | 'KRW',
  rates: ExchangeRateData | null
): number | null {
  return currency === 'CNY'
    ? periodCny(accessor, period)
    : periodKrw(accessor, period, rates);
}

/**
 * 인원수 기준 — 스톡이라 누적/분기 모두 **평균**.
 * 당월=해당 월, YTD=1월~선택월 평균, 분기=분기 3개월 평균 (값 있는 월만)
 */
export function headcountForPeriod(
  monthly: MonthlyAmounts | null | undefined,
  period: Period
): number | null {
  if (!monthly) return null;

  if (period.viewMode === '당월') {
    const v = monthly[period.endMonth];
    return v != null ? v : null;
  }

  const months =
    period.months.length > 0
      ? period.months
      : ytdMonths(period.endMonth);

  let total = 0;
  let count = 0;
  for (const m of months) {
    const v = monthly[m];
    if (v != null) {
      total += v;
      count += 1;
    }
  }
  return count > 0 ? total / count : null;
}

function ytdMonths(endMonth: string): string[] {
  const [year, mm] = endMonth.split('-');
  const end = parseInt(mm, 10);
  const out: string[] = [];
  for (let m = 1; m <= end; m++) out.push(monthKey(year, m));
  return out;
}

/** 해당 기간에 비용 데이터가 존재하는지 (분기 탭 비활성화 판단용) */
export function periodHasData(period: Period, availableMonths: string[]): boolean {
  if (period.viewMode === '당월' || period.viewMode === '누적(YTD)') {
    return availableMonths.includes(period.endMonth);
  }
  return period.months.some(m => availableMonths.includes(m));
}

/**
 * 월별 시계열을 각 달의 **월평균 환율**로 원화 환산한 사본.
 * 월별 추이 차트처럼 '월 단위'로 표시하는 곳에서 사용한다.
 * 환율이 없는 달은 제외(표시 안 함).
 */
export function convertCategoryDataToKrw(
  categoryData: CategoryData,
  rates: ExchangeRateData | null
): CategoryData {
  const out: CategoryData = {};
  for (const category of Object.keys(categoryData)) {
    const src = categoryData[category];
    const dst: MonthlyAmounts = {};
    for (const m of Object.keys(src)) {
      const r = rateForMonth(rates, m, '월평균');
      if (r === null) continue;
      dst[m] = src[m] * r;
    }
    out[category] = dst;
  }
  return out;
}
