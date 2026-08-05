/**
 * 심층분석 화면들이 쓰는 집계 질의 계층
 *
 * 두 가지 방식으로 쓴다.
 *   클라이언트 — `/api/expense-aggregated` 응답을 setExpenseData() 로 등록해두고 모듈 함수 호출
 *   서버       — createExpenseQueries(data) 로 인스턴스를 만들어 사용 (요청마다 다른 데이터를
 *                다루므로 전역 싱글턴을 쓰면 동시 요청끼리 섞인다)
 *
 * cn-report 의 expenseDataDash.ts 를 그대로 옮기지 않았다. 그쪽은 사업부가
 * `"법인"|"MLB"|"KIDS"|"DISCOVERY"|"공통"` 로 박혀 있고 **경영지원 비용이 MLB 밑에
 * 들어가 있는 자기네 원천의 특성**을 보정하는 코드가 섞여 있는데, 비용(SAP)은 경영지원이
 * 독립 사업부라 그 보정을 그대로 가져오면 금액이 이중으로 잡힌다.
 * 그래서 필요한 질의만 이 프로젝트 기준으로 다시 썼다.
 */

import type {
  AggregatedData,
  BizUnit,
  CategoryDetail,
  ExpenseMode,
  MonthlyAggregated,
  MonthlyTotal,
} from './expense-dash-types';
import { corporateCostUnits, corporateSalesUnits } from './expense-dash-adapter';
import { CORPORATE_RETAIL_UNIT } from './retail-brands';

export type {
  AggregatedData,
  BizUnit,
  CategoryDetail,
  ExpenseMode,
  MonthlyAggregated,
  MonthlyTotal,
};

export interface AdSalesDataPoint {
  month: number;
  /** "202606" */
  yyyymm: string;
  adSpend: number;
  sales: number;
  adSpendPrevYear: number | null;
  salesPrevYear: number | null;
}

export interface AdSalesByChannelItem {
  channel: string;
  data: AdSalesDataPoint[];
}

export function isCorporate(bizUnit: BizUnit): boolean {
  return bizUnit === CORPORATE_RETAIL_UNIT;
}

/** 전년비 = 당년 / 전년 × 100 (절대값 지수) */
export function calculateYoy(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current / previous) * 100;
}

/**
 * 부가세 보정 계수.
 *
 * 비용(SAP G/L)은 부가세 미포함(V−)인데 리테일 매출은 부가세 포함(V+)이라 그대로 나누면
 * 비용률이 과소평가된다. 그래서 분자에 1.13 을 곱해 기준을 맞춘다.
 * (cn-report 보고서 머리글의 `비용률 = 비용 × 1.13 / 리테일 매출` 과 같은 정의)
 */
export const VAT_FACTOR = 1.13;

/** 비용률 = 비용 × 1.13 / 매출 × 100 */
export function calculateCostRatio(amount: number, sales: number): number | null {
  if (!sales) return null;
  return ((amount * VAT_FACTOR) / sales) * 100;
}

/** 인당 비용 */
export function calculatePerPersonCost(amount: number, headcount: number): number | null {
  if (!headcount) return null;
  return amount / headcount;
}

// ────────────────────────────────────────────────────────────────
// 질의 인스턴스
// ────────────────────────────────────────────────────────────────

export interface ExpenseQueries {
  data: AggregatedData;
  getMonthlyTrend(bizUnit: BizUnit, year: number, mode?: ExpenseMode): MonthlyTotal[];
  getMonthlyTotal(
    bizUnit: BizUnit,
    year: number,
    month: number,
    mode?: ExpenseMode
  ): MonthlyTotal | null;
  getMonthlyAggregatedByCategory(
    bizUnit: BizUnit,
    year: number,
    month: number,
    mode?: ExpenseMode
  ): MonthlyAggregated[];
  getCategoryDetail(
    bizUnit: BizUnit,
    year: number,
    month: number,
    costLv1: string,
    mode?: ExpenseMode
  ): CategoryDetail[];
  /** 대분류 이름은 데이터에서 찾는다 — 상수로 박으면 마스터가 바뀔 때 조용히 0이 된다 */
  hasCategory(name: string): boolean;
  getAdSalesAnalysisData(bizUnit: BizUnit, year: number): AdSalesDataPoint[];
  getAdSalesByChannel(bizUnit: BizUnit, year: number): AdSalesByChannelItem[];
}

/** 광고비 대분류 이름 — 마스터의 대분류 명칭 그대로 */
export const AD_CATEGORY = '광고비';

export function createExpenseQueries(data: AggregatedData): ExpenseQueries {
  const costUnitsOf = (bizUnit: BizUnit): string[] =>
    isCorporate(bizUnit) ? corporateCostUnits(data.metadata.target_biz_units) : [bizUnit];

  const salesUnitsOf = (bizUnit: BizUnit): string[] =>
    isCorporate(bizUnit) ? corporateSalesUnits(data.metadata.sales_biz_units) : [bizUnit];

  const getMonthlyTrend: ExpenseQueries['getMonthlyTrend'] = (
    bizUnit,
    year,
    mode = 'monthly'
  ) => {
    const costUnits = new Set(costUnitsOf(bizUnit));
    const saleUnits = new Set(salesUnitsOf(bizUnit));

    const byMonth = new Map<number, MonthlyTotal>();
    for (const row of data.monthly_total) {
      if (row.year !== year) continue;
      const inCost = costUnits.has(row.biz_unit);
      const inSales = saleUnits.has(row.biz_unit);
      if (!inCost && !inSales) continue;

      let cur = byMonth.get(row.month);
      if (!cur) {
        cur = {
          biz_unit: bizUnit,
          year,
          month: row.month,
          yyyymm: row.yyyymm,
          amount: 0,
          headcount: 0,
          sales: 0,
        };
        byMonth.set(row.month, cur);
      }
      if (inCost) {
        cur.amount += row.amount;
        cur.headcount += row.headcount;
      }
      if (inSales) cur.sales += row.sales;
    }

    const rows = [...byMonth.values()].sort((a, b) => a.month - b.month);
    if (mode !== 'ytd') return rows;

    let amount = 0;
    let sales = 0;
    return rows.map(row => {
      amount += row.amount;
      sales += row.sales;
      // 인원수는 스톡값이라 누적하지 않고 해당 월 값을 그대로 쓴다
      return { ...row, amount, sales };
    });
  };

  const getMonthlyTotal: ExpenseQueries['getMonthlyTotal'] = (
    bizUnit,
    year,
    month,
    mode = 'monthly'
  ) => {
    const rows = getMonthlyTrend(bizUnit, year, mode);
    if (mode !== 'ytd') return rows.find(r => r.month === month) ?? null;
    // YTD 는 해당 월에 데이터가 없어도 그때까지의 누적을 봐야 한다.
    // (예: SUPRA 는 상반기 일부 달만 매출이 있어 6월 행이 없는데, 그렇다고 YTD 매출이
    //  0 이 되면 안 된다.)
    let last: MonthlyTotal | null = null;
    for (const r of rows) {
      if (r.month > month) break;
      last = r;
    }
    return last;
  };

  const getMonthlyAggregatedByCategory: ExpenseQueries['getMonthlyAggregatedByCategory'] = (
    bizUnit,
    year,
    month,
    mode = 'monthly'
  ) => {
    const costUnits = new Set(costUnitsOf(bizUnit));
    const from = mode === 'ytd' ? 1 : month;

    const byCategory = new Map<string, MonthlyAggregated>();
    for (const row of data.monthly_aggregated) {
      if (row.year !== year || !costUnits.has(row.biz_unit)) continue;
      if (row.month < from || row.month > month) continue;

      const cur = byCategory.get(row.cost_lv1);
      if (cur) cur.amount += row.amount;
      else byCategory.set(row.cost_lv1, { ...row, biz_unit: bizUnit, month });
    }
    return [...byCategory.values()].sort((a, b) => b.amount - a.amount);
  };

  const getCategoryDetail: ExpenseQueries['getCategoryDetail'] = (
    bizUnit,
    year,
    month,
    costLv1,
    mode = 'monthly'
  ) => {
    const costUnits = new Set(costUnitsOf(bizUnit));
    const from = mode === 'ytd' ? 1 : month;

    const bySub = new Map<string, CategoryDetail>();
    for (const row of data.category_detail) {
      if (row.year !== year || row.cost_lv1 !== costLv1) continue;
      if (!costUnits.has(row.biz_unit)) continue;
      if (row.month < from || row.month > month) continue;

      const cur = bySub.get(row.cost_lv2);
      if (cur) cur.amount += row.amount;
      else bySub.set(row.cost_lv2, { ...row, biz_unit: bizUnit, month });
    }
    return [...bySub.values()].sort((a, b) => b.amount - a.amount);
  };

  const hasCategory = (name: string): boolean =>
    data.monthly_aggregated.some(r => r.cost_lv1 === name);

  const adSpendOf = (bizUnit: BizUnit, year: number, month: number): number =>
    getMonthlyAggregatedByCategory(bizUnit, year, month, 'monthly').find(
      c => c.cost_lv1 === AD_CATEGORY
    )?.amount ?? 0;

  const getAdSalesAnalysisData: ExpenseQueries['getAdSalesAnalysisData'] = (bizUnit, year) => {
    if (!hasCategory(AD_CATEGORY)) return [];
    const prevByMonth = new Map(
      getMonthlyTrend(bizUnit, year - 1, 'monthly').map(r => [r.month, r])
    );

    const out: AdSalesDataPoint[] = [];
    for (const cur of getMonthlyTrend(bizUnit, year, 'monthly')) {
      const adSpend = adSpendOf(bizUnit, year, cur.month);
      // 광고비나 매출이 0인 달은 상관·회귀를 왜곡하므로 뺀다
      if (adSpend <= 0 || cur.sales <= 0) continue;

      const prev = prevByMonth.get(cur.month);
      out.push({
        month: cur.month,
        yyyymm: cur.yyyymm,
        adSpend,
        sales: cur.sales,
        adSpendPrevYear: prev ? adSpendOf(bizUnit, year - 1, cur.month) : null,
        salesPrevYear: prev?.sales ?? null,
      });
    }
    return out.sort((a, b) => a.month - b.month);
  };

  const getAdSalesByChannel: ExpenseQueries['getAdSalesByChannel'] = (bizUnit, year) => {
    if (!hasCategory(AD_CATEGORY)) return [];
    const prevByMonth = new Map(
      getMonthlyTrend(bizUnit, year - 1, 'monthly').map(r => [r.month, r])
    );

    const byChannel = new Map<string, AdSalesDataPoint[]>();
    for (const cur of getMonthlyTrend(bizUnit, year, 'monthly')) {
      if (cur.sales <= 0) continue;
      const prev = prevByMonth.get(cur.month);
      const prevDetails = prev
        ? getCategoryDetail(bizUnit, year - 1, cur.month, AD_CATEGORY, 'monthly')
        : [];

      for (const d of getCategoryDetail(bizUnit, year, cur.month, AD_CATEGORY, 'monthly')) {
        if (d.amount <= 0) continue;
        const channel = d.cost_lv2.trim() || '기타';
        let points = byChannel.get(channel);
        if (!points) {
          points = [];
          byChannel.set(channel, points);
        }
        points.push({
          month: cur.month,
          yyyymm: cur.yyyymm,
          adSpend: d.amount,
          sales: cur.sales,
          adSpendPrevYear:
            prevDetails.find(p => (p.cost_lv2.trim() || '기타') === channel)?.amount ?? null,
          salesPrevYear: prev?.sales ?? null,
        });
      }
    }

    const sumAd = (points: AdSalesDataPoint[]) => points.reduce((s, d) => s + d.adSpend, 0);
    return [...byChannel.entries()]
      .map(([channel, points]) => ({
        channel,
        data: points.sort((a, b) => a.month - b.month),
      }))
      .sort((a, b) => sumAd(b.data) - sumAd(a.data));
  };

  return {
    data,
    getMonthlyTrend,
    getMonthlyTotal,
    getMonthlyAggregatedByCategory,
    getCategoryDetail,
    hasCategory,
    getAdSalesAnalysisData,
    getAdSalesByChannel,
  };
}

// ────────────────────────────────────────────────────────────────
// 클라이언트용 싱글턴 — 여러 화면이 같은 응답을 나눠 쓴다
// ────────────────────────────────────────────────────────────────

let _queries: ExpenseQueries | null = null;

export function setExpenseData(d: AggregatedData): void {
  _queries = createExpenseQueries(d);
}

export function hasExpenseData(): boolean {
  return _queries !== null;
}

function q(): ExpenseQueries {
  if (!_queries) {
    throw new Error('비용 집계 데이터가 아직 로드되지 않았습니다. (/api/expense-aggregated)');
  }
  return _queries;
}

export const getAggregatedData = (): AggregatedData => q().data;
export const getMonthlyTrend: ExpenseQueries['getMonthlyTrend'] = (...a) =>
  q().getMonthlyTrend(...a);
export const getMonthlyTotal: ExpenseQueries['getMonthlyTotal'] = (...a) =>
  q().getMonthlyTotal(...a);
export const getMonthlyAggregatedByCategory: ExpenseQueries['getMonthlyAggregatedByCategory'] =
  (...a) => q().getMonthlyAggregatedByCategory(...a);
export const getCategoryDetail: ExpenseQueries['getCategoryDetail'] = (...a) =>
  q().getCategoryDetail(...a);
export const getAdSalesAnalysisData: ExpenseQueries['getAdSalesAnalysisData'] = (...a) =>
  q().getAdSalesAnalysisData(...a);
export const getAdSalesByChannel: ExpenseQueries['getAdSalesByChannel'] = (...a) =>
  q().getAdSalesByChannel(...a);
