'use client';

/**
 * 사업부 카드 컴포넌트
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { BusinessUnitCosts, ViewMode, CostType, MonthlyAmounts } from '@/lib/types';
import {
  calculateCategoryTotal,
  calculateYoY,
  calculateYTD,
  getAmountForMonth,
  getYTDMonthCount,
} from '@/lib/calculations';
import { toThousandCNY } from '@/utils/formatters';
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
  activeTab?: CostType; // 직접비/영업비/전체 탭 (상위에서 제어 시 모든 카드 동기화)
  onTabChange?: (tab: CostType) => void;
  salarySubExpanded?: boolean;
  onSalarySubExpandedChange?: (open: boolean) => void;
  welfareSubExpanded?: boolean;
  onWelfareSubExpandedChange?: (open: boolean) => void;
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
  activeTab: externalActiveTab,
  onTabChange,
  salarySubExpanded,
  onSalarySubExpandedChange,
  welfareSubExpanded,
  onWelfareSubExpandedChange,
}: BusinessUnitCardProps) {
  const isYTD = viewMode === '누적(YTD)';
  const ytdMonthCount = getYTDMonthCount(selectedMonth);
  
  // activeTab: 상위에서 전달되면 동기화, 없으면 카드별 독립
  const [internalActiveTab, setInternalActiveTab] = useState<CostType>('전체');
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;
  
  // 총 비용 계산 (직접비 + 영업비)
  const directTotal = calculateCategoryTotal(data.직접비, selectedMonth, isYTD);
  const operatingTotal = calculateCategoryTotal(data.영업비, selectedMonth, isYTD);
  
  // 탭별 총 비용 계산
  const displayTotalCost = useMemo(() => {
    if (activeTab === '직접비') {
      return directTotal;
    } else if (activeTab === '영업비') {
      return operatingTotal;
    } else {
      return directTotal + operatingTotal;
    }
  }, [activeTab, directTotal, operatingTotal]);
  
  // 비용률 = 탭 기준 비용 합계 / 리테일매출 × 100 (전체·직접비·영업비 동일)
  const costToSalesPercent = useMemo(() => {
    if (retailSales === null || retailSales === undefined || retailSales === 0) {
      return null;
    }
    return (displayTotalCost / retailSales) * 100;
  }, [displayTotalCost, retailSales]);
  
  // 탭별 인원수 계산
  const displayHeadcount = useMemo(() => {
    if (activeTab === '직접비') {
      return storeHeadcount; // 매장 인원수
    } else if (activeTab === '영업비') {
      return officeHeadcount; // 사무실 인원수
    } else {
      // 전체 탭: 사무실 + 매장 인원수 합계
      const office = officeHeadcount ?? 0;
      const store = storeHeadcount ?? 0;
      const total = office + store;
      return total > 0 ? total : null;
    }
  }, [activeTab, storeHeadcount, officeHeadcount]);

  /** 급여 중분류 '인당' 분모: 당월=선택월 스냅샷, YTD=1월~선택월 월별 인원 합 */
  const salarySubPerPersonDenominator = useMemo(() => {
    if (isYTD) {
      if (activeTab === '직접비') {
        return storeHeadcountData ? calculateYTD(storeHeadcountData, selectedMonth) : 0;
      }
      if (activeTab === '영업비') {
        return officeHeadcountData ? calculateYTD(officeHeadcountData, selectedMonth) : 0;
      }
      const officeYtd = officeHeadcountData ? calculateYTD(officeHeadcountData, selectedMonth) : 0;
      const storeYtd = storeHeadcountData ? calculateYTD(storeHeadcountData, selectedMonth) : 0;
      return officeYtd + storeYtd;
    }
    if (activeTab === '직접비') {
      return storeHeadcount ?? 0;
    }
    if (activeTab === '영업비') {
      return officeHeadcount ?? 0;
    }
    return (officeHeadcount ?? 0) + (storeHeadcount ?? 0);
  }, [
    activeTab,
    isYTD,
    selectedMonth,
    officeHeadcountData,
    storeHeadcountData,
    officeHeadcount,
    storeHeadcount,
  ]);
  
  // 인원수 YoY 계산
  const headcountYoY = useMemo(() => {
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    let currentCount = 0;
    let prevCount = 0;
    
    if (activeTab === '직접비') {
      // 매장 인원수 YoY
      currentCount = storeHeadcount ?? 0;
      prevCount = storeHeadcountData?.[prevMonth] ?? 0;
    } else if (activeTab === '영업비') {
      // 사무실 인원수 YoY
      currentCount = officeHeadcount ?? 0;
      prevCount = officeHeadcountData?.[prevMonth] ?? 0;
    } else {
      // 전체 탭: (사무실+매장) 인원수 YoY
      currentCount = (officeHeadcount ?? 0) + (storeHeadcount ?? 0);
      const prevOffice = officeHeadcountData?.[prevMonth] ?? 0;
      const prevStore = storeHeadcountData?.[prevMonth] ?? 0;
      prevCount = prevOffice + prevStore;
    }
    
    if (prevCount === 0) {
      return null; // 전년 데이터가 없으면 null
    }
    
    const delta = currentCount - prevCount;
    return delta;
  }, [activeTab, selectedMonth, officeHeadcount, storeHeadcount, officeHeadcountData, storeHeadcountData]);
  
  // 인당 인건비 계산 (당월: 선택월 인원, YTD: 급여 대분류 합 ÷ 1월~선택월 월별 인원 합)
  const salaryPerPerson = useMemo(() => {
    let salaryTotal = 0;

    if (activeTab === '직접비') {
      salaryTotal = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} },
        selectedMonth,
        isYTD,
      );
    } else if (activeTab === '영업비') {
      salaryTotal = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} },
        selectedMonth,
        isYTD,
      );
    } else {
      const directSalary = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} },
        selectedMonth,
        isYTD,
      );
      const operatingSalary = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} },
        selectedMonth,
        isYTD,
      );
      salaryTotal = directSalary + operatingSalary;
    }

    const denom = salarySubPerPersonDenominator;
    if (denom <= 0) return null;
    return salaryTotal / denom;
  }, [activeTab, data, selectedMonth, isYTD, salarySubPerPersonDenominator]);
  
  // 인당 인건비 YoY 계산 (당월·YTD 모두 동일 분모 규칙으로 전년 동월/동기간 비교)
  const salaryPerPersonYoY = useMemo(() => {
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;

    let prevSalaryTotal = 0;
    let prevDenom = 0;

    if (activeTab === '직접비') {
      prevSalaryTotal = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} },
        prevMonth,
        isYTD,
      );
      prevDenom = isYTD
        ? storeHeadcountData
          ? calculateYTD(storeHeadcountData, prevMonth)
          : 0
        : storeHeadcountData?.[prevMonth] ?? 0;
    } else if (activeTab === '영업비') {
      prevSalaryTotal = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} },
        prevMonth,
        isYTD,
      );
      prevDenom = isYTD
        ? officeHeadcountData
          ? calculateYTD(officeHeadcountData, prevMonth)
          : 0
        : officeHeadcountData?.[prevMonth] ?? 0;
    } else {
      const prevDirectSalary = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} },
        prevMonth,
        isYTD,
      );
      const prevOperatingSalary = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} },
        prevMonth,
        isYTD,
      );
      prevSalaryTotal = prevDirectSalary + prevOperatingSalary;
      if (isYTD) {
        const o = officeHeadcountData ? calculateYTD(officeHeadcountData, prevMonth) : 0;
        const s = storeHeadcountData ? calculateYTD(storeHeadcountData, prevMonth) : 0;
        prevDenom = o + s;
      } else {
        prevDenom =
          (officeHeadcountData?.[prevMonth] ?? 0) + (storeHeadcountData?.[prevMonth] ?? 0);
      }
    }

    if (prevDenom === 0 || salaryPerPerson === null) {
      return null;
    }

    const prevSalaryPerPerson = prevSalaryTotal / prevDenom;
    const delta = salaryPerPerson - prevSalaryPerPerson;
    return parseFloat((delta / 1000).toFixed(1)); // K 단위로 변환, 소수점 1자리
  }, [activeTab, data, selectedMonth, isYTD, salaryPerPerson, officeHeadcountData, storeHeadcountData]);
  
  // 인당 복리비 계산
  const welfarePerPerson = useMemo(() => {
    let welfareTotal = 0;
    let headcount = 0;
    
    if (activeTab === '직접비') {
      welfareTotal = calculateCategoryTotal(
        { 복리비: data.직접비['복리비'] || {} }, 
        selectedMonth, 
        isYTD
      );
      headcount = storeHeadcount ?? 0;
    } else if (activeTab === '영업비') {
      welfareTotal = calculateCategoryTotal(
        { 복리비: data.영업비['복리비'] || {} }, 
        selectedMonth, 
        isYTD
      );
      headcount = officeHeadcount ?? 0;
    } else {
      // 전체: 직접비 + 영업비 복리비 합계
      const directWelfare = calculateCategoryTotal(
        { 복리비: data.직접비['복리비'] || {} }, 
        selectedMonth, 
        isYTD
      );
      const operatingWelfare = calculateCategoryTotal(
        { 복리비: data.영업비['복리비'] || {} }, 
        selectedMonth, 
        isYTD
      );
      welfareTotal = directWelfare + operatingWelfare;
      headcount = (officeHeadcount ?? 0) + (storeHeadcount ?? 0);
    }
    
    if (headcount <= 0) return null;
    const perPerson = welfareTotal / headcount;
    return isYTD ? perPerson / ytdMonthCount : perPerson;
  }, [activeTab, data, selectedMonth, isYTD, ytdMonthCount, storeHeadcount, officeHeadcount]);
  
  // 인당 복리비 YoY 계산
  const welfarePerPersonYoY = useMemo(() => {
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    let prevWelfareTotal = 0;
    let prevHeadcount = 0;
    
    if (activeTab === '직접비') {
      prevWelfareTotal = calculateCategoryTotal(
        { 복리비: data.직접비['복리비'] || {} }, 
        prevMonth, 
        isYTD
      );
      prevHeadcount = storeHeadcountData?.[prevMonth] ?? 0;
    } else if (activeTab === '영업비') {
      prevWelfareTotal = calculateCategoryTotal(
        { 복리비: data.영업비['복리비'] || {} }, 
        prevMonth, 
        isYTD
      );
      prevHeadcount = officeHeadcountData?.[prevMonth] ?? 0;
    } else {
      // 전체: 직접비 + 영업비 복리비 합계
      const prevDirectWelfare = calculateCategoryTotal(
        { 복리비: data.직접비['복리비'] || {} }, 
        prevMonth, 
        isYTD
      );
      const prevOperatingWelfare = calculateCategoryTotal(
        { 복리비: data.영업비['복리비'] || {} }, 
        prevMonth, 
        isYTD
      );
      prevWelfareTotal = prevDirectWelfare + prevOperatingWelfare;
      const prevOffice = officeHeadcountData?.[prevMonth] ?? 0;
      const prevStore = storeHeadcountData?.[prevMonth] ?? 0;
      prevHeadcount = prevOffice + prevStore;
    }
    
    if (prevHeadcount === 0 || welfarePerPerson === null) {
      return null;
    }
    
    const prevRaw = prevWelfareTotal / prevHeadcount;
    const prevWelfarePerPerson = isYTD ? prevRaw / ytdMonthCount : prevRaw;
    const delta = welfarePerPerson - prevWelfarePerPerson;
    return parseFloat((delta / 1000).toFixed(1)); // K 단위로 변환, 소수점 1자리
  }, [activeTab, data, selectedMonth, isYTD, ytdMonthCount, welfarePerPerson, officeHeadcountData, storeHeadcountData]);
  
  // 리테일 매출 YoY 계산 (K 단위 증감액)
  const retailSalesYoY = useMemo(() => {
    if (!retailSalesData || retailSales === null || retailSales === undefined) {
      return null;
    }
    
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    // 현재 월 리테일 매출 (이미 YTD 모드면 합계로 계산됨)
    const currentSales = retailSales;
    
    // 전년 동월 리테일 매출
    const prevSales = isYTD
      ? calculateYTD(retailSalesData, prevMonth)
      : getAmountForMonth(retailSalesData, prevMonth);
    
    if (prevSales === 0) {
      return null;
    }
    
    const delta = currentSales - prevSales;
    return Math.round(delta / 1000); // K 단위로 변환
  }, [retailSales, retailSalesData, selectedMonth, isYTD]);
  
  // 리테일 매출 YoY 백분율 계산
  const retailSalesYoYPercent = useMemo(() => {
    if (!retailSalesData || retailSales === null || retailSales === undefined) {
      return null;
    }
    
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    const currentSales = retailSales;
    const prevSales = isYTD
      ? calculateYTD(retailSalesData, prevMonth)
      : getAmountForMonth(retailSalesData, prevMonth);
    
    if (prevSales === 0) {
      return null;
    }
    
    const percent = Math.round((currentSales / prevSales) * 100);
    return percent;
  }, [retailSales, retailSalesData, selectedMonth, isYTD]);
  
  // YoY 계산 (displayTotalCost 기준)
  const totalYoY = (() => {
    let currentTotal = displayTotalCost;
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    let prevTotal = 0;
    if (activeTab === '직접비') {
      prevTotal = calculateCategoryTotal(data.직접비, prevMonth, isYTD);
    } else if (activeTab === '영업비') {
      prevTotal = calculateCategoryTotal(data.영업비, prevMonth, isYTD);
    } else {
      prevTotal = calculateCategoryTotal(data.직접비, prevMonth, isYTD) + 
                   calculateCategoryTotal(data.영업비, prevMonth, isYTD);
    }
    
    if (prevTotal === 0) {
      return { pct: 'N/A', deltaK: 'N/A' };
    }
    
    const pct = Math.round((currentTotal / prevTotal) * 100); // 백분율 표시법: (당년 / 전년) × 100
    const deltaK = Math.round((currentTotal - prevTotal) / 1000);
    
    return { pct, deltaK };
  })();
  
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
  };
  
  const colors = colorClasses[color as keyof typeof colorClasses] || colorClasses.gray;
  
  return (
    <div className="bg-white rounded-2xl shadow-[0_16px_40px_rgba(15,23,42,0.10)] border border-slate-200/80 ring-1 ring-white/70 overflow-visible">
      {/* 헤더 (그라데이션) — 상단 모서리만 클립 */}
      <div className={`rounded-t-2xl overflow-hidden bg-gradient-to-r ${colors.gradient} p-4 sm:p-6 text-white shadow-inner`}>
        <h2 className="text-lg sm:text-xl font-bold tracking-[-0.02em] mb-3 sm:mb-4">{name}</h2>
        
        {/* 요약: 총비용 | 리테일매출 YOY | 비용 YOY (한 줄 컴팩트) */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 min-w-0">
          <div
            className={`px-1.5 py-1.5 sm:px-2 sm:py-2 ${colors.yoyBox} rounded-xl text-white min-w-0 [container-type:inline-size] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]`}
          >
            <div className="text-[7px] sm:text-[8px] opacity-85 leading-none mb-0.5 truncate tracking-[0.02em]">
              총비용
            </div>
            <div className="text-[clamp(16px,16cqi+8px,22px)] sm:text-[clamp(17px,14cqi+8px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]">
              {toThousandCNY(displayTotalCost)}
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
            <div className="text-[clamp(16px,16cqi+8px,22px)] sm:text-[clamp(17px,14cqi+8px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]">
              {retailSalesYoYPercent !== null ? `${retailSalesYoYPercent}%` : '—'}
            </div>
          </div>
          <div
            className={`px-1.5 py-1.5 sm:px-2 sm:py-2 ${colors.yoyBox} rounded-xl text-white min-w-0 [container-type:inline-size] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
              totalYoY.pct === 'N/A' ? 'opacity-75' : ''
            }`}
          >
            <div className="text-[7px] sm:text-[8px] opacity-85 leading-none mb-0.5 truncate tracking-[0.02em]">
              비용 YOY
            </div>
            <div className="text-[clamp(16px,16cqi+8px,22px)] sm:text-[clamp(17px,14cqi+8px,24px)] font-bold tabular-nums leading-none whitespace-nowrap tracking-[-0.02em]">
              {totalYoY.pct !== 'N/A' ? `${totalYoY.pct}%` : '—'}
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
            <div className="font-semibold text-gray-800">
              {displayHeadcount !== null && displayHeadcount !== undefined 
                ? (
                  <>
                    {displayHeadcount.toLocaleString()}명
                    {headcountYoY !== null && (
                      <span className="text-sm font-normal text-gray-600 ml-1">
                        ({headcountYoY >= 0 ? '+' : ''}{headcountYoY}명)
                      </span>
                    )}
                  </>
                )
                : '-'}
            </div>
          </div>
          <div>
            <div className="text-gray-500">리테일매출</div>
            <div className="font-semibold text-gray-800">
              {retailSales !== null && retailSales !== undefined
                ? toThousandCNY(retailSales)
                : '-'}
            </div>
            {retailSalesYoY !== null && (
              <div className="text-xs text-gray-600 mt-0.5">
                YoY {retailSalesYoY >= 0 ? '+' : ''}{retailSalesYoY.toLocaleString()}K
              </div>
            )}
          </div>
        </div>
        
        {/* 인당 인건비 / 인당 복리비 */}
        <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-3 sm:mb-4 text-xs sm:text-sm rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2.5 shadow-sm shadow-slate-200/40">
          <div>
            <div className="text-gray-500">인당 인건비</div>
            <div className="font-semibold text-gray-800">
              {salaryPerPerson !== null && salaryPerPerson !== undefined
                ? (
                  <>
                    {Number((salaryPerPerson / 1000).toFixed(1)).toLocaleString('en-US')}K
                    {salaryPerPersonYoY !== null && (
                      <span className="text-sm font-normal text-gray-600 ml-1">
                        ({salaryPerPersonYoY >= 0 ? '+' : ''}{salaryPerPersonYoY.toFixed(1)}K)
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
                    {Number((welfarePerPerson / 1000).toFixed(1)).toLocaleString('en-US')}K
                    {welfarePerPersonYoY !== null && (
                      <span className="text-sm font-normal text-gray-600 ml-1">
                        ({welfarePerPersonYoY >= 0 ? '+' : ''}{welfarePerPersonYoY.toFixed(1)}K)
                      </span>
                    )}
                  </>
                )
                : '-'}
            </div>
          </div>
        </div>
        
        {/* 직접비/영업비 탭 */}
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
        />
        
        {/* 전체 대시보드 보기 버튼 */}
        <Link href={`/cost/${id}`}>
          <button
            className={`w-full mt-4 sm:mt-6 py-2.5 sm:py-3 text-sm sm:text-base rounded-xl text-white font-semibold tracking-[-0.01em] transition-all ${colors.button}`}
          >
            전체 대시보드 보기 &gt;
          </button>
        </Link>
      </div>
    </div>
  );
}
