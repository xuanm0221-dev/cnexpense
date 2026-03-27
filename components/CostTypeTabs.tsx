'use client';

/**
 * 직접비/영업비 탭
 * 반응형: md 미만 — 행당 세로 스택 + 소라벨, 글자·패딩 축소 / md 이상 — 4열 표
 */

import { useMemo, useState } from 'react';
import {
  CategoryData,
  CostType,
  ViewMode,
  MonthlyAmounts,
  WelfareBreakdownSide,
} from '@/lib/types';
import {
  getSortedCategories,
  calculateYTD,
  getAmountForMonth,
  calculateYoY,
  yoYDeltaToIndexPercent,
} from '@/lib/calculations';
import { toThousandCNY } from '@/utils/formatters';

const SALARY_SUB_LABELS = ['기본급', '성과급', 'Red Pack', '외주/PT', '퇴직급여', '미정'] as const;

const WELFARE_L2_ORDER = ['보험/공적금', '주재원', '현지직원'] as const;

/** 모바일: 세로 스택 / 데스크톱: 4열 */
const rowGridClass =
  'p-2 sm:p-3 space-y-1.5 sm:space-y-2 md:space-y-0 md:grid md:grid-cols-4 md:gap-3 lg:gap-4 md:items-center hover:bg-slate-50/70 transition-colors text-xs sm:text-sm';

const metricCellClass =
  'flex justify-between items-baseline gap-2 md:block md:text-right tabular-nums';

const subRowGridClass =
  'p-2 sm:p-3 space-y-1.5 sm:space-y-2 md:space-y-0 md:grid md:grid-cols-4 md:gap-3 lg:gap-4 md:items-center text-[11px] sm:text-xs md:text-sm border-b border-dotted border-slate-200/80';

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
  welfareSub?: {
    직접비: WelfareBreakdownSide;
    영업비: WelfareBreakdownSide;
  };
  welfareSubExpanded?: boolean;
  onWelfareSubExpandedChange?: (open: boolean) => void;
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
  welfareSub,
  welfareSubExpanded: externalWelfareSubExpanded,
  onWelfareSubExpandedChange,
}: CostTypeTabsProps) {
  const hasDirectCosts = Object.keys(directCosts).length > 0;
  const hasOperatingCosts = Object.keys(operatingCosts).length > 0;

  const [internalActiveTab, setInternalActiveTab] = useState<CostType>('전체');
  const [internalSalaryExpanded, setInternalSalaryExpanded] = useState(false);
  const [internalWelfareExpanded, setInternalWelfareExpanded] = useState(false);

  const activeTab = externalActiveTab ?? internalActiveTab;
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

  const sortMode: '직접비' | '영업비' =
    activeTab === '전체' ? '직접비' : (currentCostType as '직접비' | '영업비');

  const categories = getSortedCategories(currentData, selectedMonth, isYTD, sortMode);

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
    };
    return baseColors[color as keyof typeof baseColors] || baseColors.gray;
  };

  return (
    <div className="mt-3 sm:mt-4">
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

      {categories.length === 0 ? (
        <div className="space-y-1.5 sm:space-y-2">
          <div className="text-center py-6 sm:py-8 text-gray-500 text-xs sm:text-sm">
            데이터가 없습니다.
          </div>
        </div>
      ) : (
        <div className="min-h-0 md:rounded-xl md:border md:border-slate-200/75 md:bg-slate-50/55 shadow-sm shadow-slate-200/30">
          <div className="hidden md:grid md:grid-cols-4 md:gap-3 lg:gap-4 sticky top-0 z-10 px-2 sm:px-3 py-2 mb-2 text-xs text-slate-500 font-semibold border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur-sm">
            <div>대분류</div>
            <div className="text-right">금액</div>
            <div className="text-right">YOY금액</div>
            <div className="text-right">YoY</div>
          </div>
          <div className="space-y-1.5 sm:space-y-2">
          {categories.map((category) => {
            const monthlyData = currentData[category];
            const amount = isYTD
              ? calculateYTD(monthlyData, selectedMonth)
              : getAmountForMonth(monthlyData, selectedMonth);
            const strongDividerClass =
              category === '복리비' || category === '출장비'
                ? 'border-slate-300 border-b-[3px] border-solid'
                : '';

            const yoy = calculateYoY(monthlyData, selectedMonth, isYTD);
            const yoyIdx = yoYDeltaToIndexPercent(yoy.pct);

            const showSalaryToggle =
              category === '급여' && salaryBuckets && visibleSalarySubLabels.length > 0;

            const showWelfareToggle =
              category === '복리비' && welfareSideResolved && visibleWelfareL2.length > 0;

            return (
              <div key={category}>
                <div className={`${rowGridClass} ${strongDividerClass}`}>
                  <div className="flex items-start justify-between gap-2 min-w-0 font-medium text-gray-800">
                    <span className="min-w-0 flex-1 break-words leading-snug">{category}</span>
                    {showSalaryToggle && (
                      <button
                        type="button"
                        onClick={toggleSalaryExpanded}
                        className="shrink-0 inline-flex items-center justify-center p-0.5 min-w-[1.25rem] text-sm font-medium leading-none text-gray-500 hover:text-gray-900"
                        aria-expanded={salaryExpanded}
                        aria-label={salaryExpanded ? '급여 중분류 접기' : '급여 중분류 펼치기'}
                      >
                        {salaryExpanded ? '−' : '+'}
                      </button>
                    )}
                    {showWelfareToggle && (
                      <button
                        type="button"
                        onClick={toggleWelfareExpanded}
                        className="shrink-0 inline-flex items-center justify-center p-0.5 min-w-[1.25rem] text-sm font-medium leading-none text-gray-500 hover:text-gray-900"
                        aria-expanded={welfareExpanded}
                        aria-label={welfareExpanded ? '복리비 중분류 접기' : '복리비 중분류 펼치기'}
                      >
                        {welfareExpanded ? '−' : '+'}
                      </button>
                    )}
                  </div>

                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">금액</span>
                    <span className="text-right font-semibold text-gray-900">{toThousandCNY(amount)}</span>
                  </div>

                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YOY금액</span>
                    <span className="text-right text-gray-800 tabular-nums font-medium">
                      {yoy.deltaK === 'N/A' ? (
                        <span className="text-gray-400 font-normal">—</span>
                      ) : (
                        <>
                          {yoy.deltaK >= 0 ? '+' : ''}
                          {yoy.deltaK.toLocaleString('en-US')}K
                        </>
                      )}
                    </span>
                  </div>

                  <div className={metricCellClass}>
                    <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YoY</span>
                    <div className="text-right">
                      {yoyIdx === 'N/A' ? (
                        <span className="text-gray-400">N/A</span>
                      ) : (
                        <span className={yoyIdx >= 100 ? 'text-red-600' : 'text-blue-600'}>{yoyIdx}%</span>
                      )}
                    </div>
                  </div>
                </div>
                {showSalaryToggle && salaryExpanded && (
                  <div className="ml-2 sm:ml-4 md:ml-5 mt-1 space-y-1 pl-2 sm:pl-3 mb-1.5 sm:mb-2">
                    {visibleSalarySubLabels.map((label) => {
                      const subMonthly = salaryBuckets[label]!;
                      const subAmt = amountForPeriod(subMonthly, selectedMonth, isYTD);
                      const subPerPerson =
                        salaryPerPersonDenominator > 0 ? subAmt / salaryPerPersonDenominator : null;
                      const subYoy = calculateYoY(subMonthly, selectedMonth, isYTD);
                      const subIdx = yoYDeltaToIndexPercent(subYoy.pct);
                      return (
                        <div key={label} className={subRowGridClass}>
                          <div className="break-words text-gray-600 pl-0 md:pl-1 min-w-0 leading-snug text-[10px] sm:text-[11px] md:text-xs">
                            {label}
                          </div>
                          <div className={metricCellClass}>
                            <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                              금액
                            </span>
                            <span className="text-right text-gray-800">{toThousandCNY(subAmt)}</span>
                          </div>
                          <div className="flex justify-end items-baseline md:block md:text-right tabular-nums">
                            <span className="text-right text-gray-500">
                              {subPerPerson === null ? (
                                <span className="text-gray-400">-</span>
                              ) : (
                                formatPerPersonThousandCny(subPerPerson)
                              )}
                            </span>
                          </div>
                          <div className={metricCellClass}>
                            <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">YoY</span>
                            <div className="text-right">
                              {subIdx === 'N/A' ? (
                                <span className="text-gray-400">N/A</span>
                              ) : (
                                <span className={subIdx >= 100 ? 'text-red-600' : 'text-blue-600'}>
                                  {subIdx}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {showWelfareToggle && welfareExpanded && welfareSideResolved && (
                  <div className="ml-2 sm:ml-4 md:ml-5 mt-1 space-y-1 pl-2 sm:pl-3 mb-1.5 sm:mb-2">
                    {visibleWelfareL2.map((l2) => {
                      const l2Monthly = welfareSideResolved.중분류[l2] || {};
                      const l2Amt = amountForPeriod(l2Monthly, selectedMonth, isYTD);
                      const l2PerPerson =
                        salaryPerPersonDenominator > 0 ? l2Amt / salaryPerPersonDenominator : null;
                      const l2Yoy = calculateYoY(l2Monthly, selectedMonth, isYTD);
                      const l2Idx = yoYDeltaToIndexPercent(l2Yoy.pct);
                      return (
                        <div key={l2}>
                          <div className={subRowGridClass}>
                            <div className="break-words text-gray-600 pl-0 md:pl-1 min-w-0 leading-snug text-[10px] sm:text-[11px] md:text-xs">
                              {l2}
                            </div>
                            <div className={metricCellClass}>
                              <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                                금액
                              </span>
                              <span className="text-right text-gray-800">{toThousandCNY(l2Amt)}</span>
                            </div>
                            <div className="flex justify-end items-baseline md:block md:text-right tabular-nums">
                              <span className="text-right text-gray-500">
                                {l2PerPerson === null ? (
                                  <span className="text-gray-400">-</span>
                                ) : (
                                  formatPerPersonThousandCny(l2PerPerson)
                                )}
                              </span>
                            </div>
                            <div className={metricCellClass}>
                              <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                                YoY
                              </span>
                              <div className="text-right">
                                {l2Idx === 'N/A' ? (
                                  <span className="text-gray-400">N/A</span>
                                ) : (
                                  <span className={l2Idx >= 100 ? 'text-red-600' : 'text-blue-600'}>
                                    {l2Idx}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {l2 === '현지직원' && visibleWelfareL3Labels.length > 0 && (
                            <div className="ml-2 sm:ml-3 mt-1 space-y-1 border-l border-gray-100 pl-2 sm:pl-3">
                              {visibleWelfareL3Labels.map((l3) => {
                                const l3Monthly = welfareSideResolved.현지직원세부[l3]!;
                                const l3Amt = amountForPeriod(l3Monthly, selectedMonth, isYTD);
                                const l3PerPerson =
                                  salaryPerPersonDenominator > 0
                                    ? l3Amt / salaryPerPersonDenominator
                                    : null;
                                const l3Yoy = calculateYoY(l3Monthly, selectedMonth, isYTD);
                                const l3Idx = yoYDeltaToIndexPercent(l3Yoy.pct);
                                return (
                                  <div key={l3} className={subRowGridClass}>
                                    <div className="break-words text-gray-500 pl-0 md:pl-1 min-w-0 leading-snug text-[11px] sm:text-xs">
                                      {l3}
                                    </div>
                                    <div className={metricCellClass}>
                                      <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                                        금액
                                      </span>
                                      <span className="text-right text-gray-800">
                                        {toThousandCNY(l3Amt)}
                                      </span>
                                    </div>
                                    <div className="flex justify-end items-baseline md:block md:text-right tabular-nums">
                                      <span className="text-right text-gray-500">
                                        {l3PerPerson === null ? (
                                          <span className="text-gray-400">-</span>
                                        ) : (
                                          formatPerPersonThousandCny(l3PerPerson)
                                        )}
                                      </span>
                                    </div>
                                    <div className={metricCellClass}>
                                      <span className="text-[10px] sm:text-xs text-gray-500 md:hidden shrink-0">
                                        YoY
                                      </span>
                                      <div className="text-right">
                                        {l3Idx === 'N/A' ? (
                                          <span className="text-gray-400">N/A</span>
                                        ) : (
                                          <span
                                            className={l3Idx >= 100 ? 'text-red-600' : 'text-blue-600'}
                                          >
                                            {l3Idx}%
                                          </span>
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
                    })}
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
