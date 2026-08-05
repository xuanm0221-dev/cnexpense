/**
 * 심층분석용 집계 데이터 API
 *
 * GET /api/expense-aggregated?costType=영업비
 *   → 비용(SAP) 원천 JSON + 월별 매출 + 인원수를 합쳐 AggregatedData 로 반환.
 *     클라이언트가 setExpenseData() 로 메모리에 등록하고 심층분석 화면들이 공유한다.
 *
 * costType 은 화면의 직접비/영업비 탭을 그대로 따른다 (기본 영업비 — 원본 cn-report 화면 기준).
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadExpenseData } from '@/lib/expense-dash-server';
import type { CostType } from '@/lib/types';

const COST_TYPES: CostType[] = ['전체', '직접비', '영업비'];

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('costType');
  const costType: CostType = COST_TYPES.includes(raw as CostType)
    ? (raw as CostType)
    : '영업비';

  try {
    const { data, salesError } = await loadExpenseData(costType);
    return NextResponse.json({ ...data, metadata: { ...data.metadata, salesError } });
  } catch (err: any) {
    console.error('[expense-aggregated] 실패:', err);
    return NextResponse.json(
      { error: '집계 데이터 생성에 실패했습니다.', detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
