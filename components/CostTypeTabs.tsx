'use client';

/**
 * 직접비/영업비 탭 컴포넌트
 */

import { useState } from 'react';
import { CategoryData, CostType, ViewMode, MonthlyAmounts } from '@/lib/types';
import {
  getSortedCategories,
  calculateYTD,
  getAmountForMonth,
  calculateYoY,
  calculateCategoryTotal,
} from '@/lib/calculations';
import { toThousandCNY, formatPercent } from '@/utils/formatters';

interface CostTypeTabsProps {
  directCosts: CategoryData;
  operatingCosts: CategoryData;
  selectedMonth: string;
  viewMode: ViewMode;
  color: string;
}

export default function CostTypeTabs({
  directCosts,
  operatingCosts,
  selectedMonth,
  viewMode,
  color,
}: CostTypeTabsProps) {
  // 직접비와 영업비 데이터 존재 여부 확인
  const hasDirectCosts = Object.keys(directCosts).length > 0;
  const hasOperatingCosts = Object.keys(operatingCosts).length > 0;
  
  // 초기 탭은 전체로 설정
  const [activeTab, setActiveTab] = useState<CostType>('전체');
  
  const isYTD = viewMode === '누적(YTD)';
  
  // 현재 탭에 따른 데이터
  let currentData: CategoryData;
  let currentCostType: '직접비' | '영업비' | undefined;
  
  if (activeTab === '전체') {
    // 전체: 직접비와 영업비 합치기
    currentData = { ...directCosts };
    for (const category in operatingCosts) {
      if (currentData[category]) {
        // 이미 있는 카테고리면 합산
        const merged: MonthlyAmounts = { ...currentData[category] };
        for (const month in operatingCosts[category]) {
          merged[month] = (merged[month] || 0) + operatingCosts[category][month];
        }
        currentData[category] = merged;
      } else {
        // 없는 카테고리면 추가
        currentData[category] = operatingCosts[category];
      }
    }
    currentCostType = undefined; // 전체일 때는 순서 지정 안함 (금액순)
  } else if (activeTab === '직접비') {
    currentData = directCosts;
    currentCostType = '직접비';
  } else {
    currentData = operatingCosts;
    currentCostType = '영업비';
  }
  
  // 대분류 목록 (지정된 순서로 정렬)
  const categories = getSortedCategories(currentData, selectedMonth, isYTD, currentCostType);
  
  // 총합 계산
  const total = calculateCategoryTotal(currentData, selectedMonth, isYTD);
  
  // 탭 스타일
  const getTabStyle = (tab: CostType) => {
    const isActive = activeTab === tab;
    const baseColors = {
      blue: isActive ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-gray-600 border-gray-200',
      yellow: isActive ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : 'bg-white text-gray-600 border-gray-200',
      green: isActive ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-gray-600 border-gray-200',
      gray: isActive ? 'bg-gray-100 text-gray-700 border-gray-300' : 'bg-white text-gray-600 border-gray-200',
      purple: isActive ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-white text-gray-600 border-gray-200',
    };
    return baseColors[color as keyof typeof baseColors] || baseColors.gray;
  };
  
  return (
    <div className="mt-4">
      {/* 탭 헤더 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('전체')}
          className={`flex-1 py-2 px-4 rounded-lg border font-medium text-sm transition-colors ${getTabStyle('전체')}`}
        >
          전체
        </button>
        {hasDirectCosts && (
          <button
            onClick={() => setActiveTab('직접비')}
            className={`flex-1 py-2 px-4 rounded-lg border font-medium text-sm transition-colors ${getTabStyle('직접비')}`}
          >
            직접비
          </button>
        )}
        {hasOperatingCosts && (
          <button
            onClick={() => setActiveTab('영업비')}
            className={`flex-1 py-2 px-4 rounded-lg border font-medium text-sm transition-colors ${getTabStyle('영업비')}`}
          >
            영업비
          </button>
        )}
      </div>
      
      {/* 테이블 헤더 */}
      {categories.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-2 px-3 py-2 text-xs text-gray-500 font-medium border-b border-gray-200">
          <div>대분류</div>
          <div className="text-right">금액</div>
          <div className="text-right">구성비</div>
          <div className="text-right">YoY</div>
        </div>
      )}
      
      {/* 대분류 테이블 */}
      <div className="space-y-2">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            데이터가 없습니다.
          </div>
        ) : (
          categories.map(category => {
            const monthlyData = currentData[category];
            const amount = isYTD
              ? calculateYTD(monthlyData, selectedMonth)
              : getAmountForMonth(monthlyData, selectedMonth);
            
            const ratio = total > 0 ? amount / total : 0;
            const yoy = calculateYoY(monthlyData, selectedMonth, isYTD);
            
            return (
              <div
                key={category}
                className="grid grid-cols-4 gap-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                {/* 대분류명 */}
                <div className="font-medium text-gray-800">{category}</div>
                
                {/* 금액 */}
                <div className="text-right font-semibold text-gray-900">
                  {toThousandCNY(amount)}
                </div>
                
                {/* 구성비 */}
                <div className="text-right text-sm text-gray-600">
                  {formatPercent(ratio, 1)}
                </div>
                
                {/* YoY */}
                <div className="text-right text-sm">
                  {yoy.pct === 'N/A' ? (
                    <span className="text-gray-400">N/A</span>
                  ) : (
                    <span className={yoy.pct >= 0 ? 'text-red-600' : 'text-blue-600'}>
                      {yoy.pct}%
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
