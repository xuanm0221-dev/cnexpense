'use client';

/**
 * 상세 페이지: 대분류 → G/L 계정 설명 계층 표 (당월 / 누적 YTD)
 */

import { useCallback, useMemo, useState } from 'react';
import type { CategoryData, GlBreakdownByCategory, MonthlyAmounts, ViewMode } from '@/lib/types';
import {
  calculateYTD,
  calculateYoY,
  getAmountForMonth,
  getPreviousYearMonth,
  getSortedCategories,
  yoYDeltaToIndexPercent,
} from '@/lib/calculations';
import { toThousandCNY } from '@/utils/formatters';

type CostSide = '직접비' | '영업비';

function formatDeltaK(deltaK: number | 'N/A'): string {
  if (deltaK === 'N/A') return '—';
  const abs = Math.abs(deltaK).toLocaleString('en-US');
  if (deltaK > 0) return `+${abs}K`;
  if (deltaK < 0) return `△${abs}K`;
  return '0K';
}

function yoyPctCell(yoyIdx: number | 'N/A') {
  if (yoyIdx === 'N/A') {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <span className={yoyIdx >= 100 ? 'text-rose-600 font-medium' : 'text-sky-700 font-medium'}>
      {yoyIdx}%
    </span>
  );
}

function planStub() {
  return <span className="text-slate-400 tabular-nums">—</span>;
}

function sortGlKeys(
  glMap: Record<string, MonthlyAmounts>,
  selectedMonth: string,
  isYtd: boolean
): string[] {
  return Object.keys(glMap).sort((a, b) => {
    const va = isYtd
      ? calculateYTD(glMap[a], selectedMonth)
      : getAmountForMonth(glMap[a], selectedMonth);
    const vb = isYtd
      ? calculateYTD(glMap[b], selectedMonth)
      : getAmountForMonth(glMap[b], selectedMonth);
    return Math.abs(vb) - Math.abs(va);
  });
}

export interface ExpenseAccountHierarchyTableProps {
  title?: string;
  categoryData: CategoryData;
  glByCategory: GlBreakdownByCategory | undefined;
  selectedMonth: string;
  costSide: CostSide;
}

export default function ExpenseAccountHierarchyTable({
  title = '비용 계정 상세 분석',
  categoryData,
  glByCategory,
  selectedMonth,
  costSide,
}: ExpenseAccountHierarchyTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('당월');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [yStr, mStr] = selectedMonth.split('-');
  const monthNum = parseInt(mStr || '1', 10);
  const yearLabel = `${yStr}년 ${monthNum}월 기준`;
  const prevYearStr = (parseInt(yStr, 10) - 1).toString();
  const currYearStr = yStr;

  const categories = useMemo(
    () =>
      getSortedCategories(
        categoryData,
        selectedMonth,
        viewMode === '누적(YTD)',
        costSide
      ),
    [categoryData, selectedMonth, viewMode, costSide]
  );

  const toggleCategory = useCallback((category: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set<string>();
    for (const c of categories) {
      const glMap = glByCategory?.[c];
      if (glMap && Object.keys(glMap).length > 0) next.add(c);
    }
    setExpanded(next);
  }, [categories, glByCategory]);

  const resetExpand = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const isYtd = viewMode === '누적(YTD)';

  const metricsForMonthly = useCallback(
    (monthly: MonthlyAmounts) => {
      const curr = isYtd ? calculateYTD(monthly, selectedMonth) : getAmountForMonth(monthly, selectedMonth);
      const prevMonth = getPreviousYearMonth(selectedMonth);
      const prev = isYtd ? calculateYTD(monthly, prevMonth) : getAmountForMonth(monthly, prevMonth);
      const yoy = calculateYoY(monthly, selectedMonth, isYtd);
      const yoyIdx = yoYDeltaToIndexPercent(yoy.pct);
      return { curr, prev, yoy, yoyIdx };
    },
    [selectedMonth, isYtd]
  );

  const grandTotal = useMemo(() => {
    let curr = 0;
    let prev = 0;
    for (const c of categories) {
      const m = categoryData[c];
      if (!m) continue;
      curr += isYtd ? calculateYTD(m, selectedMonth) : getAmountForMonth(m, selectedMonth);
      const pm = getPreviousYearMonth(selectedMonth);
      prev += isYtd ? calculateYTD(m, pm) : getAmountForMonth(m, pm);
    }
    const yoyRes = (() => {
      const synthetic: MonthlyAmounts = {};
      for (const c of categories) {
        const m = categoryData[c];
        if (!m) continue;
        for (const k of Object.keys(m)) {
          synthetic[k] = (synthetic[k] || 0) + m[k];
        }
      }
      return calculateYoY(synthetic, selectedMonth, isYtd);
    })();
    const yoyIdx = yoYDeltaToIndexPercent(yoyRes.pct);
    return { curr, prev, yoy: yoyRes, yoyIdx };
  }, [categories, categoryData, selectedMonth, isYtd]);

  return (
    <section
      className="mt-8 rounded-xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/40 overflow-hidden"
      aria-label={title}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between gap-y-3 px-4 py-3 bg-slate-800 text-white">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold tracking-tight truncate">{title}</h2>
          <span
            className="shrink-0 text-[11px] sm:text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-100 ring-1 ring-white/20"
            title="선택 기준월"
          >
            {yearLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg bg-slate-900/80 p-0.5 ring-1 ring-white/10"
            role="tablist"
            aria-label="당월 또는 누적 보기"
          >
            {(['당월', '누적(YTD)'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors ${
                  viewMode === mode
                    ? 'bg-white text-slate-900 shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {mode === '누적(YTD)' ? '누적(YTD)' : '당월'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={expandAll}
            className="text-[11px] sm:text-xs px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-white ring-1 ring-white/10"
          >
            모두 펼치기
          </button>
          <button
            type="button"
            onClick={resetExpand}
            className="text-[11px] sm:text-xs px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-white ring-1 ring-white/10"
          >
            초기화
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {viewMode === '당월' ? (
          <table className="min-w-[720px] w-full text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="text-left font-semibold px-3 py-2 border-b border-slate-200 sticky left-0 bg-slate-100 z-20 min-w-[10rem]">
                  구분
                </th>
                <th colSpan={4} className="text-center font-semibold px-2 py-2 border-b border-slate-200 border-l border-slate-200">
                  당월 데이터
                </th>
                <th className="text-left font-semibold px-3 py-2 border-b border-slate-200 border-l border-slate-200 min-w-[8rem]">
                  비고
                </th>
              </tr>
              <tr className="bg-slate-50 text-slate-600 text-[11px] sm:text-xs">
                <th className="sticky left-0 bg-slate-50 z-20 border-b border-slate-200" />
                <th className="text-right font-medium px-2 py-1.5 border-b border-slate-200 border-l border-slate-200">
                  전년
                </th>
                <th className="text-right font-medium px-2 py-1.5 border-b border-slate-200">당월</th>
                <th className="text-right font-medium px-2 py-1.5 border-b border-slate-200">
                  차이(금액)
                </th>
                <th className="text-right font-medium px-2 py-1.5 border-b border-slate-200">YOY(%)</th>
                <th className="border-b border-slate-200 border-l border-slate-200" />
              </tr>
            </thead>
            <tbody className="text-slate-800">
              <GrandTotalRowMonthly grand={grandTotal} />
              {categories.map(category => (
                <CategoryBlockMonthly
                  key={category}
                  category={category}
                  monthly={categoryData[category]}
                  glMap={glByCategory?.[category]}
                  expanded={expanded.has(category)}
                  onToggle={() => toggleCategory(category)}
                  selectedMonth={selectedMonth}
                  metricsForMonthly={metricsForMonthly}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <table className="min-w-[1100px] w-full text-[11px] sm:text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th
                  rowSpan={2}
                  className="text-left font-semibold px-2 py-2 border-b border-slate-200 sticky left-0 bg-slate-100 z-20 align-middle min-w-[9rem]"
                >
                  구분
                </th>
                <th
                  colSpan={8}
                  className="text-center font-semibold px-1 py-2 border-b border-slate-200 border-l border-slate-200 bg-violet-100/80 text-violet-950"
                >
                  누적(YTD)
                </th>
                <th
                  colSpan={4}
                  className="text-center font-semibold px-1 py-2 border-b border-slate-200 border-l border-slate-200 bg-emerald-100/80 text-emerald-950"
                >
                  연간 계획
                </th>
                <th
                  rowSpan={2}
                  className="text-left font-semibold px-2 py-2 border-b border-slate-200 border-l border-slate-200 align-middle min-w-[7rem] max-w-[14rem]"
                >
                  설명
                </th>
              </tr>
              <tr className="bg-slate-50 text-slate-600 text-[10px] sm:text-xs">
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 border-l border-slate-200 whitespace-nowrap">
                  전년누적
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  당년누적
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  YOY(금액)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  YOY(%)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  계획누적
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  계획비(금액)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  계획비(%)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap bg-amber-50/90">
                  사용률(%)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 border-l border-slate-200 whitespace-nowrap">
                  {prevYearStr}년(연간)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  {currYearStr}년(연간)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  YOY(금액)
                </th>
                <th className="text-right font-medium px-1 py-1.5 border-b border-slate-200 whitespace-nowrap">
                  YOY(%)
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-800">
              <GrandTotalRowYtd grand={grandTotal} />
              {categories.map(category => (
                <CategoryBlockYtd
                  key={category}
                  category={category}
                  monthly={categoryData[category]}
                  glMap={glByCategory?.[category]}
                  expanded={expanded.has(category)}
                  onToggle={() => toggleCategory(category)}
                  selectedMonth={selectedMonth}
                  metricsForMonthly={metricsForMonthly}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function GrandTotalRowMonthly({
  grand,
}: {
  grand: {
    curr: number;
    prev: number;
    yoy: ReturnType<typeof calculateYoY>;
    yoyIdx: number | 'N/A';
  };
}) {
  return (
    <tr className="bg-violet-50/90 font-semibold border-b border-slate-200">
      <td className="px-3 py-2 sticky left-0 bg-violet-50/95 z-10">전체 합계</td>
      <td className="text-right tabular-nums px-2 py-2 border-l border-slate-200">
        {toThousandCNY(grand.prev)}
      </td>
      <td className="text-right tabular-nums px-2 py-2">{toThousandCNY(grand.curr)}</td>
      <td
        className={`text-right tabular-nums px-2 py-2 ${
          grand.yoy.deltaK !== 'N/A' && grand.yoy.deltaK > 0 ? 'text-rose-600' : 'text-sky-700'
        }`}
      >
        {formatDeltaK(grand.yoy.deltaK)}
      </td>
      <td className="text-right px-2 py-2">{yoyPctCell(grand.yoyIdx)}</td>
      <td className="px-3 py-2 text-slate-400 border-l border-slate-200">—</td>
    </tr>
  );
}

function GrandTotalRowYtd({
  grand,
}: {
  grand: {
    curr: number;
    prev: number;
    yoy: ReturnType<typeof calculateYoY>;
    yoyIdx: number | 'N/A';
  };
}) {
  return (
    <tr className="bg-violet-50/90 font-semibold border-b border-slate-200">
      <td className="px-2 py-2 sticky left-0 bg-violet-50/95 z-10">전체 합계</td>
      <td className="text-right tabular-nums px-1 py-2 border-l border-slate-200">
        {toThousandCNY(grand.prev)}
      </td>
      <td className="text-right tabular-nums px-1 py-2">{toThousandCNY(grand.curr)}</td>
      <td
        className={`text-right tabular-nums px-1 py-2 ${
          grand.yoy.deltaK !== 'N/A' && grand.yoy.deltaK > 0 ? 'text-rose-600' : 'text-sky-700'
        }`}
      >
        {formatDeltaK(grand.yoy.deltaK)}
      </td>
      <td className="text-right px-1 py-2">{yoyPctCell(grand.yoyIdx)}</td>
      <td className="text-right px-1 py-2">{planStub()}</td>
      <td className="text-right px-1 py-2">{planStub()}</td>
      <td className="text-right px-1 py-2">{planStub()}</td>
      <td className="text-right px-1 py-2 bg-amber-50/50">{planStub()}</td>
      <td className="text-right px-1 py-2 border-l border-slate-200">{planStub()}</td>
      <td className="text-right px-1 py-2">{planStub()}</td>
      <td className="text-right px-1 py-2">{planStub()}</td>
      <td className="text-right px-1 py-2">{planStub()}</td>
      <td className="px-2 py-2 text-slate-400 border-l border-slate-200 align-top">—</td>
    </tr>
  );
}

function CategoryBlockMonthly({
  category,
  monthly,
  glMap,
  expanded,
  onToggle,
  selectedMonth,
  metricsForMonthly,
}: {
  category: string;
  monthly: MonthlyAmounts;
  glMap: Record<string, MonthlyAmounts> | undefined;
  expanded: boolean;
  onToggle: () => void;
  selectedMonth: string;
  metricsForMonthly: (m: MonthlyAmounts) => {
    curr: number;
    prev: number;
    yoy: ReturnType<typeof calculateYoY>;
    yoyIdx: number | 'N/A';
  };
}) {
  const { curr, prev, yoy, yoyIdx } = metricsForMonthly(monthly);
  const glKeys = glMap ? sortGlKeys(glMap, selectedMonth, false) : [];
  const hasChildren = glKeys.length > 0;

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/80">
        <td className="px-3 py-2 sticky left-0 bg-white z-10">
          <button
            type="button"
            onClick={hasChildren ? onToggle : undefined}
            className={`flex items-center gap-1.5 text-left w-full min-w-0 ${hasChildren ? 'cursor-pointer' : 'cursor-default'}`}
            aria-expanded={hasChildren ? expanded : undefined}
            disabled={!hasChildren}
          >
            {hasChildren ? (
              <span className="text-slate-500 w-4 shrink-0 tabular-nums" aria-hidden>
                {expanded ? '∨' : '›'}
              </span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="font-medium break-words">{category}</span>
          </button>
        </td>
        <td className="text-right tabular-nums px-2 py-2 border-l border-slate-100">{toThousandCNY(prev)}</td>
        <td className="text-right tabular-nums px-2 py-2">{toThousandCNY(curr)}</td>
        <td
          className={`text-right tabular-nums px-2 py-2 ${
            yoy.deltaK !== 'N/A' && yoy.deltaK > 0 ? 'text-rose-600' : 'text-sky-700'
          }`}
        >
          {formatDeltaK(yoy.deltaK)}
        </td>
        <td className="text-right px-2 py-2">{yoyPctCell(yoyIdx)}</td>
        <td className="px-3 py-2 text-slate-400 text-[11px] border-l border-slate-100 align-top">—</td>
      </tr>
      {expanded &&
        hasChildren &&
        glKeys.map(gl => {
          const gm = glMap![gl];
          const row = metricsForMonthly(gm);
          return (
            <tr
              key={`${category}-${gl}`}
              className="border-b border-slate-50 bg-slate-50/40 text-[11px] sm:text-xs text-slate-700"
            >
              <td className="pl-10 pr-3 py-1.5 sticky left-0 bg-slate-50/95 z-10 break-words">
                {gl}
              </td>
              <td className="text-right tabular-nums px-2 py-1.5 border-l border-slate-100">
                {toThousandCNY(row.prev)}
              </td>
              <td className="text-right tabular-nums px-2 py-1.5">{toThousandCNY(row.curr)}</td>
              <td
                className={`text-right tabular-nums px-2 py-1.5 ${
                  row.yoy.deltaK !== 'N/A' && row.yoy.deltaK > 0 ? 'text-rose-600' : 'text-sky-700'
                }`}
              >
                {formatDeltaK(row.yoy.deltaK)}
              </td>
              <td className="text-right px-2 py-1.5">{yoyPctCell(row.yoyIdx)}</td>
              <td className="px-3 py-1.5 text-slate-400 border-l border-slate-100">—</td>
            </tr>
          );
        })}
    </>
  );
}

function CategoryBlockYtd({
  category,
  monthly,
  glMap,
  expanded,
  onToggle,
  selectedMonth,
  metricsForMonthly,
}: {
  category: string;
  monthly: MonthlyAmounts;
  glMap: Record<string, MonthlyAmounts> | undefined;
  expanded: boolean;
  onToggle: () => void;
  selectedMonth: string;
  metricsForMonthly: (m: MonthlyAmounts) => {
    curr: number;
    prev: number;
    yoy: ReturnType<typeof calculateYoY>;
    yoyIdx: number | 'N/A';
  };
}) {
  const { curr, prev, yoy, yoyIdx } = metricsForMonthly(monthly);
  const glKeys = glMap ? sortGlKeys(glMap, selectedMonth, true) : [];
  const hasChildren = glKeys.length > 0;

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/80">
        <td className="px-2 py-2 sticky left-0 bg-white z-10">
          <button
            type="button"
            onClick={hasChildren ? onToggle : undefined}
            className={`flex items-center gap-1.5 text-left w-full min-w-0 ${hasChildren ? 'cursor-pointer' : 'cursor-default'}`}
            aria-expanded={hasChildren ? expanded : undefined}
            disabled={!hasChildren}
          >
            {hasChildren ? (
              <span className="text-slate-500 w-4 shrink-0" aria-hidden>
                {expanded ? '∨' : '›'}
              </span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="font-medium break-words">{category}</span>
          </button>
        </td>
        <td className="text-right tabular-nums px-1 py-2 border-l border-slate-100">{toThousandCNY(prev)}</td>
        <td className="text-right tabular-nums px-1 py-2">{toThousandCNY(curr)}</td>
        <td
          className={`text-right tabular-nums px-1 py-2 ${
            yoy.deltaK !== 'N/A' && yoy.deltaK > 0 ? 'text-rose-600' : 'text-sky-700'
          }`}
        >
          {formatDeltaK(yoy.deltaK)}
        </td>
        <td className="text-right px-1 py-2">{yoyPctCell(yoyIdx)}</td>
        <td className="text-right px-1 py-2">{planStub()}</td>
        <td className="text-right px-1 py-2">{planStub()}</td>
        <td className="text-right px-1 py-2">{planStub()}</td>
        <td className="text-right px-1 py-2 bg-amber-50/40">{planStub()}</td>
        <td className="text-right px-1 py-2 border-l border-slate-100">{planStub()}</td>
        <td className="text-right px-1 py-2">{planStub()}</td>
        <td className="text-right px-1 py-2">{planStub()}</td>
        <td className="text-right px-1 py-2">{planStub()}</td>
        <td className="px-2 py-2 text-slate-400 border-l border-slate-100 align-top text-[11px]">—</td>
      </tr>
      {expanded &&
        hasChildren &&
        glKeys.map(gl => {
          const gm = glMap![gl];
          const row = metricsForMonthly(gm);
          return (
            <tr
              key={`${category}-${gl}-ytd`}
              className="border-b border-slate-50 bg-slate-50/40 text-[10px] sm:text-xs text-slate-700"
            >
              <td className="pl-9 pr-2 py-1.5 sticky left-0 bg-slate-50/95 z-10 break-words">{gl}</td>
              <td className="text-right tabular-nums px-1 py-1.5 border-l border-slate-100">
                {toThousandCNY(row.prev)}
              </td>
              <td className="text-right tabular-nums px-1 py-1.5">{toThousandCNY(row.curr)}</td>
              <td
                className={`text-right tabular-nums px-1 py-1.5 ${
                  row.yoy.deltaK !== 'N/A' && row.yoy.deltaK > 0 ? 'text-rose-600' : 'text-sky-700'
                }`}
              >
                {formatDeltaK(row.yoy.deltaK)}
              </td>
              <td className="text-right px-1 py-1.5">{yoyPctCell(row.yoyIdx)}</td>
              <td className="text-right px-1 py-1.5">{planStub()}</td>
              <td className="text-right px-1 py-1.5">{planStub()}</td>
              <td className="text-right px-1 py-1.5">{planStub()}</td>
              <td className="text-right px-1 py-1.5 bg-amber-50/30">{planStub()}</td>
              <td className="text-right px-1 py-1.5 border-l border-slate-100">{planStub()}</td>
              <td className="text-right px-1 py-1.5">{planStub()}</td>
              <td className="text-right px-1 py-1.5">{planStub()}</td>
              <td className="text-right px-1 py-1.5">{planStub()}</td>
              <td className="px-2 py-1.5 text-slate-400 border-l border-slate-100">—</td>
            </tr>
          );
        })}
    </>
  );
}
