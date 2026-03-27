/**
 * 상세 KPI: 직접비+영업비 합계. 매출은 법인(5브랜드 합)·경영지원(동일 합)·그 외 단일 브랜드
 */

import { isCorporateBusinessUnitSlug } from './corporate-cost-merge';
import { calculateCategoryTotal, getPreviousYearMonth } from './calculations';
import { singleBrandRetailSales, sumCorporateRetailSales } from './corporate-retail';
import type { BusinessUnitCosts, RetailSalesData } from './types';

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

function totalCost(bu: BusinessUnitCosts, month: string, isYTD: boolean): number {
  return (
    calculateCategoryTotal(bu.직접비, month, isYTD) +
    calculateCategoryTotal(bu.영업비, month, isYTD)
  );
}

/** 차트 직접/영업 탭과 동일 면의 비용만. 미지정 시 직접+영업 합계 */
function costForChartSide(
  bu: BusinessUnitCosts,
  month: string,
  isYTD: boolean,
  costSide?: '직접비' | '영업비'
): number {
  if (!costSide) return totalCost(bu, month, isYTD);
  return calculateCategoryTotal(bu[costSide], month, isYTD);
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
export function buildDetailKpiMetrics(
  buCosts: BusinessUnitCosts,
  retailMonth: RetailSalesData | null,
  retailYtd: RetailSalesData | null,
  selectedMonth: string,
  retailMode: DetailKpiRetailMode,
  costSide?: '직접비' | '영업비'
): CorporateKpiMetrics {
  const prevMonth = getPreviousYearMonth(selectedMonth);

  const costM = costForChartSide(buCosts, selectedMonth, false, costSide);
  const costMPrev = costForChartSide(buCosts, prevMonth, false, costSide);
  const salesM = salesForKpi(retailMonth, selectedMonth, retailMode);
  const salesMPrev = salesForKpi(retailMonth, prevMonth, retailMode);

  const costY = costForChartSide(buCosts, selectedMonth, true, costSide);
  const costYPrev = costForChartSide(buCosts, prevMonth, true, costSide);
  const salesY = salesForKpi(retailYtd, selectedMonth, retailMode);
  const salesYPrev = salesForKpi(retailYtd, prevMonth, retailMode);

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
