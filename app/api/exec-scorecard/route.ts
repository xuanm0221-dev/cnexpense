/**
 * Executive Scorecard API — 종합 관리 평가 (0~100 가중 점수 + 등급 + 진단)
 *
 * GET /api/exec-scorecard?biz=법인&year=2026&month=6&costType=영업비
 *
 * 원본(cn-report)은 4개 차원을 본다 — 매출성장 30 / 수익성 25 / 비용관리 25 / 운영건강 20.
 * 비용(SAP) 에는 **PL(영업이익·매출총이익률)과 재고(정체재고) 데이터가 없다.** 그래서 그 두
 * 차원은 산출하지 않고 `available: false` 로 내려보낸다. 원본도 "산출 가능한 차원의 가중치만
 * 합해 재정규화"하는 구조라 그대로 따른다 — 없는 데이터를 임의값으로 채우지 않는다.
 *
 * 채점 밴드·가중치는 평가 기준(루브릭)이라 고정이고, 대입되는 지표는 전부 실데이터다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadExpenseData } from '@/lib/expense-dash-server';
import { calculateCostRatio, calculateYoy } from '@/lib/expense-dash';
import { CORPORATE_RETAIL_UNIT } from '@/lib/retail-brands';
import type { CostType } from '@/lib/types';

const COST_TYPES: CostType[] = ['전체', '직접비', '영업비'];

/** anchor 보간 (pts: [x, y] x오름차순) → clamp */
function lerp(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/** 매출 YoY 비율(100=보합) → 점수 */
const scoreYoy = (r: number) =>
  lerp(r, [
    [70, 0],
    [85, 25],
    [100, 60],
    [110, 80],
    [120, 100],
  ]);

/** 비용 gap(비용증가율 − 매출증가율, %p; 낮을수록 좋음) → 점수 */
const scoreGap = (g: number) =>
  lerp(g, [
    [-10, 100],
    [0, 70],
    [15, 40],
    [30, 20],
    [50, 0],
  ]);

/**
 * 비용 증가를 주도한 대분류 — "영업비 +18%" 만 보면 방만해 보이지만
 * 실제로는 특정 항목이 끌어올린 것이라, 원인을 같이 보여준다.
 */
interface Driver {
  item: string;
  diff: number;
  yoy: number | null;
  /** 당기 비용 중 비중(%) */
  weight: number | null;
  /** 전년 비중(%) */
  weightPy: number | null;
  /** 전체 증가분 중 기여도(%) */
  share: number | null;
}

interface Dimension {
  key: string;
  label: string;
  weight: number;
  available: boolean;
  score: number | null;
  /** 한 줄 근거 */
  sub: string;
  /** 접이식 '계산 근거' 본문 (K위안) */
  calc?: string | null;
  drivers?: Driver[];
  /** 산출 불가 사유 */
  unavailableReason?: string;
}

/** 증가 주도 항목으로 보여줄 개수 */
const TOP_DRIVERS = 2;

function gradeOf(s: number): { grade: string; tone: 'good' | 'warn' | 'bad'; verdict: string } {
  if (s >= 80) return { grade: 'A', tone: 'good', verdict: '전 부문 양호 · 안정적 운영' };
  if (s >= 65) return { grade: 'B', tone: 'good', verdict: '대체로 안정 · 일부 개선 여지' };
  if (s >= 50) return { grade: 'C', tone: 'warn', verdict: '주의 · 취약 부문 점검 필요' };
  if (s >= 35) return { grade: 'D', tone: 'bad', verdict: '즉시 개입 필요' };
  return { grade: 'F', tone: 'bad', verdict: '위험 · 전면 재점검 시급' };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const chg = (yoyPct: number) => `${yoyPct - 100 >= 0 ? '+' : ''}${r1(yoyPct - 100)}%`;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const biz = sp.get('biz') || CORPORATE_RETAIL_UNIT;
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  const rawCost = sp.get('costType');
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
    const { queries, salesError } = await loadExpenseData(costType);

    const cy = queries.getMonthlyTotal(biz, year, month, 'ytd');
    const py = queries.getMonthlyTotal(biz, year - 1, month, 'ytd');

    const salesYoy = calculateYoy(cy?.sales ?? null, py?.sales ?? null);
    const expenseYoy = calculateYoy(cy?.amount ?? null, py?.amount ?? null);

    const k = (n: number) => Math.round(n / 1000).toLocaleString();

    // ── 매출 성장 ────────────────────────────────────────────────
    const growth: Dimension = salesYoy
      ? {
          key: 'growth',
          label: '매출 성장',
          weight: 30,
          available: true,
          score: scoreYoy(salesYoy),
          sub: `리테일 매출 YTD ${chg(salesYoy)}`,
          calc:
            `당년 ${k(cy!.sales)}K / 전년 ${k(py!.sales)}K = ${r1(salesYoy)}%\n` +
            `→ YoY ${r1(salesYoy)}% → 점수 ${Math.round(scoreYoy(salesYoy))}`,
        }
      : {
          key: 'growth',
          label: '매출 성장',
          weight: 30,
          available: false,
          score: null,
          sub: '산출 불가',
          unavailableReason: salesError
            ? '매출 조회 실패'
            : '해당 사업부의 리테일 매출이 없습니다 (경영지원 등)',
        };

    // ── 비용 관리 ────────────────────────────────────────────────
    const gap = salesYoy != null && expenseYoy != null ? expenseYoy - salesYoy : null;
    const ratioCy = cy ? calculateCostRatio(cy.amount, cy.sales) : null;
    const ratioPy = py ? calculateCostRatio(py.amount, py.sales) : null;

    // 증가 주도 대분류 (당기 − 전년 증가액 상위)
    const cyCats = queries.getMonthlyAggregatedByCategory(biz, year, month, 'ytd');
    const pyCatMap = new Map(
      queries
        .getMonthlyAggregatedByCategory(biz, year - 1, month, 'ytd')
        .map(c => [c.cost_lv1, c.amount])
    );
    const totalCy = cy?.amount ?? 0;
    const totalPy = py?.amount ?? 0;
    const totalDiff = totalCy - totalPy;

    const drivers: Driver[] = cyCats
      .map(c => {
        const prev = pyCatMap.get(c.cost_lv1) ?? 0;
        return {
          item: c.cost_lv1,
          diff: c.amount - prev,
          yoy: calculateYoy(c.amount, prev || null),
          weight: totalCy ? (c.amount / totalCy) * 100 : null,
          weightPy: totalPy && prev ? (prev / totalPy) * 100 : null,
          share: totalDiff > 0 ? ((c.amount - prev) / totalDiff) * 100 : null,
        };
      })
      .filter(d => d.diff > 0)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, TOP_DRIVERS);

    const costCtrl: Dimension =
      gap != null
        ? {
            key: 'cost',
            label: '비용 관리',
            weight: 25,
            available: true,
            score: scoreGap(gap),
            sub: `${costType} ${chg(expenseYoy!)} vs 매출 ${chg(salesYoy!)} (gap ${r1(gap)}%p)`,
            calc:
              `${costType} 당년 ${k(totalCy)}K / 전년 ${k(totalPy)}K = ${r1(expenseYoy!)}%\n` +
              `매출 ${r1(salesYoy!)}%  →  gap ${r1(gap)}%p → 점수 ${Math.round(scoreGap(gap))}\n` +
              `비용률 ${ratioPy != null ? r1(ratioPy) : '-'}% → ${ratioCy != null ? r1(ratioCy) : '-'}%`,
            drivers,
          }
        : {
            key: 'cost',
            label: '비용 관리',
            weight: 25,
            available: false,
            score: null,
            sub: '산출 불가',
            unavailableReason: '매출 또는 전년 비용이 없어 gap 을 낼 수 없습니다',
            drivers,
          };

    // ── 비용(SAP) 에 원천이 없는 차원 ─────────────────────────────
    const profitability: Dimension = {
      key: 'profitability',
      label: '수익성',
      weight: 25,
      available: false,
      score: null,
      sub: '영업이익·매출총이익률 데이터 없음',
      unavailableReason: '영업이익·매출총이익률(PL) 데이터가 이 대시보드에 없습니다',
    };
    const health: Dimension = {
      key: 'health',
      label: '운영 건강',
      weight: 20,
      available: false,
      score: null,
      sub: '정체재고 데이터 없음',
      unavailableReason: '정체재고(재고) 데이터가 이 대시보드에 없습니다',
    };

    const dimensions = [growth, profitability, costCtrl, health];
    const usable = dimensions.filter(d => d.available && d.score != null);
    const weightSum = usable.reduce((s, d) => s + d.weight, 0);
    const total = weightSum
      ? usable.reduce((s, d) => s + d.score! * d.weight, 0) / weightSum
      : null;

    const grade = total != null ? gradeOf(total) : null;

    return NextResponse.json({
      biz,
      year,
      month,
      costType,
      total: total != null ? Math.round(total * 10) / 10 : null,
      ...(grade ?? {}),
      /** 산출된 차원이 일부뿐이면 화면에 그 사실을 표시한다 */
      partial: usable.length < dimensions.length,
      dimensions,
      /** 재정규화에 쓰인 가중치 합 — 100 이 아니면 일부 차원이 빠졌다는 뜻 */
      weightSum,
      kpi: {
        sales: cy?.sales ?? 0,
        salesYoy,
        expense: cy?.amount ?? 0,
        expenseYoy,
        ratioCy,
        ratioPy,
      },
      salesError,
    });
  } catch (err: any) {
    console.error('[exec-scorecard] 실패:', err);
    return NextResponse.json(
      { error: '스코어카드 산출에 실패했습니다.', detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
