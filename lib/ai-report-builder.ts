/**
 * AI 보고서 빌더 — 결정적(deterministic) 생성. LLM 을 쓰지 않는다.
 *
 * cn-report 가 내려받아 준 실제 보고서(AI보고서_2026년_실적_6월.html)의 구성·수치 정의를
 * 그대로 따른다. 다만 **숫자와 문장은 전부 비용(SAP) 실데이터에서 계산**한다.
 *   · 비용률 = 비용 × 1.13 / 리테일 매출 (비용은 V−, 매출은 V+ 라 분자를 보정)
 *   · 당월 · YTD 를 동반 표시
 *
 * 원본 빌더(cn-report aiReportBuilder.ts)를 옮기지 않은 이유 — 그쪽은 사업부가
 * `MLB / KIDS / DISCOVERY / 공통`, 대분류가 `인건비 / 복리후생비 / IT수수료` 로 박혀 있고
 * 브랜드별 서술까지 문장으로 들어 있어, 사업부·대분류 구성이 다른 비용(SAP)에서는
 * 대부분 0 이 되거나 사실과 다른 문장이 된다.
 */

import type { ExpenseQueries } from './expense-dash';
import { AD_CATEGORY, VAT_FACTOR, calculateCostRatio, calculateYoy } from './expense-dash';
import {
  calculateCorrelation,
  calculateEfficiencyGrade,
  calculateROAS,
  calculateROI,
  findOptimalAdSpendRange,
} from './stats-utils';
import { CORPORATE_RETAIL_UNIT } from './retail-brands';
import { isAnalysisUnit } from './expense-dash-adapter';
import type { CostType } from './types';

export type ReportMode = 'monthly' | 'ytd';

export interface AiReportOptions {
  year: number;
  month: number;
  /** 주 기준 — 화면 상단 라벨과 '악화/개선' 판정에 쓴다. 표는 당월·YTD 둘 다 낸다 */
  mode: ReportMode;
  costType: CostType;
  /** 계획(예산). 없으면 계획집행 점수·계획비 체크포인트를 생략한다 */
  plan?: PlanData | null;
}

/**
 * 비용 성격 분류 — 원본 보고서 ⑦ '고정 / 준고정 / 변동' 섹션 기준.
 * 대분류 이름은 계정과목 마스터를 따른다. 여기 없는 대분류는 변동비로 보고 notes 에 남긴다.
 */
export const COST_NATURE: Record<string, '고정비' | '준고정비' | '변동비'> = {
  급여: '고정비',
  임차료: '고정비',
  감가상각비: '고정비',
  복리비: '준고정비',
  기타: '준고정비',
  광고비: '변동비',
  수주회: '변동비',
  출장비: '변동비',
  지급수수료: '변동비',
  세금과공과: '변동비',
  물류비: '변동비',
  플랫폼수수료: '변동비',
  TP수수료: '변동비',
  대리상지원금: '변동비',
  '진열/포장': '변동비',
};
export type CostNature = '고정비' | '준고정비' | '변동비';
const NATURES: CostNature[] = ['고정비', '준고정비', '변동비'];

/** 한 기간(당월 또는 YTD)의 지표 */
export interface PeriodFigures {
  expense: number;
  expensePy: number;
  expenseYoy: number | null;
  sales: number;
  salesPy: number;
  salesYoy: number | null;
  /** 비용률 = 비용 × 1.13 / 매출 × 100 */
  ratio: number | null;
  ratioPy: number | null;
  ratioDelta: number | null;
  headcount: number;
  headcountPy: number;
}

export interface UnitReport {
  unit: string;
  monthly: PeriodFigures;
  ytd: PeriodFigures;
  /**
   * 법인 비용률 변화에 이 사업부가 기여한 몫(%p).
   * 사업부 자기 매출로 나눈 비용률 변화(ytd.ratioDelta)와는 다르다 — 예컨대 Discovery 는
   * 매출이 216% 늘며 자기 비용률이 −68%p 움직이는데, 법인 전체로 보면 기여는 훨씬 작다.
   * '가장 큰 변동 브랜드'·'주목 브랜드'는 법인 기준으로 봐야 순위가 뒤집히지 않는다.
   */
  contribPp: number | null;
  /** YTD 기준 최대 변동 대분류 (법인 매출 기준 기여도) */
  maxItem: { category: string; deltaPp: number | null; amount: number } | null;
}

export interface CategoryRow {
  category: string;
  nature: CostNature;
  amount: number;
  amountPy: number;
  delta: number;
  yoy: number | null;
  /** 당기 비용 중 비중(%) */
  share: number | null;
  /** 비용률 기여 변화(%p) */
  deltaPp: number | null;
}

export interface NatureRow {
  nature: CostNature;
  amount: number;
  amountPy: number;
  yoy: number | null;
  share: number | null;
  deltaPp: number | null;
}

export interface DriverItem {
  category: string;
  amount: number;
  amountPy: number;
  delta: number;
  yoy: number | null;
}

export type DriverVerdict = '악화' | '개선' | '매출효과' | '보통';

export interface DriverGroup {
  unit: string;
  ratio: number | null;
  ratioDelta: number | null;
  verdict: DriverVerdict;
  up: DriverItem[];
  down: DriverItem[];
}

export interface TopChange {
  unit: string;
  category: string;
  deltaPp: number;
  amount: number;
}

export interface RiskRow {
  unit: string;
  category: string;
  amount: number;
  yoy: number;
  level: '높음' | '중간';
  reason: string;
}

export interface AdEfficiency {
  months: number;
  roi: number;
  roas: number;
  correlation: number;
  grade: string;
  optimalRange: string;
  optimalRoas: number;
}

/** 계획(예산) — 사업부 → 대분류 → 연월 → 금액 */
export interface PlanData {
  metadata: { months: string[]; businessUnits: string[]; unmappedCategories: string[] };
  total: Record<string, Record<string, number>>;
  data: Record<string, Record<string, Record<string, number>>>;
}

/** ② 종합 스코어 — 항목별 배점은 원본 보고서와 동일 */
export interface ScoreItem {
  key: '추세' | '수준' | '광고비율' | '계획집행';
  score: number;
  max: number;
  note: string;
}

export interface ScoreCard {
  unit: string;
  grade: 'A' | 'B' | 'C' | 'D';
  label: '우수' | '양호' | '주의' | '경보';
  total: number;
  items: ScoreItem[];
  ratio: number | null;
  ratioDelta: number | null;
}

/** ③ 체크포인트 */
export interface Checkpoint {
  unit: string;
  signal: '🟢' | '🟡' | '🔴';
  items: { icon: string; title: string; delta: string; detail: string; tone: 'info' | 'warn' | 'flat' }[];
}

export interface AdBrandRow {
  unit: string;
  amount: number;
  amountPy: number;
  yoy: number | null;
  /** 매출 대비 광고비율(%) — 광고비 × 1.13 / 매출 */
  adRatio: number | null;
  adRatioPy: number | null;
}

/**
 * 상세 분석 표 한 행 — 원본의 `rpt-detail-tbl` 컬럼 구성 그대로.
 * 항목 | 당월(전년/당년/YOY) | YTD(전년/당년/YOY) | YTD계획/계획비%/사용률%/연간계획 | 최종판정
 */
export interface DetailRow {
  label: string;
  monthPy: number | null;
  monthCy: number | null;
  monthYoy: number | null;
  ytdPy: number | null;
  ytdCy: number | null;
  ytdYoy: number | null;
  planYtd: number | null;
  /** 계획비 = 실적 / 계획 × 100 */
  planPct: number | null;
  /** 사용률 = YTD 실적 / 연간계획 × 100 */
  usagePct: number | null;
  planYear: number | null;
  verdict: string;
  /** 값이 금액이 아니라 %(비용률 등)이면 true — 화면 포맷이 달라진다 */
  isPercent?: boolean;
}

/** A-1. 인당 인건비 */
export interface PerCapitaRow {
  label: string;
  py: number | null;
  cy: number | null;
  diff: number | null;
  yoy: number | null;
  note: string;
}

/** C. 브랜드별 효율성 비교 */
export interface EfficiencyRow {
  unit: string;
  sales: number;
  salesYoy: number | null;
  expense: number;
  expenseYoy: number | null;
  ratio: number | null;
  ratioPy: number | null;
  headcountEnd: number;
  headcountAvg: number;
  salesPerHead: number | null;
  verdict: string;
}

/** ⑦ 사업부 × 비용 성격 */
export interface NatureByUnitRow {
  unit: string;
  nature: CostNature;
  amount: number;
  amountPy: number;
  yoy: number | null;
  share: number | null;
  note: string;
}

export interface AiReport {
  meta: {
    year: number;
    month: number;
    mode: ReportMode;
    costType: CostType;
    title: string;
    /** "2026년 6월 (당월) · YTD 동반 분석" */
    periodLabel: string;
    ratioFormula: string;
    generatedAt: string;
  };
  /** 상단 3카드 */
  topSummary: {
    ratioDeltaPp: number | null;
    verdict: '전반적 악화' | '전반적 개선' | '보합';
    leadNature: { nature: CostNature; deltaPp: number } | null;
    biggestMover: { unit: string; deltaPp: number } | null;
    worst: UnitReport | null;
    best: UnitReport | null;
    top3: TopChange[];
  };
  /** EXECUTIVE SUMMARY ▸ 문장들 */
  execSummary: string[];
  scoreCards: ScoreCard[];
  checkpoints: Checkpoint[];
  corporate: UnitReport;
  units: UnitReport[];
  categories: CategoryRow[];
  natures: NatureRow[];
  adByBrand: AdBrandRow[];
  driverGroups: DriverGroup[];
  risks: RiskRow[];
  adEfficiency: AdEfficiency | null;
  /** ⑦ 사업부별 비용 구조 */
  natureByUnit: NatureByUnitRow[];
  /** A-1. 인당 인건비 */
  perCapitaRows: PerCapitaRow[];
  /** A-2. 인건비 총액 */
  laborDetail: DetailRow[];
  /** B. 광고비 분석 (사업부별) */
  adDetail: DetailRow[];
  /** A. 전사 비용률 분석 */
  corpDetail: DetailRow[];
  /** B. 비용 항목별 YTD 상세 */
  categoryDetail: DetailRow[];
  /** C. 브랜드별 효율성 비교 */
  efficiency: EfficiencyRow[];
  insights: string[];
  /** 산출하지 못한 항목과 사유 — 빈칸을 조용히 넘기지 않는다 */
  notes: string[];
}

const RISK_HIGH_YOY = 150;
const RISK_MID_YOY = 120;
const RISK_MIN_SHARE = 0.5;
const DRIVERS_PER_UNIT = 3;
const DRIVER_MIN_SHARE = 0.3;
const VERDICT_PP = 0.3;
/** 인당 인건비를 낼 대분류 — 계정과목 마스터의 대분류 명칭 */
const LABOR_CATEGORY = '급여';
/** 보합으로 볼 비용률 변화 폭(%p) */
const FLAT_PP = 0.05;

const pctI = (v: number | null | undefined) =>
  v == null ? '-' : `${Math.round(v).toLocaleString()}%`;
const k = (v: number) => `${Math.round(v / 1000).toLocaleString()}K`;

function figuresOf(
  queries: ExpenseQueries,
  unit: string,
  year: number,
  month: number,
  mode: ReportMode
): PeriodFigures {
  const cy = queries.getMonthlyTotal(unit, year, month, mode);
  const py = queries.getMonthlyTotal(unit, year - 1, month, mode);

  const ratio = cy ? calculateCostRatio(cy.amount, cy.sales) : null;
  const ratioPy = py ? calculateCostRatio(py.amount, py.sales) : null;

  return {
    expense: cy?.amount ?? 0,
    expensePy: py?.amount ?? 0,
    expenseYoy: calculateYoy(cy?.amount ?? null, py?.amount ?? null),
    sales: cy?.sales ?? 0,
    salesPy: py?.sales ?? 0,
    salesYoy: calculateYoy(cy?.sales ?? null, py?.sales ?? null),
    ratio,
    ratioPy,
    ratioDelta: ratio != null && ratioPy != null ? ratio - ratioPy : null,
    headcount: cy?.headcount ?? 0,
    headcountPy: py?.headcount ?? 0,
  };
}

/** 대분류가 비용률에 기여한 변화(%p) — 당기 비중 − 전년 비중 */
function contributionPp(
  amount: number,
  amountPy: number,
  sales: number,
  salesPy: number
): number | null {
  if (!sales || !salesPy) return null;
  return ((amount * VAT_FACTOR) / sales - (amountPy * VAT_FACTOR) / salesPy) * 100;
}

export function buildAiReport(queries: ExpenseQueries, opts: AiReportOptions): AiReport {
  const { year, month, mode, costType, plan } = opts;
  const corpUnit = CORPORATE_RETAIL_UNIT;
  const notes: string[] = [];

  const catsOf = (unit: string, y: number, m: ReportMode) =>
    new Map(
      queries.getMonthlyAggregatedByCategory(unit, y, month, m).map(c => [c.cost_lv1, c.amount])
    );

  // ── 법인 · 사업부별 (당월 + YTD) ─────────────────────────────────
  // %p 기여도는 전부 **법인 매출**을 분모로 쓴다 (원본 보고서와 동일)
  const buildUnit = (unit: string, corpSales: number, corpSalesPy: number): UnitReport => {
    const ytd = figuresOf(queries, unit, year, month, 'ytd');
    const cy = catsOf(unit, year, 'ytd');
    const py = catsOf(unit, year - 1, 'ytd');

    let maxItem: UnitReport['maxItem'] = null;
    for (const [category, amount] of cy) {
      const prev = py.get(category) ?? 0;
      const deltaPp = contributionPp(amount, prev, corpSales, corpSalesPy);
      if (deltaPp == null) continue;
      if (!maxItem || Math.abs(deltaPp) > Math.abs(maxItem.deltaPp ?? 0)) {
        maxItem = { category, deltaPp, amount };
      }
    }

    return {
      unit,
      monthly: figuresOf(queries, unit, year, month, 'monthly'),
      ytd,
      contribPp: contributionPp(ytd.expense, ytd.expensePy, corpSales, corpSalesPy),
      maxItem,
    };
  };

  const corpFigures = figuresOf(queries, corpUnit, year, month, 'ytd');
  const corpSales = corpFigures.sales;
  const corpSalesPy = corpFigures.salesPy;

  const corporate = buildUnit(corpUnit, corpSales, corpSalesPy);
  // 분석 표에 넣을 사업부 — 분석 대상에서 제외한 사업부(ANALYSIS_EXCLUDED_UNITS)와
  // 이 비용구분에 집행이 없는 사업부를 뺀다. 후자는 비용률이 0% 로 잡혀 순위를 왜곡한다.
  // 둘 다 **표시에서만** 빼며 법인 합계에는 그대로 들어간다.
  const units = queries.data.metadata.target_biz_units
    .filter(isAnalysisUnit)
    .map(u => buildUnit(u, corpSales, corpSalesPy))
    .filter(u => u.ytd.expense !== 0)
    .sort((a, b) => b.ytd.expense - a.ytd.expense);

  // ── 대분류별 (YTD) + 성격 분류 ───────────────────────────────────
  const cyCats = queries.getMonthlyAggregatedByCategory(corpUnit, year, month, 'ytd');
  const pyCats = catsOf(corpUnit, year - 1, 'ytd');
  const totalAbs = cyCats.reduce((s, c) => s + Math.abs(c.amount), 0);

  const unclassified: string[] = [];
  const categories: CategoryRow[] = cyCats
    .map(c => {
      const amountPy = pyCats.get(c.cost_lv1) ?? 0;
      const nature = COST_NATURE[c.cost_lv1];
      if (!nature) unclassified.push(c.cost_lv1);
      return {
        category: c.cost_lv1,
        nature: nature ?? '변동비',
        amount: c.amount,
        amountPy,
        delta: c.amount - amountPy,
        yoy: calculateYoy(c.amount, amountPy || null),
        share: totalAbs ? (Math.abs(c.amount) / totalAbs) * 100 : null,
        deltaPp: contributionPp(c.amount, amountPy, corporate.ytd.sales, corporate.ytd.salesPy),
      };
    })
    .sort((a, b) => b.amount - a.amount);

  if (unclassified.length > 0) {
    notes.push(
      `비용 성격(고정/준고정/변동)이 지정되지 않은 대분류를 변동비로 처리했습니다: ${[
        ...new Set(unclassified),
      ].join(', ')}`
    );
  }

  const natures: NatureRow[] = NATURES.map(nature => {
    const rows = categories.filter(c => c.nature === nature);
    const amount = rows.reduce((s, c) => s + c.amount, 0);
    const amountPy = rows.reduce((s, c) => s + c.amountPy, 0);
    return {
      nature,
      amount,
      amountPy,
      yoy: calculateYoy(amount, amountPy || null),
      share: totalAbs ? (Math.abs(amount) / totalAbs) * 100 : null,
      deltaPp: contributionPp(amount, amountPy, corporate.ytd.sales, corporate.ytd.salesPy),
    };
  }).filter(n => n.amount !== 0 || n.amountPy !== 0);

  // ── 광고비 브랜드별 ──────────────────────────────────────────────
  const hasAd = queries.hasCategory(AD_CATEGORY);
  const adByBrand: AdBrandRow[] = hasAd
    ? units.map(u => {
        const amount = catsOf(u.unit, year, 'ytd').get(AD_CATEGORY) ?? 0;
        const amountPy = catsOf(u.unit, year - 1, 'ytd').get(AD_CATEGORY) ?? 0;
        return {
          unit: u.unit,
          amount,
          amountPy,
          yoy: calculateYoy(amount, amountPy || null),
          adRatio: u.ytd.sales ? ((amount * VAT_FACTOR) / u.ytd.sales) * 100 : null,
          adRatioPy: u.ytd.salesPy ? ((amountPy * VAT_FACTOR) / u.ytd.salesPy) * 100 : null,
        };
      })
    : [];

  // ── 변동 원인 (사업부 × 대분류) ──────────────────────────────────
  const allChanges: TopChange[] = [];
  const driverGroups: DriverGroup[] = [];

  const pushChanges = (u: UnitReport, label: string) => {
    const cy = catsOf(u.unit, year, 'ytd');
    const py = catsOf(u.unit, year - 1, 'ytd');
    for (const [category, amount] of cy) {
      const prev = py.get(category) ?? 0;
      // 분모는 법인 매출 — 사업부끼리 같은 잣대로 비교해야 TOP3 가 의미를 갖는다
      const deltaPp = contributionPp(amount, prev, corpSales, corpSalesPy);
      if (deltaPp == null || deltaPp === 0) continue;
      allChanges.push({ unit: label, category, deltaPp, amount });
    }
  };
  pushChanges(corporate, '법인전체');
  for (const u of units) pushChanges(u, u.unit);

  for (const u of units) {
    const cy = catsOf(u.unit, year, 'ytd');
    const py = catsOf(u.unit, year - 1, 'ytd');

    const items: DriverItem[] = [];
    for (const [category, amount] of cy) {
      const prev = py.get(category) ?? 0;
      const delta = amount - prev;
      if (delta === 0) continue;
      items.push({ category, amount, amountPy: prev, delta, yoy: calculateYoy(amount, prev || null) });
    }

    // 금액이 미미한 변동은 뺀다 — 원인을 찾는 화면이라 노이즈가 해롭다
    const floor = (Math.abs(u.ytd.expense) * DRIVER_MIN_SHARE) / 100;
    const meaningful = items.filter(it => Math.abs(it.delta) >= floor);
    const d = u.ytd.ratioDelta;

    driverGroups.push({
      unit: u.unit,
      ratio: u.ytd.ratio,
      ratioDelta: d,
      verdict:
        d == null
          ? '보통'
          : d > VERDICT_PP
            ? '악화'
            : d < -VERDICT_PP
              ? u.ytd.salesYoy != null &&
                u.ytd.expenseYoy != null &&
                u.ytd.salesYoy > u.ytd.expenseYoy
                ? '매출효과'
                : '개선'
              : '보통',
      up: meaningful.filter(i => i.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, DRIVERS_PER_UNIT),
      down: meaningful.filter(i => i.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, DRIVERS_PER_UNIT),
    });
  }

  const top3 = allChanges.sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp)).slice(0, 3);

  // ── 리스크 ──────────────────────────────────────────────────────
  const risks: RiskRow[] = [];
  for (const u of units) {
    const cy = catsOf(u.unit, year, 'ytd');
    const py = catsOf(u.unit, year - 1, 'ytd');
    for (const [category, amount] of cy) {
      const prev = py.get(category) ?? 0;
      const yoy = calculateYoy(amount, prev || null);
      if (yoy == null || yoy < RISK_MID_YOY) continue;
      const share = totalAbs ? (Math.abs(amount) / totalAbs) * 100 : 0;
      if (share < RISK_MIN_SHARE) continue;
      risks.push({
        unit: u.unit,
        category,
        amount,
        yoy,
        level: yoy >= RISK_HIGH_YOY ? '높음' : '중간',
        reason:
          yoy >= RISK_HIGH_YOY
            ? `전년 대비 ${Math.round(yoy)}% — 일시적 요인인지 구조적 증가인지 확인 필요`
            : `전년 대비 ${Math.round(yoy)}% — 매출 성장과의 연동성 점검`,
      });
    }
  }
  risks.sort((a, b) => b.yoy - a.yoy);

  // ── 광고 효율 ───────────────────────────────────────────────────
  let adEfficiency: AdEfficiency | null = null;
  if (!hasAd) {
    notes.push(`대분류 '${AD_CATEGORY}' 가 없어 광고 효율을 산출하지 않았습니다.`);
  } else {
    const pts = queries
      .getAdSalesAnalysisData(corpUnit, year)
      .filter(p => p.month <= month)
      .map(p => ({ adSpend: p.adSpend, sales: p.sales }));

    if (pts.length === 0) {
      notes.push('광고비 또는 매출이 있는 달이 없어 광고 효율을 산출하지 못했습니다.');
    } else {
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      const roas = mean(pts.map(p => calculateROAS(p.sales, p.adSpend)));
      const roi = mean(pts.map(p => calculateROI(p.sales, p.adSpend)));
      const correlation =
        pts.length >= 2 ? calculateCorrelation(pts.map(p => p.adSpend), pts.map(p => p.sales)) : 0;
      const optimal = findOptimalAdSpendRange(pts).optimal;
      adEfficiency = {
        months: pts.length,
        roi,
        roas,
        correlation,
        grade: calculateEfficiencyGrade(correlation, roas).grade,
        optimalRange: optimal.range,
        optimalRoas: optimal.avgROAS,
      };
    }
  }

  if (corporate.ytd.sales === 0) {
    notes.push('매출 데이터가 없어 비용률·광고 효율 지표가 비어 있습니다.');
  }

  // ── ② 종합 스코어 ───────────────────────────────────────────────
  //
  // 배점은 원본 보고서와 동일: 추세 35 / 수준 30 / 광고비율 20 / 계획집행 15.
  // 대입되는 값은 전부 실데이터고, 계획이 없으면 그 항목을 빼고 나머지로 환산한다.
  /** 계획 파일에는 '법인' 행이 없다 — 사업부를 더해서 만든다 */
  const planUnitsFor = (unit: string): string[] =>
    unit === corpUnit ? Object.keys(plan?.total ?? {}) : [unit];

  const planOf = (unit: string, upTo: number, category?: string): number | null => {
    if (!plan) return null;
    let sum = 0;
    let found = false;
    for (const u of planUnitsFor(unit)) {
      const src = category ? plan.data[u]?.[category] : plan.total[u];
      if (!src) continue;
      for (const [ym, v] of Object.entries(src)) {
        const [y, m] = ym.split('-').map(Number);
        if (y !== year || m > upTo) continue;
        sum += v;
        found = true;
      }
    }
    return found ? sum : null;
  };

  /** 기준 브랜드 — 비용률이 가장 낮은(효율이 좋은) 사업부를 '수준' 비교 기준으로 삼는다 */
  const baseUnit = units
    .filter(u => u.ytd.ratio != null && u.ytd.ratio > 0)
    .sort((a, b) => a.ytd.ratio! - b.ytd.ratio!)[0];

  const gradeOfScore = (s: number): { grade: ScoreCard['grade']; label: ScoreCard['label'] } =>
    s >= 80
      ? { grade: 'A', label: '우수' }
      : s >= 60
        ? { grade: 'B', label: '양호' }
        : s >= 40
          ? { grade: 'C', label: '주의' }
          : { grade: 'D', label: '경보' };

  const buildScore = (u: UnitReport, label: string): ScoreCard => {
    const items: ScoreItem[] = [];

    // 추세 35 — 비용률이 나빠질수록 감점
    const d = u.ytd.ratioDelta;
    items.push({
      key: '추세',
      max: 35,
      score:
        d == null ? 0 : Math.max(0, Math.min(35, Math.round(35 - Math.max(0, d) * 40))),
      note: d == null ? '비교 불가' : `YoY ${d >= 0 ? '+' : ''}${d.toFixed(2)}%p`,
    });

    // 수준 30 — 기준 브랜드 대비 비용률 격차
    const gap =
      u.ytd.ratio != null && baseUnit?.ytd.ratio != null ? u.ytd.ratio - baseUnit.ytd.ratio : null;
    items.push({
      key: '수준',
      max: 30,
      score: gap == null ? 0 : Math.max(0, Math.min(30, Math.round(30 - gap * 3))),
      note:
        baseUnit && u.unit === baseUnit.unit
          ? `${u.unit} 기준 브랜드`
          : gap == null
            ? '비교 불가'
            : `${baseUnit?.unit} 대비 ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%p`,
    });

    // 광고비율 20 — 매출 대비 광고비 비중
    const ad = adByBrand.find(a => a.unit === u.unit);
    const corpAd = cyCats.find(c => c.cost_lv1 === AD_CATEGORY)?.amount ?? 0;
    const useAdRatio =
      u.unit === corpUnit
        ? hasAd && corporate.ytd.sales
          ? ((corpAd * VAT_FACTOR) / corporate.ytd.sales) * 100
          : null
        : (ad?.adRatio ?? null);
    items.push({
      key: '광고비율',
      max: 20,
      score:
        useAdRatio == null ? 0 : Math.max(0, Math.min(20, Math.round(20 - useAdRatio * 2))),
      note:
        useAdRatio == null
          ? '광고비 없음'
          : `${useAdRatio.toFixed(1)}%${ad?.adRatioPy != null && u.unit !== corpUnit ? ` (전년 ${ad.adRatioPy.toFixed(1)}%)` : ''}`,
    });

    // 계획집행 15 — 계획 대비 집행률이 100% 근처면 만점
    const planAmount = planOf(u.unit, month);
    const planPct = planAmount ? (u.ytd.expense / planAmount) * 100 : null;
    items.push({
      key: '계획집행',
      max: 15,
      score:
        planPct == null ? 0 : Math.max(0, Math.min(15, Math.round(15 - Math.abs(planPct - 100) / 4))),
      note:
        planPct == null
          ? '계획 없음'
          : `계획비 ${Math.round(planPct)}% (${planPct <= 105 ? '정상' : '초과'})`,
    });

    const usable = items.filter(i => i.note !== '비교 불가' && i.note !== '계획 없음' && i.note !== '광고비 없음');
    const maxSum = usable.reduce((s, i) => s + i.max, 0);
    const total = maxSum
      ? Math.round((usable.reduce((s, i) => s + i.score, 0) / maxSum) * 100)
      : 0;

    return {
      unit: label,
      ...gradeOfScore(total),
      total,
      items,
      ratio: u.ytd.ratio,
      ratioDelta: u.ytd.ratioDelta,
    };
  };

  const scoreCards: ScoreCard[] = [
    buildScore(corporate, '법인전체'),
    ...units.filter(u => u.ytd.ratio != null).map(u => buildScore(u, u.unit)),
  ];

  // ── ③ 체크포인트 ────────────────────────────────────────────────
  const buildCheckpoint = (u: UnitReport, label: string): Checkpoint => {
    const items: Checkpoint['items'] = [];
    const cy = catsOf(u.unit, year, 'ytd');
    const py = catsOf(u.unit, year - 1, 'ytd');

    // 비용률 기여가 가장 큰 대분류
    if (u.maxItem && u.maxItem.deltaPp != null) {
      const prevShare =
        u.ytd.salesPy && py.get(u.maxItem.category)
          ? ((py.get(u.maxItem.category)! * VAT_FACTOR) / u.ytd.salesPy) * 100
          : null;
      const curShare = u.ytd.sales ? ((u.maxItem.amount * VAT_FACTOR) / u.ytd.sales) * 100 : null;
      const rising = u.maxItem.deltaPp > 0;
      items.push({
        icon: rising ? '📊 추적' : '▸ 안정',
        title: `${u.maxItem.category} — ${prevShare?.toFixed(2) ?? '-'}%→${curShare?.toFixed(2) ?? '-'}%`,
        delta: `(${u.maxItem.deltaPp >= 0 ? '+' : ''}${u.maxItem.deltaPp.toFixed(2)}%p)`,
        detail: `당해 ${k(u.maxItem.amount)} 발생. ${rising ? '상승 — 추세 안정성 점검' : '전년 대비 안정적 유지'}`,
        tone: rising ? 'info' : 'flat',
      });
    }

    // 계획 초과 대분류
    if (plan) {
      let worstPlan: { category: string; actual: number; planned: number; pct: number } | null = null;
      for (const [category, amount] of cy) {
        const planned = planOf(u.unit, month, category);
        if (!planned) continue;
        const pct = (amount / planned) * 100;
        if (pct <= 110) continue;
        if (!worstPlan || pct > worstPlan.pct) {
          worstPlan = { category, actual: amount, planned, pct };
        }
      }
      if (worstPlan) {
        items.push({
          icon: '🟡 계획비',
          title: `${worstPlan.category} 계획비 ${Math.round(worstPlan.pct)}% — 실적 ${k(worstPlan.actual)} / 계획 ${k(worstPlan.planned)}`,
          delta: `(+${Math.round(worstPlan.pct - 100)}%p)`,
          detail: `당해 ${k(worstPlan.actual)} 발생. 계획 초과 — 원인 점검 및 잔여 분기 집행 조정`,
          tone: 'warn',
        });
      }
    }

    const d = u.ytd.ratioDelta;
    return {
      unit: label,
      signal: d == null ? '🟡' : d > 0.3 ? '🔴' : d > 0 ? '🟡' : '🟢',
      items,
    };
  };

  const checkpoints: Checkpoint[] = [
    buildCheckpoint(corporate, '법인전체'),
    ...units.filter(u => u.ytd.ratio != null).map(u => buildCheckpoint(u, u.unit)),
  ].filter(c => c.items.length > 0);

  if (!plan) {
    notes.push('계획(예산) 데이터가 없어 계획집행 점수·계획비 체크포인트를 생략했습니다.');
  } else if (plan.metadata.unmappedCategories.length > 0) {
    notes.push(
      `계획서에만 있는 대분류는 사업부 총액에만 반영했습니다: ${plan.metadata.unmappedCategories.join(', ')}`
    );
  }

  // ── 상세 분석 표 (A/B/C 블록) ────────────────────────────────────
  const planYearOf = (unit: string, category?: string): number | null => {
    if (!plan) return null;
    let sum = 0;
    let found = false;
    for (const u of planUnitsFor(unit)) {
      const src = category ? plan.data[u]?.[category] : plan.total[u];
      if (!src) continue;
      for (const [ym, v] of Object.entries(src)) {
        if (!ym.startsWith(String(year))) continue;
        sum += v;
        found = true;
      }
    }
    return found ? sum : null;
  };

  /** 계획 대비 판정 — 원본과 같은 임계값 */
  const verdictOf = (yoy: number | null, planPct: number | null): string => {
    if (planPct != null && planPct > 130) return '계획 대폭 초과';
    if (planPct != null && planPct > 110) return '계획 초과';
    if (yoy != null && yoy >= 150) return '급증 — 원인 점검';
    if (yoy != null && yoy >= 120) return '증가 — 추세 확인';
    if (yoy != null && yoy < 90) return '절감';
    return '정상';
  };

  const detailOf = (unit: string, label: string, category?: string): DetailRow => {
    const amountAt = (y: number, m: ReportMode) =>
      category
        ? (catsOf(unit, y, m).get(category) ?? 0)
        : (queries.getMonthlyTotal(unit, y, month, m)?.amount ?? 0);

    const monthPy = amountAt(year - 1, 'monthly');
    const monthCy = amountAt(year, 'monthly');
    const ytdPy = amountAt(year - 1, 'ytd');
    const ytdCy = amountAt(year, 'ytd');
    const planYtd = planOf(unit, month, category);
    const planYear = planYearOf(unit, category);
    const planPct = planYtd ? (ytdCy / planYtd) * 100 : null;
    const ytdYoy = calculateYoy(ytdCy, ytdPy || null);

    return {
      label,
      monthPy,
      monthCy,
      monthYoy: calculateYoy(monthCy, monthPy || null),
      ytdPy,
      ytdCy,
      ytdYoy,
      planYtd,
      planPct,
      usagePct: planYear ? (ytdCy / planYear) * 100 : null,
      planYear,
      verdict: verdictOf(ytdYoy, planPct),
    };
  };

  const scored = units;

  // A-1. 인당 인건비
  const perCapitaRows: PerCapitaRow[] = [];
  if (queries.hasCategory(LABOR_CATEGORY)) {
    const rowOf = (u: UnitReport, label: string): PerCapitaRow | null => {
      const cyAmt = catsOf(u.unit, year, 'ytd').get(LABOR_CATEGORY) ?? 0;
      const pyAmt = catsOf(u.unit, year - 1, 'ytd').get(LABOR_CATEGORY) ?? 0;
      const cy = u.ytd.headcount ? cyAmt / u.ytd.headcount / 1000 : null;
      const py = u.ytd.headcountPy ? pyAmt / u.ytd.headcountPy / 1000 : null;
      if (cy == null && py == null) return null;
      const yoy = cy != null && py ? (cy / py) * 100 : null;
      return {
        label,
        py,
        cy,
        diff: cy != null && py != null ? cy - py : null,
        yoy,
        note:
          yoy == null
            ? '비교 불가'
            : yoy >= 110
              ? '상승 — 인당 생산성 관리 필요'
              : yoy >= 95
                ? '연봉 인상 범위 내 정상'
                : '압축 — 인력 공백·이탈 점검',
      };
    };
    const corpRow = rowOf(corporate, `법인전체 인당 ${LABOR_CATEGORY}`);
    if (corpRow) perCapitaRows.push(corpRow);
    for (const u of scored) {
      const r = rowOf(u, `${u.unit} 인당 ${LABOR_CATEGORY}`);
      if (r) perCapitaRows.push(r);
    }
  }

  // A-2. 인건비 총액 / B. 광고비 / A. 전사 비용률 / B. 항목별
  const laborDetail: DetailRow[] = queries.hasCategory(LABOR_CATEGORY)
    ? [
        detailOf(corpUnit, `법인전체 ${LABOR_CATEGORY}`, LABOR_CATEGORY),
        ...scored.map(u => detailOf(u.unit, `${u.unit} ${LABOR_CATEGORY}`, LABOR_CATEGORY)),
      ]
    : [];

  const adDetail: DetailRow[] = hasAd
    ? [
        detailOf(corpUnit, `법인전체 ${AD_CATEGORY}`, AD_CATEGORY),
        ...scored.map(u => detailOf(u.unit, `${u.unit} ${AD_CATEGORY}`, AD_CATEGORY)),
      ]
    : [];

  const corpDetail: DetailRow[] = [
    detailOf(corpUnit, '법인전체 총비용'),
    ...scored.map(u => detailOf(u.unit, `${u.unit} 총비용`)),
  ];

  const categoryDetail: DetailRow[] = categories.map(c =>
    detailOf(corpUnit, c.category, c.category)
  );

  // C. 브랜드별 효율성 비교
  const avgHeadcountOf = (unit: string, y: number): number => {
    const rows = queries
      .getMonthlyTrend(unit, y, 'monthly')
      .filter(r => r.month <= month && r.headcount > 0);
    return rows.length ? Math.round(rows.reduce((s, r) => s + r.headcount, 0) / rows.length) : 0;
  };

  const efficiency: EfficiencyRow[] = scored.map(u => {
    const salesPerHead = u.ytd.headcount ? u.ytd.sales / u.ytd.headcount : null;
    const d = u.ytd.ratioDelta;
    return {
      unit: u.unit,
      sales: u.ytd.sales,
      salesYoy: u.ytd.salesYoy,
      expense: u.ytd.expense,
      expenseYoy: u.ytd.expenseYoy,
      ratio: u.ytd.ratio,
      ratioPy: u.ytd.ratioPy,
      headcountEnd: u.ytd.headcount,
      headcountAvg: avgHeadcountOf(u.unit, year),
      salesPerHead,
      verdict:
        u.ytd.ratio != null && u.ytd.ratio > 100
          ? '투자 단계 — 적자 구조'
          : d == null
            ? '판정 불가'
            : d > 0.3
              ? '주의 — 비용률 악화'
              : d < -0.3
                ? '개선'
                : '정상',
    };
  });

  // ⑦ 사업부별 비용 구조
  const natureByUnit: NatureByUnitRow[] = [];
  for (const u of scored) {
    const cy = catsOf(u.unit, year, 'ytd');
    const py = catsOf(u.unit, year - 1, 'ytd');
    const unitTotal = [...cy.values()].reduce((s, v) => s + Math.abs(v), 0);
    for (const nature of NATURES) {
      let amount = 0;
      let amountPy = 0;
      for (const [category, v] of cy) {
        if ((COST_NATURE[category] ?? '변동비') !== nature) continue;
        amount += v;
        amountPy += py.get(category) ?? 0;
      }
      if (amount === 0 && amountPy === 0) continue;
      const yoy = calculateYoy(amount, amountPy || null);
      natureByUnit.push({
        unit: u.unit,
        nature,
        amount,
        amountPy,
        yoy,
        share: unitTotal ? (Math.abs(amount) / unitTotal) * 100 : null,
        note:
          nature === '고정비'
            ? yoy != null && yoy >= 115
              ? '구조적 증가 — 인력·계약 조건 점검'
              : '구조 안정'
            : nature === '변동비'
              ? yoy != null && yoy >= 120
                ? '집행 확대 — 매출 연동성 확인'
                : '매출 연동 범위'
              : yoy != null && yoy >= 120
                ? '증가 — 항목 점검'
                : '안정',
      });
    }
  }

  // ── 상단 3카드 ──────────────────────────────────────────────────
  const ratioDeltaPp = corporate.ytd.ratioDelta;
  // 주목 브랜드·가장 큰 변동은 **법인 기여도** 로 고른다 (자기 비용률 변화로 고르면
  // 매출이 급증한 사업부가 −수십 %p 로 순위를 독차지한다)
  const withContrib = units.filter(u => u.contribPp != null);
  const worst = [...withContrib].sort((a, b) => b.contribPp! - a.contribPp!)[0] ?? null;
  const best = [...withContrib].sort((a, b) => a.contribPp! - b.contribPp!)[0] ?? null;
  const leadNature = natures
    .filter(n => n.deltaPp != null)
    .sort((a, b) => Math.abs(b.deltaPp!) - Math.abs(a.deltaPp!))[0];
  const biggestMover = [...withContrib].sort(
    (a, b) => Math.abs(b.contribPp!) - Math.abs(a.contribPp!)
  )[0];

  const topSummary: AiReport['topSummary'] = {
    ratioDeltaPp,
    verdict:
      ratioDeltaPp == null || Math.abs(ratioDeltaPp) < FLAT_PP
        ? '보합'
        : ratioDeltaPp > 0
          ? '전반적 악화'
          : '전반적 개선',
    leadNature: leadNature ? { nature: leadNature.nature, deltaPp: leadNature.deltaPp! } : null,
    biggestMover: biggestMover ? { unit: biggestMover.unit, deltaPp: biggestMover.contribPp! } : null,
    worst,
    best,
    top3,
  };

  // ── EXECUTIVE SUMMARY ───────────────────────────────────────────
  const execSummary: string[] = [];
  const c = corporate;
  if (c.ytd.expenseYoy != null && c.ytd.salesYoy != null) {
    execSummary.push(
      `법인 YTD 총비용 ${k(c.ytd.expense)} (YOY ${pctI(c.ytd.expenseYoy)}), 매출 ${k(c.ytd.sales)} (YOY ${pctI(c.ytd.salesYoy)}) — ` +
        (c.ytd.expenseYoy > c.ytd.salesYoy
          ? `비용 증가율이 매출 증가율을 상회하여 비용률 악화 (YTD ${c.ytd.ratioPy?.toFixed(2)}% → ${c.ytd.ratio?.toFixed(2)}%, 당월 ${c.monthly.ratioPy?.toFixed(2)}% → ${c.monthly.ratio?.toFixed(2)}%)`
          : `비용 증가율이 매출 증가율을 밑돌아 비용률 개선 (YTD ${c.ytd.ratioPy?.toFixed(2)}% → ${c.ytd.ratio?.toFixed(2)}%)`)
    );
  }
  const laborRow = categories.find(r => r.category === '급여');
  if (laborRow && c.ytd.headcount) {
    const perCapita = laborRow.amount / c.ytd.headcount;
    const perCapitaPy = c.ytd.headcountPy ? laborRow.amountPy / c.ytd.headcountPy : null;
    execSummary.push(
      `YTD ${laborRow.category} ${k(laborRow.amount)} (YOY ${pctI(laborRow.yoy)}), 인당 ${(perCapita / 1000).toFixed(1)}K` +
        (perCapitaPy
          ? ` (전년 ${(perCapitaPy / 1000).toFixed(1)}K, YOY ${pctI((perCapita / perCapitaPy) * 100)})`
          : '')
    );
  }
  const topAd = adByBrand.filter(a => a.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  if (topAd) {
    execSummary.push(
      `${topAd.unit} YTD 광고비 ${k(topAd.amount)} (YOY ${pctI(topAd.yoy)}), 매출 대비 광고비율 ${topAd.adRatio?.toFixed(1) ?? '-'}% (전년 ${topAd.adRatioPy?.toFixed(1) ?? '-'}%)`
    );
  }
  for (const r of risks.filter(r => r.level === '높음').slice(0, 2)) {
    execSummary.push(
      `${r.unit} YTD ${r.category} ${k(r.amount)} (YOY ${pctI(r.yoy)}) — ${r.reason}`
    );
  }
  const growth = units
    .filter(u => u.ytd.salesYoy != null && u.ytd.salesYoy > 150)
    .sort((a, b) => b.ytd.salesYoy! - a.ytd.salesYoy!)[0];
  if (growth) {
    execSummary.push(
      `${growth.unit} YTD 매출 ${k(growth.ytd.sales)} (YOY ${pctI(growth.ytd.salesYoy)}) 급성장 중이나 비용률 ${growth.ytd.ratio?.toFixed(1) ?? '-'}% — 투자 단계 구조`
    );
  }

  // ── 인사이트 ────────────────────────────────────────────────────
  const insights: string[] = [];
  if (worst && (worst.ytd.ratioDelta ?? 0) > 0) {
    insights.push(
      `비용률이 가장 많이 나빠진 사업부는 ${worst.unit} (${worst.ytd.ratioPy!.toFixed(1)}% → ${worst.ytd.ratio!.toFixed(1)}%, ${worst.ytd.ratioDelta!.toFixed(2)}%p).`
    );
  }
  if (best && (best.ytd.ratioDelta ?? 0) < 0) {
    insights.push(
      `${best.unit} 은 비용률이 ${Math.abs(best.ytd.ratioDelta!).toFixed(2)}%p 개선됐습니다.`
    );
  }
  if (adEfficiency) {
    insights.push(
      `광고 효율 등급 ${adEfficiency.grade} — ROI ${Math.round(adEfficiency.roi).toLocaleString()}%, 평균 ROAS ${adEfficiency.roas.toFixed(2)}, 상관 ${adEfficiency.correlation.toFixed(2)} (${adEfficiency.months}개월). 최적 집행구간 ${adEfficiency.optimalRange}.`
    );
  }
  if (risks.length > 0) {
    const high = risks.filter(r => r.level === '높음');
    insights.push(
      high.length > 0
        ? `전년비 ${RISK_HIGH_YOY}% 이상 급증 항목 ${high.length}건 — ${high.slice(0, 3).map(r => `${r.unit} ${r.category}`).join(', ')}.`
        : `전년비 ${RISK_MID_YOY}% 이상 증가 항목 ${risks.length}건.`
    );
  }

  return {
    meta: {
      year,
      month,
      mode,
      costType,
      title: `${year}년 중국법인 ${costType} 구조진단 보고서`,
      periodLabel: `${year}년 ${month}월 (당월) · YTD 동반 분석`,
      ratioFormula: `비용률 = 비용 × ${VAT_FACTOR} / 리테일 매출`,
      generatedAt: new Date().toISOString(),
    },
    topSummary,
    execSummary,
    scoreCards,
    checkpoints,
    corporate,
    units,
    categories,
    natures,
    adByBrand,
    driverGroups,
    risks,
    adEfficiency,
    natureByUnit,
    perCapitaRows,
    laborDetail,
    adDetail,
    corpDetail,
    categoryDetail,
    efficiency,
    insights,
    notes,
  };
}
