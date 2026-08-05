/**
 * 비용(SAP) 원천 JSON → 심층분석용 AggregatedData 변환
 *
 * 원천
 *   aggregated-costs.json   사업부 → 직접비/영업비 → 대분류 → 월별 금액   (= cost_lv1)
 *   account-analysis.json   위 + 구성 한 단계 더                          (= cost_lv2)
 *   headcount / store-headcount.json  사업부 → 월별 인원수
 *     비용구분에 맞춰 쓴다 — 직접비=매장 인원, 영업비=사무실 인원, 전체=합
 *   /api/retail-sales-monthly         사업부 → 월별 실판매출(V+)
 *
 * 사업부·법인 합산 대상은 이 파일에서 정하지 않는다. `lib/corporate-cost-merge.ts` 의
 * CORPORATE_BUSINESS_UNIT_IDS(비용 합산)와 `lib/retail-brands.ts` 의 RETAIL_BRAND_IDS
 * (매출 합산 — 경영지원은 자체 매출이 없어 제외)를 그대로 쓴다.
 *
 * 순수 함수라 서버·클라이언트 어디서든 돌아간다. 파일/네트워크 I/O는 호출부(API 라우트)가 한다.
 */

import type {
  CostData,
  CostType,
  HeadcountData,
  MonthlyAmounts,
  RetailSalesData,
  StoreHeadcountData,
} from './types';
import type { AccountAnalysisData } from './account-analysis';
import type {
  AggregatedData,
  CategoryDetail,
  MonthlyAggregated,
  MonthlyTotal,
} from './expense-dash-types';
import { CORPORATE_BUSINESS_UNIT_IDS } from './corporate-cost-merge';
import { CORPORATE_RETAIL_UNIT, RETAIL_BRAND_IDS } from './retail-brands';

/** 집계에 담을 비용구분 — '전체'는 두 축을 모두 담는다는 뜻 */
const COST_TYPE_SIDES: CostType[] = ['직접비', '영업비'];

export interface BuildAggregatedInput {
  costData: CostData;
  analysis?: AccountAnalysisData | null;
  headcount?: HeadcountData | null;
  storeHeadcount?: StoreHeadcountData | null;
  /** 사업부 → 월별 실판매출(위안). 없으면 매출 0 으로 둔다 */
  sales?: RetailSalesData | null;
  /** 담을 비용구분. 기본은 직접비·영업비 둘 다 */
  costType?: CostType;
}

/** "2026-06" → { year: 2026, month: 6, yyyymm: "202606" } — 형식이 아니면 null */
function parseMonth(ym: string): { year: number; month: number; yyyymm: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month, yyyymm: `${m[1]}${m[2]}` };
}

function sidesFor(costType: CostType | undefined): CostType[] {
  if (!costType || costType === '전체') return COST_TYPE_SIDES;
  return [costType];
}

function addTo(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

/**
 * 비용구분에 맞는 인원수.
 *   직접비 → 매장 인원 (매장에서 발생하는 비용이므로)
 *   영업비 → 사무실 인원
 *   전체   → 둘의 합
 * 인당 비용을 낼 때 분모가 성격과 맞아야 해서 이렇게 나눈다.
 */
function headcountOf(
  office: HeadcountData | null | undefined,
  store: StoreHeadcountData | null | undefined,
  unit: string,
  ym: string,
  costType: CostType
): number {
  const officeCount = office?.[unit]?.[ym] ?? 0;
  const storeCount = store?.[unit]?.[ym] ?? 0;
  if (costType === '직접비') return storeCount;
  if (costType === '영업비') return officeCount;
  return officeCount + storeCount;
}

export function buildAggregatedData(input: BuildAggregatedInput): AggregatedData {
  const { costData, analysis, headcount, storeHeadcount, sales, costType } = input;
  const sides = sidesFor(costType);
  /** monthly_total 의 인원수 기준 — 요청한 비용구분을 따른다 */
  const effectiveCostType: CostType = costType ?? '전체';

  const monthly_aggregated: MonthlyAggregated[] = [];
  const category_detail: CategoryDetail[] = [];
  /** `${biz}|${ym}` → 금액 합계 (monthly_total 용) */
  const totalByUnitMonth = new Map<string, number>();

  const units = Object.keys(costData.data ?? {});
  /** 이 대시보드가 다루는 월 전체 — 매출만 있고 비용이 없는 달도 여기 안에서만 인정한다 */
  const monthUniverse = new Set(costData.metadata?.months ?? []);
  const monthSet = new Set<string>();

  // ── cost_lv1 (대분류) ──────────────────────────────────────────────
  for (const unit of units) {
    const blocks = costData.data[unit];
    if (!blocks) continue;

    for (const side of sides) {
      const categories = blocks[side as '직접비' | '영업비'];
      if (!categories) continue;

      for (const [cost_lv1, monthly] of Object.entries(categories as Record<string, MonthlyAmounts>)) {
        for (const [ym, amountRaw] of Object.entries(monthly)) {
          const parsed = parseMonth(ym);
          if (!parsed) continue;
          const amount = Number(amountRaw) || 0;
          monthSet.add(ym);

          monthly_aggregated.push({
            biz_unit: unit,
            year: parsed.year,
            month: parsed.month,
            yyyymm: parsed.yyyymm,
            cost_lv1,
            amount,
            headcount: headcountOf(headcount, storeHeadcount, unit, ym, side),
            sales: sales?.[unit]?.[ym] ?? 0,
            cost_type: side,
          });
          addTo(totalByUnitMonth, `${unit}|${ym}`, amount);
        }
      }
    }
  }

  // ── cost_lv2 (구성) — 계정별 분석 JSON 의 관리식 계층 ────────────────
  for (const [unit, bySide] of Object.entries(analysis?.관리식 ?? {})) {
    for (const side of sides) {
      const categories = bySide?.[side];
      if (!categories) continue;

      for (const [cost_lv1, subs] of Object.entries(categories)) {
        for (const [cost_lv2, monthly] of Object.entries(subs)) {
          for (const [ym, amountRaw] of Object.entries(monthly)) {
            const parsed = parseMonth(ym);
            if (!parsed) continue;

            category_detail.push({
              biz_unit: unit,
              year: parsed.year,
              month: parsed.month,
              yyyymm: parsed.yyyymm,
              cost_lv1,
              cost_lv2,
              cost_lv3: '',
              amount: Number(amountRaw) || 0,
              headcount: headcountOf(headcount, storeHeadcount, unit, ym, side),
              cost_type: side,
            });
          }
        }
      }
    }
  }

  // ── 매출만 있고 해당 비용구분 금액이 없는 사업부·월도 채운다 ──────────
  //
  // 매출은 비용구분(직접비/영업비)과 무관하다. 그런데 monthly_total 을 비용에서만 만들면
  // 그 조합에 비용이 없는 사업부는 행 자체가 없어져 매출까지 같이 빠진다.
  // (실제로 Duvetica·SUPRA 는 직접비만 있어서, 영업비로 보면 법인 매출이 11백만 위안 적게
  //  나왔다.) 그래서 매출이 있는 사업부·월은 금액 0 으로라도 행을 만들어 둔다.
  for (const [unit, monthly] of Object.entries(sales ?? {})) {
    if (!units.includes(unit)) continue;
    for (const [ym, amount] of Object.entries(monthly)) {
      if (!monthUniverse.has(ym) || !Number(amount)) continue;
      const key = `${unit}|${ym}`;
      if (!totalByUnitMonth.has(key)) {
        totalByUnitMonth.set(key, 0);
        monthSet.add(ym);
      }
    }
  }

  // ── monthly_total ────────────────────────────────────────────────
  const monthly_total: MonthlyTotal[] = [];
  for (const [key, amount] of totalByUnitMonth) {
    const [unit, ym] = key.split('|');
    const parsed = parseMonth(ym);
    if (!parsed) continue;
    monthly_total.push({
      biz_unit: unit,
      year: parsed.year,
      month: parsed.month,
      yyyymm: parsed.yyyymm,
      amount,
      headcount: headcountOf(headcount, storeHeadcount, unit, ym, effectiveCostType),
      sales: sales?.[unit]?.[ym] ?? 0,
    });
  }

  const months = [...monthSet].sort();
  const years = [...new Set(months.map(m => Number(m.slice(0, 4))))].sort((a, b) => a - b);
  const monthNums = [...new Set(months.map(m => Number(m.slice(5, 7))))].sort((a, b) => a - b);

  return {
    monthly_aggregated,
    monthly_total,
    category_detail,
    metadata: {
      target_biz_units: units,
      years,
      months: monthNums,
      cost_types: sides,
      sales_biz_units: Object.keys(sales ?? {}),
      estimatedMonths: analysis?.metadata?.추정월 ?? {},
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 법인 합산에 넣을 사업부 목록.
 * 비용은 경영지원까지 포함하고(CORPORATE_BUSINESS_UNIT_IDS), 매출은 자체 매출이 있는
 * 브랜드만 더한다(RETAIL_BRAND_IDS) — 경영지원을 매출에 넣으면 이중 계상이 된다.
 */
export function corporateCostUnits(available: string[]): string[] {
  const set = new Set(available);
  return CORPORATE_BUSINESS_UNIT_IDS.filter(u => set.has(u));
}

export function corporateSalesUnits(available: string[]): string[] {
  const set = new Set(available);
  return RETAIL_BRAND_IDS.filter(u => set.has(u));
}

/**
 * 사업부별 분석 표에서 뺄 사업부.
 *
 * 규모가 작아 브랜드별 비교·스코어에 넣으면 순위만 흐려진다는 판단(사용자 지정).
 * **법인 합계에는 그대로 들어간다** — 표시에서만 빼므로 총액·비용률은 달라지지 않는다.
 */
export const ANALYSIS_EXCLUDED_UNITS = ['Duvetica', 'SUPRA'];

export function isAnalysisUnit(unit: string): boolean {
  return !ANALYSIS_EXCLUDED_UNITS.includes(unit);
}

export { CORPORATE_RETAIL_UNIT };
