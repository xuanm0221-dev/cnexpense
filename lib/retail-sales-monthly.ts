/**
 * 월별 리테일 매출 조회 (사업부 × 연월 실판매출)
 *
 * `/api/retail-sales-monthly` 와 `/api/expense-aggregated` 가 같은 질의를 쓰기 때문에
 * SQL·매핑을 여기 한 곳에 둔다. 서버 전용 (Snowflake 접속).
 */

import { querySnowflake } from './snowflake';
import { RETAIL_BRAND_CODE_TO_UNIT } from './retail-brands';
import type { RetailSalesData } from './types';

export interface MonthlySalesPoint {
  /** "2026-06" */
  month: string;
  /** 실판 매출 (V+) */
  sale: number;
  /** Tag가 매출 */
  tag: number;
}

export interface MonthlySalesResult {
  units: { [businessUnit: string]: MonthlySalesPoint[] };
  unmappedBrandCodes: string[];
}

const SQL = `
SELECT
  brd_cd,
  TO_CHAR(sale_dt, 'YYYY-MM') AS ym,
  SUM(sale_amt) AS sale_amt,
  SUM(tag_amt)  AS tag_amt
FROM FNF.CHN.DW_SALE
WHERE sale_dt BETWEEN ? AND ?
GROUP BY brd_cd, TO_CHAR(sale_dt, 'YYYY-MM')
ORDER BY ym
`;

export const MONTH_RE = /^\d{4}-\d{2}$/;

/** 해당 연·월의 마지막 날 ("2026-06" → "2026-06-30") */
export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const day = new Date(y, m, 0).getDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchMonthlySales(
  from: string,
  to: string
): Promise<MonthlySalesResult> {
  const rows = await querySnowflake(SQL, [`${from}-01`, lastDayOf(to)]);

  const units: { [unit: string]: MonthlySalesPoint[] } = {};
  const unmapped = new Set<string>();

  for (const row of rows) {
    const brdCd = String(row.BRD_CD ?? row.brd_cd ?? '').trim();
    const unit = RETAIL_BRAND_CODE_TO_UNIT[brdCd];
    if (!unit) {
      if (brdCd) unmapped.add(brdCd);
      continue;
    }
    const month = String(row.YM ?? row.ym ?? '');
    if (!MONTH_RE.test(month)) continue;

    (units[unit] ??= []).push({
      month,
      sale: num(row.SALE_AMT ?? row.sale_amt),
      tag: num(row.TAG_AMT ?? row.tag_amt),
    });
  }

  for (const list of Object.values(units)) {
    list.sort((a, b) => a.month.localeCompare(b.month));
  }

  return { units, unmappedBrandCodes: [...unmapped].sort() };
}

/** 조회 결과 → 어댑터가 쓰는 { 사업부: { 연월: 실판매출 } } 형태 */
export function toRetailSalesData(result: MonthlySalesResult): RetailSalesData {
  const out: RetailSalesData = {};
  for (const [unit, points] of Object.entries(result.units)) {
    const monthly: Record<string, number> = {};
    for (const p of points) monthly[p.month] = p.sale;
    out[unit] = monthly;
  }
  return out;
}
