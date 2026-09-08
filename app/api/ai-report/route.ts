/**
 * AI 보고서 API — 요청 시점에 즉시 생성 (결정적, LLM 미사용)
 *
 * GET /api/ai-report?year=2026&month=6&mode=ytd&costType=영업비
 *
 * 원본(cn-report)은 사전 생성한 .txt 를 서빙하거나 같은 로직을 실시간 실행했다.
 * 여기서는 항상 최신 전처리 결과로 계산한다 — 보고서 파일을 따로 만들어 커밋할 필요가 없다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadExpenseData } from '@/lib/expense-dash-server';
import {
  buildAiReport,
  type PlanBasis,
  type PlanData,
  type ReportMode,
} from '@/lib/ai-report-builder';
import type { CostType } from '@/lib/types';

/** 계획(예산) — 전처리 산출물. 없으면 계획 관련 지표를 건너뛴다 */
async function loadPlan(): Promise<PlanData | null> {
  try {
    const mod = await import('@/data/processed/plan.json');
    return mod.default as unknown as PlanData;
  } catch {
    return null;
  }
}

const COST_TYPES: CostType[] = ['전체', '직접비', '영업비'];
const MODES: ReportMode[] = ['monthly', 'ytd'];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  const rawMode = sp.get('mode');
  const rawCost = sp.get('costType');
  // 연간계획 기준 — 화면 전환탭이 넘긴다. 없으면 기존계획
  const planBasis: PlanBasis = sp.get('planBasis') === 'adjusted' ? 'adjusted' : 'base';

  const mode: ReportMode = MODES.includes(rawMode as ReportMode)
    ? (rawMode as ReportMode)
    : 'ytd';
  const costType: CostType = COST_TYPES.includes(rawCost as CostType)
    ? (rawCost as CostType)
    : '영업비';

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: 'year·month 파라미터가 필요합니다. (month 는 1~12)' },
      { status: 400 }
    );
  }

  try {
    const [{ queries, salesError }, plan] = await Promise.all([
      loadExpenseData(costType),
      loadPlan(),
    ]);
    const report = buildAiReport(queries, { year, month, mode, costType, plan, planBasis });
    if (salesError) report.notes.push(`매출 조회 실패: ${salesError}`);
    return NextResponse.json(report);
  } catch (err: any) {
    console.error('[ai-report] 실패:', err);
    return NextResponse.json(
      { error: '보고서 생성에 실패했습니다.', detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
