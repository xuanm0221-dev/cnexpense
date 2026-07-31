/**
 * 상세 KPI: 직접비+영업비 합계. 매출은 법인(5브랜드 합)·경영지원(동일 합)·그 외 단일 브랜드
 */

import { isCorporateBusinessUnitSlug } from './corporate-cost-merge';
import { getPreviousYearMonth } from './calculations';
import { singleBrandRetailSales, sumCorporateRetailSales } from './corporate-retail';
import {
  buildPeriod,
  combineAccessors,
  fromCategoryData,
  periodValue,
  previousYearPeriod,
  rateForMonth,
  type Period,
} from './period';
import type { Currency, ExchangeRateData } from './exchange-rates';
import type { BusinessUnitCosts, CostBasis, RetailSalesData, ViewMode } from './types';

export type CorporateKpiColumn = {
  cost: number;
  costPrev: number;
  costYoYIndexPct: number | null;
  sales: number | null;
  salesPrev: number | null;
  salesYoYIndexPct: number | null;
  /** 매출대비 비용율 (퍼센트 포인트, 예: 15.3) */
  rate: number | null;
  ratePrev: number | null;
  rateYoYpp: number | null;
};

export type CorporateKpiMetrics = {
  month: CorporateKpiColumn;
  ytd: CorporateKpiColumn;
};

/** 관리식: 차트 탭과 동일 면 / 재무식: 연결계정과목 전체 */
function costAccessorFor(
  bu: BusinessUnitCosts,
  costBasis: CostBasis,
  costSide?: '직접비' | '영업비'
) {
  if (costBasis === '재무식') return fromCategoryData(bu.재무식 ?? {});
  if (costSide) return fromCategoryData(bu[costSide]);
  return combineAccessors(fromCategoryData(bu.직접비), fromCategoryData(bu.영업비));
}

function buildColumn(
  cost: number,
  costPrev: number,
  sales: number | null,
  salesPrev: number | null
): CorporateKpiColumn {
  const rate =
    sales != null && sales !== 0 ? (cost / sales) * 100 : null;
  const ratePrev =
    salesPrev != null && salesPrev !== 0 ? (costPrev / salesPrev) * 100 : null;
  const costYoYIndexPct = costPrev !== 0 ? (cost / costPrev) * 100 : null;
  const salesYoYIndexPct =
    sales != null &&
    salesPrev != null &&
    salesPrev !== 0
      ? (sales / salesPrev) * 100
      : null;
  const rateYoYpp =
    rate != null && ratePrev != null ? rate - ratePrev : null;

  return {
    cost,
    costPrev,
    costYoYIndexPct,
    sales,
    salesPrev,
    salesYoYIndexPct,
    rate,
    ratePrev,
    rateYoYpp,
  };
}

export type DetailKpiRetailMode =
  | { aggregation: 'corporate' }
  | { aggregation: 'single'; brandId: string };

/** 법인·경영지원 → 리테일 5브랜드 합산, MLB 등 → 해당 브랜드 단독 */
export function detailPageRetailKpiMode(buKey: string): DetailKpiRetailMode {
  if (isCorporateBusinessUnitSlug(buKey)) return { aggregation: 'corporate' };
  if (buKey === '경영지원') return { aggregation: 'corporate' };
  return { aggregation: 'single', brandId: buKey };
}

function salesForKpi(
  retail: RetailSalesData | null,
  monthKey: string,
  mode: DetailKpiRetailMode
): number | null {
  if (mode.aggregation === 'corporate') {
    return sumCorporateRetailSales(retail, monthKey);
  }
  return singleBrandRetailSales(retail, mode.brandId, monthKey);
}

/**
 * 상세 KPI.
 * - `costSide` 지정 시 비용·매출대비는 차트 탭(직접비/영업비)과 동일 면 기준.
 * - 판매매출·매출 YOY는 `costSide`와 무관하게 항상 동일(법인·경영지원 5브랜드 합 등 기존 규칙).
 */
/** 리테일 매출을 표시 통화로 환산 (기간 규칙: 당월=월평균, 그 외=기간평균) */
function convertSales(
  salesCny: number | null,
  period: Period,
  currency: Currency,
  rates: ExchangeRateData | null
): number | null {
  if (salesCny === null) return null;
  if (currency === 'CNY') return salesCny;
  const r = rateForMonth(
    rates,
    period.endMonth,
    period.viewMode === '당월' ? '월평균' : '기간평균'
  );
  return r === null ? null : salesCny * r;
}

export function buildDetailKpiMetrics(
  buCosts: BusinessUnitCosts,
  retailMonth: RetailSalesData | null,
  retailYtd: RetailSalesData | null,
  selectedMonth: string,
  retailMode: DetailKpiRetailMode,
  costSide?: '직접비' | '영업비',
  options?: {
    /** 첫 번째 열의 기간 (당월 또는 분기). 미지정 시 당월 */
    viewMode?: ViewMode;
    costBasis?: CostBasis;
    currency?: Currency;
    exchangeRates?: ExchangeRateData | null;
  }
): CorporateKpiMetrics {
  const viewMode = options?.viewMode ?? '당월';
  const costBasis = options?.costBasis ?? '관리식';
  const currency = options?.currency ?? 'CNY';
  const rates = options?.exchangeRates ?? null;

  const prevMonth = getPreviousYearMonth(selectedMonth);
  const accessor = costAccessorFor(buCosts, costBasis, costSide);

  // 1열: 선택 기간 (당월 또는 분기)
  const periodA = buildPeriod(selectedMonth, viewMode === '누적(YTD)' ? '당월' : viewMode);
  const periodAPrev = previousYearPeriod(periodA);
  // 2열: 누적(YTD) 고정
  const periodY = buildPeriod(selectedMonth, '누적(YTD)');
  const periodYPrev = previousYearPeriod(periodY);

  const costM = periodValue(accessor, periodA, currency, rates) ?? 0;
  const costMPrev = periodValue(accessor, periodAPrev, currency, rates) ?? 0;
  const costY = periodValue(accessor, periodY, currency, rates) ?? 0;
  const costYPrev = periodValue(accessor, periodYPrev, currency, rates) ?? 0;

  // 매출: 분기는 리테일 시계열이 기간별로 미리 계산되어 들어오므로 기준월 키로 조회
  const salesSource = viewMode === '당월' ? retailMonth : retailYtd;
  const salesM = convertSales(
    salesForKpi(salesSource, periodA.endMonth, retailMode),
    periodA,
    currency,
    rates
  );
  const salesMPrev = convertSales(
    salesForKpi(salesSource, periodAPrev.endMonth, retailMode),
    periodAPrev,
    currency,
    rates
  );
  const salesY = convertSales(
    salesForKpi(retailYtd, selectedMonth, retailMode),
    periodY,
    currency,
    rates
  );
  const salesYPrev = convertSales(
    salesForKpi(retailYtd, prevMonth, retailMode),
    periodYPrev,
    currency,
    rates
  );

  return {
    month: buildColumn(costM, costMPrev, salesM, salesMPrev),
    ytd: buildColumn(costY, costYPrev, salesY, salesYPrev),
  };
}

export function buildCorporateKpiMetrics(
  buCosts: BusinessUnitCosts,
  retailMonth: RetailSalesData | null,
  retailYtd: RetailSalesData | null,
  selectedMonth: string
): CorporateKpiMetrics {
  return buildDetailKpiMetrics(buCosts, retailMonth, retailYtd, selectedMonth, {
    aggregation: 'corporate',
  });
}
