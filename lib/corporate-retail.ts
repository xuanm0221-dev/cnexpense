/**
 * 법인(리테일 브랜드 합산) 매출 — 홈 법인 카드와 동일한 브랜드 집합
 */

import type { RetailSalesData } from './types';

export const RETAIL_BRAND_IDS = ['MLB', 'MLB KIDS', 'Discovery', 'Duvetica', 'SUPRA'] as const;

/** 선택 월 키에 대해 브랜드별 값이 하나라도 있으면 합산(값 없는 브랜드는 제외). retail 없으면 null */
export function sumCorporateRetailSales(
  retail: RetailSalesData | null,
  monthKey: string
): number | null {
  if (!retail) return null;
  let total = 0;
  let has = false;
  for (const b of RETAIL_BRAND_IDS) {
    const v = retail[b]?.[monthKey];
    if (v != null) {
      total += v;
      has = true;
    }
  }
  return has ? total : null;
}

/** 단일 사업부(브랜드) 리테일 매출 — API 키가 사업부 id와 동일할 때 */
export function singleBrandRetailSales(
  retail: RetailSalesData | null,
  brandId: string,
  monthKey: string
): number | null {
  if (!retail) return null;
  const v = retail[brandId]?.[monthKey];
  return v != null ? v : null;
}

/** 월별 법인 합산 매출 맵 (YoY용, 누락 월은 0으로 합산) */
export function buildCorporateRetailSalesByMonth(
  retail: RetailSalesData | null
): Record<string, number> | null {
  if (!retail) return null;
  const months = new Set<string>();
  for (const b of RETAIL_BRAND_IDS) {
    Object.keys(retail[b] || {}).forEach((m) => months.add(m));
  }
  const out: Record<string, number> = {};
  months.forEach((m) => {
    let s = 0;
    for (const b of RETAIL_BRAND_IDS) {
      s += retail[b]?.[m] ?? 0;
    }
    out[m] = s;
  });
  return Object.keys(out).length > 0 ? out : null;
}
