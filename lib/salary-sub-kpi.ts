/**
 * 법인 상세 급여 중분류 KPI: 홈 CostTypeTabs 급여 하위와 동일 규칙(금액·인당·지수% YOY)
 */

import type { BusinessUnitCosts, MonthlyAmounts } from './types';
import {
  calculateYoY,
  calculateYTD,
  getAmountForMonth,
  getPreviousYearMonth,
  yoYDeltaToIndexPercent,
} from './calculations';
import {
  salarySubPerPersonDenominator,
  type CostSideDetail,
} from './corporate-headcount';

export const SALARY_KPI_ROW_LABELS = [
  '기본급',
  '성과급',
  'Red Pack',
  '외주/PT',
  '퇴직급여',
] as const;

export type SalaryKpiRowLabel = (typeof SALARY_KPI_ROW_LABELS)[number];

export type SalarySubMetricCell = {
  amountCny: number;
  amountKFormatted: string;
  perPersonCny: number | null;
  perPersonLabel: string;
  yoyIndexPct: number | 'N/A';
  perPersonYoyIndexPct: number | 'N/A';
};

export type SalarySubKpiRowModel = {
  label: string;
  month: SalarySubMetricCell;
  ytd: SalarySubMetricCell;
};

export type SalarySubKpiCardModel = {
  title: string;
  /** 급여(해당 직접/영업 면) YTD 합 — 대분류 `급여`와 동기간, 하위 행 YTD 합과 정합 */
  heroAmountCny: number;
  heroPrevAmountCny: number;
  heroYoyIndexPct: number | null;
  rows: SalarySubKpiRowModel[];
};

function formatK(amountCny: number): string {
  const k = Math.round(amountCny / 1000);
  return k.toLocaleString('en-US') + 'K';
}

function formatPerPersonK(amountCny: number): string {
  return `${Number((amountCny / 1000).toFixed(1)).toLocaleString('en-US')}K/인`;
}

function perPersonYoyIndex(
  currAmt: number,
  prevAmt: number,
  denomCurr: number,
  denomPrev: number
): number | 'N/A' {
  if (denomCurr <= 0 || denomPrev <= 0) return 'N/A';
  const curr = currAmt / denomCurr;
  const prev = prevAmt / denomPrev;
  if (prev === 0) return 'N/A';
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return yoYDeltaToIndexPercent(Math.round(pct * 10) / 10);
}

function buildMetricCell(
  monthly: MonthlyAmounts | undefined,
  selectedMonth: string,
  isYTD: boolean,
  denomCurr: number,
  denomPrev: number
): SalarySubMetricCell {
  const prevMonth = getPreviousYearMonth(selectedMonth);
  const currAmt = isYTD
    ? calculateYTD(monthly ?? {}, selectedMonth)
    : getAmountForMonth(monthly ?? {}, selectedMonth);
  const prevAmt = isYTD
    ? calculateYTD(monthly ?? {}, prevMonth)
    : getAmountForMonth(monthly ?? {}, prevMonth);

  const yoy = calculateYoY(monthly ?? {}, selectedMonth, isYTD);
  const yoyIndexPct = yoYDeltaToIndexPercent(yoy.pct);

  const perPersonCny =
    denomCurr > 0 ? currAmt / denomCurr : null;

  const perPersonYoyIndexPct = perPersonYoyIndex(
    currAmt,
    prevAmt,
    denomCurr,
    denomPrev
  );

  return {
    amountCny: currAmt,
    amountKFormatted: formatK(currAmt),
    perPersonCny,
    perPersonLabel:
      perPersonCny === null || denomCurr <= 0
        ? '—'
        : formatPerPersonK(perPersonCny),
    yoyIndexPct,
    perPersonYoyIndexPct,
  };
}

/**
 * 단일 BusinessUnitCosts(법인 merge 또는 단일 브랜드)에 대해 급여 중분류 KPI 카드 데이터 생성
 */
export function buildSalarySubKpiCardModel(
  title: string,
  costs: BusinessUnitCosts,
  costType: CostSideDetail,
  selectedMonth: string,
  officeSnapshot: number | null,
  storeSnapshot: number | null,
  officeSeries: MonthlyAmounts | null,
  storeSeries: MonthlyAmounts | null
): SalarySubKpiCardModel {
  const sub = costs.급여중분류;
  if (!sub) {
    return {
      title,
      heroAmountCny: 0,
      heroPrevAmountCny: 0,
      heroYoyIndexPct: null,
      rows: [],
    };
  }

  const buckets = costType === '직접비' ? sub.직접비 : sub.영업비;
  const prevMonth = getPreviousYearMonth(selectedMonth);

  const denomMonth = salarySubPerPersonDenominator(
    costType,
    false,
    selectedMonth,
    officeSnapshot,
    storeSnapshot,
    officeSeries,
    storeSeries
  );
  const officePrevSnap = officeSeries
    ? getAmountForMonth(officeSeries, prevMonth)
    : null;
  const storePrevSnap = storeSeries
    ? getAmountForMonth(storeSeries, prevMonth)
    : null;
  const denomMonthPrev = salarySubPerPersonDenominator(
    costType,
    false,
    prevMonth,
    officePrevSnap,
    storePrevSnap,
    officeSeries,
    storeSeries
  );

  const denomYtd = salarySubPerPersonDenominator(
    costType,
    true,
    selectedMonth,
    officeSnapshot,
    storeSnapshot,
    officeSeries,
    storeSeries
  );
  const denomYtdPrev = salarySubPerPersonDenominator(
    costType,
    true,
    prevMonth,
    null,
    null,
    officeSeries,
    storeSeries
  );

  const salaryMajor = costs[costType]?.['급여'];
  let heroYtd = salaryMajor ? calculateYTD(salaryMajor, selectedMonth) : 0;
  let heroYtdPrev = salaryMajor ? calculateYTD(salaryMajor, prevMonth) : 0;

  const rows: SalarySubKpiRowModel[] = [];

  for (const label of SALARY_KPI_ROW_LABELS) {
    const monthly = buckets[label];
    const mAmt = getAmountForMonth(monthly ?? {}, selectedMonth);
    const yAmt = calculateYTD(monthly ?? {}, selectedMonth);
    if (mAmt === 0 && yAmt === 0) continue;

    rows.push({
      label,
      month: buildMetricCell(
        monthly,
        selectedMonth,
        false,
        denomMonth,
        denomMonthPrev
      ),
      ytd: buildMetricCell(
        monthly,
        selectedMonth,
        true,
        denomYtd,
        denomYtdPrev
      ),
    });
  }

  if (!salaryMajor || (heroYtd === 0 && heroYtdPrev === 0)) {
    heroYtd = 0;
    heroYtdPrev = 0;
    for (const label of SALARY_KPI_ROW_LABELS) {
      const monthly = buckets[label];
      heroYtd += calculateYTD(monthly ?? {}, selectedMonth);
      heroYtdPrev += calculateYTD(monthly ?? {}, prevMonth);
    }
  }

  const heroYoyIndexPct =
    heroYtdPrev !== 0
      ? 100 + Math.round(((heroYtd - heroYtdPrev) / Math.abs(heroYtdPrev)) * 100)
      : null;

  return {
    title,
    heroAmountCny: heroYtd,
    heroPrevAmountCny: heroYtdPrev,
    heroYoyIndexPct,
    rows,
  };
}
