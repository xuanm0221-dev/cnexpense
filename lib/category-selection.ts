/**
 * 집계 기준(관리식/재무식)과 탭(전체/직접비/영업비)에 해당하는 계정 묶음 선택.
 * 카드(CostTypeTabs)·우측 표·막대 차트가 같은 데이터를 보도록 한 곳에서 만든다.
 */

import type { BusinessUnitCosts, CategoryData, CostBasis, CostType, MonthlyAmounts } from './types';

/** 대분류 이름이 겹치면 월별로 합산 (전체 탭 = 직접비 + 영업비) */
export function mergeCategoryData(a: CategoryData, b: CategoryData): CategoryData {
  const out: CategoryData = {};
  for (const category of Object.keys(a)) {
    out[category] = { ...a[category] };
  }
  for (const category of Object.keys(b)) {
    const target = out[category] ?? (out[category] = {});
    for (const month of Object.keys(b[category])) {
      target[month] = (target[month] || 0) + b[category][month];
    }
  }
  return out;
}

export function selectCategoryData(
  costs: BusinessUnitCosts | undefined,
  costBasis: CostBasis,
  tab: CostType
): CategoryData {
  if (!costs) return {};
  if (costBasis === '재무식') return costs.재무식 ?? {};
  if (tab === '직접비') return costs.직접비;
  if (tab === '영업비') return costs.영업비;
  return mergeCategoryData(costs.직접비, costs.영업비);
}

/** 정렬 기준 면 — 전체 탭도 대분류 고정 순서를 쓴다 (카드와 동일) */
export function categorySortSide(tab: CostType): '직접비' | '영업비' {
  return tab === '영업비' ? '영업비' : '직접비';
}

/** 여러 계정을 합친 가상 월별 시계열 */
export function sumCategoryMonthly(
  categoryData: CategoryData,
  categories: string[]
): MonthlyAmounts {
  const out: MonthlyAmounts = {};
  for (const category of categories) {
    const monthly = categoryData[category];
    if (!monthly) continue;
    for (const month of Object.keys(monthly)) {
      out[month] = (out[month] || 0) + monthly[month];
    }
  }
  return out;
}
