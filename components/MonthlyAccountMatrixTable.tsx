'use client';

/**
 * 월별 × 계정 매트릭스 — 홈 우측 분석 지표 영역
 *
 * 열 = 기준월이 속한 해의 1월~기준월 + 누계(YTD).
 * 셀 = 금액 / 전년 동월 대비 증감액 · 지수(전년=100).
 * 행 = 전체 합계 → 계정(관리식 대분류 / 재무식 연결계정과목).
 *
 * 월 셀은 각 달의 **월평균** 환율, 누계 셀은 **기간평균** 환율로 환산한다(카드·KPI와 동일 규칙).
 * 그래서 원화에서는 월 셀 단순합과 누계 열이 정확히 일치하지 않을 수 있다.
 */

import { Fragment, useCallback, useMemo, useState } from 'react';
import { BusinessUnitCosts, CostBasis, CostType, MonthlyAmounts } from '@/lib/types';
import {
  getPreviousYearMonth,
  getSortedCategoriesForMonths,
  getSortedFinancialCategories,
  getYTDMonthCount,
} from '@/lib/calculations';
import {
  buildPeriod,
  fromMonthly,
  periodValue,
  previousYearPeriod,
  quarterMonthNumbers,
  rateForMonth,
  type Period,
} from '@/lib/period';
import type { ViewMode } from '@/lib/types';
import {
  categorySortSide,
  mergeCategoryData,
  selectCategoryData,
  sumCategoryMonthly,
} from '@/lib/category-selection';
import type { Currency, ExchangeRateData } from '@/lib/exchange-rates';
import { currencyUnitLabel, yoyIndex } from '@/utils/formatters';

/** 한 셀에 담기는 값 — 금액 / 전년비 증감 / 전년=100 지수 */
type CellMetrics = {
  curr: number | null;
  delta: number | null;
  index: number | null;
};

/** 누계 열만 배경으로 구분 (월 열은 흰 바탕 유지) */
const YTD_HEAD_BG = 'bg-slate-200/70';
const YTD_CELL_BG = 'bg-slate-50';

interface MonthlyAccountMatrixTableProps {
  /** 선택 사업부(법인이면 합산본) */
  costs: BusinessUnitCosts | undefined;
  unitName: string;
  selectedMonth: string;
  activeTab: CostType;
  costBasis: CostBasis;
  currency: Currency;
  exchangeRates: ExchangeRateData | null;
  /** 비용 데이터가 있는 월 목록 — 빈 열을 만들지 않기 위해 교집합만 표시 */
  availableMonths: string[];
}

/** 표시 단위(천위안/백만원)로 줄인 정수 */
function scaled(value: number, currency: Currency): number {
  return Math.round(currency === 'CNY' ? value / 1000 : value / 1_000_000);
}

function amountText(value: number | null, currency: Currency): string {
  if (value === null) return '—';
  const n = scaled(value, currency);
  if (n === 0) return value === 0 ? '—' : '0';
  return n.toLocaleString('en-US');
}

/** 증감액 — 음수는 △ (감소) */
function deltaText(value: number | null, currency: Currency): string | null {
  if (value === null) return null;
  const n = scaled(value, currency);
  if (n === 0) return '±0';
  return n > 0 ? `+${n.toLocaleString('en-US')}` : `△${Math.abs(n).toLocaleString('en-US')}`;
}

/** "2026-06" → "26.06" */
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y.slice(2)}.${m}`;
}

export default function MonthlyAccountMatrixTable({
  costs,
  unitName,
  selectedMonth,
  activeTab,
  costBasis,
  currency,
  exchangeRates,
  availableMonths,
}: MonthlyAccountMatrixTableProps) {
  const isFinancial = costBasis === '재무식';
  const year = selectedMonth.split('-')[0] ?? '';

  /** 기준월이 속한 해의 1월~기준월 중 데이터가 있는 달 */
  const months = useMemo(() => {
    if (!selectedMonth) return [];
    return availableMonths.filter(m => m.startsWith(`${year}-`) && m <= selectedMonth).sort();
  }, [availableMonths, year, selectedMonth]);

  const ytdPeriod = useMemo(() => buildPeriod(selectedMonth, '누적(YTD)'), [selectedMonth]);

  /** 데이터가 있는 분기만 열로 — 3분기 데이터가 들어오면 자동으로 늘어난다 */
  const quarters = useMemo(() => {
    if (months.length === 0) return [];
    const shown = new Set(months);
    const out: { label: string; period: Period }[] = [];
    for (let q = 1; q <= 4; q++) {
      const hasData = quarterMonthNumbers(q).some(n =>
        shown.has(`${year}-${String(n).padStart(2, '0')}`)
      );
      if (!hasData) continue;
      out.push({
        label: `${q}분기`,
        period: buildPeriod(`${year}-${String(q * 3).padStart(2, '0')}`, `${q}분기` as ViewMode),
      });
    }
    return out;
  }, [months, year]);

  const categoryData = useMemo(
    () => selectCategoryData(costs, costBasis, activeTab),
    [costs, costBasis, activeTab]
  );

  /** 표시 순서 — 카드(CostTypeTabs)와 동일 규칙 */
  const categories = useMemo(() => {
    if (months.length === 0) return [];
    if (isFinancial) {
      const sumOverYear = (monthly: MonthlyAmounts) =>
        months.reduce((s, m) => s + Math.abs(monthly[m] ?? 0), 0);
      return getSortedFinancialCategories(categoryData, selectedMonth, false, sumOverYear);
    }
    return getSortedCategoriesForMonths(categoryData, months, categorySortSide(activeTab));
  }, [categoryData, months, selectedMonth, isFinancial, activeTab]);

  const totalMonthly = useMemo(
    () => sumCategoryMonthly(categoryData, categories),
    [categoryData, categories]
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((category: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  /**
   * 하위 계정 — 좌측 카드와 같은 소스.
   * 관리식: 급여=급여 중분류, 복리비=복리 중분류, 그 외=G/L 계정 설명 / 재무식: pkg 계정과목(+조정)
   */
  const subAccountsOf = useCallback(
    (category: string): Record<string, MonthlyAmounts> | undefined => {
      if (!costs) return undefined;
      const bySide = (
        side: { 직접비?: Record<string, MonthlyAmounts>; 영업비?: Record<string, MonthlyAmounts> }
      ) => {
        if (activeTab === '직접비') return side.직접비;
        if (activeTab === '영업비') return side.영업비;
        return mergeCategoryData(side.직접비 ?? {}, side.영업비 ?? {});
      };

      if (isFinancial) return costs.재무식PKG?.[category];
      if (category === '급여' && costs.급여중분류) return bySide(costs.급여중분류);
      if (category === '복리비' && costs.복리중분류) {
        return bySide({
          직접비: costs.복리중분류.직접비?.중분류,
          영업비: costs.복리중분류.영업비?.중분류,
        });
      }
      const gl = costs.대분류별GL설명;
      if (!gl) return undefined;
      return bySide({
        직접비: gl.직접비?.[category],
        영업비: gl.영업비?.[category],
      });
    },
    [costs, isFinancial, activeTab]
  );

  /** 표시 기간 금액 절대값 큰 순 */
  const sortSubKeys = useCallback(
    (subMap: Record<string, MonthlyAmounts>) =>
      Object.keys(subMap)
        .filter(k => months.some(m => (subMap[k]?.[m] ?? 0) !== 0))
        .sort((a, b) => {
          const sum = (key: string) =>
            months.reduce((s, m) => s + Math.abs(subMap[key]?.[m] ?? 0), 0);
          return sum(b) - sum(a);
        }),
    [months]
  );

  /** 월 셀 — 각 달의 월평균 환율로 환산 (환율 없으면 null) */
  const monthCell = useCallback(
    (monthly: MonthlyAmounts | undefined, month: string): CellMetrics => {
      const convert = (m: string): number | null => {
        const cny = monthly?.[m] ?? 0;
        if (currency === 'CNY') return cny;
        const rate = rateForMonth(exchangeRates, m, '월평균');
        return rate === null ? null : cny * rate;
      };
      const curr = convert(month);
      const prev = convert(getPreviousYearMonth(month));
      return {
        curr,
        delta: curr === null || prev === null ? null : curr - prev,
        index: yoyIndex(curr, prev),
      };
    },
    [currency, exchangeRates]
  );

  /** 누계 셀 — 카드·KPI와 동일 규칙(KRW는 기간평균 환율) */
  const periodCell = useCallback(
    (monthly: MonthlyAmounts | undefined, period: Period): CellMetrics => {
      const accessor = fromMonthly(monthly);
      const curr = periodValue(accessor, period, currency, exchangeRates);
      const prev = periodValue(accessor, previousYearPeriod(period), currency, exchangeRates);
      return {
        curr,
        delta: curr === null || prev === null ? null : curr - prev,
        index: yoyIndex(curr, prev),
      };
    },
    [currency, exchangeRates]
  );

  const accountLabel = isFinancial ? '연결계정과목' : '대분류';
  const ytdLabel = `누계(1-${getYTDMonthCount(selectedMonth)}월)`;
  const empty = months.length === 0 || categories.length === 0;

  return (
    <section
      className="w-full min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)] overflow-hidden"
      aria-label={`${unitName} ${year}년 월별 계정 추이`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-800 text-white">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold tracking-tight">
            {year}년 월별 계정 추이
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/20">
            {unitName}
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/20">
            {costBasis}
            {!isFinancial && ` · ${activeTab}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded-md bg-slate-700/70 ring-1 ring-white/10">
            단위 {currencyUnitLabel(currency)}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-700/70 ring-1 ring-white/10 text-slate-300">
            셀 = 금액 / 전년비 증감 · 지수
          </span>
        </div>
      </div>

      {empty ? (
        <div className="flex items-center justify-center min-h-[12rem] text-sm text-slate-400">
          표시할 계정 데이터가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-600">
                <th className="sticky left-0 z-20 bg-slate-100 text-left font-semibold px-3 py-2 border-b border-slate-200 min-w-[6.5rem] whitespace-nowrap">
                  {accountLabel}
                </th>
                {months.map(month => (
                  <th
                    key={month}
                    className="text-right font-medium px-2 py-2 border-b border-slate-200 tabular-nums whitespace-nowrap min-w-[5rem]"
                  >
                    {monthLabel(month)}
                  </th>
                ))}
                {quarters.map((q, i) => (
                  <th
                    key={q.label}
                    className={`text-right font-semibold px-2 py-2 border-b border-slate-200 whitespace-nowrap min-w-[5rem] ${YTD_HEAD_BG} ${
                      i === 0 ? 'border-l-2 border-l-slate-300' : ''
                    }`}
                  >
                    {q.label}
                  </th>
                ))}
                <th
                  className={`text-right font-semibold px-2 py-2 border-b border-l border-slate-300 whitespace-nowrap min-w-[5.5rem] ${YTD_HEAD_BG}`}
                >
                  {ytdLabel}
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-800">
              <MatrixRow
                label="전체 합계"
                monthly={totalMonthly}
                months={months}
                monthCell={monthCell}
                quarterCells={quarters.map(q => periodCell(totalMonthly, q.period))}
                ytdCell={periodCell(totalMonthly, ytdPeriod)}
                currency={currency}
                isTotal
              />
              {categories.map(category => {
                const subMap = subAccountsOf(category);
                const subKeys = subMap ? sortSubKeys(subMap) : [];
                const isOpen = expanded.has(category);
                return (
                  <Fragment key={category}>
                    <MatrixRow
                      label={category}
                      monthly={categoryData[category]}
                      months={months}
                      monthCell={monthCell}
                      quarterCells={quarters.map(q => periodCell(categoryData[category], q.period))}
                      ytdCell={periodCell(categoryData[category], ytdPeriod)}
                      currency={currency}
                      expandable={subKeys.length > 0}
                      expanded={isOpen}
                      onToggle={() => toggle(category)}
                    />
                    {isOpen &&
                      subKeys.map(sub => (
                        <MatrixRow
                          key={`${category}-${sub}`}
                          label={sub}
                          monthly={subMap![sub]}
                          months={months}
                          monthCell={monthCell}
                          quarterCells={quarters.map(q => periodCell(subMap![sub], q.period))}
                          ytdCell={periodCell(subMap![sub], ytdPeriod)}
                          currency={currency}
                          isSub
                        />
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 금액 + 전년비 증감·지수 (2줄) */
function MetricCell({
  metrics,
  currency,
  strong = false,
}: {
  metrics: CellMetrics;
  currency: Currency;
  strong?: boolean;
}) {
  const main = amountText(metrics.curr, currency);
  const delta = deltaText(metrics.delta, currency);
  const up = metrics.index !== null && metrics.index >= 100;
  const subTone =
    metrics.index === null ? 'text-slate-400' : up ? 'text-rose-500' : 'text-sky-600';
  /** 당년·전년 모두 없는 칸은 증감 줄을 비운다 (±0 잡음 제거) */
  const blank =
    metrics.curr === null ||
    (Math.round(metrics.curr) === 0 && Math.round(metrics.delta ?? 0) === 0);

  return (
    <>
      <div
        className={`tabular-nums leading-tight ${strong ? 'font-semibold' : 'font-medium'} ${
          main === '—' ? 'text-slate-300' : ''
        }`}
      >
        {main}
      </div>
      <div className={`tabular-nums leading-tight text-[10px] ${subTone}`}>
        {blank ? (
          ' '
        ) : (
          <>
            {delta ?? '—'}
            {metrics.index !== null && <span className="ml-1">{metrics.index}%</span>}
          </>
        )}
      </div>
    </>
  );
}

function MatrixRow({
  label,
  monthly,
  months,
  monthCell,
  quarterCells,
  ytdCell,
  currency,
  isTotal = false,
  isSub = false,
  expandable = false,
  expanded = false,
  onToggle,
}: {
  label: string;
  monthly: MonthlyAmounts | undefined;
  months: string[];
  monthCell: (monthly: MonthlyAmounts | undefined, month: string) => CellMetrics;
  quarterCells: CellMetrics[];
  ytdCell: CellMetrics;
  currency: Currency;
  isTotal?: boolean;
  isSub?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  // 색은 최소로 — 합계 행은 굵은 글씨와 굵은 밑줄, 하위 계정은 들여쓰기로만 구분한다
  const rowClass = isTotal
    ? 'border-b border-slate-300 font-semibold text-slate-900'
    : isSub
      ? 'border-b border-slate-50 text-slate-600'
      : 'border-b border-slate-100 hover:bg-slate-50/70';

  return (
    <tr className={rowClass}>
      <td
        className={`sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap ${
          isTotal || isSub ? '' : 'font-medium'
        }`}
      >
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex items-center gap-1.5 w-full text-left cursor-pointer hover:text-slate-950"
          >
            <span className="text-slate-400 w-3 shrink-0" aria-hidden>
              {expanded ? '∨' : '›'}
            </span>
            <span>{label}</span>
          </button>
        ) : (
          <span className={isSub ? 'pl-[1.35rem] block text-[10.5px]' : 'pl-[1.15rem] block'}>
            {label}
          </span>
        )}
      </td>
      {months.map(month => (
        <td key={month} className={`text-right px-2 py-1.5 align-top ${isSub ? 'text-[10.5px]' : ''}`}>
          <MetricCell metrics={monthCell(monthly, month)} currency={currency} strong={isTotal} />
        </td>
      ))}
      {quarterCells.map((cell, i) => (
        <td
          key={i}
          className={`text-right px-2 py-1.5 align-top ${YTD_CELL_BG} ${
            i === 0 ? 'border-l-2 border-l-slate-300' : ''
          } ${isSub ? 'text-[10.5px]' : ''}`}
        >
          <MetricCell metrics={cell} currency={currency} strong={!isSub} />
        </td>
      ))}
      <td
        className={`text-right px-2 py-1.5 align-top border-l border-slate-300 ${YTD_CELL_BG} ${
          isSub ? 'text-[10.5px]' : ''
        }`}
      >
        <MetricCell metrics={ytdCell} currency={currency} strong={!isSub} />
      </td>
    </tr>
  );
}
