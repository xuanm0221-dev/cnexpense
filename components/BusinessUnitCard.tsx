'use client';

/**
 * 사업부 카드 컴포넌트
 */

import Link from 'next/link';
import { BusinessUnitCosts, ViewMode } from '@/lib/types';
import { calculateCategoryTotal, calculateYoY } from '@/lib/calculations';
import { toThousandCNY } from '@/utils/formatters';
import CostTypeTabs from './CostTypeTabs';

interface BusinessUnitCardProps {
  id: string;
  name: string;
  color: string;
  data: BusinessUnitCosts;
  selectedMonth: string;
  viewMode: ViewMode;
}

export default function BusinessUnitCard({
  id,
  name,
  color,
  data,
  selectedMonth,
  viewMode,
}: BusinessUnitCardProps) {
  const isYTD = viewMode === '누적(YTD)';
  
  // 총 비용 계산 (직접비 + 영업비)
  const directTotal = calculateCategoryTotal(data.직접비, selectedMonth, isYTD);
  const operatingTotal = calculateCategoryTotal(data.영업비, selectedMonth, isYTD);
  const totalCost = directTotal + operatingTotal;
  
  // YoY 계산 (전체)
  // 간단하게 직접비와 영업비의 각 카테고리를 합쳐서 계산
  const allCategories = {
    ...data.직접비,
    ...data.영업비,
  };
  
  const totalYoY = (() => {
    let currentTotal = 0;
    let prevTotal = 0;
    const [currentYear, month] = selectedMonth.split('-');
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevMonth = `${prevYear}-${month}`;
    
    for (const category in allCategories) {
      const monthlyData = allCategories[category];
      if (isYTD) {
        currentTotal += calculateCategoryTotal({ [category]: monthlyData }, selectedMonth, true);
        prevTotal += calculateCategoryTotal({ [category]: monthlyData }, prevMonth, true);
      } else {
        currentTotal += monthlyData[selectedMonth] || 0;
        prevTotal += monthlyData[prevMonth] || 0;
      }
    }
    
    if (prevTotal === 0) {
      return { pct: 'N/A', deltaK: 'N/A' };
    }
    
    const pct = Math.round((currentTotal - prevTotal) / Math.abs(prevTotal) * 100);
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
    },
    yellow: {
      gradient: 'from-yellow-500 to-yellow-600',
      light: 'bg-yellow-50',
      text: 'text-yellow-700',
      button: 'bg-yellow-500 hover:bg-yellow-600',
    },
    green: {
      gradient: 'from-green-500 to-green-600',
      light: 'bg-green-50',
      text: 'text-green-700',
      button: 'bg-green-500 hover:bg-green-600',
    },
    gray: {
      gradient: 'from-gray-600 to-gray-700',
      light: 'bg-gray-50',
      text: 'text-gray-700',
      button: 'bg-gray-600 hover:bg-gray-700',
    },
    purple: {
      gradient: 'from-purple-600 to-purple-700',
      light: 'bg-purple-50',
      text: 'text-purple-700',
      button: 'bg-purple-600 hover:bg-purple-700',
    },
  };
  
  const colors = colorClasses[color as keyof typeof colorClasses] || colorClasses.gray;
  
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
      {/* 헤더 (그라데이션) */}
      <div className={`bg-gradient-to-r ${colors.gradient} p-6 text-white`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">{name}</h2>
          
          {/* 관매별/영업비 YoY 버튼 (향후 확장용) */}
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-xs hover:bg-opacity-30 transition-colors">
              관매별 YoY
            </button>
            <button className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-xs hover:bg-opacity-30 transition-colors">
              영업비 YoY
            </button>
          </div>
        </div>
        
        {/* YoY 표시 */}
        <div className="flex gap-4">
          {totalYoY.pct !== 'N/A' && (
            <>
              <div className="px-3 py-1 bg-white bg-opacity-20 rounded-lg">
                <div className="text-xs opacity-80">관매별 YoY</div>
                <div className="text-lg font-bold">{totalYoY.pct}%</div>
              </div>
              <div className="px-3 py-1 bg-white bg-opacity-20 rounded-lg">
                <div className="text-xs opacity-80">영업비 YoY</div>
                <div className="text-lg font-bold">{totalYoY.pct}%</div>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* 본문 */}
      <div className="p-6">
        {/* 총 비용 */}
        <div className="mb-4">
          <div className={`text-4xl font-bold ${colors.text}`}>
            {toThousandCNY(totalCost)}
          </div>
          <div className="text-sm text-gray-500 mt-1">총 비용</div>
        </div>
        
        {/* 영업비율, 인건수, 판매량 등 (향후 확장용) */}
        <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
          <div>
            <div className="text-gray-500">영업비율</div>
            <div className="font-semibold text-gray-800">
              {totalCost > 0
                ? ((operatingTotal / totalCost) * 100).toFixed(1)
                : '0.0'}
              %
            </div>
          </div>
          <div>
            <div className="text-gray-500">인건수</div>
            <div className="font-semibold text-gray-800">-</div>
          </div>
          <div>
            <div className="text-gray-500">판매량</div>
            <div className="font-semibold text-gray-800">-</div>
          </div>
        </div>
        
        <hr className="my-4" />
        
        {/* 인당기본급 / 인당복후비 */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <div className="text-gray-500">인당기본급</div>
            <div className="font-semibold text-gray-800">-</div>
          </div>
          <div>
            <div className="text-gray-500">인당복후비</div>
            <div className="font-semibold text-gray-800">-</div>
          </div>
        </div>
        
        {/* 직접비/영업비 탭 */}
        <CostTypeTabs
          directCosts={data.직접비}
          operatingCosts={data.영업비}
          selectedMonth={selectedMonth}
          viewMode={viewMode}
          color={color}
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
