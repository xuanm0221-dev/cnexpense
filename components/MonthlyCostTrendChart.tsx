'use client';

/**
 * 월별 비용 스택 막대 + YOY(전년=100 기준 지수%) 라인 — SVG (recharts 미사용, Webpack 호환)
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
import type { CategoryData } from '@/lib/types';
import {
  calculateCategoryTotal,
  calculateYTD,
  getAmountForMonth,
  getPreviousYearMonth,
  getSortedCategoriesForMonths,
  getYTDMonthCount,
} from '@/lib/calculations';
import { getDetailTrendCategoryColor } from '@/lib/category-chart-colors';


// 막대/범례 색: 대분류명 단일 매핑. 직접비·영업비 탭은 데이터만 바꾸며 팔레트 분기 없음.

const VB_W = 1380;
/** plotH 유지(316) 위해 bottom 축소분만큼 높이 동시 감소 — 월 라벨~viewBox 하단 빈 여백 축소 */
const VB_H = 424;
const M = { top: 32, right: 78, bottom: 76, left: 84 };
/** 좌·우 Y축 제목 한 줄 (축 눈금과 간격 확보) */
const Y_TITLE_Y = M.top - 18;

const AXIS_STROKE = '#334155';
const AXIS_WIDTH = 1.1;
const AXIS_TICK_STROKE = '#94a3b8';
const GRID_STROKE = '#e7edf5';
const GRID_DASH = '3 7';
const GRID_OPACITY = 0.95;
const YOY_REF_STROKE = '#cbd5e1';

const CATEGORIES_WITH_IN_BAR_LABEL = new Set(['급여', '복리비', '광고비', '수주회']);

/** Catmull–Rom 스타일 제어점으로 부드러운 SVG cubic 경로 */
function smoothLinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function relativeLuminance(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0.5;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(rgb.r);
  const G = lin(rgb.g);
  const B = lin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastTextForBg(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.55 ? '#1f2937' : '#ffffff';
}

/** 막대 안에 들어갈 수 있는 폰트 크기(px); 불가면 null */
function fitBarLabelFontSize(label: string, barW: number, h: number): number | null {
  const MIN_H = 13;
  const MIN_W = 20;
  if (h < MIN_H || barW < MIN_W) return null;
  const len = Math.max(label.length, 1);
  let fs = Math.min(11, (barW * 0.88) / (len * 0.58), h * 0.4);
  fs = Math.floor(fs * 10) / 10;
  if (fs < 5) return null;
  const estW = len * fs * 0.58;
  if (estW > barW * 0.9 || fs > h * 0.36) {
    fs = Math.min(fs, (barW * 0.88) / (len * 0.58), h * 0.36);
    fs = Math.floor(fs * 10) / 10;
  }
  if (fs < 5 || len * fs * 0.58 > barW * 0.92) return null;
  return fs;
}

/** 직전 막대와 연도가 같으면 월만, 연도가 바뀌거나 첫 막대면 yy.m월 */
function formatRollingXAxisLabel(monthKey: string, prevMonthKey: string | null): string {
  const [y, m] = monthKey.split('-');
  const yy = y.slice(2);
  const mo = parseInt(m, 10);
  if (prevMonthKey === null) return `${yy}.${mo}월`;
  const [py] = prevMonthKey.split('-');
  if (py !== y) return `${yy}.${mo}월`;
  return `${mo}월`;
}

function formatTooltipHeading(ym: string): string {
  const [y, mo] = ym.split('-');
  return `${y}년${parseInt(mo, 10)}월(K)`;
}

function yoyIndexFromAmounts(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return 100 + Math.round(((curr - prev) / Math.abs(prev)) * 100);
}

function formatTooltipAmtThousand(amountRaw: number): string {
  return Math.round(amountRaw / 1000).toLocaleString('en-US');
}

/** 툴팁 표 3열 헤더: 예 YTD(1-2월) */
function formatYtdColumnHeader(monthKey: string): string {
  const n = getYTDMonthCount(monthKey);
  return `YTD(1-${n}월)`;
}

type CostSide = '직접비' | '영업비';

interface MonthlyCostTrendChartProps {
  categoryData: CategoryData;
  months: string[];
  costType: CostSide;
  onCostTypeChange: (t: CostSide) => void;
  /** 기준월 막대의 YOY 점 강조(흰 채움 + 빨간 테두리) */
  highlightMonthKey?: string | null;
  /** 둘 다 주면 범례 선택을 상위에서 제어 (법인 상세 KPI 연동용) */
  legendSelected?: Set<string>;
  onLegendSelectedChange?: (next: Set<string>) => void;
}

type ChartRow = Record<string, string | number | null> & {
  monthKey: string;
  label: string;
  totalRaw: number;
  prevTotalRaw: number;
  yoyIndex: number | null;
};

function niceStep(max: number, tickCount: number): number {
  if (max <= 0) return 1;
  const rough = max / tickCount;
  const p10 = 10 ** Math.floor(Math.log10(rough));
  const err = rough / p10;
  const niceErr = err <= 1 ? 1 : err <= 2 ? 2 : err <= 5 ? 5 : 10;
  return niceErr * p10;
}

export default function MonthlyCostTrendChart({
  categoryData,
  months,
  costType,
  onCostTypeChange,
  highlightMonthKey,
  legendSelected: legendSelectedProp,
  onLegendSelectedChange,
}: MonthlyCostTrendChartProps) {
  const [expanded, setExpanded] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [legendSelectedInternal, setLegendSelectedInternal] = useState<Set<string>>(
    () => new Set()
  );

  const isLegendControlled =
    legendSelectedProp !== undefined && onLegendSelectedChange !== undefined;
  const legendSelected = isLegendControlled ? legendSelectedProp! : legendSelectedInternal;

  const sortedCategories = useMemo(
    () => getSortedCategoriesForMonths(categoryData, months, costType),
    [categoryData, months, costType]
  );

  useEffect(() => {
    if (isLegendControlled) return;
    setLegendSelectedInternal(new Set(sortedCategories));
  }, [sortedCategories, isLegendControlled]);

  const visibleCategories = useMemo(
    () => sortedCategories.filter(c => legendSelected.has(c)),
    [sortedCategories, legendSelected]
  );

  const setLegendSelected = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      if (isLegendControlled) {
        onLegendSelectedChange!(updater(legendSelectedProp!));
      } else {
        setLegendSelectedInternal(prev => updater(prev));
      }
    },
    [isLegendControlled, onLegendSelectedChange, legendSelectedProp]
  );

  const toggleLegendCategory = useCallback((cat: string) => {
    setLegendSelected(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, [setLegendSelected]);

  const selectAllLegend = useCallback(() => {
    setLegendSelected(() => new Set(sortedCategories));
  }, [sortedCategories, setLegendSelected]);

  const deselectAllLegend = useCallback(() => {
    setLegendSelected(() => new Set());
  }, [setLegendSelected]);

  /** 전체 대분류·합계·툴팁용 (월별 k·전체 total·전체 YOY) */
  const chartDataFull: ChartRow[] = useMemo(() => {
    return months.map((monthKey, idx) => {
      const prevKey = idx > 0 ? months[idx - 1]! : null;
      const row: ChartRow = {
        monthKey,
        label: formatRollingXAxisLabel(monthKey, prevKey),
        totalRaw: 0,
        prevTotalRaw: 0,
        yoyIndex: null,
      };

      const prevM = getPreviousYearMonth(monthKey);
      for (const cat of sortedCategories) {
        const raw = getAmountForMonth(categoryData[cat], monthKey);
        const k = raw / 1000;
        row[cat] = k;
        row.totalRaw += raw;
        row.prevTotalRaw += getAmountForMonth(categoryData[cat], prevM);
      }

      if (row.prevTotalRaw !== 0) {
        row.yoyIndex =
          100 +
          Math.round(
            ((row.totalRaw - row.prevTotalRaw) / Math.abs(row.prevTotalRaw)) * 100
          );
      }

      return row;
    });
  }, [months, sortedCategories, categoryData]);

  /** 막대·좌측 Y축·YOY 곡선: 범례 선택 대분류만 */
  const chartDataFiltered: ChartRow[] = useMemo(() => {
    return chartDataFull.map(row => {
      const prevM = getPreviousYearMonth(row.monthKey);
      let totalRaw = 0;
      let prevTotalRaw = 0;
      for (const cat of visibleCategories) {
        const series = categoryData[cat];
        if (!series) continue;
        totalRaw += getAmountForMonth(series, row.monthKey);
        prevTotalRaw += getAmountForMonth(series, prevM);
      }
      let yoyIndex: number | null = null;
      if (prevTotalRaw !== 0) {
        yoyIndex =
          100 +
          Math.round(
            ((totalRaw - prevTotalRaw) / Math.abs(prevTotalRaw)) * 100
          );
      }
      return { ...row, totalRaw, prevTotalRaw, yoyIndex };
    });
  }, [chartDataFull, visibleCategories, categoryData]);

  const plotW = VB_W - M.left - M.right;
  const plotH = VB_H - M.top - M.bottom;
  const n = Math.max(chartDataFiltered.length, 1);
  const slotW = plotW / n;
  const barW = slotW * 0.55;

  const maxTotalK = useMemo(() => {
    let m = 0;
    for (const r of chartDataFiltered) {
      const t = r.totalRaw / 1000;
      if (t > m) m = t;
    }
    return m > 0 ? m * 1.08 : 1;
  }, [chartDataFiltered]);

  const leftTicks = useMemo(() => {
    const step = niceStep(maxTotalK, 5);
    const ticks: number[] = [];
    for (let v = 0; v <= maxTotalK + step * 0.01; v += step) {
      ticks.push(Number(v.toFixed(6)));
    }
    if (ticks.length > 6) ticks.splice(6);
    return ticks;
  }, [maxTotalK]);

  const { yoyMin, yoyMax } = useMemo(() => {
    const vals = chartDataFiltered
      .map(r => r.yoyIndex)
      .filter((v): v is number => v !== null);
    if (vals.length === 0) return { yoyMin: 90, yoyMax: 110 };
    let lo = Math.min(100, ...vals);
    let hi = Math.max(100, ...vals);
    const pad = Math.max((hi - lo) * 0.12, 5);
    return { yoyMin: lo - pad, yoyMax: hi + pad };
  }, [chartDataFiltered]);

  const yLeft = useCallback(
    (kVal: number) => M.top + plotH - (kVal / maxTotalK) * plotH,
    [plotH, maxTotalK]
  );

  const yRight = useCallback(
    (pct: number) => M.top + plotH - ((pct - yoyMin) / (yoyMax - yoyMin)) * plotH,
    [plotH, yoyMin, yoyMax]
  );

  const tabBtn = (side: CostSide, active: boolean) => (
    <button
      type="button"
      onClick={() => onCostTypeChange(side)}
      className={`px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-full border transition-all ${
        active
          ? 'bg-white text-slate-800 border-slate-200 shadow-sm shadow-slate-200/60'
          : 'bg-slate-100/95 text-slate-500 border-transparent hover:bg-slate-200/80'
      }`}
    >
      {side}
    </button>
  );

  const yoySmoothPaths = useMemo(() => {
    const paths: string[] = [];
    let cur: { x: number; y: number }[] = [];
    chartDataFiltered.forEach((row, i) => {
      if (row.yoyIndex === null) {
        if (cur.length) {
          paths.push(smoothLinePath(cur));
          cur = [];
        }
      } else {
        cur.push({
          x: M.left + (i + 0.5) * slotW,
          y: yRight(row.yoyIndex),
        });
      }
    });
    if (cur.length) paths.push(smoothLinePath(cur));
    return paths;
  }, [chartDataFiltered, slotW, yRight]);

  /** 마우스 미호버 시 표시할 월(헤더 기준월); 없으면 롤링 구간의 마지막 막대 */
  const baselineIdx = useMemo(() => {
    if (chartDataFiltered.length === 0) return 0;
    if (highlightMonthKey) {
      const i = chartDataFiltered.findIndex(r => r.monthKey === highlightMonthKey);
      if (i >= 0) return i;
    }
    return chartDataFiltered.length - 1;
  }, [chartDataFiltered, highlightMonthKey]);

  const displayIdx = hoverIdx !== null ? hoverIdx : baselineIdx;
  const tooltipRow = chartDataFull[displayIdx] ?? null;

  const legendToolbar =
    expanded &&
    sortedCategories.length > 0 && (
      <div
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-3 ml-1 sm:ml-2 border-l border-slate-200/90 min-w-0"
        role="group"
        aria-label="차트 대분류 범례"
      >
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={selectAllLegend}
            className="shrink-0 rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-xs sm:text-sm font-semibold text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
          >
            전체 선택
          </button>
          <button
            type="button"
            onClick={deselectAllLegend}
            className="shrink-0 rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-xs sm:text-sm font-semibold text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
          >
            전체 해제
          </button>
        </div>
        <span
          className="hidden sm:block w-px h-3.5 shrink-0 self-center bg-slate-200/90"
          aria-hidden
        />
        {sortedCategories.map((cat, i) => {
          const on = legendSelected.has(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggleLegendCategory(cat)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs sm:text-sm font-semibold transition-colors shrink-0 ${
                on
                  ? 'border-slate-400/90 bg-slate-50/90 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
                  : 'border-slate-200/70 bg-white/80 text-slate-400 hover:border-slate-300 hover:bg-slate-50/80 hover:text-slate-600'
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-sm ring-1 ring-black/[0.06]"
                style={{
                  backgroundColor: getDetailTrendCategoryColor(cat, i),
                }}
              />
              {cat}
            </button>
          );
        })}
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-200/90 bg-slate-50/40 px-1.5 py-0.5 text-xs sm:text-sm font-semibold text-slate-500 pointer-events-none shrink-0"
          title="YOY 곡선"
        >
          <span className="h-px w-3.5 shrink-0 rounded-full bg-red-600" />
          YOY
        </span>
      </div>
    );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-md shadow-gray-200/50 ring-1 ring-black/[0.03] overflow-hidden">
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-gray-100/90 bg-gradient-to-b from-white to-gray-50/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
              <h2 className="text-base sm:text-lg font-semibold tracking-[-0.015em] text-slate-900 shrink-0">
                월별 비용 추이 및 YOY 비교 (CNY K)
              </h2>
              <div className="flex items-center gap-2 shrink-0 rounded-full bg-slate-50/90 px-1.5 py-1 ring-1 ring-slate-200/80">
                {tabBtn('영업비', costType === '영업비')}
                {tabBtn('직접비', costType === '직접비')}
              </div>
              {legendToolbar}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">
              기준월을 끝으로 하는 연속 {months.length}개월·대분류 구성 및 전년 동월 대비 증감률(지수%,
              전년=100). 막대·YOY 곡선은 상단 범례에서 선택한 대분류만 반영하며, 우측 표는 항상 전체 합계·전
              대분류를 표시합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="self-end sm:self-start p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-expanded={expanded}
            aria-label={expanded ? '차트 접기' : '차트 펼치기'}
          >
            <svg
              className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 sm:p-6 sm:px-8 bg-gradient-to-b from-gray-50/30 to-white">
          {sortedCategories.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-16">
              선택한 기간·비용 구분에 표시할 대분류 데이터가 없습니다.
            </p>
          ) : (
            <div className="w-full" style={{ minHeight: 440 }}>
              <div className="flex flex-col md:flex-row md:items-start gap-4 w-full">
                <div className="w-full md:w-3/4 min-w-0 shrink-0">
                  <svg
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-auto block text-gray-500 [font-family:system-ui,Segoe_UI,sans-serif]"
                    style={{ maxHeight: 480 }}
                    role="img"
                    aria-label="월별 비용 및 YOY 차트"
                  >
                <defs>
                  <linearGradient id="plotBg" x1={M.left} y1={M.top} x2={M.left} y2={M.top + plotH} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fcfdff" />
                    <stop offset="100%" stopColor="#f8fafc" />
                  </linearGradient>
                </defs>
                <rect
                  x={M.left}
                  y={M.top}
                  width={plotW}
                  height={plotH}
                  fill="url(#plotBg)"
                  rx={6}
                  ry={6}
                  stroke="#e2e8f0"
                  strokeOpacity={0.9}
                  strokeWidth={1}
                />
                <line
                  x1={M.left}
                  y1={M.top + plotH}
                  x2={M.left + plotW}
                  y2={M.top + plotH}
                  stroke={AXIS_STROKE}
                  strokeWidth={AXIS_WIDTH}
                  strokeDasharray="none"
                  strokeLinecap="round"
                />
                <line
                  x1={M.left}
                  y1={M.top}
                  x2={M.left}
                  y2={M.top + plotH}
                  stroke={AXIS_STROKE}
                  strokeWidth={AXIS_WIDTH}
                  strokeLinecap="round"
                />
                {/* grid */}
                {leftTicks.map(t => (
                  <line
                    key={t}
                    x1={M.left}
                    x2={M.left + plotW}
                    y1={yLeft(t)}
                    y2={yLeft(t)}
                    stroke={GRID_STROKE}
                    strokeWidth={1}
                    strokeDasharray={GRID_DASH}
                    strokeOpacity={GRID_OPACITY}
                  />
                ))}
                {/* YOY 100% reference */}
                <line
                  x1={M.left}
                  x2={M.left + plotW}
                  y1={yRight(100)}
                  y2={yRight(100)}
                  stroke={YOY_REF_STROKE}
                  strokeWidth={1}
                  strokeDasharray="5 6"
                  strokeOpacity={0.9}
                />
                {/* left axis */}
                {leftTicks.map(t => (
                  <g key={`yl-${t}`}>
                    <line
                      x1={M.left - 5}
                      x2={M.left}
                      y1={yLeft(t)}
                      y2={yLeft(t)}
                      stroke={AXIS_TICK_STROKE}
                      strokeWidth={1}
                      strokeLinecap="round"
                    />
                    <text
                      x={M.left - 10}
                      y={yLeft(t)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="fill-slate-500 tabular-nums"
                      style={{ fontSize: 10.8, fontWeight: 600, letterSpacing: 0.15 }}
                    >
                      {Number(t.toFixed(0)).toLocaleString('en-US')}K
                    </text>
                  </g>
                ))}
                {/* right axis ticks (4) */}
                {[0, 1, 2, 3].map(i => {
                  const pct = yoyMin + ((yoyMax - yoyMin) * i) / 3;
                  return (
                    <g key={`yr-${i}`}>
                      <line
                        x1={M.left + plotW}
                        x2={M.left + plotW + 5}
                        y1={yRight(pct)}
                        y2={yRight(pct)}
                        stroke={AXIS_TICK_STROKE}
                        strokeWidth={1}
                        strokeLinecap="round"
                      />
                      <text
                        x={M.left + plotW + 10}
                        y={yRight(pct)}
                        dominantBaseline="middle"
                        className="fill-slate-500 tabular-nums"
                        style={{ fontSize: 10.8, fontWeight: 600, letterSpacing: 0.15 }}
                      >
                        {Math.round(pct)}%
                      </text>
                    </g>
                  );
                })}
                {/* Y축 제목: 좌측 상단 금액 · 우측 상단 YOY, 동일 행 */}
                <text
                  x={M.left + 4}
                  y={Y_TITLE_Y}
                  textAnchor="start"
                  dominantBaseline="middle"
                  className="fill-gray-500 font-semibold"
                  style={{ fontSize: 11, letterSpacing: 0.35 }}
                >
                  금액 (K)
                </text>
                <text
                  x={M.left + plotW + 10}
                  y={Y_TITLE_Y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-gray-500 font-semibold"
                  style={{ fontSize: 11, letterSpacing: 0.35 }}
                >
                  YOY (지수%)
                </text>
                {/* hit areas + bars */}
                {chartDataFiltered.map((row, i) => {
                  const cx = M.left + (i + 0.5) * slotW;
                  const x0 = cx - barW / 2;
                  let accK = 0;
                  const segs: { cat: string; yTop: number; h: number; color: string }[] = [];
                  for (const cat of visibleCategories) {
                    const k = Number(row[cat]) || 0;
                    if (k === 0) continue;
                    const yTop = yLeft(accK + k);
                    const yBottom = yLeft(accK);
                    const h = Math.max(yBottom - yTop, 0.5);
                    segs.push({
                      cat,
                      yTop,
                      h,
                      color: getDetailTrendCategoryColor(
                        cat,
                        sortedCategories.indexOf(cat)
                      ),
                    });
                    accK += k;
                  }
                  const stackTop = segs.length > 0 ? segs[segs.length - 1]!.yTop : null;
                  const stackHeight =
                    stackTop !== null ? Math.max(yLeft(0) - stackTop, 0.5) : null;
                  return (
                    <g key={row.monthKey}>
                      <rect
                        x={M.left + i * slotW}
                        y={M.top}
                        width={slotW}
                        height={plotH}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx(null)}
                      />
                      {stackTop !== null && stackHeight !== null && (
                        <rect
                          x={x0 + 1}
                          y={stackTop + 1.25}
                          width={barW}
                          height={stackHeight}
                          rx={5}
                          ry={5}
                          fill="#0f172a"
                          opacity={0.045}
                          pointerEvents="none"
                        />
                      )}
                      {segs.map((s, si) => {
                        const isTop = si === segs.length - 1;
                        const showLabel =
                          CATEGORIES_WITH_IN_BAR_LABEL.has(s.cat) &&
                          s.h >= 1;
                        const labelFs = showLabel
                          ? fitBarLabelFontSize(s.cat, barW, s.h)
                          : null;
                        return (
                          <g key={s.cat}>
                            <rect
                              x={x0}
                              y={s.yTop}
                              width={barW}
                              height={s.h}
                              rx={isTop ? 4 : 0}
                              ry={isTop ? 4 : 0}
                              fill={s.color}
                              stroke="#f8fafc"
                              strokeOpacity={0.95}
                              strokeWidth={0.85}
                              opacity={0.98}
                              pointerEvents="none"
                            />
                            {labelFs !== null && (
                              <text
                                x={x0 + barW / 2}
                                y={s.yTop + s.h / 2}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={contrastTextForBg(s.color)}
                                style={{
                                  fontSize: labelFs,
                                  fontWeight: 600,
                                  pointerEvents: 'none',
                                }}
                              >
                                {s.cat}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
                {/* YOY 곡선 (null 월에서 끊김) */}
                {yoySmoothPaths.map((d, idx) => (
                  <path
                    key={`yoy-${idx}`}
                    d={d}
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                ))}
                {chartDataFiltered.map((row, i) => {
                  if (row.yoyIndex === null) return null;
                  const cx = M.left + (i + 0.5) * slotW;
                  const cy = yRight(row.yoyIndex);
                  const isHighlight =
                    Boolean(highlightMonthKey) && row.monthKey === highlightMonthKey;
                  return (
                    <circle
                      key={`dot-${row.monthKey}`}
                      cx={cx}
                      cy={cy}
                      r={isHighlight ? 5.5 : 4}
                      fill={isHighlight ? '#ffffff' : '#dc2626'}
                      stroke={isHighlight ? '#dc2626' : 'none'}
                      strokeWidth={isHighlight ? 2.25 : 0}
                      pointerEvents="none"
                    />
                  );
                })}
                {/* x labels */}
                {chartDataFiltered.map((row, i) => {
                  const cx = M.left + (i + 0.5) * slotW;
                  return (
                    <g key={`xl-${row.monthKey}`}>
                      <line
                        x1={cx}
                        x2={cx}
                        y1={M.top + plotH}
                        y2={M.top + plotH + 5}
                        stroke={AXIS_TICK_STROKE}
                        strokeWidth={1}
                        strokeLinecap="round"
                      />
                      <text
                        x={cx}
                        y={M.top + plotH + 22}
                        textAnchor="middle"
                        dominantBaseline="hanging"
                        className="fill-slate-600"
                        style={{ fontSize: 9.8, fontWeight: 600, letterSpacing: 0.15 }}
                      >
                        {row.label}
                      </text>
                    </g>
                  );
                })}
                  </svg>
                </div>
                <div className="w-full md:w-1/4 md:min-w-[11rem] shrink-0 md:pl-1">
                  {tooltipRow && (
                    <ChartTooltip
                      row={tooltipRow}
                      sortedCategories={sortedCategories}
                      categoryData={categoryData}
                      highlightCategories={legendSelected}
                      isBaselineMonth={
                        hoverIdx === null && tooltipRow.monthKey === highlightMonthKey
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const tooltipRowGridClass =
  'grid grid-cols-[minmax(0,1fr)_minmax(5rem,1fr)_minmax(5rem,1fr)] gap-x-2.5 items-center text-[10px] sm:text-[11px]';

const tooltipNumCellClass = 'min-w-0 w-full text-right tabular-nums';

function ChartTooltip({
  row,
  sortedCategories,
  categoryData,
  highlightCategories,
  isBaselineMonth = false,
}: {
  row: ChartRow;
  sortedCategories: string[];
  categoryData: CategoryData;
  highlightCategories: ReadonlySet<string>;
  isBaselineMonth?: boolean;
}) {
  const prevKey = getPreviousYearMonth(row.monthKey);
  const ytdCurrTotal = calculateCategoryTotal(categoryData, row.monthKey, true);
  const ytdPrevTotal = calculateCategoryTotal(categoryData, prevKey, true);
  const ytdTotalIdx = yoyIndexFromAmounts(ytdCurrTotal, ytdPrevTotal);
  const monthTotalIdx = row.yoyIndex;

  const fmtPair = (amt: number, idx: number | null) =>
    `${formatTooltipAmtThousand(amt)} (${idx ?? 'N/A'}%)`;

  return (
    <div
      className="w-full rounded-2xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/70 px-3.5 py-3 sm:px-4 sm:py-3.5 text-[11px] sm:text-xs shadow-[0_14px_34px_rgba(15,23,42,0.10)] backdrop-blur-sm pointer-events-none ring-1 ring-white/70"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2.5 min-w-0">
        <span className="font-semibold tracking-[0.01em] text-slate-900">
          {formatTooltipHeading(row.monthKey)}
        </span>
        {isBaselineMonth && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded-md shrink-0">
            기준월
          </span>
        )}
      </div>
      <div className="mt-1 pt-2.5 border-t border-slate-200/80">
        <div
          className="flex flex-col gap-y-1.5"
          role="table"
          aria-label="대분류별 당월 및 YTD"
        >
          <div className={tooltipRowGridClass}>
            <div className="text-slate-500 font-semibold truncate pr-0.5 text-left min-w-0">
              계정
            </div>
            <div className={`${tooltipNumCellClass} text-slate-500 font-semibold`}>당월</div>
            <div className={`${tooltipNumCellClass} text-slate-500 font-semibold leading-tight`}>
              {formatYtdColumnHeader(row.monthKey)}
            </div>
          </div>
          <div className={tooltipRowGridClass}>
            <div className="font-semibold text-slate-900 text-left min-w-0 truncate">
              합계
            </div>
            <div
              className={`${tooltipNumCellClass} font-semibold leading-snug ${monthTotalIdx !== null && monthTotalIdx >= 100 ? 'text-red-600' : 'text-blue-600'}`}
            >
              {fmtPair(row.totalRaw, monthTotalIdx)}
            </div>
            <div
              className={`${tooltipNumCellClass} font-semibold leading-snug ${ytdTotalIdx !== null && ytdTotalIdx >= 100 ? 'text-red-600' : 'text-blue-600'}`}
            >
              {fmtPair(ytdCurrTotal, ytdTotalIdx)}
            </div>
          </div>
          <div className="h-px my-0.5 bg-gradient-to-r from-slate-200/0 via-slate-200 to-slate-200/0" />
          {sortedCategories.map(cat => {
            const series = categoryData[cat];
            if (!series) return null;
            const currM = getAmountForMonth(series, row.monthKey);
            const prevM = getAmountForMonth(series, prevKey);
            const ytdC = calculateYTD(series, row.monthKey);
            const ytdP = calculateYTD(series, prevKey);
            if (currM === 0 && ytdC === 0) return null;
            const yiM = yoyIndexFromAmounts(currM, prevM);
            const yiY = yoyIndexFromAmounts(ytdC, ytdP);
            /** 범례 선택 대분류는 일반 톤, 미선택은 글씨만 연하게(배경 없음) */
            const inLegendSelection = highlightCategories.has(cat);
            return (
              <div
                key={cat}
                className={`${tooltipRowGridClass} py-1 px-1 -mx-0.5 min-w-0`}
              >
                <div className="flex items-center gap-1.5 min-w-0 text-left">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ring-1 shadow-sm ${
                      inLegendSelection ? 'ring-white/90' : 'ring-white/50 opacity-50'
                    }`}
                    style={{
                      backgroundColor: getDetailTrendCategoryColor(
                        cat,
                        sortedCategories.indexOf(cat)
                      ),
                    }}
                  />
                  <span
                    className={`min-w-0 truncate ${inLegendSelection ? 'font-medium text-slate-800' : 'text-slate-400'}`}
                  >
                    {cat}
                  </span>
                </div>
                <div
                  className={`${tooltipNumCellClass} leading-snug ${inLegendSelection ? 'font-medium text-slate-700' : 'text-slate-400'}`}
                >
                  {fmtPair(currM, yiM)}
                </div>
                <div
                  className={`${tooltipNumCellClass} leading-snug ${inLegendSelection ? 'font-medium text-slate-700' : 'text-slate-400'}`}
                >
                  {fmtPair(ytdC, yiY)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
