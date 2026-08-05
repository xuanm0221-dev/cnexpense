/**
 * 비용 구조·운영효율 심층 보고서 — 자동 산출 수치 API
 *
 * GET /api/cost-report?year=2026&month=6&costType=영업비   (법인 YTD 기준)
 *
 * 서술은 **규칙 기반**으로 만든다 (LLM 없음). 수치 임계값만 고정이고 문장에 들어가는 값은
 * 전부 실데이터다. 외부 사실·미래 추정은 넣지 않는다.
 *
 * 원본(cn-report)은 대분류를 `광고비·지급수수료·임차료·수주회·IT수수료` 로, 브랜드를
 * `MLB·DISCOVERY` 로 코드에 박아뒀지만, 비용(SAP)은 마스터에 따라 대분류 구성이 다르고
 * 사업부도 6개라 **데이터에 실제로 있는 것만** 골라 쓴다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadExpenseData } from '@/lib/expense-dash-server';
import { AD_CATEGORY, calculateCostRatio, calculateYoy } from '@/lib/expense-dash';
import {
  calculateCorrelation,
  calculateEfficiencyGrade,
  calculateROAS,
  calculateROI,
  findOptimalAdSpendRange,
} from '@/lib/stats-utils';
import { CORPORATE_RETAIL_UNIT, RETAIL_BRAND_IDS } from '@/lib/retail-brands';
import { isAnalysisUnit } from '@/lib/expense-dash-adapter';
import type { CostType } from '@/lib/types';

/** 인당 인건비를 낼 대분류 — 마스터의 대분류 명칭. 없으면 인당 지표를 생략한다 */
const LABOR_CATEGORY = '급여';

/** 서술을 붙일 대분류 개수 (금액 상위) */
const COMMENTARY_TOP_N = 5;

const COST_TYPES: CostType[] = ['전체', '직접비', '영업비'];

interface Lv1Row {
  cost_lv1: string;
  amount: number;
  amountPy: number;
  yoy: number | null;
  /** 서술 — 규칙 기반 */
  note: string;
}

const pctI = (v: number | null | undefined) =>
  v == null ? '-' : `${Math.round(v).toLocaleString()}%`;

/** 전년비 구간별 판정 문구 */
function yoyJudge(name: string, yoy: number | null): string {
  if (yoy == null) return `${name} — 전년 데이터가 없어 비교 불가.`;
  const p = Math.round(yoy);
  if (yoy >= 140)
    return `${name} 전년 대비 ${p}% 급증 — 일시적 요인·선제 투자 성격 여부와 지속성 점검 필요.`;
  if (yoy >= 110) return `${name} 전년 대비 ${p}% 증가 — 매출 성장과의 연동성 확인.`;
  if (yoy >= 90) return `${name} 전년 수준 유지 (${p}%).`;
  return `${name} 전년 대비 ${p}%로 절감 — 효율화 성과.`;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  const raw = sp.get('costType');
  const costType: CostType = COST_TYPES.includes(raw as CostType) ? (raw as CostType) : '영업비';

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: 'year·month 파라미터가 필요합니다. (month 는 1~12)' },
      { status: 400 }
    );
  }

  try {
    const { queries, salesError } = await loadExpenseData(costType);
    const corp = CORPORATE_RETAIL_UNIT;

    // ── KPI (법인 YTD) ──────────────────────────────────────────
    const cy = queries.getMonthlyTotal(corp, year, month, 'ytd');
    const py = queries.getMonthlyTotal(corp, year - 1, month, 'ytd');

    const kpi = {
      sales: cy?.sales ?? 0,
      salesPy: py?.sales ?? 0,
      salesYoy: calculateYoy(cy?.sales ?? null, py?.sales ?? null),
      expense: cy?.amount ?? 0,
      expensePy: py?.amount ?? 0,
      expenseYoy: calculateYoy(cy?.amount ?? null, py?.amount ?? null),
      ratioCy: cy ? calculateCostRatio(cy.amount, cy.sales) : null,
      ratioPy: py ? calculateCostRatio(py.amount, py.sales) : null,
      headcount: cy?.headcount ?? 0,
    };

    // ── 대분류별 (데이터에 있는 것 전부, 금액 순) ────────────────
    const cyCats = queries.getMonthlyAggregatedByCategory(corp, year, month, 'ytd');
    const pyCats = new Map(
      queries
        .getMonthlyAggregatedByCategory(corp, year - 1, month, 'ytd')
        .map(c => [c.cost_lv1, c.amount])
    );

    const lv1: Lv1Row[] = cyCats.map(c => {
      const amountPy = pyCats.get(c.cost_lv1) ?? 0;
      const yoy = calculateYoy(c.amount, amountPy || null);
      return { cost_lv1: c.cost_lv1, amount: c.amount, amountPy, yoy, note: yoyJudge(c.cost_lv1, yoy) };
    });

    // ── 광고비 브랜드 분해 (데이터에 있는 브랜드만) ──────────────
    const availableBrands = new Set(queries.data.metadata.target_biz_units);
    const adByBrand = RETAIL_BRAND_IDS.filter(b => availableBrands.has(b) && isAnalysisUnit(b)).map(brand => {
      const amount =
        queries
          .getMonthlyAggregatedByCategory(brand, year, month, 'ytd')
          .find(c => c.cost_lv1 === AD_CATEGORY)?.amount ?? 0;
      const amountPy =
        queries
          .getMonthlyAggregatedByCategory(brand, year - 1, month, 'ytd')
          .find(c => c.cost_lv1 === AD_CATEGORY)?.amount ?? 0;
      return { brand, amount, amountPy, yoy: calculateYoy(amount, amountPy || null) };
    });

    // ── 광고 효율 (월별 1~month 광고비 ↔ 매출) ───────────────────
    const pts = queries
      .getAdSalesAnalysisData(corp, year)
      .filter(p => p.month <= month)
      .map(p => ({ adSpend: p.adSpend, sales: p.sales }));

    const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const avgROAS = mean(pts.map(p => calculateROAS(p.sales, p.adSpend)));
    const avgROI = mean(pts.map(p => calculateROI(p.sales, p.adSpend)));
    const corr =
      pts.length >= 2
        ? calculateCorrelation(pts.map(p => p.adSpend), pts.map(p => p.sales))
        : 0;
    const grade = calculateEfficiencyGrade(corr, avgROAS);
    const optimal = findOptimalAdSpendRange(pts).optimal;
    const hasAdEff = pts.length > 0;

    // ── 인당 인건비 (법인, 해당 월) ──────────────────────────────
    const laborOf = (y: number): number | null => {
      const total = queries.getMonthlyTotal(corp, y, month, 'monthly');
      if (!total?.headcount) return null;
      const labor = queries
        .getMonthlyAggregatedByCategory(corp, y, month, 'monthly')
        .find(c => c.cost_lv1 === LABOR_CATEGORY);
      return labor ? labor.amount / total.headcount : null;
    };
    const perCapita = queries.hasCategory(LABOR_CATEGORY) ? laborOf(year) : null;
    const perCapitaPy = queries.hasCategory(LABOR_CATEGORY) ? laborOf(year - 1) : null;
    const laborYoy = calculateYoy(perCapita, perCapitaPy);

    // ── 서술 (규칙 기반) ─────────────────────────────────────────
    const ratioDelta =
      kpi.ratioCy != null && kpi.ratioPy != null ? kpi.ratioCy - kpi.ratioPy : null;

    const adEffLine = !hasAdEff
      ? '광고비 또는 매출 데이터가 없어 광고 효율을 산출하지 못했습니다.'
      : (() => {
          const base = `ROI ${Math.round(avgROI).toLocaleString()}%, 평균 ROAS ${avgROAS.toFixed(2)} (효율 등급 ${grade.grade}).`;
          if (grade.grade === 'A' || grade.grade === 'B')
            return `${base} 광고-매출 연계 양호 — 현 집행 기조 유지하되 최적구간(${optimal.range}, ROAS ${optimal.avgROAS.toFixed(2)}) 참고해 미세조정.`;
          if (grade.grade === 'C')
            return `${base} 개선 여지 — 최적 집행구간 ${optimal.range}(ROAS ${optimal.avgROAS.toFixed(2)})로 재배분 시 효율 상향 가능.`;
          return `${base} 효율 저조 — 채널·타겟팅 전면 재점검 필요.`;
        })();

    const commentary = {
      overview:
        kpi.salesYoy == null || kpi.expenseYoy == null
          ? '전년 데이터가 부족해 매출·비용 증감을 비교하지 못했습니다.'
          : kpi.expenseYoy > kpi.salesYoy
            ? `매출 ${pctI(kpi.salesYoy)} 대비 비용이 ${pctI(kpi.expenseYoy)}로 더 빠르게 집행되고 있습니다. 외형 성장과 함께 투자·인프라 성격의 지출이 포함된 국면입니다.`
            : `매출 ${pctI(kpi.salesYoy)} 대비 비용 집행(${pctI(kpi.expenseYoy)})이 통제되고 있어 비용 효율이 개선되는 국면입니다.`,
      costNote:
        ratioDelta == null
          ? '매출이 없어 비용률을 산출하지 못했습니다.'
          : ratioDelta > 0
            ? `비용률이 전년 대비 ${ratioDelta.toFixed(1)}%p 상승 — 소모성 지출인지 성장·인프라 투자인지 성격 구분 필요.`
            : `비용률이 전년 대비 ${Math.abs(ratioDelta).toFixed(1)}%p 개선 — 비용 통제 성과.`,
      adEff: adEffLine,
      /** 금액 상위 대분류에 대한 개별 판정 */
      categories: lv1.slice(0, COMMENTARY_TOP_N).map(r => r.note),
      labor:
        perCapita == null
          ? '인원수 또는 인건비 데이터가 없어 인당 인건비를 산출하지 못했습니다.'
          : laborYoy == null
            ? `인당 인건비 ${(perCapita / 1000).toFixed(1)}K (전년 비교 불가).`
            : laborYoy >= 110
              ? `인당 인건비 ${(perCapita / 1000).toFixed(1)}K (전년比 ${Math.round(laborYoy)}%) 상승 추세 — 인당 생산성 관리 필요.`
              : laborYoy >= 95
                ? `인당 인건비 ${(perCapita / 1000).toFixed(1)}K (전년比 ${Math.round(laborYoy)}%) 안정적 운영.`
                : `인당 인건비 ${(perCapita / 1000).toFixed(1)}K (전년比 ${Math.round(laborYoy)}%) 압축 — 인력 공백·이탈 리스크 점검.`,
      conclusion:
        ratioDelta != null && ratioDelta > 0
          ? `외형 성장(${pctI(kpi.salesYoy)})과 함께 비용률이 상승한 투자 국면입니다. 일시적 요인이 정리되고 광고 효율(현 ${grade.grade}등급)이 최적화되면 수익성 개선 여력이 있습니다.`
          : '매출 성장과 비용 통제가 병행되는 국면입니다. 현 기조 유지 시 수익성 개선이 기대됩니다.',
    };

    return NextResponse.json({
      year,
      month,
      costType,
      kpi,
      lv1,
      adByBrand,
      labor: { perCapita, perCapitaPy, yoy: laborYoy, category: LABOR_CATEGORY },
      adEff: hasAdEff
        ? {
            roi: avgROI,
            roas: avgROAS,
            correlation: corr,
            grade: grade.grade,
            optimalRange: optimal.range,
            optimalRoas: optimal.avgROAS,
            months: pts.length,
          }
        : null,
      commentary,
      salesError,
    });
  } catch (err: any) {
    console.error('[cost-report] 실패:', err);
    return NextResponse.json(
      { error: '보고서 산출에 실패했습니다.', detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
