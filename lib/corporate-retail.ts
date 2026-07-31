/**
 * 법인(리테일 브랜드 합산) 매출 — 홈 법인 카드와 동일한 브랜드 집합
 *
 * /api/retail-sales 가 법인·경영지원 키를 직접 내려주므로 그 값을 우선 사용하고,
 * 없을 때만 브랜드 5개를 클라이언트에서 합산한다.
 */

import { CORPORATE_RETAIL_UNIT, RETAIL_BRAND_IDS } from './retail-brands';
import type { RetailSalesData } from './types';

export { RETAIL_BRAND_IDS };

/** 선택 월 키에 대해 법인 값 → 없으면 브랜드별 합산(값 없는 브랜드는 제외). 둘 다 없으면 null */
export function sumCorporateRetailSales(
  retail: RetailSalesData | null,
  monthKey: string
): number | null {
  if (!retail) return null;
  const corporate = retail[CORPORATE_RETAIL_UNIT]?.[monthKey];
  if (corporate != null) return corporate;

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
  const corporate = retail[CORPORATE_RETAIL_UNIT];
  if (corporate && Object.keys(corporate).length > 0) return { ...corporate };

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
