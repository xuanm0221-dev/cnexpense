/**
 * 월별 리테일 매출 시계열 API — 광고비 효율분석·AI보고서·스코어카드용
 *
 * GET /api/retail-sales-monthly?from=2025-01&to=2026-06
 *   → 사업부 × 연월 실판매출(V+) / Tag가 매출
 *
 * `/api/retail-sales` 는 한 기준월의 MTD·YTD 만 주기 때문에, 광고비↔매출 상관·회귀처럼
 * **월 단위 시계열**이 필요한 화면에서는 쓸 수 없다. 그래서 같은 원천(FNF.CHN.DW_SALE)을
 * 월로 묶어 한 번의 질의로 돌려주는 라우트를 따로 둔다.
 *
 * 채널 분해는 하지 않는다 (효율분석은 브랜드 총매출 기준). 채널이 필요하면 retail-sales 를 쓴다.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  MONTH_RE,
  fetchMonthlySales,
  type MonthlySalesPoint,
} from '@/lib/retail-sales-monthly';

export interface RetailSalesMonthlyResponse {
  from: string;
  to: string;
  /** 사업부 → 월별 매출 (매출이 있는 월만) */
  units: { [businessUnit: string]: MonthlySalesPoint[] };
  unmappedBrandCodes: string[];
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  if (!from || !MONTH_RE.test(from) || !to || !MONTH_RE.test(to)) {
    return NextResponse.json(
      { error: 'from·to 파라미터가 필요합니다. (형식: YYYY-MM)' },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json({ error: 'from 이 to 보다 뒤입니다.' }, { status: 400 });
  }

  try {
    const { units, unmappedBrandCodes } = await fetchMonthlySales(from, to);
    const body: RetailSalesMonthlyResponse = {
      from,
      to,
      units,
      unmappedBrandCodes,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (err: any) {
    console.error('[retail-sales-monthly] 조회 실패:', err);
    return NextResponse.json(
      { error: '매출 조회에 실패했습니다.', detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
