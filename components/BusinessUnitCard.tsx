'use client';

/**
 * 사업부 카드 컴포넌트
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { BusinessUnitCosts, ViewMode, CostType, MonthlyAmounts } from '@/lib/types';
import { calculateCategoryTotal, calculateYoY, calculateYTD, getAmountForMonth } from '@/lib/calculations';
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
}: BusinessUnitCardProps) {
  const isYTD = viewMode === '누적(YTD)';
  
  // activeTab state 관리
  const [activeTab, setActiveTab] = useState<CostType>('전체');
  
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
  
  // 인당 급여 계산
  const salaryPerPerson = useMemo(() => {
    let salaryTotal = 0;
    let headcount = 0;
    
    if (activeTab === '직접비') {
      salaryTotal = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} }, 
        selectedMonth, 
        isYTD
      );
      headcount = storeHeadcount ?? 0;
    } else if (activeTab === '영업비') {
      salaryTotal = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} }, 
        selectedMonth, 
        isYTD
      );
      headcount = officeHeadcount ?? 0;
    } else {
      // 전체: 직접비 + 영업비 급여 합계
      const directSalary = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} }, 
        selectedMonth, 
        isYTD
      );
      const operatingSalary = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} }, 
        selectedMonth, 
        isYTD
      );
      salaryTotal = directSalary + operatingSalary;
      headcount = (officeHeadcount ?? 0) + (storeHeadcount ?? 0);
    }
    
    return headcount > 0 ? salaryTotal / headcount : null;
  }, [activeTab, data, selectedMonth, isYTD, storeHeadcount, officeHeadcount]);
  
  // 인당 급여 YoY 계산
  const salaryPerPersonYoY = useMemo(() => {
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    let prevSalaryTotal = 0;
    let prevHeadcount = 0;
    
    if (activeTab === '직접비') {
      prevSalaryTotal = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} }, 
        prevMonth, 
        isYTD
      );
      prevHeadcount = storeHeadcountData?.[prevMonth] ?? 0;
    } else if (activeTab === '영업비') {
      prevSalaryTotal = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} }, 
        prevMonth, 
        isYTD
      );
      prevHeadcount = officeHeadcountData?.[prevMonth] ?? 0;
    } else {
      // 전체: 직접비 + 영업비 급여 합계
      const prevDirectSalary = calculateCategoryTotal(
        { 급여: data.직접비['급여'] || {} }, 
        prevMonth, 
        isYTD
      );
      const prevOperatingSalary = calculateCategoryTotal(
        { 급여: data.영업비['급여'] || {} }, 
        prevMonth, 
        isYTD
      );
      prevSalaryTotal = prevDirectSalary + prevOperatingSalary;
      const prevOffice = officeHeadcountData?.[prevMonth] ?? 0;
      const prevStore = storeHeadcountData?.[prevMonth] ?? 0;
      prevHeadcount = prevOffice + prevStore;
    }
    
    if (prevHeadcount === 0 || salaryPerPerson === null) {
      return null;
    }
    
    const prevSalaryPerPerson = prevSalaryTotal / prevHeadcount;
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
    
    return headcount > 0 ? welfareTotal / headcount : null;
  }, [activeTab, data, selectedMonth, isYTD, storeHeadcount, officeHeadcount]);
  
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
    
    const prevWelfarePerPerson = prevWelfareTotal / prevHeadcount;
    const delta = welfarePerPerson - prevWelfarePerPerson;
    return parseFloat((delta / 1000).toFixed(1)); // K 단위로 변환, 소수점 1자리
  }, [activeTab, data, selectedMonth, isYTD, welfarePerPerson, officeHeadcountData, storeHeadcountData]);
  
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
      gradient: 'from-blue-500 to-blue-600',
      light: 'bg-blue-50',
      text: 'text-blue-700',
      button: 'bg-blue-500 hover:bg-blue-600',
      yoyBox: 'bg-blue-400',
    },
    yellow: {
      gradient: 'from-yellow-500 to-yellow-600',
      light: 'bg-yellow-50',
      text: 'text-yellow-700',
      button: 'bg-yellow-500 hover:bg-yellow-600',
      yoyBox: 'bg-yellow-400',
    },
    green: {
      gradient: 'from-green-500 to-green-600',
      light: 'bg-green-50',
      text: 'text-green-700',
      button: 'bg-green-500 hover:bg-green-600',
      yoyBox: 'bg-green-400',
    },
    gray: {
      gradient: 'from-gray-600 to-gray-700',
      light: 'bg-gray-50',
      text: 'text-gray-700',
      button: 'bg-gray-600 hover:bg-gray-700',
      yoyBox: 'bg-gray-500',
    },
    purple: {
      gradient: 'from-purple-600 to-purple-700',
      light: 'bg-purple-50',
      text: 'text-purple-700',
      button: 'bg-purple-600 hover:bg-purple-700',
      yoyBox: 'bg-purple-500',
    },
  };
  
  const colors = colorClasses[color as keyof typeof colorClasses] || colorClasses.gray;
  
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
      {/* 헤더 (그라데이션) */}
      <div className={`bg-gradient-to-r ${colors.gradient} p-6 text-white`}>
        <h2 className="text-xl font-bold mb-4">{name}</h2>
        
        {/* YoY 표시 */}
        <div className="flex gap-4">
          {/* 리테일매출 YOY */}
          {retailSalesYoYPercent !== null && (
            <div className={`px-4 py-2 ${colors.yoyBox} rounded-lg text-white`}>
              <div className="text-xs opacity-90">리테일매출 YOY</div>
              <div className="text-2xl font-bold">{retailSalesYoYPercent}%</div>
            </div>
          )}
          
          {/* 비용 YOY (탭에 따라 변경) */}
          {totalYoY.pct !== 'N/A' && (
            <div className={`px-4 py-2 ${colors.yoyBox} rounded-lg text-white`}>
              <div className="text-xs opacity-90">비용 YOY</div>
              <div className="text-2xl font-bold">{totalYoY.pct}%</div>
            </div>
          )}
        </div>
      </div>
      
      {/* 본문 */}
      <div className="p-6">
        {/* 총 비용 */}
        <div className="mb-4">
          <div className={`text-4xl font-bold ${colors.text}`}>
            {toThousandCNY(displayTotalCost)}
          </div>
          <div className="text-sm text-gray-500 mt-1">총 비용</div>
        </div>
        
        {/* 영업비율, 인원수, 리테일매출 등 (향후 확장용) */}
        <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
          <div>
            <div className="text-gray-500">영업비율</div>
            <div className="font-semibold text-gray-800">
              {displayTotalCost > 0
                ? ((operatingTotal / displayTotalCost) * 100).toFixed(1)
                : '0.0'}
              %
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
        
        <hr className="my-4" />
        
        {/* 인당 급여 / 인당 복리비 */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <div className="text-gray-500">인당 급여</div>
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
          selectedMonth={selectedMonth}
          viewMode={viewMode}
          color={color}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        
        {/* 전체 대시보드 보기 버튼 */}
        <Link href={`/cost/${id}`}>
          <button
            className={`w-full mt-6 py-3 rounded-lg text-white font-medium transition-colors ${colors.button}`}
          >
            전체 대시보드 보기 &gt;
          </button>
        </Link>
      </div>
    </div>
  );
}
