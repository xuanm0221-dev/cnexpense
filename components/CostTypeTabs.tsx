'use client';

/**
 * 직접비/영업비 탭
 * 반응형: md 미만 — 행당 세로 스택 + 소라벨, 글자·패딩 축소 / md 이상 — 4열 표
 */

import { useMemo, useState } from 'react';
import {
  CategoryData,
  CostBasis,
  CostType,
  GlBreakdownByCategory,
  ViewMode,
  MonthlyAmounts,
  WelfareBreakdownSide,
} from '@/lib/types';
import {
  getSortedCategories,
  getSortedFinancialCategories,
  calculateYTD,
  getAmountForMonth,
  calculateYoY,
  yoYDeltaToIndexPercent,
} from '@/lib/calculations';
import {
  formatAmount,
  formatDelta,
  toThousandCNY,
  yoyIndex,
} from '@/utils/formatters';
import type { Currency, ExchangeRateData } from '@/lib/exchange-rates';
import { fromMonthly, periodCny, periodValue, type Period } from '@/lib/period';
import { buildSubTree, shortSubLabel, sortSubLabels, type SubNode, type SubLevels } from '@/lib/account-analysis';

const SALARY_SUB_LABELS = ['기본급', '성과급', 'Red Pack', '외주/PT', '퇴직급여', '미정'] as const;

const WELFARE_L2_ORDER = ['보험/공적금', '주재원', '현지직원'] as const;

/**
 * 컬럼 폭 — 첫 컬럼(대분류/연결계정과목)이 두 줄로 접히지 않도록 넉넉히 잡는다.
 * 기본 5열(대분류·금액·전년금액·YOY금액·YoY), 계획이 붙으면 7열.
 */
const GRID_COLS_WITH_PREV = 'md:grid-cols-[minmax(6.5rem,1.6fr)_1fr_1fr_1fr_0.85fr]';
const GRID_COLS_BASE = 'md:grid-cols-[minmax(6rem,1.5fr)_1fr_1fr_0.85fr]';
/**
 * 연간계획·진척률까지 보이는 배치 (관리식 + 누적(YTD) 일 때만).
 * 컬럼이 늘어난 만큼 대분류 칸을 줄여 좌우가 자동으로 맞춰지게 fr 로 잡는다.
 */
/** 실적(YoY)과 계획 구간을 가르는 세로선 — 성격이 다른 두 묶음이라 눈으로 끊어준다 */
const PLAN_DIVIDER = 'md:border-l md:border-slate-300 md:pl-2 lg:pl-3';

const GRID_COLS_WITH_PLAN = 'md:grid-cols-[minmax(5.5rem,1.35fr)_1fr_1fr_0.8fr_1fr_0.8fr]';
/** 전년금액 + 계획까지 다 붙은 7열 */
const GRID_COLS_WITH_PREV_PLAN =
  'md:grid-cols-[minmax(4.5rem,1.1fr)_1fr_1fr_1fr_0.7fr_1fr_0.7fr]';

/** 컬럼 구성에 맞는 그리드 */
const gridColsFor = (withPrev: boolean, withPlan: boolean) =>
  withPrev && withPlan
    ? GRID_COLS_WITH_PREV_PLAN
    : withPrev
      ? GRID_COLS_WITH_PREV
      : withPlan
        ? GRID_COLS_WITH_PLAN
        : GRID_COLS_BASE;

/** 모바일: 세로 스택 / 데스크톱: 그리드 */
const rowGridClassFor = (withPrev: boolean, withPlan = false) =>
  `p-2 sm:p-3 space-y-1.5 sm:space-y-2 md:space-y-0 md:grid ${gridColsFor(
    withPrev,
    withPlan
  )} md:gap-2 lg:gap-3 md:items-center hover:bg-slate-50/70 transition-colors text-xs sm:text-sm`;

/** 금액 칸 — 데스크톱에서 숫자가 줄바꿈돼 두 줄로 밀리지 않게 nowrap */
const metricCellClass =
  'flex justify-between items-baseline gap-2 md:block md:text-right md:whitespace-nowrap tabular-nums';

const subRowGridClass =
  'p-2 sm:p-3 space-y-1.5 sm:space-y-2 md:space-y-0 md:grid md:grid-cols-4 md:gap-3 lg:gap-4 md:items-center text-[11px] sm:text-xs md:text-sm border-b border-dotted border-slate-200/80';

/** 재무식 GL/조정 하위행 — 상위 행과 같은 컬럼 폭 */
const financialSubRowClass =
  `p-2 sm:p-3 space-y-1.5 sm:space-y-2 md:space-y-0 md:grid ${GRID_COLS_WITH_PREV} md:gap-2 lg:gap-3 md:items-center text-[11px] sm:text-xs md:text-sm border-b border-dotted border-slate-200/80`;

/** 조정분개 하위행 라벨 (전처리에서 부여) */
const ADJUSTMENT_PKG_LABEL = '조정';

function mergeSalarySide(
  a: Record<string, MonthlyAmounts> | undefined,
  b: Record<string, MonthlyAmounts> | undefined,
  labels: readonly string[],
): Record<string, MonthlyAmounts> {
  const out: Record<string, MonthlyAmounts> = {};
  for (const label of labels) {
    const da = a?.[label];
    const db = b?.[label];
    if (!da && !db) continue;
    const months = new Set([...Object.keys(da || {}), ...Object.keys(db || {})]);
    const merged: MonthlyAmounts = {};
    months.forEach((m) => {
      merged[m] = (da?.[m] || 0) + (db?.[m] || 0);
    });
    out[label] = merged;
  }
  return out;
}

function amountForPeriod(
  monthly: MonthlyAmounts | undefined,
  selectedMonth: string,
  isYTD: boolean,
): number {
  if (!monthly) return 0;
  return isYTD ? calculateYTD(monthly, selectedMonth) : getAmountForMonth(monthly, selectedMonth);
}

function formatPerPersonThousandCny(amountCny: number): string {
  return `${Number((amountCny / 1000).toFixed(1)).toLocaleString('en-US')}K/인`;
}

function mergeMonthlyAmounts(
  a: MonthlyAmounts | undefined,
  b: MonthlyAmounts | undefined,
): MonthlyAmounts {
  const out: MonthlyAmounts = {};
  const months = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  months.forEach((m) => {
    out[m] = (a?.[m] || 0) + (b?.[m] || 0);
  });
  return out;
}

function mergeWelfareBreakdownSides(
  a: WelfareBreakdownSide | undefined,
  b: WelfareBreakdownSide | undefined,
): WelfareBreakdownSide | null {
  if (!a && !b) return null;
  const 중분류: Record<string, MonthlyAmounts> = {};
  for (const k of WELFARE_L2_ORDER) {
    const merged = mergeMonthlyAmounts(a?.중분류?.[k], b?.중분류?.[k]);
    if (Object.keys(merged).length > 0) {
      중분류[k] = merged;
    }
  }
  const l3Keys = new Set([
    ...Object.keys(a?.현지직원세부 || {}),
    ...Object.keys(b?.현지직원세부 || {}),
  ]);
  const 현지직원세부: Record<string, MonthlyAmounts> = {};
  l3Keys.forEach((k) => {
    const merged = mergeMonthlyAmounts(a?.현지직원세부?.[k], b?.현지직원세부?.[k]);
    if (Object.keys(merged).length > 0) {
      현지직원세부[k] = merged;
    }
  });
  return { 중분류, 현지직원세부 };
}

interface CostTypeTabsProps {
  directCosts: CategoryData;
  operatingCosts: CategoryData;
  salarySub?: {
    직접비: Record<string, MonthlyAmounts>;
    영업비: Record<string, MonthlyAmounts>;
  };
  selectedMonth: string;
  viewMode: ViewMode;
  color: string;
  activeTab?: CostType;
  onTabChange?: (tab: CostType) => void;
  /** 상위 제어 시 모든 카드 급여 중분류 토글 동기화 */
  salarySubExpanded?: boolean;
  onSalarySubExpandedChange?: (open: boolean) => void;
  /** 급여·복리 중분류 '인당' 분모 (당월 스냅샷 또는 YTD 월별 인원 합) */
  salaryPerPersonDenominator?: number;
  /** 전년 동기간 인원 — 하위 행 '전년 인당' 분모 */
  salaryPerPersonDenominatorPrev?: number;
  welfareSub?: {
    직접비: WelfareBreakdownSide;
    영업비: WelfareBreakdownSide;
  };
  welfareSubExpanded?: boolean;
  onWelfareSubExpandedChange?: (open: boolean) => void;
  /** 집계 기준. '재무식'이면 직접비/영업비 탭 없이 연결계정과목 표만 표시 */
  costBasis?: CostBasis;
  /** 재무식 데이터 (연결계정과목 → 월별 금액) */
  financialCosts?: CategoryData;
  /** 재무식 하위 분해 (연결계정과목 → pkg 계정과목 / '조정') */
  financialPkg?: GlBreakdownByCategory;
  /**
   * 관리식 하위 구성 (대분류 → 구성 → 월별). 1차는 G/L 계정,
   * 적요 보정이 필요한 곳만 전처리에서 다른 라벨이 붙는다.
   */
  subLevels?: SubLevels;
  /** 전년이 적요 추정으로 채워진 대분류 — '추정' 표시용 */
  estimatedCategories?: Set<string>;
  /**
   * 연간 계획 (대분류 → 연간 금액, 위안).
   * 관리식 + 누적(YTD) 일 때만 `연간계획 · 진척률` 컬럼을 붙인다.
   * 당월·분기는 연간 계획과 견줄 기간이 아니라 표시하지 않는다.
   */
  annualPlan?: Record<string, number> | null;
  /** 표시 통화 및 환율 (KRW는 재무식에서만) */
  currency?: Currency;
  exchangeRates?: ExchangeRateData | null;
  /** 조회 기간 (당월/누적/분기) 과 전년 동기간 */
  period: Period;
  prevPeriod: Period;
}

export default function CostTypeTabs({
  directCosts,
  operatingCosts,
  salarySub,
  selectedMonth,
  viewMode,
  color,
  activeTab: externalActiveTab,
  onTabChange,
  salarySubExpanded: externalSalarySubExpanded,
  onSalarySubExpandedChange,
  salaryPerPersonDenominator = 0,
  salaryPerPersonDenominatorPrev = 0,
  welfareSub,
  welfareSubExpanded: externalWelfareSubExpanded,
  onWelfareSubExpandedChange,
  costBasis = '관리식',
  financialCosts,
  financialPkg,
  subLevels,
  estimatedCategories,
  annualPlan,
  currency = 'CNY',
  exchangeRates = null,
  period,
  prevPeriod,
}: CostTypeTabsProps) {
  const isFinancial = costBasis === '재무식';
  /** 전년 금액 컬럼 — 관리식·재무식 모두 표시 (YoY 지수만으론 규모를 못 읽는다) */
  const withPrevColumn = true;
  /** 하위 구성 정렬·표시 판단에 쓸 월 (조회 기간 기준) */
  const subMonths = useMemo(() => {
    if (period.months.length > 0) return period.months;
    if (viewMode === '누적(YTD)') {
      const [y, mm] = (selectedMonth || '').split('-');
      const end = parseInt(mm || '0', 10);
      return Array.from({ length: end }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    }
    return [period.endMonth];
  }, [period, viewMode, selectedMonth]);
  const hasDirectCosts = Object.keys(directCosts).length > 0;
  const hasOperatingCosts = Object.keys(operatingCosts).length > 0;

  const [internalActiveTab, setInternalActiveTab] = useState<CostType>('전체');
  const [internalSalaryExpanded, setInternalSalaryExpanded] = useState(false);
  const [internalWelfareExpanded, setInternalWelfareExpanded] = useState(false);
  /** 재무식: 연결계정과목별 GL/조정 펼침 */
  const [financialExpanded, setFinancialExpanded] = useState<Set<string>>(() => new Set());
  const toggleFinancialExpanded = (category: string) =>
    setFinancialExpanded(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  /**
   * 연결계정과목 하위 = pkg 계정과목들 + 조정.
   * 금액 큰 순으로 정렬하고 '조정'은 항상 마지막.
   */
  const financialSplitOf = (category: string) => {
    const pkgMap = financialPkg?.[category];
    if (!pkgMap) return [];
    return Object.entries(pkgMap)
      .map(([label, monthly]) => ({
        label,
        monthly,
        amount: periodValue(fromMonthly(monthly), period, currency, exchangeRates),
      }))
      .filter(r => r.amount !== 0)
      .sort((a, b) => {
        const aAdj = a.label === ADJUSTMENT_PKG_LABEL;
        const bAdj = b.label === ADJUSTMENT_PKG_LABEL;
        if (aAdj !== bAdj) return aAdj ? 1 : -1;
        return Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0);
      });
  };

  const activeTab = externalActiveTab ?? internalActiveTab;

  // 계획 컬럼 — 관리식 + 누적(YTD) + 영업비 탭에서만.
  //   · 당월·분기는 연간계획과 견줄 기간이 아니다
  //   · 계획 파일이 **영업비 기준**이라 직접비·전체에 붙이면 대응되지 않는 비교가 된다
  const withPlanColumns =
    !isFinancial && viewMode === '누적(YTD)' && activeTab === '영업비' && !!annualPlan;
  const rowGridClass = rowGridClassFor(withPrevColumn, withPlanColumns);

  /**
   * 구성 트리에서 **3단째(소분류)** 는 접어 둔다.
   * 대분류를 펼치면 `IT수수료/지급수수료 → 중분류` 까지만 보이고,
   * 그 아래는 중분류를 눌러야 나온다 — 한 번에 다 펴면 표가 너무 길어진다.
   */
  const [deepOpen, setDeepOpen] = useState<Set<string>>(new Set());
  const toggleDeep = (key: string) =>
    setDeepOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * 진척률 판단 기준선 — 기준월까지 지난 비율 (6월이면 6/12 = 50%).
   * 연간 계획을 균등하게 쓴다고 보고, 이 선을 넘으면 과집행으로 본다.
   */
  const elapsedPace = ((Number(selectedMonth.slice(5, 7)) || 0) / 12) * 100;
  /** 진척률 색 — 경과 기준선 초과면 빨강 */
  const progressTone = (progress: number) =>
    progress > elapsedPace ? 'text-red-600 font-medium' : 'text-blue-600';

  const setActiveTab = onTabChange ?? setInternalActiveTab;

  const salaryExpandedControlled = onSalarySubExpandedChange !== undefined;
  const salaryExpanded = salaryExpandedControlled
    ? (externalSalarySubExpanded ?? false)
    : internalSalaryExpanded;
  const toggleSalaryExpanded = () => {
    const next = !salaryExpanded;
    if (onSalarySubExpandedChange) {
      onSalarySubExpandedChange(next);
    } else {
      setInternalSalaryExpanded(next);
    }
  };

  const welfareExpandedControlled = onWelfareSubExpandedChange !== undefined;
  const welfareExpanded = welfareExpandedControlled
    ? (externalWelfareSubExpanded ?? false)
    : internalWelfareExpanded;
  const toggleWelfareExpanded = () => {
    const next = !welfareExpanded;
    if (onWelfareSubExpandedChange) {
      onWelfareSubExpandedChange(next);
    } else {
      setInternalWelfareExpanded(next);
    }
  };

  const isYTD = viewMode === '누적(YTD)';

  let currentData: CategoryData;
  let currentCostType: '직접비' | '영업비' | undefined;

  if (activeTab === '전체') {
    currentData = { ...directCosts };
    for (const category in operatingCosts) {
      if (currentData[category]) {
        const merged: MonthlyAmounts = { ...currentData[category] };
        for (const month in operatingCosts[category]) {
          merged[month] = (merged[month] || 0) + operatingCosts[category][month];
        }
        currentData[category] = merged;
      } else {
        currentData[category] = operatingCosts[category];
      }
    }
    currentCostType = undefined;
  } else if (activeTab === '직접비') {
    currentData = directCosts;
    currentCostType = '직접비';
  } else {
    currentData = operatingCosts;
    currentCostType = '영업비';
  }

  // 재무식: 연결계정과목 하나의 표 (직접/영업 구분 없음)
  if (isFinancial) {
    currentData = financialCosts ?? {};
    currentCostType = undefined;
  }

  const sortMode: '직접비' | '영업비' =
    activeTab === '전체' ? '직접비' : (currentCostType as '직접비' | '영업비');

  // 기간(당월/누적/분기) 금액 기준으로 표시 여부·정렬 판단
  const periodAmountOf = (monthly: MonthlyAmounts) =>
    periodCny(fromMonthly(monthly), period);

  const categories = isFinancial
    ? getSortedFinancialCategories(currentData, selectedMonth, isYTD, periodAmountOf)
    : getSortedCategories(currentData, selectedMonth, isYTD, sortMode, periodAmountOf);


  const salaryBuckets = useMemo(() => {
    if (!salarySub) return null;
    if (activeTab === '직접비') return { ...salarySub.직접비 };
    if (activeTab === '영업비') return { ...salarySub.영업비 };
    return mergeSalarySide(salarySub.직접비, salarySub.영업비, SALARY_SUB_LABELS);
  }, [salarySub, activeTab]);

  const visibleSalarySubLabels = useMemo(() => {
    if (!salaryBuckets) return [] as string[];
    return SALARY_SUB_LABELS.filter(
      (label) => amountForPeriod(salaryBuckets[label], selectedMonth, isYTD) !== 0,
    );
  }, [salaryBuckets, selectedMonth, isYTD]);

  const welfareSideResolved = useMemo((): WelfareBreakdownSide | null => {
    if (!welfareSub) return null;
    if (activeTab === '직접비') return welfareSub.직접비;
    if (activeTab === '영업비') return welfareSub.영업비;
    return mergeWelfareBreakdownSides(welfareSub.직접비, welfareSub.영업비);
  }, [welfareSub, activeTab]);

  const visibleWelfareL2 = useMemo(() => {
    if (!welfareSideResolved) return [] as (typeof WELFARE_L2_ORDER)[number][];
    return WELFARE_L2_ORDER.filter((k) => {
      if (k === '현지직원') {
        const l2Amt = amountForPeriod(welfareSideResolved.중분류[k], selectedMonth, isYTD);
        const l3Any = Object.keys(welfareSideResolved.현지직원세부).some(
          (l3) =>
            amountForPeriod(welfareSideResolved.현지직원세부[l3], selectedMonth, isYTD) !== 0,
        );
        return l2Amt !== 0 || l3Any;
      }
      return amountForPeriod(welfareSideResolved.중분류[k], selectedMonth, isYTD) !== 0;
    });
  }, [welfareSideResolved, selectedMonth, isYTD]);

  const visibleWelfareL3Labels = useMemo(() => {
    if (!welfareSideResolved) return [] as string[];
    return Object.keys(welfareSideResolved.현지직원세부)
      .filter(
        (l3) => amountForPeriod(welfareSideResolved.현지직원세부[l3], selectedMonth, isYTD) !== 0,
      )
      .sort((a, b) => a.localeCompare(b, 'ko'));
  }, [welfareSideResolved, selectedMonth, isYTD]);

  const getTabStyle = (tab: CostType) => {
    const isActive = activeTab === tab;
    const baseColors = {
      blue: isActive ? 'bg-blue-100/95 text-blue-800 border-blue-300 shadow-sm shadow-blue-200/50' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50',
      yellow: isActive ? 'bg-amber-100/95 text-amber-800 border-amber-300 shadow-sm shadow-amber-200/50' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50',
      green: isActive ? 'bg-emerald-100/95 text-emerald-800 border-emerald-300 shadow-sm shadow-emerald-200/50' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50',
      gray: isActive ? 'bg-slate-100/95 text-slate-800 border-slate-300 shadow-sm shadow-slate-200/50' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50',
      purple: isActive ? 'bg-violet-100/95 text-violet-800 border-violet-300 shadow-sm shadow-violet-200/50' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50',
      navy: isActive ? 'bg-[#e8eef7] text-[#16305c] border-[#a8bcd9] shadow-sm shadow-[#16305c]/15' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50',
    };
    return baseColors[color as keyof typeof baseColors] || baseColors.gray;
  };

  return (
    <div className="mt-3 sm:mt-4">
      {/* 재무식은 직접비/영업비 구분이 없어 탭을 표시하지 않는다 */}
      {!isFinancial && (
        <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3 sm:mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('전체')}
            className={`flex-1 min-w-[4.5rem] sm:min-w-[5rem] py-1.5 sm:py-2 px-2 sm:px-4 rounded-lg border text-xs sm:text-sm font-semibold transition-all ${getTabStyle('전체')}`}
          >
            전체
          </button>
          {hasDirectCosts && (
            <button
              type="button"
              onClick={() => setActiveTab('직접비')}
              className={`flex-1 min-w-[4.5rem] sm:min-w-[5rem] py-1.5 sm:py-2 px-2 sm:px-4 rounded-lg border text-xs sm:text-sm font-semibold transition-all ${getTabStyle('직접비')}`}
            >
              직접비
            </button>
          )}
          {hasOperatingCosts && (
            <button
              type="button"
              onClick={() => setActiveTab('영업비')}
              className={`flex-1 min-w-[4.5rem] sm:min-w-[5rem] py-1.5 sm:py-2 px-2 sm:px-4 rounded-lg border text-xs sm:text-sm font-semibold transition-all ${getTabStyle('영업비')}`}
            >
              영업비
            </button>
          )}
        </div>
      )}

      {categories.length === 0 ? (
        <div className="space-y-1.5 sm:space-y-2">
          <div className="text-center py-6 sm:py-8 text-gray-500 text-xs sm:text-sm">
            데이터가 없습니다.
          </div>
        </div>
      ) : (
        <div className="min-h-0 md:rounded-xl md:border md:border-slate-200/75 md:bg-slate-50/55 shadow-sm shadow-slate-200/30">
          <div
            className={`hidden md:grid ${gridColsFor(
              withPrevColumn,
              withPlanColumns
            )} md:gap-2 lg:gap-3 sticky top-0 z-10 px-2 sm:px-3 py-2 mb-2 text-xs text-slate-500 font-semibold border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-sm`}
          >
            <div className="whitespace-nowrap">{isFinancial ? '연결계정과목' : '대분류'}</div>
            <div className="text-right whitespace-nowrap">금액</div>
            {withPrevColumn && <div className="text-right whitespace-nowrap">전년금액</div>}
            <div className="text-right whitespace-nowrap">YOY금액</div>
            <div className="text-right whitespace-nowrap">YoY</div>
            {withPlanColumns && (
              <>
                <div className={`text-right whitespace-nowrap ${PLAN_DIVIDER}`}>연간계획</div>
                <div className="text-right whitespace-nowrap">
                  진척률
                  <span className="ml-1 font-normal text-slate-400">
                    ({Math.round(elapsedPace)}%)
                  </span>
                </div>
              </>
            )}
          </div>

          {/* 합계 — 헤더 바로 아래. 표에 보이는 대분류를 그대로 더한 값 */}
          {(() => {
            let sum = 0;
            let sumPrev = 0;
            let sumPlan = 0;
            let hasPlan = false;
            for (const category of categories) {
              const acc = fromMonthly(currentData[category]);
              sum += periodValue(acc, period, currency, exchangeRates) ?? 0;
              sumPrev += periodValue(acc, prevPeriod, currency, exchangeRates) ?? 0;
              const planYear = annualPlan?.[category];
              if (planYear) {
                sumPlan += planYear;
                hasPlan = true;
              }
            }
            const totalYoy = yoyIndex(sum, sumPrev);
            const totalDelta = sumPrev === 0 ? null : formatDelta(sum, sumPrev, currency);
            const totalProgress = hasPlan && sumPlan ? (sum / sumPlan) * 100 : null;

            return (
              <div
                className={`${rowGridClass} bg-slate-100/80 border-b border-slate-300 font-semibold text-gray-900`}
              >
                <div className="min-w-0 leading-snug md:whitespace-nowrap">합계</div>
                <div className={metricCellClass}>
                  <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">금액</span>
                  <span className="text-right tabular-nums">{formatAmount(sum, currency)}</span>
                </div>
                {withPrevColumn && (
                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                      전년금액
                    </span>
                    <span className="text-right text-gray-600 tabular-nums">
                      {formatAmount(sumPrev, currency)}
                    </span>
                  </div>
                )}
                <div className={metricCellClass}>
                  <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                    YOY금액
                  </span>
                  <span className="text-right tabular-nums">
                    {totalDelta === null ? <span className="text-gray-400">—</span> : totalDelta}
                  </span>
                </div>
                <div className={metricCellClass}>
                  <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YoY</span>
                  <div className="text-right">
                    {totalYoy === null ? (
                      <span className="text-gray-400">N/A</span>
                    ) : (
                      <span className={totalYoy >= 100 ? 'text-red-600' : 'text-blue-600'}>
                        {totalYoy}%
                      </span>
                    )}
                  </div>
                </div>
                {withPlanColumns && (
                  <>
                    <div className={`${metricCellClass} ${PLAN_DIVIDER}`}>
                      <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                        연간계획
                      </span>
                      <span className="text-right text-gray-600 tabular-nums">
                        {hasPlan ? formatAmount(sumPlan, currency) : <span className="text-gray-300">—</span>}
                      </span>
                    </div>
                    <div className={metricCellClass}>
                      <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                        진척률
                      </span>
                      <div className="text-right">
                        {totalProgress === null ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className={progressTone(totalProgress)}>
                            {Math.round(totalProgress)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <div className="space-y-1.5 sm:space-y-2">
          {categories.map((category) => {
            const monthlyData = currentData[category];
            const accessor = fromMonthly(monthlyData);
            // 표시 통화 기준 기간 금액 (분기는 누적 차감)
            const amount = periodValue(accessor, period, currency, exchangeRates);
            const prevAmount = periodValue(accessor, prevPeriod, currency, exchangeRates);
            const strongDividerClass =
              !isFinancial && (category === '복리비' || category === '출장비')
                ? 'border-slate-300 border-b-[3px] border-solid'
                : '';

            const yoyIdx = yoyIndex(amount, prevAmount);
            const yoyDelta = prevAmount === 0 ? null : formatDelta(amount, prevAmount, currency);

            // 계정(G/L) 1차 + 적요 보정 하위 구성 — 관리식·재무식 공통
            const subLabels = sortSubLabels(subLevels?.[category], subMonths);
            const showSubToggle = subLabels.length > 1;
            const subOpen = financialExpanded.has(category);
            /** 인당 금액을 같이 보여줄 계정 (인건비 계열) */
            const perPersonCategory = category === '급여' || category === '복리비';
            const isEstimated = estimatedCategories?.has(category) ?? false;


            return (
              <div key={category}>
                <div className={`${rowGridClass} ${strongDividerClass}`}>
                  <div className="flex items-start justify-between gap-2 min-w-0 font-medium text-gray-800">
                    <span className="min-w-0 flex-1 leading-snug md:whitespace-nowrap">
                      {category}
                      {isEstimated && (
                        <span
                          className="ml-1 align-middle text-[9px] font-semibold text-amber-700 bg-amber-100/80 px-1 py-px rounded"
                          title="전년 금액은 계정이 뭉쳐 있어 적요로 현행 계정에 맞춘 추정치입니다"
                        >
                          추정
                        </span>
                      )}
                    </span>
                    {showSubToggle && (
                      <button
                        type="button"
                        onClick={() => toggleFinancialExpanded(category)}
                        className="shrink-0 inline-flex items-center justify-center p-0.5 min-w-[1.25rem] text-sm font-medium leading-none text-gray-500 hover:text-gray-900"
                        aria-expanded={subOpen}
                        aria-label={subOpen ? `${category} 하위 계정 접기` : `${category} 하위 계정 펼치기`}
                      >
                        {subOpen ? '−' : '+'}
                      </button>
                    )}
                  </div>

                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">금액</span>
                    <span className="text-right font-semibold text-gray-900">
                      {formatAmount(amount, currency)}
                    </span>
                  </div>

                  {withPrevColumn && (
                    <div className={metricCellClass}>
                      <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                        전년금액
                      </span>
                      <span className="text-right text-gray-500 tabular-nums">
                        {formatAmount(prevAmount, currency)}
                      </span>
                    </div>
                  )}

                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YOY금액</span>
                    <span className="text-right text-gray-800 tabular-nums font-medium">
                      {yoyDelta === null ? (
                        <span className="text-gray-400 font-normal">—</span>
                      ) : (
                        yoyDelta
                      )}
                    </span>
                  </div>

                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YoY</span>
                    <div className="text-right">
                      {yoyIdx === null ? (
                        <span className="text-gray-400">N/A</span>
                      ) : (
                        <span className={yoyIdx >= 100 ? 'text-red-600' : 'text-blue-600'}>{yoyIdx}%</span>
                      )}
                    </div>
                  </div>

                  {withPlanColumns && (() => {
                    const planYear = annualPlan?.[category] ?? null;
                    // 진척률 = YTD 실적 / 연간계획. 계획이 없는 대분류는 비워 둔다
                    const progress = planYear && amount != null ? (amount / planYear) * 100 : null;
                    return (
                      <>
                        <div className={`${metricCellClass} ${PLAN_DIVIDER}`}>
                          <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                            연간계획
                          </span>
                          <span className="text-right text-gray-500 tabular-nums">
                            {planYear === null ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              formatAmount(planYear, currency)
                            )}
                          </span>
                        </div>
                        <div className={metricCellClass}>
                          <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                            진척률
                          </span>
                          <div className="text-right">
                            {progress === null ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <span className={progressTone(progress)}>
                                {Math.round(progress)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
                {showSubToggle && subOpen && (
                  <div className="ml-2 sm:ml-4 md:ml-5 mt-1 space-y-1 pl-2 sm:pl-3 mb-1.5 sm:mb-2">
                    {(() => {
                      /** 가지 행 — 하위 잎들의 합계 (예: IT수수료 / CN SAP) */
                      const branchRow = (
                        node: SubNode,
                        depth: number,
                        toggle?: { open: boolean; onClick: () => void }
                      ) => {
                        let sum = 0;
                        let prev = 0;
                        for (const l of node.leaves) {
                          const acc = fromMonthly(subLevels?.[category]?.[l] ?? {});
                          sum += periodValue(acc, period, currency, exchangeRates) ?? 0;
                          prev += periodValue(acc, prevPeriod, currency, exchangeRates) ?? 0;
                        }
                        const idx = yoyIndex(sum, prev);
                        const delta = prev === 0 ? null : formatDelta(sum, prev, currency);
                        return (
                          <div
                            className={`${rowGridClass} ${
                              depth === 0
                                ? 'bg-slate-100/70 border-b border-slate-300'
                                : 'bg-slate-50/70 border-b border-slate-200'
                            }`}
                          >
                            <div
                              className={`min-w-0 leading-snug text-[11px] sm:text-xs ${
                                depth === 0 ? 'font-semibold text-slate-800' : 'font-medium text-slate-700'
                              }`}
                              style={{ paddingLeft: depth * 12 }}
                            >
                              {node.name}
                              {/* 펼침 표시는 이름 뒤에 붙되 줄바꿈을 유발하지 않게 최소 크기로 */}
                              {toggle && (
                                <button
                                  type="button"
                                  onClick={toggle.onClick}
                                  aria-expanded={toggle.open}
                                  title={`${toggle.open ? '접기' : '펼치기'} · 하위 ${node.children.length}개`}
                                  className="ml-1 shrink-0 align-middle text-[11px] leading-none font-semibold text-slate-400 hover:text-slate-800"
                                >
                                  {toggle.open ? '−' : '+'}
                                </button>
                              )}
                            </div>
                            <div className={metricCellClass}>
                              <span className="text-right tabular-nums text-slate-700">
                                {formatAmount(sum, currency)}
                              </span>
                            </div>
                            {withPrevColumn && (
                              <div className={metricCellClass}>
                                <span className="text-right tabular-nums text-slate-500">
                                  {formatAmount(prev, currency)}
                                </span>
                              </div>
                            )}
                            <div className={metricCellClass}>
                              <span className="text-right tabular-nums text-slate-600">
                                {delta ?? <span className="text-gray-400">—</span>}
                              </span>
                            </div>
                            <div className={metricCellClass}>
                              <div className="text-right">
                                {idx === null ? (
                                  <span className="text-gray-400">N/A</span>
                                ) : (
                                  <span className={idx >= 100 ? 'text-red-600' : 'text-blue-600'}>
                                    {idx}%
                                  </span>
                                )}
                              </div>
                            </div>
                            {withPlanColumns && (
                              <>
                                <div className={`${metricCellClass} ${PLAN_DIVIDER}`} />
                                <div className={metricCellClass} />
                              </>
                            )}
                          </div>
                        );
                      };

                      const renderNodes = (nodes: SubNode[], depth: number): React.ReactNode =>
                        nodes.map((node) => {
                          // depth 0(IT/지급) 은 항상 펼침, depth 1(중분류) 부터는 눌러야 열린다
                          const collapsible = depth >= 1 && node.children.length > 0;
                          const key = `${category}|${node.leaves[0]}|${depth}`;
                          const open = !collapsible || deepOpen.has(key);
                          return (
                          <div key={key}>
                            {/* 자식이 있으면 합계 줄, 없으면 상세 줄 */}
                            {node.children.length > 0 ? (
                              <>
                                {branchRow(
                                  node,
                                  depth,
                                  collapsible
                                    ? { open, onClick: () => toggleDeep(key) }
                                    : undefined
                                )}
                                {open && renderNodes(node.children, depth + 1)}
                              </>
                            ) : (
                              <div>
{node.leaves.slice(0, 1).map((label) => {
                      const subMonthly = subLevels?.[category]?.[label] ?? {};
                      const acc = fromMonthly(subMonthly);
                      const cur = periodValue(acc, period, currency, exchangeRates);
                      const prv = periodValue(acc, prevPeriod, currency, exchangeRates);
                      const idx = yoyIndex(cur, prv);
                      const delta = prv === 0 ? null : formatDelta(cur, prv, currency);
                      const perPerson =
                        perPersonCategory && salaryPerPersonDenominator > 0 && cur !== null
                          ? cur / salaryPerPersonDenominator
                          : null;
                      const perPersonPrev =
                        perPersonCategory && salaryPerPersonDenominatorPrev > 0 && prv !== null
                          ? prv / salaryPerPersonDenominatorPrev
                          : null;
                      return (
                        <div key={label} className={rowGridClass}>
                          <div
                            className="break-words text-gray-600 min-w-0 leading-snug text-[10px] sm:text-[11px] md:text-xs"
                            style={{ paddingLeft: depth * 12 }}
                          >
                            {shortSubLabel(label)}
                          </div>
                          <div className={metricCellClass}>
                            <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">금액</span>
                            <span className="text-right text-gray-800">
                              {formatAmount(cur, currency)}
                              {/* 인당 금액 — 50위안 미만은 '0K/인'으로만 찍혀 의미가 없어 생략 */}
                              {perPerson !== null && Math.abs(perPerson) >= 50 && (
                                <span className="block text-[10px] text-gray-400 whitespace-nowrap leading-tight">
                                  {formatPerPersonThousandCny(perPerson)}
                                  {perPersonPrev !== null && Math.abs(perPersonPrev) >= 50 && (
                                    <span className="text-gray-300">
                                      {' · 전년 '}
                                      {formatPerPersonThousandCny(perPersonPrev).replace('/인', '')}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          </div>
                          {withPrevColumn && (
                            <div className={metricCellClass}>
                              <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">전년금액</span>
                              <span className="text-right text-gray-500">{formatAmount(prv, currency)}</span>
                            </div>
                          )}
                          <div className={metricCellClass}>
                            <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YOY금액</span>
                            <span className="text-right text-gray-700 tabular-nums">
                              {delta === null ? <span className="text-gray-400">—</span> : delta}
                            </span>
                          </div>
                          <div className={metricCellClass}>
                            <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YoY</span>
                            <div className="text-right">
                              {idx === null ? (
                                <span className="text-gray-400">N/A</span>
                              ) : (
                                <span className={idx >= 100 ? 'text-red-600' : 'text-blue-600'}>{idx}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                              </div>
                            )}
                          </div>
                          );
                        });

                      return renderNodes(buildSubTree(subLabels), 0);
                    })()}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}
