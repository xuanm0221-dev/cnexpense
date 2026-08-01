'use client';

/**
 * 사업부 카드 컴포넌트
 */

import { useState, useMemo } from 'react';
import {
  BusinessUnitCosts,
  CostBasis,
  ViewMode,
  CostType,
  MonthlyAmounts,
  RetailChannelBreakdown,
  RetailRangeMetrics,
} from '@/lib/types';
import {
  buildPeriod,
  combineAccessors,
  fromCategoryData,
  fromMonthly,
  headcountForPeriod,
  periodCny,
  periodValue,
  previousYearPeriod,
  rateForMonth,
} from '@/lib/period';
import {
  formatAmount,
  formatDelta,
  formatPerPerson,
  formatPerPersonDelta,
  yoyIndex,
} from '@/utils/formatters';
import type { Currency, ExchangeRateData } from '@/lib/exchange-rates';
import CostTypeTabs from './CostTypeTabs';

interface BusinessUnitCardProps {
  id: string;
  name: string;
  color: string;
  data: BusinessUnitCosts;
  selectedMonth: string;
  viewMode: ViewMode;
  officeHeadcount?: number | null; // 사무실 인원수 (현재 월)
  storeHeadcount?: number | null; // 매장 인원수 (현재 월)
  officeHeadcountData?: MonthlyAmounts | null; // 사무실 인원수 전체 데이터 (YoY 계산용)
  storeHeadcountData?: MonthlyAmounts | null; // 매장 인원수 전체 데이터 (YoY 계산용)
  retailSales?: number | null; // 리테일 매출 (현재 월)
  retailSalesData?: MonthlyAmounts | null; // 리테일 매출 전체 데이터 (YoY 계산용)
  retailChannels?: RetailChannelBreakdown[]; // 채널 분해 (직영 ON/OFF · 대리상 ON/OFF · 미지정)
  retailMetrics?: RetailRangeMetrics | null; // 실판·Tag·할인율 (호버 표시용)
  activeTab?: CostType; // 직접비/영업비/전체 탭 (상위에서 제어 시 모든 카드 동기화)
  onTabChange?: (tab: CostType) => void;
  costBasis?: CostBasis; // 관리식(대분류×직접/영업) / 재무식(연결계정과목)
  /** 제목을 드롭다운으로 — 사업부 전환용. 없으면 일반 제목 */
  unitOptions?: { id: string; name: string }[];
  onUnitChange?: (unitId: string) => void;
  currency?: Currency; // 표시 통화 (재무식에서만 KRW 가능)
  exchangeRates?: ExchangeRateData | null; // 환율표 (분기는 누적 차감으로 환산)
  salarySubExpanded?: boolean;
  onSalarySubExpandedChange?: (open: boolean) => void;
  welfareSubExpanded?: boolean;
  onWelfareSubExpandedChange?: (open: boolean) => void;
}

/** 탭별 인원 기준값 (직접비=매장, 영업비=사무실, 전체=합) */
function basisForTab(
  office: number | null,
  store: number | null,
  tab: CostType
): number | null {
  if (tab === '직접비') return store;
  if (tab === '영업비') return office;
  const total = (office ?? 0) + (store ?? 0);
  return total > 0 ? total : null;
}

export default function BusinessUnitCard({
  id,
  name,
  color,
  data,
  selectedMonth,
  viewMode,
  officeHeadcount,
  storeHeadcount,
  officeHeadcountData,
  storeHeadcountData,
  retailSales,
  retailSalesData,
  retailChannels,
  retailMetrics,
  activeTab: externalActiveTab,
  onTabChange,
  costBasis = '관리식',
  unitOptions,
  onUnitChange,
  currency = 'CNY',
  exchangeRates = null,
  salarySubExpanded,
  onSalarySubExpandedChange,
  welfareSubExpanded,
  onWelfareSubExpandedChange,
}: BusinessUnitCardProps) {
  const isFinancial = costBasis === '재무식';
  /** 재무식 = 연결계정과목 기준, 직접/영업 구분 없음 → 탭·인원은 항상 '전체' */
  const financialCosts = data.재무식 ?? {};

  // 조회 기간 (당월 / 누적 / 분기) 과 전년 동기간
  const period = useMemo(
    () => buildPeriod(selectedMonth, viewMode),
    [selectedMonth, viewMode]
  );
  const prevPeriod = useMemo(() => previousYearPeriod(period), [period]);

  /**
   * 인원수 기준 — 인원은 스톡이라 합산하지 않는다.
   * 당월=해당 월, 누적=1월~선택월 평균, 분기=분기 3개월 평균
   */
  const officeBasis = useMemo(
    () => headcountForPeriod(officeHeadcountData, period),
    [officeHeadcountData, period]
  );
  const storeBasis = useMemo(
    () => headcountForPeriod(storeHeadcountData, period),
    [storeHeadcountData, period]
  );
  const officeBasisPrev = useMemo(
    () => headcountForPeriod(officeHeadcountData, prevPeriod),
    [officeHeadcountData, prevPeriod]
  );
  const storeBasisPrev = useMemo(
    () => headcountForPeriod(storeHeadcountData, prevPeriod),
    [storeHeadcountData, prevPeriod]
  );

  // activeTab: 상위에서 전달되면 동기화, 없으면 카드별 독립
  const [internalActiveTab, setInternalActiveTab] = useState<CostType>('전체');
  // 재무식은 직접/영업 구분이 없으므로 항상 '전체'로 동작
  const activeTab: CostType = isFinancial
    ? '전체'
    : (externalActiveTab ?? internalActiveTab);
  const setActiveTab = onTabChange ?? setInternalActiveTab;

  /** 탭·기준에 해당하는 비용 접근자 */
  const costAccessor = useMemo(() => {
    if (isFinancial) return fromCategoryData(financialCosts);
    if (activeTab === '직접비') return fromCategoryData(data.직접비);
    if (activeTab === '영업비') return fromCategoryData(data.영업비);
    return combineAccessors(
      fromCategoryData(data.직접비),
      fromCategoryData(data.영업비)
    );
  }, [isFinancial, financialCosts, activeTab, data]);

  /** 표시 통화 기준 총비용 (분기는 누적 차감) */
  const displayTotalCost = useMemo(
    () => periodValue(costAccessor, period, currency, exchangeRates),
    [costAccessor, period, currency, exchangeRates]
  );
  const displayTotalCostPrev = useMemo(
    () => periodValue(costAccessor, prevPeriod, currency, exchangeRates),
    [costAccessor, prevPeriod, currency, exchangeRates]
  );

  // 비용률 = 비용 / 리테일매출 × 100 — 둘 다 위안 기준이라 통화와 무관
  const totalCostCny = useMemo(
    () => periodCny(costAccessor, period),
    [costAccessor, period]
  );
  const costToSalesPercent = useMemo(() => {
    if (retailSales === null || retailSales === undefined || retailSales === 0) {
      return null;
    }
    return (totalCostCny / retailSales) * 100;
  }, [totalCostCny, retailSales]);

  // 채널 분해 호버 표시 여부
  const hasRetailBreakdown = (retailChannels?.length ?? 0) > 0;

  // 탭별 인원수
  const displayHeadcount = useMemo(
    () => basisForTab(officeBasis, storeBasis, activeTab),
    [activeTab, officeBasis, storeBasis]
  );

  /** 재무식·전체 탭은 사무실+매장 합이라 두 줄로 나눠 표시 */
  const splitHeadcount = isFinancial || activeTab === '전체';
  const headcountText = (v: number | null) =>
    v === null ? '-' : `${Math.round(v).toLocaleString()}명`;
  const headcountDelta = (curr: number | null, prev: number | null) =>
    curr === null || prev === null || prev === 0 ? null : Math.round(curr - prev);

  /** '인당' 분모 */
  const salarySubPerPersonDenominator = useMemo(
    () => basisForTab(officeBasis, storeBasis, activeTab) ?? 0,
    [activeTab, officeBasis, storeBasis]
  );

  // 인원수 YoY (전년 동기간 기준 동일 규칙)
  const headcountYoY = useMemo(() => {
    const currentCount = basisForTab(officeBasis, storeBasis, activeTab);
    const prevCount = basisForTab(officeBasisPrev, storeBasisPrev, activeTab);

    if (currentCount === null || prevCount === null || prevCount === 0) {
      return null; // 전년 데이터가 없으면 null
    }

    return currentCount - prevCount;
  }, [activeTab, officeBasis, storeBasis, officeBasisPrev, storeBasisPrev]);

  /** 인건비(급여) 접근자 — 재무식은 연결계정과목 '인건비' */
  const salaryAccessor = useMemo(() => {
    if (isFinancial) return fromMonthly(financialCosts['인건비']);
    if (activeTab === '직접비') return fromMonthly(data.직접비['급여']);
    if (activeTab === '영업비') return fromMonthly(data.영업비['급여']);
    return combineAccessors(
      fromMonthly(data.직접비['급여']),
      fromMonthly(data.영업비['급여'])
    );
  }, [isFinancial, financialCosts, activeTab, data]);

  // 인당 인건비 (기간 비용 ÷ 기간 인원)
  const salaryPerPerson = useMemo(() => {
    const denom = salarySubPerPersonDenominator;
    if (denom <= 0) return null;
    const amount = periodValue(salaryAccessor, period, currency, exchangeRates);
    return amount === null ? null : amount / denom;
  }, [salaryAccessor, period, currency, exchangeRates, salarySubPerPersonDenominator]);

  // 전년 동기간 인당 인건비 — 분모는 전년 인원
  const salaryPerPersonPrev = useMemo(() => {
    const prevDenom = basisForTab(officeBasisPrev, storeBasisPrev, activeTab) ?? 0;
    if (prevDenom === 0) return null;
    const amount = periodValue(salaryAccessor, prevPeriod, currency, exchangeRates);
    return amount === null ? null : amount / prevDenom;
  }, [
    salaryAccessor,
    prevPeriod,
    currency,
    exchangeRates,
    activeTab,
    officeBasisPrev,
    storeBasisPrev,
  ]);
  
  // 인당 복리비 — 재무식에는 복리비가 별도 연결계정과목으로 없고 '기타'에 포함 → 표시 안 함
  const welfareAccessor = useMemo(() => {
    if (activeTab === '직접비') return fromMonthly(data.직접비['복리비']);
    if (activeTab === '영업비') return fromMonthly(data.영업비['복리비']);
    return combineAccessors(
      fromMonthly(data.직접비['복리비']),
      fromMonthly(data.영업비['복리비'])
    );
  }, [activeTab, data]);

  const welfarePerPerson = useMemo(() => {
    if (isFinancial) return null;
    const denom = basisForTab(officeBasis, storeBasis, activeTab) ?? 0;
    if (denom <= 0) return null;
    const amount = periodValue(welfareAccessor, period, currency, exchangeRates);
    return amount === null ? null : amount / denom;
  }, [
    isFinancial,
    welfareAccessor,
    period,
    currency,
    exchangeRates,
    activeTab,
    officeBasis,
    storeBasis,
  ]);

  // 전년 동기간 인당 복리비 — 분모는 전년 인원
  const welfarePerPersonPrev = useMemo(() => {
    if (isFinancial) return null;
    const prevDenom = basisForTab(officeBasisPrev, storeBasisPrev, activeTab) ?? 0;
    if (prevDenom === 0) return null;
    const amount = periodValue(welfareAccessor, prevPeriod, currency, exchangeRates);
    return amount === null ? null : amount / prevDenom;
  }, [
    isFinancial,
    welfareAccessor,
    prevPeriod,
    currency,
    exchangeRates,
    activeTab,
    officeBasisPrev,
    storeBasisPrev,
  ]);

  /** 리테일 매출은 항상 위안 원본 — 통화 환산은 표시 시점에 기간 규칙으로 처리 */
  const retailAccessor = useMemo(
    () => fromMonthly(retailSalesData ?? undefined),
    [retailSalesData]
  );

  /** 당기 리테일 금액 환산 (채널 분해·Tag 등 단건 금액용) */
  const convertRetail = (amountCny: number): number | null => {
    if (currency === 'CNY') return amountCny;
    const r = rateForMonth(
      exchangeRates,
      period.endMonth,
      period.viewMode === '당월' ? '월평균' : '기간평균'
    );
    return r === null ? null : amountCny * r;
  };

  // 리테일 매출 (표시 통화). retailSales prop 이 이미 기간 합계이므로 위안은 그대로 사용
  const retailSalesDisplay = useMemo(() => {
    if (retailSales === null || retailSales === undefined) return null;
    if (currency === 'CNY') return retailSales;
    const r = rateForMonth(
      exchangeRates,
      period.endMonth,
      period.viewMode === '당월' ? '월평균' : '기간평균'
    );
    return r === null ? null : retailSales * r;
  }, [retailSales, currency, exchangeRates, period]);

  const retailSalesPrevDisplay = useMemo(() => {
    if (!retailSalesData || retailSales === null || retailSales === undefined) {
      return null;
    }
    const prevCny = periodCny(retailAccessor, prevPeriod);
    if (prevCny === 0) return null;
    if (currency === 'CNY') return prevCny;
    const r = rateForMonth(
      exchangeRates,
      prevPeriod.endMonth,
      prevPeriod.viewMode === '당월' ? '월평균' : '기간평균'
    );
    return r === null ? null : prevCny * r;
  }, [retailAccessor, retailSalesData, retailSales, prevPeriod, currency, exchangeRates]);

  const retailSalesYoY = useMemo(
    () => formatDelta(retailSalesDisplay, retailSalesPrevDisplay, currency),
    [retailSalesDisplay, retailSalesPrevDisplay, currency]
  );

  const retailSalesYoYPercent = useMemo(
    () => yoyIndex(retailSalesDisplay, retailSalesPrevDisplay),
    [retailSalesDisplay, retailSalesPrevDisplay]
  );

  // 비용 YoY — 표시 통화 기준 (분기는 누적 차감 값끼리 비교)
  const totalYoY = {
    pct: yoyIndex(displayTotalCost, displayTotalCostPrev),
    delta: formatDelta(displayTotalCost, displayTotalCostPrev, currency),
  };

  // 색상 매핑
  const colorClasses = {
    blue: {
      gradient: 'from-indigo-600 via-blue-600 to-blue-500',
      light: 'bg-blue-50/70',
      text: 'text-blue-800',
      button: 'bg-blue-600 hover:bg-blue-700 shadow-[0_10px_24px_rgba(37,99,235,0.22)]',
      yoyBox: 'bg-white/18 border border-white/15 backdrop-blur-[2px]',
    },
    yellow: {
      gradient: 'from-amber-600 via-yellow-500 to-amber-400',
      light: 'bg-amber-50/75',
      text: 'text-amber-800',
      button: 'bg-amber-500 hover:bg-amber-600 shadow-[0_10px_24px_rgba(217,119,6,0.22)]',
      yoyBox: 'bg-white/18 border border-white/15 backdrop-blur-[2px]',
    },
    green: {
      gradient: 'from-emerald-600 via-green-600 to-emerald-500',
      light: 'bg-emerald-50/75',
      text: 'text-emerald-800',
      button: 'bg-emerald-600 hover:bg-emerald-700 shadow-[0_10px_24px_rgba(5,150,105,0.22)]',
      yoyBox: 'bg-white/18 border border-white/15 backdrop-blur-[2px]',
    },
    gray: {
      gradient: 'from-slate-800 via-slate-700 to-slate-600',
      light: 'bg-slate-50/80',
      text: 'text-slate-800',
      button: 'bg-slate-700 hover:bg-slate-800 shadow-[0_10px_24px_rgba(51,65,85,0.22)]',
      yoyBox: 'bg-white/14 border border-white/12 backdrop-blur-[2px]',
    },
    purple: {
      gradient: 'from-violet-700 via-purple-600 to-fuchsia-600',
      light: 'bg-violet-50/75',
      text: 'text-violet-800',
      button: 'bg-violet-600 hover:bg-violet-700 shadow-[0_10px_24px_rgba(124,58,237,0.24)]',
      yoyBox: 'bg-white/18 border border-white/15 backdrop-blur-[2px]',
    },
    navy: {
      gradient: 'from-[#16305c] via-[#1d3f73] to-[#274d86]',
      light: 'bg-slate-50/80',
      text: 'text-[#16305c]',
      button: 'bg-[#1d3f73] hover:bg-[#16305c] shadow-[0_10px_24px_rgba(22,48,92,0.26)]',
      yoyBox: 'bg-white/14 border border-white/12 backdrop-blur-[2px]',
    },
  };
  
  const colors = colorClasses[color as keyof typeof colorClasses] || colorClasses.gray;
  
  return (
    <div className="bg-white rounded-2xl shadow-[0_16px_40px_rgba(15,23,42,0.10)] border border-slate-200/80 ring-1 ring-white/70 overflow-visible">
      {/* 헤더 (그라데이션) — 상단 모서리만 클립 */}
      <div className={`rounded-t-2xl overflow-hidden bg-gradient-to-r ${colors.gradient} p-4 sm:p-6 text-white shadow-inner`}>
        {unitOptions && onUnitChange ? (
          <div className="relative mb-3 sm:mb-4 inline-flex items-center">
            <select
              value={id}
              onChange={e => onUnitChange(e.target.value)}
              aria-label="사업부 선택"
              className="appearance-none bg-white/15 hover:bg-white/25 focus:bg-white/25 border border-white/25 rounded-lg pl-3 pr-8 py-1.5 text-lg sm:text-xl font-bold tracking-[-0.02em] text-white outline-none cursor-pointer transition-colors"
            >
              {unitOptions.map(opt => (
                <option key={opt.id} value={opt.id} className="text-slate-900 font-semibold">
                  {opt.name}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 text-white/80 text-xs">▼</span>
          </div>
        ) : (
          <h2 className="text-lg sm:text-xl font-bold tracking-[-0.02em] mb-3 sm:mb-4">{name}</h2>
        )}
        
        {/* 요약: 총비용 | 전년비용 | 비용 YOY | 리테일 YOY (한 줄 컴팩트) */}
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 min-w-0">
          <div
            className={`px-1.5 py-1.5 sm:px-2 sm:py-2 ${colors.yoyBox} rounded-xl text-white min-w-0 [container-type:inline-size] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]`}
          >
            <div className="text-[7px] sm:text-[8px] opacity-85 leading-none mb-0.5 truncate tracking-[0.02em]">
              총비용
            </div>
            <div className="text-[clamp(13px,13cqi+5px,22px)] sm:text-[clamp(14px,12cqi+6px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]">
              {formatAmount(displayTotalCost, currency)}
            </div>
          </div>
          <div
            className={`px-1.5 py-1.5 sm:px-2 sm:py-2 ${colors.yoyBox} rounded-xl text-white min-w-0 [container-type:inline-size] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
              displayTotalCostPrev === null ? 'opacity-75' : ''
            }`}
          >
            <div className="text-[7px] sm:text-[8px] opacity-85 leading-none mb-0.5 truncate tracking-[0.02em]">
              전년비용
            </div>
            <div className="text-[clamp(13px,13cqi+5px,22px)] sm:text-[clamp(14px,12cqi+6px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]">
              {formatAmount(displayTotalCostPrev, currency)}
            </div>
          </div>
          <div
            className={`px-1.5 py-1.5 sm:px-2 sm:py-2 ${colors.yoyBox} rounded-xl text-white min-w-0 [container-type:inline-size] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
              totalYoY.pct === null ? 'opacity-75' : ''
            }`}
          >
            <div className="text-[7px] sm:text-[8px] opacity-85 leading-none mb-0.5 truncate tracking-[0.02em]">
              비용 YOY
            </div>
            <div
              className="text-[clamp(13px,13cqi+5px,22px)] sm:text-[clamp(14px,12cqi+6px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]"
              title={totalYoY.delta ?? undefined}
            >
              {totalYoY.pct !== null ? `${totalYoY.pct}%` : '—'}
            </div>
          </div>
          <div
            className={`px-1.5 py-1.5 sm:px-2 sm:py-2 ${colors.yoyBox} rounded-xl text-white min-w-0 [container-type:inline-size] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
              retailSalesYoYPercent === null ? 'opacity-75' : ''
            }`}
          >
            <div className="text-[7px] sm:text-[8px] opacity-85 leading-none mb-0.5 truncate tracking-[0.02em]">
              리테일 YOY
            </div>
            <div className="text-[clamp(13px,13cqi+5px,22px)] sm:text-[clamp(14px,12cqi+6px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]">
              {retailSalesYoYPercent !== null ? `${retailSalesYoYPercent}%` : '—'}
            </div>
          </div>
        </div>
      </div>
      
      {/* 본문 — 하단 모서리 (sticky 헤더가 뷰포트에 붙을 수 있도록 루트는 overflow-visible) */}
      <div className="p-4 sm:p-6 rounded-b-2xl bg-gradient-to-b from-white to-slate-50/35">
        {/* 영업비율, 인원수, 리테일매출 등 (향후 확장용) */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-3 sm:mb-4 text-xs sm:text-sm rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2.5 shadow-sm shadow-slate-200/40">
          <div>
            <div className="text-gray-500">비용률</div>
            <div className="font-semibold text-gray-800">
              {costToSalesPercent !== null
                ? `${costToSalesPercent.toFixed(1)}%`
                : '-'}
            </div>
          </div>
          <div>
            <div className="text-gray-500">인원수</div>
            {splitHeadcount ? (
              // 합산 값(재무식·전체 탭)은 사무실/매장을 나눠 두 줄로 — 성격이 다른 인원이라 합만 보면 오해
              <div className="space-y-0.5 leading-tight">
                {(
                  [
                    ['사무실', officeBasis, officeBasisPrev],
                    ['매장', storeBasis, storeBasisPrev],
                  ] as const
                ).map(([label, curr, prev]) => (
                  <div key={label} className="whitespace-nowrap">
                    <span className="text-gray-500 mr-1">{label}</span>
                    <span className="font-semibold text-gray-800">{headcountText(curr)}</span>
                    {headcountDelta(curr, prev) !== null && (
                      <span className="text-[11px] font-normal text-gray-600 ml-1">
                        ({headcountDelta(curr, prev)! >= 0 ? '+' : ''}
                        {headcountDelta(curr, prev)})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="font-semibold text-gray-800">
                {displayHeadcount !== null && displayHeadcount !== undefined
                  ? (
                    <>
                      {Math.round(displayHeadcount).toLocaleString()}명
                      {headcountYoY !== null && (
                        <span className="text-sm font-normal text-gray-600 ml-1">
                          ({headcountYoY >= 0 ? '+' : ''}{Math.round(headcountYoY)}명)
                        </span>
                      )}
                    </>
                  )
                  : '-'}
              </div>
            )}
          </div>
          <div className="relative group/retail">
            <div className="text-gray-500">
              리테일매출
              {hasRetailBreakdown && (
                <span className="ml-1 text-[10px] text-gray-400 align-middle">ⓘ</span>
              )}
            </div>
            <div className="font-semibold text-gray-800 tabular-nums whitespace-nowrap">
              {retailSales !== null && retailSales !== undefined
                ? formatAmount(retailSalesDisplay, currency)
                : '-'}
            </div>
            {retailSalesYoY !== null && (
              <div className="text-xs text-gray-600 mt-0.5">YoY {retailSalesYoY}</div>
            )}
            {/* 채널 분해 (직영·대리상 × ON/OFF) — 리테일 스킬 정의 */}
            {hasRetailBreakdown && (
              <div className="pointer-events-none absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] shadow-lg opacity-0 group-hover/retail:opacity-100 transition-opacity">
                <div className="mb-1.5 flex items-baseline justify-between text-gray-500">
                  <span>채널별 실판(V+)</span>
                  <span className="text-[10px]">{viewMode}</span>
                </div>
                <table className="w-full tabular-nums">
                  <tbody>
                    {(retailChannels ?? []).map(ch => (
                      <tr key={ch.channel}>
                        <td className="py-0.5 pr-1 text-gray-600 whitespace-nowrap">{ch.channel}</td>
                        <td className="py-0.5 pr-1 text-right font-medium text-gray-800">
                          {formatAmount(convertRetail(ch.sale), currency)}
                        </td>
                        <td
                          className={`py-0.5 text-right ${
                            ch.yoyPct === null
                              ? 'text-gray-400'
                              : ch.yoyPct >= 100
                                ? 'text-emerald-600'
                                : 'text-red-500'
                          }`}
                        >
                          {ch.yoyPct !== null ? `${Math.round(ch.yoyPct)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {retailMetrics && (
                  <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-gray-500 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Tag가 매출</span>
                      <span className="tabular-nums text-gray-700">
                        {formatAmount(convertRetail(retailMetrics.tag), currency)}
                      </span>
                    </div>
                    {retailMetrics.discountRate !== null && (
                      <div className="flex justify-between">
                        <span>할인율</span>
                        <span className="tabular-nums text-gray-700">
                          {retailMetrics.discountRate.toFixed(1)}%
                          {retailMetrics.pyDiscountRate !== null && (
                            <span className="ml-1 text-[10px] text-gray-400">
                              (전년 {retailMetrics.pyDiscountRate.toFixed(1)}%)
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* 인당 인건비 / 인당 복리비 — 재무식은 인원 기준이 섞여 있어 표시하지 않는다 */}
        {!isFinancial && (
        <div
          className="grid grid-cols-2 gap-2 sm:gap-4 mb-3 sm:mb-4 text-xs sm:text-sm rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2.5 shadow-sm shadow-slate-200/40"
        >
          <div>
            <div className="text-gray-500">인당 인건비</div>
            <div className="font-semibold text-gray-800">
              {salaryPerPerson !== null && salaryPerPerson !== undefined
                ? (
                  <>
                    {formatPerPerson(salaryPerPerson, currency)}
                    {salaryPerPersonPrev !== null && (
                      <span className="text-sm font-normal text-gray-600 ml-1">
                        ({formatPerPersonDelta(salaryPerPerson, salaryPerPersonPrev, currency) ?? '—'})
                      </span>
                    )}
                  </>
                )
                : '-'}
            </div>
          </div>
          <div>
            <div className="text-gray-500">인당 복리비</div>
            <div className="font-semibold text-gray-800">
              {welfarePerPerson !== null && welfarePerPerson !== undefined
                ? (
                  <>
                    {formatPerPerson(welfarePerPerson, currency)}
                    {welfarePerPersonPrev !== null && (
                      <span className="text-sm font-normal text-gray-600 ml-1">
                        ({formatPerPersonDelta(welfarePerPerson, welfarePerPersonPrev, currency) ?? '—'})
                      </span>
                    )}
                  </>
                )
                : '-'}
            </div>
          </div>
        </div>
        )}

        {/* 관리식: 직접비/영업비 탭 + 대분류 표 / 재무식: 연결계정과목 표 */}
        <CostTypeTabs
          directCosts={data.직접비}
          operatingCosts={data.영업비}
          salarySub={data.급여중분류}
          welfareSub={data.복리중분류}
          selectedMonth={selectedMonth}
          viewMode={viewMode}
          color={color}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          salarySubExpanded={salarySubExpanded}
          onSalarySubExpandedChange={onSalarySubExpandedChange}
          welfareSubExpanded={welfareSubExpanded}
          onWelfareSubExpandedChange={onWelfareSubExpandedChange}
          salaryPerPersonDenominator={salarySubPerPersonDenominator}
          costBasis={costBasis}
          financialCosts={financialCosts}
          financialPkg={data.재무식PKG}
          currency={currency}
          exchangeRates={exchangeRates}
          period={period}
          prevPeriod={prevPeriod}
        />
      </div>
    </div>
  );
}
